# StemSplit Billing Webhook Service

This service bridges Stripe and Gumroad purchases into hosted access credentials that the desktop app can validate.

## Endpoints

- POST /api/licenses/validate
  - Input: { "email": "user@example.com", "licenseKey": "credential-or-license" }
  - Used by the desktop app before native Gumroad validation.

- POST /webhooks/stripe
  - Handles Stripe `checkout.session.completed`
  - Creates or updates a hosted Pro credential for the checkout email.

- POST /webhooks/gumroad?secret=...
  - Handles Gumroad webhook posts.
  - Creates or updates a hosted Pro credential for the purchase email.
  - Can also preserve Gumroad `license_key` for direct validation.

- POST /api/licenses/issue
  - Manual issue/upsert endpoint for support workflows.
  - Requires Authorization: Bearer <BILLING_ADMIN_TOKEN>

- GET /api/licenses/admin/list
  - Admin-only list endpoint with safe redacted license records.
  - Requires Authorization: Bearer <BILLING_ADMIN_TOKEN>

- GET /health
  - Health probe.

## Required Environment Variables

- STRIPE_WEBHOOK_SECRET
- GUMROAD_WEBHOOK_SECRET
- BILLING_ADMIN_TOKEN
- BILLING_DB_PATH (optional)
- PORT (optional)

Optional:
- MAX_TRACKED_WEBHOOK_EVENTS (default: 20000)
  - Number of processed webhook event keys retained for replay defense.
- STRIPE_SIGNATURE_TOLERANCE_SEC (default: 300)
  - Maximum allowed clock skew for Stripe webhook signature timestamps.

## Start

Run:

```bash
npm run billing:webhooks
```

## Smoke Test

With the webhook service running, execute:

```bash
npm run billing:test:webhooks
```

The smoke test verifies:
- Stripe first delivery succeeds.
- Stripe duplicate delivery is ignored.
- Stripe stale timestamp signatures are rejected.
- Gumroad duplicate delivery suppression (when GUMROAD_WEBHOOK_SECRET is set).

Optional test variables:
- BILLING_TEST_BASE_URL (default: http://127.0.0.1:8787)

## App Integration

Set the desktop app env var:

- STEMSPLIT_LICENSE_SERVER_URL=https://billing.yourdomain.com

The app will:
1. Try hosted credential validation first.
2. Fall back to native Gumroad license verification.

## Recommended Production Flow

1. Gumroad remains the primary storefront.
2. Gumroad webhook issues hosted access credentials automatically.
3. Stripe remains optional and uses the same hosted credential system.
4. Desktop app accepts either:
   - Gumroad license key
   - Hosted access password

## Security Notes

- Replace local JSON storage with a real database before production scale.
- Put the service behind HTTPS.
- Admin endpoints are token-gated. Rotate BILLING_ADMIN_TOKEN regularly.
- Do not expose Stripe secret keys to the frontend.
- Stripe and Gumroad webhooks are idempotent in-process:
  - Stripe: deduped by event.id when available, otherwise by raw payload hash.
  - Gumroad: deduped by sale id when available, otherwise by raw payload hash.
- Stripe signatures use constant-time comparison and timestamp tolerance checks.
