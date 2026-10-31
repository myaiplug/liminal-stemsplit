/**
 * Unified, interactive progress experience for in-browser stem separation.
 *
 *  - stage stepper (read audio -> download -> start engine -> separate -> done) + one overall bar
 *  - live canvas: waveform of the user's own track, a sweep that follows real chunk progress,
 *    and one lane per stem that fills in with the stem's actual loudness as chunks finish
 *  - scrubbable preview of the original track, and tap-to-hear early stem previews
 *  - rotating original mixing tips (optionally linked by the host page)
 *  - tab-leave protection (beforeunload, title progress, optional notification, chime, wake lock)
 *
 * Everything runs on the main thread in a few KB of work per chunk; the heavy work stays in the worker.
 * Honours prefers-reduced-motion (no animation loops, tips only change on request).
 */
import { TIPS } from './tips.js';
import { PEAK_BLOCK } from './sinks.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtEta = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

/** Where each stage sits in the overall 0..1 bar. Downloading only counts when a download is needed. */
export function stageWeights(needsDownload) {
  return needsDownload
    ? { decode: 0.02, download: 0.38, load: 0.05, separate: 0.55 }
    : { decode: 0.02, download: 0, load: 0.06, separate: 0.92 };
}
export function overallFraction(stage, frac, needsDownload) {
  const w = stageWeights(needsDownload);
  const order = ['decode', 'download', 'load', 'separate'];
  if (stage === 'done') return 1;
  let base = 0;
  for (const s of order) { if (s === stage) break; base += w[s]; }
  const f = frac == null ? 0 : Math.max(0, Math.min(1, frac));
  return Math.min(1, base + (w[stage] || 0) * f);
}

