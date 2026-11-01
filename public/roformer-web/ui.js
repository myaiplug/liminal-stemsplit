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
import { createProgressPanel, computePeaks, fmtEta } from './progress.js';
import { cachedModelIds, clearModelCache, partialModelBytes, storageInfo, requestPersistence } from './model-store.js';
import { pickBusyWindow, fmtClock } from './window.js';
import { deriveDesk } from './derive.js';
import { encodeWav } from './wav.js';

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

export function mountStemSplit(root, { workerUrl, tips, tipLinks, appTitle, mode, previewSeconds = 20 } = {}) {
  const preview = mode === 'preview';
  root.classList.add('rf-root');
  root.textContent = '';

  const sep = new StemSeparator({ workerUrl });
  const state = { modelId: 'mini', file: null, busy: false, caps: null, cached: new Set(), partial: {}, urls: [], stems: [], loadedModel: null, decoded: null, pick: null, decodeJob: null };

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
    const partialChip = el('span', 'rf-chip rf-chip--size', ''); partialChip.hidden = true;
    top.append(badge, partialChip);
    body.append(top, el('p', 'rf-model__desc', m.description));
    body.append(el('p', 'rf-model__meta', `${m.stems.join(' · ')}  —  ${m.ramHint}`));
    if (m.warning) body.append(el('p', 'rf-model__warn', '⚠ ' + m.warning));
    body.append(el('p', 'rf-model__lic', `License: ${m.license.spdx}${m.license.caveat ? ` (${m.license.caveat})` : ''}`));
    label.append(radio, body);
    picker.append(label);
    modelCards[id] = { label, radio, badge, partialChip };
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
    state.decoded = null;
    state.pick = null;
    state.decodeJob = null;
    dropTitle.textContent = f ? f.name : 'Drop a track here or click to choose';
    dropSub.textContent = f ? `${(f.size / 1e6).toFixed(1)} MB. Click to change.` : 'WAV, MP3, FLAC, M4A, OGG. Decoded and processed on this device. Nothing is uploaded.';
    refresh();
    if (preview && f) analyzePreview(f);
  };
  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('rf-drop--over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('rf-drop--over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('rf-drop--over');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  // ---- actions + progress
  const goBtn = el('button', 'rf-btn rf-btn--primary', preview ? 'Split this 20 seconds' : 'Split stems');
  goBtn.type = 'button'; goBtn.disabled = true;
  const cancelBtn = el('button', 'rf-btn rf-btn--ghost', 'Cancel'); cancelBtn.type = 'button'; cancelBtn.hidden = true;
  const clearBtn = el('button', 'rf-btn rf-btn--link', 'Clear downloaded models'); clearBtn.type = 'button'; clearBtn.hidden = true;
  const actions = el('div', 'rf-actions'); actions.append(goBtn, cancelBtn, clearBtn);

  const windowBox = el('div', 'rf-window');
  windowBox.hidden = true;
  const windowText = el('p', 'rf-window__text', '');
  const reshuffle = el('button', 'rf-btn rf-btn--ghost rf-btn--sm', 'Pick another 20 seconds');
  reshuffle.type = 'button';
  windowBox.append(windowText, reshuffle);

  const storageRow = el('div', 'rf-storage');
  const storageText = el('span', 'rf-storage__text');
  const persistBtn = el('button', 'rf-btn rf-btn--link', 'Keep models on this device'); persistBtn.type = 'button'; persistBtn.hidden = true;
  const offlineNote = el('span', 'rf-storage__text rf-storage__offline');
  storageRow.append(storageText, persistBtn, offlineNote);

  const panel = createProgressPanel({ tips, tipLinks, appTitle });
  const prog = panel.el;
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
  const allBtn = el('button', 'rf-btn rf-btn--ghost', 'Download all (ZIP)'); allBtn.type = 'button';
  resHead.append(fmtLabel, allBtn);
  const resList = el('div', 'rf-stems');
  const resNote = el('p', 'rf-note');
  results.append(resHead, resList, resNote);

  root.append(banner, deviceRow, el('h3', 'rf-h', '1 · Pick a model'), picker, el('h3', 'rf-h', preview ? '2 · Choose a track. Only 20 seconds are split.' : '2 · Choose a track'), drop, windowBox, actions, storageRow, prog, msg, results);

  // ---- helpers
  function showMsg(text, kind = 'info') { msg.hidden = !text; msg.textContent = text || ''; msg.className = `rf-msg rf-msg--${kind}`; }
  function refresh() {
    for (const id of MODEL_ORDER) {
      modelCards[id].label.classList.toggle('rf-model--on', id === state.modelId);
      modelCards[id].badge.hidden = !state.cached.has(id);
      const pb = state.partial[id] || 0;
      modelCards[id].partialChip.hidden = state.cached.has(id) || pb <= 0;
      modelCards[id].partialChip.textContent = pb > 0 ? `${formatBytes(pb)} saved - will resume` : '';
      modelCards[id].radio.disabled = state.busy;
    }
    goBtn.disabled = state.busy || !state.file;
    cancelBtn.hidden = !state.busy;
    deviceSel.disabled = state.busy;
    clearBtn.hidden = state.busy || (state.cached.size === 0 && !Object.values(state.partial).some((n) => n > 0));
    const m = MODELS[state.modelId];
    if (preview) goBtn.textContent = state.cached.has(m.id) ? 'Split this 20 seconds' : `Download model (${formatBytes(m.sizeBytes)}) and split 20 seconds`;
    else goBtn.textContent = state.cached.has(m.id) ? 'Split stems' : `Download model (${formatBytes(m.sizeBytes)}) & split`;
    reshuffle.disabled = state.busy || !state.decoded;
  }
  async function refreshCache() {
    try { state.cached = new Set(await cachedModelIds()); } catch { state.cached = new Set(); }
    state.partial = {};
    for (const id of MODEL_ORDER) { try { state.partial[id] = await partialModelBytes(MODELS[id]); } catch { state.partial[id] = 0; } }
    refresh();
    refreshStorage();
  }
  async function refreshStorage() {
    const info = await storageInfo();
    const bits = [];
    if (info.quota != null) bits.push(`Browser storage: ${formatBytes(info.usage || 0)} used of ${formatBytes(info.quota)} available`);
    else bits.push('Browser storage: size unknown');
    if (!info.opfs) bits.push('this browser has no file storage for models - they re-download each visit');
    else if (info.persisted) bits.push('persistent (the browser will not evict your models)');
    else bits.push('not yet marked persistent (the browser may clear it if disk space runs low)');
    storageText.textContent = bits.join(' · ');
    persistBtn.hidden = !info.opfs || !!info.persisted;
    const sw = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller;
    offlineNote.textContent = sw ? (state.cached.size ? ' · Works offline.' : ' · Works offline once a model is downloaded.') : '';
  }
  function revokeUrls() { state.urls.forEach((u) => URL.revokeObjectURL(u)); state.urls = []; }

  function saveBlob(blob, filename) {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const baseName = () => (state.file?.name || 'track').replace(/\.[^.]+$/, '');

  function renderStems(info) {
    revokeUrls();
    resList.textContent = '';
    const model = MODELS[state.modelId];
    for (const name of info.stems) {
      const row = el('div', 'rf-stem');
      row.append(el('span', 'rf-stem__name', name));
      // Previews are built on demand from the stem store, so a long 6-stem job doesn't hold six WAV copies in RAM.
      const audio = el('audio', 'rf-stem__audio'); audio.controls = true; audio.preload = 'metadata'; audio.hidden = true;
      audio.addEventListener('play', () => resList.querySelectorAll('audio').forEach((a) => { if (a !== audio) a.pause(); }));
      const pv = el('button', 'rf-btn rf-btn--ghost rf-btn--sm rf-stem__preview', '▶ Preview'); pv.type = 'button';
      pv.addEventListener('click', async () => {
        if (!audio.src) {
          pv.disabled = true; pv.textContent = 'Preparing…';
          try {
            const blob = await sep.exportStem(name, 'pcm16');
            const url = URL.createObjectURL(blob); state.urls.push(url); audio.src = url;
          } catch (e) { showMsg(`Could not prepare the preview: ${e?.message || e}`, 'error'); pv.disabled = false; pv.textContent = '▶ Preview'; return; }
          pv.hidden = true; audio.hidden = false;
        }
        audio.play().catch(() => {});
      });
      const dl = el('button', 'rf-btn rf-btn--ghost rf-btn--sm rf-stem__dl', 'Download WAV'); dl.type = 'button';
      dl.addEventListener('click', () => downloadStem(name, dl));
      const play = el('div', 'rf-stem__play'); play.append(pv, audio);
      row.append(play, dl);
      resList.append(row);
    }
    state.stems = info.stems;
    resNote.textContent = `Separated with ${model.short} on ${info.backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'} in ${fmtTime(info.ms)}.${info.storeNote ? ' ' + info.storeNote : ''}`;
    results.hidden = false;
  }

  async function downloadStem(name, btn) {
    const format = fmtSel.value;
    const prev = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Encoding…'; }
    try {
      saveBlob(await sep.exportStem(name, format), `${baseName()} - ${name}.wav`);
    } catch (e) { showMsg(`Export failed: ${e?.message || e}`, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = prev; } }
  }
  allBtn.addEventListener('click', async () => {
    allBtn.disabled = true; const prev = allBtn.textContent; allBtn.textContent = 'Zipping…';
    try { saveBlob(await sep.exportZip(fmtSel.value, baseName()), `${baseName()} - stems.zip`); }
    catch (e) { showMsg(`ZIP failed: ${e?.message || e}`, 'error'); }
    finally { allBtn.disabled = false; allBtn.textContent = prev; }
  });

  function ensureDecoded(file) {
    if (state.decodeJob && state.decodeJob.file === file) return state.decodeJob.promise;
    const promise = decodeToStereo44k(file).then((audio) => {
      if (state.file === file) state.decoded = audio;
      return audio;
    });
    state.decodeJob = { file, promise };
    return promise;
  }
  function rollWindow(full) {
    const audio = full || state.decoded;
    if (!audio) return;
    state.pick = pickBusyWindow(audio.left, audio.right, 44100, previewSeconds);
    const p = state.pick;
    windowBox.hidden = false;
    windowText.textContent = p.candidates <= 1
      ? p.reason
      : `${fmtClock(p.startSec)} to ${fmtClock(p.startSec + p.seconds)}. ${p.reason}`;
    refresh();
  }
  async function analyzePreview(file) {
    windowBox.hidden = false;
    windowText.textContent = 'Reading the file to find a 20 second stretch with bass, drums, and vocals together.';
    reshuffle.disabled = true;
    try {
      const audio = await ensureDecoded(file);
      if (state.file !== file) return;
      rollWindow(audio);
    } catch (e) {
      if (state.file !== file) return;
      windowText.textContent = e?.message || String(e);
    }
  }
  function playableUrl(left, right) {
    const blob = new Blob([encodeWav([left, right], 44100, 'pcm16')], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    state.urls.push(url);
    return url;
  }
  async function offerDesk() {
    const existing = results.querySelector('.rf-desk');
    if (existing) existing.remove();
    const desk = el('div', 'rf-desk');
    desk.append(el('h3', 'rf-h', 'Break the stems down'));
    desk.append(el('p', 'rf-note', 'Lead vocal, backup / adlibs, 808, and the drum pieces (kick, snare/clap, hi-hats, crash, perk) are cut from the model stems above. The vocals, drums, bass, and other rows are the RoFormer. This second pass is not another neural model.'));
    const btn = el('button', 'rf-btn rf-btn--ghost', 'Cut lead, backup, 808, and the drum kit');
    btn.type = 'button';
    const list = el('div', 'rf-stems');
    desk.append(btn, list);
    results.append(desk);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Cutting…';
      try {
        const planes = {};
        for (const name of state.stems) {
          const p = await sep.readStem(name);
          planes[name] = [p.left, p.right];
        }
        const parts = deriveDesk(planes, 44100);
        list.textContent = '';
        let group = '';
        for (const part of parts) {
          if (part.group !== group) {
            group = part.group;
            list.append(el('p', 'rf-desk__group', group));
          }
          const row = el('div', 'rf-stem');
          row.append(el('span', 'rf-stem__name', part.name));
          const audio = el('audio', 'rf-stem__audio');
          audio.controls = true;
          audio.preload = 'none';
          audio.src = playableUrl(part.left, part.right);
          audio.addEventListener('play', () => results.querySelectorAll('audio').forEach((a) => { if (a !== audio) a.pause(); }));
          const dl = el('button', 'rf-btn rf-btn--ghost rf-btn--sm', 'Download WAV');
          dl.type = 'button';
          dl.addEventListener('click', () => {
            const blob = new Blob([encodeWav([part.left, part.right], 44100, 'pcm16')], { type: 'audio/wav' });
            saveBlob(blob, `${baseName()} - ${part.name}.wav`);
          });
          row.append(audio, dl);
          list.append(row);
        }
        btn.hidden = true;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Cut lead, backup, 808, and the drum kit';
        showMsg(`Could not cut the extra lanes: ${e?.message || e}`, 'error');
      }
    });
  }

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
    const needsDownload = !state.cached.has(model.id);
    panel.begin({ stems: model.stems, needsDownload, file: state.file });
    try {
      panel.stage('decode', { frac: null, label: 'Reading your audio…', detail: preview ? 'Picking a 20 second stretch on this device.' : 'Decoding and resampling on this device.' });
      let audio;
      if (preview) {
        const full = await ensureDecoded(state.file);
        if (!state.pick) rollWindow(full);
        const p = state.pick;
        audio = {
          left: full.left.slice(p.startSample, p.startSample + p.length),
          right: full.right.slice(p.startSample, p.startSample + p.length),
          duration: p.length / 44100,
          sourceRate: full.sourceRate,
        };
        showMsg(`${fmtClock(p.startSec)} to ${fmtClock(p.startSec + p.seconds)}. ${p.reason} The rest of the file stays on this device and is not split.`, 'info');
      } else {
        audio = await decodeToStereo44k(state.file);
      }
      panel.setTrack(computePeaks(audio.left, audio.right, 480), audio.duration); // before the buffers are handed to the worker
      if (!preview && audio.duration > 1200) showMsg(`This track is ${fmtTime(audio.duration * 1000)} long. Separation is streamed to keep memory low, but it will take a while and the decoded audio alone needs about ${Math.round(audio.duration * 44100 * 8 / 1e6)} MB of RAM.`, 'warn');
      else if (!preview && audio.sourceRate && audio.sourceRate !== 44100) showMsg(`Resampled from ${audio.sourceRate} Hz to 44100 Hz in your browser.`, 'info');

      const dl = { t0: 0, b0: 0 };
      const loadInfo = await sep.load(model.id, {
        device,
        onProgress: (p) => {
          if (p.notice) showMsg(p.notice, 'warn');
          if (p.phase === 'download') {
            const frac = p.total ? p.loaded / p.total : null;
            if (p.resumedFrom) panel.stage('download', { frac, label: `Resuming ${model.label} download…`, detail: `Continuing from ${formatBytes(p.resumedFrom)}` });
            else if (p.verifying) panel.stage('download', { frac: 1, label: 'Verifying download (SHA-256)…', detail: 'Making sure the file is intact.' });
            else if (p.fromCache) panel.stage('load', { frac, label: 'Loading model from browser storage…', detail: p.total ? `${formatBytes(p.loaded)} / ${formatBytes(p.total)}` : '' });
            else if (p.file) {
              if (!dl.t0) { dl.t0 = performance.now(); dl.b0 = p.loaded; }
              const secs = (performance.now() - dl.t0) / 1000;
              const rate = secs > 1 ? (p.loaded - dl.b0) / secs : 0;
              const eta = rate > 0 ? (p.total - p.loaded) / rate * 1000 : null;
              panel.stage('download', { frac, label: `Downloading ${model.label}…`,
                detail: `${formatBytes(p.loaded)} / ${formatBytes(p.total)} · ${Math.round((frac || 0) * 100)}%${rate ? ` · ${(rate / 1e6).toFixed(1)} MB/s` : ' · measuring speed…'}${eta != null ? ` · about ${fmtEta(eta)} left` : ''} · saved in your browser for next time` });
            }
          } else if (p.phase === 'init') panel.stage('load', { frac: null, label: 'Starting inference engine…', detail: 'Compiling the model. The first run of a big model can take a minute.' });
        },
      });
      await refreshCache();
      state.loadedModel = model.id;
      window.__rfLast = { model: model.id, load: loadInfo }; // read by the automated browser tests
      if (loadInfo.gpuError) showMsg(`WebGPU couldn't start (${loadInfo.gpuError}). Using the slower CPU path instead.`, 'warn');
      if (loadInfo.backend === 'wasm' && loadInfo.threads === 'single' && !loadInfo.gpuError && device !== 'wasm') showMsg('Running on CPU (single thread). This will be slow.', 'warn');

      panel.stage('separate', { frac: 0, label: 'Separating… getting the first chunk ready', detail: `${loadInfo.backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'}` });
      const info = await sep.separate(audio, {
        onProgress: (p) => {
          if (p.phase === 'separate') {
            panel.chunkProgress(p.done, p.total);
            panel.stage('separate', { frac: p.done / p.total, label: `Separating… chunk ${p.done} of ${p.total}`,
              detail: `${Math.round((p.done / p.total) * 100)}% · ${p.backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'} · about ${fmtEta(p.etaMs)} left` });
          } else if (p.phase === 'stem-chunk') {
            panel.stemChunk(p);
          } else if (p.phase === 'fallback') {
            panel.restartSeparation();
            showMsg(`WebGPU gave unusable output (${p.reason}). Restarted on the CPU — this will take longer.`, 'warn');
          }
        },
      });
      window.__rfLast.sep = info;
      panel.finish({ message: `Done. ${info.stems.length} stems ready.` });
      renderStems(info);
      if (preview) offerDesk();
    } catch (e) {
      panel.stop();
      if (e?.cancelled) showMsg('Cancelled.', 'info');
      else { console.error(e); showMsg(`Something went wrong: ${e?.message || e}`, 'error'); }
    } finally {
      state.busy = false; refresh(); refreshCache().catch(() => {});
    }
  }
  goBtn.addEventListener('click', run);
  reshuffle.addEventListener('click', () => { if (state.decoded && !state.busy) rollWindow(state.decoded); });
  cancelBtn.addEventListener('click', () => { sep.cancel(); cancelBtn.disabled = true; setTimeout(() => (cancelBtn.disabled = false), 1500); });
  clearBtn.addEventListener('click', async () => {
    sep.release();
    const failed = await clearModelCache();
    await refreshCache();
    showMsg(failed.length ? 'Some files are still in use - close other tabs using this tool and try again.' : 'Downloaded models removed from this browser.', failed.length ? 'warn' : 'info');
  });

  persistBtn.addEventListener('click', async () => {
    const ok = await requestPersistence();
    await refreshStorage();
    showMsg(ok ? 'Models will be kept on this device.' : 'The browser declined persistent storage (it grants it for installed/bookmarked/frequently used sites). Models are still saved and usually stay.', ok ? 'info' : 'warn');
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

  return { separator: sep, state, panel };
}
