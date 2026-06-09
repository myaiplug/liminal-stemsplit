use std::cmp::min;
use std::fs::File;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::time::Duration;
use futures_util::StreamExt;
use reqwest::Client;
use reqwest::header::{CONTENT_RANGE, RANGE};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Window};
use tokio::time::sleep;

#[derive(Clone, Serialize)]
struct DownloadProgress {
    url: String,
    downloaded: u64,
    total: u64,
    percentage: f64,
}

pub async fn stream_download_to_path(
    window: &Window,
    url: &str,
    destination: &Path,
    event_name: &str,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    const MAX_ATTEMPTS: u32 = 3;

    if let Some(expected) = expected_sha256 {
        if destination.exists() && verify_sha256(destination, expected)? {
            let existing_size = destination
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let _ = window.emit(
                event_name,
                DownloadProgress {
                    url: url.to_string(),
                    downloaded: existing_size,
                    total: existing_size,
                    percentage: 100.0,
                },
            );
            return Ok(());
        }
    }

    for attempt in 1..=MAX_ATTEMPTS {
        match stream_download_once(window, url, destination, event_name).await {
            Ok(()) => {
                if let Some(expected) = expected_sha256 {
                    if !verify_sha256(destination, expected)? {
                        let _ = std::fs::remove_file(destination);
                        return Err(format!("Checksum verification failed for {}", destination.display()));
                    }
                }
                return Ok(());
            }
            Err(error) => {
                if attempt == MAX_ATTEMPTS {
                    return Err(format!(
                        "Download failed after {} attempts for {}: {}",
                        MAX_ATTEMPTS,
                        url,
                        error
                    ));
                }

                let delay_secs = 1_u64 << (attempt - 1);
                sleep(Duration::from_secs(delay_secs)).await;
            }
        }
    }

    unreachable!("Download attempt loop should have returned success or error");
}

async fn stream_download_once(
    window: &Window,
    url: &str,
    destination: &Path,
    event_name: &str,
) -> Result<(), String> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("Failed to initialize download client: {error}"))?;
    let existing_size = destination
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let mut request = client.get(url).header("User-Agent", "StemSplit-Installer/1.0");
    if existing_size > 0 {
        request = request.header(RANGE, format!("bytes={existing_size}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to connect to {url}: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed for {url} with status {}",
            response.status()
        ));
    }

    let status = response.status();
    let can_resume = status == reqwest::StatusCode::PARTIAL_CONTENT;
    let total_size = if can_resume {
        response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|header| header.to_str().ok())
            .and_then(parse_total_size_from_content_range)
            .unwrap_or(existing_size + response.content_length().unwrap_or(0))
    } else {
        response.content_length().unwrap_or(0)
    };
    let mut stream = response.bytes_stream();

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create directory {}: {error}", parent.display()))?;
    }

    let mut file = if can_resume {
        std::fs::OpenOptions::new()
            .append(true)
            .open(destination)
            .map_err(|error| format!("Failed to resume file {}: {error}", destination.display()))?
    } else {
        File::create(destination)
            .map_err(|error| format!("Failed to create file {}: {error}", destination.display()))?
    };
    let mut downloaded: u64 = if can_resume { existing_size } else { 0 };
    let mut last_percentage: f64 = 0.0;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|error| format!("Error while downloading {url}: {error}"))?;
        file.write_all(&chunk)
            .map_err(|error| format!("Error while writing {}: {error}", destination.display()))?;

        downloaded = downloaded.saturating_add(chunk.len() as u64);
        let clamped_downloaded = if total_size > 0 {
            min(downloaded, total_size)
        } else {
            downloaded
        };
        let percentage = if total_size > 0 {
            (clamped_downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };

        if percentage - last_percentage >= 1.0 || (total_size > 0 && clamped_downloaded == total_size) {
            let _ = window.emit(
                event_name,
                DownloadProgress {
                    url: url.to_string(),
                    downloaded: clamped_downloaded,
                    total: total_size,
                    percentage,
                },
            );
            last_percentage = percentage;
        }
    }

    file.flush()
        .map_err(|error| format!("Failed to flush {}: {error}", destination.display()))?;

    if total_size == 0 {
        let _ = window.emit(
            event_name,
            DownloadProgress {
                url: url.to_string(),
                downloaded,
                total: downloaded,
                percentage: 100.0,
            },
        );
    }

    Ok(())
}

fn parse_total_size_from_content_range(content_range: &str) -> Option<u64> {
    content_range.split('/').nth(1)?.parse::<u64>().ok()
}

fn verify_sha256(path: &Path, expected_sha256: &str) -> Result<bool, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Failed to open {} for checksum verification: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 64];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read {} for checksum verification: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let actual = format!("{:x}", hasher.finalize());
    Ok(actual.eq_ignore_ascii_case(expected_sha256.trim()))
}

#[tauri::command]
pub async fn download_file(
    window: Window,
    url: String,
    destination: String,
    checksum: Option<String>,
) -> Result<String, String> {
    let dest_path = Path::new(&destination);
    stream_download_to_path(
        &window,
        &url,
        dest_path,
        "download-progress",
        checksum.as_deref(),
    ).await?;

    Ok(destination)
}
