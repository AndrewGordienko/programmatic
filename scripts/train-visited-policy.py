"""Learn production ranks from witness-compatible actual search states.
No missing-witness state is labeled impossible. Never consumes final outcomes.
"""
import copy, gzip, json, math, time
from pathlib import Path
import numpy as np
import torch
folder=Path('output/joint/neural-visited-v1')
out=Path('output/joint/neural-visited-policy-v1')
if (out/'policy.json').exists(): raise FileExistsError('Preserve trained policy')
out.mkdir(parents=True,exist_ok=True)
data=json.load(gzip.open(folder/'data.json.gz','rt'))
rows=data['decisions']
x=torch.from_numpy(np.frombuffer(gzip.open(folder/data['featureFile'],'rb').read(),dtype='<f4').copy().reshape(data['featureShape']))
s=torch.tensor(data['semantics'],dtype=torch.float32)
legal=torch.tensor([r['legal'] for r in rows],dtype=torch.bool)
positive=torch.tensor([r['positive'] for r in rows],dtype=torch.bool)&legal
train=torch.tensor([i for i,r in enumerate(rows) if r['split']=='training' and positive[i].any()])
valid=torch.tensor([i for i,r in enumerate(rows) if r['split']=='validation' and positive[i].any()])
counts={}
for i in train.tolist(): counts[rows[i]['program']]=counts.get(rows[i]['program'],0)+1
weights=torch.tensor([1/counts[rows[i]['program']] for i in train.tolist()],dtype=torch.float32)
seed=622713;width=64
torch.manual_seed(seed);torch.set_num_threads(2);torch.use_deterministic_algorithms(True)
wc=torch.nn.Parameter(torch.randn(width,x.shape[1])*.1)
wo=torch.nn.Parameter(torch.randn(width,s.shape[1])*.1)
bias=torch.nn.Parameter(torch.zeros(s.shape[1]));params=[wc,wo,bias]
opt=torch.optim.AdamW(params,lr=.003,weight_decay=.0001)
def forward(batch): return torch.tanh(batch@wc.T)@torch.tanh(s@wo.T).T/math.sqrt(width)+s@bias
def loss(logits,ids):
    logp=torch.log_softmax(logits.masked_fill(~legal[ids],-1e9),dim=-1)
    return -torch.logsumexp(logp.masked_fill(~positive[ids],-1e9),dim=-1).mean()
started=time.perf_counter();history=[];best=None;best_loss=float('inf');updates=0
for epoch in range(101):
    if epoch:
        for _ in range(max(1,len(train)//256)):
            ids=train[torch.multinomial(weights,256,replacement=True)]
            objective=loss(forward(x[ids]),ids)
            opt.zero_grad();objective.backward();torch.nn.utils.clip_grad_norm_(params,2);opt.step();updates+=len(ids)
    with torch.no_grad():
        logits=forward(x[valid]).masked_fill(~legal[valid],-1e9)
        vl=loss(logits,valid).item()
        acc=positive[valid].gather(1,logits.argmax(-1)[:,None]).float().mean().item()
    history.append(dict(epoch=epoch,validationLoss=vl,validationWitnessAccuracy=acc))
    if vl<best_loss: best_loss=vl;best=copy.deepcopy([p.detach().tolist() for p in params])
    if epoch%20==0: print(history[-1],flush=True)
model=dict(version='joint-semantic-v1',contextKind=data['contextKind'],contextWeights=best[0],operatorWeights=best[1],bias=best[2],decisions=updates,loss=best_loss)
(out/'policy.json').write_text(json.dumps(model))
(out/'training.json').write_text(json.dumps(dict(seed=seed,width=width,trainingStates=len(train),validationStates=len(valid),totalVisitedStates=len(rows),updates=updates,elapsedMs=(time.perf_counter()-started)*1000,history=history,source='neural-visited-v1',note='Known-witness operator probability mass objective, with per-program sampling weights. Unwitnessed states omitted, not declared impossible. Root/subtree exposures and original data-generation/search costs remain those of neural-visited-v1. No hidden final labels.'),indent=2))
a=torch.tensor(model['contextWeights'],dtype=torch.float64);b=torch.tensor(model['operatorWeights'],dtype=torch.float64);bb=torch.tensor(model['bias'],dtype=torch.float64);ss=torch.tensor(data['semantics'],dtype=torch.float64)
fixtures=[]
for i in valid[:12]:
    xx=x[i].double();logits=torch.tanh(a@xx)@torch.tanh(ss@b.T).T/math.sqrt(width)+ss@bb
    logits=logits.masked_fill(~legal[i],float('-inf'))
    probs=.95*torch.softmax(logits,0)+.05*legal[i].double()/legal[i].sum()
    fixtures.append(dict(x=xx.tolist(),legal=legal[i].tolist(),probabilities=probs[legal[i]].tolist()))
(out/'parity.json').write_text(json.dumps(dict(semantics=data['semantics'],fixtures=fixtures)))
