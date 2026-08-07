# License auto-delivery (Gumroad + Shopify + Stripe)

## Policy: paid-only keys

**Pro license keys are issued and emailed only after a paid purchase.**

| Path | Gets Pro license key? | What they get |
|------|----------------------|---------------|
| Free download / free app signup | **No** | Verification code + free mode (Spleeter). No Pro key. |
| Website lead / welcome email | **No** | Welcome / marketing only. Explicitly says no key. |
| Stripe checkout completed | **Yes** | Hosted access password emailed |
| Gumroad sale ping | **Yes** | Gumroad `license_key` (preferred) emailed |
| Shopify `orders/paid` | **Yes** | Hosted access password emailed |
| Admin `/api/licenses/issue` | **Yes** | Support-issued Pro credential only |

Hard gates in code:
- `upsertLicense` rejects sources `free`, `download`, `lead`, `signup`, `welcome`, `onboarding`, `trial`
- `deliverActivationEmailAfterPurchase` / queue only allow `stripe`, `gumroad`, `shopify`, `admin`, `managed_pro`
- `sendProActivationEmail` refuses any email without a paid source

When a customer pays, the billing service must:
1. Create/update a Pro license for their email  
2. Email them the key automatically (Resend)

## Endpoints

| Store | Method | URL |
|-------|--------|-----|
| Stripe | POST | `https://YOUR-HOST/webhooks/stripe` |
| Gumroad | POST | `https://YOUR-HOST/webhooks/gumroad?secret=YOUR_SECRET` |
| Shopify | POST | `https://YOUR-HOST/webhooks/shopify` |

Host is usually `https://liminal-stemsplit.onrender.com` (or your billing service URL).

---

## Required environment variables

```
RESEND_API_KEY=re_...
FROM_EMAIL=Liminal StemSplit <onboarding@myaiplug.com>
SITE_URL=https://liminal-stemsplit.onrender.com
STEMSPLIT_DOWNLOAD_URL=https://github.com/myaiplug/liminal-stemsplit/releases/tag/v0.5.0

# Stripe
STRIPE_WEBHOOK_SECRET=whsec_...

# Gumroad (ping URL secret)
GUMROAD_WEBHOOK_SECRET=long-random-string

# Shopify (Admin API client secret — used for HMAC)
SHOPIFY_WEBHOOK_SECRET=shpss_...   # or SHOPIFY_API_SECRET
SHOPIFY_PRODUCT_NEEDLE=stemsplit|liminal|pro   # optional line-item filter

BILLING_ADMIN_TOKEN=...
```

Without `RESEND_API_KEY`, licenses are still saved but **email will not send**.

---

## Gumroad setup (auto license email)

1. Product → **Generate a unique license key per sale** = ON  
2. Advanced → **Ping** (webhook) URL:
   ```
   https://YOUR-HOST/webhooks/gumroad?secret=SAME_AS_GUMROAD_WEBHOOK_SECRET
   ```
3. Events: **Sale** (not only refund)

On each sale the service:
- Stores the buyer email + Gumroad `license_key` (and a hosted password if needed)
- Emails the customer **the Gumroad license key** (what they paste in Activate Pro)
- Queues retries if Resend/Render is cold

**Desktop:** Activate Pro with purchase email + that license key.

---

## Shopify setup (auto license email)

1. Shopify Admin → **Settings → Notifications → Webhooks**  
2. Create webhook:
   - Event: **Order payment** (`orders/paid`)  
   - Format: **JSON**  
   - URL: `https://YOUR-HOST/webhooks/shopify`  
3. Copy the **signing secret** into `SHOPIFY_WEBHOOK_SECRET`

On paid order the service:
- Filters line items by `SHOPIFY_PRODUCT_NEEDLE` (default matches stemsplit / liminal / pro)
- Issues a **hosted Pro password**
- Emails email + password for Activate Pro

**Note:** Shopify does not generate Gumroad-style keys; customers use the emailed access password.

Optional: only digital product shops with a single product can leave `SHOPIFY_PRODUCT_NEEDLE` broad.

---

## Stripe (already wired)

Checkout session completed → license + email. Same activation email template.

---

## Verify

```bash
# Health
curl https://YOUR-HOST/billing/health

# Gumroad smoke (local)
# See billing-service webhook-smoke.mjs / npm run billing:test:webhooks
```

Admin re-send:
```
POST /api/activation-emails/dispatch
{ "email": "buyer@example.com" }
```

---

## Customer experience

1. Buy on Gumroad / Shopify / Stripe  
2. Get email: **license key or access password** + download link  
3. Install WORKING .exe  
4. Activate Pro in app  

If email fails, license is still in DB — support can re-dispatch or issue via `/api/licenses/issue`.
