import './load-env.mjs';
import { createHmac } from 'node:crypto';

const baseUrl = process.env.BILLING_TEST_BASE_URL || 'http://127.0.0.1:8787';
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function makeStripeSignature(secret, body, timestampSec) {
  const payload = `${timestampSec}.${body}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestampSec},v1=${signature}`;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function run() {
  console.log('Activation email smoke test started');
  console.log(`Base URL: ${baseUrl}`);

  const healthRes = await fetch(`${baseUrl}/health`);
  assertCondition(healthRes.ok, `Health failed: ${healthRes.status}`);
  const health = await healthRes.json();
  console.log('Health readiness:', JSON.stringify(health.readiness || health, null, 2));

  assertCondition(stripeSecret, 'STRIPE_WEBHOOK_SECRET is required');

  const email = `activation.smoke.${Date.now()}@example.com`;
  const password = `smoke-pass-${Date.now()}`;
  const nowSec = Math.floor(Date.now() / 1000);
  const stripeEventId = `evt_activation_smoke_${Date.now()}`;
  const stripeBodyObj = {
    id: stripeEventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_activation_smoke_${Date.now()}`,
        customer_email: email,
        metadata: { plan: 'pro', product: 'stemsplit_pro', access_password: password },
      },
    },
  };
  const stripeBody = JSON.stringify(stripeBodyObj);
  const stripeSignature = makeStripeSignature(stripeSecret, stripeBody, nowSec);

  const webhook = await postJson(`${baseUrl}/webhooks/stripe`, stripeBody, {
    'stripe-signature': stripeSignature,
  });
  assertCondition(webhook.status === 200, `Stripe webhook failed: ${webhook.status}`);
  assertCondition(webhook.json?.ok === true, 'Stripe webhook did not return ok=true');
  console.log('Webhook result:', {
    emailSent: webhook.json?.emailSent,
    emailQueued: webhook.json?.emailQueued,
    emailError: webhook.json?.emailError,
    readiness: webhook.json?.readiness,
  });

  const dispatch = await postJson(`${baseUrl}/api/activation-emails/dispatch`, JSON.stringify({ email }));
  assertCondition(dispatch.status === 200, `Dispatch failed: ${dispatch.status}`);
  console.log('Dispatch result:', dispatch.json);

  const healthAfter = await fetch(`${baseUrl}/health`);
  const healthAfterJson = await healthAfter.json();
  console.log('Queue after delivery:', healthAfterJson.activationEmailQueue);

  assertCondition(
    webhook.json?.emailSent === true || webhook.json?.emailQueued === true || dispatch.json?.sent === true || dispatch.json?.queued === true,
    'Expected email to be sent or remain queued for retry',
  );

  console.log('Activation email smoke test passed');
}

run().catch((error) => {
  console.error(`Activation email smoke test failed: ${error.message}`);
  process.exit(1);
});