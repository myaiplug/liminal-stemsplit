/**
 * Stem Studio export: tagged WAV (16/24-bit PCM or 32-bit float), ID3v2.3 tags, MP3 (optional, via lamejs), ZIP.
 *
 * WAV files carry the credit in three places so it survives different tools:
 *   LIST/INFO  (ISFT, ICMT, INAM, IART, IPRD, ICRD, ICOP)  - read by ffprobe, Audacity, most DAWs
 *   iXML       (<BWFXML><USER>...)                          - read by Pro Tools / Reaper / Wavelab
 *   id3        (ID3v2.3 in an `id3 ` chunk)                 - read by mutagen, foobar, iTunes-style taggers
 * No audio resampling happens here: the caller passes planar Float32 channels at the sample rate to write.
 */

export const BRAND_LIMINAL = {
  name: 'NoDAW Liminal', credit: 'Made with NoDAW Liminal', url: 'https://liminal-stemsplit.onrender.com/',
  upgradeUrl: 'https://nodaw.gumroad.com/l/LiminalPro',
};

const enc = new TextEncoder();
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const ascii = (s) => enc.encode(s);
const pad2 = (u8) => (u8.length & 1 ? concat([u8, new Uint8Array(1)]) : u8);
const chunk = (id, body) => concat([ascii(id), u32(body.length), pad2(body)]);

/** @param {{title?:string, artist?:string, album?:string, comment?:string, date?:string, stem?:string}} meta  @param {typeof BRAND_LIMINAL} brand */
export function buildTags(meta = {}, brand = BRAND_LIMINAL) {
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const comment = [meta.comment, `${brand.credit} - ${brand.url}`].filter(Boolean).join(' | ');
  return {
    title: meta.title || '', artist: meta.artist || '', album: meta.album || '', date, comment,
    software: `${brand.name} Stem Studio`, copyright: `${brand.credit} (${brand.url})`, product: brand.name, url: brand.url, credit: brand.credit,
    stem: meta.stem || '',
  };
}

/* ---------------------------------------------------------------- ID3v2.3 */
function id3Frame(id, body) { const sz = new Uint8Array(4); new DataView(sz.buffer).setUint32(0, body.length); return concat([ascii(id), sz, new Uint8Array(2), body]); }
const utf16 = (s) => { const u = new Uint8Array(2 + s.length * 2); u[0] = 0xff; u[1] = 0xfe; for (let i = 0; i < s.length; i++) { u[2 + i * 2] = s.charCodeAt(i) & 255; u[3 + i * 2] = s.charCodeAt(i) >> 8; } return u; };
const txt = (id, s) => id3Frame(id, concat([Uint8Array.of(1), utf16(s)]));
const term = Uint8Array.of(0, 0);
export function buildId3(tags) {
  const frames = [];
  if (tags.title) frames.push(txt('TIT2', tags.title));
  if (tags.artist) frames.push(txt('TPE1', tags.artist));
  if (tags.album) frames.push(txt('TALB', tags.album));
  if (tags.date) frames.push(txt('TYER', tags.date.slice(0, 4)));
  frames.push(txt('TENC', tags.software));
  frames.push(txt('TCOP', tags.copyright));
  frames.push(id3Frame('COMM', concat([Uint8Array.of(1), ascii('eng'), utf16(''), term, utf16(tags.comment)])));
  frames.push(id3Frame('TXXX', concat([Uint8Array.of(1), utf16('MADE_WITH'), term, utf16(tags.credit)])));
  if (tags.stem) frames.push(id3Frame('TXXX', concat([Uint8Array.of(1), utf16('STEM'), term, utf16(tags.stem)])));
  frames.push(id3Frame('WOAS', ascii(tags.url)));
  const body = concat(frames), n = body.length;
  const hdr = Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127);
  return concat([hdr, body]);
}

