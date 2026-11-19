/** "Drums" inspector tab: deeper drum split (AI model or DSP) into kick / snare / toms / hats / cymbals / 808. */
import { DrumSplitter, splitDrumTrack, undoDrumSplit, childrenOf } from './drums/drum-split.js';
import { drumModel, drumModelHtr } from './drums/drum-models.js';

let splitter = null;
const state = { mode: 'ml', model: 'drumsep-v2-w10', hats: true, sub808: true, fc: 120, gpu: false, probe: null, probeHtr: null, last: null };
const fmtMB = (b) => `${Math.round(b / 1e6)} MB`;

export function mountDrums(pane, t, { eng, withBusy, announce, el, renderInspector, KIND_COLOR }) {
  splitter ||= new DrumSplitter();
  const model = drumModel(), htr = drumModelHtr(), done = childrenOf(eng, t);

  /* ---- mode ---- */
  const mlRadio = el('input', { type: 'radio', name: 'drum-mode', id: 'dm-ml', value: 'ml', checked: state.mode === 'ml', onchange: () => { state.mode = 'ml'; } });
  const dspRadio = el('input', { type: 'radio', name: 'drum-mode', id: 'dm-dsp', value: 'dsp', checked: state.mode === 'dsp', onchange: () => { state.mode = 'dsp'; } });
  const mlNote = el('span', { class: 'muted', id: 'dm-ml-note', text: `Kick, snare, toms and cymbals separated by a neural model that runs in your browser. One-time ${fmtMB(model.sizeBytes)} download, then cached on this device.` });
  const probeNote = el('p', { class: 'warn-note', hidden: true, role: 'status' });
  /* ---- which AI model ---- */
  const v2Radio = el('input', { type: 'radio', name: 'drum-model', id: 'dmm-v2', value: 'drumsep-v2-w10', checked: state.model !== 'drumsep-ht-roformer', onchange: () => { state.model = 'drumsep-v2-w10'; syncModel(); } });
  const htrRadio = el('input', { type: 'radio', name: 'drum-model', id: 'dmm-htr', value: 'drumsep-ht-roformer', checked: state.model === 'drumsep-ht-roformer', onchange: () => { state.model = 'drumsep-ht-roformer'; syncModel(); } });
  const htrNote = el('span', { class: 'muted', id: 'dmm-htr-note', text: `Six stems straight from the model, hi-hats included. ${fmtMB(htr.sizeBytes)} download. The author has not published a licence yet, so this model is only offered once it is hosted with permission.` });
  const modelBox = el('fieldset', { class: 'mb' }, el('legend', { text: 'AI model' }),
    el('div', { class: 'row' }, v2Radio, el('label', { for: 'dmm-v2' }, el('b', { text: 'DrumSep v2 ' }), el('span', { class: 'muted', text: '4 stems + hi-hat heuristic, MIT' }))),
    el('div', { class: 'row' }, htrRadio, el('label', { for: 'dmm-htr' }, el('b', { text: 'HT-RoFormer 6-stem ' }), el('span', { class: 'badge', text: 'new' }))), el('div', { style: 'margin:0 0 .5rem 1.6rem' }, htrNote));
  function syncModel() {
    const isHtr = state.model === 'drumsep-ht-roformer'; hatsRow.hidden = isHtr;
    licSummary.textContent = isHtr ? 'Model licence: none published for HT-RoFormer — personal testing only' : `Model licence: ${model.license.spdx} — read before you ship stems from it`;
  }
  const modeBox = el('fieldset', { class: 'mb' }, el('legend', { text: 'How to split' }),
    el('div', { class: 'row' }, mlRadio, el('label', { for: 'dm-ml' }, el('b', { text: 'AI split ' }), el('span', { class: 'badge', text: 'best' }))), el('div', { style: 'margin:0 0 .5rem 1.6rem' }, mlNote),
    el('div', { class: 'row' }, dspRadio, el('label', { for: 'dm-dsp' }, el('b', { text: 'Quick DSP split ' }), el('span', { class: 'badge', text: 'rough' }))),
    el('div', { style: 'margin:0 0 .5rem 1.6rem' }, el('span', { class: 'muted', text: 'No download. Splits by frequency band and transient-vs-sustain only, so snare, toms and hats bleed into each other much more.' })), probeNote);

  /* ---- options ---- */
  const hats = el('input', { type: 'checkbox', id: 'dm-hats', checked: state.hats, onchange: () => { state.hats = hats.checked; } });
  const sub = el('input', { type: 'checkbox', id: 'dm-808', checked: state.sub808, onchange: () => { state.sub808 = sub.checked; fcRow.hidden = !sub.checked; } });
  const fcOut = el('output', { class: 'mono', text: `${state.fc} Hz` });
  const fc = el('input', { type: 'range', min: 60, max: 200, step: 5, value: state.fc, id: 'dm-fc', 'aria-label': '808 crossover frequency', oninput: () => { state.fc = +fc.value; fcOut.textContent = `${state.fc} Hz`; } });
  const fcRow = el('div', { class: 'row', hidden: !state.sub808, style: 'margin-left:1.6rem' }, el('label', { for: 'dm-fc', text: 'Sub crossover' }), fc, fcOut);
  const hasBass = eng.tracks.some((x) => x.kind === 'bass' && !x.parent);
  const gpu = el('input', { type: 'checkbox', id: 'dm-gpu', checked: state.gpu, disabled: !navigator.gpu, onchange: () => { state.gpu = gpu.checked; } });
  const hatsRow = el('div', { class: 'row', hidden: state.model === 'drumsep-ht-roformer' }, hats, el('label', { for: 'dm-hats', text: 'Split hi-hats from crash/ride (heuristic)' }));
  const opts = el('fieldset', { class: 'mb' }, el('legend', { text: 'Options' }),
    hatsRow,
    el('div', { class: 'row' }, sub, el('label', { for: 'dm-808', text: hasBass ? '808 / sub layer from the Bass stem + long-ringing kicks' : '808 / sub layer from long-ringing kicks (no Bass stem loaded)' })), fcRow,
    el('div', { class: 'row' }, gpu, el('label', { for: 'dm-gpu', text: navigator.gpu ? 'Try the GPU (experimental, falls back to CPU)' : 'GPU not available in this browser, using CPU' })));

  /* ---- licence flag ---- */
  const licSummary = el('summary', { text: '' });
  const lic = el('details', { class: 'mb' }, licSummary,
    el('p', { class: 'muted' }, 'DrumSep v2 by gridshiftstudio (', el('a', { href: model.license.url, target: '_blank', rel: 'noopener', text: 'MIT' }), '), a fine-tune of inagoy/drumsep (MIT). ', model.license.note),
    el('p', { class: 'muted', text: 'Quality: kick and snare are strong; cymbals are fair and toms are the weakest output, so expect some bleed. Needs roughly 1–2 GB of free memory while it runs; the model is fed 10 s windows.' }),
    el('p', { class: 'muted' }, 'HT-RoFormer by Sucial (', el('a', { href: htr.license.url, target: '_blank', rel: 'noopener', text: 'model page' }), '): ', htr.license.note));

  /* ---- actions ---- */
  const status = el('div', { class: 'muted', role: 'status' });
  const go = el('button', { class: 'btn pri', type: 'button', id: 'dm-go', text: done.length ? 'Split again' : 'Split drums', onclick: () => run() });
  const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancel', hidden: true, onclick: () => { splitter.cancel(); announce('Cancelling…'); } });
  const undo = el('button', { class: 'btn', type: 'button', text: 'Undo split', hidden: !done.length, onclick: async () => { await undoDrumSplit(eng, t); announce('Split undone: the original drum stem is back.'); renderInspector(); } });
  async function run() {
    go.disabled = true; cancel.hidden = false; status.textContent = '';
    try {
      const r = await withBusy('Splitting drums', (prog) => splitDrumTrack(eng, splitter, t, { mode: state.mode, model: state.model, hats: state.hats, sub808: state.sub808, fc: state.fc, device: state.gpu ? 'webgpu' : 'wasm' }, prog));
      if (r) { state.last = r; announce(`Drums split into ${r.tracks.length} stems.`); }
    } finally { go.disabled = false; cancel.hidden = true; renderInspector(); }
  }

  const out = el('div');
  const showResult = () => {
    const kids = childrenOf(eng, t); if (!kids.length) return;
    const list = el('ul', { class: 'plain', 'aria-label': 'Derived drum stems' }, kids.map((k) => el('li', null, el('span', { class: 'dot', style: `background:${KIND_COLOR[k.kind] || '#888'}` }), ` ${k.name}`)));
    out.append(el('h3', { text: 'Result' }), el('p', { class: 'muted', text: 'The drum stem is muted and replaced by these. Mix them with solo/mute/gain on the lanes above, and give each its own effects chain.' }), list);
    const r = state.last;
    if (r) {
      out.append(el('p', { class: 'muted', text: `${r.backend === 'dsp' ? 'DSP split' : `AI split on ${r.backend === 'webgpu' ? 'GPU' : 'CPU'}`} took ${(r.ms / 1000).toFixed(1)} s.${r.remainderDb != null ? ` Drum remainder (what no stem claimed) is ${r.remainderDb.toFixed(1)} dB below the drums.` : ''}` }));
      for (const n of r.notes) out.append(el('p', { class: 'muted', text: n }));
      const e8 = (r.events || []).filter((e) => e.is808); if (state.sub808) out.append(el('p', { class: 'muted', text: e8.length ? `${e8.length} long-ringing kick${e8.length > 1 ? 's' : ''} (${e8.slice(0, 6).map((e) => `${e.startS.toFixed(1)} s`).join(', ')}${e8.length > 6 ? '…' : ''}) moved to 808 / sub.` : 'No long-ringing kicks found; the 808 layer only holds bass sub.' }));
    }
  };

  syncModel();
  pane.append(modeBox, modelBox, opts, lic, el('div', { class: 'fxhead' }, go, cancel, undo), status, out);
  showResult();
  splitter.probe('drumsep-ht-roformer').then((p) => {
    state.probeHtr = p;
    if (!p.available) {
      htrRadio.disabled = true; if (state.model === 'drumsep-ht-roformer') { state.model = 'drumsep-v2-w10'; v2Radio.checked = true; syncModel(); }
      htrNote.textContent = p.reason === 'not-hosted'
        ? 'Not available yet: the author has not published a licence, so the model is not hosted. (Testers: add ?drummodel_htr=<url> to the page address.)'
        : `The HT-RoFormer model is not reachable at ${p.url}.`;
    }
  });
  splitter.probe().then((p) => {
    state.probe = p;
    if (!p.available) {
      probeNote.hidden = false; probeNote.textContent = `The AI drum model is not available at ${p.url} yet, so only the quick DSP split can run.`;
      mlRadio.disabled = true; if (state.mode === 'ml') { state.mode = 'dsp'; dspRadio.checked = true; }
    }
  });
}
