import { createHmac } from 'node:crypto';

const baseUrl = process.env.BILLING_TEST_BASE_URL || 'http://127.0.0.1:8787';
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const gumroadSecret = process.env.GUMROAD_WEBHOOK_SECRET || '';
const toleranceSec = Number(process.env.STRIPE_SIGNATURE_TOLERANCE_SEC || 300);

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeStripeSignature(secret, body, timestampSec) {
  const payload = `${timestampSec}.${body}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestampSec},v1=${signature}`;
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { status: response.status, json };
}

async function postForm(url, fields, headers = {}) {
  const payload = new URLSearchParams(fields).toString();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: payload,
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  return { status: response.status, json };
}

async function run() {
  console.log('Billing webhook smoke test started');
  console.log(`Base URL: ${baseUrl}`);

  const health = await fetch(`${baseUrl}/health`);
  assertCondition(health.ok, `Health check failed with status ${health.status}`);

  if (!stripeSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for smoke test');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const stripeEventId = `evt_smoke_${Date.now()}`;
  const stripeBodyObj = {
    id: stripeEventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_smoke_${Date.now()}`,
        customer_email: 'smoke.stripe@example.com',
        metadata: {
          plan: 'pro',
          access_password: 'smoke-password-123',
        },
      },
    },
  };
  const stripeBody = JSON.stringify(stripeBodyObj);
  const stripeSignature = makeStripeSignature(stripeSecret, stripeBody, nowSec);

  const stripeFirst = await postJson(`${baseUrl}/webhooks/stripe`, stripeBody, {
    'stripe-signature': stripeSignature,
  });
  assertCondition(stripeFirst.status === 200, `Stripe first delivery failed: ${stripeFirst.status}`);
  assertCondition(stripeFirst.json?.ok === true, 'Stripe first delivery did not return ok=true');
  assertCondition(!stripeFirst.json?.duplicate, 'Stripe first delivery incorrectly marked duplicate');

  const stripeSecond = await postJson(`${baseUrl}/webhooks/stripe`, stripeBody, {
    'stripe-signature': stripeSignature,
  });
  assertCondition(stripeSecond.status === 200, `Stripe duplicate delivery failed: ${stripeSecond.status}`);
  assertCondition(stripeSecond.json?.duplicate === true, 'Stripe duplicate delivery not detected');

  const staleTimestamp = nowSec - (Math.abs(toleranceSec) + 120);
  const staleSignature = makeStripeSignature(stripeSecret, stripeBody, staleTimestamp);
  const stripeStale = await postJson(`${baseUrl}/webhooks/stripe`, stripeBody, {
    'stripe-signature': staleSignature,
  });
  assertCondition(stripeStale.status === 401, `Stripe stale timestamp should fail with 401, got ${stripeStale.status}`);

  if (gumroadSecret) {
    const gumroadSaleId = `sale_smoke_${Date.now()}`;
    const gumroadPayload = {
      email: 'smoke.gumroad@example.com',
      plan: 'pro',
      access_password: 'smoke-gumroad-password-123',
      sale_id: gumroadSaleId,
      sale_timestamp: new Date().toISOString(),
    };

    const gumroadFirst = await postForm(
      `${baseUrl}/webhooks/gumroad?secret=${encodeURIComponent(gumroadSecret)}`,
      gumroadPayload
    );
    assertCondition(gumroadFirst.status === 200, `Gumroad first delivery failed: ${gumroadFirst.status}`);
    assertCondition(gumroadFirst.json?.ok === true, 'Gumroad first delivery did not return ok=true');
    assertCondition(!gumroadFirst.json?.duplicate, 'Gumroad first delivery incorrectly marked duplicate');

    const gumroadSecond = await postForm(
      `${baseUrl}/webhooks/gumroad?secret=${encodeURIComponent(gumroadSecret)}`,
      gumroadPayload
    );
    assertCondition(gumroadSecond.status === 200, `Gumroad duplicate delivery failed: ${gumroadSecond.status}`);
    assertCondition(gumroadSecond.json?.duplicate === true, 'Gumroad duplicate delivery not detected');
  } else {
    console.log('GUMROAD_WEBHOOK_SECRET not set, skipping Gumroad duplicate checks');
  }

  console.log('Billing webhook smoke test passed');
}

run().catch((error) => {
  console.error(`Billing webhook smoke test failed: ${error.message}`);
  process.exit(1);
});
