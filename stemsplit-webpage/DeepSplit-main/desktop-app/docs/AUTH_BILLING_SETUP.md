# Auth, Onboarding, and Billing Setup

This build supports:

- Free user signup/login (local app DB)
- Optional onboarding email send on signup
- Gumroad-first Pro activation
- Optional Stripe checkout link from the sales modal

## Environment Variables

Set these in your app environment:

- NEXT_PUBLIC_GUMROAD_PRODUCT_URL
  - Public URL for your Gumroad product page.
  - Example: <https://gumroad.com/l/stemsplit>

- NEXT_PUBLIC_STRIPE_CHECKOUT_URL
  - Public Stripe Checkout URL.
  - If missing, Stripe button shows as not configured.

- RESEND_API_KEY
  - API key used to send onboarding emails after free signup.

- STEMSPLIT_ONBOARDING_FROM
  - Sender email identity configured in Resend.
  - Example: StemSplit <welcome@yourdomain.com>

## Gumroad Activation Flow

1. User purchases on Gumroad.
2. User opens Pro Activation in-app.
3. User enters purchase email and Gumroad license key.
4. App verifies with Gumroad and unlocks Pro if valid.

## Stripe Flow (Current)

Current implementation provides checkout handoff only.
After Stripe purchase, users still need a mapped activation path.

Recommended production pattern:

1. Stripe checkout success -> webhook on your server.
2. Server creates or maps license credentials to user email.
3. User activates in app using email + issued license credential.

## Free User Auth Storage

Free users and session are stored locally per-machine in local app data under StemSplit.
For cloud/shared accounts across machines, move auth to a hosted backend service.

## Release Preflight (Optional Billing Gate)

You can run release preflight with billing smoke checks enabled:

```bash
python scripts/ci/release_preflight.py \
  --repo-root . \
  --json-out installers/release-preflight.json \
  --md-out installers/release-preflight.md \
  --run-billing-smoke
```

Notes:

- The billing webhook service must be running and reachable by the smoke script.
- Override the smoke command if needed via `--billing-smoke-command`.

## CI Automation

Automated billing preflight runs are configured in [billing-preflight.yml](../.github/workflows/billing-preflight.yml).

Trigger conditions:

- Manual run (`workflow_dispatch`)
- Pushes to `main` and `release/**` when billing/preflight files change

The workflow:

- Starts the billing webhook service in CI
- Runs release preflight with `--run-billing-smoke`
- Uploads JSON and Markdown preflight reports as artifacts

Recommended branch protection:

- Require status check: `Billing Preflight CI / billing-preflight`
- Apply to `main` and `release/*`
