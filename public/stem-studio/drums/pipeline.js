/**
 * Turns separator output (ML or DSP) into the final set of derived stems. Pure + synchronous so it is unit-testable.
 *
 *   drums  = kick' + snare + toms + hats + cymbals + remainder          (+ the part of kick moved into the 808)
 *   bass   = bassNoSub + (bass sub moved into the 808)
 *   808    = bass sub + the low band of long-ringing kicks
 */
import { splitHats, derive808, sub } from './drum-dsp.js';

/**
 * @param {{drums:[Float32Array,Float32Array], bass?:[Float32Array,Float32Array]|null, ml?:{kick,snare,cymbals,toms}|null,
 *          dsp?:{kick,snare,hats,cymbals,toms}|null, sr:number, splitHats?:boolean, sub808?:boolean, fc?:number, minTailMs?:number}} o
 * @returns {{parts:{key:string,name:string,kind:string,parent:'drums'|'bass',audio:[Float32Array,Float32Array]}[], events:any[], notes:string[]}}
 */
export function buildParts({ drums, bass = null, ml = null, dsp = null, sr, splitHats: doHats = true, sub808: do808 = true, fc = 120, minTailMs = 220, onProgress }) {
  const notes = [], parts = [];
  const src = ml || dsp; if (!src) throw new Error('no separator output');
  let hats = dsp?.hats || null, cymbals = src.cymbals;
  if (ml && doHats) { onProgress?.('Separating hi-hats from cymbal wash'); ({ hats, cymbals } = splitHats(ml.cymbals[0], ml.cymbals[1], sr)); notes.push('Hi-hats = the percussive part of the model\'s cymbals stem (HPSS); crash/ride = the sustained part. A crash\'s first hit lands in hats and hats played over a ringing cymbal are only partly separable.'); }
  else if (ml) notes.push('Hi-hats and cymbals are kept together (model "cymbals" stem).');
  let kick = src.kick, kickRest = kick, sub808 = null, bassRest = null, events = [];
  if (do808) {
    const r = derive808({ bass, kick, sr, fc, minTailMs });
    events = r.events; kickRest = r.kickRest; sub808 = r.sub808; bassRest = bass ? r.bassRest : null;
    notes.push(bass ? `808 / sub = everything below ${fc} Hz of the Bass stem (zero-phase, so Bass + 808 = original) plus the low end of kicks that ring longer than ${minTailMs} ms.` : `No Bass stem in the session: the 808 only contains kicks that ring longer than ${minTailMs} ms (their low band).`);
    if (!r.events.some((e) => e.is808) && !bass) sub808 = null;
  }
  parts.push({ key: 'kick', name: 'Kick', kind: 'kick', parent: 'drums', audio: kickRest });
  parts.push({ key: 'snare', name: 'Snare / clap', kind: 'snare', parent: 'drums', audio: src.snare });
  if (src.toms) parts.push({ key: 'toms', name: ml ? 'Toms' : 'Toms / low-mid body', kind: 'toms', parent: 'drums', audio: src.toms });
  if (hats && doHats !== false || dsp) parts.push({ key: 'hats', name: 'Hi-hats', kind: 'hats', parent: 'drums', audio: hats });
  parts.push({ key: 'cymbals', name: hats ? 'Crash / ride' : 'Cymbals', kind: 'cymbals', parent: 'drums', audio: cymbals });
  if (sub808) parts.push({ key: 'sub808', name: '808 / sub', kind: 'sub808', parent: 'drums', audio: sub808 });
  if (bassRest) parts.push({ key: 'bassRest', name: 'Bass (no sub)', kind: 'bass', parent: 'bass', audio: bassRest });
  // remainder: whatever the model did not attribute to a stem, so the sum is exactly the original drums
  let acc = [kick[0], kick[1]]; const add = (x) => { acc = [acc[0].map((v, i) => v + x[0][i]), acc[1].map((v, i) => v + x[1][i])]; };
  add(src.snare); if (src.toms) add(src.toms); add(ml ? ml.cymbals : (() => { const o = [new Float32Array(drums[0].length), new Float32Array(drums[0].length)]; for (const k of [dsp?.hats, dsp?.cymbals]) if (k) for (let c = 0; c < 2; c++) for (let i = 0; i < o[c].length; i++) o[c][i] += k[c][i]; return o; })());
  const rem = sub(drums, acc), rmsR = Math.sqrt(rem[0].reduce((s, v) => s + v * v, 0) / rem[0].length), rmsD = Math.sqrt(drums[0].reduce((s, v) => s + v * v, 0) / drums[0].length);
  parts.push({ key: 'remainder', name: 'Drum remainder', kind: 'drums', parent: 'drums', audio: rem, rmsDb: 20 * Math.log10((rmsR + 1e-12) / (rmsD + 1e-12)) });
  return { parts, events, notes };
}