/** Peak envelope of a Float32 channel pair, `bins` values in 0..1 (used for the waveform of the uploaded track). */
export function computePeaks(left, right, bins) {
  const out = new Float32Array(bins);
  const n = left.length;
  for (let b = 0; b < bins; b++) {
    const s = Math.floor((b * n) / bins), e = Math.max(s + 1, Math.floor(((b + 1) * n) / bins));
    const step = Math.max(1, Math.floor((e - s) / 64));
    let m = 0;
    for (let i = s; i < e; i += step) { const v = Math.max(Math.abs(left[i]), Math.abs(right[i])); if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}

const STEPS = [
  ['decode', 'Read audio'],
  ['download', 'Get model'],
  ['load', 'Start engine'],
  ['separate', 'Separate'],
  ['done', 'Done'],
];

export function createProgressPanel({ tips = TIPS, tipLinks = {}, tipRotateMs = 9000, appTitle } = {}) {
  const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const baseTitle = appTitle || document.title;

  const root = el('section', 'rf-live'); root.hidden = true;
  root.setAttribute('aria-label', 'Separation progress');

  // --- stepper + overall bar
  const steps = el('ol', 'rf-steps');
  const stepEls = {};
  for (const [id, label] of STEPS) { const li = el('li', 'rf-step', label); li.dataset.state = 'pending'; li.dataset.step = id; steps.append(li); stepEls[id] = li; }
  const bar = el('div', 'rf-bigbar'); bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-label', 'Overall progress');
  const barFill = el('div', 'rf-bigbar__fill'); const barPct = el('span', 'rf-bigbar__pct', '0%');
  bar.append(barFill, barPct);
  const label = el('div', 'rf-live__label rf-progress__label'); const detail = el('div', 'rf-live__detail rf-progress__sub');
  const safe = el('p', 'rf-live__safe', 'Safe to leave: the model download is saved in this browser and picks up where it stopped if you close this tab. Separation itself restarts from the beginning.');
  const status = el('div', 'rf-sr'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');

  // --- waveform canvas + original-track player
  const waveBox = el('div', 'rf-wavebox');
  const canvas = el('canvas', 'rf-wave'); canvas.tabIndex = 0;
  canvas.setAttribute('role', 'slider'); canvas.setAttribute('aria-label', 'Position in your original track. Use left and right arrow keys to scrub.');
  canvas.setAttribute('aria-valuemin', '0'); canvas.setAttribute('aria-valuenow', '0');
  const playBtn = el('button', 'rf-btn rf-btn--ghost rf-btn--sm rf-orig__play', '▶ Play your track'); playBtn.type = 'button'; playBtn.disabled = true;
  const clock = el('span', 'rf-orig__time', '0:00 / 0:00');
  const hint = el('span', 'rf-orig__hint', 'Click the waveform to scrub. Stems light up below as each chunk finishes.');
  const wc = el('div', 'rf-wave__controls'); wc.append(playBtn, clock, hint);
  const audio = el('audio'); audio.preload = 'auto'; audio.hidden = true;
  waveBox.append(canvas, wc, audio);

  // --- stem lights
  const lights = el('div', 'rf-lights'); lights.setAttribute('role', 'group'); lights.setAttribute('aria-label', 'Stems. Press one to hear a quick preview of what is ready so far.');

  // --- tips
  const tipBox = el('div', 'rf-tip');
  const tipKicker = el('span', 'rf-tip__kicker', 'While you wait');
  const tipText = el('p', 'rf-tip__text'); const tipLink = el('a', 'rf-tip__link'); tipLink.hidden = true;
  const tipPrev = el('button', 'rf-btn rf-btn--link rf-tip__btn', '‹ Prev'); tipPrev.type = 'button';
  const tipNext = el('button', 'rf-btn rf-btn--link rf-tip__btn', 'Next tip ›'); tipNext.type = 'button';
  const tipCtl = el('div', 'rf-tip__ctl'); tipCtl.append(tipPrev, tipNext);
  tipBox.append(tipKicker, tipText, tipLink, tipCtl);

  // --- notify / chime / wake
  const opts = el('div', 'rf-opts');
  const mkCheck = (text, checked) => { const l = el('label', 'rf-check'); const i = el('input'); i.type = 'checkbox'; i.checked = !!checked; l.append(i, el('span', '', text)); return { l, i }; };
  const notify = mkCheck('Notify me when it is done', false);
  const chime = mkCheck('Play a chime when done', true);
  const optNote = el('span', 'rf-opts__note'); optNote.hidden = true;
  opts.append(notify.l, chime.l, optNote);
  if (typeof Notification === 'undefined') { notify.l.hidden = true; }

  root.append(steps, bar, label, detail, status, safe, waveBox, lights, tipBox, opts);

  // ----- state
  const S = {
    busy: false, needsDownload: true, stage: 'decode', frac: 0, overall: 0, done: false,
    duration: 0, peaks: null, stems: [], colors: [], lane: {}, prev: {}, prevRate: 22050,
    sweep: 0, chunkDone: 0, chunkTotal: 0, raf: 0, phase: 0, tip: -1, tipTimer: 0, tipPaused: false,
    lastAnnounced: -1, audioUrl: null, actx: null, src: null, srcStem: null, wake: null, drawQueued: false,
  };

  // ----- helpers
  function css(name, fallback) { return getComputedStyle(root).getPropertyValue(name).trim() || fallback; }
  function palette() {
    return [css('--rf-accent', '#22d3ee'), css('--rf-accent2', '#a855f7'), css('--rf-ok', '#22c55e'), css('--rf-warn', '#f97316'), css('--rf-bad', '#ec4899'), css('--rf-text', '#f3f4f6')];
  }
  function announce(text) { status.textContent = text; }

  function setStep(stage) {
    const order = STEPS.map((s) => s[0]);
    const idx = order.indexOf(stage);
    for (const [id] of STEPS) {
      const i = order.indexOf(id);
      let st = i < idx ? 'done' : i === idx ? 'active' : 'pending';
      if (id === 'download' && !S.needsDownload) st = i < idx || stage !== 'decode' ? 'done' : 'pending';
      if (stage === 'done') st = 'done';
      stepEls[id].dataset.state = st;
      if (st === 'active') stepEls[id].setAttribute('aria-current', 'step'); else stepEls[id].removeAttribute('aria-current');
    }
    stepEls.download.textContent = S.needsDownload ? 'Get model' : 'Model on device';
  }

  function setOverall(f) {
    S.overall = f;
    const pct = Math.round(f * 100);
    barFill.style.width = `${pct}%`;
    barPct.textContent = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', `${label.textContent || 'Working'} — ${pct}%`);
    if (S.busy) document.title = `${pct}% · ${shortStage()} — ${baseTitle}`;
    const bucket = Math.floor(pct / 25);
    if (bucket !== S.lastAnnounced) { S.lastAnnounced = bucket; announce(`${label.textContent}. ${pct}% overall.`); }
  }
  const shortStage = () => ({ decode: 'Reading', download: 'Downloading', load: 'Starting', separate: 'Separating', done: 'Done' }[S.stage]);

  // ----- drawing
  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.floor(canvas.clientWidth || waveBox.clientWidth || 600));
    const lanes = Math.max(1, S.stems.length);
    const h = 84 + 10 + lanes * 16;
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) { canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr); }
    return { w, h, dpr };
  }
  function draw() {
    S.drawQueued = false;
    if (root.hidden) return;
    const { w, h, dpr } = resizeCanvas();
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const muted = css('--rf-muted', '#9ca3af'), accent = css('--rf-accent', '#22d3ee'), accent2 = css('--rf-accent2', '#a855f7');
    const top = 84, mid = top / 2;
    const sweepX = S.sweep * w;
    // original waveform (dim; processed part gets an accent tint)
    if (S.peaks) {
      const n = S.peaks.length;
      for (let x = 0; x < w; x += 3) {
        const v = S.peaks[Math.min(n - 1, Math.floor((x / w) * n))];
        const hh = Math.max(1.5, v * (top - 8));
        c.fillStyle = x < sweepX ? accent : muted;
        c.globalAlpha = x < sweepX ? 0.75 : 0.35;
        c.fillRect(x, mid - hh / 2, 2, hh);
      }
    } else {
      c.globalAlpha = 0.25; c.fillStyle = muted; c.fillRect(0, mid - 0.5, w, 1);
    }
    c.globalAlpha = 1;
    // waiting sheen while the model downloads / starts (motion only if allowed)
    if (S.busy && !reduced() && S.stage !== 'separate') {
      const sx = ((S.phase * 0.18) % 1.4 - 0.2) * w;
      const g = c.createLinearGradient(sx - 60, 0, sx + 60, 0);
      g.addColorStop(0, 'transparent'); g.addColorStop(0.5, accent2); g.addColorStop(1, 'transparent');
      c.globalAlpha = 0.28; c.fillStyle = g; c.fillRect(sx - 60, 0, 120, top); c.globalAlpha = 1;
    }
    // sweep line follows real chunk progress
    if (S.stage === 'separate' || S.done) {
      const glow = S.busy && !reduced() ? 0.55 + 0.35 * Math.sin(S.phase * 5) : 0.8;
      c.strokeStyle = accent2; c.globalAlpha = glow; c.lineWidth = 2;
      c.beginPath(); c.moveTo(sweepX, 2); c.lineTo(sweepX, h - 2); c.stroke(); c.globalAlpha = 1;
    }
    // stem lanes
    S.stems.forEach((name, i) => {
      const y0 = top + 10 + i * 16, col = S.colors[i % S.colors.length];
      const peaks = S.lane[name];
      c.globalAlpha = 0.18; c.fillStyle = muted; c.fillRect(0, y0 + 7, w, 1);
      if (peaks) {
        c.fillStyle = col; c.globalAlpha = 0.9;
        const nb = peaks.arr.length;
        for (let x = 0; x < w; x += 3) {
          const b0 = Math.floor((x / w) * nb), b1 = Math.max(b0 + 1, Math.floor(((x + 3) / w) * nb));
          let m = 0, have = false;
          for (let b = b0; b < b1 && b < nb; b++) if (peaks.have[b]) { have = true; if (peaks.arr[b] > m) m = peaks.arr[b]; }
          if (!have) continue;
          const hh = Math.max(1.5, Math.min(1, m * 1.4) * 14);
          c.fillRect(x, y0 + 7 - hh / 2, 2, hh);
        }
      }
      c.globalAlpha = 1;
    });
    // playhead of the original audio
    if (S.duration > 0) {
      const px = (audio.currentTime / S.duration) * w;
      c.fillStyle = css('--rf-text', '#fff'); c.globalAlpha = audio.paused ? 0.55 : 1; c.fillRect(px - 1, 0, 2, top); c.globalAlpha = 1;
    }
  }
  function queueDraw() { if (!S.drawQueued) { S.drawQueued = true; requestAnimationFrame(draw); } }
  function loop(ts) {
    S.raf = 0;
    if (!S.busy && audio.paused) return;
    S.phase = ts / 1000;
    draw();
    updateClock();
    if (!reduced()) S.raf = requestAnimationFrame(loop);
  }
  function startLoop() { if (!S.raf && !reduced()) S.raf = requestAnimationFrame(loop); }
  function updateClock() {
    clock.textContent = `${fmtClock(audio.currentTime)} / ${fmtClock(S.duration)}`;
    canvas.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
    canvas.setAttribute('aria-valuemax', String(Math.round(S.duration)));
  }

  // ----- original audio
  function seekFromEvent(e) {
    if (!S.duration) return;
    const r = canvas.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * S.duration;
    updateClock(); queueDraw();
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture?.(e.pointerId); seekFromEvent(e); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('keydown', (e) => {
    if (!S.duration) return;
    const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
    if (d) { e.preventDefault(); audio.currentTime = Math.max(0, Math.min(S.duration, audio.currentTime + d)); updateClock(); queueDraw(); }
    else if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });
  playBtn.addEventListener('click', () => {
    if (!audio.src) return;
    if (audio.paused) { stopStem(); audio.play().catch(() => {}); } else audio.pause();
  });
  audio.addEventListener('play', () => { playBtn.textContent = '❚❚ Pause'; startLoop(); });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶ Play your track'; updateClock(); queueDraw(); });
  audio.addEventListener('ended', () => { playBtn.textContent = '▶ Play your track'; });
  audio.addEventListener('timeupdate', () => { updateClock(); if (reduced()) queueDraw(); });

  // ----- stem early previews
  function ensureCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!S.actx && Ctx) S.actx = new Ctx();
    S.actx?.resume?.().catch(() => {});
    return S.actx;
  }
  function stopStem() {
    try { S.src?.stop(); } catch { /* already stopped */ }
    S.src = null;
    if (S.srcStem) { const b = lightEls[S.srcStem]?.btn; if (b) { b.dataset.playing = 'false'; b.setAttribute('aria-pressed', 'false'); } }
    S.srcStem = null;
  }
  const lightEls = {};
  function playStem(name) {
    const p = S.prev[name];
    if (!p || p.len < S.prevRate) return; // need at least ~1 s
    const wasThis = S.srcStem === name;
    stopStem();
    if (wasThis) return;
    audio.pause();
    const ctx = ensureCtx();
    if (!ctx) return;
    const buf = ctx.createBuffer(1, p.len, S.prevRate);
    buf.copyToChannel(p.arr.subarray(0, p.len), 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    src.onended = () => { if (S.src === src) { stopStem(); } };
    src.start();
    S.src = src; S.srcStem = name;
    const b = lightEls[name].btn; b.dataset.playing = 'true'; b.setAttribute('aria-pressed', 'true');
  }

  function buildLights() {
    lights.textContent = '';
    for (const k of Object.keys(lightEls)) delete lightEls[k];
    S.stems.forEach((name, i) => {
      const b = el('button', 'rf-light'); b.type = 'button'; b.dataset.lit = 'false'; b.dataset.playing = 'false';
      b.setAttribute('aria-pressed', 'false'); b.disabled = true;
      b.style.setProperty('--rf-stem', S.colors[i % S.colors.length]);
      const dot = el('span', 'rf-light__dot'); const nm = el('span', 'rf-light__name', name); const st = el('span', 'rf-light__state', 'waiting…');
      b.append(dot, nm, st);
      b.addEventListener('click', () => playStem(name));
      lights.append(b); lightEls[name] = { btn: b, state: st };
    });
  }

  // ----- tips
  function showTip(i, user) {
    if (!tips.length) return;
    S.tip = (i + tips.length) % tips.length;
    const t = tips[S.tip];
    tipText.textContent = t.text;
    const link = t.link && tipLinks[t.link];
    tipLink.hidden = !link;
    if (link) { tipLink.href = link.href; tipLink.textContent = link.label || 'Read more'; }
    if (!user) tipBox.classList.remove('rf-tip--in'), void tipBox.offsetWidth, tipBox.classList.add('rf-tip--in');
  }
  function startTips() {
    stopTips();
    showTip(Math.floor(Math.random() * tips.length), false);
    if (!reduced()) S.tipTimer = setInterval(() => { if (!S.tipPaused && !document.hidden) showTip(S.tip + 1, false); }, tipRotateMs);
  }
  function stopTips() { clearInterval(S.tipTimer); S.tipTimer = 0; }
  tipNext.addEventListener('click', () => showTip(S.tip + 1, true));
  tipPrev.addEventListener('click', () => showTip(S.tip - 1, true));
  tipBox.addEventListener('mouseenter', () => { S.tipPaused = true; });
  tipBox.addEventListener('mouseleave', () => { S.tipPaused = false; });
  tipBox.addEventListener('focusin', () => { S.tipPaused = true; });
  tipBox.addEventListener('focusout', () => { S.tipPaused = false; });

  // ----- leave protection
  const onBeforeUnload = (e) => { if (S.busy) { e.preventDefault(); e.returnValue = ''; return ''; } return undefined; };
  const onVisible = () => { if (!document.hidden && !S.busy) document.title = baseTitle; };
  async function takeWake() { try { S.wake = await navigator.wakeLock?.request('screen'); } catch { S.wake = null; } }
  function dropWake() { try { S.wake?.release(); } catch { /* ignore */ } S.wake = null; }
  notify.i.addEventListener('change', async () => {
    optNote.hidden = true;
    if (!notify.i.checked) return;
    if (typeof Notification === 'undefined') { notify.i.checked = false; return; }
    let perm = Notification.permission;
    if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
    if (perm !== 'granted') { notify.i.checked = false; optNote.hidden = false; optNote.textContent = 'Notifications are blocked for this site. The tab title still shows progress.'; }
  });
  function playChime() {
    if (!chime.i.checked) return;
    const ctx = ensureCtx(); if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [[784, 0], [988, 0.14], [1319, 0.28]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.connect(g); g.connect(ctx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  }

  // ----- public API
  const api = {
    el: root,
    get busy() { return S.busy; },
    get state() { return S; },
    /** Call from the click handler that starts the run (so audio/notification permission rules are satisfied). */
    begin({ stems, needsDownload, file }) {
      stopStem(); audio.pause(); revokeAudio();
      Object.assign(S, { busy: true, done: false, needsDownload: !!needsDownload, stage: 'decode', frac: 0, sweep: 0, chunkDone: 0, chunkTotal: 0, stems: [...stems], peaks: null, duration: 0, lane: {}, prev: {}, lastAnnounced: -1 });
      S.colors = palette();
      buildLights();
      if (file) { S.audioUrl = URL.createObjectURL(file); audio.src = S.audioUrl; }
      playBtn.disabled = true; clock.textContent = '0:00 / 0:00';
      safe.hidden = false; tipBox.hidden = false; opts.hidden = false;
      root.hidden = false; root.dataset.state = 'busy';
      setStep('decode'); label.textContent = 'Reading your audio…'; detail.textContent = '';
      ensureCtx();
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('visibilitychange', onVisible);
      try { root.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch { /* ignore */ }
      takeWake(); startTips(); startLoop(); setOverall(0); queueDraw();
    },
    setTrack(peaks, duration) { S.peaks = peaks; S.duration = duration; playBtn.disabled = !audio.src; updateClock(); queueDraw(); },
    stage(stage, { frac = null, label: lab, detail: det } = {}) {
      if (S.stage !== stage) { S.stage = stage; setStep(stage); }
      S.frac = frac;
      if (lab != null) label.textContent = lab;
      if (det != null) detail.textContent = det;
      safe.hidden = !(stage === 'download');
      setOverall(overallFraction(stage, frac, S.needsDownload));
      if (!S.raf) queueDraw();
    },
    chunkProgress(done, total) {
      S.chunkDone = done; S.chunkTotal = total; S.sweep = total ? done / total : 0;
    },
    /** One flushed region from the worker (see TapSink). */
    stemChunk(m) {
      const name = m.stem;
      if (!S.stems.includes(name)) return;
      const nb = Math.ceil((S.duration * 44100) / PEAK_BLOCK) || m.peakStart + m.peaks.length;
      let lane = S.lane[name];
      if (!lane || lane.arr.length < m.peakStart + m.peaks.length) {
        const arr = new Float32Array(Math.max(nb, m.peakStart + m.peaks.length)), have = new Uint8Array(arr.length);
        if (lane) { arr.set(lane.arr); have.set(lane.have); }
        lane = S.lane[name] = { arr, have };
      }
      lane.arr.set(m.peaks, m.peakStart); lane.have.fill(1, m.peakStart, m.peakStart + m.peaks.length);
      if (m.preview) {
        S.prevRate = m.previewRate || 22050;
        let p = S.prev[name];
        if (!p) p = S.prev[name] = { arr: new Float32Array(Math.ceil(S.duration * S.prevRate) + S.prevRate), len: 0 };
        const end = Math.min(p.arr.length, m.previewStart + m.preview.length);
        p.arr.set(m.preview.subarray(0, end - m.previewStart), m.previewStart);
        p.len = Math.max(p.len, end);
      }
      const L = lightEls[name];
      if (L) {
        if (L.btn.dataset.lit !== 'true') { L.btn.dataset.lit = 'true'; announce(`${name} stem is starting to appear.`); }
        const p = S.prev[name];
        if (p && p.len >= S.prevRate) { L.btn.disabled = false; L.state.textContent = `hear first ${fmtClock(p.len / S.prevRate)}`; }
        else L.state.textContent = 'processing…';
        L.btn.classList.remove('rf-light--pulse'); void L.btn.offsetWidth; L.btn.classList.add('rf-light--pulse');
      }
      if (!S.raf) queueDraw();
    },
    /** WebGPU fell back to CPU: the worker starts over, so forget the partial stems. */
    restartSeparation() {
      S.lane = {}; S.prev = {}; S.sweep = 0; stopStem();
      for (const L of Object.values(lightEls)) { L.btn.dataset.lit = 'false'; L.btn.disabled = true; L.state.textContent = 'waiting…'; }
      queueDraw();
    },
    finish({ message } = {}) {
      S.busy = false; S.done = true; S.stage = 'done'; S.sweep = 1;
      setStep('done'); label.textContent = message || 'Done — your stems are ready.'; detail.textContent = '';
      setOverall(1);
      for (const L of Object.values(lightEls)) { L.btn.dataset.lit = 'true'; if (S.prev[L.btn.querySelector('.rf-light__name').textContent]) L.btn.disabled = false; L.state.textContent = L.btn.disabled ? 'ready' : 'quick preview'; }
      root.dataset.state = 'done';
      tipBox.hidden = true; safe.hidden = true; opts.hidden = true; stopTips();
      cleanupBusy();
      document.title = `✅ Stems ready — ${baseTitle}`;
      announce('Done. Your stems are ready to play and download.');
      if (notify.i.checked && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try { new Notification('Your stems are ready', { body: 'Open the tab to play or download them.', tag: 'rf-done' }); } catch { /* some mobile browsers require a service worker */ }
      }
      playChime();
      queueDraw();
    },
    /** Cancelled or failed. */
    stop({ hide = true } = {}) {
      S.busy = false; stopStem(); cleanupBusy(); stopTips();
      document.title = baseTitle; root.hidden = hide; root.dataset.state = 'idle';
    },
    destroy() { api.stop(); revokeAudio(); },
  };
  function cleanupBusy() {
    window.removeEventListener('beforeunload', onBeforeUnload);
    dropWake();
  }
  function revokeAudio() { if (S.audioUrl) { URL.revokeObjectURL(S.audioUrl); S.audioUrl = null; } audio.removeAttribute('src'); audio.load?.(); }
  window.addEventListener('resize', () => { if (!root.hidden) queueDraw(); });
  return api;
}
