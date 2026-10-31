/**
 * AudioWorklet that runs one Stem Studio effects chain.
 *   new AudioWorkletNode(ctx, 'studio-chain', { numberOfInputs:1, numberOfOutputs:1,
 *       outputChannelCount:[2], processorOptions: { chain, comp, bypass } })
 * Messages: {type:'config', chain}, {type:'comp', samples}, {type:'bypass', value}, {type:'reset'}.
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
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'config') this.chain.setConfig(m.chain);
      else if (m.type === 'comp') this.chain.setComp(m.samples);
      else if (m.type === 'bypass') this.chain.setBypass(!!m.value);
      else if (m.type === 'reset') this.chain.reset();
    };
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
    out[0].set(l.subarray(0, n)); if (out[1]) out[1].set(r.subarray(0, n));
    return true;
  }
}
registerProcessor('studio-chain', StudioChain);
