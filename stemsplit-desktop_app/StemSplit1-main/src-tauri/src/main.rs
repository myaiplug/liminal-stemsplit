// Tauri Backend - Stem Split Application
// Professional stem separation with progress tracking and event emission

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod hardware;
mod downloader;

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tokio::time::{sleep, Duration};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_MAX_INPUT_MB: u64 = 500;
const MALICIOUS_UPLOAD_HOLD_HOURS: i64 = 72;
const SECURITY_WEBHOOK_RETRY_ATTEMPTS: usize = 3;
const SECURITY_WEBHOOK_RETRY_DELAY_MS: u64 = 900;

// ============================================================================
// Gumroad License System
// ============================================================================

// Your Gumroad product permalink/ID
const GUMROAD_PRODUCT_ID: &str = "rQTVqaHxdUm5urq5oJKQhw==";
const LICENSE_SOURCE_GUMROAD: &str = "gumroad";
const LICENSE_SOURCE_MANAGED_PRO: &str = "managed_pro";
const LICENSE_SOURCE_DEV_BYPASS: &str = "dev_bypass";
const LICENSE_SOURCE_REMOTE: &str = "remote_license_server";

// How often to re-verify license online (in seconds) - 7 days
const LICENSE_RECHECK_INTERVAL: i64 = 7 * 24 * 60 * 60;

