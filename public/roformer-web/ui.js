/**
 * Drop-in "split stems in your browser" widget.
 *
 *   import { mountStemSplit } from './roformer-web/ui.js';
 *   mountStemSplit(document.getElementById('app'));
 *
 * Styling comes from rf.css (themed through --rf-* custom properties that the
 * host page sets). All user/file-derived strings are inserted with textContent.
 */
import { MODELS, MODEL_ORDER, formatBytes } from './models.js';
import { StemSeparator, detectCapabilities, decodeToStereo44k } from './client.js';
import { cachedModelIds, clearModelCache } from './model-store.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

const MODEL_BLURB = {
  mini: 'Fast preview (4 stems, Mini)',
  duality: 'Clean vocals (Duality, 2 stems)',
  bs6: 'Full 6-stem (BS-Roformer-SW)',
};

export function mountStemSplit(root, { workerUrl } = {}) {
  root.classList.add('rf-root');
  root.textContent = '';

  const sep = new StemSeparator({ workerUrl });
  const state = { modelId: 'mini', file: null, busy: false, caps: null, cached: new Set(), urls: [], stems: [], loadedModel: null };

  // ---- capability banner
  const banner = el('div', 'rf-banner rf-banner--wait', 'Checking your GPU…');
  const deviceRow = el('label', 'rf-device');
  deviceRow.append('Compute: ');
  const deviceSel = el('select', 'rf-select');
  for (const [v, t] of [['auto', 'Auto (GPU if available)'], ['wasm', 'CPU only (WASM, slower)']]) {
    const o = el('option', '', t); o.value = v; deviceSel.append(o);
  }
  deviceRow.append(deviceSel);

  // ---- model picker
  const picker = el('div', 'rf-models');
  picker.setAttribute('role', 'radiogroup');
  picker.setAttribute('aria-label', 'Separation model');
  const modelCards = {};
  for (const id of MODEL_ORDER) {
    const m = MODELS[id];
    const label = el('label', 'rf-model');
    const radio = el('input'); radio.type = 'radio'; radio.name = 'rf-model'; radio.value = id; radio.checked = id === state.modelId;
    const body = el('div', 'rf-model__body');
    const top = el('div', 'rf-model__top');
    top.append(el('span', 'rf-model__name', MODEL_BLURB[id]), el('span', 'rf-chip rf-chip--size', formatBytes(m.sizeBytes)));
    const badge = el('span', 'rf-chip rf-chip--ok', 'Downloaded'); badge.hidden = true;
    top.append(badge);
    body.append(top, el('p', 'rf-model__desc', m.description));
    body.append(el('p', 'rf-model__meta', `${m.stems.join(' · ')}  —  ${m.ramHint}`));
    if (m.warning) body.append(el('p', 'rf-model__warn', '⚠ ' + m.warning));
    body.append(el('p', 'rf-model__lic', `License: ${m.license.spdx}${m.license.caveat ? ` (${m.license.caveat})` : ''}`));
    label.append(radio, body);
    picker.append(label);
    modelCards[id] = { label, radio, badge };
    radio.addEventListener('change', () => { state.modelId = id; refresh(); });
  }

  // ---- file input
  const drop = el('label', 'rf-drop');
  const fileInput = el('input'); fileInput.type = 'file'; fileInput.accept = 'audio/*,.wav,.mp3,.flac,.m4a,.aiff,.aif,.ogg,.opus,.webm';
  fileInput.hidden = true;
  const dropTitle = el('b', '', 'Drop a track here or click to choose');
  const dropSub = el('span', '', 'WAV, MP3, FLAC, M4A, OGG. Decoded and processed on this device — nothing is uploaded.');
  drop.append(fileInput, dropTitle, dropSub);
  const setFile = (f) => {
    state.file = f || null;
    dropTitle.textContent = f ? f.name : 'Drop a track here or click to choose';
    dropSub.textContent = f ? `${(f.size / 1e6).toFixed(1)} MB — click to change` : 'WAV, MP3, FLAC, M4A, OGG. Decoded and processed on this device — nothing is uploaded.';
    refresh();
  };
  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('rf-drop--over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('rf-drop--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('rf-drop--over');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  // ---- actions + progress
  const goBtn = el('button', 'rf-btn rf-btn--primary', 'Split stems');
  goBtn.type = 'button'; goBtn.disabled = true;
  const cancelBtn = el('button', 'rf-btn rf-btn--ghost', 'Cancel'); cancelBtn.type = 'button'; cancelBtn.hidden = true;
  const clearBtn = el('button', 'rf-btn rf-btn--link', 'Clear downloaded models'); clearBtn.type = 'button'; clearBtn.hidden = true;
  const actions = el('div', 'rf-actions'); actions.append(goBtn, cancelBtn, clearBtn);

  const prog = el('div', 'rf-progress'); prog.hidden = true;
  const progLabel = el('div', 'rf-progress__label');
  const progBar = el('div', 'rf-bar'); const progFill = el('div', 'rf-bar__fill'); progBar.append(progFill);
  progBar.setAttribute('role', 'progressbar');
  const progSub = el('div', 'rf-progress__sub');
  prog.append(progLabel, progBar, progSub);
  const msg = el('div', 'rf-msg'); msg.hidden = true;

  // ---- results
  const results = el('div', 'rf-results'); results.hidden = true;
  const resHead = el('div', 'rf-results__head');
  resHead.append(el('h3', 'rf-h', 'Stems'));
  const fmtLabel = el('label', 'rf-device'); fmtLabel.append('Download as: ');
  const fmtSel = el('select', 'rf-select');
  for (const [v, t] of [['pcm16', 'WAV 16-bit'], ['pcm24', 'WAV 24-bit'], ['float32', 'WAV 32-bit float']]) {
    const o = el('option', '', t); o.value = v; fmtSel.append(o);
  }
  fmtLabel.append(fmtSel);
  const allBtn = el('button', 'rf-btn rf-btn--ghost', 'Download all'); allBtn.type = 'button';
  resHead.append(fmtLabel, allBtn);
  const resList = el('div', 'rf-stems');
  const resNote = el('p', 'rf-note');
  results.append(resHead, resList, resNote);

  root.append(banner, deviceRow, el('h3', 'rf-h', '1 · Pick a model'), picker, el('h3', 'rf-h', '2 · Choose a track'), drop, actions, prog, msg, results);

  // ---- helpers
  function showMsg(text, kind = 'info') { msg.hidden = !text; msg.textContent = text || ''; msg.className = `rf-msg rf-msg--${kind}`; }
  function setProgress(label, frac, sub) {
    prog.hidden = false;
    progLabel.textContent = label;
    progFill.style.width = frac == null ? '100%' : `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    progFill.classList.toggle('rf-bar__fill--indet', frac == null);
    progBar.setAttribute('aria-valuenow', frac == null ? '' : String(Math.round(frac * 100)));
    progSub.textContent = sub || '';
  }
  function refresh() {
    for (const id of MODEL_ORDER) {
      modelCards[id].label.classList.toggle('rf-model--on', id === state.modelId);
      modelCards[id].badge.hidden = !state.cached.has(id);
      modelCards[id].radio.disabled = state.busy;
    }
    goBtn.disabled = state.busy || !state.file;
    cancelBtn.hidden = !state.busy;
    deviceSel.disabled = state.busy;
    clearBtn.hidden = state.busy || state.cached.size === 0;
    const m = MODELS[state.modelId];
    goBtn.textContent = state.cached.has(m.id) ? 'Split stems' : `Download model (${formatBytes(m.sizeBytes)}) & split`;
  }
  async function refreshCache() {
    try { state.cached = new Set(await cachedModelIds()); } catch { state.cached = new Set(); }
    refresh();
  }
  function revokeUrls() { state.urls.forEach((u) => URL.revokeObjectURL(u)); state.urls = []; }

  function renderStems(wavs, info) {
    revokeUrls();
    resList.textContent = '';
    const model = MODELS[state.modelId];
    const names = model.stems.filter((n) => wavs[n]);
    for (const name of names) {
      const url = URL.createObjectURL(new Blob([wavs[name]], { type: 'audio/wav' }));
      state.urls.push(url);
      const row = el('div', 'rf-stem');
      row.append(el('span', 'rf-stem__name', name));
      const audio = el('audio', 'rf-stem__audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = url;
      // Only one stem plays at a time.
      audio.addEventListener('play', () => resList.querySelectorAll('audio').forEach((a) => { if (a !== audio) a.pause(); }));
      const dl = el('button', 'rf-btn rf-btn--ghost rf-btn--sm', 'Download WAV'); dl.type = 'button';
      dl.addEventListener('click', () => downloadStem(name, dl));
      row.append(audio, dl);
      resList.append(row);
    }
    state.stems = names;
    resNote.textContent = `Separated with ${model.short} on ${info.backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'} in ${fmtTime(info.ms)}.`;
    results.hidden = false;
  }

  async function downloadStem(name, btn) {
    const format = fmtSel.value;
    const prev = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Encoding…'; }
    try {
      const buf = await sep.exportStem(name, format);
      const base = (state.file?.name || 'track').replace(/\.[^.]+$/, '');
      const a = el('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      a.download = `${base} - ${name}.wav`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } finally { if (btn) { btn.disabled = false; btn.textContent = prev; } }
  }
  allBtn.addEventListener('click', async () => {
    allBtn.disabled = true;
    try { for (const n of state.stems) await downloadStem(n, null); } finally { allBtn.disabled = false; }
  });

  // ---- main flow
  async function run() {
    if (state.busy || !state.file) return;
    const model = MODELS[state.modelId];
    const gpu = !!state.caps?.webgpu && deviceSel.value !== 'wasm';
    const device = gpu ? 'auto' : 'wasm';
    if (!gpu && model.id !== 'mini') {
      const ok = window.confirm(`${model.label} on the CPU is very slow (${model.speedHint}).\n\nContinue anyway? The Fast preview model is much more practical without a GPU.`);
      if (!ok) return;
    }
    state.busy = true; results.hidden = true; showMsg('');
    refresh();
    try {
      setProgress('Reading audio…', null);
      const audio = await decodeToStereo44k(state.file);
      if (audio.duration > 600) showMsg(`This track is ${fmtTime(audio.duration * 1000)} long. Long files use a lot of memory — if the tab runs out, try a shorter section.`, 'warn');

      const loadInfo = await sep.load(model.id, {
        device,
        onProgress: (p) => {
          if (p.phase === 'download') {
            const frac = p.total ? p.loaded / p.total : null;
            if (p.verifying) setProgress('Verifying download…', null);
            else if (p.fromCache) setProgress('Loading model from browser cache…', frac);
            else setProgress(`Downloading ${model.label} model…`, frac, `${formatBytes(p.loaded)} / ${formatBytes(p.total)} — saved in your browser for next time`);
          } else if (p.phase === 'init') setProgress('Starting inference engine…', null, 'Compiling the model — first run on a big model can take a minute.');
        },
      });
      await refreshCache();
      state.loadedModel = model.id;
      if (loadInfo.gpuError) showMsg(`WebGPU couldn't start (${loadInfo.gpuError}). Using the slower CPU path instead.`, 'warn');
      if (loadInfo.backend === 'wasm' && loadInfo.threads === 'single' && !loadInfo.gpuError && device !== 'wasm') showMsg('Running on CPU (single thread). This will be slow.', 'warn');

      const info = await sep.separate(audio, {
        onProgress: (p) => {
          if (p.phase === 'separate') {
            setProgress(`Separating… ${p.done}/${p.total} segments`, p.done / p.total,
              `${p.backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'} · about ${fmtTime(p.etaMs)} left`);
          } else if (p.phase === 'fallback') {
            showMsg(`WebGPU gave unusable output (${p.reason}). Restarted on the CPU — this will take longer.`, 'warn');
          }
        },
      });
      setProgress('Done', 1, '');
      renderStems(info.wavs, info);
    } catch (e) {
      if (e?.cancelled) { showMsg('Cancelled.', 'info'); prog.hidden = true; }
      else { console.error(e); showMsg(`Something went wrong: ${e?.message || e}`, 'error'); prog.hidden = true; }
    } finally {
      state.busy = false; refresh();
    }
  }
  goBtn.addEventListener('click', run);
  cancelBtn.addEventListener('click', () => { sep.cancel(); cancelBtn.disabled = true; setTimeout(() => (cancelBtn.disabled = false), 1500); });
  clearBtn.addEventListener('click', async () => {
    sep.release();
    await clearModelCache();
    await refreshCache();
    showMsg('Downloaded models removed from this browser.', 'info');
  });

  // ---- init
  refresh();
  refreshCache();
  detectCapabilities().then((caps) => {
    state.caps = caps;
    if (caps.webgpu) {
      banner.className = 'rf-banner rf-banner--ok';
      banner.textContent = `WebGPU ready — ${caps.adapter}. Separation will run on your GPU.`;
    } else {
      banner.className = 'rf-banner rf-banner--warn';
      banner.textContent = `${caps.reason} Separation will fall back to your CPU (WASM), which is much slower — the Fast preview model is the practical choice.`;
    }
    window.__rfCaps = caps;
  });

  return { separator: sep, state };
}
