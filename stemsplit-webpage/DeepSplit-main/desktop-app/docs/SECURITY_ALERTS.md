# Security Alerts Webhook

StemSplit sends security incidents (malicious upload attempts and lock/ban escalation) to a webhook endpoint.

## Required Environment Variable

Set this variable before launching the Tauri app:

- `STEMSPLIT_SECURITY_WEBHOOK_URL`

Optional but strongly recommended:

- `STEMSPLIT_SECURITY_WEBHOOK_SECRET`

Example (PowerShell):

```powershell
$env:STEMSPLIT_SECURITY_WEBHOOK_URL = "https://your-webhook-endpoint"
$env:STEMSPLIT_SECURITY_WEBHOOK_SECRET = "replace-with-a-long-random-secret"
```

## Reliability Behavior

- Delivery uses up to 3 retry attempts per incident.
- If all attempts fail, the incident is persisted for retry.
- Queued incidents are retried automatically on next app startup.
- Queue file path:
  - `%LOCALAPPDATA%\StemSplit\security_incident_queue.jsonl`

## Test the Webhook

Use the backend IPC command `test_security_webhook` (available through `testSecurityWebhook()` in `src/lib/tauri-bridge.ts`) to send a test incident payload.

## Payload Shape

```json
{
  "event": "malicious_upload_attempt",
  "timestamp_utc": "2026-03-25T19:20:30Z",
  "local_username": "alice",
  "machine_name": "DESKTOP-1234",
  "license_email": "user@example.com",
  "attempted_file_path": "C:/path/to/file.ext",
  "reason": "Suspicious upload detected: file signature does not match a supported audio format",
  "malicious_attempts": 2,
  "blocked_until_unix": 1770000000,
  "permanently_banned": false
}
```

## Signed Headers

When `STEMSPLIT_SECURITY_WEBHOOK_SECRET` is configured, requests include:

- `X-StemSplit-Event`
- `X-StemSplit-Timestamp`
- `X-StemSplit-Signature`
- `X-StemSplit-Signature-Alg: hmac-sha256`

`X-StemSplit-Signature` is `HMAC-SHA256(secret, raw_json_payload)` in lowercase hex.

Receiver recommendation:

- Recompute HMAC using the exact raw request body and shared secret.
- Reject if signatures differ.
- Optionally reject stale timestamps.

## Email Routing

To receive email notifications, point the webhook URL at an automation service (Zapier, Make, Pipedream, or your own API) that forwards incoming JSON payloads to your inbox.