fn get_dev_bypass_key() -> Option<String> {
    // Developer bypass is debug-only and must come from an explicit environment variable.
    #[cfg(debug_assertions)]
    {
        std::env::var("STEMSPLIT_DEV_BYPASS_KEY")
            .ok()
            .filter(|key| !key.trim().is_empty())
    }

    #[cfg(not(debug_assertions))]
    {
        None
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct LicenseInfo {
    pub is_valid: bool,
    pub is_trial: bool,
    pub email: Option<String>,
    pub purchase_date: Option<String>,
    pub license_key: Option<String>,
    pub features: Vec<String>,
    pub limitations: TrialLimitations,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct SupportAssetRequest {
    asset_name: String,
    download_url: String,
    relative_destination: String,
    checksum: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct SupportAssetInstallResult {
    asset_name: String,
    installed_to: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct TrialLimitations {
    pub max_duration_seconds: u32,      // 180 = 3 minutes
    pub allowed_stems: Vec<String>,     // ["vocals", "instrumental"]
    pub output_format: String,          // "mp3" only for trial
    pub engine: String,                 // "spleeter" for trial
    pub batch_allowed: bool,            // false for trial
    pub fx_allowed: bool,               // false for trial
    pub vst_allowed: bool,              // false for trial
    pub high_quality_preview: bool,     // true - show them what they're missing
    #[serde(default = "default_max_free_splits")]
    pub max_free_splits: u32,           // 1 = one free Spleeter 2-stem split total
}

fn default_max_free_splits() -> u32 {
    1
}

const FREE_TIER_MAX_SPLITS: u32 = 1;

#[derive(Clone, Serialize, Deserialize, Debug)]
struct StoredLicense {
    license_key: String,
    email: String,
    activated_at: String,
    last_verified: i64,  // Unix timestamp of last online verification
    is_valid: bool,
    #[serde(default = "default_license_source")]
    source: String,
}

fn default_license_source() -> String {
    LICENSE_SOURCE_GUMROAD.to_string()
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct ManagedProUser {
    email: String,
    password_sha256: String,
    enabled: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct ManagedProUsersDb {
    users: Vec<ManagedProUser>,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct RemoteLicenseValidationResponse {
    #[serde(default)]
    recognized: bool,
    #[serde(default)]
    valid: bool,
    email: Option<String>,
    purchase_date: Option<String>,
    plan: Option<String>,
    features: Option<Vec<String>>,
    error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct FreeUserRecord {
    username: String,
    email: String,
    password_sha256: String,
    created_at: String,
    last_login_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct FreeUsersDb {
    users: Vec<FreeUserRecord>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct FreeUserSession {
    username: String,
    email: String,
    signed_in_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct AuthProfile {
    username: String,
    email: String,
    created_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct AuthResult {
    success: bool,
    profile: Option<AuthProfile>,
    onboarding_email_sent: bool,
    message: String,
    error: Option<String>,
}

fn get_free_users_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("free_users.json")
}

fn get_free_session_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("free_session.json")
}

fn load_or_initialize_free_users_db() -> FreeUsersDb {
    let db_path = get_free_users_path();

    if let Ok(content) = std::fs::read_to_string(&db_path) {
        if let Ok(parsed) = serde_json::from_str::<FreeUsersDb>(&content) {
            return parsed;
        }
    }

    let defaults = FreeUsersDb::default();
    let _ = std::fs::write(&db_path, serde_json::to_string_pretty(&defaults).unwrap_or_else(|_| "{\"users\":[]}".to_string()));
    defaults
}

fn save_free_users_db(db: &FreeUsersDb) -> Result<(), String> {
    let db_path = get_free_users_path();
    std::fs::write(&db_path, serde_json::to_string_pretty(db).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to save free users DB: {}", e))
}

fn hash_free_user_password(email: &str, password: &str) -> String {
    let canonical = format!("{}::{}", email.trim().to_lowercase(), password);
    sha256_hex(&canonical)
}

fn normalize_username(username: &str) -> String {
    username.trim().to_string()
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn save_free_session(session: &FreeUserSession) -> Result<(), String> {
    let path = get_free_session_path();
    std::fs::write(path, serde_json::to_string_pretty(session).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to save user session: {}", e))
}

fn load_free_session() -> Option<FreeUserSession> {
    let path = get_free_session_path();
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<FreeUserSession>(&content).ok())
}

fn clear_free_session() {
    let path = get_free_session_path();
    let _ = std::fs::remove_file(path);
}

fn send_onboarding_via_server(email: &str, username: &str) -> Result<bool, String> {
    let server_url = std::env::var("STEMSPLIT_API_URL")
        .unwrap_or_else(|_| "https://liminal-stemsplit.onrender.com".to_string());

    let body = serde_json::json!({
        "email": email,
        "username": username,
    });

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(format!("{}/api/onboarding", server_url))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .map_err(|e| format!("Onboarding API call failed: {}", e))?;

    if response.status().is_success() {
        let data: serde_json::Value = response.json().unwrap_or_default();
        Ok(data.get("sent").and_then(|v| v.as_bool()).unwrap_or(false))
    } else {
        Ok(false)
    }
}

fn send_onboarding_email(email: &str, username: &str) -> Result<bool, String> {
    let resend_key = std::env::var("RESEND_API_KEY").ok().unwrap_or_default();
    let from_addr = std::env::var("STEMSPLIT_ONBOARDING_FROM").ok().unwrap_or_default();

    if resend_key.trim().is_empty() || from_addr.trim().is_empty() {
        return Ok(false);
    }

    let body = serde_json::json!({
        "from": from_addr,
        "to": [email],
        "subject": "Welcome to StemSplit",
        "html": format!(
            "<div style='font-family:Arial,sans-serif;line-height:1.5'><h2>Welcome to StemSplit, {}.</h2><p>Your free account is ready.</p><p>You can start with Spleeter 2-stem splits and upgrade anytime from inside the app.</p><p>Thanks for joining.</p></div>",
            username
        )
    });

    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", resend_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Failed to call onboarding email API: {}", e))?;

    if response.status().is_success() {
        Ok(true)
    } else {
        Err(format!("Onboarding email API returned status {}", response.status()))
    }
}

fn get_managed_pro_users_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("managed_pro_users.json")
}

fn empty_managed_pro_users_db() -> ManagedProUsersDb {
    ManagedProUsersDb { users: vec![] }
}

fn load_or_initialize_managed_pro_users_db() -> ManagedProUsersDb {
    let db_path = get_managed_pro_users_path();

    if let Ok(content) = std::fs::read_to_string(&db_path) {
        if let Ok(parsed) = serde_json::from_str::<ManagedProUsersDb>(&content) {
            return parsed;
        }
    }

    let empty = empty_managed_pro_users_db();
    let _ = std::fs::write(
        &db_path,
        serde_json::to_string_pretty(&empty).unwrap_or_else(|_| "{\"users\":[]}".to_string()),
    );
    empty
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

fn verify_managed_pro_credentials(email: &str, password: &str) -> bool {
    let normalized_email = email.trim().to_lowercase();
    let password_hash = sha256_hex(password);
    let db = load_or_initialize_managed_pro_users_db();

    db.users.iter().any(|user| {
        user.enabled
            && user.email.trim().eq_ignore_ascii_case(&normalized_email)
            && user.password_sha256 == password_hash
    })
}

fn has_managed_pro_email(email: &str) -> bool {
    let normalized_email = email.trim().to_lowercase();
    let db = load_or_initialize_managed_pro_users_db();
    db.users
        .iter()
        .any(|user| user.email.trim().eq_ignore_ascii_case(&normalized_email))
}

fn is_managed_pro_email_enabled(email: &str) -> bool {
    let normalized_email = email.trim().to_lowercase();
    let db = load_or_initialize_managed_pro_users_db();

    db.users.iter().any(|user| {
        user.enabled && user.email.trim().eq_ignore_ascii_case(&normalized_email)
    })
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct TrialUsage {
    completed_splits: u32,
    last_completed_unix: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct SecurityHold {
    blocked_until_unix: i64,
    flagged_at_unix: i64,
    malicious_attempts: u32,
    permanently_banned: bool,
    reason: String,
}

#[derive(Clone, Debug)]
struct ValidationFailure {
    message: String,
    malicious: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct SecurityIncidentReport {
    event: String,
    timestamp_utc: String,
    local_username: String,
    machine_name: String,
    license_email: Option<String>,
    attempted_file_path: String,
    reason: String,
    malicious_attempts: u32,
    blocked_until_unix: i64,
    permanently_banned: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct SecurityWebhookDispatchResult {
    success: bool,
    queued_for_retry: bool,
    message: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct TrialCooldownStatus {
    is_trial: bool,
    completed_splits: u32,
    max_free_splits: u32,
    free_splits_remaining: u32,
    free_tier_exhausted: bool,
    cooldown_active: bool,
    remaining_seconds: i64,
    current_cooldown_minutes: i64,
    next_cooldown_minutes: i64,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct GumroadVerifyResponse {
    success: bool,
    uses: Option<i32>,
    purchase: Option<GumroadPurchase>,
    message: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GumroadPurchase {
    email: Option<String>,
    created_at: Option<String>,
    refunded: Option<bool>,
    chargebacked: Option<bool>,
}

/// Get the license file path in app data directory
fn get_license_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("StemSplit");
    
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("license.json")
}

fn get_trial_usage_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("trial_usage.json")
}

fn get_security_hold_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("security_hold.json")
}

fn get_security_incident_queue_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("security_incident_queue.jsonl")
}

fn load_trial_usage() -> TrialUsage {
    let usage_path = get_trial_usage_path();
    if !usage_path.exists() {
        return TrialUsage::default();
    }

    std::fs::read_to_string(&usage_path)
        .ok()
        .and_then(|content| serde_json::from_str::<TrialUsage>(&content).ok())
        .unwrap_or_default()
}

fn save_trial_usage(usage: &TrialUsage) {
    let usage_path = get_trial_usage_path();
    if let Ok(content) = serde_json::to_string_pretty(usage) {
        let _ = std::fs::write(usage_path, content);
    }
}

fn enforce_trial_free_allowance() -> Result<(), String> {
    let usage = load_trial_usage();
    if usage.completed_splits >= FREE_TIER_MAX_SPLITS {
        return Err(
            "Your free Spleeter 2-stem split has been used. Upgrade to Pro for unlimited Demucs, MDX, batch processing, and more.".into(),
        );
    }
    Ok(())
}

fn free_splits_remaining(completed_splits: u32) -> u32 {
    FREE_TIER_MAX_SPLITS.saturating_sub(completed_splits)
}

fn register_trial_split_completion() {
    let mut usage = load_trial_usage();
    usage.completed_splits = usage.completed_splits.saturating_add(1);
    usage.last_completed_unix = chrono::Utc::now().timestamp();
    save_trial_usage(&usage);
}

fn load_security_hold() -> SecurityHold {
    let hold_path = get_security_hold_path();
    if !hold_path.exists() {
        return SecurityHold::default();
    }

    std::fs::read_to_string(&hold_path)
        .ok()
        .and_then(|content| serde_json::from_str::<SecurityHold>(&content).ok())
        .unwrap_or_default()
}

fn save_security_hold(hold: &SecurityHold) {
    let hold_path = get_security_hold_path();
    if let Ok(content) = serde_json::to_string_pretty(hold) {
        let _ = std::fs::write(hold_path, content);
    }
}

fn security_reopen_unix(hold: &SecurityHold) -> i64 {
    if hold.permanently_banned {
        return i64::MAX;
    }

    if hold.blocked_until_unix <= 0 || hold.flagged_at_unix <= 0 {
        return 0;
    }

    let penalty = hold.blocked_until_unix.saturating_sub(hold.flagged_at_unix);
    hold.flagged_at_unix.saturating_add(penalty / 2)
}

fn should_hide_window_for_security(hold: &SecurityHold, now_unix: i64) -> bool {
    let reopen_unix = security_reopen_unix(hold);
    if reopen_unix <= 0 {
        return false;
    }
    now_unix < reopen_unix
}

fn enforce_window_security_policy(app: &tauri::AppHandle) {
    let hold = load_security_hold();
    let now = chrono::Utc::now().timestamp();
    if !should_hide_window_for_security(&hold, now) {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(true);
        let _ = window.hide();
    }
}

fn enforce_security_hold_if_active() -> Result<(), String> {
    let hold = load_security_hold();
    if hold.permanently_banned {
        return Err(format!(
            "Security ban active pending manual review. Reason: {}",
            if hold.reason.is_empty() { "repeated suspicious uploads detected" } else { &hold.reason }
        ));
    }

    if hold.blocked_until_unix <= 0 {
        return Ok(());
    }

    let now = chrono::Utc::now().timestamp();
    if now >= hold.blocked_until_unix {
        return Ok(());
    }

    let remaining_seconds = hold.blocked_until_unix - now;
    let remaining_hours = (remaining_seconds + 3599) / 3600;
    Err(format!(
        "Security hold active for {} more hour(s) pending review. Reason: {}",
        remaining_hours,
        if hold.reason.is_empty() { "suspicious upload detected" } else { &hold.reason }
    ))
}

fn register_malicious_attempt(reason: &str) -> (String, SecurityHold) {
    let mut hold = load_security_hold();
    let now = chrono::Utc::now().timestamp();
    hold.malicious_attempts = hold.malicious_attempts.saturating_add(1);
    hold.flagged_at_unix = now;
    hold.reason = reason.to_string();

    let message = if hold.malicious_attempts >= 3 {
        hold.permanently_banned = true;
        hold.blocked_until_unix = i64::MAX;
        "Security policy violation: third suspicious upload detected. Access permanently banned pending manual review.".to_string()
    } else if hold.malicious_attempts == 2 {
        hold.permanently_banned = false;
        hold.blocked_until_unix = now + (MALICIOUS_UPLOAD_HOLD_HOURS * 60 * 60);
        "Security policy violation: second suspicious upload detected. A 72-hour security hold has been activated pending review.".to_string()
    } else {
        hold.permanently_banned = false;
        hold.blocked_until_unix = 0;
        "Suspicious upload detected and logged. One more malicious attempt will trigger a 72-hour lock pending review.".to_string()
    };

    save_security_hold(&hold);
    (format!("{} Reason: {}", message, reason), hold)
}

fn get_local_username() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn get_machine_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

fn get_stored_license_email() -> Option<String> {
    let license_path = get_license_path();
    std::fs::read_to_string(license_path)
        .ok()
        .and_then(|content| serde_json::from_str::<StoredLicense>(&content).ok())
        .map(|stored| stored.email)
}

async fn send_security_incident_report(report: &SecurityIncidentReport) {
    let _ = deliver_security_incident_report(report, true).await;
}

fn get_security_webhook_secret() -> Option<String> {
    std::env::var("STEMSPLIT_SECURITY_WEBHOOK_SECRET")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_security_webhook_signature(secret: &str, payload: &str) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("failed to initialize webhook signature: {}", e))?;
    mac.update(payload.as_bytes());
    let bytes = mac.finalize().into_bytes();

    let mut hex = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        hex.push_str(&format!("{:02x}", byte));
    }
    Ok(hex)
}

fn queue_security_incident_report(report: &SecurityIncidentReport) -> bool {
    let queue_path = get_security_incident_queue_path();
    let serialized = match serde_json::to_string(report) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let mut file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(queue_path)
    {
        Ok(file) => file,
        Err(_) => return false,
    };

    writeln!(file, "{}", serialized).is_ok()
}

async fn post_security_incident_report(
    client: &reqwest::Client,
    webhook_url: &str,
    report: &SecurityIncidentReport,
    payload: &str,
    signature: Option<&str>,
) -> Result<(), String> {
    let mut request = client
        .post(webhook_url)
        .header("Content-Type", "application/json")
        .header("X-StemSplit-Event", &report.event)
        .header("X-StemSplit-Timestamp", &report.timestamp_utc);

    if let Some(signature) = signature {
        request = request
            .header("X-StemSplit-Signature", signature)
            .header("X-StemSplit-Signature-Alg", "hmac-sha256");
    }

    let response = request
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("webhook request failed: {}", e))?;

    if response.status().is_success() {
        return Ok(());
    }

    Err(format!(
        "webhook returned non-success status: {}",
        response.status()
    ))
}

async fn deliver_security_incident_report(
    report: &SecurityIncidentReport,
    queue_on_failure: bool,
) -> SecurityWebhookDispatchResult {
    let webhook_url = match std::env::var("STEMSPLIT_SECURITY_WEBHOOK_URL") {
        Ok(url) if !url.trim().is_empty() => url,
        _ => {
            return SecurityWebhookDispatchResult {
                success: false,
                queued_for_retry: false,
                message: "STEMSPLIT_SECURITY_WEBHOOK_URL is not configured".to_string(),
            }
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return SecurityWebhookDispatchResult {
                success: false,
                queued_for_retry: false,
                message: format!("failed to initialize webhook HTTP client: {}", e),
            }
        }
    };

    let payload = match serde_json::to_string(report) {
        Ok(payload) => payload,
        Err(e) => {
            return SecurityWebhookDispatchResult {
                success: false,
                queued_for_retry: false,
                message: format!("failed to serialize security incident report: {}", e),
            }
        }
    };

    let signature = get_security_webhook_secret()
        .map(|secret| build_security_webhook_signature(&secret, &payload))
        .transpose()
        .map_err(|e| SecurityWebhookDispatchResult {
            success: false,
            queued_for_retry: false,
            message: e,
        });
    let signature = match signature {
        Ok(value) => value,
        Err(result) => return result,
    };

    let mut last_error = String::new();
    for attempt in 1..=SECURITY_WEBHOOK_RETRY_ATTEMPTS {
        match post_security_incident_report(&client, &webhook_url, report, &payload, signature.as_deref()).await {
            Ok(_) => {
                return SecurityWebhookDispatchResult {
                    success: true,
                    queued_for_retry: false,
                    message: format!("incident report delivered on attempt {}", attempt),
                }
            }
            Err(err) => {
                last_error = err;
                if attempt < SECURITY_WEBHOOK_RETRY_ATTEMPTS {
                    sleep(Duration::from_millis(SECURITY_WEBHOOK_RETRY_DELAY_MS)).await;
                }
            }
        }
    }

    if !queue_on_failure {
        return SecurityWebhookDispatchResult {
            success: false,
            queued_for_retry: false,
            message: format!(
                "webhook delivery failed after retries (not re-queued during flush). Last error: {}",
                last_error
            ),
        };
    }

    let queued = queue_security_incident_report(report);
    SecurityWebhookDispatchResult {
        success: false,
        queued_for_retry: queued,
        message: if queued {
            format!(
                "webhook delivery failed after retries; incident queued for retry. Last error: {}",
                last_error
            )
        } else {
            format!(
                "webhook delivery failed and queue write failed. Last error: {}",
                last_error
            )
        },
    }
}

async fn flush_queued_security_incidents() {
    let queue_path = get_security_incident_queue_path();
    if !queue_path.exists() {
        return;
    }

    let content = match std::fs::read_to_string(&queue_path) {
        Ok(content) => content,
        Err(_) => return,
    };

    let mut pending_reports: Vec<SecurityIncidentReport> = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        if let Ok(report) = serde_json::from_str::<SecurityIncidentReport>(line) {
            pending_reports.push(report);
        }
    }

    if pending_reports.is_empty() {
        let _ = std::fs::remove_file(queue_path);
        return;
    }

    let mut failed_reports: Vec<SecurityIncidentReport> = Vec::new();
    for report in pending_reports {
        let result = deliver_security_incident_report(&report, false).await;
        if !result.success {
            failed_reports.push(report);
        }
    }

    if failed_reports.is_empty() {
        let _ = std::fs::remove_file(queue_path);
        return;
    }

    let mut rewrite = String::new();
    for report in failed_reports {
        if let Ok(serialized) = serde_json::to_string(&report) {
            rewrite.push_str(&serialized);
            rewrite.push('\n');
        }
    }
    let _ = std::fs::write(queue_path, rewrite);
}

fn max_input_file_bytes() -> u64 {
    let max_mb = std::env::var("STEMSPLIT_MAX_INPUT_MB")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_INPUT_MB);

    max_mb.saturating_mul(1024 * 1024)
}

fn is_likely_audio_signature(header: &[u8]) -> bool {
    if header.len() >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WAVE" {
        return true;
    }
    if header.starts_with(b"fLaC") {
        return true;
    }
    if header.starts_with(b"OggS") {
        return true;
    }
    if header.starts_with(b"ID3") {
        return true;
    }
    if header.len() >= 2 && header[0] == 0xFF && (header[1] & 0xE0) == 0xE0 {
        return true;
    }
    if header.len() >= 8 && &header[4..8] == b"ftyp" {
        return true;
    }

    false
}

fn validate_input_audio_file(file_path: &str) -> Result<(), ValidationFailure> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(ValidationFailure {
            message: format!("Input file not found: {}", file_path),
            malicious: false,
        });
    }

    let metadata = std::fs::metadata(path)
        .map_err(|e| ValidationFailure {
            message: format!("Unable to inspect input file metadata: {}", e),
            malicious: true,
        })?;
    if !metadata.is_file() {
        return Err(ValidationFailure {
            message: "Input must be a regular file".to_string(),
            malicious: true,
        });
    }

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    let allowed_extensions = ["wav", "mp3", "flac", "ogg", "m4a"];
    if !allowed_extensions.contains(&extension.as_str()) {
        return Err(ValidationFailure {
            message: "Unsupported input format. Allowed: wav, mp3, flac, ogg, m4a".to_string(),
            malicious: false,
        });
    }

    let size_bytes = metadata.len();
    if size_bytes == 0 {
        return Err(ValidationFailure {
            message: "Input file is empty".to_string(),
            malicious: false,
        });
    }

    let max_bytes = max_input_file_bytes();
    if size_bytes > max_bytes {
        let size_mb = size_bytes / (1024 * 1024);
        let max_mb = max_bytes / (1024 * 1024);
        return Err(ValidationFailure {
            message: format!(
                "Input file too large: {} MB (max allowed {} MB)",
                size_mb, max_mb
            ),
            malicious: false,
        });
    }

    let mut file = std::fs::File::open(path)
        .map_err(|e| ValidationFailure {
            message: format!("Unable to open input file for validation: {}", e),
            malicious: true,
        })?;
    let mut header = [0_u8; 16];
    let read = file
        .read(&mut header)
        .map_err(|e| ValidationFailure {
            message: format!("Unable to read input file header: {}", e),
            malicious: true,
        })?;

    if read < 4 || !is_likely_audio_signature(&header[..read]) {
        return Err(ValidationFailure {
            message: "Suspicious upload detected: file signature does not match a supported audio format".to_string(),
            malicious: true,
        });
    }

    Ok(())
}

#[tauri::command]
fn get_trial_cooldown_status() -> TrialCooldownStatus {
    let license = get_license_status();
    let usage = load_trial_usage();
    let remaining = free_splits_remaining(usage.completed_splits);
    let exhausted = license.is_trial && remaining == 0;

    TrialCooldownStatus {
        is_trial: license.is_trial,
        completed_splits: usage.completed_splits,
        max_free_splits: FREE_TIER_MAX_SPLITS,
        free_splits_remaining: if license.is_trial { remaining } else { FREE_TIER_MAX_SPLITS },
        free_tier_exhausted: exhausted,
        cooldown_active: false,
        remaining_seconds: 0,
        current_cooldown_minutes: 0,
        next_cooldown_minutes: 0,
    }
}

#[tauri::command]
async fn test_security_webhook() -> Result<SecurityWebhookDispatchResult, String> {
    let report = SecurityIncidentReport {
        event: "security_webhook_test".to_string(),
        timestamp_utc: chrono::Utc::now().to_rfc3339(),
        local_username: get_local_username(),
        machine_name: get_machine_name(),
        license_email: get_stored_license_email(),
        attempted_file_path: "(manual-test)".to_string(),
        reason: "Manual webhook test triggered from StemSplit backend".to_string(),
        malicious_attempts: 0,
        blocked_until_unix: 0,
        permanently_banned: false,
    };

    let result = deliver_security_incident_report(&report, true).await;
    if result.success || result.queued_for_retry {
        Ok(result)
    } else {
        Err(result.message)
    }
}

/// Get trial limitations (free tier)
fn get_trial_limitations() -> TrialLimitations {
    TrialLimitations {
        max_duration_seconds: 180,  // 3 minutes max
        allowed_stems: vec!["vocals".into(), "instrumental".into()],  // 2-stem only
        output_format: "mp3".into(),  // MP3 only, no WAV
        engine: "spleeter".into(),    // Spleeter only (fastest, lower quality)
        batch_allowed: false,
        fx_allowed: false,
        vst_allowed: false,
        high_quality_preview: true,   // Let them hear the difference!
        max_free_splits: FREE_TIER_MAX_SPLITS,
    }
}

/// Get full license features (paid tier)
fn get_full_features() -> Vec<String> {
    vec![
        "Unlimited audio duration".into(),
        "All stem types (vocals, drums, bass, other, piano, guitar)".into(),
        "High-quality WAV output".into(),
        "All AI engines (Demucs, MDX23, UVR, Drumsep)".into(),
        "Batch processing".into(),
        "Pro FX Rack".into(),
        "VST plugin hosting".into(),
        "6-stem separation".into(),
    ]
}

/// Get trial features
fn get_trial_features() -> Vec<String> {
    vec![
        "1 free Spleeter 2-stem split".into(),
        "2-stem separation (vocals + instrumental)".into(),
        "Files under 3 minutes".into(),
        "MP3 output only".into(),
        "Spleeter engine only".into(),
        "Single file processing".into(),
    ]
}

/// No limitations for paid users
fn get_no_limitations() -> TrialLimitations {
    TrialLimitations {
        max_duration_seconds: 0,  // 0 = unlimited
        allowed_stems: vec![],    // empty = all allowed
        output_format: "any".into(),
        engine: "any".into(),
        batch_allowed: true,
        fx_allowed: true,
        vst_allowed: true,
        high_quality_preview: true,
        max_free_splits: 0,
    }
}

/// Verify license with Gumroad API
fn verify_with_gumroad(license_key: &str) -> Result<(bool, Option<String>, Option<String>), String> {
    let client = reqwest::blocking::Client::new();
    
    let response = client
        .post("https://api.gumroad.com/v2/licenses/verify")
        .form(&[
            ("product_id", GUMROAD_PRODUCT_ID),
            ("license_key", license_key),
            ("increment_uses_count", "false"),  // Don't increment on every check
        ])
        .send()
        .map_err(|e| format!("Network error: {}", e))?;
    
    let gumroad_response: GumroadVerifyResponse = response
        .json()
        .map_err(|e| format!("Invalid response: {}", e))?;
    
    if !gumroad_response.success {
        return Err(gumroad_response.message.unwrap_or("License verification failed".into()));
    }
    
    if let Some(purchase) = gumroad_response.purchase {
        // Check if refunded or chargebacked
        if purchase.refunded.unwrap_or(false) {
            return Err("This license has been refunded".into());
        }
        if purchase.chargebacked.unwrap_or(false) {
            return Err("This license has been chargebacked".into());
        }
        
        Ok((true, purchase.email, purchase.created_at))
    } else {
        Err("Invalid license key".into())
    }
}

fn get_license_server_validate_url() -> Option<String> {
    let configured = std::env::var("STEMSPLIT_LICENSE_SERVER_URL")
        .ok()
        .or_else(|| std::env::var("NEXT_PUBLIC_LICENSE_API_URL").ok())
        .or_else(|| Some(env!("STEMSPLIT_LICENSE_SERVER_URL").to_string()))
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())?;

    if configured.ends_with("/api/licenses/validate") {
        Some(configured)
    } else {
        Some(format!("{}/api/licenses/validate", configured))
    }
}

fn verify_with_remote_license_server(
    license_key: &str,
    email: &str,
) -> Result<Option<RemoteLicenseValidationResponse>, String> {
    let Some(url) = get_license_server_validate_url() else {
        return Ok(None);
    };

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(url)
        .json(&serde_json::json!({
            "email": email,
            "licenseKey": license_key,
        }))
        .send()
        .map_err(|e| format!("Remote license server error: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Remote license server returned status {}", response.status()));
    }

    let payload = response
        .json::<RemoteLicenseValidationResponse>()
        .map_err(|e| format!("Remote license server response invalid: {}", e))?;

    Ok(Some(payload))
}

#[tauri::command]
fn get_license_status() -> LicenseInfo {
    let license_path = get_license_path();
    
    // Check if license file exists
    if !license_path.exists() {
        return LicenseInfo {
            is_valid: false,
            is_trial: true,
            email: None,
            purchase_date: None,
            license_key: None,
            features: get_trial_features(),
            limitations: get_trial_limitations(),
            error: None,
        };
    }
    
    // Read stored license
    let stored: StoredLicense = match std::fs::read_to_string(&license_path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(license) => license,
            Err(_) => return LicenseInfo {
                is_valid: false,
                is_trial: true,
                email: None,
                purchase_date: None,
                license_key: None,
                features: get_trial_features(),
                limitations: get_trial_limitations(),
                error: Some("Failed to parse stored license".into()),
            },
        },
        Err(_) => return LicenseInfo {
            is_valid: false,
            is_trial: true,
            email: None,
            purchase_date: None,
            license_key: None,
            features: get_trial_features(),
            limitations: get_trial_limitations(),
            error: None,
        },
    };
    
    let now = chrono::Utc::now().timestamp();
    let needs_reverify = (now - stored.last_verified) > LICENSE_RECHECK_INTERVAL;

    if stored.source == LICENSE_SOURCE_REMOTE {
        if needs_reverify {
            match verify_with_remote_license_server(&stored.license_key, &stored.email) {
                Ok(Some(remote)) if remote.valid => {
                    let updated = StoredLicense {
                        license_key: stored.license_key.clone(),
                        email: remote.email.clone().unwrap_or_else(|| stored.email.clone()),
                        activated_at: remote.purchase_date.clone().unwrap_or_else(|| stored.activated_at.clone()),
                        last_verified: now,
                        is_valid: true,
                        source: LICENSE_SOURCE_REMOTE.to_string(),
                    };
                    let _ = std::fs::write(&license_path, serde_json::to_string_pretty(&updated).unwrap());

                    return LicenseInfo {
                        is_valid: true,
                        is_trial: false,
                        email: Some(updated.email),
                        purchase_date: Some(updated.activated_at),
                        license_key: Some("REMOTE-****-ACCESS".into()),
                        features: remote.features.unwrap_or_else(get_full_features),
                        limitations: get_no_limitations(),
                        error: None,
                    };
                }
                Ok(Some(remote)) => {
                    return LicenseInfo {
                        is_valid: false,
                        is_trial: true,
                        email: Some(stored.email),
                        purchase_date: None,
                        license_key: None,
                        features: get_trial_features(),
                        limitations: get_trial_limitations(),
                        error: Some(remote.error.unwrap_or_else(|| "Remote access credential rejected".into())),
                    };
                }
                Ok(None) | Err(_) => {
                    let grace_period = 30 * 24 * 60 * 60;
                    if (now - stored.last_verified) < grace_period && stored.is_valid {
                        return LicenseInfo {
                            is_valid: true,
                            is_trial: false,
                            email: Some(stored.email),
                            purchase_date: Some(stored.activated_at),
                            license_key: Some("REMOTE-****-ACCESS".into()),
                            features: get_full_features(),
                            limitations: get_no_limitations(),
                            error: Some("Remote license server unavailable, using cached access".into()),
                        };
                    }
                }
            }
        }

        if stored.is_valid {
            return LicenseInfo {
                is_valid: true,
                is_trial: false,
                email: Some(stored.email),
                purchase_date: Some(stored.activated_at),
                license_key: Some("REMOTE-****-ACCESS".into()),
                features: get_full_features(),
                limitations: get_no_limitations(),
                error: None,
            };
        }
    }

    if stored.source == LICENSE_SOURCE_MANAGED_PRO {
        if stored.is_valid && is_managed_pro_email_enabled(&stored.email) {
            return LicenseInfo {
                is_valid: true,
                is_trial: false,
                email: Some(stored.email),
                purchase_date: Some(stored.activated_at),
                license_key: Some("MANAGED-****-PRO".into()),
                features: get_full_features(),
                limitations: get_no_limitations(),
                error: None,
            };
        }

        return LicenseInfo {
            is_valid: false,
            is_trial: true,
            email: Some(stored.email),
            purchase_date: None,
            license_key: None,
            features: get_trial_features(),
            limitations: get_trial_limitations(),
            error: Some("Managed Pro access has been disabled for this account".into()),
        };
    }

    if stored.source == LICENSE_SOURCE_DEV_BYPASS && stored.is_valid {
        return LicenseInfo {
            is_valid: true,
            is_trial: false,
            email: Some(stored.email),
            purchase_date: Some(stored.activated_at),
            license_key: Some("DEV-****-ACCESS".into()),
            features: get_full_features(),
            limitations: get_no_limitations(),
            error: None,
        };
    }
    
    // If we need to re-verify online
    if needs_reverify {
        match verify_with_gumroad(&stored.license_key) {
            Ok((valid, email, _)) => {
                if valid {
                    // Update last verified time
                    let updated = StoredLicense {
                        license_key: stored.license_key.clone(),
                        email: email.clone().unwrap_or(stored.email.clone()),
                        activated_at: stored.activated_at.clone(),
                        last_verified: now,
                        is_valid: true,
                        source: LICENSE_SOURCE_GUMROAD.to_string(),
                    };
                    let _ = std::fs::write(&license_path, serde_json::to_string_pretty(&updated).unwrap());
                    
                    return LicenseInfo {
                        is_valid: true,
                        is_trial: false,
                        email: email.or(Some(stored.email)),
                        purchase_date: Some(stored.activated_at),
                        license_key: Some(mask_license_key(&stored.license_key)),
                        features: get_full_features(),
                        limitations: get_no_limitations(),
                        error: None,
                    };
                }
            }
            Err(e) => {
                // If offline, use cached result if still within grace period (30 days)
                let grace_period = 30 * 24 * 60 * 60;
                if (now - stored.last_verified) < grace_period && stored.is_valid {
                    return LicenseInfo {
                        is_valid: true,
                        is_trial: false,
                        email: Some(stored.email),
                        purchase_date: Some(stored.activated_at),
                        license_key: Some(mask_license_key(&stored.license_key)),
                        features: get_full_features(),
                        limitations: get_no_limitations(),
                        error: Some(format!("Offline mode - last verified {} days ago", (now - stored.last_verified) / 86400)),
                    };
                }
                
                // Grace period expired, revert to trial
                return LicenseInfo {
                    is_valid: false,
                    is_trial: true,
                    email: Some(stored.email),
                    purchase_date: None,
                    license_key: None,
                    features: get_trial_features(),
                    limitations: get_trial_limitations(),
                    error: Some(e),
                };
            }
        }
    }
    
    // Use cached valid license
    if stored.is_valid {
        return LicenseInfo {
            is_valid: true,
            is_trial: false,
            email: Some(stored.email),
            purchase_date: Some(stored.activated_at),
            license_key: Some(mask_license_key(&stored.license_key)),
            features: get_full_features(),
            limitations: get_no_limitations(),
            error: None,
        };
    }
    
    // Fallback to trial
    LicenseInfo {
        is_valid: false,
        is_trial: true,
        email: None,
        purchase_date: None,
        license_key: None,
        features: get_trial_features(),
        limitations: get_trial_limitations(),
        error: None,
    }
}

/// Mask license key for display (show only first and last 4 chars)
fn mask_license_key(key: &str) -> String {
    if key.len() <= 8 {
        return "****".into();
    }
    format!("{}...{}", &key[..4], &key[key.len()-4..])
}

#[tauri::command]
fn activate_license(license_key: String, email: String) -> LicenseInfo {
    // Normalize email for comparison
    let email_normalized = email.trim().to_lowercase();
    
    if email_normalized.is_empty() {
        return LicenseInfo {
            is_valid: false,
            is_trial: true,
            email: None,
            purchase_date: None,
            license_key: None,
            features: get_trial_features(),
            limitations: get_trial_limitations(),
            error: Some("Email address is required".into()),
        };
    }
    
    // Developer bypass is only available in debug builds when explicitly configured.
    if get_dev_bypass_key()
        .as_ref()
        .map(|bypass| bypass == &license_key)
        .unwrap_or(false)
    {
        let now = chrono::Utc::now();
        let stored = StoredLicense {
            license_key: license_key.clone(),
            email: email_normalized.clone(),
            activated_at: now.to_rfc3339(),
            last_verified: now.timestamp() + (365 * 24 * 60 * 60), // Valid for 1 year
            is_valid: true,
            source: LICENSE_SOURCE_DEV_BYPASS.to_string(),
        };
        
        let license_path = get_license_path();
        let _ = std::fs::write(&license_path, serde_json::to_string_pretty(&stored).unwrap());
        
        return LicenseInfo {
            is_valid: true,
            is_trial: false,
            email: Some(email_normalized),
            purchase_date: Some(stored.activated_at),
            license_key: Some("DEV-****-ACCESS".into()),
            features: get_full_features(),
            limitations: get_no_limitations(),
            error: None,
        };
    }

    if verify_managed_pro_credentials(&email_normalized, &license_key) {
        let now = chrono::Utc::now();
        let stored = StoredLicense {
            license_key: "MANAGED-PRO-AUTH".to_string(),
            email: email_normalized.clone(),
            activated_at: now.to_rfc3339(),
            last_verified: now.timestamp(),
            is_valid: true,
            source: LICENSE_SOURCE_MANAGED_PRO.to_string(),
        };

        let license_path = get_license_path();
        if let Err(e) = std::fs::write(&license_path, serde_json::to_string_pretty(&stored).unwrap()) {
            return LicenseInfo {
                is_valid: false,
                is_trial: true,
                email: Some(email_normalized),
                purchase_date: None,
                license_key: None,
                features: get_trial_features(),
                limitations: get_trial_limitations(),
                error: Some(format!("Failed to save managed Pro license: {}", e)),
            };
        }

        return LicenseInfo {
            is_valid: true,
            is_trial: false,
            email: Some(email_normalized),
            purchase_date: Some(stored.activated_at),
            license_key: Some("MANAGED-****-PRO".into()),
            features: get_full_features(),
            limitations: get_no_limitations(),
            error: None,
        };
    }

    match verify_with_remote_license_server(&license_key, &email_normalized) {
        Ok(Some(remote)) if remote.valid => {
            let now = chrono::Utc::now();
            let stored = StoredLicense {
                license_key: license_key.clone(),
                email: remote.email.clone().unwrap_or_else(|| email_normalized.clone()),
                activated_at: remote.purchase_date.clone().unwrap_or_else(|| now.to_rfc3339()),
                last_verified: now.timestamp(),
                is_valid: true,
                source: LICENSE_SOURCE_REMOTE.to_string(),
            };

            let license_path = get_license_path();
            if let Err(e) = std::fs::write(&license_path, serde_json::to_string_pretty(&stored).unwrap()) {
                return LicenseInfo {
                    is_valid: false,
                    is_trial: true,
                    email: Some(email_normalized),
                    purchase_date: None,
                    license_key: None,
                    features: get_trial_features(),
                    limitations: get_trial_limitations(),
                    error: Some(format!("Failed to save remote license: {}", e)),
                };
            }

            return LicenseInfo {
                is_valid: true,
                is_trial: false,
                email: Some(stored.email),
                purchase_date: Some(stored.activated_at),
                license_key: Some("REMOTE-****-ACCESS".into()),
                features: remote.features.unwrap_or_else(get_full_features),
                limitations: get_no_limitations(),
                error: None,
            };
        }
        Ok(Some(remote)) if remote.recognized => {
            return LicenseInfo {
                is_valid: false,
                is_trial: true,
                email: Some(email_normalized),
                purchase_date: None,
                license_key: None,
                features: get_trial_features(),
                limitations: get_trial_limitations(),
                error: Some(remote.error.unwrap_or_else(|| "Remote access credential rejected".into())),
            };
        }
        _ => {}
    }

    if has_managed_pro_email(&email_normalized) {
        return LicenseInfo {
            is_valid: false,
            is_trial: true,
            email: Some(email_normalized),
            purchase_date: None,
            license_key: None,
            features: get_trial_features(),
            limitations: get_trial_limitations(),
            error: Some("Managed Pro credentials are invalid for this account".into()),
        };
    }
    
    // Verify with Gumroad
    match verify_with_gumroad(&license_key) {
        Ok((valid, gumroad_email, created_at)) => {
            if !valid {
                return LicenseInfo {
                    is_valid: false,
                    is_trial: true,
                    email: None,
                    purchase_date: None,
                    license_key: None,
                    features: get_trial_features(),
                    limitations: get_trial_limitations(),
                    error: Some("Invalid license key".into()),
                };
            }
            
            // Verify email matches the Gumroad purchase email
            let gumroad_email_normalized = gumroad_email
                .as_ref()
                .map(|e| e.trim().to_lowercase())
                .unwrap_or_default();
            
            if gumroad_email_normalized.is_empty() {
                return LicenseInfo {
                    is_valid: false,
                    is_trial: true,
                    email: Some(email),
                    purchase_date: None,
                    license_key: None,
                    features: get_trial_features(),
                    limitations: get_trial_limitations(),
                    error: Some("Could not verify purchase email - please contact support".into()),
                };
            }
            
            if email_normalized != gumroad_email_normalized {
                return LicenseInfo {
                    is_valid: false,
                    is_trial: true,
                    email: Some(email),
                    purchase_date: None,
                    license_key: None,
                    features: get_trial_features(),
                    limitations: get_trial_limitations(),
                    error: Some("Email does not match purchase email. Please use the email you used to purchase on Gumroad.".into()),
                };
            }
            
            let now = chrono::Utc::now();
            
            // Save the license
            let stored = StoredLicense {
                license_key: license_key.clone(),
                email: email_normalized.clone(),
                activated_at: created_at.unwrap_or_else(|| now.to_rfc3339()),
                last_verified: now.timestamp(),
                is_valid: true,
                source: LICENSE_SOURCE_GUMROAD.to_string(),
            };
            
            let license_path = get_license_path();
            if let Err(e) = std::fs::write(&license_path, serde_json::to_string_pretty(&stored).unwrap()) {
                return LicenseInfo {
                    is_valid: false,
                    is_trial: true,
                    email: Some(email_normalized),
                    purchase_date: None,
                    license_key: None,
                    features: get_trial_features(),
                    limitations: get_trial_limitations(),
                    error: Some(format!("Failed to save license: {}", e)),
                };
            }
            
            LicenseInfo {
                is_valid: true,
                is_trial: false,
                email: Some(email_normalized),
                purchase_date: Some(stored.activated_at),
                license_key: Some(mask_license_key(&license_key)),
                features: get_full_features(),
                limitations: get_no_limitations(),
                error: None,
            }
        }
        Err(e) => LicenseInfo {
            is_valid: false,
            is_trial: true,
            email: Some(email),
            purchase_date: None,
            license_key: None,
            features: get_trial_features(),
            limitations: get_trial_limitations(),
            error: Some(e),
        },
    }
}

#[tauri::command]
fn deactivate_license() -> LicenseInfo {
    let license_path = get_license_path();
    std::fs::remove_file(&license_path).ok();
    
    LicenseInfo {
        is_valid: false,
        is_trial: true,
        email: None,
        purchase_date: None,
        license_key: None,
        features: get_trial_features(),
        limitations: get_trial_limitations(),
        error: None,
    }
}

#[tauri::command]
fn register_free_user(username: String, email: String, password: String) -> AuthResult {
    let username_norm = normalize_username(&username);
    let email_norm = normalize_email(&email);

    if username_norm.len() < 3 {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some("Username must be at least 3 characters".into()),
        };
    }
    if !email_norm.contains('@') || !email_norm.contains('.') {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some("A valid email address is required".into()),
        };
    }
    if password.len() < 8 {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some("Password must be at least 8 characters".into()),
        };
    }

    let mut db = load_or_initialize_free_users_db();
    if db.users.iter().any(|u| u.email.eq_ignore_ascii_case(&email_norm)) {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some("That email is already registered".into()),
        };
    }
    if db.users.iter().any(|u| u.username.eq_ignore_ascii_case(&username_norm)) {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some("That username is already taken".into()),
        };
    }

    let now = chrono::Utc::now().to_rfc3339();
    let record = FreeUserRecord {
        username: username_norm.clone(),
        email: email_norm.clone(),
        password_sha256: hash_free_user_password(&email_norm, &password),
        created_at: now.clone(),
        last_login_at: now.clone(),
    };
    db.users.push(record);

    if let Err(e) = save_free_users_db(&db) {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some(e),
        };
    }

    let session = FreeUserSession {
        username: username_norm.clone(),
        email: email_norm.clone(),
        signed_in_at: now.clone(),
    };
    if let Err(e) = save_free_session(&session) {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Signup failed".into(),
            error: Some(e),
        };
    }

    let onboarding_sent = send_onboarding_via_server(&email_norm, &username_norm).unwrap_or(false);

    AuthResult {
        success: true,
        profile: Some(AuthProfile {
            username: username_norm,
            email: email_norm,
            created_at: Some(now),
        }),
        onboarding_email_sent: onboarding_sent,
        message: if onboarding_sent {
            "Free account created. Onboarding email sent.".into()
        } else {
            "Free account created.".into()
        },
        error: None,
    }
}

