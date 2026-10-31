/**
 * Where finished stem audio goes while a long track is processed.
 *
 *  - MemorySink: full-length Float32 planes in RAM (Node tests, small tracks, fallback).
 *  - OpfsSink:   float32 planes in OPFS files (workers only), so a 10 minute
 *                6-stem job holds only a couple of chunks in RAM instead of
 *                stems x 2 x N floats.
 *
 * Interface: write(name, channel, offset, Float32Array), read(name, channel, start, len) -> Float32Array,
 * names(), dispose(). Layout in OPFS: <stem>.f32 = left plane then right plane.
 */

export class MemorySink {
  constructor(N) { this.kind = 'memory'; this.N = N; this.data = {}; }
  write(name, ch, offset, f32) {
    (this.data[name] ||= [new Float32Array(this.N), new Float32Array(this.N)])[ch].set(f32, offset);
  }
  names() { return Object.keys(this.data); }
  read(name, ch, start, len) { return this.data[name][ch].subarray(start, start + len); }
  async dispose() { this.data = {}; }
}

const DIR = 'roformer-web-stems-v1';

export class OpfsSink {
  static supported() {
    return typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope
      && !!navigator.storage?.getDirectory && typeof FileSystemFileHandle !== 'undefined'
      && typeof FileSystemFileHandle.prototype.createSyncAccessHandle === 'function';
  }

  /** Remove scratch files left behind by a crashed/closed tab. */
  static async sweep() {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(DIR, { recursive: true });
    } catch { /* nothing to sweep, or still in use by another tab */ }
  }

  static async create(N) {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR, { create: true });
    const s = new OpfsSink(N, dir);
    s.id = Math.random().toString(36).slice(2, 8);
    return s;
  }

  constructor(N, dir) { this.kind = 'opfs'; this.N = N; this.dir = dir; this.handles = new Map(); this.files = new Map(); this.id = ''; }

  async #handle(name) {
    let h = this.handles.get(name);
    if (!h) {
      const file = `${this.id}_${name}.f32`;
      const fh = await this.dir.getFileHandle(file, { create: true });
      h = await fh.createSyncAccessHandle();
      h.truncate(this.N * 2 * 4);
      this.handles.set(name, h);
      this.files.set(name, file);
    }
    return h;
  }

  async write(name, ch, offset, f32) {
    const h = await this.#handle(name);
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let w = 0;
    while (w < u8.length) {
      const n = h.write(u8.subarray(w), { at: (ch * this.N + offset) * 4 + w });
      if (!n) throw new Error('Browser storage refused a write (out of space?)');
      w += n;
    }
  }

  names() { return [...this.handles.keys()]; }

  read(name, ch, start, len) {
    const h = this.handles.get(name);
    const out = new Float32Array(len);
    h.read(new Uint8Array(out.buffer), { at: (ch * this.N + start) * 4 });
    return out;
  }

  async dispose() {
    for (const h of this.handles.values()) { try { h.flush(); h.close(); } catch { /* ignore */ } }
    this.handles.clear();
    for (const f of this.files.values()) { try { await this.dir.removeEntry(f); } catch { /* ignore */ } }
    this.files.clear();
  }
}
