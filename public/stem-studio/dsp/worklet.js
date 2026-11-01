/**
 * AudioWorklet that runs one Stem Studio effects chain.
 *   new AudioWorkletNode(ctx, 'studio-chain', { numberOfInputs:1, numberOfOutputs:1,
 *       outputChannelCount:[2], processorOptions: { chain, comp, bypass } })
 * processorOptions also take { gain (linear), pan (-1..1 balance law) } which are applied after the chain, so
 * preview and the OfflineAudioContext export are bit-identical in level handling.
 * Messages: {type:'config', chain}, {type:'comp', samples}, {type:'bypass', value}, {type:'out', gain, pan}, {type:'reset'}.
 * Options are applied in the constructor so OfflineAudioContext renders are deterministic.
 */
import { Chain } from './chain.js';

class StudioChain extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {};
    this.chain = new Chain(sampleRate, o.chain || [], { comp: o.comp || 0 });
    if (o.bypass) { this.chain.setBypass(true); this.chain.bypassMix = 1; }
    this.buf = [new Float32Array(128), new Float32Array(128)];
    this.setOut(o.gain == null ? 1 : o.gain, o.pan || 0, true);
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'config') this.chain.setConfig(m.chain);
      else if (m.type === 'comp') this.chain.setComp(m.samples);
      else if (m.type === 'bypass') this.chain.setBypass(!!m.value);
      else if (m.type === 'out') this.setOut(m.gain, m.pan);
      else if (m.type === 'reset') this.chain.reset();
    };
  }
  setOut(gain, pan, now) {
    const p = Math.max(-1, Math.min(1, pan || 0));
    this.tgL = (gain == null ? 1 : gain) * (p > 0 ? Math.cos((p * Math.PI) / 2) : 1);
    this.tgR = (gain == null ? 1 : gain) * (p < 0 ? Math.cos((-p * Math.PI) / 2) : 1);
    if (now || this.gL === undefined) { this.gL = this.tgL; this.gR = this.tgR; }
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length;
    const L = this.buf[0], R = this.buf[1];
    if (L.length < n) { this.buf = [new Float32Array(n), new Float32Array(n)]; }
    const l = this.buf[0], r = this.buf[1];
    const a = inp && inp[0], b = inp && (inp[1] || inp[0]);
    if (a) { l.set(a.subarray(0, n)); r.set(b.subarray(0, n)); } else { l.fill(0, 0, n); r.fill(0, 0, n); }
    this.chain.process(l, r, n);
    // ~5 ms one-pole smoothing of gain/pan: no zipper noise while dragging, exact once settled
    const k = 1 - Math.exp(-1 / (0.005 * sampleRate));
    let gl = this.gL, gr = this.gR;
    const o0 = out[0], o1 = out[1];
    for (let i = 0; i < n; i++) {
      gl += (this.tgL - gl) * k; gr += (this.tgR - gr) * k;
      o0[i] = l[i] * gl; if (o1) o1[i] = r[i] * gr;
    }
    this.gL = gl; this.gR = gr;
    return true;
  }
}
registerProcessor('studio-chain', StudioChain);