#[tauri::command]
fn login_free_user(identifier: String, password: String) -> AuthResult {
    let identifier_norm = identifier.trim().to_lowercase();
    let mut db = load_or_initialize_free_users_db();

    let user_index = db.users.iter().position(|u| {
        u.email.eq_ignore_ascii_case(&identifier_norm)
            || u.username.eq_ignore_ascii_case(&identifier_norm)
    });

    let Some(index) = user_index else {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Login failed".into(),
            error: Some("No user found with that email or username".into()),
        };
    };

    let user = db.users.get(index).cloned().unwrap();
    let hashed = hash_free_user_password(&user.email, &password);
    if hashed != user.password_sha256 {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Login failed".into(),
            error: Some("Invalid password".into()),
        };
    }

    let now = chrono::Utc::now().to_rfc3339();
    if let Some(existing) = db.users.get_mut(index) {
        existing.last_login_at = now.clone();
    }
    let _ = save_free_users_db(&db);

    let session = FreeUserSession {
        username: user.username.clone(),
        email: user.email.clone(),
        signed_in_at: now.clone(),
    };
    if let Err(e) = save_free_session(&session) {
        return AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "Login failed".into(),
            error: Some(e),
        };
    }

    AuthResult {
        success: true,
        profile: Some(AuthProfile {
            username: user.username,
            email: user.email,
            created_at: Some(user.created_at),
        }),
        onboarding_email_sent: false,
        message: "Login successful".into(),
        error: None,
    }
}

#[tauri::command]
fn get_free_user_session() -> AuthResult {
    if let Some(session) = load_free_session() {
        AuthResult {
            success: true,
            profile: Some(AuthProfile {
                username: session.username,
                email: session.email,
                created_at: None,
            }),
            onboarding_email_sent: false,
            message: "Session active".into(),
            error: None,
        }
    } else {
        AuthResult {
            success: false,
            profile: None,
            onboarding_email_sent: false,
            message: "No active session".into(),
            error: None,
        }
    }
}

#[tauri::command]
fn logout_free_user() -> AuthResult {
    clear_free_session();
    AuthResult {
        success: true,
        profile: None,
        onboarding_email_sent: false,
        message: "Logged out".into(),
        error: None,
    }
}

// ============================================================================
// Per-VST Trial + Entitlements
// ============================================================================

const VST_TRIAL_PREVIEWS: u32 = 3;
const VST_TRIAL_APPLIES: u32 = 2;

const KNOWN_VST_PLUGIN_IDS: &[&str] = &["screwai", "fantune", "timestretchx", "repairit"];

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct VstPluginUsage {
    previews_used: u32,
    applies_used: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct VstEntitlementsDb {
    plugins: std::collections::HashMap<String, VstPluginUsage>,
    #[serde(default)]
    owned: Vec<String>,
    #[serde(default)]
    last_sync: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VstAccessResult {
    pub allowed: bool,
    pub owned: bool,
    pub reason: Option<String>,
    pub previews_remaining: u32,
    pub applies_remaining: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VstPluginStatus {
    pub plugin_id: String,
    pub owned: bool,
    pub previews_used: u32,
    pub applies_used: u32,
    pub previews_remaining: u32,
    pub applies_remaining: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VstEntitlementsStatus {
    pub plugins: Vec<VstPluginStatus>,
    pub pro_unlocked: bool,
    pub last_sync: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct RemoteEntitlementsResponse {
    #[serde(default)]
    ok: bool,
    email: Option<String>,
    #[serde(default)]
    pro: bool,
    #[serde(default)]
    entitlements: Vec<String>,
    error: Option<String>,
}

fn get_vst_entitlements_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .join("StemSplit");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("vst_entitlements.json")
}

fn load_vst_entitlements_db() -> VstEntitlementsDb {
    let path = get_vst_entitlements_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<VstEntitlementsDb>(&content) {
            return parsed;
        }
    }
    VstEntitlementsDb::default()
}

fn save_vst_entitlements_db(db: &VstEntitlementsDb) -> Result<(), String> {
    let path = get_vst_entitlements_path();
    std::fs::write(path, serde_json::to_string_pretty(db).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to save VST entitlements: {}", e))
}

fn has_full_vst_access() -> bool {
    let license = get_license_status();
    !license.is_trial && license.is_valid
}

fn is_plugin_owned(plugin_id: &str, db: &VstEntitlementsDb) -> bool {
    if has_full_vst_access() {
        return true;
    }
    db.owned.iter().any(|id| id == plugin_id)
}

fn get_plugin_usage(db: &mut VstEntitlementsDb, plugin_id: &str) -> VstPluginUsage {
    db.plugins
        .entry(plugin_id.to_string())
        .or_insert_with(VstPluginUsage::default)
        .clone()
}

fn check_vst_access_internal(plugin_id: &str, action: &str) -> Result<VstAccessResult, String> {
    if !KNOWN_VST_PLUGIN_IDS.contains(&plugin_id) {
        return Err(format!("Unknown VST plugin id: {}", plugin_id));
    }

    let mut db = load_vst_entitlements_db();
    let owned = is_plugin_owned(plugin_id, &db);
    let usage = get_plugin_usage(&mut db, plugin_id);
    let previews_remaining = VST_TRIAL_PREVIEWS.saturating_sub(usage.previews_used);
    let applies_remaining = VST_TRIAL_APPLIES.saturating_sub(usage.applies_used);

    if owned {
        return Ok(VstAccessResult {
            allowed: true,
            owned: true,
            reason: None,
            previews_remaining,
            applies_remaining,
        });
    }

    let allowed = match action {
        "preview" => previews_remaining > 0,
        "apply" => applies_remaining > 0,
        _ => false,
    };

    let reason = if allowed {
        None
    } else {
        Some(format!(
            "Free trial exhausted for {}. Upgrade to unlock instantly.",
            plugin_id
        ))
    };

    Ok(VstAccessResult {
        allowed,
        owned: false,
        reason,
        previews_remaining,
        applies_remaining,
    })
}

fn consume_vst_trial_internal(plugin_id: &str, action: &str) -> Result<(), String> {
    if !KNOWN_VST_PLUGIN_IDS.contains(&plugin_id) {
        return Ok(());
    }

    let mut db = load_vst_entitlements_db();
    if is_plugin_owned(plugin_id, &db) {
        return Ok(());
    }

    let entry = db.plugins.entry(plugin_id.to_string()).or_insert_with(VstPluginUsage::default);
    match action {
        "preview" => {
            if entry.previews_used < VST_TRIAL_PREVIEWS {
                entry.previews_used += 1;
            }
        }
        "apply" => {
            if entry.applies_used < VST_TRIAL_APPLIES {
                entry.applies_used += 1;
            }
        }
        _ => {}
    }
    save_vst_entitlements_db(&db)
}

fn get_billing_base_url() -> Option<String> {
    let configured = std::env::var("STEMSPLIT_LICENSE_SERVER_URL")
        .ok()
        .or_else(|| std::env::var("NEXT_PUBLIC_LICENSE_API_URL").ok())
        .or_else(|| Some(env!("STEMSPLIT_LICENSE_SERVER_URL").to_string()))
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())?;

    let base = configured
        .trim_end_matches("/api/licenses/validate")
        .trim_end_matches('/')
        .to_string();
    Some(base)
}

fn get_entitlements_lookup_url() -> Option<String> {
    get_billing_base_url().map(|base| format!("{}/api/entitlements/lookup", base))
}

fn sync_vst_entitlements_internal(email: &str) -> Result<VstEntitlementsStatus, String> {
    let normalized = normalize_email(email);
    if normalized.is_empty() {
        return Err("Email is required to sync entitlements".into());
    }

    let url = get_entitlements_lookup_url()
        .ok_or_else(|| "Billing server URL is not configured".to_string())?;

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "email": normalized }))
        .send()
        .map_err(|e| format!("Entitlements sync failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Entitlements server returned status {}", response.status()));
    }

    let payload: RemoteEntitlementsResponse = response
        .json()
        .map_err(|e| format!("Invalid entitlements response: {}", e))?;

    if !payload.ok {
        return Err(payload.error.unwrap_or_else(|| "Entitlements lookup failed".into()));
    }

    let mut db = load_vst_entitlements_db();
    db.owned = payload.entitlements.clone();
    db.last_sync = Some(chrono::Utc::now().to_rfc3339());
    save_vst_entitlements_db(&db)?;

    Ok(build_vst_entitlements_status())
}

fn build_vst_entitlements_status() -> VstEntitlementsStatus {
    let db = load_vst_entitlements_db();
    let pro_unlocked = has_full_vst_access();

    let plugins = KNOWN_VST_PLUGIN_IDS
        .iter()
        .map(|plugin_id| {
            let usage = db.plugins.get(*plugin_id).cloned().unwrap_or_default();
            let owned = pro_unlocked || db.owned.iter().any(|id| id == *plugin_id);
            VstPluginStatus {
                plugin_id: (*plugin_id).to_string(),
                owned,
                previews_used: usage.previews_used,
                applies_used: usage.applies_used,
                previews_remaining: if owned {
                    VST_TRIAL_PREVIEWS
                } else {
                    VST_TRIAL_PREVIEWS.saturating_sub(usage.previews_used)
                },
                applies_remaining: if owned {
                    VST_TRIAL_APPLIES
                } else {
                    VST_TRIAL_APPLIES.saturating_sub(usage.applies_used)
                },
            }
        })
        .collect();

    VstEntitlementsStatus {
        plugins,
        pro_unlocked,
        last_sync: db.last_sync,
    }
}

