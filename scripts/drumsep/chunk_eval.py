import numpy as np, torch, soundfile as sf, onnxruntime as ort, sys, time
from ref_pipeline import spec, ispec
W=int(sys.argv[2]); model=sys.argv[1]; hop=W//2
x,sr=sf.read('clip40.wav',dtype='float32',always_2d=True); x=torch.from_numpy(x.T.copy())[:,:1764000]; N=x.shape[1]
ref=np.load('ref_out.npy')
sess=ort.InferenceSession(model,providers=['CPUExecutionProvider'])
S=4; out=np.zeros((S,2,N),np.float32); wsum=np.zeros(N,np.float32)
win=np.hanning(W+2)[1:-1].astype(np.float32)
t=time.time()
starts=list(range(0,max(N-W,0)+hop,hop)); 
for s0 in starts:
    seg=x[:,s0:s0+W]; L=seg.shape[1]
    if L<W: seg=torch.nn.functional.pad(seg,(0,W-L))
    z=spec(seg); m=torch.view_as_real(z).permute(0,3,1,2).reshape(1,4,z.shape[-2],z.shape[-1])
    fo,to=sess.run(None,{'mix':seg[None].numpy(),'mag':m.numpy()})
    for k in range(S):
        f=torch.from_numpy(fo[0,k]).reshape(2,2,fo.shape[3],fo.shape[4]).permute(0,2,3,1).contiguous()
        y=(ispec(torch.view_as_complex(f),W)+torch.from_numpy(to[0,k])).numpy()
        n=min(W,N-s0); out[k,:,s0:s0+n]+=y[:,:n]*win[:n]
    n=min(W,N-s0); wsum[s0:s0+n]+=win[:n]
out/=np.maximum(wsum,1e-6)
print('time',time.time()-t,'windows',len(starts))
names=['kick','snare','cymbals','toms']
for k in range(S):
    e=((out[k]-ref[k])**2).sum(); print(names[k],'snr vs 40s ref %.1f dB'%(10*np.log10((ref[k]**2).sum()/e)),'rms',float(np.sqrt((out[k]**2).mean())),float(np.sqrt((ref[k]**2).mean())))
print('sum vs mix snr %.1f dB'%(10*np.log10((x.numpy()**2).sum()/((out.sum(0)-x.numpy())**2).sum())))
np.save('chunk_out_%d.npy'%W,out)
