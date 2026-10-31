/*
 * Stem-splitter service worker (ONE worker per site).
 *
 *  1. Offline: keeps the stem page, the roformer-web module and the vendored
 *     onnxruntime-web runtime in Cache Storage so the tool reloads with no
 *     network. (Model weights live in OPFS, not here.)
 *  2. Cross-origin isolation (only when COI is true, i.e. hosts that cannot set
 *     COOP/COEP headers, such as GitHub Pages): adds
 *         Cross-Origin-Opener-Policy: same-origin
 *         Cross-Origin-Embedder-Policy: credentialless
 *     to the stem page and the module/worker/wasm files it loads, which makes
 *     SharedArrayBuffer available -> multi-threaded WASM. The header-rewriting
 *     idea and the install/activate/claim skeleton are adapted from
 *     coi-serviceworker v0.1.7 (c) 2021 Guido Zuidhof, MIT - see
 *     roformer-web/vendor/coi-serviceworker/LICENSE (MIT).
 *
 * Scope discipline: the worker is registered with the site scope but handles ONLY
 * the stem page(s) and files under MODULE_DIR. Every other request (other pages,
 * analytics, fonts, embeds, audio players, cross-origin traffic) is not
 * intercepted at all - the browser handles it exactly as if no worker existed.
 * `credentialless` means cross-origin images/fonts/CSS need no CORP headers.
 *
 * Edit CONFIG per site. Bump VERSION when the precache list changes.
 */
const CONFIG = {
  VERSION: 'a5e5f3a82b',
  COI: false,
  PAGES: ['browser-split.html'],
  MODULE_DIR: 'roformer-web/',
  SHELL: ['roformer-web/adapters.js','roformer-web/client.js','roformer-web/dsp.js','roformer-web/engine.js','roformer-web/model-store.js','roformer-web/models.js','roformer-web/progress.js','roformer-web/register-sw.js','roformer-web/rf.css','roformer-web/separator.js','roformer-web/sinks.js','roformer-web/tips.js','roformer-web/ui.js','roformer-web/wav.js','roformer-web/worker.js'],
};

const CACHE = `rf-app-${CONFIG.VERSION}`;
const BASE = new URL('./', self.location.href);
const abs = (p) => new URL(p, BASE).href;
const MODULE_BASE = abs(CONFIG.MODULE_DIR);
const PAGE_PATHS = new Set(CONFIG.PAGES.flatMap((p) => {
  const u = new URL(p, BASE).pathname;
  return [u, u.replace(/\.html$/, '')]; // GitHub Pages also serves /stems
}));
const IMMUTABLE = `${MODULE_BASE}vendor/`; // pinned third-party builds: cache-first

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const list = [...CONFIG.PAGES.map(abs), ...CONFIG.SHELL.map(abs)];
    await Promise.allSettled(list.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Carry the (version-independent, ~27 MB) vendored runtime over from older caches so an app
    // update never forces a re-download and never breaks offline use.
    const cur = await caches.open(CACHE);
    for (const k of await caches.keys()) {
      if (!k.startsWith('rf-app-') || k === CACHE) continue;
      try {
        const old = await caches.open(k);
        for (const req of await old.keys()) {
          if (!req.url.startsWith(MODULE_BASE + 'vendor/')) continue;
          if (await cur.match(req)) continue;
          const res = await old.match(req);
          if (res) await cur.put(req, res);
        }
      } catch (_) { /* best effort */ }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

function isOurs(url) {
  if (url.origin !== self.location.origin) return false;
  return PAGE_PATHS.has(url.pathname) || url.href.startsWith(MODULE_BASE);
}

function withIsolation(res) {
  if (!CONFIG.COI || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function handle(event) {
  const req = event.request;
  const url = new URL(req.url);
  const cache = await caches.open(CACHE);
  const key = new Request(url.origin + url.pathname); // ignore ?query / hash for cache identity

  if (req.method === 'HEAD') { // used by the worker to probe that the wasm runtime is reachable
    try { return withIsolation(await fetch(req)); } catch {
      const hit = await cache.match(key, { ignoreMethod: true });
      if (hit) return new Response(null, { status: 200, headers: hit.headers });
      throw new Error('offline');
    }
  }

  if (url.href.startsWith(IMMUTABLE)) {
    const hit = await cache.match(key);
    if (hit) return withIsolation(hit);
  }
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200 && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
    return withIsolation(res);
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return withIsolation(hit);
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const r = event.request;
  if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
  if (r.method !== 'GET' && r.method !== 'HEAD') return;
  if (!isOurs(new URL(r.url))) return; // not ours: do not intercept
  event.respondWith(handle(event));
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d && d.type === 'deregister') self.registration.unregister();
});
