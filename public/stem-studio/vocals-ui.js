/** "Vocals" inspector tab: split a vocal stem into lead and backing vocals with the Mel-Band RoFormer karaoke model. */
import { VocalSplitter, splitVocalTrack, undoVocalSplit, vocalChildrenOf } from './vocals/vocal-split.js';
import { karaokeModel } from './vocals/karaoke-models.js';

let splitter = null;
const state = { gpu: !!globalThis.navigator?.gpu, last: null };
const fmtMB = (b) => `${Math.round(b / 1e6)} MB`;

export function mountVocals(pane, t, { eng, withBusy, announce, el, renderInspector, KIND_COLOR }) {
  splitter ||= new VocalSplitter();
  const model = karaokeModel(), done = vocalChildrenOf(eng, t);
  const probeNote = el('p', { class: 'warn-note', hidden: true, role: 'status' });
  const gpu = el('input', { type: 'checkbox', id: 'vk-gpu', checked: state.gpu && !!navigator.gpu, disabled: !navigator.gpu, onchange: () => { state.gpu = gpu.checked; } });
  const intro = el('p', { class: 'muted', text: `Separates the lead vocal from backing vocals and doubles with a neural model that runs in your browser. One-time ${fmtMB(model.sizeBytes)} download, then cached on this device. Lead + backing always add back up to this stem exactly.` });
  const opts = el('fieldset', { class: 'mb' }, el('legend', { text: 'Options' }),
    el('div', { class: 'row' }, gpu, el('label', { for: 'vk-gpu', text: navigator.gpu ? 'Use the GPU (recommended; falls back to CPU)' : 'GPU not available in this browser: CPU only, expect several minutes per song' })));
  const lic = el('details', { class: 'mb' }, el('summary', { text: `Model licence: ${model.license.spdx} — read before you ship stems from it` }),
    el('p', { class: 'muted' }, 'Mel-Band RoFormer Karaoke by aufr33 & viperx, ONNX re-export (', el('a', { href: model.license.url, target: '_blank', rel: 'noopener', text: 'MIT model card' }), '). ', model.license.note));
  const status = el('div', { class: 'muted', role: 'status' });
  const go = el('button', { class: 'btn pri', type: 'button', id: 'vk-go', text: done.length ? 'Split again' : 'Split lead / backing', onclick: () => run() });
  const cancel = el('button', { class: 'btn', type: 'button', text: 'Cancel', hidden: true, onclick: () => { splitter.cancel(); announce('Cancelling…'); } });
  const undo = el('button', { class: 'btn', type: 'button', text: 'Undo split', hidden: !done.length, onclick: async () => { await undoVocalSplit(eng, t); announce('Split undone: the original vocal stem is back.'); renderInspector(); } });
  async function run() {
    go.disabled = true; cancel.hidden = false; status.textContent = '';
    try {
      const r = await withBusy('Splitting lead / backing vocals', (prog) => splitVocalTrack(eng, splitter, t, { device: state.gpu ? 'webgpu' : 'wasm' }, prog));
      if (r) { state.last = r; announce('Vocals split into lead and backing.'); }
    } catch (e) { status.textContent = `Split failed: ${e.message || e}`; }
    finally { go.disabled = false; cancel.hidden = true; renderInspector(); }
  }
  const out = el('div');
  const kids = vocalChildrenOf(eng, t);
  if (kids.length) {
    out.append(el('h3', { text: 'Result' }), el('p', { class: 'muted', text: 'The vocal stem is muted and replaced by these two. Give each its own effects chain (e.g. wider reverb on the backing).' }),
      el('ul', { class: 'plain', 'aria-label': 'Derived vocal stems' }, kids.map((k) => el('li', null, el('span', { class: 'dot', style: `background:${KIND_COLOR[k.kind] || '#888'}` }), ` ${k.name}`))));
    if (state.last) out.append(el('p', { class: 'muted', text: `Split on ${state.last.backend === 'webgpu' ? 'GPU' : 'CPU'} took ${(state.last.ms / 1000).toFixed(1)} s.` }));
  }
  pane.append(intro, opts, lic, probeNote, el('div', { class: 'fxhead' }, go, cancel, undo), status, out);
  splitter.probe().then((p) => { if (!p.available) { probeNote.hidden = false; probeNote.textContent = `The lead / backing model is not reachable at ${p.url} right now.`; go.disabled = true; } });
}
