use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemProfile {
    pub os: String,
    pub arch: String,
    pub has_nvidia: bool,
    pub has_apple_silicon: bool,
    pub recommended_payload: String,
}

#[tauri::command]
pub async fn get_system_profile() -> Result<SystemProfile, String> {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    
    let mut has_nvidia = false;
    let mut has_apple_silicon = false;

    if os == "windows" {
        // Query WMI for Video Controller
        if let Ok(output) = Command::new("wmic")
            .args(&["path", "win32_VideoController", "get", "name"])
            .output() {
            let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
            if stdout.contains("nvidia") {
                has_nvidia = true;
            }
        }
    } else if os == "macos" {
        if arch == "aarch64" {
            has_apple_silicon = true;
        }
    }

    // Determine the recommended python payload
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
    })
}
