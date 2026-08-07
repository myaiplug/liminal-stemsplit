import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkoutConfigStatus } from './stripe-checkout.js';
import { sendProActivationEmail } from './billing-email.js';
import { loadDb } from './billing-store.js';

const rootDir = dirname(fileURLToPath(import.meta.url));
const queuePath = resolve(process.env.ACTIVATION_EMAIL_QUEUE_PATH || resolve(rootDir, '../data/activation-email-queue.json'));

const MIN_WARMUP_MS = Number(process.env.ACTIVATION_EMAIL_MIN_WARMUP_MS || 3000);
const WARMUP_TIMEOUT_MS = Number(process.env.ACTIVATION_EMAIL_WARMUP_TIMEOUT_MS || 120_000);
const WARMUP_POLL_MS = Number(process.env.ACTIVATION_EMAIL_WARMUP_POLL_MS || 2000);
const SEND_MAX_ATTEMPTS = Number(process.env.ACTIVATION_EMAIL_SEND_ATTEMPTS || 5);
const WEBHOOK_WAIT_MS = Number(process.env.ACTIVATION_EMAIL_WEBHOOK_WAIT_MS || 15_000);
const WORKER_INTERVAL_MS = Number(process.env.ACTIVATION_EMAIL_WORKER_INTERVAL_MS || 30_000);

const serverStartedAt = Date.now();
let workerTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureQueueFile() {
  if (!existsSync(dirname(queuePath))) mkdirSync(dirname(queuePath), { recursive: true });
  if (!existsSync(queuePath)) {
    writeFileSync(queuePath, JSON.stringify({ jobs: [] }, null, 2));
  }
}

function loadQueue() {
  ensureQueueFile();
  const parsed = JSON.parse(readFileSync(queuePath, 'utf8'));
  if (!Array.isArray(parsed.jobs)) parsed.jobs = [];
  return parsed;
}

function saveQueue(queue) {
  ensureQueueFile();
  writeFileSync(queuePath, JSON.stringify(queue, null, 2));
}

export function assessBillingReadiness() {
  let dbReady = false;
  try {
    loadDb();
    dbReady = true;
  } catch {
    dbReady = false;
  }

  const emailConfigured = !!process.env.RESEND_API_KEY;
  const checkout = checkoutConfigStatus();
  const warmedUp = Date.now() - serverStartedAt >= MIN_WARMUP_MS;

  return {
    ready: dbReady && emailConfigured && warmedUp,
    dbReady,
    emailConfigured,
    checkoutReady: checkout.ready,
    warmedUp,
    uptimeMs: Date.now() - serverStartedAt,
    checkedAt: new Date().toISOString(),
  };
}

export async function waitForBillingReady(options = {}) {
  const timeoutMs = options.timeoutMs ?? WARMUP_TIMEOUT_MS;
  const pollMs = options.pollMs ?? WARMUP_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let last = assessBillingReadiness();

  while (Date.now() < deadline) {
    last = assessBillingReadiness();
    if (last.ready) return last;
    await sleep(pollMs);
  }

  return last;
}

function findJobById(jobId) {
  const queue = loadQueue();
  return queue.jobs.find((job) => job.id === jobId) || null;
}

function findLatestPendingJobForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const queue = loadQueue();
  return [...queue.jobs]
    .reverse()
    .find((job) => job.email === normalized && job.status !== 'sent') || null;
}

/** Only paid storefronts may enqueue Pro license emails. Free download / free signup must never. */
export const PAID_LICENSE_SOURCES = new Set([
  'stripe',
  'gumroad',
  'shopify',
  'admin',
  'managed_pro',
]);

export function isPaidLicenseSource(source) {
  return PAID_LICENSE_SOURCES.has(String(source || '').trim().toLowerCase());
}