fn decode_fx_json_payload(fx_json: &str) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    if let Ok(decoded) = STANDARD.decode(fx_json.trim()) {
        if let Ok(text) = String::from_utf8(decoded) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                return Ok(parsed);
            }
        }
    }

    serde_json::from_str(fx_json).map_err(|e| format!("Invalid FX payload: {}", e))
}

fn enforce_vst_fx_access(
    fx_json: &str,
    vst_plugin_ids: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let license = get_license_status();
    if !license.is_trial {
        return Ok(vst_plugin_ids.unwrap_or_default());
    }

    let payload = decode_fx_json_payload(fx_json)?;
    let modules = payload
        .get("modules")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    if !modules.is_empty() {
        return Err("FX processing is available for Pro users only.".to_string());
    }

    let vsts = payload
        .get("vsts")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    if vsts.is_empty() {
        return Ok(vec![]);
    }

    let plugin_ids: Vec<String> = vst_plugin_ids.unwrap_or_default();
    if plugin_ids.is_empty() {
        return Err("VST plugin ids are required for trial access checks.".to_string());
    }

    for plugin_id in &plugin_ids {
        let access = check_vst_access_internal(plugin_id, "apply")?;
        if !access.allowed {
            return Err(access.reason.unwrap_or_else(|| "VST trial limit reached.".to_string()));
        }
    }

    Ok(plugin_ids)
}

#[tauri::command]
fn get_vst_entitlements_status() -> VstEntitlementsStatus {
    build_vst_entitlements_status()
}

#[tauri::command]
fn check_vst_access(plugin_id: String, action: String) -> Result<VstAccessResult, String> {
    check_vst_access_internal(&plugin_id, &action)
}

#[tauri::command]
fn sync_vst_entitlements_from_server(email: String) -> Result<VstEntitlementsStatus, String> {
    sync_vst_entitlements_internal(&email)
}

#[tauri::command]
fn record_vst_usage(plugin_id: String, action: String) -> Result<VstEntitlementsStatus, String> {
    consume_vst_trial_internal(&plugin_id, &action)?;
    Ok(build_vst_entitlements_status())
}


// ============================================================================
// Data Structures
// ============================================================================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ProgressEvent {
    pub step: u32,
    pub total_steps: u32,
    pub message: String,
    pub progress_percent: u32,
    pub timestamp: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct StemInfo {
    pub file_path: String,
    pub format: String,
    pub duration_seconds: f64,
    #[serde(default)]
    pub purity_score: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SeparationResult {
    pub status: String,
    pub output_directory: String,
    pub stems: std::collections::HashMap<String, StemInfo>,
    pub process_duration_seconds: f64,
    pub errors: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct StemSplitRequest {
    pub file_path: String,
    pub output_dir: Option<String>,
    pub output_format: Option<String>,
    pub mp3_bitrate: Option<u32>,
    pub apply_effects: Option<bool>,
    pub pre_split_fx: Option<String>,
    pub engine: Option<String>,
    pub stems_count: Option<u32>,
    pub passes: Option<u32>,
    pub model_variant: Option<String>,
    pub post_fx: Option<String>,
    pub reference_file: Option<String>,
    pub extra_models: Option<String>,
    pub chunk_duration: Option<u32>,
    pub device: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct YouTubeDownloadRequest {
    pub url: String,
    #[serde(default = "default_youtube_mode")]
    pub mode: String,
}

fn default_youtube_mode() -> String {
    "audio_mp3_320".to_string()
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct YouTubeDownloadResult {
    pub status: String,
    pub file_path: String,
    pub title: String,
    pub duration_seconds: f64,
    pub output_directory: String,
    pub uploader: Option<String>,
    pub webpage_url: Option<String>,
    pub mode_used: String,
    pub formats_available: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PreSplitOptions {
    pub input_path: String,
    pub convert_wav: bool,
    pub normalize_loudness: bool,
    pub hpss_prepass: bool,
    pub target_sample_rate: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PreSplitResult {
    pub status: String,
    pub output_path: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub hpss_harmonic: Option<String>,
    pub hpss_percussive: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WhisperTranscriptionRequest {
    pub input_path: String,
    pub preset: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
    pub task: Option<String>,
    #[serde(default)]
    pub content_type: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WhisperTranscriptionResult {
    pub status: String,
    pub text_file: String,
    pub json_file: String,
    pub srt_file: String,
    pub vtt_file: String,
    pub word_srt_file: Option<String>,
    pub output_directory: String,
    pub model: String,
    pub preset: String,
    pub task: String,
    pub content_type: String,
    pub transcript_preview: String,
    pub segment_count: usize,
    pub detected_language: Option<String>,
}

// ============================================================================
// Global State for Tracking Operations
// ============================================================================

struct OperationState {
    is_running: bool,
    process_id: Option<u32>,
}

struct VstPreviewState {
    is_previewing: bool,
    process_id: Option<u32>,
}

lazy_static::lazy_static! {
    static ref OPERATION_STATE: Arc<Mutex<OperationState>> = Arc::new(Mutex::new(OperationState {
        is_running: false,
        process_id: None,
    }));
    
    static ref VST_PREVIEW_STATE: Arc<Mutex<VstPreviewState>> = Arc::new(Mutex::new(VstPreviewState {
        is_previewing: false,
        process_id: None,
    }));
}

/// Drop guard that always resets is_running when execute_splice exits (success or error)
struct RunGuard;
impl Drop for RunGuard {
    fn drop(&mut self) {
        let mut state = OPERATION_STATE.lock().unwrap();
        state.is_running = false;
        state.process_id = None;
    }
}
 
fn resolve_python_script_path(script_name: &str) -> std::path::PathBuf {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Some(project_root) = manifest_dir.parent() {
        candidates.push(project_root.join("scripts").join(script_name));
    }

    candidates.push(manifest_dir.join("scripts").join(script_name));

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("scripts").join(script_name));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("scripts").join(script_name));
            // Tauri bundles resources under _up_/ next to the debug/release binary.
            candidates.push(exe_dir.join("_up_").join("scripts").join(script_name));
        }
    }

    // Prefer the newest existing copy so dev source edits beat stale bundled scripts.
    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    for path in &candidates {
        if !path.exists() {
            continue;
        }
        let modified = std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if best.as_ref().map_or(true, |(_, best_time)| modified > *best_time) {
            best = Some((path.clone(), modified));
        }
    }
    if let Some((path, _)) = best {
        return path;
    }

    if let Some(project_root) = manifest_dir.parent() {
        return project_root.join("scripts").join(script_name);
    }

    std::path::PathBuf::from("scripts").join(script_name)
 }

fn resolve_python_path() -> String {
    if let Some(exe) = get_python_executable() {
        return exe.to_string_lossy().to_string();
    }

    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // 0. Primary: Check for local "embedded_python" folder (used in Release builds/Installer)
    if let Ok(exe_path) = std::env::current_exe() {
       if let Some(exe_dir) = exe_path.parent() {
           #[cfg(target_os = "windows")]
           candidates.push(exe_dir.join("embedded_python").join("python.exe"));
           #[cfg(not(target_os = "windows"))]
           candidates.push(exe_dir.join("embedded_python").join("bin").join("python3"));
       }
    }
    
    // Check in CWD as well
    if let Ok(current_dir) = std::env::current_dir() {
        #[cfg(target_os = "windows")]
        candidates.push(current_dir.join("embedded_python").join("python.exe"));
        #[cfg(not(target_os = "windows"))]
        candidates.push(current_dir.join("embedded_python").join("bin").join("python3"));
    }

    // 1. Try project root .venv (Development mode)
    if let Some(project_root) = manifest_dir.parent() {
        #[cfg(target_os = "windows")]
        candidates.push(project_root.join(".venv").join("Scripts").join("python.exe"));
        #[cfg(not(target_os = "windows"))]
        candidates.push(project_root.join(".venv").join("bin").join("python"));
    }

    // 2. Try current working directory .venv
    if let Ok(current_dir) = std::env::current_dir() {
        #[cfg(target_os = "windows")]
        candidates.push(current_dir.join(".venv").join("Scripts").join("python.exe"));
        #[cfg(not(target_os = "windows"))]
        candidates.push(current_dir.join(".venv").join("bin").join("python"));
    }

    // 3. Try bundled python folder (alternate name)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
             #[cfg(target_os = "windows")]
             candidates.push(exe_dir.join("python").join("python.exe"));
             #[cfg(not(target_os = "windows"))]
             candidates.push(exe_dir.join("python").join("bin").join("python"));
        }
    }

    for path in &candidates {
        if path.exists() {
            return path.to_string_lossy().to_string();
        }
    }

    // Fallback to system python
    "python".to_string()
 }

fn get_app_root_dir() -> Result<PathBuf, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            return Ok(exe_dir.to_path_buf());
        }
    }

    std::env::current_dir().map_err(|e| format!("Failed to resolve app root: {}", e))
}

fn get_stemsplit_data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("StemSplit")
}

fn get_models_root_config_path() -> PathBuf {
    get_stemsplit_data_dir().join("models_root.txt")
}

