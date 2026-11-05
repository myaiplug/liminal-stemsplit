//! Engine maintenance commands: model catalog, model doctor, post-update self-check.
//!
//! Every command shells out to one of the Python helpers in `scripts/` (model_catalog.py,
//! model_doctor.py, gpu_runtime.py) using the embedded interpreter. Helpers print JSON; lines that
//! carry an `"event"` key are forwarded to the frontend as `engine-progress`, and the last JSON
//! value printed is returned to the caller.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn engine_script_path(name: &str) -> Result<PathBuf, String> {
    let path = crate::resolve_python_script_path(name);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("{} not found at {}", name, path.display()))
    }
}

/// Run a helper script to completion. `emit` receives every JSON line that has an `event` key.
fn run_engine_script<F>(script: &str, args: &[String], emit: F) -> Result<serde_json::Value, String>
where
    F: Fn(&serde_json::Value),
{
    let python_exe = crate::get_python_executable()
        .ok_or_else(|| "Python runtime is not available. Run the built-in environment setup first.".to_string())?;
    let script_path = engine_script_path(script)?;
    let script_dir = script_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let mut cmd = Command::new(&python_exe);
    cmd.arg(&script_path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&script_dir)
        .env("PYTHONPATH", script_dir.to_string_lossy().to_string())
        .env("PYTHONIOENCODING", "utf-8");
    crate::apply_python_runtime_env(&mut cmd);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(crate::CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {}: {}", script, e))?;
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take();
    // Drain stderr on its own thread so a chatty helper can never deadlock on a full pipe.
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut s) = stderr {
            let _ = s.read_to_string(&mut buf);
        }
        buf
    });

    let mut last: Option<serde_json::Value> = None;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if value.get("event").is_some() {
                emit(&value);
            }
            last = Some(value);
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for {}: {}", script, e))?;
    let stderr_text = stderr_handle.join().unwrap_or_default();

    match last {
        Some(value) => Ok(value),
        None if status.success() => Ok(serde_json::json!({ "ok": true })),
        None => Err(format!(
            "{} exited with code {}: {}",
            script,
            status.code().unwrap_or(-1),
            stderr_text.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
        )),
    }
}

/// List the model catalog. `refresh` re-fetches the live sources (audio-separator list, remote
/// manifest, optionally Hugging Face); otherwise the cached/bundled catalog is used instantly.
#[tauri::command]
pub async fn catalog_list(
    refresh: Option<bool>,
    include_hf: Option<bool>,
    installed_only: Option<bool>,
    vram_gb: Option<f64>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = Vec::new();
        args.push(if refresh.unwrap_or(false) { "--refresh".into() } else { "--list".into() });
        if include_hf.unwrap_or(false) {
            args.push("--hf".into());
        }
        if installed_only.unwrap_or(false) {
            args.push("--installed".into());
        }
        if let Some(v) = vram_gb {
            args.push("--vram".into());
            args.push(format!("{}", v));
        }
        run_engine_script("model_catalog.py", &args, |_| {})
    })
    .await
    .map_err(|e| format!("catalog task failed: {}", e))?
}

/// Download + register one catalog model. Progress is emitted as `engine-progress`
/// (`event: "catalog_progress"`).
#[tauri::command]
pub async fn catalog_download(model_id: String, window: tauri::Window) -> Result<serde_json::Value, String> {
    if model_id.is_empty() || model_id.len() > 200 {
        return Err("Invalid model id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let args = vec!["--download".to_string(), model_id];
        run_engine_script("model_catalog.py", &args, |ev| {
            let _ = window.emit("engine-progress", ev.clone());
        })
    })
    .await
    .map_err(|e| format!("download task failed: {}", e))?
}

#[tauri::command]
pub async fn catalog_remove(model_id: String) -> Result<serde_json::Value, String> {
    if model_id.is_empty() || model_id.len() > 200 {
        return Err("Invalid model id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        run_engine_script("model_catalog.py", &["--remove".to_string(), model_id], |_| {})
    })
    .await
    .map_err(|e| format!("remove task failed: {}", e))?
}

/// "Repair engine": verifies the runtime imports, script files and model files, repairing what it can.
#[tauri::command]
pub async fn engine_doctor(repair: Option<bool>, window: tauri::Window) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args = vec!["--doctor".to_string()];
        if repair.unwrap_or(true) {
            args.push("--repair".into());
        }
        run_engine_script("model_doctor.py", &args, |ev| {
            let _ = window.emit("engine-progress", ev.clone());
        })
    })
    .await
    .map_err(|e| format!("doctor task failed: {}", e))?
}

/// Post-update self-check (idempotent per app version; `force` re-runs it).
#[tauri::command]
pub async fn engine_post_update_check(force: Option<bool>, window: tauri::Window) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || post_update_check_blocking(force.unwrap_or(false), Some(&window)))
        .await
        .map_err(|e| format!("post-update task failed: {}", e))?
}

fn post_update_check_blocking(force: bool, window: Option<&tauri::Window>) -> Result<serde_json::Value, String> {
    let mut args = vec![
        "--post-update".to_string(),
        "--app-version".to_string(),
        env!("CARGO_PKG_VERSION").to_string(),
    ];
    if force {
        args.push("--force".into());
    }
    run_engine_script("model_doctor.py", &args, |ev| {
        if let Some(w) = window {
            let _ = w.emit("engine-progress", ev.clone());
        }
    })
}

#[tauri::command]
pub async fn engine_gpu_status() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let python_exe = crate::get_python_executable().ok_or_else(|| "Python runtime is not available".to_string())?;
        let args = vec!["--status".to_string(), "--python".to_string(), python_exe.to_string_lossy().to_string()];
        run_engine_script("gpu_runtime.py", &args, |_| {})
    })
    .await
    .map_err(|e| format!("gpu status task failed: {}", e))?
}

/// Read the tail of a split diagnostic log so the UI can show what auto-recovery did.
/// Only the files the splitter itself writes are readable through this command.
#[tauri::command]
pub async fn read_diagnostic_log(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name != "split_diagnostics.log" && name != "splitter_error.log" {
        return Err("Not a diagnostic log file".into());
    }
    let limit = max_bytes.unwrap_or(64 * 1024).min(512 * 1024);
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Seek, SeekFrom};
        let mut f = std::fs::File::open(&p).map_err(|e| format!("Cannot open log: {}", e))?;
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len > limit {
            let _ = f.seek(SeekFrom::Start(len - limit));
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| format!("Cannot read log: {}", e))?;
        Ok(String::from_utf8_lossy(&buf).to_string())
    })
    .await
    .map_err(|e| format!("log task failed: {}", e))?
}

/// Called once from `setup`: after an app update, quietly verify/repair the embedded Python
/// runtime. The Python side keeps a per-version marker so this is a no-op on normal launches.
pub fn spawn_post_update_check(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        // Let the window and any first-run Python setup settle before touching the runtime.
        std::thread::sleep(std::time::Duration::from_secs(8));
        if crate::get_python_executable().is_none() {
            return;
        }
        let result = post_update_check_blocking(false, None);
        let payload = match result {
            Ok(v) => v,
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        };
        if let Some(win) = handle.get_webview_window("main") {
            let _ = win.emit("engine-post-update", payload);
        }
    });
}
