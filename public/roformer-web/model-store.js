/**
 * Browser model store: streaming download with progress, SHA-256 verification,
 * and persistent caching in Cache Storage (so each model downloads once).
 * Works in window and worker scopes.
 */
import { MODELS, MODEL_CACHE_NAME } from './models.js';

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function openCache() {
  if (typeof caches === 'undefined') return null;
  try { return await caches.open(MODEL_CACHE_NAME); } catch { return null; }
}

async function downloadFile(file, onBytes, signal) {
  const res = await fetch(file.url, { mode: 'cors', credentials: 'omit', signal });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${file.name}`);
  const len = Number(res.headers.get('content-length')) || file.bytes;
  const out = new Uint8Array(Math.max(len, file.bytes));
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) throw new Error(`${file.name} is larger than expected`);
    out.set(value, got);
    got += value.length;
    onBytes(value.length);
  }
  if (got !== file.bytes) throw new Error(`${file.name}: expected ${file.bytes} bytes, got ${got}`);
  return out;
}

/** Is every file of this model already in the cache? */
export async function isModelCached(model) {
  const cache = await openCache();
  if (!cache) return false;
  for (const f of model.files) {
    const hit = await cache.match(f.url);
    if (!hit) return false;
  }
  return true;
}

export async function cachedModelIds() {
  const ids = [];
  for (const m of Object.values(MODELS)) if (await isModelCached(m)) ids.push(m.id);
  return ids;
}

export async function clearModelCache(modelId) {
  if (typeof caches === 'undefined') return;
  if (!modelId) { await caches.delete(MODEL_CACHE_NAME); return; }
  const cache = await openCache();
  if (!cache) return;
  for (const f of MODELS[modelId].files) await cache.delete(f.url);
}

/**
 * Returns { [file.name]: Uint8Array } for the model, downloading what is missing.
 * onProgress({ loaded, total, fromCache, file })
 */
export async function getModelFiles(model, onProgress, { signal, retries = 2 } = {}) {
  const cache = await openCache();
  const total = model.files.reduce((s, f) => s + f.bytes, 0);
  let loaded = 0;
  let allFromCache = true;
  const out = {};
  for (const file of model.files) {
    let bytes = null;
    if (cache) {
      const hit = await cache.match(file.url);
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer());
        if (buf.length === file.bytes) bytes = buf;
        else await cache.delete(file.url); // truncated / stale entry
      }
    }
    if (bytes) {
      loaded += file.bytes;
      onProgress?.({ loaded, total, fromCache: allFromCache, file: file.name });
    } else {
      allFromCache = false;
      const base = loaded;
      let lastErr;
      for (let attempt = 0; attempt <= retries && !bytes; attempt++) {
        let got = 0;
        try {
          bytes = await downloadFile(file, (n) => {
            got += n; loaded = base + got;
            onProgress?.({ loaded, total, fromCache: false, file: file.name });
          }, signal);
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          lastErr = e; loaded = base;
        }
      }
      if (!bytes) throw lastErr;
      loaded = base + file.bytes;
      if (file.sha256) {
        onProgress?.({ loaded, total, fromCache: false, file: file.name, verifying: true });
        const hex = await sha256Hex(bytes);
        if (hex !== file.sha256) throw new Error(`Integrity check failed for ${file.name} (SHA-256 mismatch)`);
      }
      if (cache) {
        try {
          await cache.put(file.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } }));
        } catch (e) {
          console.warn('[roformer-web] could not cache model file (storage quota?):', e);
        }
      }
    }
    out[file.name] = bytes;
  }
  return out;
}