fn read_persisted_models_root() -> Option<String> {
    let path = get_models_root_config_path();
    std::fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn persist_models_root(path: &str) {
    let data_dir = get_stemsplit_data_dir();
    let _ = std::fs::create_dir_all(&data_dir);
    let _ = std::fs::write(get_models_root_config_path(), format!("{}\n", path.trim()));
}

fn models_root_has_payload(root: &Path) -> bool {
    let mdx = root.join("MVSEP-MDX23-music-separation-model-main").join("inference.py");
    let drumsep = root.join("drumsep-main").join("model");
    let vr = root.join("VR_Models");
    mdx.is_file() || drumsep.is_dir() || vr.is_dir()
}

fn resolve_models_root() -> Option<String> {
    if let Ok(value) = std::env::var("STEMSPLIT_MODELS_ROOT") {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() && Path::new(&trimmed).exists() {
            persist_models_root(&trimmed);
            return Some(trimmed);
        }
    }

    if let Some(value) = read_persisted_models_root() {
        if Path::new(&value).exists() {
            return Some(value);
        }
    }

    let baked = env!("STEMSPLIT_DEFAULT_MODELS_ROOT").trim().to_string();
    if !baked.is_empty() {
        let baked_path = Path::new(&baked);
        if baked_path.exists() && models_root_has_payload(baked_path) {
            persist_models_root(&baked);
            return Some(baked);
        }
    }

    None
}

fn get_uvr_path_config_path() -> PathBuf {
    get_stemsplit_data_dir().join("uvr_path.txt")
}

fn read_persisted_uvr_path() -> Option<String> {
    let path = get_uvr_path_config_path();
    std::fs::read_to_string(&path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn persist_uvr_path(path: &str) {
    let data_dir = get_stemsplit_data_dir();
    let _ = std::fs::create_dir_all(&data_dir);
    let _ = std::fs::write(get_uvr_path_config_path(), format!("{}\n", path.trim()));
}

fn uvr_install_has_lib_v5(root: &Path) -> bool {
    root.join("lib_v5").is_dir()
}

fn resolve_uvr_install_dir() -> Option<String> {
    if let Ok(value) = std::env::var("STEMSPLIT_UVR_PATH") {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            let candidate = Path::new(&trimmed);
            if candidate.exists() && uvr_install_has_lib_v5(candidate) {
                persist_uvr_path(&trimmed);
                return Some(trimmed);
            }
        }
    }

    if let Some(value) = read_persisted_uvr_path() {
        let candidate = Path::new(&value);
        if candidate.exists() && uvr_install_has_lib_v5(candidate) {
            return Some(value);
        }
    }

    let baked = env!("STEMSPLIT_DEFAULT_UVR_PATH").trim().to_string();
    if !baked.is_empty() {
        let baked_path = Path::new(&baked);
        if baked_path.exists() && uvr_install_has_lib_v5(baked_path) {
            persist_uvr_path(&baked);
            return Some(baked);
        }
    }

    None
}

fn apply_python_runtime_env(cmd: &mut Command) {
    if let Some(root) = resolve_models_root() {
        cmd.env("STEMSPLIT_MODELS_ROOT", &root);
        let mdx = Path::new(&root).join("MVSEP-MDX23-music-separation-model-main");
        if mdx.join("inference.py").is_file() {
            cmd.env(
                "STEMSPLIT_MDX_MODEL_PATH",
                mdx.to_string_lossy().to_string(),
            );
        }
    }

    if let Some(uvr_path) = resolve_uvr_install_dir() {
        cmd.env("STEMSPLIT_UVR_PATH", &uvr_path);
    }
}

fn get_local_feature_data_dir(feature_name: &str) -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("StemSplit")
        .join(feature_name);

    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Failed to create feature data directory '{}': {}", base.display(), e))?;

    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let mut candidate = base.join(&stamp);
    let mut counter = 1;
    while candidate.exists() {
        candidate = base.join(format!("{}-{}", stamp, counter));
        counter += 1;
    }

    std::fs::create_dir_all(&candidate)
        .map_err(|e| format!("Failed to create working directory '{}': {}", candidate.display(), e))?;
    Ok(candidate)
}

fn get_transcript_output_dir(source_path: &Path) -> Result<PathBuf, String> {
    let parent = source_path
        .parent()
        .ok_or_else(|| format!("Failed to resolve parent folder for '{}'", source_path.display()))?;
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio")
        .to_string();

    let mut candidate = parent.join(format!("{} Transcript", stem));
    let mut counter = 1;
    while candidate.exists() {
        candidate = parent.join(format!("{} Transcript ({})", stem, counter));
        counter += 1;
    }

    std::fs::create_dir_all(&candidate)
        .map_err(|e| format!("Failed to create transcript directory '{}': {}", candidate.display(), e))?;
    Ok(candidate)
}

fn get_asset_base_url() -> String {
    std::env::var("STEMSPLIT_ASSET_BASE_URL")
        .unwrap_or_else(|_| {
            std::env::var("SITE_URL")
                .unwrap_or_else(|_| "https://liminal-stemsplit.onrender.com".to_string())
                .trim_end_matches('/')
                .to_string()
                + "/downloads/runtime"
        })
        .trim_end_matches('/')
        .to_string()
}

#[cfg(target_os = "windows")]
fn find_windows_python_executable(env_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        env_dir.join("python.exe"),
        env_dir.join("embedded_python").join("python.exe"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn is_python_runtime_ready(python_exe: &Path) -> bool {
    detect_missing_python_modules(python_exe, &REQUIRED_PYTHON_PACKAGES).is_empty()
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
async fn execute_splice(
    request: StemSplitRequest,
    window: tauri::Window,
) -> Result<SeparationResult, String> {
    enforce_security_hold_if_active()?;

    // Validate input file before any processing starts.
    if let Err(validation_error) = validate_input_audio_file(&request.file_path) {
        if validation_error.malicious {
            let (incident_message, hold) = register_malicious_attempt(&validation_error.message);
            let reopen_unix = security_reopen_unix(&hold);
            let now = chrono::Utc::now().timestamp();

            let report = SecurityIncidentReport {
                event: "malicious_upload_attempt".to_string(),
                timestamp_utc: chrono::Utc::now().to_rfc3339(),
                local_username: get_local_username(),
                machine_name: get_machine_name(),
                license_email: get_stored_license_email(),
                attempted_file_path: request.file_path.clone(),
                reason: validation_error.message.clone(),
                malicious_attempts: hold.malicious_attempts,
                blocked_until_unix: hold.blocked_until_unix,
                permanently_banned: hold.permanently_banned,
            };
            send_security_incident_report(&report).await;

            let _ = window.emit(
                "security-incident",
                serde_json::json!({
                    "message": incident_message,
                    "reason": validation_error.message,
                    "maliciousAttempts": hold.malicious_attempts,
                    "blockedUntilUnix": hold.blocked_until_unix,
                    "reopenUnix": reopen_unix,
                    "permanent": hold.permanently_banned,
                }),
            );

            if should_hide_window_for_security(&hold, now) {
                sleep(Duration::from_millis(2200)).await;
                let _ = window.set_skip_taskbar(true);
                let _ = window.hide();
            }

            return Err(incident_message);
        }

        return Err(validation_error.message);
    }

    // ========================================================================
    // LICENSE ENFORCEMENT - Check trial limitations
    // ========================================================================
    let license = get_license_status();
    
    // Make request mutable so we can auto-correct trial limitations
    let mut request = request;
    
    if license.is_trial {
        // Auto-enforce trial limitations (coerce values instead of rejecting)
        
        // Free tier: allow Vocals (roformer) & Instrumental (mdx), block everything else
        if let Some(ref engine) = request.engine {
            let engine_lower = engine.to_lowercase();
            let is_allowed_free = engine_lower == "roformer" || engine_lower == "mdx";
            if !is_allowed_free {
                println!("[License] Trial: Engine '{}' is Pro-only. Auto-correcting to 'roformer'", engine);
                request.engine = Some("roformer".into());
                request.model_variant = Some("roformer_bs_317".into());
            }
        } else {
            request.engine = Some("roformer".into());
            request.model_variant = Some("roformer_bs_317".into());
        }
        
        // Force MP3 output for trial (auto-correct, don't reject)
        if let Some(ref format) = request.output_format {
            let format_lower = format.to_lowercase();
            if format_lower != "mp3" {
                println!("[License] Trial: Auto-correcting output format from '{}' to 'mp3'", format);
                request.output_format = Some("mp3".into());
            }
        } else {
            // Default to mp3 for trial if not specified
            request.output_format = Some("mp3".into());
        }

        // Force single pass for trial
        if request.passes.map(|p| p > 1).unwrap_or(false) {
            println!("[License] Trial: Auto-correcting passes from {:?} to 1", request.passes);
            request.passes = Some(1);
        } else if request.passes.is_none() {
            request.passes = Some(1);
        }

        // Disable all FX paths for trial/basic users
        if request.pre_split_fx.is_some() {
            println!("[License] Trial: Removing pre-split FX config");
            request.pre_split_fx = None;
        }
        if request.apply_effects != Some(false) {
            request.apply_effects = Some(false);
        }

        // One free Spleeter 2-stem split across all engine/options choices.
        enforce_trial_free_allowance()?;
    }
    // ========================================================================

    // Check if another operation is running
    {
        let mut state = OPERATION_STATE.lock().unwrap();
        if state.is_running {
            return Err("Another stem split operation is already running".to_string());
        }
        state.is_running = true;
    }
    // Guard ensures is_running is always reset on any exit path (success, error, panic)
    let _run_guard = RunGuard;

    // Determine output directory
    let output_dir = if let Some(dir) = request.output_dir {
        dir
    } else {
        let input_path = Path::new(&request.file_path);
        let parent = input_path.parent().unwrap_or_else(|| Path::new("."));
        let file_stem = input_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        
        let mut base_dir = parent.join(format!("{} Stems", file_stem));
        let mut counter = 1;
        
        while base_dir.exists() {
            base_dir = parent.join(format!("{} Stems ({})", file_stem, counter));
            counter += 1;
        }
        
        base_dir.to_string_lossy().to_string()
    };

    // Build path to Python script
    let script_path = resolve_python_script_path("splitter.py");

    let splitter_script = script_path.to_string_lossy().to_string();

    if !script_path.exists() {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "<unknown>".to_string());
        return Err(format!(
            "splitter.py not found. Resolved path: {} | CWD: {}",
            splitter_script, cwd
        ));
    }

    // Build arguments
    let mut cmd_args = vec![
        splitter_script.clone(),
        request.file_path.clone(),
        "--output".to_string(),
        output_dir.clone(),
    ];

    // Add optional parameters
    if let Some(format) = request.output_format {
        cmd_args.push("--format".to_string());
        cmd_args.push(format);
    }

    if let Some(bitrate) = request.mp3_bitrate {
        cmd_args.push("--bitrate".to_string());
        cmd_args.push(bitrate.to_string());
    }

    if let Some(apply_effects) = &request.apply_effects {
        if !apply_effects {
            cmd_args.push("--no-effects".to_string());
        }
    }

    if let Some(fx) = &request.pre_split_fx {
        cmd_args.push("--fx-config".to_string());
        cmd_args.push(fx.clone());
    }

    if let Some(engine) = &request.engine {
        cmd_args.push("--engine".to_string());
        cmd_args.push(engine.clone());
    }
    
    if let Some(stems_count) = request.stems_count {
        cmd_args.push("--stems".to_string());
        cmd_args.push(stems_count.to_string());
    }

    if let Some(passes) = request.passes {
        cmd_args.push("--passes".to_string());
        cmd_args.push(passes.to_string());
    }

    if let Some(model_variant) = &request.model_variant {
        if !model_variant.trim().is_empty() {
            cmd_args.push("--model-variant".to_string());
            cmd_args.push(model_variant.clone());
        }
    }

    if let Some(post_fx) = &request.post_fx {
        if !post_fx.trim().is_empty() {
            cmd_args.push("--post-fx".to_string());
            cmd_args.push(post_fx.clone());
        }
    }

    if let Some(reference_file) = &request.reference_file {
        if !reference_file.trim().is_empty() {
            cmd_args.push("--reference-file".to_string());
            cmd_args.push(reference_file.clone());
        }
    }

    if let Some(extra_models) = &request.extra_models {
        if !extra_models.trim().is_empty() {
            cmd_args.push("--extra-models".to_string());
            cmd_args.push(extra_models.clone());
        }
    }

    if let Some(chunk_duration) = request.chunk_duration {
        if chunk_duration > 0 {
            cmd_args.push("--chunk-duration".to_string());
            cmd_args.push(chunk_duration.to_string());
        }
    }

    // Device override (auto / cuda / cpu)
    if let Some(ref device) = request.device {
        let device_lower = device.to_lowercase();
        if device_lower == "cuda" || device_lower == "cpu" {
            cmd_args.push("--device".to_string());
            cmd_args.push(device_lower.clone());
        }
        // "auto" = don't pass anything, let hardware_config.json decide
    }

    // Add trial mode limitations to Python script
    if license.is_trial {
        cmd_args.push("--trial-mode".to_string());
        cmd_args.push("--max-duration".to_string());
        cmd_args.push(license.limitations.max_duration_seconds.to_string());
    }

    // Always run fast mode — skip analytics + effects + spectral cleanup for speed
    cmd_args.push("--fast".to_string());

    let python_exe = resolve_python_path();
    let python_exe_path = std::path::Path::new(&python_exe);
    let script_dir = script_path.parent().unwrap_or_else(|| std::path::Path::new("."));
    match generate_hardware_config_for_split(python_exe_path, script_dir) {
        Ok(config_path) => {
            cmd_args.push("--config".to_string());
            cmd_args.push(config_path.to_string_lossy().to_string());
        }
        Err(error) => {
            println!("[Hardware] Could not refresh hardware config before split: {}", error);
        }
    }

    let manifest_path = Path::new(&output_dir).join("manifest.json");
    // Stale failed manifests were being replayed on every retry — clear before each run.
    if manifest_path.exists() {
        let _ = std::fs::remove_file(&manifest_path);
    }

    println!(
        "[Split] splitter={} python={} engine={:?} variant={:?}",
        splitter_script,
        python_exe,
        request.engine,
        request.model_variant
    );

    // Spawn Python subprocess (hidden window on Windows)
    let mut cmd = Command::new(&python_exe);
    cmd.args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(script_dir)
        .env(
            "PYTHONPATH",
            script_dir.to_string_lossy().to_string(),
        );
    apply_python_runtime_env(&mut cmd);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn Python process: {}", e))?;

    let process_id = child.id();
    {
        let mut state = OPERATION_STATE.lock().unwrap();
        state.process_id = Some(process_id);
    }

    // Capture stdout for progress events
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let reader = BufReader::new(stdout);

    // CRITICAL: Drain stderr on a separate thread to prevent pipe deadlock.
    // On Windows, if the stderr pipe buffer fills (~4KB), Python blocks on its next
    // stderr write while Rust is blocked waiting for more stdout — classic deadlock.
    let stderr = child.stderr.take();
    let stderr_handle = std::thread::spawn(move || -> String {
        if let Some(stderr_stream) = stderr {
            let mut buf = String::new();
            let mut reader = BufReader::new(stderr_stream);
            let _ = reader.read_to_string(&mut buf);
            buf
        } else {
            String::new()
        }
    });

    let mut errors = Vec::new();

    // Read lines from stdout
    for line in reader.lines() {
        match line {
            Ok(json_line) => {
                // Try to parse as JSON (progress events)
                if let Ok(progress) = serde_json::from_str::<serde_json::Value>(&json_line) {
                    if let Some("progress") = progress.get("event").and_then(|v| v.as_str()) {
                        // Emit progress event to frontend
                        if let (Some(step), Some(total), Some(msg), Some(pct)) = (
                            progress.get("step").and_then(|v| v.as_u64()),
                            progress.get("total_steps").and_then(|v| v.as_u64()),
                            progress.get("message").and_then(|v| v.as_str()),
                            progress.get("progress_percent").and_then(|v| v.as_u64()),
                        ) {
                            let _ = window.emit("stem-split-progress", ProgressEvent {
                                step: step as u32,
                                total_steps: total as u32,
                                message: msg.to_string(),
                                progress_percent: pct as u32,
                                timestamp: progress
                                    .get("timestamp")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            });
                        }
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Error reading stdout: {}", e));
            }
        }
    }

    // Wait for process to complete
    let status = child.wait().map_err(|e| format!("Failed to wait for child: {}", e))?;

    // Collect stderr from the drain thread (won't block now — process already exited)
    let stderr_output = stderr_handle.join().unwrap_or_default();

    // RunGuard handles cleanup, but we can explicitly drop it here for clarity
    drop(_run_guard);

    if !status.success() {
        if manifest_path.exists() {
            if let Ok(manifest_content) = std::fs::read_to_string(&manifest_path) {
                return Err(format_manifest_process_failure(
                    status.code().unwrap_or(-1),
                    &manifest_content,
                    &stderr_output,
                ));
            }
        }

        return Err(format_python_process_failure(
            status.code().unwrap_or(-1),
            &stderr_output,
        ));
    }

    // Try to read manifest from output directory
    if manifest_path.exists() {
        match std::fs::read_to_string(&manifest_path) {
            Ok(manifest_content) => {
                match serde_json::from_str::<SeparationResult>(&manifest_content) {
                    Ok(result) => {
                        let finalized = finalize_separation_result(result)?;
                        if license.is_trial && finalized.status == "success" {
                            register_trial_split_completion();
                        }
                        return Ok(finalized);
                    }
                    Err(e) => {
                        errors.push(format!("Failed to parse manifest: {}", e));
                    }
                }
            }
            Err(e) => {
                errors.push(format!("Failed to read manifest: {}", e));
            }
        }
    }

    // Return fallback result
    Ok(SeparationResult {
        status: if errors.is_empty() {
            "success".to_string()
        } else {
            "partial".to_string()
        },
        output_directory: output_dir,
        stems: std::collections::HashMap::new(),
        process_duration_seconds: 0.0,
        errors,
    })
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct AudioFilePayload {
    data_base64: String,
    mime_type: String,
}

fn audio_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        Some("m4a") | Some("aac") => "audio/mp4",
        _ => "audio/wav",
    }
}

fn wait_for_readable_file(path: &Path, timeout_ms: u64) -> Result<u64, String> {
    let started = std::time::Instant::now();
    let mut last_size: Option<u64> = None;

    while started.elapsed().as_millis() as u64 <= timeout_ms {
        if path.exists() {
            if let Ok(metadata) = std::fs::metadata(path) {
                let size = metadata.len();
                if size >= 1024 {
                    if last_size == Some(size) {
                        return Ok(size);
                    }
                    last_size = Some(size);
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    Err(format!(
        "Audio file is not readable yet: {}",
        path.display()
    ))
}

fn finalize_separation_result(mut result: SeparationResult) -> Result<SeparationResult, String> {
    if result.status != "success" {
        return Ok(result);
    }

    let mut verified_stems = std::collections::HashMap::new();

    for (stem_name, stem_info) in result.stems {
        let path = Path::new(&stem_info.file_path);
        let size = wait_for_readable_file(path, 15000)?;
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Failed to resolve stem path '{}': {}", path.display(), error))?;

        if size < 1024 {
            return Err(format!(
                "Stem '{}' file is too small ({} bytes): {}",
                stem_name,
                size,
                canonical.display()
            ));
        }

        let mut normalized = stem_info;
        normalized.file_path = canonical.to_string_lossy().to_string();
        verified_stems.insert(stem_name, normalized);
    }

    result.stems = verified_stems;
    Ok(result)
}

#[tauri::command]
fn read_audio_file(path: String) -> Result<AudioFilePayload, String> {
    let file_path = Path::new(&path);
    wait_for_readable_file(file_path, 15000)?;

    let bytes = std::fs::read(file_path)
        .map_err(|error| format!("Failed to read audio file '{}': {}", file_path.display(), error))?;

    if bytes.len() < 1024 {
        return Err(format!(
            "Audio file is too small to play ({} bytes): {}",
            bytes.len(),
            file_path.display()
        ));
    }

    use base64::{engine::general_purpose::STANDARD, Engine as _};

    Ok(AudioFilePayload {
        data_base64: STANDARD.encode(bytes),
        mime_type: audio_mime_type(file_path).to_string(),
    })
}

#[tauri::command]
fn open_results_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn preprocess_audio_for_split(
    request: PreSplitOptions,
    window: tauri::Window,
) -> Result<PreSplitResult, String> {
    let source_path = PathBuf::from(&request.input_path);
    if !source_path.exists() {
        return Err(format!("Audio file not found: {}", source_path.display()));
    }

    let python_exe = get_python_executable().ok_or_else(|| {
        "Python runtime is not available. Run the built-in environment setup first.".to_string()
    })?;

    let env_dir = get_python_env_dir();
    let script_path = resolve_python_script_path("pre_split_processor.py");
    if !script_path.exists() {
        return Err(format!("pre_split_processor.py not found at {}", script_path.display()));
    }

    // Ensure optional dependencies for preprocessing
    let mut missing_modules = Vec::new();
    if request.normalize_loudness {
        missing_modules.extend_from_slice(&["pyloudnorm", "soundfile"]);
    }
    if request.hpss_prepass {
        missing_modules.extend_from_slice(&["librosa", "soundfile"]);
    }

    if !missing_modules.is_empty() {
        let _ = window.emit("pre-split-progress", serde_json::json!({
            "message": "Installing preprocessing runtime...",
            "percent": 3
        }));
        let packages: Vec<&str> = missing_modules.iter().map(|m| {
            match *m {
                "pyloudnorm" => "pyloudnorm",
                "soundfile" => "soundfile",
                "librosa" => "librosa",
                _ => m,
            }
        }).collect();
        install_python_packages(&python_exe, &env_dir, "Install preprocessing dependencies", &packages)?;
    }

    let output_dir = get_local_feature_data_dir("preprocessed")?;
    let mut cmd = Command::new(&python_exe);
    cmd.args(&[
        script_path.to_string_lossy().to_string(),
        "--input".to_string(),
        source_path.to_string_lossy().to_string(),
        "--output".to_string(),
        output_dir.to_string_lossy().to_string(),
        "--target-rate".to_string(),
        request.target_sample_rate.to_string(),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    apply_python_runtime_env(&mut cmd);

    if request.convert_wav {
        cmd.arg("--convert-wav");
    }
    if request.normalize_loudness {
        cmd.arg("--normalize-loudness");
    }
    if request.hpss_prepass {
        cmd.arg("--hpss-prepass");
    }

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start preprocessing: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to capture pre-processor output")?;
    let reader = BufReader::new(stdout);
    let stderr = child.stderr.take();
    let stderr_handle = std::thread::spawn(move || -> String {
        if let Some(stderr_stream) = stderr {
            let mut buf = String::new();
            let mut stderr_reader = BufReader::new(stderr_stream);
            let _ = stderr_reader.read_to_string(&mut buf);
            buf
        } else {
            String::new()
        }
    });

    let _ = window.emit("pre-split-progress", serde_json::json!({
        "message": "Initializing preprocessing pipeline...",
        "percent": 5
    }));

    let mut final_result: Option<PreSplitResult> = None;
    let mut last_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read pre-processor output: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&line) {
            match payload.get("event").and_then(|value| value.as_str()) {
                Some("progress") => {
                    let percent = payload.get("percent").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
                    let message = payload.get("message").and_then(|value| value.as_str()).unwrap_or("Processing audio...");
                    let _ = window.emit("pre-split-progress", serde_json::json!({
                        "message": message,
                        "percent": percent
                    }));
                }
                Some("result") => {
                    let output_path = payload.get("output_path").and_then(|value| value.as_str()).unwrap_or_default().to_string();
                    let duration = payload.get("duration_seconds").and_then(|value| value.as_f64()).unwrap_or(0.0);
                    let sample_rate = payload.get("sample_rate").and_then(|value| value.as_u64()).unwrap_or(44100) as u32;
                    let channels = payload.get("channels").and_then(|value| value.as_u64()).unwrap_or(2) as u32;
                    
                    let hpss = payload.get("hpss");
                    let hpss_harmonic = hpss.and_then(|h| h.get("harmonic")).and_then(|value| value.as_str()).map(|s| s.to_string());
                    let hpss_percussive = hpss.and_then(|h| h.get("percussive")).and_then(|value| value.as_str()).map(|s| s.to_string());

                    final_result = Some(PreSplitResult {
                        status: "ok".to_string(),
                        output_path,
                        duration_seconds: duration,
                        sample_rate,
                        channels,
                        hpss_harmonic,
                        hpss_percussive,
                    });
                }
                Some("error") => {
                    last_error = payload.get("message").and_then(|value| value.as_str()).map(|value| value.to_string());
                }
                _ => {}
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to await pre-processor: {}", e))?;
    let stderr_output = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(last_error.unwrap_or_else(|| {
            let details = if stderr_output.trim().is_empty() {
                "Unknown preprocessing failure".to_string()
            } else {
                stderr_output
            };
            format!("Audio preprocessing failed: {}", truncate_diagnostic_details(&details))
        }));
    }

    let result = final_result.ok_or_else(|| {
        if let Some(error) = last_error {
            error
        } else {
            "Preprocessing finished without returning a result payload.".to_string()
        }
    })?;

    let _ = window.emit("pre-split-progress", serde_json::json!({
        "message": "Preprocessing complete.",
        "percent": 100
    }));

    Ok(result)
}

#[tauri::command]
async fn download_youtube_audio(
    request: YouTubeDownloadRequest,
    window: tauri::Window,
) -> Result<YouTubeDownloadResult, String> {
    let python_exe = get_python_executable().ok_or_else(|| {
        "Python runtime is not available. Run the built-in environment setup first.".to_string()
    })?;
    let env_dir = get_python_env_dir();
    let script_path = resolve_python_script_path("youtube_dl.py");
    if !script_path.exists() {
        return Err(format!("youtube_dl.py not found at {}", script_path.display()));
    }

    if !detect_missing_python_modules(&python_exe, &["yt_dlp"]).is_empty() {
        let _ = window.emit("youtube-download-progress", serde_json::json!({
            "message": "Installing YouTube import runtime...",
            "percent": 4
        }));
        install_python_packages(&python_exe, &env_dir, "Install yt-dlp", &["yt-dlp"])?;
    }

    let output_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("StemSplit")
        .join("imports");
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create YouTube import directory: {}", e))?;

    let mut cmd = Command::new(&python_exe);
    cmd.args(&[
        script_path.to_string_lossy().to_string(),
        "--url".to_string(),
        request.url.clone(),
        "--output".to_string(),
        output_dir.to_string_lossy().to_string(),
        "--mode".to_string(),
        request.mode.clone(),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    apply_python_runtime_env(&mut cmd);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start YouTube import: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to capture YouTube downloader output")?;
    let reader = BufReader::new(stdout);
    let stderr = child.stderr.take();
    let stderr_handle = std::thread::spawn(move || -> String {
        if let Some(stderr_stream) = stderr {
            let mut buf = String::new();
            let mut stderr_reader = BufReader::new(stderr_stream);
            let _ = stderr_reader.read_to_string(&mut buf);
            buf
        } else {
            String::new()
        }
    });

    let _ = window.emit("youtube-download-progress", serde_json::json!({
        "message": "Booting import pipeline...",
        "percent": 2
    }));

    let mut final_result: Option<YouTubeDownloadResult> = None;
    let mut last_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read YouTube download output: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&line) {
            match payload.get("event").and_then(|value| value.as_str()) {
                Some("progress") => {
                    let percent = payload.get("percent").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
                    let message = payload.get("message").and_then(|value| value.as_str()).unwrap_or("Downloading audio...");
                    let _ = window.emit("youtube-download-progress", serde_json::json!({
                        "message": message,
                        "percent": percent
                    }));
                }
                Some("result") => {
                    let formats_available: Vec<String> = payload.get("formats_available")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(String::from).collect())
                        .unwrap_or_default();
                    
                    final_result = Some(YouTubeDownloadResult {
                        status: "ok".to_string(),
                        file_path: payload.get("file").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                        title: payload.get("title").and_then(|value| value.as_str()).unwrap_or("Untitled Import").to_string(),
                        duration_seconds: payload.get("duration").and_then(|value| value.as_f64()).unwrap_or(0.0),
                        output_directory: payload
                            .get("output_directory")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| output_dir.to_string_lossy().to_string()),
                        uploader: payload.get("uploader").and_then(|value| value.as_str()).map(|value| value.to_string()),
                        webpage_url: payload.get("webpage_url").and_then(|value| value.as_str()).map(|value| value.to_string()),
                        mode_used: payload.get("mode_used").and_then(|value| value.as_str()).unwrap_or("audio_mp3_320").to_string(),
                        formats_available,
                    });
                }
                Some("error") => {
                    last_error = payload.get("message").and_then(|value| value.as_str()).map(|value| value.to_string());
                }
                _ => {}
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to await YouTube downloader: {}", e))?;
    let stderr_output = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(last_error.unwrap_or_else(|| {
            let details = if stderr_output.trim().is_empty() {
                "Unknown YouTube import failure".to_string()
            } else {
                stderr_output
            };
            format!("YouTube import failed: {}", truncate_diagnostic_details(&details))
        }));
    }

    let result = final_result.ok_or_else(|| {
        if let Some(error) = last_error {
            error
        } else {
            "YouTube import finished without returning a result payload.".to_string()
        }
    })?;

    let _ = window.emit("youtube-download-progress", serde_json::json!({
        "message": "Audio imported successfully.",
        "percent": 100
    }));

    Ok(result)
}

#[tauri::command]
async fn transcribe_audio(
    request: WhisperTranscriptionRequest,
    window: tauri::Window,
) -> Result<WhisperTranscriptionResult, String> {
    let source_path = PathBuf::from(&request.input_path);
    if !source_path.exists() {
        return Err(format!("Audio file not found: {}", source_path.display()));
    }

    // Verify ffmpeg is available (required by whisper_transcribe.py for preprocessing)
    let has_ffmpeg = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !has_ffmpeg {
        return Err(
            "FFmpeg not found. Whisper transcription requires FFmpeg for audio preprocessing. \
             Install FFmpeg from https://ffmpeg.org or via your package manager."
                .to_string(),
        );
    }

    let python_exe = get_python_executable().ok_or_else(|| {
        "Python runtime is not available. Run the built-in environment setup first.".to_string()
    })?;
    let env_dir = get_python_env_dir();
    let script_path = resolve_python_script_path("whisper_transcribe.py");
    if !script_path.exists() {
        return Err(format!("whisper_transcribe.py not found at {}", script_path.display()));
    }

    if !detect_missing_python_modules(&python_exe, &["whisper"]).is_empty() {
        let _ = window.emit("whisper-progress", serde_json::json!({
            "message": "Installing Whisper transcription runtime...",
            "percent": 4
        }));
        let whisper_install = install_python_packages(&python_exe, &env_dir, "Install openai-whisper", &["openai-whisper"]);
        if whisper_install.is_err() {
            // Auto-troubleshoot: failed to install whisper — escalate to deep repair
            let _ = window.emit("whisper-progress", serde_json::json!({
                "message": "Auto-repairing Python environment for Whisper...",
                "percent": 4
            }));
            let repair_result = deep_repair_python_environment(window.clone()).await;
            if let Err(repair_err) = repair_result {
                return Err(format!(
                    "Whisper installation failed and auto-repair also failed: {}. \
                     Please run Deep Repair from Settings or reinstall.",
                    repair_err
                ));
            }
            // Verify whisper is now available after repair
            if !detect_missing_python_modules(&python_exe, &["whisper"]).is_empty() {
                return Err("Auto-repair completed but Whisper is still not available. Please run Deep Repair from Settings.".to_string());
            }
        }
    }

    let output_dir = get_transcript_output_dir(&source_path)?;
    let preset = request.preset.unwrap_or_else(|| "clean_speech".to_string());
    let model = request.model.unwrap_or_else(|| "auto".to_string());
    let language = request.language.unwrap_or_default();
    let task = request.task.unwrap_or_else(|| "transcribe".to_string());
    let content_type = request.content_type.clone();

    let mut cmd = Command::new(&python_exe);
    cmd.args(&[
        script_path.to_string_lossy().to_string(),
        "--input".to_string(),
        source_path.to_string_lossy().to_string(),
        "--output".to_string(),
        output_dir.to_string_lossy().to_string(),
        "--preset".to_string(),
        preset.clone(),
        "--model".to_string(),
        model.clone(),
        "--task".to_string(),
        task.clone(),
        "--language".to_string(),
        language.clone(),
        "--content-type".to_string(),
        content_type.clone(),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    apply_python_runtime_env(&mut cmd);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start Whisper transcription: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to capture Whisper output")?;
    let reader = BufReader::new(stdout);
    let stderr = child.stderr.take();
    let stderr_handle = std::thread::spawn(move || -> String {
        if let Some(stderr_stream) = stderr {
            let mut buf = String::new();
            let mut stderr_reader = BufReader::new(stderr_stream);
            let _ = stderr_reader.read_to_string(&mut buf);
            buf
        } else {
            String::new()
        }
    });

    let _ = window.emit("whisper-progress", serde_json::json!({
        "message": "Booting Whisper pipeline...",
        "percent": 2
    }));

    let mut final_result: Option<WhisperTranscriptionResult> = None;
    let mut last_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read Whisper output: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&line) {
            match payload.get("event").and_then(|value| value.as_str()) {
                Some("progress") => {
                    let percent = payload.get("percent").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
                    let message = payload.get("message").and_then(|value| value.as_str()).unwrap_or("Transcribing audio...");
                    let _ = window.emit("whisper-progress", serde_json::json!({
                        "message": message,
                        "percent": percent
                    }));
                }
                Some("result") => {
                    final_result = Some(WhisperTranscriptionResult {
                        status: "ok".to_string(),
                        text_file: payload.get("textFile").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                        json_file: payload.get("jsonFile").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                        srt_file: payload.get("srtFile").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                        vtt_file: payload.get("vttFile").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                        word_srt_file: payload.get("wordSrtFile").and_then(|value| value.as_str()).map(|value| value.to_string()),
                        output_directory: output_dir.to_string_lossy().to_string(),
                        model: payload.get("model").and_then(|value| value.as_str()).unwrap_or(&model).to_string(),
                        preset: payload.get("preset").and_then(|value| value.as_str()).unwrap_or(&preset).to_string(),
                        task: payload.get("task").and_then(|value| value.as_str()).unwrap_or(&task).to_string(),
                        content_type: payload.get("contentType").and_then(|value| value.as_str()).unwrap_or("default").to_string(),
                        transcript_preview: payload.get("transcriptPreview").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                        segment_count: payload.get("segmentCount").and_then(|value| value.as_u64()).unwrap_or(0) as usize,
                        detected_language: payload.get("detectedLanguage").and_then(|value| value.as_str()).map(|value| value.to_string()),
                    });
                }
                Some("error") => {
                    last_error = payload.get("message").and_then(|value| value.as_str()).map(|value| value.to_string());
                }
                _ => {}
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to await Whisper transcription: {}", e))?;
    let stderr_output = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(last_error.unwrap_or_else(|| {
            let details = if stderr_output.trim().is_empty() {
                "Unknown Whisper transcription failure".to_string()
            } else {
                stderr_output
            };
            format!("Whisper transcription failed: {}", truncate_diagnostic_details(&details))
        }));
    }

    let result = final_result.ok_or_else(|| {
        if let Some(error) = last_error {
            error
        } else {
            "Whisper transcription finished without returning a result payload.".to_string()
        }
    })?;

    let _ = window.emit("whisper-progress", serde_json::json!({
        "message": "Transcript ready.",
        "percent": 100
    }));

    Ok(result)
}

#[tauri::command]
fn cancel_stem_split() -> Result<String, String> {
    let mut state = OPERATION_STATE.lock().unwrap();
    if let Some(pid) = state.process_id {
        // Kill the process
        let cmd = if cfg!(windows) {
            let mut c = Command::new("taskkill");
            c.args(&["/PID", &pid.to_string(), "/F"]);
            #[cfg(target_os = "windows")]
            c.creation_flags(CREATE_NO_WINDOW);
            c.spawn()
        } else {
            Command::new("kill")
                .args(&[&pid.to_string()])
                .spawn()
        };

        match cmd {
            Ok(mut child) => {
                let _ = child.wait();
                state.is_running = false;
                state.process_id = None;
                Ok("Operation cancelled successfully".to_string())
            }
            Err(e) => Err(format!("Failed to cancel operation: {}", e)),
        }
    } else {
        // Always reset state even if no process found (stuck state recovery)
        state.is_running = false;
        state.process_id = None;
        Ok("Operation state reset".to_string())
    }
}

#[tauri::command]
fn get_separator_status() -> Result<String, String> {
    let state = OPERATION_STATE.lock().unwrap();
    if state.is_running {
        Ok("processing".to_string())
    } else {
        Ok("idle".to_string())
    }
}

#[tauri::command]
async fn apply_stem_fx(
    stem_path: String,
    fx_json: String,
    vst_plugin_ids: Option<Vec<String>>,
) -> Result<String, String> {
    let consumed_plugin_ids = enforce_vst_fx_access(&fx_json, vst_plugin_ids)?;

    if !Path::new(&stem_path).exists() {
        return Err(format!("Stem file not found: {}", stem_path));
    }

    // Resolve apply_fx.py script path
    let script_path = resolve_python_script_path("apply_fx.py");

    if !script_path.exists() {
        return Err(format!("apply_fx.py not found at: {}", script_path.display()));
    }

    let work_dir = script_path.parent().unwrap().parent().unwrap();
    
    let python_exe = resolve_python_path();
    let mut cmd = Command::new(&python_exe);
    cmd.args(&[
        script_path.to_string_lossy().to_string(),
        stem_path.clone(),
        "--fx".to_string(),
        fx_json.clone(),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    // Ensure we run in project root so relative imports (if any) or file paths work as expected
    .current_dir(work_dir);
    apply_python_runtime_env(&mut cmd);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output()
        .map_err(|e| format!("Failed to run apply_fx.py: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FX processing failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Find the last JSON line (apply_fx.py prints result JSON)
    let json_line = stdout.lines().rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or("No JSON output from apply_fx.py")?;

    for plugin_id in consumed_plugin_ids {
        let _ = consume_vst_trial_internal(&plugin_id, "apply");
    }

    Ok(json_line.to_string())
}

#[tauri::command]
async fn preview_vst_plugin(
    window: tauri::Window,
    plugin_id: String,
    vst_path: String,
    audio_path: String,
) -> Result<String, String> {
    let access = check_vst_access_internal(&plugin_id, "preview")?;
    if !access.allowed {
        return Err(access.reason.unwrap_or_else(|| "VST preview is locked.".to_string()));
    }

    // Resolve preview_vst.py script path
    let script_path = resolve_python_script_path("preview_vst.py");

    if !script_path.exists() {
        return Err(format!("preview_vst.py not found at: {}", script_path.display()));
    }

    let work_dir = script_path.parent().unwrap().parent().unwrap();
    
    let python_exe = resolve_python_path();
    let mut cmd = Command::new(&python_exe);
    cmd.args(&[
        script_path.to_string_lossy().to_string(),
        vst_path.clone(),
        audio_path,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .current_dir(work_dir);
    apply_python_runtime_env(&mut cmd);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to start preview_vst.py: {}", e))?;

    let my_pid = child.id();

    // Store PID for cancellation
    {
        let mut state = VST_PREVIEW_STATE.lock().unwrap();
        state.is_previewing = true;
        state.process_id = Some(my_pid);
    }

    let stdout = child.stdout.take()
        .ok_or("Failed to open stdout")?;
    
    let reader = BufReader::new(stdout);
    
    for line in reader.lines() {
        match line {
            Ok(l) => {
                if l.starts_with("STATE:") {
                   // Emit event: STATE:<b64>
                   let state_b64 = &l[6..];
                   if let Err(e) = window.emit("vst-state-update", state_b64) {
                       eprintln!("Failed to emit event: {}", e);
                   }
                }
            }
            Err(_) => break,
        }
    }
    
    let status = child.wait().map_err(|e| e.to_string())?;
    
    // Clear State on completion (only if we are still the active process)
    {
        let mut state = VST_PREVIEW_STATE.lock().unwrap();
        if state.process_id == Some(my_pid) {
            state.is_previewing = false;
            state.process_id = None;
        }
    }

    if status.success() {
        let _ = consume_vst_trial_internal(&plugin_id, "preview");
        Ok("Preview finished".to_string())
    } else {
        // If killed manually, it might return non-success, which is fine
        Ok("Preview stopped".to_string())
    }
}

#[tauri::command]
fn stop_vst_plugin() -> Result<String, String> {
    let mut state = VST_PREVIEW_STATE.lock().unwrap();
    if let Some(pid) = state.process_id {
        #[cfg(target_os = "windows")]
        let _ = Command::new("taskkill")
            .args(&["/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        #[cfg(not(target_os = "windows"))]
        let _ = Command::new("kill")
            .arg("-9")
            .arg(&pid.to_string())
            .output();
            
        state.is_previewing = false;
        state.process_id = None;
        Ok("VST Preview Stopped".to_string())
    } else {
        Ok("No VST preview running".to_string())
    }
}

// ============================================================================
// Python Environment Management
// ============================================================================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PythonStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub packages_installed: bool,
    pub missing_packages: Vec<String>,
}

const REQUIRED_PYTHON_PACKAGES: [&str; 5] = ["torch", "demucs", "librosa", "soundfile", "numpy"];
const OPTIONAL_PYTHON_PACKAGES: [&str; 8] = ["pedalboard", "pydub", "psutil", "pynvml", "sounddevice", "pyloudnorm", "yt_dlp", "whisper"];
const STABLE_TORCH_VERSION: &str = "2.5.1";
const STABLE_TORCHVISION_VERSION: &str = "0.20.1";
const STABLE_DEMUCS_VERSION: &str = "4.0.1";

#[derive(Clone, Serialize, Deserialize, Debug)]
struct PythonSetupAttempt {
    label: String,
    command: String,
    success: bool,
    details: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct PythonSetupDiagnostics {
    started_at: String,
    env_dir: String,
    selected_strategy: Option<String>,
    attempts: Vec<PythonSetupAttempt>,
    warnings: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct PythonRuntimeMarker {
    fingerprint: String,
    required_modules: Vec<String>,
    created_at: String,
}

#[derive(Clone, Debug)]
struct PipInstallPlan {
    label: String,
    args: Vec<String>,
}

fn get_python_env_dir() -> std::path::PathBuf {
    let mut possible_paths: Vec<std::path::PathBuf> = Vec::new();
    
    // 1. Current working directory (project root in dev mode)
    if let Ok(cwd) = std::env::current_dir() {
        possible_paths.push(cwd.join("embedded_python"));
    }
    
    // 2. Relative to executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Production: beside the exe
            #[cfg(target_os = "windows")]
            possible_paths.push(exe_dir.join("embedded_python"));
            #[cfg(target_os = "macos")]
            possible_paths.push(exe_dir.join("../Resources/python_env"));
            #[cfg(target_os = "linux")]
            possible_paths.push(exe_dir.join("python_env"));
            
            // Dev mode: project root
            possible_paths.push(exe_dir.join("../../../embedded_python"));
            possible_paths.push(exe_dir.join("../../embedded_python"));
        }
    }

    // 3. User local app data (for writable downloads)
    if let Some(mut app_data) = dirs::data_local_dir() {
        app_data.push("StemSplit");
        app_data.push("embedded_python");
        possible_paths.push(app_data.clone());
    } else if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let mut app_data = std::path::PathBuf::from(local_appdata);
        app_data.push("StemSplit");
        app_data.push("embedded_python");
        possible_paths.push(app_data);
    }
    
    // Return first existing path
    for path in &possible_paths {
        #[cfg(target_os = "windows")]
        let check_path = path.join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let check_path = path.join("bin").join("python3");
        
        if check_path.exists() {
            return path.clone();
        }
    }
    
    // Fallback: Use AppData if available, otherwise relative path
    if let Some(mut app_data) = dirs::data_local_dir() {
        app_data.push("StemSplit");
        app_data.push("embedded_python");
        app_data
    } else if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let mut app_data = std::path::PathBuf::from(local_appdata);
        app_data.push("StemSplit");
        app_data.push("embedded_python");
        app_data
    } else {
        std::path::PathBuf::from("embedded_python")
    }
}

fn get_python_executable() -> Option<std::path::PathBuf> {
    let env_dir = get_python_env_dir();
    
    #[cfg(target_os = "windows")]
    let python_path = env_dir.join("python.exe");
    #[cfg(not(target_os = "windows"))]
    let python_path = env_dir.join("bin").join("python3");
    
    if python_path.exists() {
        Some(python_path)
    } else {
        None
    }
}

fn get_python_setup_diagnostics_path() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("StemSplit");

    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("python-setup-diagnostics.json")
}

fn get_python_runtime_marker_path(env_dir: &Path) -> PathBuf {
    env_dir.join("python_runtime_ready.json")
}

fn get_runtime_fingerprint_anchor_paths(env_dir: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            env_dir.join("python.exe"),
            env_dir.join("python310._pth"),
            env_dir.join("Lib").join("site-packages").join("torch").join("__init__.py"),
            env_dir.join("Lib").join("site-packages").join("demucs").join("__init__.py"),
            env_dir.join("Lib").join("site-packages").join("librosa").join("__init__.py"),
            env_dir.join("Lib").join("site-packages").join("soundfile.py"),
            env_dir.join("Lib").join("site-packages").join("numpy").join("__init__.py"),
        ]
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![
            env_dir.join("bin").join("python3"),
            env_dir.join("lib").join("python3.10").join("site-packages").join("torch").join("__init__.py"),
            env_dir.join("lib").join("python3.10").join("site-packages").join("demucs").join("__init__.py"),
            env_dir.join("lib").join("python3.10").join("site-packages").join("librosa").join("__init__.py"),
            env_dir.join("lib").join("python3.10").join("site-packages").join("soundfile.py"),
            env_dir.join("lib").join("python3.10").join("site-packages").join("numpy").join("__init__.py"),
        ]
    }
}

fn build_python_runtime_fingerprint(env_dir: &Path) -> Result<String, String> {
    let anchors = get_runtime_fingerprint_anchor_paths(env_dir);
    let mut hasher = Sha256::new();

    for anchor in anchors {
        let bytes = std::fs::read(&anchor)
            .map_err(|e| format!("Runtime fingerprint anchor missing '{}': {}", anchor.display(), e))?;
        hasher.update(anchor.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
        hasher.update([0]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn read_python_runtime_marker(env_dir: &Path) -> Option<PythonRuntimeMarker> {
    let marker_path = get_python_runtime_marker_path(env_dir);
    std::fs::read_to_string(marker_path)
        .ok()
        .and_then(|content| serde_json::from_str::<PythonRuntimeMarker>(&content).ok())
}

fn write_python_runtime_marker(env_dir: &Path, fingerprint: &str) -> Result<(), String> {
    let marker = PythonRuntimeMarker {
        fingerprint: fingerprint.to_string(),
        required_modules: REQUIRED_PYTHON_PACKAGES.iter().map(|pkg| pkg.to_string()).collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let marker_path = get_python_runtime_marker_path(env_dir);
    let content = serde_json::to_string_pretty(&marker)
        .map_err(|e| format!("Failed to serialize runtime marker: {}", e))?;
    std::fs::write(&marker_path, content)
        .map_err(|e| format!("Failed to write runtime marker '{}': {}", marker_path.display(), e))
}

fn save_python_setup_diagnostics(diagnostics: &PythonSetupDiagnostics) {
    let path = get_python_setup_diagnostics_path();
    if let Ok(content) = serde_json::to_string_pretty(diagnostics) {
        let _ = std::fs::write(path, content);
    }
}

fn truncate_diagnostic_details(details: &str) -> String {
    const MAX_LEN: usize = 4000;

    let trimmed = details.trim();
    if trimmed.len() <= MAX_LEN {
        return trimmed.to_string();
    }

    format!("{}...", &trimmed[..MAX_LEN])
}

fn detect_missing_python_modules(python_exe: &Path, modules: &[&str]) -> Vec<String> {
    modules
        .iter()
        .filter_map(|module| {
            let mut check_cmd = Command::new(python_exe);
            check_cmd.args(&["-c", &format!("import {}", module)]);
            #[cfg(target_os = "windows")]
            check_cmd.creation_flags(CREATE_NO_WINDOW);

            if check_cmd
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
            {
                None
            } else {
                Some((*module).to_string())
            }
        })
        .collect()
}

fn run_python_command_capture(
    python_exe: &Path,
    args: &[String],
    current_dir: Option<&Path>,
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(python_exe);
    cmd.args(args);
    if let Some(dir) = current_dir {
        cmd.current_dir(dir);
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.output().map_err(|error| {
        format!(
            "Failed to run '{} {}': {}",
            python_exe.display(),
            args.join(" "),
            error
        )
    })
}

fn run_python_step(
    python_exe: &Path,
    env_dir: &Path,
    label: &str,
    args: Vec<String>,
    diagnostics: &mut PythonSetupDiagnostics,
) -> Result<(), String> {
    let output = run_python_command_capture(python_exe, &args, Some(env_dir))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut details = String::new();

    if !stdout.is_empty() {
        details.push_str(&stdout);
    }
    if !stderr.is_empty() {
        if !details.is_empty() {
            details.push_str("\n\n");
        }
        details.push_str(&stderr);
    }
    if details.is_empty() {
        details.push_str("No output captured.");
    }

    diagnostics.attempts.push(PythonSetupAttempt {
        label: label.to_string(),
        command: format!("{} {}", python_exe.display(), args.join(" ")),
        success: output.status.success(),
        details: truncate_diagnostic_details(&details),
    });
    save_python_setup_diagnostics(diagnostics);

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("{} failed: {}", label, truncate_diagnostic_details(&details)))
    }
}

fn run_best_effort_python_step(
    python_exe: &Path,
    env_dir: &Path,
    label: &str,
    args: Vec<String>,
    diagnostics: &mut PythonSetupDiagnostics,
) {
    if let Err(error) = run_python_step(python_exe, env_dir, label, args, diagnostics) {
        diagnostics.warnings.push(error);
        save_python_setup_diagnostics(diagnostics);
    }
}

fn install_python_packages(
    python_exe: &Path,
    env_dir: &Path,
    label: &str,
    packages: &[&str],
) -> Result<(), String> {
    let mut args = vec![
        "-m".to_string(),
        "pip".to_string(),
        "install".to_string(),
    ];
    args.extend(packages.iter().map(|pkg| pkg.to_string()));
    args.extend([
        "--no-warn-script-location".to_string(),
        "--no-cache-dir".to_string(),
    ]);

    let output = run_python_command_capture(python_exe, &args, Some(env_dir))?;
    if output.status.success() {
        Ok(())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let details = if !stderr.is_empty() { stderr } else { stdout };
        Err(format!("{} failed: {}", label, truncate_diagnostic_details(&details)))
    }
}

fn run_python_eval(python_exe: &Path, script: &str) -> Option<String> {
    let output = run_python_command_capture(python_exe, &["-c".into(), script.into()], None).ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn torch_package_versions(python_exe: &Path) -> Option<(String, String)> {
    let script = r#"
import importlib

torch = importlib.import_module("torch")
try:
    torchaudio = importlib.import_module("torchaudio")
except ImportError:
    print("missing")
else:
    print(f"{torch.__version__}|{torchaudio.__version__}")
"#;

    let value = run_python_eval(python_exe, script)?;
    if value == "missing" {
        return None;
    }

    let mut parts = value.splitn(2, '|');
    let torch_version = parts.next()?.trim().to_string();
    let torchaudio_version = parts.next()?.trim().to_string();
    if torch_version.is_empty() || torchaudio_version.is_empty() {
        return None;
    }

    Some((torch_version, torchaudio_version))
}

fn normalize_torch_version(version: &str) -> String {
    version
        .split('+')
        .next()
        .unwrap_or(version)
        .trim()
        .to_string()
}

fn is_torch_stack_compatible(python_exe: &Path) -> bool {
    let Some((torch_version, torchaudio_version)) = torch_package_versions(python_exe) else {
        return false;
    };

    let torch_base = normalize_torch_version(&torch_version);
    let torchaudio_base = normalize_torch_version(&torchaudio_version);
    torch_base == STABLE_TORCH_VERSION && torchaudio_base == STABLE_TORCH_VERSION
}

fn verify_torch_cuda_available(python_exe: &Path) -> bool {
    run_python_eval(
        python_exe,
        "import torch; print('yes' if torch.cuda.is_available() else 'no')",
    )
    .map(|value| value == "yes")
    .unwrap_or(false)
}

fn install_torch_stack_variant(
    python_exe: &Path,
    env_dir: &Path,
    use_cuda: bool,
    force_reinstall: bool,
    diagnostics: &mut PythonSetupDiagnostics,
) -> Result<(), String> {
    let (label, index_url, torch_wheel, torchaudio_wheel, torchvision_wheel) = if use_cuda {
        (
            format!("Pin PyTorch {} CUDA stack", STABLE_TORCH_VERSION),
            "https://download.pytorch.org/whl/cu121",
            format!("torch=={}+cu121", STABLE_TORCH_VERSION),
            format!("torchaudio=={}+cu121", STABLE_TORCH_VERSION),
            format!("torchvision=={}+cu121", STABLE_TORCHVISION_VERSION),
        )
    } else {
        (
            format!("Pin PyTorch {} CPU stack", STABLE_TORCH_VERSION),
            "https://download.pytorch.org/whl/cpu",
            format!("torch=={}+cpu", STABLE_TORCH_VERSION),
            format!("torchaudio=={}+cpu", STABLE_TORCH_VERSION),
            format!("torchvision=={}+cpu", STABLE_TORCHVISION_VERSION),
        )
    };

    let mut args = vec![
        "-m".into(),
        "pip".into(),
        "install".into(),
        torch_wheel,
        torchaudio_wheel,
        torchvision_wheel,
        "--index-url".into(),
        index_url.into(),
        "--no-warn-script-location".into(),
        "--no-cache-dir".into(),
    ];
    if force_reinstall {
        args.push("--force-reinstall".into());
    }

    run_python_step(python_exe, env_dir, &label, args, diagnostics)?;
    diagnostics.selected_strategy = Some(label);
    save_python_setup_diagnostics(diagnostics);
    Ok(())
}

fn pin_torch_stack(
    python_exe: &Path,
    env_dir: &Path,
    prefer_cuda: bool,
    force_reinstall: bool,
    diagnostics: &mut PythonSetupDiagnostics,
) -> Result<(), String> {
    if prefer_cuda {
        install_torch_stack_variant(python_exe, env_dir, true, force_reinstall, diagnostics)?;
        if verify_torch_cuda_available(python_exe) {
            return Ok(());
        }

        diagnostics.warnings.push(
            "CUDA PyTorch installed but torch.cuda.is_available() is still false. Falling back to CPU stack. Update NVIDIA drivers if you expect GPU acceleration."
                .into(),
        );
        save_python_setup_diagnostics(diagnostics);
    }

    install_torch_stack_variant(python_exe, env_dir, false, force_reinstall, diagnostics)
}

fn cleanup_conflicting_torch_packages(
    python_exe: &Path,
    env_dir: &Path,
    diagnostics: &mut PythonSetupDiagnostics,
) {
    // MDX-Net ONNX models need torchvision; pin a build that matches the installed torch stack.
    let use_cuda = verify_torch_cuda_available(python_exe);
    let _ = install_torch_stack_variant(python_exe, env_dir, use_cuda, false, diagnostics);
}

fn should_upgrade_torch_to_cuda(python_exe: &Path, has_nvidia: bool) -> bool {
    has_nvidia && !verify_torch_cuda_available(python_exe)
}

fn generate_hardware_config_for_split(
    python_exe: &Path,
    script_dir: &Path,
) -> Result<std::path::PathBuf, String> {
    let hardware_script = script_dir.join("hardware.py");
    if !hardware_script.exists() {
        return Err(format!(
            "hardware.py not found at {}",
            hardware_script.display()
        ));
    }

    let output = run_python_command_capture(
        python_exe,
        &[
            hardware_script.to_string_lossy().to_string(),
        ],
        Some(script_dir),
    )?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "hardware.py failed to detect processing configuration".into()
        } else {
            stderr
        });
    }

    let config_path = script_dir.join("hardware_config.json");
    if config_path.exists() {
        Ok(config_path)
    } else {
        Err("hardware.py did not write hardware_config.json".into())
    }
}

fn read_splitter_log_tail(max_lines: usize) -> String {
    let log_path = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("StemSplit")
        .join("logs")
        .join("splitter.log");

    let content = match std::fs::read_to_string(&log_path) {
        Ok(content) => content,
        Err(_) => return String::new(),
    };

    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return String::new();
    }

    const RUN_MARKER: &str = "SEPARATOR ENGINE: STARTING SEPARATION PIPELINE";
    let mut last_run_start = lines.len().saturating_sub(max_lines);
    for (index, line) in lines.iter().enumerate() {
        if line.contains(RUN_MARKER) {
            last_run_start = index;
        }
    }

    let end = lines.len();
    let start = last_run_start.max(end.saturating_sub(max_lines));
    lines[start..end].join("\n")
}

fn stderr_looks_like_warnings_only(stderr: &str) -> bool {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        return true;
    }

    trimmed
        .lines()
        .filter(|line| !line.trim().is_empty())
        .all(|line| {
            let lower = line.to_lowercase();
            lower.contains("futurewarning")
                || lower.contains("deprecationwarning")
                || lower.contains("userwarning")
                || lower.contains("warnings.warn")
        })
}

fn format_manifest_process_failure(
    status_code: i32,
    manifest_content: &str,
    stderr_output: &str,
) -> String {
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(manifest_content) {
        let timestamp = parsed
            .get("timestamp")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let errors: Vec<String> = parsed
            .get("errors")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        if !errors.is_empty() {
            let mut message = format!(
                "Stem separation failed (Python exit code {}, run at {}).",
                status_code, timestamp
            );
            message.push_str("\n\n");
            for error in errors {
                message.push_str(&format!("• {}\n", error));
            }

            let log_tail = read_splitter_log_tail(12);
            if !log_tail.is_empty() {
                message.push_str("\nRecent splitter log:\n");
                message.push_str(&log_tail);
            }
            return message;
        }
    }

    format_python_process_failure(status_code, stderr_output)
}

fn format_python_process_failure(status_code: i32, stderr_output: &str) -> String {
    let log_tail = read_splitter_log_tail(20);
    let stderr_trimmed = stderr_output.trim();

    let mut message = format!("Stem separation failed (Python exit code {}).", status_code);
    if status_code == -1 {
        message.push_str(" The process crashed during Demucs inference — usually a broken PyTorch install.");
    } else if status_code == 2 {
        message.push_str(
            " Python rejected CLI arguments before separation started (often a stale build or unsupported option).",
        );
    }

    // Prefer fresh stderr for early failures — log file may be from an older run.
    if !stderr_trimmed.is_empty() && !stderr_looks_like_warnings_only(stderr_trimmed) {
        message.push_str("\n\nDetails:\n");
        message.push_str(stderr_trimmed);
    }

    if !log_tail.is_empty() {
        message.push_str("\n\nRecent splitter log:\n");
        message.push_str(&log_tail);
    } else if stderr_trimmed.is_empty() {
        message.push_str(
            "\n\nNo stderr captured. Check %LOCALAPPDATA%\\StemSplit\\logs\\splitter.log or run Deep Repair from Settings.",
        );
    }

    message
}

fn install_first_working_plan(
    python_exe: &Path,
    env_dir: &Path,
    plans: Vec<PipInstallPlan>,
    diagnostics: &mut PythonSetupDiagnostics,
) -> Result<String, String> {
    let mut failures = Vec::new();

    for plan in plans {
        match run_python_step(python_exe, env_dir, &plan.label, plan.args, diagnostics) {
            Ok(()) => {
                diagnostics.selected_strategy = Some(plan.label.clone());
                save_python_setup_diagnostics(diagnostics);
                return Ok(plan.label);
            }
            Err(error) => failures.push(error),
        }
    }

    Err(failures.join(" | "))
}

fn clear_python_env_state(env_dir: &Path) -> Result<(), String> {
    if !env_dir.exists() {
        return Ok(());
    }

    let mut last_error: Option<String> = None;
    for _ in 0..3 {
        match std::fs::remove_dir_all(env_dir) {
            Ok(_) => {
                return Ok(());
            }
            Err(error) => {
                last_error = Some(error.to_string());
                std::thread::sleep(std::time::Duration::from_millis(700));
            }
        }
    }

    Err(format!(
        "Failed to clear existing runtime state at '{}': {}",
        env_dir.display(),
        last_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

#[tauri::command]
async fn check_python_status() -> Result<PythonStatus, String> {
    let env_dir = get_python_env_dir();
    let python_exe = get_python_executable();
    
    if let Some(ref exe) = python_exe {
        // Check version
        let mut cmd = Command::new(exe);
        cmd.arg("--version");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        
        let version = cmd.output().ok().and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

            if !stdout.is_empty() {
                Some(stdout)
            } else if !stderr.is_empty() {
                Some(stderr)
            } else {
                None
            }
        });
        
        // Fast path: trust marker when runtime fingerprint matches expected anchors.
        let marker_valid = if let Some(marker) = read_python_runtime_marker(&env_dir) {
            let expected_modules: Vec<String> = REQUIRED_PYTHON_PACKAGES
                .iter()
                .map(|pkg| pkg.to_string())
                .collect();

            if marker.required_modules != expected_modules {
                false
            } else {
                build_python_runtime_fingerprint(&env_dir)
                    .map(|fingerprint| fingerprint == marker.fingerprint)
                    .unwrap_or(false)
            }
        } else {
            false
        };

        // If marker is stale/missing, fall back to import checks.
        let missing = if marker_valid {
            Vec::new()
        } else {
            detect_missing_python_modules(exe, &REQUIRED_PYTHON_PACKAGES)
        };
        
        Ok(PythonStatus {
            installed: true,
            path: Some(exe.to_string_lossy().to_string()),
            version,
            packages_installed: missing.is_empty(),
            missing_packages: missing,
        })
    } else {
        Ok(PythonStatus {
            installed: false,
            path: None,
            version: None,
            packages_installed: false,
            missing_packages: REQUIRED_PYTHON_PACKAGES.iter().map(|pkg| pkg.to_string()).collect(),
        })
    }
}

#[tauri::command]
async fn setup_python_environment(window: tauri::Window) -> Result<String, String> {
    let env_dir = get_python_env_dir();
    let diagnostics_path = get_python_setup_diagnostics_path();
    let system_profile = hardware::get_system_profile().await.unwrap_or_else(|_| hardware::SystemProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        has_nvidia: false,
        has_apple_silicon: cfg!(all(target_os = "macos", target_arch = "aarch64")),
        recommended_payload: if cfg!(target_os = "windows") {
            "python_env_win_cpu.zip".to_string()
        } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            "python_env_mac_arm64.zip".to_string()
        } else if cfg!(target_os = "macos") {
            "python_env_mac_x64.zip".to_string()
        } else {
            "python_env_linux.zip".to_string()
        },
        gpu_name: None,
        gpu_vram_gb: None,
        nvidia_driver_version: None,
    });
    let mut diagnostics = PythonSetupDiagnostics {
        started_at: chrono::Utc::now().to_rfc3339(),
        env_dir: env_dir.to_string_lossy().to_string(),
        selected_strategy: None,
        attempts: Vec::new(),
        warnings: Vec::new(),
    };
    save_python_setup_diagnostics(&diagnostics);
    
    // Create directory if needed
    std::fs::create_dir_all(&env_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
    
    // Emit progress
    let emit_progress = |msg: &str, pct: u32| {
        let _ = window.emit("python-setup-progress", serde_json::json!({
            "message": msg,
            "percent": pct
        }));
    };
    
    emit_progress("Starting Python environment setup...", 0);
    let gpu_summary = if let Some(ref gpu_name) = system_profile.gpu_name {
        let vram = system_profile
            .gpu_vram_gb
            .map(|gb| format!("{gb:.1}GB VRAM"))
            .unwrap_or_else(|| "VRAM unknown".to_string());
        format!(" | GPU: {gpu_name} ({vram})")
    } else {
        String::new()
    };
    emit_progress(
        &format!(
            "Detected {} / {}{} -> {}",
            system_profile.os,
            system_profile.arch,
            gpu_summary,
            system_profile.recommended_payload
        ),
        2,
    );
    
    #[cfg(target_os = "windows")]
    {
        if let Some(existing_python) = find_windows_python_executable(&env_dir) {
            let missing = detect_missing_python_modules(&existing_python, &REQUIRED_PYTHON_PACKAGES);
            if missing.is_empty() && is_torch_stack_compatible(&existing_python) {
                if should_upgrade_torch_to_cuda(&existing_python, system_profile.has_nvidia) {
                    diagnostics.warnings.push(
                        "Upgrading CPU-only PyTorch to CUDA because an NVIDIA GPU was detected."
                            .into(),
                    );
                    save_python_setup_diagnostics(&diagnostics);
                    emit_progress("Upgrading PyTorch for GPU acceleration...", 20);
                    pin_torch_stack(
                        &existing_python,
                        &env_dir,
                        true,
                        true,
                        &mut diagnostics,
                    )?;
                    cleanup_conflicting_torch_packages(
                        &existing_python,
                        &env_dir,
                        &mut diagnostics,
                    );
                    if verify_torch_cuda_available(&existing_python) {
                        emit_progress("GPU-accelerated PyTorch is ready.", 100);
                    } else {
                        emit_progress("PyTorch ready (CPU fallback — check NVIDIA drivers).", 100);
                    }
                    if let Ok(fingerprint) = build_python_runtime_fingerprint(&env_dir) {
                        let _ = write_python_runtime_marker(&env_dir, &fingerprint);
                    }
                    return Ok("Python environment ready (GPU PyTorch upgrade attempted)".into());
                }

                if let Ok(fingerprint) = build_python_runtime_fingerprint(&env_dir) {
                    let _ = write_python_runtime_marker(&env_dir, &fingerprint);
                }
                emit_progress("Existing Python runtime is already ready.", 100);
                return Ok("Python environment ready".into());
            }

            if missing.is_empty() && !is_torch_stack_compatible(&existing_python) {
                diagnostics.warnings.push(
                    "Repairing existing runtime because PyTorch and torchaudio versions are mismatched."
                        .into(),
                );
                save_python_setup_diagnostics(&diagnostics);
                emit_progress("Repairing mismatched PyTorch stack...", 12);
                pin_torch_stack(
                    &existing_python,
                    &env_dir,
                    system_profile.has_nvidia,
                    true,
                    &mut diagnostics,
                )?;
                if let Ok(fingerprint) = build_python_runtime_fingerprint(&env_dir) {
                    let _ = write_python_runtime_marker(&env_dir, &fingerprint);
                }
                emit_progress("PyTorch stack repaired.", 100);
                return Ok("Python environment ready (PyTorch stack repaired)".into());
            }

            diagnostics.warnings.push(format!(
                "Repairing existing runtime because these core packages are missing: {}",
                missing.join(", ")
            ));
            save_python_setup_diagnostics(&diagnostics);
            emit_progress("Repairing existing Python runtime...", 8);
        }

        let payload_url = format!("{}/{}", get_asset_base_url(), system_profile.recommended_payload);
        let payload_zip_path = env_dir.join("runtime_payload.zip");
        let runtime_checksum = std::env::var("STEMSPLIT_RUNTIME_PAYLOAD_SHA256").ok();

        emit_progress(
            &format!(
                "Trying optimized runtime package ({})...",
                system_profile.recommended_payload
            ),
            5,
        );

        let prebuilt_ready = match downloader::stream_download_to_path(
            &window,
            &payload_url,
            &payload_zip_path,
            "python-setup-progress",
            runtime_checksum.as_deref(),
        ).await {
            Ok(_) => {
                emit_progress("Extracting optimized runtime package...", 20);
                match extract_zip(&payload_zip_path, &env_dir) {
                    Ok(_) => {
                        if let Some(python_exe) = find_windows_python_executable(&env_dir) {
                            if is_python_runtime_ready(&python_exe) {
                                if let Ok(fingerprint) = build_python_runtime_fingerprint(&env_dir) {
                                    let _ = write_python_runtime_marker(&env_dir, &fingerprint);
                                }
                                emit_progress("Optimized runtime package ready", 100);
                                std::fs::remove_file(&payload_zip_path).ok();
                                return Ok("Python environment ready (prebuilt runtime)".into());
                            }
                        }
                        diagnostics.warnings.push("Optimized runtime package extracted but core imports failed, continuing with repair install.".into());
                        save_python_setup_diagnostics(&diagnostics);
                        false
                    }
                    Err(error) => {
                        diagnostics.warnings.push(format!("Optimized runtime extract failed: {}", error));
                        save_python_setup_diagnostics(&diagnostics);
                        false
                    }
                }
            }
            Err(error) => {
                diagnostics.warnings.push(format!("Optimized runtime download failed: {}", error));
                save_python_setup_diagnostics(&diagnostics);
                false
            }
        };

        if !prebuilt_ready {
            emit_progress("Optimized package unavailable, switching to standard setup...", 18);
        }

        let python_exe = env_dir.join("python.exe");
        if !python_exe.exists() {
            emit_progress("Downloading Python 3.10...", 20);
            let python_url = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip";
            let zip_path = env_dir.join("python.zip");

            downloader::stream_download_to_path(&window, python_url, &zip_path, "python-setup-progress", None).await?;

            emit_progress("Extracting Python...", 28);
            extract_zip(&zip_path, &env_dir)?;
            std::fs::remove_file(&zip_path).ok();
        }

        let pth_file = env_dir.join("python310._pth");
        if pth_file.exists() {
            let content = std::fs::read_to_string(&pth_file).unwrap_or_default();
            let new_content = content.replace("#import site", "import site");
            std::fs::write(&pth_file, new_content).ok();
        }

        let pip_exe = env_dir.join("Scripts").join("pip.exe");
        if !pip_exe.exists() {
            emit_progress("Installing pip...", 34);
            let getpip_url = "https://bootstrap.pypa.io/get-pip.py";
            let getpip_path = env_dir.join("get-pip.py");
            downloader::stream_download_to_path(&window, getpip_url, &getpip_path, "python-setup-progress", None).await?;

            run_python_step(
                &python_exe,
                &env_dir,
                "Bootstrap pip",
                vec![
                    getpip_path.to_string_lossy().to_string(),
                    "--no-warn-script-location".into(),
                ],
                &mut diagnostics,
            )?;
            std::fs::remove_file(&getpip_path).ok();
        }

        emit_progress("Preparing installer toolchain...", 38);
        run_best_effort_python_step(
            &python_exe,
            &env_dir,
            "Upgrade pip tooling",
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                "--upgrade".into(),
                "pip".into(),
                "setuptools".into(),
                "wheel".into(),
                "--no-warn-script-location".into(),
                "--no-cache-dir".into(),
            ],
            &mut diagnostics,
        );

        emit_progress("Installing PyTorch runtime...", 45);
        let mut torch_plans = Vec::new();
        if system_profile.has_nvidia {
            torch_plans.push(PipInstallPlan {
                label: "PyTorch 2.5.1 CUDA 12.1".into(),
                args: vec![
                    "-m".into(), "pip".into(), "install".into(),
                    format!("torch=={}+cu121", STABLE_TORCH_VERSION),
                    format!("torchaudio=={}+cu121", STABLE_TORCH_VERSION),
                    "--index-url".into(), "https://download.pytorch.org/whl/cu121".into(),
                    "--no-warn-script-location".into(), "--no-cache-dir".into(),
                ],
            });
        }
        torch_plans.push(PipInstallPlan {
            label: "PyTorch 2.5.1 CPU".into(),
            args: vec![
                "-m".into(), "pip".into(), "install".into(),
                format!("torch=={}+cpu", STABLE_TORCH_VERSION),
                format!("torchaudio=={}+cpu", STABLE_TORCH_VERSION),
                "--index-url".into(), "https://download.pytorch.org/whl/cpu".into(),
                "--no-warn-script-location".into(), "--no-cache-dir".into(),
            ],
        });
        torch_plans.push(PipInstallPlan {
            label: "PyTorch 2.5.1 default wheel".into(),
            args: vec![
                "-m".into(), "pip".into(), "install".into(),
                format!("torch=={}", STABLE_TORCH_VERSION),
                format!("torchaudio=={}", STABLE_TORCH_VERSION),
                "--no-warn-script-location".into(), "--no-cache-dir".into(),
            ],
        });
        let selected_torch = install_first_working_plan(&python_exe, &env_dir, torch_plans, &mut diagnostics)?;
        if selected_torch.contains("CUDA") && !verify_torch_cuda_available(&python_exe) {
            diagnostics.warnings.push(
                "CUDA PyTorch installed but no working GPU runtime was detected; falling back to CPU stack."
                    .into(),
            );
            save_python_setup_diagnostics(&diagnostics);
            pin_torch_stack(&python_exe, &env_dir, false, true, &mut diagnostics)?;
        }

        emit_progress("Installing Demucs core...", 68);
        run_python_step(
            &python_exe,
            &env_dir,
            "Install Demucs",
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                format!("demucs=={}", STABLE_DEMUCS_VERSION),
                "--no-warn-script-location".into(),
                "--no-cache-dir".into(),
            ],
            &mut diagnostics,
        )?;

        emit_progress("Installing core audio libraries...", 82);
        run_python_step(
            &python_exe,
            &env_dir,
            "Install core audio libraries",
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                "librosa".into(),
                "soundfile".into(),
                "numpy".into(),
                "resampy".into(),
                "tqdm".into(),
                "--no-warn-script-location".into(),
                "--no-cache-dir".into(),
            ],
            &mut diagnostics,
        )?;

        emit_progress("Installing free-tier Spleeter engine...", 88);
        run_best_effort_python_step(
            &python_exe,
            &env_dir,
            "Install Spleeter for free-tier splits",
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                "spleeter==2.4.0".into(),
                "tensorflow==2.9.3".into(),
                "--no-warn-script-location".into(),
                "--no-cache-dir".into(),
            ],
            &mut diagnostics,
        );

        emit_progress("Installing optional enhancement packages...", 92);
        run_best_effort_python_step(
            &python_exe,
            &env_dir,
            "Install optional enhancement packages",
            vec![
                "-m".into(),
                "pip".into(),
                "install".into(),
                "pedalboard>=0.8.0".into(),
                "pydub>=0.25.1".into(),
                "psutil".into(),
                "pynvml".into(),
                "sounddevice".into(),
                "pyloudnorm".into(),
                "audio-separator[cpu]".into(),
                "yt-dlp".into(),
                "openai-whisper".into(),
                "--no-warn-script-location".into(),
                "--no-cache-dir".into(),
            ],
            &mut diagnostics,
        );

        emit_progress("Pinning PyTorch stack...", 95);
        pin_torch_stack(
            &python_exe,
            &env_dir,
            system_profile.has_nvidia,
            true,
            &mut diagnostics,
        )?;
        cleanup_conflicting_torch_packages(&python_exe, &env_dir, &mut diagnostics);

        let missing = detect_missing_python_modules(&python_exe, &REQUIRED_PYTHON_PACKAGES);
        if !missing.is_empty() {
            return Err(format!(
                "Python runtime repair completed but core packages are still missing: {}. Diagnostics: {}",
                missing.join(", "),
                diagnostics_path.display()
            ));
        }

        let optional_missing = detect_missing_python_modules(&python_exe, &OPTIONAL_PYTHON_PACKAGES);
        if !optional_missing.is_empty() {
            diagnostics.warnings.push(format!(
                "Optional packages unavailable: {}",
                optional_missing.join(", ")
            ));
            save_python_setup_diagnostics(&diagnostics);
        }

        if let Ok(fingerprint) = build_python_runtime_fingerprint(&env_dir) {
            let _ = write_python_runtime_marker(&env_dir, &fingerprint);
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        emit_progress("Setting up Python environment...", 5);
        
        // Check if system python3 exists
        let has_python = Command::new("python3").arg("--version").output().map(|o| o.status.success()).unwrap_or(false);
        
        if !has_python {
            return Err("Python 3 not found. Please install Python from python.org or via Homebrew: brew install python@3.10".into());
        }
        
        // Check if FFmpeg is available
        let has_ffmpeg = Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false);
        if !has_ffmpeg {
            emit_progress("Note: FFmpeg not found. Install via: brew install ffmpeg", 8);
        }
        
        // Create venv in our app directory
        emit_progress("Creating virtual environment...", 10);
        let mut cmd = Command::new("python3");
        cmd.args(&["-m", "venv", env_dir.to_str().unwrap()]);
        let result = cmd.output().map_err(|e| format!("Failed to create venv: {}", e))?;
        if !result.status.success() {
            return Err("Failed to create Python virtual environment".into());
        }
        
        let pip_path = env_dir.join("bin").join("pip3");
        
        // Upgrade pip first
        emit_progress("Upgrading pip...", 15);
        let mut cmd = Command::new(&pip_path);
        cmd.args(&["install", "--upgrade", "pip", "setuptools", "wheel"]);
        cmd.output().ok();
        
        emit_progress("Installing PyTorch (this may take several minutes)...", 20);
        let mut cmd = Command::new(&pip_path);
        cmd.args(&["install", "torch", "torchvision", "torchaudio"]);
        let result = cmd.output().map_err(|e| format!("Failed to install torch: {}", e))?;
        if !result.status.success() {
            return Err(format!("PyTorch installation failed: {}", String::from_utf8_lossy(&result.stderr)));
        }
        
        emit_progress("Installing Demucs...", 50);
        let mut cmd = Command::new(&pip_path);
        cmd.args(&["install", "demucs"]);
        let result = cmd.output().map_err(|e| format!("Failed to install demucs: {}", e))?;
        if !result.status.success() {
            return Err(format!("Demucs installation failed: {}", String::from_utf8_lossy(&result.stderr)));
        }
        
        emit_progress("Installing audio libraries...", 75);
        let mut cmd = Command::new(&pip_path);
        cmd.args(&["install", "librosa", "soundfile", "pedalboard", "pydub", "numpy", "resampy", "tqdm", "psutil", "pyloudnorm", "sounddevice", "yt-dlp", "openai-whisper"]);
        let result = cmd.output().map_err(|e| format!("Failed to install packages: {}", e))?;
        if !result.status.success() {
            return Err(format!("Package installation failed: {}", String::from_utf8_lossy(&result.stderr)));
        }
    }
    
    emit_progress("Setup complete!", 100);
    if diagnostics.warnings.is_empty() {
        Ok("Python environment ready".into())
    } else {
        Ok(format!(
            "Python environment ready with optional features deferred. Diagnostics: {}",
            diagnostics_path.display()
        ))
    }
}

#[tauri::command]
async fn deep_repair_python_environment(window: tauri::Window) -> Result<String, String> {
    let env_dir = get_python_env_dir();
    let emit_progress = |msg: &str, pct: u32| {
        let _ = window.emit("python-setup-progress", serde_json::json!({
            "message": msg,
            "percent": pct
        }));
    };

    emit_progress("Deep Repair: preparing aggressive runtime reset...", 2);

    let staged_attempts = vec![
        (
            "primary",
            None::<&str>,
            None::<&str>,
            "Deep Repair: reinstalling from primary sources...",
        ),
        (
            "mirror-pypi-cpu",
            Some("https://pypi.org/simple"),
            Some("https://download.pytorch.org/whl/cpu"),
            "Deep Repair: retrying with staged mirror sources...",
        ),
    ];

    let original_pip_index_url = std::env::var("PIP_INDEX_URL").ok();
    let original_pip_extra_index_url = std::env::var("PIP_EXTRA_INDEX_URL").ok();

    let mut failures: Vec<String> = Vec::new();

    for (index, (label, pip_index, pip_extra, msg)) in staged_attempts.iter().enumerate() {
        emit_progress(msg, if index == 0 { 8 } else { 18 });

        clear_python_env_state(&env_dir)?;
        std::fs::create_dir_all(&env_dir)
            .map_err(|e| format!("Failed to recreate runtime folder: {}", e))?;

        if let Some(value) = pip_index {
            std::env::set_var("PIP_INDEX_URL", value);
        } else {
            std::env::remove_var("PIP_INDEX_URL");
        }

        if let Some(value) = pip_extra {
            std::env::set_var("PIP_EXTRA_INDEX_URL", value);
        } else {
            std::env::remove_var("PIP_EXTRA_INDEX_URL");
        }

        match setup_python_environment(window.clone()).await {
            Ok(message) => {
                match &original_pip_index_url {
                    Some(value) => std::env::set_var("PIP_INDEX_URL", value),
                    None => std::env::remove_var("PIP_INDEX_URL"),
                }
                match &original_pip_extra_index_url {
                    Some(value) => std::env::set_var("PIP_EXTRA_INDEX_URL", value),
                    None => std::env::remove_var("PIP_EXTRA_INDEX_URL"),
                }
                emit_progress("Deep Repair complete.", 100);
                return Ok(format!("Deep Repair completed via {} path. {}", label, message));
            }
            Err(error) => {
                failures.push(format!("{} attempt failed: {}", label, error));
            }
        }
    }

    match &original_pip_index_url {
        Some(value) => std::env::set_var("PIP_INDEX_URL", value),
        None => std::env::remove_var("PIP_INDEX_URL"),
    }
    match &original_pip_extra_index_url {
        Some(value) => std::env::set_var("PIP_EXTRA_INDEX_URL", value),
        None => std::env::remove_var("PIP_EXTRA_INDEX_URL"),
    }

    Err(format!(
        "Deep Repair failed after staged retries. {}",
        failures.join(" | ")
    ))
}

#[tauri::command]
async fn install_support_asset(
    request: SupportAssetRequest,
    window: tauri::Window,
) -> Result<SupportAssetInstallResult, String> {
    let app_root = get_app_root_dir()?;
    let destination_dir = app_root.join(&request.relative_destination);
    let cache_dir = app_root.join("downloads");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create download cache: {}", e))?;
    std::fs::create_dir_all(&destination_dir)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;

    let asset_filename = request
        .download_url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("support_asset.zip");
    let archive_path = cache_dir.join(asset_filename);

    downloader::stream_download_to_path(
        &window,
        &request.download_url,
        &archive_path,
        "support-asset-download-progress",
        request.checksum.as_deref(),
    ).await?;

    extract_zip(&archive_path, &destination_dir)?;

    Ok(SupportAssetInstallResult {
        asset_name: request.asset_name,
        installed_to: destination_dir.to_string_lossy().to_string(),
    })
}

fn extract_zip(zip_path: &std::path::Path, dest_dir: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Zip error: {}", e))?;
        let outpath = dest_dir.join(file.name());
        
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p).ok();
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("Failed to extract: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn health_check() -> Result<String, String> {
    Ok(serde_json::json!({
        "status": "healthy",
        "version": env!("CARGO_PKG_VERSION"),
        "python_available": check_python_available(),
    }).to_string())
}

fn check_python_available() -> bool {
    let mut cmd = Command::new("python");
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            enforce_window_security_policy(&app.app_handle());
            tauri::async_runtime::spawn(async {
                flush_queued_security_incidents().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute_splice,
            preprocess_audio_for_split,
            download_youtube_audio,
            transcribe_audio,
            cancel_stem_split,
            get_separator_status,
            health_check,
            open_results_folder,
            read_audio_file,
            apply_stem_fx,
            preview_vst_plugin,
            stop_vst_plugin,
            check_python_status,
            setup_python_environment,
            deep_repair_python_environment,
            install_support_asset,
            // License commands
            get_license_status,
            activate_license,
            deactivate_license,
            register_free_user,
            login_free_user,
            get_free_user_session,
            logout_free_user,
            get_trial_cooldown_status,
            test_security_webhook,
            get_vst_entitlements_status,
            check_vst_access,
            sync_vst_entitlements_from_server,
            record_vst_usage,
            // Hardware and downloading
            hardware::get_system_profile,
            downloader::download_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
