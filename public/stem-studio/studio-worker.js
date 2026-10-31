/* Stem Studio background worker: artifact analysis/fixes, loudness measurement, normalisation. Pure DSP, no DOM. */
import { analyzeStem, applyFix, noiseProfile } from './artifacts.js';
import { measureLoudness } from './dsp/loudness.js';
import { normalizeToTarget } from './normalize.js';

const store = new Map(); // id -> {L,R,sr,name}
const post = (m, tr) => self.postMessage(m, tr || []);
const othersOf = (list = [], self_) => list.filter((o) => o.id !== self_ && store.has(o.id)).map((o) => ({ name: o.name, L: store.get(o.id).L, R: store.get(o.id).R }));

self.onmessage = (ev) => {
  const m = ev.data, rid = m.rid;
  const progress = (phase) => (f) => post({ type: 'progress', rid, phase, fraction: f });
  try {
    switch (m.op) {
      case 'put': store.set(m.id, { L: m.L, R: m.R, sr: m.sr, name: m.name }); post({ type: 'done', rid }); break;
      case 'drop': store.delete(m.id); post({ type: 'done', rid }); break;
      case 'analyze': {
        const s = store.get(m.id); if (!s) throw new Error('unknown track');
        const r = analyzeStem({ name: s.name, kind: m.kind, L: s.L, R: s.R }, s.sr, othersOf(m.others, m.id), { onProgress: progress('analyze') });
        post({ type: 'done', rid, result: r }); break;
      }
      case 'fix': {
        const s = store.get(m.id); if (!s) throw new Error('unknown track');
        let cur = { L: s.L, R: s.R }; const summaries = [];
        const others = othersOf(m.others, m.id);
        m.fixes.forEach((fx, i) => {
          const f = { ...fx, params: { ...(fx.params || {}) } };
          if (f.type === 'denoise' && !f.params.profile) f.params.profile = noiseProfile(s.L, s.R, s.sr); // profile from the untouched original
          const r = applyFix(f, cur, s.sr, others, { onProgress: (x) => progress('fix')((i + x) / m.fixes.length) });
          cur = { L: r.L, R: r.R }; summaries.push(r.summary);
        });
        if (cur.L === s.L) cur = { L: cur.L.slice(), R: cur.R.slice() }; // never transfer the stored original
        post({ type: 'done', rid, result: { L: cur.L, R: cur.R, summaries } }, [cur.L.buffer, cur.R.buffer].filter((b, i, a) => a.indexOf(b) === i)); break;
      }
      case 'loudness': { post({ type: 'done', rid, result: measureLoudness(m.L, m.R, m.sr) }); break; }
      case 'normalize': {
        const r = normalizeToTarget(m.L, m.R, m.sr, { lufs: m.lufs, tp: m.tp, maxGainDb: m.maxGainDb ?? 40 });
        post({ type: 'done', rid, result: r }, [r.L.buffer, r.R.buffer].filter((b, i, a) => a.indexOf(b) === i)); break;
      }
      default: throw new Error(`unknown op ${m.op}`);
    }
  } catch (e) { post({ type: 'error', rid, message: String(e?.message || e) }); }
};
