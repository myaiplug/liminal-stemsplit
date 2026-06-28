import 'dotenv/config';
import { createHmac } from 'node:crypto';

const baseUrl = process.env.BILLING_TEST_BASE_URL || 'http://127.0.0.1:4001';
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function makeStripeSignature(secret, body, timestampSec) {
  const payload = `${timestampSec}.${body}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestampSec},v1=${signature}`;
}

async function run() {
  console.log('Production billing smoke test started');
  console.log(`Base URL: ${baseUrl}`);
  assertCondition(stripeSecret, 'STRIPE_WEBHOOK_SECRET is required');

  const healthRes = await fetch(`${baseUrl}/billing/health`);
  assertCondition(healthRes.ok, `billing/health failed: ${healthRes.status}`);
  const health = await healthRes.json();
  console.log('Readiness:', health.readiness);

  const email = `prod.smoke.${Date.now()}@example.com`;
  const password = `prod-pass-${Date.now()}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const stripeBodyObj = {
    id: `evt_prod_smoke_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_prod_smoke_${Date.now()}`,
        customer_email: email,
        metadata: { plan: 'pro', product: 'stemsplit_pro', access_password: password },
      },
    },
  };
  const stripeBody = JSON.stringify(stripeBodyObj);
  const stripeSignature = makeStripeSignature(stripeSecret, stripeBody, nowSec);

  const webhookRes = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': stripeSignature,
    },
    body: stripeBody,
  });
  const webhook = await webhookRes.json();
  assertCondition(webhookRes.status === 200, `Stripe webhook failed: ${webhookRes.status}`);
  assertCondition(webhook.ok === true, 'Stripe webhook did not return ok=true');
  console.log('Webhook:', {
    emailSent: webhook.emailSent,
    emailQueued: webhook.emailQueued,
    emailError: webhook.emailError,
  });

  const dispatchRes = await fetch(`${baseUrl}/api/activation-emails/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const dispatch = await dispatchRes.json();
  console.log('Dispatch:', dispatch);

  const healthAfterRes = await fetch(`${baseUrl}/billing/health`);
  const healthAfter = await healthAfterRes.json();
  console.log('Queue:', healthAfter.activationEmailQueue);

  assertCondition(
    webhook.emailSent === true || webhook.emailQueued === true,
    'Expected activation email sent or queued from production webhook',
  );

  console.log('Production billing smoke test passed');
}

run().catch((error) => {
  console.error(`Production billing smoke test failed: ${error.message}`);
  process.exit(1);
});