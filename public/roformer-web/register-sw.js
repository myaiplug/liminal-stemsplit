/**
 * Register the stem-splitter service worker.
 *
 *   const r = await registerStemSW({ url: './stems-sw.js', coi: true });
 *   if (r.reloading) return;        // page is being reloaded once so the worker can isolate it
 *
 * With `coi: true` the worker adds COOP/COEP headers (for hosts like GitHub Pages
 * that cannot). The first visit therefore reloads exactly once; a sessionStorage
 * guard guarantees there is never a reload loop (e.g. Safari, which lacks
 * COEP: credentialless, simply runs single-threaded).
 */
export async function registerStemSW({ url, scope, coi = false } = {}) {
  const out = { supported: false, reloading: false, isolated: !!self.crossOriginIsolated, error: null };
  if (!('serviceWorker' in navigator) || !self.isSecureContext) return out;
  out.supported = true;
  const KEY = 'rf-sw-reloaded';
  try {
    const reg = navigator.serviceWorker.register(url, scope ? { scope } : undefined);
    // Offline caching only, or the host already sends COOP/COEP (e.g. Vercel): never block the page on the worker.
    if (!coi || self.crossOriginIsolated) {
      reg.catch((e) => console.warn('[roformer-web] service worker unavailable:', e));
      if (self.crossOriginIsolated) { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
      return out;
    }
    // Needs the worker to isolate the page: wait for it, but never hang if it can't start (blocked / private mode).
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('service worker did not activate in time')), 8000));
    await Promise.race([reg.then(() => navigator.serviceWorker.ready), timeout]);
    if (!self.crossOriginIsolated) {
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        out.reloading = true;
        location.reload();
      }
    }
  } catch (e) {
    out.error = String(e?.message || e);
    console.warn('[roformer-web] service worker unavailable:', e);
  }
  return out;
}
