"""Export the HT-RoFormer drum separator core to ONNX (host-side STFT/iSTFT).
inputs : audio [1,2,L]  (L=266240), spec [1,2,1025,261,2] torch.stft(center=True, hann periodic, n_fft 2048, hop 1024)
outputs: mask [1,6,2050,261,2] (complex mask, bins packed f*2+ch... see layout), residual [1,6,2,L]
"""
import sys, torch, torch.nn.functional as F
sys.path.insert(0, sys.argv[1])  # path to infer/
from bs_roformer.ht_roformer import HybridTransformerRoFormer

class _GLU(torch.nn.Module):
    def __init__(self, dim): super().__init__(); self.dim = dim
    def forward(self, x):
        a, b = x.chunk(2, dim=self.dim); return a * torch.sigmoid(b)

import bs_roformer.bs_roformer as _bsr

def _rot_forward(self, t):
    seq_len = t.shape[-2]
    positions = torch.arange(seq_len, device=t.device, dtype=self.freqs.dtype)
    freqs = positions[:, None] * self.freqs[None]
    return torch.stack((freqs, freqs), dim=-1).flatten(-2)   # == repeat_interleave(2, -1), exports cleanly

_bsr.RotaryEmbedding.forward = _rot_forward

def patch_glu(mod):
    for name, ch in mod.named_children():
        if isinstance(ch, torch.nn.GLU): setattr(mod, name, _GLU(ch.dim))
        else: patch_glu(ch)

class Core(torch.nn.Module):
    def __init__(self, m):
        super().__init__(); self.m = m
    def forward(self, audio, spec):
        m = self.m
        batch, channels, length = audio.shape
        mean = audio.mean(dim=(1, 2), keepdim=True)
        std = audio.var(dim=(1, 2), unbiased=False, keepdim=True).sqrt()
        normalized = (audio - mean) / (std + m.standardize_eps)
        # spec: (b, ch, bins, frames, 2) -> feats (b, t, f*s*2)
        n_bins, frames = spec.shape[2], spec.shape[3]
        feats = spec.permute(0, 3, 2, 1, 4).reshape(batch, frames, n_bins * channels * 2)
        hidden = m.time_input_conv(normalized)
        skips = [hidden]
        for stage in m.time_encoder:
            hidden = stage(hidden); skips.append(hidden)
        hidden = hidden.transpose(1, 2)
        x = m.band_split(feats)
        bi = 0
        for index, (tt, ft) in enumerate(m.layers):
            b, t, f, d = x.shape
            x = x.permute(0, 2, 1, 3).reshape(b * f, t, d); x = tt(x)
            x = x.reshape(b, f, t, d).permute(0, 2, 1, 3)
            x = x.reshape(b * t, f, d); x = ft(x); x = x.reshape(b, t, f, d)
            if index in m.bridge_layers:
                hidden, x = m.cross_bridges[bi](hidden, x); bi += 1
        x = m.final_norm(x)
        mask = torch.stack([fn(x) for fn in m.mask_estimators], dim=1)
        # (b, n, t, f*s*2) -> (b, n, f*s, t, 2): packed bin index = f*channels + ch
        mask = mask.reshape(batch, m.num_stems, frames, n_bins * channels, 2).permute(0, 1, 3, 2, 4)
        hidden = hidden.transpose(1, 2)
        for stage, skip in zip(m.time_decoder, (skips[2], skips[1], skips[0])):
            hidden = stage(hidden, skip)
        residual = m.time_output_conv(hidden).view(batch, m.num_stems, m.audio_channels, length)
        residual = residual * std.view(-1, 1, 1, 1) + mean.view(-1, 1, 1, 1)
        return mask, residual

if __name__ == '__main__':
    infer, ckpt, out = sys.argv[1:4]
    m = HybridTransformerRoFormer(); m.load_state_dict(torch.load(ckpt, map_location='cpu', weights_only=True)); m.eval()
    patch_glu(m)
    core = Core(m).eval()
    L = 266240
    audio = torch.randn(1, 2, L) * 0.1
    win = torch.hann_window(2048)
    spec = torch.view_as_real(torch.stft(audio.reshape(2, L), n_fft=2048, hop_length=1024, win_length=2048, window=win, return_complex=True)).unsqueeze(0)
    with torch.no_grad():
        torch.onnx.export(core, (audio, spec), out, input_names=['audio', 'spec'], output_names=['mask', 'residual'], opset_version=17, do_constant_folding=True)
        # parity vs full model
        ref = m(audio)
        mask, res = core(audio, spec)
        sc = torch.view_as_complex(spec.permute(0, 2, 1, 3, 4).reshape(1, 1, 2050, 261, 2).contiguous())
        masked = sc * torch.view_as_complex(mask.contiguous())
        sp = torch.view_as_real(masked).view(1, 6, 1025, 2, 261, 2).permute(0, 1, 3, 2, 4, 5).reshape(12, 1025, 261, 2)
        y = torch.istft(torch.view_as_complex(sp.contiguous()), n_fft=2048, hop_length=1024, win_length=2048, window=win, length=L).view(1, 6, 2, L) + res
        err = (y - ref).pow(2).mean().sqrt() / ref.pow(2).mean().sqrt()
        print('torch core vs full model rel err', float(err))
