import torch, numpy as np, sys, math
from hd_build import build
W=int(sys.argv[1]); out=sys.argv[2]
m=build(); m.load_state_dict(torch.load('drumsep_v2_hdemucs.pt')); m.eval()
fr=math.ceil(W/1024)
mix=torch.randn(1,2,W)*0.1; mag=torch.randn(1,4,2048,fr)
with torch.no_grad(): ref=m(mix,mag)
torch.onnx.export(m,(mix,mag),out,input_names=['mix','mag'],output_names=['freq_out','time_out'],opset_version=14,dynamo=False,do_constant_folding=True)
import onnxruntime as ort
s=ort.InferenceSession(out,providers=['CPUExecutionProvider'])
a,b=s.run(None,{'mix':mix.numpy(),'mag':mag.numpy()})
sn=lambda x,y:10*np.log10((y**2).sum()/(((x-y)**2).sum()+1e-20))
print(W,fr,'onnx vs torch snr',sn(a,ref[0].numpy()),sn(b,ref[1].numpy()))
