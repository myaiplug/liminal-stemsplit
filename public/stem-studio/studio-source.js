/**
 * Bridge between the in-browser splitter (roformer-web) and Stem Studio.
 * Mounts the stock splitter widget and, when a separation finishes, pulls every stem out of it as float32 WAV and
 * hands planar arrays to the studio. No roformer-web file is modified: we wrap `separator.separate` on the instance.
 *
 * Interface the studio relies on (kept deliberately small):
 *   mountStemSplit(root, opts) -> { separator }       separator.separate(...) -> { stems:[names], sampleRate, ... }
 *   separator.exportStem(name, 'float32') -> Promise<Blob> (a WAV)
 */
import { parseWav } from '../roformer-web/wav.js';

export async function mountSplitSource(root, onStems, { appTitle = 'Liminal Stem Studio' } = {}) {
  const { mountStemSplit } = await import('../roformer-web/ui.js');
  const api = mountStemSplit(root, { appTitle });
  const sep = api.separator;
  if (!sep || typeof sep.separate !== 'function') throw new Error('Splitter API changed: no separator instance');
  const orig = sep.separate.bind(sep);
  sep.separate = async (...args) => {
    const info = await orig(...args);
    queueMicrotask(async () => {
      try {
        const stems = [];
        for (const name of info.stems) {
          const wav = parseWav(await (await sep.exportStem(name, 'float32')).arrayBuffer());
          stems.push({ name, L: wav.channels[0], R: wav.channels[1] || wav.channels[0], sr: wav.sampleRate });
        }
        await onStems(stems, { from: 'split', info });
      } catch (e) { console.error('[stem-studio] could not load split stems', e); }
    });
    return info;
  };
  return api;
}

/** Read audio files the user picked. WAV is parsed directly (exact sample rate); everything else goes through decodeAudioData. */
export async function readAudioFile(file) {
  const buf = await file.arrayBuffer();
  const name = file.name.replace(/\.[^.]+$/, '');
  try { const w = parseWav(buf.slice(0)); return { name, L: w.channels[0], R: w.channels[1] || w.channels[0], sr: w.sampleRate, exact: true }; } catch { /* not a (supported) WAV */ }
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 44100);
  const dec = await ctx.decodeAudioData(buf.slice(0)); // note: browsers resample compressed audio to the context rate (44.1 kHz here)
  const L = dec.getChannelData(0), R = dec.numberOfChannels > 1 ? dec.getChannelData(1) : L;
  return { name, L: new Float32Array(L), R: new Float32Array(R), sr: dec.sampleRate, exact: false };
}
