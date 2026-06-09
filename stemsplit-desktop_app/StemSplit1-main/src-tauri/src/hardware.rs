use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemProfile {
    pub os: String,
    pub arch: String,
    pub has_nvidia: bool,
    pub has_apple_silicon: bool,
    pub recommended_payload: String,
    pub gpu_name: Option<String>,
    pub gpu_vram_gb: Option<f32>,
    pub nvidia_driver_version: Option<String>,
}

#[derive(Default)]
struct NvidiaProbe {
    detected: bool,
    gpu_name: Option<String>,
    gpu_vram_gb: Option<f32>,
    driver_version: Option<String>,
}

fn parse_nvidia_smi_csv_line(line: &str) -> Option<(String, f32, String)> {
    // Expected: "NVIDIA GeForce RTX 2080 SUPER, 591.86, 8192 MiB"
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    if parts.len() < 3 {
        return None;
    }

    let gpu_name = parts[0].to_string();
    if gpu_name.is_empty() || gpu_name.eq_ignore_ascii_case("name") {
        return None;
    }

    let driver_version = parts[1].to_string();
    let memory_text = parts[2].to_lowercase();
    let memory_value = memory_text
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<f32>().ok())?;

    let vram_gb = if memory_text.contains("gib") || memory_text.contains("gb") {
        memory_value
    } else {
        memory_value / 1024.0
    };

    Some((gpu_name, vram_gb, driver_version))
}

fn probe_nvidia_gpu_windows() -> NvidiaProbe {
    let mut probe = NvidiaProbe::default();

    if let Ok(output) = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,driver_version,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines().map(str::trim).filter(|line| !line.is_empty()) {
                if let Some((gpu_name, vram_gb, driver_version)) = parse_nvidia_smi_csv_line(line)
                {
                    probe.detected = true;
                    probe.gpu_name = Some(gpu_name);
                    probe.gpu_vram_gb = Some(vram_gb);
                    probe.driver_version = Some(driver_version);
                    return probe;
                }
            }
        }
    }

    // Fallback: older drivers may not support nounits — parse the human-readable table.
    if let Ok(output) = Command::new("nvidia-smi").arg("-L").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().find(|line| line.to_lowercase().contains("nvidia")) {
                probe.detected = true;
                probe.gpu_name = Some(
                    line.split(':')
                        .next()
                        .unwrap_or("NVIDIA GPU")
                        .trim()
                        .to_string(),
                );
            }
        }
    }

    // Last resort: WMI video controller names.
    if !probe.detected {
        if let Ok(output) = Command::new("wmic")
            .args(["path", "win32_VideoController", "get", "name"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("nvidia") {
                probe.detected = true;
                probe.gpu_name = Some("NVIDIA GPU (WMI)".to_string());
            }
        }
    }

    probe
}

#[tauri::command]
pub async fn get_system_profile() -> Result<SystemProfile, String> {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    let mut has_nvidia = false;
    let mut has_apple_silicon = false;
    let mut gpu_name = None;
    let mut gpu_vram_gb = None;
    let mut nvidia_driver_version = None;

    if os == "windows" {
        let probe = probe_nvidia_gpu_windows();
        has_nvidia = probe.detected;
        gpu_name = probe.gpu_name;
        gpu_vram_gb = probe.gpu_vram_gb;
        nvidia_driver_version = probe.driver_version;
    } else if os == "macos" {
        if arch == "aarch64" {
            has_apple_silicon = true;
        }
    } else if os == "linux" {
        if let Ok(output) = Command::new("nvidia-smi")
            .args([
                "--query-gpu=name,driver_version,memory.total",
                "--format=csv,noheader,nounits",
            ])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = stdout.lines().map(str::trim).find(|line| !line.is_empty()) {
                    if let Some((name, vram, driver)) = parse_nvidia_smi_csv_line(line) {
                        has_nvidia = true;
                        gpu_name = Some(name);
                        gpu_vram_gb = Some(vram);
                        nvidia_driver_version = Some(driver);
                    }
                }
            }
        }
    }

    let recommended_payload = if os == "windows" {
        if has_nvidia {
            "python_env_win_cuda.zip".to_string()
        } else {
            "python_env_win_cpu.zip".to_string()
        }
    } else if os == "macos" {
        if has_apple_silicon {
            "python_env_mac_arm64.zip".to_string()
        } else {
            "python_env_mac_x64.zip".to_string()
        }
    } else {
        "python_env_linux.zip".to_string()
    };

    Ok(SystemProfile {
        os,
        arch,
        has_nvidia,
        has_apple_silicon,
        recommended_payload,
        gpu_name,
        gpu_vram_gb,
        nvidia_driver_version,
    })
}