/**
 * Stem Studio UI. `mountStudio(root, { brand })`. All dynamic text goes through textContent.
 */
import { StudioEngine, LOUDNESS_TARGETS, STEM_KINDS, presetsFor, MODULES, defaultParams, listSessions, deleteSession, normalizeEdits, mapTime, resampleStereo } from './engine.js';
import { BRAND_LIMINAL } from './export.js';
import { mountSplitSource, readAudioFile } from './studio-source.js';
import { MODULE_IDS } from './presets.js';

const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const KIND_COLOR = { vocals: '#22d3ee', drums: '#f97316', bass: '#a855f7', other: '#22c55e', kick: '#fb923c', snare: '#f43f5e', hats: '#facc15', toms: '#ec4899', cymbals: '#fde047', sub808: '#8b5cf6', guitar: '#34d399', piano: '#60a5fa', instrumental: '#22c55e', ride: '#fcd34d', crash: '#fbbf24' };
const fmtT = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const fmtDb = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const dec = (step) => (String(step).includes('.') ? String(step).split('.')[1].length : 0);
const SEV_TXT = { high: 'High', medium: 'Medium', low: 'Low', info: 'Note' };

export async function mountStudio(root, { brand = BRAND_LIMINAL, appName = 'Stem Studio', desktopName = 'Liminal desktop app', engineOpts = {} } = {}) {
  const eng = new StudioEngine({ brand, ...engineOpts });
  window.__studio = eng;
  const ui = { sel: null, pxPerSec: 40, zoom: 0, link: true, tab: 'fx', lanes: new Map(), busy: null };
  const announce = (txt) => { live.textContent = ''; setTimeout(() => { live.textContent = txt; }, 30); };
  const live = el('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });

  /* ================= 1. sources ================= */
  const splitHost = el('div');
  const fileIn = el('input', { type: 'file', accept: 'audio/*,.wav,.flac,.mp3,.m4a,.ogg,.aif,.aiff', multiple: true, hidden: true });
  const dropTitle = el('b', { text: 'Drop stem files here or click to choose' });
  const drop = el('label', { class: 'drop' }, fileIn, dropTitle, el('span', { text: 'WAV keeps its exact sample rate. Compressed files decode at 44.1 kHz. Several files = several stems.' }));
  const importMsg = el('p', { class: 'muted' });
  const sessList = el('ul', { class: 'sessions' }); const sessEmpty = el('p', { class: 'muted', text: 'Nothing saved yet. Sessions are stored privately in this browser.' });
  const sources = el('section', { class: 'card', 'aria-labelledby': 'h-src' }, el('h2', { id: 'h-src' }, el('span', { class: 'n', text: '1' }), 'Get your stems'),
    el('div', { class: 'src' },
      el('details', { open: true }, el('summary', { text: 'Split a track in your browser' }), splitHost),
      el('details', { open: true }, el('summary', { text: 'Or import stems / audio files' }), drop, importMsg),
      el('details', { open: true }, el('summary', { text: 'Recent sessions' }), sessEmpty, sessList)));
  async function addStems(stems, { from } = {}) {
    if (from === 'split' && eng.tracks.length) { if (!confirm('Replace the stems in the studio with this new split? (Save the session first if you want to keep them.)')) return; await eng.clear(); }
    for (const s of stems) await eng.addTrack({ name: s.name, L: s.L, R: s.R, sr: s.sr });
    ui.sel = null; announce(`${stems.length} stem${stems.length === 1 ? '' : 's'} loaded.`); studio.hidden = false; exportCard.hidden = false; studio.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scheduleSave();
  }
  fileIn.addEventListener('change', () => importFiles([...fileIn.files]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]); });
  async function importFiles(files) {
    if (!files.length) return; importMsg.textContent = 'Reading files…'; const out = [], notes = [];
    for (const f of files) { try { const r = await readAudioFile(f); out.push(r); if (!r.exact) notes.push(`${f.name} was decoded by the browser at ${r.sr} Hz.`); } catch (e) { notes.push(`${f.name}: could not be read (${e.message || e}).`); } }
    importMsg.textContent = notes.join(' ');
    if (out.length) await addStems(out, { from: 'import' });
  }
  async function refreshSessions() {
    let list = []; try { list = await listSessions(); } catch { /* storage unavailable */ }
    sessList.textContent = ''; sessEmpty.hidden = list.length > 0;
    for (const s of list.slice(0, 8)) {
      const when = new Date(s.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      sessList.append(el('li', null, el('span', null, el('b', { text: s.name }), el('br'), el('span', { class: 'muted', text: `${s.tracks} stems · ${fmtT(s.durationSec)} · ${when}` })),
        el('span', { class: 'mini' }, el('button', { class: 'btn sm', type: 'button', text: 'Open', 'aria-label': `Open session ${s.name}`, onclick: async () => { announce('Opening session…'); await eng.loadSession(s.id); ui.sel = eng.selected; studio.hidden = false; exportCard.hidden = false; nameIn.value = eng.project.name; announce(`Session ${s.name} restored.`); } }),
          el('button', { class: 'btn sm', type: 'button', text: 'Delete', 'aria-label': `Delete session ${s.name}`, onclick: async () => { if (confirm(`Delete "${s.name}" from this browser?`)) { await deleteSession(s.id); refreshSessions(); } } }))));
    }
  }

  /* ================= 2. studio: transport, lanes ================= */
  const playBtn = el('button', { class: 'btn pri', type: 'button', text: '▶ Play', 'aria-label': 'Play', onclick: () => (eng.playing ? eng.pause() : eng.play()) });
  const stopBtn = el('button', { class: 'btn', type: 'button', text: '■ Stop', onclick: () => eng.stop() });
  const timeOut = el('span', { class: 'time', 'aria-live': 'off', text: '0:00.0 / 0:00.0' });
  const zoomIn = el('input', { type: 'range', min: 0, max: 100, value: 0, 'aria-label': 'Zoom', oninput: () => { ui.zoom = +zoomIn.value; layoutLanes(); } });
  const abBtn = el('button', { class: 'btn warn', type: 'button', 'aria-pressed': 'false', title: 'Bypass the effects on every stem (latency-aligned) to compare', text: 'A/B: FX on', onclick: () => { eng.setFxBypassAll(!eng.fxBypassAll); } });
  const nameIn = el('input', { type: 'text', value: eng.project.name, 'aria-label': 'Session name', size: 18, onchange: () => { eng.project.name = nameIn.value || 'Untitled session'; scheduleSave(); } });
  const saveBtn = el('button', { class: 'btn', type: 'button', text: 'Save session', onclick: () => doSave(true) });
  const saveStatus = el('span', { class: 'muted', role: 'status' });
  const mixLufs = el('span', { class: 'mono muted', text: 'Mix: not measured' });
  const mixBtn = el('button', { class: 'btn sm', type: 'button', text: 'Measure mix', onclick: async () => { mixBtn.disabled = true; mixLufs.textContent = 'Measuring…'; try { await eng.measureMix(); } finally { mixBtn.disabled = false; } } });
  const transport = el('div', { class: 'bar' }, playBtn, stopBtn, timeOut, el('label', { class: 'row' }, 'Zoom', zoomIn), abBtn, el('span', { class: 'grow' }), mixLufs, mixBtn);
  const sessionBar = el('div', { class: 'bar' }, el('label', { class: 'row' }, 'Session', nameIn), saveBtn, saveStatus);

  const rulerIn = el('div', { class: 'rinner' }); const rscroll = el('div', { class: 'rscroll', tabindex: 0, role: 'region', 'aria-label': 'Timeline scroll' }, rulerIn);
  const ruler = el('div', { class: 'ruler' }, el('div', { class: 'rl', text: 'Timeline (cuts struck through)' }), rscroll);
  const lanesEl = el('div', { class: 'lanes' }, ruler);
  const playhead = el('div', { class: 'ph', hidden: true });

  // selection + edit bar
  const selStart = el('input', { type: 'number', step: '0.01', min: 0, 'aria-label': 'Selection start (seconds)', onchange: () => setSelFromInputs() });
  const selEnd = el('input', { type: 'number', step: '0.01', min: 0, 'aria-label': 'Selection end (seconds)', onchange: () => setSelFromInputs() });
  const linkChk = el('input', { type: 'checkbox', checked: true, onchange: () => { ui.link = linkChk.checked; } });
  const eb = (text, fn, title) => el('button', { class: 'btn sm', type: 'button', text, title, onclick: fn });
  const editBar = el('div', { class: 'edit-bar' },
    el('span', { class: 'muted', text: 'Select a region (drag on a waveform) →' }), el('label', { class: 'row' }, 'Start', selStart), el('label', { class: 'row' }, 'End', selEnd),
    eb('Trim to selection', () => doEdit('trim'), 'Keep only the selection'), eb('Cut (snip)', () => doEdit('cut'), 'Remove the selection and close the gap'), eb('Silence', () => doEdit('silence'), 'Mute the selection, keep the length'),
    eb('Undo edit', () => eng.undoEdit(editIds())), eb('Reset edits', () => eng.resetEdits(editIds())), el('label', { class: 'row' }, linkChk, 'Apply to all stems'));
  const editIds = () => (ui.link ? eng.tracks.map((t) => t.id) : [eng.selected]);
  function setSel(a, b) { ui.sel = a == null ? null : { start: Math.min(a, b), end: Math.max(a, b) }; selStart.value = ui.sel ? ui.sel.start.toFixed(2) : ''; selEnd.value = ui.sel ? ui.sel.end.toFixed(2) : ''; drawSelection(); }
  function setSelFromInputs() { const a = parseFloat(selStart.value), b = parseFloat(selEnd.value); if (Number.isFinite(a) && Number.isFinite(b) && b > a) setSel(a, b); }
  function doEdit(kind) {
    if (!ui.sel || ui.sel.end - ui.sel.start < 0.005) { announce('Select a region first.'); return; }
    if (kind === 'trim') eng.trimTo(editIds(), ui.sel.start, ui.sel.end); else eng.addCut(editIds(), ui.sel.start, ui.sel.end, kind);
    setSel(null); announce(kind === 'trim' ? 'Trimmed.' : kind === 'cut' ? 'Region cut.' : 'Region silenced.');
  }

  /* ---- lane construction ---- */
  const origDur = () => Math.max(0.001, eng.frames / eng.sr);
  function layoutLanes() {
    const dur = origDur(), avail = Math.max(200, (rscroll.clientWidth || lanesEl.clientWidth - 280) - 2), fit = avail / dur;
    ui.pxPerSec = Math.min(fit * 2 ** (ui.zoom * 0.07), 14000 / dur); ui.pxPerSec = Math.max(ui.pxPerSec, fit);
    const W = Math.round(dur * ui.pxPerSec);
    rulerIn.style.width = `${W}px`; rulerIn.textContent = '';
    const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * ui.pxPerSec >= 70) || 120;
    for (let t = 0; t <= dur; t += step) rulerIn.append(el('div', { class: 'tick', style: `left:${t * ui.pxPerSec}px`, text: fmtT(t) }));
    for (const [id, l] of ui.lanes) { l.wi.style.width = `${W}px`; l.canvas.width = W; l.canvas.style.width = `${W}px`; drawWave(eng.trackById(id), l); }
    drawSelection(); placePlayhead();
  }
  function drawWave(t, l) {
    if (!t || !t.peaks) return; const c = l.canvas, g = c.getContext('2d'), W = c.width, H = c.height = 104, p = t.peaks, mid = H / 2, sr = eng.sr, pps = ui.pxPerSec;
    g.clearRect(0, 0, W, H); const color = KIND_COLOR[t.kind] || '#22d3ee';
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, mid, W, 1);
    g.fillStyle = color;
    for (let x = 0; x < W; x++) {
      const b0 = Math.floor((x / pps) * sr / p.block), b1 = Math.max(b0 + 1, Math.floor(((x + 1) / pps) * sr / p.block)); let lo = 1, hi = -1;
      for (let b = b0; b < b1 && b < p.min.length; b++) { if (p.min[b] < lo) lo = p.min[b]; if (p.max[b] > hi) hi = p.max[b]; }
      if (hi < lo) continue; const y0 = mid - hi * (mid - 3), y1 = mid - lo * (mid - 3); g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    // edit overlays
    const e = normalizeEdits(t.edits, t.orig[0].length / sr);
    if (e.trim) { g.fillStyle = 'rgba(2,6,23,.72)'; g.fillRect(0, 0, e.trim.start * pps, H); g.fillRect(e.trim.end * pps, 0, W - e.trim.end * pps, H); g.fillStyle = '#fff'; g.fillRect(e.trim.start * pps, 0, 1, H); g.fillRect(e.trim.end * pps - 1, 0, 1, H); }
    for (const o of e.ops) {
      const x0 = o.start * pps, w = (o.end - o.start) * pps;
      if (o.type === 'cut') { g.fillStyle = 'rgba(2,6,23,.8)'; g.fillRect(x0, 0, w, H); g.strokeStyle = 'rgba(236,72,153,.9)'; g.lineWidth = 1; g.beginPath(); for (let k = -H; k < w; k += 8) { g.moveTo(x0 + k, H); g.lineTo(x0 + k + H, 0); } g.save(); g.beginPath(); g.rect(x0, 0, w, H); g.clip(); g.stroke(); g.restore(); }
      else { g.fillStyle = 'rgba(2,6,23,.6)'; g.fillRect(x0, 0, w, H); g.fillStyle = 'rgba(250,204,21,.6)'; g.fillRect(x0, 0, w, 2); }
    }
    const marks = l.markers || []; g.fillStyle = 'rgba(236,72,153,.95)'; for (const m of marks) g.fillRect(m.start * pps, H - 6, Math.max(2, (m.end - m.start) * pps), 6);
  }
  function buildLanes() {
    for (const [, l] of ui.lanes) l.row.remove(); ui.lanes.clear();
    if (!eng.selected && eng.tracks.length) eng.selected = eng.tracks[0].id;
    for (const t of eng.tracks) {
      const color = KIND_COLOR[t.kind] || '#22d3ee';
      const nm = el('button', { class: 'nm', type: 'button', text: t.name, title: 'Select this stem to edit its effects', onclick: () => { eng.selected = t.id; updateSelection(); } });
      const kindSel = el('select', { 'aria-label': `${t.name} type`, onchange: () => { eng.setKind(t, kindSel.value); renderInspector(); } }, Object.entries(STEM_KINDS).map(([k, v]) => el('option', { value: k, text: v.label, selected: k === t.kind })));
      const mBtn = el('button', { class: 'btn', type: 'button', text: 'M', 'aria-label': `Mute ${t.name}`, 'aria-pressed': String(t.mute), title: 'Mute', onclick: () => { eng.setMix(t, { mute: !t.mute }); mBtn.setAttribute('aria-pressed', String(t.mute)); } });
      const sBtn = el('button', { class: 'btn', type: 'button', text: 'S', 'aria-label': `Solo ${t.name}`, 'aria-pressed': String(t.solo), title: 'Solo', onclick: () => { eng.setMix(t, { solo: !t.solo }); sBtn.setAttribute('aria-pressed', String(t.solo)); } });
      const fBtn = el('button', { class: 'btn warn', type: 'button', text: 'FX', 'aria-label': `Bypass effects on ${t.name}`, 'aria-pressed': String(t.bypass), title: 'Bypass this stem\u2019s effects (A/B)', onclick: () => { eng.setMix(t, { bypass: !t.bypass }); fBtn.setAttribute('aria-pressed', String(t.bypass)); fBtn.textContent = t.bypass ? 'FX off' : 'FX'; } });
      fBtn.textContent = t.bypass ? 'FX off' : 'FX';
      const gOut = el('output', { text: `${t.gain.toFixed(1)} dB` }), gain = el('input', { type: 'range', min: -36, max: 12, step: 0.1, value: t.gain, 'aria-label': `${t.name} gain in dB`, oninput: () => { eng.setMix(t, { gain: +gain.value }); gOut.textContent = `${(+gain.value).toFixed(1)} dB`; }, ondblclick: () => { gain.value = 0; gain.dispatchEvent(new Event('input')); } });
      const pOut = el('output', { text: panTxt(t.pan) }), pan = el('input', { type: 'range', min: -1, max: 1, step: 0.01, value: t.pan, 'aria-label': `${t.name} pan`, oninput: () => { eng.setMix(t, { pan: +pan.value }); pOut.textContent = panTxt(+pan.value); }, ondblclick: () => { pan.value = 0; pan.dispatchEvent(new Event('input')); } });
      const meter = el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i')); const lufs = el('div', { class: 'lufs', text: 'FX output not measured' });
      const lc = el('div', { class: 'lc' }, el('div', { class: 'top' }, el('span', { class: 'dot', style: `background:${color}` }), nm, kindSel),
        el('div', { class: 'top' }, el('div', { class: 'mini' }, mBtn, sBtn, fBtn), el('button', { class: 'btn sm', type: 'button', text: 'Measure', title: 'Render through the effects and measure LUFS / true peak', onclick: async (ev) => { ev.target.disabled = true; try { await eng.measureTrack(t); } finally { ev.target.disabled = false; } } })),
        el('label', { class: 'sl' }, 'Gain', gain, gOut), el('label', { class: 'sl' }, 'Pan', pan, pOut), meter, lufs);
      const canvas = el('canvas', { 'aria-hidden': 'true' }); const selRect = el('div', { class: 'sel-rect', hidden: true });
      const wi = el('div', { class: 'wi', tabindex: 0, role: 'group', 'aria-label': `${t.name} waveform. Drag to select a region, click to move the playhead. Use the Start and End boxes for precise selection.` }, canvas, selRect);
      const ws = el('div', { class: 'ws' }, wi);
      const row = el('div', { class: `lane${t.parent ? ' child' : ''}`, dataset: { id: t.id } }, lc, ws);
      lanesEl.append(row); ui.lanes.set(t.id, { row, wi, ws, canvas, selRect, meter: meter.firstChild, lufs, gOut, gain, nm, markers: [] });
      hookPointer(t, wi, ws);
      ws.addEventListener('scroll', () => syncScroll(ws));
    }
    lanesEl.append(playhead); layoutLanes(); updateSelection(); refreshLoudLabels();
  }
  const panTxt = (v) => (Math.abs(v) < 0.005 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
  let syncing = false;
  function syncScroll(src) { if (syncing) return; syncing = true; for (const l of ui.lanes.values()) if (l.ws !== src) l.ws.scrollLeft = src.scrollLeft; if (rscroll !== src) rscroll.scrollLeft = src.scrollLeft; syncing = false; placePlayhead(); }
  rscroll.addEventListener('scroll', () => syncScroll(rscroll));
  function hookPointer(t, wi) {
    const xToT = (ev) => Math.max(0, Math.min(origDur(), (ev.clientX - wi.getBoundingClientRect().left) / ui.pxPerSec));
    let drag = null;
    wi.addEventListener('pointerdown', (ev) => { wi.setPointerCapture(ev.pointerId); drag = { a: xToT(ev), moved: false }; eng.selected = t.id; updateSelection(); });
    wi.addEventListener('pointermove', (ev) => { if (!drag) return; const b = xToT(ev); if (Math.abs(b - drag.a) * ui.pxPerSec > 4) { drag.moved = true; setSel(drag.a, b); } });
    wi.addEventListener('pointerup', (ev) => { if (!drag) return; if (!drag.moved) { const m = mapTime(drag.a, eng.sr, t.orig[0].length, t.edits); if (m != null) eng.seek(m); setSel(null); } drag = null; });
    wi.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowLeft') { eng.seek(eng.position() - (ev.shiftKey ? 5 : 1)); ev.preventDefault(); } else if (ev.key === 'ArrowRight') { eng.seek(eng.position() + (ev.shiftKey ? 5 : 1)); ev.preventDefault(); } });
    rulerIn.onpointerdown = (ev) => { const x = (ev.clientX - rulerIn.getBoundingClientRect().left) / ui.pxPerSec; const tr = eng.trackById(eng.selected) || eng.tracks[0]; const m = tr && mapTime(x, eng.sr, tr.orig[0].length, tr.edits); if (m != null) eng.seek(m); };
  }
  function drawSelection() {
    for (const l of ui.lanes.values()) { if (!ui.sel) { l.selRect.hidden = true; continue; } l.selRect.hidden = false; l.selRect.style.left = `${ui.sel.start * ui.pxPerSec}px`; l.selRect.style.width = `${(ui.sel.end - ui.sel.start) * ui.pxPerSec}px`; }
  }
  function placePlayhead() {
    const tr = eng.trackById(eng.selected) || eng.tracks[0]; if (!tr || !ui.lanes.size) { playhead.hidden = true; return; }
    const x = eng.playheadOriginal(tr) * ui.pxPerSec, ws = [...ui.lanes.values()][0].ws, off = ws.getBoundingClientRect().left - lanesEl.getBoundingClientRect().left;
    playhead.hidden = false; playhead.style.left = `${off + x - ws.scrollLeft}px`; playhead.style.top = `${ruler.offsetHeight}px`; playhead.style.bottom = '0px';
    playhead.style.display = x - ws.scrollLeft < 0 || x - ws.scrollLeft > ws.clientWidth ? 'none' : '';
  }
  function updateSelection() {
    for (const [id, l] of ui.lanes) { l.row.classList.toggle('sel', id === eng.selected); l.nm.setAttribute('aria-current', id === eng.selected ? 'true' : 'false'); }
    renderInspector();
  }
  function refreshLoudLabels() {
    for (const [id, l] of ui.lanes) { const t = eng.trackById(id); const x = t?.loud; l.lufs.textContent = x ? `${fmtDb(x.integrated)} LUFS · ${fmtDb(x.truePeakDb)} dBTP` : 'FX output not measured'; }
    const m = eng.mixLoud; mixLufs.textContent = m ? `Mix: ${fmtDb(m.integrated)} LUFS · ${fmtDb(m.truePeakDb)} dBTP · LRA ${fmtDb(m.lra)}` : 'Mix: not measured';
  }
  function tick() {
    if (eng.playing || ui._wasPlaying) {
      timeOut.textContent = `${fmtT(eng.position())} / ${fmtT(eng.duration)}`; placePlayhead();
      for (const [id, l] of ui.lanes) l.meter.style.width = `${Math.min(100, Math.sqrt(eng.levelOf(id)) * 100)}%`;
      if (eng.playing && ui.lanes.size) { const ws = [...ui.lanes.values()][0].ws, tr = eng.trackById(eng.selected) || eng.tracks[0], x = eng.playheadOriginal(tr) * ui.pxPerSec; if (x > ws.scrollLeft + ws.clientWidth - 20 || x < ws.scrollLeft) { ws.scrollLeft = Math.max(0, x - 40); syncScroll(ws); } }
      ui._wasPlaying = eng.playing; if (!eng.playing) for (const l of ui.lanes.values()) l.meter.style.width = '0%';
    }
    requestAnimationFrame(tick);
  }
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(document.activeElement?.tagName || '') && eng.tracks.length) { e.preventDefault(); eng.playing ? eng.pause() : eng.play(); } });

  /* ================= 3. inspector ================= */
  const busyBox = el('div', { class: 'live', hidden: true, role: 'status' }); const busyTxt = el('span'); const busyBar = el('i'); busyBox.append(busyTxt, el('div', { class: 'pbar' }, busyBar));
  async function withBusy(label, fn) {
    if (ui.busy) { announce('Another task is running.'); return; } ui.busy = label; busyBox.hidden = false; busyTxt.textContent = label; busyBar.style.width = '4%';
    try { return await fn((p, txt) => { busyBar.style.width = `${Math.round(Math.min(1, p) * 100)}%`; if (txt) busyTxt.textContent = `${label} — ${txt}`; }); }
    catch (e) { console.error(e); busyTxt.textContent = `${label} failed: ${e.message || e}`; announce(`${label} failed.`); await new Promise((r) => setTimeout(r, 3000)); }
    finally { ui.busy = null; busyBox.hidden = true; }
  }
  const TABS = [['fx', 'Effects'], ['clean', 'Clean-up'], ['loud', 'Loudness'], ['drums', 'Drums']];
  const tabsEl = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Stem tools' }); const paneEl = el('div', { class: 'pane', role: 'tabpanel', id: 'pane' });
  const inspTitle = el('h3', { class: 'sr' });
  for (const [id, label] of TABS) tabsEl.append(el('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': 'pane', 'aria-selected': String(id === ui.tab), text: label, onclick: () => { ui.tab = id; renderInspector(); } }));
  tabsEl.addEventListener('keydown', (e) => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return; const i = TABS.findIndex(([id]) => id === ui.tab), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; ui.tab = n; renderInspector(); document.getElementById(`tab-${n}`).focus(); });
  const insp = el('aside', { class: 'insp', 'aria-label': 'Selected stem tools' }, tabsEl, paneEl);

  function renderInspector() {
    for (const [id] of TABS) { const b = document.getElementById(`tab-${id}`); if (b) { b.setAttribute('aria-selected', String(id === ui.tab)); b.tabIndex = id === ui.tab ? 0 : -1; } }
    const t = eng.trackById(eng.selected); paneEl.textContent = ''; paneEl.setAttribute('aria-labelledby', `tab-${ui.tab}`);
    if (!t) { paneEl.append(el('p', { class: 'muted', text: 'Load some stems to start.' })); return; }
    paneEl.append(el('h3', { text: `${t.name} · ${STEM_KINDS[t.kind]?.label || t.kind}` }));
    ({ fx: renderFx, clean: renderClean, loud: renderLoud, drums: renderDrums })[ui.tab](t);
  }

  /* ---- effects ---- */
  const FID_TXT = { exact: 'Same as desktop', fixed: 'Desktop bug fixed', approx: 'Approximation', studio: 'Studio extra' };
  function renderFx(t) {
    const presets = presetsFor(t.kind), groups = { desktop: 'Desktop presets', studio: 'Studio presets (new)', classic: 'Classic presets' };
    const sel = el('select', { 'aria-label': 'Preset', onchange: () => eng.applyPreset(t, sel.value) }, el('option', { value: '', text: '— Blank (start from scratch) —', selected: !t.presetId }),
      Object.entries(groups).map(([fam, label]) => { const ps = presets.filter((p) => p.family === fam); return ps.length ? el('optgroup', { label }, ps.map((p) => el('option', { value: p.id, text: p.name, selected: t.presetId === p.id || t.presetId === `${p.id}*` }))) : null; }));
    const cur = presets.find((p) => p.id === (t.presetId || '').replace('*', ''));
    const ab = el('button', { class: 'btn warn', type: 'button', 'aria-pressed': String(t.bypass), text: t.bypass ? 'A/B: FX bypassed' : 'A/B: FX on', onclick: () => { eng.setMix(t, { bypass: !t.bypass }); const l = ui.lanes.get(t.id); if (l) { const b = l.row.querySelector('.mini .warn'); b.setAttribute('aria-pressed', String(t.bypass)); b.textContent = t.bypass ? 'FX off' : 'FX'; } renderInspector(); } });
    paneEl.append(el('div', { class: 'fxhead' }, sel, ab, el('button', { class: 'btn sm', type: 'button', text: 'Reset', onclick: () => eng.applyPreset(t, '') })));
    paneEl.append(el('p', { class: 'muted', text: cur ? `${cur.description || ''}${t.presetId?.endsWith('*') ? ' (edited)' : ''}` : 'Pick a preset or switch modules on one by one. Everything is previewed live; exports render the same chain offline.' }));
    t.chain.forEach((m, idx) => paneEl.append(moduleCard(t, m, idx)));
    const have = new Set(t.chain.map((m) => m.type)), avail = MODULE_IDS.filter((id) => !have.has(id));
    if (avail.length) paneEl.append(el('label', { class: 'row' }, 'Add module', el('select', { 'aria-label': 'Add effect module', onchange: (e) => { const ty = e.target.value; if (!ty) return; eng.setFx(t, [...t.chain, { type: ty, enabled: true, params: defaultParams(ty) }], t.presetId); } }, el('option', { value: '', text: 'Choose…' }), avail.map((id) => el('option', { value: id, text: MODULES[id].name })))));
  }
  const openMods = new Set();
  function moduleCard(t, m, idx) {
    const spec = MODULES[m.type]; if (!spec) return el('div');
    const key = `${t.id}:${m.type}`;
    const chk = el('input', { type: 'checkbox', checked: m.enabled, 'aria-label': `Enable ${spec.name}`, onclick: (e) => e.stopPropagation(), onchange: () => { eng.setEnabled(t, idx, chk.checked); card.classList.toggle('off', !chk.checked); } });
    const move = (d) => (e) => { e.preventDefault(); e.stopPropagation(); const c = [...t.chain], j = idx + d; if (j < 0 || j >= c.length) return; [c[idx], c[j]] = [c[j], c[idx]]; eng.setFx(t, c, t.presetId ? `${t.presetId.replace('*', '')}*` : null); };
    const bodyId = `mb-${key.replace(/\W/g, '')}`;
    const tg = el('button', { type: 'button', class: 'tg', 'aria-expanded': String(openMods.has(key)), 'aria-controls': bodyId, text: spec.name, onclick: () => { const o = card.classList.toggle('open'); body.hidden = !o; tg.setAttribute('aria-expanded', String(o)); o ? openMods.add(key) : openMods.delete(key); } });
    const head = el('div', { class: 'mh' }, chk, tg, el('span', { class: `chip ${spec.fidelity}`, title: spec.fidelityNote || '', text: FID_TXT[spec.fidelity] || spec.fidelity }),
      el('span', { class: 'ctl' }, el('button', { class: 'btn sm', type: 'button', text: '↑', 'aria-label': `Move ${spec.name} up`, onclick: move(-1) }), el('button', { class: 'btn sm', type: 'button', text: '↓', 'aria-label': `Move ${spec.name} down`, onclick: move(1) }),
        el('button', { class: 'btn sm', type: 'button', text: '✕', 'aria-label': `Remove ${spec.name}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); eng.setFx(t, t.chain.filter((_, i) => i !== idx), t.presetId); } })));
    const body = el('div', { class: 'mb', id: bodyId, hidden: !openMods.has(key) }, el('p', { class: 'muted', text: spec.description || '' }), spec.fidelityNote ? el('p', { class: 'muted', text: `Fidelity: ${spec.fidelityNote}` }) : null);
    for (const p of spec.params) {
      const v = m.params[p.id] ?? p.value;
      if (p.kind === 'select') { body.append(el('label', { class: 'pr' }, p.label, el('select', { 'aria-label': `${spec.name} ${p.label}`, onchange: (e) => eng.setParam(t, idx, p.id, e.target.value) }, p.options.map((o) => el('option', { value: o.value ?? o, text: o.label ?? o, selected: String(o.value ?? o) === String(v) }))), el('span'))); continue; }
      if (p.kind === 'toggle') { body.append(el('label', { class: 'pr' }, p.label, el('input', { type: 'checkbox', checked: !!v, 'aria-label': `${spec.name} ${p.label}`, onchange: (e) => eng.setParam(t, idx, p.id, e.target.checked) }), el('span'))); continue; }
      const log = !!p.log, toS = (x) => (log ? 1000 * Math.log(x / p.min) / Math.log(p.max / p.min) : x), fromS = (s) => (log ? p.min * (p.max / p.min) ** (s / 1000) : s);
      const d = Math.max(dec(p.step), log ? 0 : 0), out = el('output', { text: `${(+v).toFixed(log ? (v < 100 ? 1 : 0) : d)}${p.unit ? ` ${p.unit}` : ''}` });
      const r = el('input', { type: 'range', min: log ? 0 : p.min, max: log ? 1000 : p.max, step: log ? 1 : p.step, value: toS(+v), 'aria-label': `${spec.name} ${p.label}`, 'aria-valuetext': out.textContent,
        oninput: () => { let x = fromS(+r.value); x = log ? Math.round(x * (x < 100 ? 10 : 1)) / (x < 100 ? 10 : 1) : Math.round(x / p.step) * p.step; x = Math.min(p.max, Math.max(p.min, +x.toFixed(6))); out.textContent = `${x.toFixed(log ? (x < 100 ? 1 : 0) : d)}${p.unit ? ` ${p.unit}` : ''}`; r.setAttribute('aria-valuetext', out.textContent); eng.setParam(t, idx, p.id, x); },
        ondblclick: () => { r.value = toS(p.value); r.dispatchEvent(new Event('input')); } });
      body.append(el('label', { class: 'pr' }, p.label, r, out));
    }
    const card = el('div', { class: `mod${m.enabled ? '' : ' off'}${openMods.has(key) ? ' open' : ''}` }, head, body);
    return card;
  }

  /* ---- clean-up (artifacts) ---- */
  const REPAIRS = [['declick', 'De-click'], ['denoise', 'Noise reduction'], ['fillholes', 'Fill spectral holes'], ['smooth', 'Smooth watery artifacts'], ['phase', 'Fix phase'], ['bleed', 'Reduce bleed from other stems']];
  function markersFor(t) { const l = ui.lanes.get(t.id); if (!l) return; l.markers = []; for (const i of t.issues || []) for (const w of i.where || []) l.markers.push({ start: w.start ?? w[0], end: w.end ?? w[1] }); drawWave(t, l); }
  function renderClean(t) {
    const scan = el('button', { class: 'btn pri', type: 'button', text: t.issues ? 'Re-scan' : 'Scan for artifacts', onclick: () => withBusy(`Scanning ${t.name}`, async (p) => { await eng.analyze(t, (x, s) => p(x, s)); markersFor(t); announce(`${t.issues.length} finding${t.issues.length === 1 ? '' : 's'}.`); renderInspector(); }) });
    const ab = el('button', { class: 'btn', type: 'button', 'aria-pressed': String(t.fixesOn), text: t.fixesOn ? 'Hearing: after fixes' : 'Hearing: before fixes', disabled: !t.fixes.length, onclick: () => eng.setFixesPreview(t, !t.fixesOn) });
    paneEl.append(el('p', { class: 'muted', text: 'Finds separation artifacts in plain language and repairs them without touching the original. Fixes are applied before the effects and are included in exports.' }), el('div', { class: 'fxhead' }, scan, ab));
    if (t.metrics) paneEl.append(el('div', { class: 'kv' }, ...Object.entries(t.metrics).filter(([, v]) => typeof v === 'number').slice(0, 6).map(([k, v]) => el('div', null, el('b', { text: Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2) }), el('small', { text: k })))));
    if (t.fixes.length) paneEl.append(el('h3', { text: 'Applied fixes' }), ...t.fixes.map((f) => el('div', { class: 'issue' }, el('h4', { text: f.label }), el('p', { text: f.summary || '' }), el('div', { class: 'acts' }, el('button', { class: 'btn sm', type: 'button', text: 'Undo this fix', onclick: () => withBusy('Removing fix', (p) => eng.removeFix(t, f.id, (x, s) => p(x, s)).then(renderInspector)) })))));
    if (t.issues) {
      paneEl.append(el('h3', { text: t.issues.length ? 'What we found' : 'Nothing that needs fixing' }));
      if (!t.issues.length) paneEl.append(el('div', { class: 'ok-note', text: 'This stem looks clean.' }));
      for (const i of t.issues) {
        const done = i.fix && t.fixes.some((f) => f.type === i.fix.type && JSON.stringify(f.params) === JSON.stringify(i.fix.params || {}));
        paneEl.append(el('div', { class: 'issue' }, el('h4', null, el('span', { class: `chip sev-${i.severity}`, text: SEV_TXT[i.severity] || i.severity }), i.title), el('p', { text: i.plain }),
          el('div', { class: 'acts' }, i.where?.length ? el('button', { class: 'btn sm', type: 'button', text: `Jump to ${fmtT(i.where[0].start ?? i.where[0][0])}`, onclick: () => { const w = i.where[0], s = w.start ?? w[0], e = w.end ?? w[1]; setSel(s, Math.max(e, s + 0.05)); const m = mapTime(s, eng.sr, t.orig[0].length, t.edits); if (m != null) eng.seek(m); } }) : null,
            i.fix ? el('button', { class: 'btn sm pri', type: 'button', disabled: done, text: done ? 'Applied' : i.fix.label || 'Fix it', onclick: () => withBusy(i.fix.label || 'Fixing', async (p) => { await eng.addFix(t, i.fix, (x, s) => p(x, s)); announce('Fix applied. You can compare before and after with the toggle.'); renderInspector(); }) }) : null)));
      }
    }
    paneEl.append(el('h3', { text: 'Manual repair tools' }), el('div', { class: 'acts', style: 'display:flex;flex-wrap:wrap;gap:.4rem' }, ...REPAIRS.map(([type, label]) => el('button', { class: 'btn sm', type: 'button', text: label, onclick: () => withBusy(label, async (p) => { await eng.addFix(t, { type, label, params: {} }, (x, s) => p(x, s)); renderInspector(); }) }))));
  }

  /* ---- loudness ---- */
  function loudKv(x) { return el('div', { class: 'kv' }, ...[['Integrated', `${fmtDb(x.integrated)} LUFS`], ['Short-term max', `${fmtDb(x.shortTermMax)} LUFS`], ['Loudness range', `${fmtDb(x.lra)} LU`], ['True peak', `${fmtDb(x.truePeakDb)} dBTP`], ['Sample peak', `${fmtDb(x.samplePeakDb)} dBFS`]].map(([k, v]) => el('div', null, el('b', { text: v }), el('small', { text: k })))); }
  function renderLoud(t) {
    const tsel = el('select', { 'aria-label': 'Loudness target', id: 'loud-target' }, LOUDNESS_TARGETS.map((x) => el('option', { value: x.id, text: x.label, selected: x.id === (ui.target || 'streaming') })));
    tsel.addEventListener('change', () => { ui.target = tsel.value; exTarget.value = tsel.value; });
    paneEl.append(el('p', { class: 'muted', text: 'ITU-R BS.1770-4 K-weighted loudness with EBU gating, plus 4× oversampled true peak, measured after the effects and fader gain.' }),
      el('div', { class: 'fxhead' }, el('button', { class: 'btn pri', type: 'button', text: 'Measure this stem', onclick: async (e) => { e.target.disabled = true; try { await eng.measureTrack(t); renderInspector(); } finally { e.target.disabled = false; } } }), el('button', { class: 'btn', type: 'button', text: 'Measure mix', onclick: () => mixBtn.click() })),
      t.loud ? el('div', null, el('h3', { text: 'This stem' }), loudKv(t.loud)) : el('p', { class: 'muted', text: 'Not measured yet (or the chain changed). Press Measure.' }),
      eng.mixLoud ? el('div', null, el('h3', { text: 'Mix (audible stems)' }), loudKv(eng.mixLoud)) : null,
      el('h3', { text: 'Match to a target' }), el('div', { class: 'fxhead' }, tsel, el('button', { class: 'btn', type: 'button', text: 'Match this stem (fader)', title: 'Moves the stem fader so its integrated loudness hits the target. No limiter.', onclick: () => withBusy('Matching loudness', async () => { const tg = LOUDNESS_TARGETS.find((x) => x.id === tsel.value); const g = await eng.matchTrackLufs(t, tg.lufs); const l = ui.lanes.get(t.id); if (l) { l.gain.value = t.gain; l.gOut.textContent = `${t.gain.toFixed(1)} dB`; } announce(g == null ? 'Stem is silent.' : `Fader moved ${g.toFixed(1)} dB.`); await eng.measureTrack(t); renderInspector(); }) })),
      el('p', { class: 'muted', text: 'To hit a target on the final files (with a true-peak limiter) use the Export panel below: normalise the mix or each stem.' }));
  }

  /* ---- drums ---- */
  function renderDrums(t) {
    paneEl.append(el('p', { class: 'muted', text: 'Split the drum stem into kick, snare/clap, toms, hi-hats, cymbals and an 808/sub layer, each with its own effect chain.' }));
    if (t.kind !== 'drums') { paneEl.append(el('div', { class: 'warn-note', text: 'Select the Drums stem (or set a stem’s type to Drums) to use the deeper split.' })); return; }
    if (ui.drumsMount) ui.drumsMount(paneEl, t, { eng, withBusy, announce, el, renderInspector, KIND_COLOR });
    else paneEl.append(el('p', { class: 'muted', text: 'Drum split module is loading…' }));
  }

  /* ================= 4. export ================= */
  const exFormat = el('select', { 'aria-label': 'Format', id: 'ex-format' }, [['pcm24', 'WAV 24-bit'], ['float32', 'WAV 32-bit float'], ['pcm16', 'WAV 16-bit'], ['mp3', 'MP3 (LAME)']].map(([v, l]) => el('option', { value: v, text: l })));
  const exNorm = el('select', { 'aria-label': 'Normalise', id: 'ex-norm' }, [['off', 'Off — render exactly what you hear'], ['mix', 'Mix to target (stems keep their balance)'], ['each', 'Every stem to target']].map(([v, l]) => el('option', { value: v, text: l })));
  const exTarget = el('select', { 'aria-label': 'Export loudness target', id: 'ex-target' }, LOUDNESS_TARGETS.map((x) => el('option', { value: x.id, text: x.label })));
  exTarget.addEventListener('change', () => { ui.target = exTarget.value; });
  const exKbps = el('select', { 'aria-label': 'MP3 bitrate' }, [128, 192, 256, 320].map((k) => el('option', { value: k, text: `${k} kbps`, selected: k === 256 })));
  const exTail = el('input', { type: 'checkbox', checked: true }); const exMix = el('input', { type: 'checkbox', checked: true }); const exZip = el('input', { type: 'checkbox', checked: true });
  const exTitle = el('input', { type: 'text', placeholder: 'Title (optional)', 'aria-label': 'Title tag', size: 18 }); const exArtist = el('input', { type: 'text', placeholder: 'Artist (optional)', 'aria-label': 'Artist tag', size: 18 });
  const stemChecks = el('div', { class: 'grid2', role: 'group', 'aria-label': 'Stems to export' });
  const exResult = el('div'); const exInfo = el('p', { class: 'muted' }); const mp3Note = el('p', { class: 'muted', hidden: true });
  mp3Note.append('MP3 encoding uses ', el('a', { href: 'vendor/lamejs/README.md', text: 'lamejs (LGPL-3.0, LAME)' }), ' — loaded only when you pick MP3. WAV is lossless and keeps the full headroom.');
  const exBtn = el('button', { class: 'btn pri', type: 'button', text: 'Render & export', onclick: doExport });
  function syncExportUi() {
    exMp3Visible(); exInfo.textContent = eng.tracks.length ? `Renders at ${eng.sr} Hz — the same rate as your stems, no resampling. Credit “${brand.credit}” and a link are written into each file’s tags (WAV INFO / iXML / ID3, MP3 ID3).` : '';
    const keep = new Map([...stemChecks.querySelectorAll('input')].map((i) => [i.value, i.checked])); stemChecks.textContent = '';
    for (const t of eng.tracks) stemChecks.append(el('label', { class: 'row' }, el('input', { type: 'checkbox', value: t.id, checked: keep.has(t.id) ? keep.get(t.id) : !(t.mute && t.parent == null && eng.tracks.some((x) => x.parent === t.id)) }), t.name));
  }
  const exMp3Visible = () => { mp3Note.hidden = exFormat.value !== 'mp3'; exKbps.parentElement.hidden = exFormat.value !== 'mp3'; };
  exFormat.addEventListener('change', exMp3Visible);
  const exportCard = el('section', { class: 'card', hidden: true, 'aria-labelledby': 'h-ex' }, el('h2', { id: 'h-ex' }, el('span', { class: 'n', text: '3' }), 'Render & export'),
    el('div', { class: 'grid2' }, el('label', { class: 'row' }, 'Format', exFormat), el('label', { class: 'row' }, 'Normalise', exNorm), el('label', { class: 'row' }, 'Target', exTarget), el('label', { class: 'row', hidden: true }, 'MP3', exKbps),
      el('label', { class: 'row' }, exTail, 'Keep effect tails (reverb/delay)'), el('label', { class: 'row' }, exMix, 'Include full mix'), el('label', { class: 'row' }, exZip, 'Bundle as ZIP'), el('label', { class: 'row' }, 'Title', exTitle), el('label', { class: 'row' }, 'Artist', exArtist)),
    el('h3', { style: 'margin:.8rem 0 .4rem;font-size:.85rem', text: 'Stems to include' }), stemChecks, exInfo, mp3Note, el('div', { class: 'bar', style: 'margin-top:.8rem' }, exBtn), busyBox, exResult);
  exKbps.parentElement.hidden = true;
  async function doExport() {
    const ids = [...stemChecks.querySelectorAll('input:checked')].map((i) => i.value); if (!ids.length && !exMix.checked) { announce('Choose something to export.'); return; }
    const tg = LOUDNESS_TARGETS.find((x) => x.id === exTarget.value);
    await withBusy('Rendering', async (p) => {
      const r = await eng.exportAll({ format: exFormat.value, normalize: exNorm.value, target: { lufs: tg.lufs, tp: tg.tp }, tail: exTail.checked, ids, mix: exMix.checked, zip: exZip.checked, title: exTitle.value, artist: exArtist.value, mp3kbps: +exKbps.value }, (x, s) => p(x, s));
      exResult.textContent = ''; ui.urls?.forEach(URL.revokeObjectURL); ui.urls = [];
      const links = r.files.map((f) => { const u = URL.createObjectURL(new Blob([f.data], { type: f.mime })); ui.urls.push(u); return el('a', { class: 'btn pri', href: u, download: f.name, text: `Download ${f.name} (${(f.data.byteLength / 1048576).toFixed(1)} MB)` }); });
      const rows = r.report.map((x) => el('tr', null, el('td', { text: x.file }), el('td', { text: `${(x.frames / x.sampleRate).toFixed(2)} s` }), el('td', { text: x.lufs == null ? '—' : `${fmtDb(x.lufs)} LUFS` }), el('td', { text: x.tp == null ? '—' : `${fmtDb(x.tp)} dBTP` }), el('td', { text: x.note || '' })));
      upsell.hidden = true; exResult.append(el('div', { class: 'bar', style: 'margin-top:1rem' }, ...links), el('table', { class: 'rep' }, el('thead', null, el('tr', null, ...['File', 'Length', 'Loudness', 'True peak', 'Note'].map((h) => el('th', { text: h })))), el('tbody', null, ...rows)), upsellCopy());
      links[0].focus(); announce(`Export ready: ${r.files.length} file${r.files.length > 1 ? 's' : ''}.`);
      if (r.files.length === 1) links[0].click();
    });
  }

  /* ================= 5. save / events / assemble ================= */
  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => doSave(false), 4000); }
  async function doSave(manual) {
    if (!eng.tracks.length || ui.saving) return; ui.saving = true; saveStatus.textContent = 'Saving…';
    try { const s = await eng.saveSession(nameIn.value || undefined); saveStatus.textContent = `Saved in this browser at ${new Date(s.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; refreshSessions(); if (manual) announce('Session saved in this browser.'); }
    catch (e) { saveStatus.textContent = `Could not save: ${e.message || e}`; } finally { ui.saving = false; }
  }
  const upsellCopy = () => { const c = el('div', { class: 'upsell', role: 'group', 'aria-label': 'More from NoDAW' }, ...[...upsell.children].map((k) => k.cloneNode(true))); c.querySelector('h2').removeAttribute('id'); return c; };
  const offers = brand.offers || [{ id: 'one', name: desktopName, tag: '', blurb: `The ${desktopName} runs the full models on your GPU and exports straight into your DAW.`, cta: `Get ${desktopName}`, url: brand.upgradeUrl }];
  const upsell = el('aside', { class: 'upsell', 'aria-labelledby': 'upsell-h' }, el('h2', { id: 'upsell-h', text: 'Want more than a browser tab can do?' }), el('div', { class: 'offers' }, ...offers.map((o) => el('div', { class: 'offer' }, el('b', { text: o.name }), o.tag ? el('span', { class: 'ot', text: o.tag }) : null, el('p', { class: 'muted', text: o.blurb }), el('a', { class: 'btn', href: o.url, target: '_blank', rel: 'noopener', 'aria-label': `${o.cta} (opens in a new tab)`, text: `${o.cta} ↗` })))));
  eng.addEventListener('change', (ev) => {
    const w = ev.detail.what;
    if (w === 'tracks') { buildLanes(); syncExportUi(); timeOut.textContent = `${fmtT(eng.position())} / ${fmtT(eng.duration)}`; mixLufs.textContent = 'Mix: not measured'; scheduleSave(); }
    else if (w === 'edits') { for (const [id, l] of ui.lanes) drawWave(eng.trackById(id), l); timeOut.textContent = `${fmtT(eng.position())} / ${fmtT(eng.duration)}`; scheduleSave(); }
    else if (w === 'fx') { if (!ev.detail.soft) renderInspector(); scheduleSave(); }
    else if (w === 'mix') { abBtn.setAttribute('aria-pressed', String(eng.fxBypassAll)); abBtn.textContent = eng.fxBypassAll ? 'A/B: FX bypassed' : 'A/B: FX on'; if (ev.detail.id) scheduleSave(); }
    else if (w === 'fixes' || w === 'issues') { const t = eng.trackById(ev.detail.id); if (t && w === 'fixes') { drawWave(t, ui.lanes.get(t.id)); } scheduleSave(); }
    else if (w === 'loudness') { refreshLoudLabels(); if (ui.tab === 'loud') renderInspector(); }
    else if (w === 'transport') { playBtn.textContent = eng.playing ? '⏸ Pause' : '▶ Play'; playBtn.setAttribute('aria-label', eng.playing ? 'Pause' : 'Play'); timeOut.textContent = `${fmtT(eng.position())} / ${fmtT(eng.duration)}`; placePlayhead(); }
    if (w === 'tracks' || w === 'mix') syncMixIndicators();
  });
  function syncMixIndicators() { for (const [id, l] of ui.lanes) { const t = eng.trackById(id); if (!t) continue; const b = l.row.querySelectorAll('.mini .btn'); b[0].setAttribute('aria-pressed', String(t.mute)); b[1].setAttribute('aria-pressed', String(t.solo)); } }
  let lastW = 0; new ResizeObserver(() => { const w = rscroll.clientWidth; if (w && w !== lastW && ui.lanes.size) { lastW = w; layoutLanes(); } }).observe(rscroll);
  window.addEventListener('beforeunload', () => { if (eng.dirtyAudio.size) { doSave(false); } });

  const studio = el('section', { class: 'card', hidden: true, 'aria-labelledby': 'h-st' }, el('h2', { id: 'h-st' }, el('span', { class: 'n', text: '2' }), 'Edit, clean & mix'), sessionBar, transport, editBar,
    el('div', { class: 'studio', style: 'margin-top:.9rem' }, lanesEl, insp));
  root.append(live, sources, studio, exportCard, upsell);

  const api = { engine: eng, addStems, ui, el, withBusy, renderInspector, KIND_COLOR, announce, importFiles };
  try { await mountSplitSource(splitHost, addStems, { appTitle: appName }); }
  catch (e) { splitHost.append(el('p', { class: 'warn-note', text: `The in-browser splitter could not start (${e.message || e}). You can still import stems or audio files.` })); }
  try { const m = await import('./drums-ui.js'); ui.drumsMount = m.mountDrums; } catch { /* drum module not present yet */ }
  refreshSessions(); renderInspector(); requestAnimationFrame(tick);
  window.__studioUi = api;
  return api;
}
