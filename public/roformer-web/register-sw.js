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
    if (!coi) { await reg; return out; } // offline caching only: no need to wait for activation
    await reg;
    await navigator.serviceWorker.ready;
    if (!self.crossOriginIsolated) {
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        out.reloading = true;
        location.reload();
      }
    } else {
      sessionStorage.removeItem(KEY);
    }
  } catch (e) {
    out.error = String(e?.message || e);
    console.warn('[roformer-web] service worker unavailable:', e);
  }
  return out;
}