/* ---------------------------------------------------------------- WAV */
const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
export function buildIxml(tags, { sampleRate, bits, channels, frames }) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<BWFXML><IXML_VERSION>1.5</IXML_VERSION><PROJECT>${xmlEsc(tags.album || tags.title || 'Stem Studio')}</PROJECT>`
    + `<NOTE>${xmlEsc(tags.comment)}</NOTE><USER><MADE_WITH>${xmlEsc(tags.credit)}</MADE_WITH><URL>${xmlEsc(tags.url)}</URL><SOFTWARE>${xmlEsc(tags.software)}</SOFTWARE>`
    + `${tags.stem ? `<STEM>${xmlEsc(tags.stem)}</STEM>` : ''}</USER><SPEED><FILE_SAMPLE_RATE>${sampleRate}</FILE_SAMPLE_RATE><AUDIO_BIT_DEPTH>${bits}</AUDIO_BIT_DEPTH></SPEED>`
    + `<TRACK_LIST><TRACK_COUNT>${channels}</TRACK_COUNT></TRACK_LIST></BWFXML>`;
}
function listInfo(tags) {
  const items = [['INAM', tags.title], ['IART', tags.artist], ['IPRD', tags.album || tags.product], ['ICMT', tags.comment], ['ISFT', tags.software], ['ICRD', tags.date], ['ICOP', tags.copyright], ['IENG', tags.credit]]
    .filter(([, v]) => v).map(([id, v]) => { const b = concat([enc.encode(v), Uint8Array.of(0)]); return chunk(id, b); });
  return chunk('LIST', concat([ascii('INFO'), ...items]));
}

/**
 * @param {Float32Array[]} channels planar
 * @param {'pcm16'|'pcm24'|'float32'} format
 * @returns {Uint8Array}
 */
export function encodeTaggedWav(channels, sampleRate, format = 'pcm24', meta = {}, brand = BRAND_LIMINAL) {
  const nCh = channels.length, frames = channels[0].length, bits = format === 'pcm16' ? 16 : format === 'pcm24' ? 24 : 32, bps = bits / 8;
  const dataLen = frames * nCh * bps, data = new Uint8Array(dataLen), dv = new DataView(data.buffer);
  let p = 0;
  for (let i = 0; i < frames; i++) for (let c = 0; c < nCh; c++, p += bps) {
    const x = channels[c][i];
    if (format === 'float32') dv.setFloat32(p, x, true);
    else if (format === 'pcm16') dv.setInt16(p, Math.max(-32768, Math.min(32767, Math.round(x * 32768))), true);
    else { const v = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388608))); dv.setUint8(p, v & 255); dv.setUint8(p + 1, (v >> 8) & 255); dv.setUint8(p + 2, (v >> 16) & 255); }
  }
  const fmt = new Uint8Array(16), fv = new DataView(fmt.buffer);
  fv.setUint16(0, format === 'float32' ? 3 : 1, true); fv.setUint16(2, nCh, true); fv.setUint32(4, sampleRate, true); fv.setUint32(8, sampleRate * nCh * bps, true); fv.setUint16(12, nCh * bps, true); fv.setUint16(14, bits, true);
  const tags = buildTags(meta, brand);
  const parts = [chunk('fmt ', fmt)];
  if (format === 'float32') parts.push(chunk('fact', u32(frames)));
  parts.push(concat([ascii('data'), u32(dataLen), pad2(data)]));
  parts.push(listInfo(tags));
  parts.push(chunk('iXML', enc.encode(buildIxml(tags, { sampleRate, bits, channels: nCh, frames }))));
  parts.push(chunk('id3 ', buildId3(tags)));
  const body = concat([ascii('WAVE'), ...parts]);
  return concat([ascii('RIFF'), u32(body.length), body]);
}

/* ---------------------------------------------------------------- MP3 (optional) */
/** lamejs is LGPL-3.0: loaded on demand from a separate file (never bundled into the page script). */
export async function loadLame(url = new URL('./vendor/lamejs/lame.min.js', import.meta.url).href) {
  if (globalThis.lamejs) return globalThis.lamejs;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('MP3 encoder could not be loaded')); document.head.appendChild(s); });
  return globalThis.lamejs;
}
export async function encodeMp3(lame, channels, sampleRate, kbps = 256, meta = {}, brand = BRAND_LIMINAL, onProgress) {
  const enc1 = new lame.Mp3Encoder(2, sampleRate, kbps), L = channels[0], R = channels[1] || channels[0];
  const toI16 = (x) => { const o = new Int16Array(x.length); for (let i = 0; i < x.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))); return o; };
  const out = [buildId3(buildTags(meta, brand))], B = 1152 * 20;
  for (let i = 0; i < L.length; i += B) {
    const b = enc1.encodeBuffer(toI16(L.subarray(i, i + B)), toI16(R.subarray(i, i + B))); if (b.length) out.push(Uint8Array.from(b));
    onProgress?.(i / L.length); if ((i / B) % 8 === 7) await new Promise((r) => setTimeout(r)); // let the UI breathe
  }
  const f = enc1.flush(); if (f.length) out.push(Uint8Array.from(f));
  return concat(out);
}

/* ---------------------------------------------------------------- ZIP */
/** @param {typeof import('../roformer-web/vendor/fflate/fflate.mjs')} fflate  @param {{name:string,data:Uint8Array}[]} files */
export function zipFiles(fflate, files) {
  const o = {}; for (const f of files) o[f.name] = [f.data, { level: 0 }];
  return fflate.zipSync(o, { level: 0 });
}
export const safeName = (s) => String(s).replace(/[^\w.\- ]+/g, ' ').replace(/\s+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 80) || 'stem';
