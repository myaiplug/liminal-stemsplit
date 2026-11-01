import inspect, textwrap, torch, onnx, collections, numpy as np, re
from onnx import numpy_helper
import demucs.hdemucs as h

import demucs.demucs as _dm
_ls=textwrap.dedent(inspect.getsource(_dm.LocalState.forward)).replace("torch.eye(T, device=dots.device, dtype=torch.bool)","(delta == 0)")
_ns={}; exec("import torch, math\n"+_ls,_ns); _dm.LocalState.forward=_ns['forward']
CFG=dict(sources=["kick","snare","cymbals","toms"],channels=48,growth=2,nfft=4096,depth=6,rewrite=True,freq_emb=0.2,emb_scale=10,kernel_size=8,time_stride=2,stride=4,context=1,context_enc=0,norm_starts=4,norm_groups=4,dconv_mode=1,dconv_depth=2,dconv_comp=4,dconv_attn=4,dconv_lstm=4,dconv_init=0.001)
src=textwrap.dedent(inspect.getsource(h.HDemucs.forward))
head,tail=src.split("    # to cpu as mps")
head=head.replace("def forward(self, mix):","def _fwd(self, mix, mag):").replace("    z = self._spec(mix)\n    mag = self._magnitude(z).to(mix.device)\n","")
code=head+"    xt = xt.view(B, S, -1, length)\n    xt = xt * stdt[:, None] + meant[:, None]\n    return x, xt\n"
ns={}
exec("import torch\nimport math\nimport torch.nn.functional as F\n"+code,ns)
class Wrap(h.HDemucs): pass
Wrap.forward=ns['_fwd']
def build():
    return Wrap(**CFG).eval()
def extract(m, onnx_path):
    o=onnx.load(onnx_path); ini={i.name:numpy_helper.to_array(i) for i in o.graph.initializer}
    sd={}
    for k,v in ini.items():
        if k.startswith('model.'): sd[k[6:]]=torch.from_numpy(v.copy())
    mods=dict(m.named_modules())
    def modpath(node):
        segs=node.name.strip('/').split('/')[:-1]
        out=[]
        for i,s in enumerate(segs):
            if i+1<len(segs) and segs[i+1].startswith(s+'.'): continue
            out.append(s)
        return '.'.join(out)
    sd['freq_emb.embedding.weight']=torch.from_numpy(ini['onnx::Expand_5011'][0,:,:,0].T.copy())/m.freq_emb.scale
    for n in o.graph.node:
        if n.op_type in('Mul','Add'):
            for x in n.input:
                if x.startswith('onnx::') and x in ini:
                    p=modpath(n); mod=mods.get(p)
                    if mod is None: continue
                    t=type(mod).__name__; a=torch.from_numpy(ini[x].copy())
                    if t=='GroupNorm': sd[p+('.weight' if n.op_type=='Mul' else '.bias')]=a.reshape(mod.weight.shape)
                    elif t=='LayerScale': sd[p+'.scale']=a.reshape(mod.scale.shape)
        if n.op_type=='MatMul':
            for x in n.input:
                if x.startswith('onnx::') and x in ini:
                    p=modpath(n); 
                    if p in mods and type(mods[p]).__name__=='Linear': sd[p+'.weight']=torch.from_numpy(ini[x].copy()).t().contiguous()
        if n.op_type=='LSTM':
            p=modpath(n); layer=0 if n.name.endswith('/LSTM') else int(n.name.rsplit('LSTM_',1)[1])
            W,R,B=[ini[n.input[i]] for i in (1,2,3)]
            def reorder(a): # iofc -> ifgo
                i,o_,f,c=np.split(a,4,axis=0); return np.concatenate([i,f,c,o_],0)
            for d,suf in enumerate(['','_reverse']):
                H=R.shape[-1]
                sd[f'{p}.weight_ih_l{layer}{suf}']=torch.from_numpy(reorder(W[d]).copy())
                sd[f'{p}.weight_hh_l{layer}{suf}']=torch.from_numpy(reorder(R[d]).copy())
                sd[f'{p}.bias_ih_l{layer}{suf}']=torch.from_numpy(reorder(B[d][:4*H]).copy())
                sd[f'{p}.bias_hh_l{layer}{suf}']=torch.from_numpy(reorder(B[d][4*H:]).copy())
    return sd
if __name__=='__main__':
    m=build(); sd=extract(m,'/workspace/drumsep/drumsep_v2.onnx')
    r=m.load_state_dict(sd,strict=False); print('missing',r.missing_keys,'unexpected',r.unexpected_keys)
    torch.save(m.state_dict(),'drumsep_v2_hdemucs.pt')
