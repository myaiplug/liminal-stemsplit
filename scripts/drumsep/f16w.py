import onnx, numpy as np, sys
from onnx import numpy_helper, TensorProto, helper
src,dst=sys.argv[1],sys.argv[2]
m=onnx.load(src); g=m.graph; new=[]; casts=[]; ren={}
keep=[]
for i in g.initializer:
    a=numpy_helper.to_array(i)
    if a.dtype==np.float32 and a.size>=4096:
        h=numpy_helper.from_array(a.astype(np.float16),i.name+'_f16'); new.append(h)
        casts.append(helper.make_node('Cast',[i.name+'_f16'],[i.name],to=TensorProto.FLOAT,name='cast_'+i.name))
    else: keep.append(i)
del g.initializer[:]; g.initializer.extend(keep+new)
nodes=list(g.node); del g.node[:]; g.node.extend(casts+nodes)
onnx.save(m,dst)
