const PRODUCTION_SITE =
  process.env.NEXT_PUBLIC_CHECKOUT_API_URL?.replace(/\/api\/checkout\/?$/, '') ||
  'https://liminal-stemsplit.onrender.com';

const WARMUP_PATHS = ['/', '/api/health', '/billing/health'] as const;
const COLD_START_TIMEOUT_MS = 90_000;

export type SiteWarmupStatus = {
  awake: boolean;
  emailReady: boolean;
  latencyMs: number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWarmPath(path: string): Promise<Response | null> {
  try {
    return await fetch(`${PRODUCTION_SITE}${path}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

export async function probeProductionSite(): Promise<SiteWarmupStatus> {
  const started = Date.now();
  const responses = await Promise.all(WARMUP_PATHS.map((path) => fetchWarmPath(path)));

  let emailReady = false;
  const billing = responses[2];
  if (billing?.ok) {
    try {
      const data = await billing.json();
      emailReady = !!(data?.ok && data?.email?.configured);
    } catch {
      emailReady = false;
    }
  }

  const awake = responses.some((res) => res?.ok);
  return {
    awake,
    emailReady,
    latencyMs: awake ? Date.now() - started : null,
  };
}

/** Fire-and-forget ping used by analytics — also helps wake Render. */
export async function pingProductionSite(event: string) {
  try {
    await fetch(`${PRODUCTION_SITE}/api/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, version: '0.5.0' }),
      signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
    });
  } catch {
    // never block login
  }
}

/**
 * Keep probing while the login gate is visible so Render is awake before signup.
 * Stops early once the server responds and email delivery is configured.
 */
export function startSiteWarmupLoop(onStatus: (status: SiteWarmupStatus) => void): () => void {
  let cancelled = false;
  let ready = false;

  const run = async () => {
    let backoffMs = 0;
    while (!cancelled && !ready) {
      const status = await probeProductionSite();
      if (cancelled) return;
      onStatus(status);
      if (status.awake && status.emailReady) {
        ready = true;
        return;
      }
      backoffMs = Math.min(backoffMs + 2000, 8000);
      await sleep(backoffMs);
    }
  };

  void run();
  void pingProductionSite('license_gate_open');

  return () => {
    cancelled = true;
  };
}

/** Wait until the production site can accept onboarding email requests. */
export async function ensureProductionSiteWarm(options?: {
  timeoutMs?: number;
  requireEmail?: boolean;
}): Promise<SiteWarmupStatus> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const requireEmail = options?.requireEmail ?? true;
  const deadline = Date.now() + timeoutMs;
  let last: SiteWarmupStatus = { awake: false, emailReady: false, latencyMs: null };

  while (Date.now() < deadline) {
    last = await probeProductionSite();
    const ready = requireEmail ? last.awake && last.emailReady : last.awake;
    if (ready) return last;
    await sleep(2000);
  }

  return last;
}

export function getProductionSiteUrl() {
  return PRODUCTION_SITE;
}