export function enqueueActivationEmail({
  email,
  credential,
  source = 'stripe',
  eventKey = null,
  emailOpts = null,
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedSource = String(source || '').trim().toLowerCase();
  if (!normalizedEmail || !credential) {
    throw new Error('Email and credential are required to queue activation email');
  }
  if (!isPaidLicenseSource(normalizedSource)) {
    throw new Error(
      `Refused to queue Pro license email for non-paid source "${source}". Free users never receive license keys.`,
    );
  }

  const queue = loadQueue();
  const existing = queue.jobs.find(
    (job) => job.eventKey && eventKey && job.eventKey === eventKey && job.status !== 'sent',
  );
  if (existing) return existing;

  const job = {
    id: randomUUID(),
    email: normalizedEmail,
    credential,
    source: normalizedSource,
    eventKey,
    emailOpts: emailOpts || { source: normalizedSource },
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sentAt: null,
    resendId: null,
  };

  queue.jobs.push(job);
  saveQueue(queue);
  return job;
}

function updateJob(jobId, patch) {
  const queue = loadQueue();
  const index = queue.jobs.findIndex((job) => job.id === jobId);
  if (index < 0) return null;

  queue.jobs[index] = {
    ...queue.jobs[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveQueue(queue);
  return queue.jobs[index];
}

function scrubCredentialFromJob(jobId) {
  const queue = loadQueue();
  const index = queue.jobs.findIndex((job) => job.id === jobId);
  if (index < 0) return;
  delete queue.jobs[index].credential;
  queue.jobs[index].updatedAt = new Date().toISOString();
  saveQueue(queue);
}

function maskEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at <= 1) return '***';
  return `${value[0]}***${value.slice(at)}`;
}

export function getActivationEmailQueueSummary() {
  const queue = loadQueue();
  const open = queue.jobs.filter((job) => job.status === 'pending' || job.status === 'warming' || job.status === 'failed');
  const sent = queue.jobs.filter((job) => job.status === 'sent').length;
  // Diagnostics only — never include credentials/keys
  const recentOpen = open
    .slice(-5)
    .map((job) => ({
      email: maskEmail(job.email),
      status: job.status,
      source: job.source || null,
      attempts: job.attempts || 0,
      lastError: job.lastError || null,
      updatedAt: job.updatedAt || null,
    }));
  return {
    pending: open.length,
    sent,
    total: queue.jobs.length,
    recentOpen,
  };
}

export async function processActivationEmailJob(jobId) {
  const job = findJobById(jobId);
  if (!job) return { sent: false, reason: 'Activation email job not found' };
  if (job.status === 'sent') return { sent: true, id: job.resendId || null, duplicate: true };
  if (!job.credential) {
    updateJob(jobId, { status: 'failed', lastError: 'Missing credential on job — cannot send license email' });
    return { sent: false, reason: 'Missing credential on job' };
  }

  updateJob(jobId, { status: 'warming' });

  const readiness = await waitForBillingReady();
  if (!readiness.ready) {
    const reason = !readiness.emailConfigured
      ? 'RESEND_API_KEY not configured'
      : !readiness.dbReady
        ? 'Billing database not ready'
        : 'Service still warming up on Render';
    updateJob(jobId, { status: 'pending', lastError: reason });
    return { sent: false, reason, queued: true, readiness };
  }

  // Always force paid source onto opts (job.source is authoritative)
  const emailOpts = {
    ...(job.emailOpts || {}),
    source: job.source || job.emailOpts?.source || 'unknown',
  };

  let lastResult = { sent: false, reason: 'Unknown send failure' };
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt += 1) {
    updateJob(jobId, { attempts: attempt, status: 'warming' });
    lastResult = await sendProActivationEmail(job.email, job.credential, emailOpts);
    if (lastResult.sent) {
      updateJob(jobId, {
        status: 'sent',
        sentAt: new Date().toISOString(),
        resendId: lastResult.id || null,
        lastError: null,
      });
      scrubCredentialFromJob(jobId);
      return lastResult;
    }

    updateJob(jobId, { lastError: lastResult.reason || 'Resend API error' });
    await sleep(Math.min(2000 * attempt, 10_000));
  }

  updateJob(jobId, { status: 'failed', lastError: lastResult.reason || 'Activation email failed' });
  return { ...lastResult, queued: true };
}

export async function deliverActivationEmailAfterPurchase({
  email,
  credential,
  source = 'stripe',
  eventKey = null,
  waitInWebhookMs = WEBHOOK_WAIT_MS,
  emailOpts = null,
}) {
  // Hard gate: free download / free account / unknown sources never get a Pro key email.
  if (!isPaidLicenseSource(source)) {
    console.warn(
      `[activation-email] Blocked Pro license email for non-paid source="${source}" email="${email}"`,
    );
    return {
      sent: false,
      queued: false,
      blocked: true,
      reason: 'Pro license emails are only sent after a paid purchase (Stripe/Gumroad/Shopify)',
    };
  }
  if (!credential) {
    return { sent: false, queued: false, reason: 'Missing paid credential' };
  }

  const job = enqueueActivationEmail({ email, credential, source, eventKey, emailOpts });
  const deliveryPromise = processActivationEmailJob(job.id);

  if (!waitInWebhookMs || waitInWebhookMs <= 0) {
    void deliveryPromise;
    return { sent: false, queued: true, reason: 'Activation email queued for delivery', jobId: job.id };
  }

  const raced = await Promise.race([
    deliveryPromise,
    sleep(waitInWebhookMs).then(() => ({
      sent: false,
      queued: true,
      reason: 'Still warming Render and sending activation email in background',
      jobId: job.id,
    })),
  ]);

  if (!raced.sent) {
    void deliveryPromise;
  }

  return { ...raced, jobId: job.id };
}

export async function dispatchActivationEmailForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { sent: false, reason: 'Email is required' };

  const job = findLatestPendingJobForEmail(normalized);
  if (!job) {
    return { sent: false, reason: 'No pending activation email for this address', queued: false };
  }
  if (!isPaidLicenseSource(job.source)) {
    return {
      sent: false,
      blocked: true,
      reason: 'Refused: pending job is not from a paid source',
      queued: false,
    };
  }

  return processActivationEmailJob(job.id);
}

export async function processPendingActivationEmails(limit = 10) {
  const queue = loadQueue();
  const now = Date.now();
  // Retry pending/failed always; also retry "warming" stuck > 2 minutes (crash/timeout mid-send)
  const pending = queue.jobs
    .filter((job) => {
      if (job.status === 'pending' || job.status === 'failed') return true;
      if (job.status === 'warming') {
        const age = now - Date.parse(job.updatedAt || job.createdAt || 0);
        return !Number.isFinite(age) || age > 120_000;
      }
      return false;
    })
    .slice(0, limit);
  const results = [];

  for (const job of pending) {
    results.push({
      jobId: job.id,
      email: job.email,
      result: await processActivationEmailJob(job.id),
    });
  }

  return results;
}

export function startActivationEmailWorker() {
  if (workerTimer) return;

  const tick = async () => {
    try {
      await processPendingActivationEmails(5);
    } catch (error) {
      console.error('[activation-email] worker tick failed:', error);
    }
  };

  void tick();
  workerTimer = setInterval(() => {
    void tick();
  }, WORKER_INTERVAL_MS);
}