import torch, numpy as np, sys
from hd_build import build
m=build(); m.load_state_dict(torch.load('drumsep_v2_hdemucs.pt')); m.eval()
mix=torch.from_numpy(np.load('mix.npy')); mag=torch.from_numpy(np.load('mag.npy'))
with torch.no_grad(): fo,to=m(mix,mag)
import onnxruntime as ort
sess=ort.InferenceSession('/workspace/drumsep/drumsep_v2.onnx',providers=['CPUExecutionProvider'])
ofo,oto=sess.run(None,{'mix':mix.numpy(),'mag':mag.numpy()})
def snr(a,b): return 10*np.log10((b**2).sum()/(((a-b)**2).sum()+1e-20))
print('freq_out snr dB',snr(fo.numpy(),ofo),'time_out',snr(to.numpy(),oto))
