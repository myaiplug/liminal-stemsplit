/**
 * Session persistence for Stem Studio. Audio is large, so it goes to OPFS (one file per track, planar float32
 * L then R) with an IndexedDB fallback; settings are a small JSON document in IndexedDB.
 *   saveSession(session, tracksAudio)  loadSession(id)  listSessions()  deleteSession(id)
 * A session holds only what the user changed (edits, chain, fixes, levels, ...) plus the ORIGINAL audio of each
 * track. Processed audio (fixes, edits) is recomputed deterministically when a session is opened.
 */
const DB = 'stem-studio-v1', META = 'sessions', BLOBS = 'blobs', DIR = 'stem-studio-v1';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(META, { keyPath: 'id' }); r.result.createObjectStore(BLOBS); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const tx = (db, store, mode, fn) => new Promise((res, rej) => { const t = db.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const opfsOk = async () => { try { return !!(navigator.storage && navigator.storage.getDirectory && await navigator.storage.getDirectory()); } catch { return false; } };

async function dirFor(id, create) { const root = await navigator.storage.getDirectory(); const top = await root.getDirectoryHandle(DIR, { create }); return top.getDirectoryHandle(id, { create }); }

async function writeAudio(db, sid, tid, L, R, useOpfs) {
  const key = `${sid}/${tid}`;
  if (useOpfs) {
    const d = await dirFor(sid, true), fh = await d.getFileHandle(`${tid}.f32`, { create: true }), w = await fh.createWritable();
    await w.write(L); await w.write(R); await w.close(); return 'opfs';
  }
  const buf = new Float32Array(L.length * 2); buf.set(L); buf.set(R, L.length);
  await tx(db, BLOBS, 'readwrite', (s) => s.put(buf.buffer, key)); return 'idb';
}
async function readAudio(db, sid, tid, frames, where) {
  if (where === 'opfs') {
    const d = await dirFor(sid, false), f = await (await d.getFileHandle(`${tid}.f32`)).getFile(), ab = await f.arrayBuffer();
    return [new Float32Array(ab, 0, frames), new Float32Array(ab, frames * 4, frames)];
  }
  const ab = await new Promise((res, rej) => { const t = db.transaction(BLOBS).objectStore(BLOBS).get(`${sid}/${tid}`); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  if (!ab) throw new Error('Saved audio is missing');
  return [new Float32Array(ab, 0, frames), new Float32Array(ab, frames * 4, frames)];
}

/** @param {{id:string,name:string,tracks:Array}} session JSON-able (no audio)  @param {Map<string,[Float32Array,Float32Array]>} audio */
export async function saveSession(session, audio, { onProgress } = {}) {
  const db = await idb(), useOpfs = await opfsOk(); let i = 0;
  const prev = await tx(db, META, 'readonly', (s) => s.get(session.id));
  const known = new Map((prev?.tracks || []).map((t) => [t.id, t.store]));
  for (const t of session.tracks) {
    if (known.has(t.id) && !audio.has(t.id)) { t.store = known.get(t.id); continue; } // audio unchanged since last save
    const [L, R] = audio.get(t.id); t.store = await writeAudio(db, session.id, t.id, L, R, useOpfs); t.frames = L.length; onProgress?.(++i / session.tracks.length);
  }
  const doc = { ...session, savedAt: Date.now() };
  await tx(db, META, 'readwrite', (s) => s.put(doc));
  return doc;
}
export async function listSessions() {
  const db = await idb(); const all = await new Promise((res, rej) => { const r = db.transaction(META).objectStore(META).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return all.map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt, tracks: s.tracks.length, durationSec: s.durationSec })).sort((a, b) => b.savedAt - a.savedAt);
}
export async function loadSession(id) {
  const db = await idb(); const doc = await new Promise((res, rej) => { const r = db.transaction(META).objectStore(META).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  if (!doc) throw new Error('Session not found');
  const audio = new Map();
  for (const t of doc.tracks) audio.set(t.id, await readAudio(db, id, t.id, t.frames, t.store));
  return { session: doc, audio };
}
export async function deleteSession(id) {
  const db = await idb();
  await tx(db, META, 'readwrite', (s) => s.delete(id));
  await new Promise((res, rej) => { const t = db.transaction(BLOBS, 'readwrite'), s = t.objectStore(BLOBS), r = s.openCursor(IDBKeyRange.bound(`${id}/`, `${id}/\uffff`)); r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } }; t.oncomplete = res; t.onerror = () => rej(t.error); });
  try { const top = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR); await top.removeEntry(id, { recursive: true }); } catch { /* none */ }
}
