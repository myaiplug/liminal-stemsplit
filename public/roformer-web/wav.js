/** Minimal WAV (RIFF) encoder for planar stereo Float32 audio. */

/**
 * @param {Float32Array[]} channels planar channel data (equal length)
 * @param {number} sampleRate
 * @param {'pcm16'|'pcm24'|'float32'} format
 * @returns {ArrayBuffer}
 */
export function encodeWav(channels, sampleRate, format = 'pcm16') {
  const nCh = channels.length;
  const n = channels[0].length;
  const bytes = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const dataLen = n * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, format === 'float32' ? 3 : 1, true);
  dv.setUint16(22, nCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * nCh * bytes, true);
  dv.setUint16(32, nCh * bytes, true);
  dv.setUint16(34, bytes * 8, true);
  str(36, 'data'); dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      let x = channels[c][i];
      if (format === 'float32') { dv.setFloat32(o, x, true); o += 4; continue; }
      x = x > 1 ? 1 : x < -1 ? -1 : x;
      if (format === 'pcm16') {
        dv.setInt16(o, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true); o += 2;
      } else {
        const v = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
        dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); o += 3;
      }
    }
  }
  return buf;
}
