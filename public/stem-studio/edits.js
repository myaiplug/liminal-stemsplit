/**
 * Non-destructive editing of a stem's source audio: trim (in/out), snip (delete a region and close
 * the gap) and silence (mute a region). Pure functions on planar Float32 arrays; sample-exact.
 *
 *   edits = { trim: {start, end} | null, ops: [{ type:'cut'|'silence', start, end }] }   (seconds, on the ORIGINAL timeline)
 *
 * Order: cuts/silences are resolved on the original timeline, then the trim window is applied to the
 * result's timeline. A 3 ms linear fade is applied on each side of a cut or silence to avoid clicks
 * (it eats into the audio next to the edit, never into the length).
 */
export const EDIT_FADE_SEC = 0.003;

export function normalizeEdits(edits, durationSec) {
  const e = edits || {};
  const ops = (e.ops || []).map((o) => ({ type: o.type === 'cut' ? 'cut' : 'silence', start: Math.max(0, Math.min(durationSec, +o.start || 0)), end: Math.max(0, Math.min(durationSec, +o.end || 0)) }))
    .filter((o) => o.end - o.start > 1e-4).sort((a, b) => a.start - b.start);
  let trim = null;
  if (e.trim && (e.trim.start > 0 || (e.trim.end != null && e.trim.end < durationSec))) {
    const s = Math.max(0, +e.trim.start || 0), t = Math.min(durationSec, e.trim.end == null ? durationSec : +e.trim.end);
    if (t - s > 1e-4) trim = { start: s, end: t };
  }
  return { trim, ops };
}

export const hasEdits = (edits, durationSec) => { const n = normalizeEdits(edits, durationSec); return !!(n.trim || n.ops.length); };

/** Frames of the edited output for a source of `frames` at `sr`. */
export function editedLength(frames, sr, edits) {
  return applyPlan(frames, sr, edits).outFrames;
}

/** segment plan: list of {from, to, silent} on the source timeline in output order */
function applyPlan(frames, sr, edits) {
  const dur = frames / sr, { trim, ops } = normalizeEdits(edits, dur);
  const T0 = trim ? Math.round(trim.start * sr) : 0, T1 = trim ? Math.min(frames, Math.round(trim.end * sr)) : frames;
  // build kept segments on the source timeline, skipping cuts, marking silences
  const bounds = [];
  for (const o of ops) bounds.push({ type: o.type, a: Math.round(o.start * sr), b: Math.round(o.end * sr) });
  const segs = []; let pos = 0;
  for (const o of bounds) {
    if (o.a > pos) segs.push({ from: pos, to: Math.min(o.a, frames), silent: false });
    if (o.type === 'silence') segs.push({ from: Math.max(pos, o.a), to: o.b, silent: true });
    pos = Math.max(pos, o.b);
  }
  if (pos < frames) segs.push({ from: pos, to: frames, silent: false });
  // sequence positions of each seg in the "post-cut" timeline, then clip by trim (trim is on original timeline)
  const out = [];
  for (const s of segs) {
    const from = Math.max(s.from, T0), to = Math.min(s.to, T1);
    if (to > from) out.push({ ...s, from, to });
  }
  return { segs: out, outFrames: out.reduce((a, s) => a + (s.to - s.from), 0) };
}

/** Apply edits; returns new planar arrays (or the inputs untouched when there is nothing to do). */
export function applyEdits(channels, sr, edits) {
  const frames = channels[0].length;
  if (!hasEdits(edits, frames / sr)) return channels;
  const { segs, outFrames } = applyPlan(frames, sr, edits);
  const fade = Math.max(1, Math.round(EDIT_FADE_SEC * sr));
  const out = channels.map(() => new Float32Array(outFrames));
  let o = 0;
  const origEnd = frames;
  segs.forEach((s, si) => {
    const len = s.to - s.from;
    if (!s.silent) {
      channels.forEach((ch, c) => out[c].set(ch.subarray(s.from, s.to), o));
      // fade at joins created by edits (not at the file's own start/end or at the trim edges)
      const joinStart = si > 0 && segs[si - 1].to !== s.from ? true : (si > 0 && segs[si - 1].silent);
      const joinEnd = si < segs.length - 1 && (segs[si + 1].from !== s.to || segs[si + 1].silent);
      const f = Math.min(fade, len >> 1);
      for (let c = 0; c < out.length; c++) {
        const d = out[c];
        for (let i = 0; i < f; i++) {
          const g = i / f;
          if (joinStart) d[o + i] *= g;
          if (joinEnd) d[o + len - 1 - i] *= g;
        }
      }
    }
    o += len;
  });
  void origEnd;
  return out;
}

/** map a time on the original timeline to the edited timeline (null when it lies in a cut / outside the trim) */
export function mapTime(t, sr, frames, edits) {
  const { segs } = applyPlan(frames, sr, edits); const f = t * sr; let o = 0;
  for (const s of segs) { if (f >= s.from && f < s.to) return (o + (f - s.from)) / sr; o += s.to - s.from; }
  return null;
}

/** inverse of mapTime: a time on the edited timeline -> time on the original timeline */
export function unmapTime(tEdited, sr, frames, edits) {
  const { segs } = applyPlan(frames, sr, edits); let f = tEdited * sr;
  for (const s of segs) { const len = s.to - s.from; if (f < len) return (s.from + f) / sr; f -= len; }
  return segs.length ? segs[segs.length - 1].to / sr : 0;
}
