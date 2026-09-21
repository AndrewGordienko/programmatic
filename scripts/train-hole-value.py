"""Weak witness supervision on states actually visited by synthesis."""
import gzip,json,time,copy
from pathlib import Path
import numpy as np
import torch
folder=Path('output/joint/neural-visited-v1')
if (folder/'model.json').exists(): raise FileExistsError('Preserve trained critic')
data=json.load(gzip.open(folder/'data.json.gz','rt'));rows=data['decisions']
raw=np.frombuffer(gzip.open(folder/data['featureFile'],'rb').read(),dtype='<f4').reshape(data['featureShape']).astype(np.float64)
train=np.array([i for i,r in enumerate(rows) if r['split']=='training'])
valid=np.array([i for i,r in enumerate(rows) if r['split']=='validation'])
mean=raw[train].mean(0);scale=np.maximum(raw[train].std(0),.01)
x=torch.tensor((raw-mean)/scale,dtype=torch.float32)
y=torch.tensor([r['witness'] for r in rows],dtype=torch.float32)
torch.manual_seed(192017);np.random.seed(192017);torch.set_num_threads(2)
model=torch.nn.Sequential(torch.nn.Linear(x.shape[1],64),torch.nn.ReLU(),torch.nn.Linear(64,1))
opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.002)
started=time.perf_counter();best=None;history=[]
# Equal program weighting prevents long failed searches from dominating.
counts={}
for i in train: counts[rows[i]['program']]=counts.get(rows[i]['program'],0)+1
weights=torch.tensor([1/max(1,counts.get(r['program'],1)) for r in rows],dtype=torch.float32)
for epoch in range(81):
    for ids in np.array_split(np.random.permutation(train),max(1,int(np.ceil(len(train)/512)))):
        logits=model(x[ids]).squeeze(-1)
        loss=(torch.nn.functional.binary_cross_entropy_with_logits(logits,y[ids],reduction='none')*weights[ids]).sum()/weights[ids].sum()
        opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),5);opt.step()
    if epoch%5==0:
        with torch.no_grad():
            logits=model(x[valid]).squeeze(-1)
            val=torch.nn.functional.binary_cross_entropy_with_logits(logits,y[valid]).item()
            accuracy=((logits>0)==(y[valid]>0)).float().mean().item()
        history.append(dict(epoch=epoch,validationLoss=val,validationAccuracy=accuracy))
        if best is None or val<best[0]:best=val,epoch,copy.deepcopy(model.state_dict())
        if epoch%20==0: print(history[-1],flush=True)
model.load_state_dict(best[2])
out=dict(version='visited-hole-value-v1',mean=mean.tolist(),scale=scale.tolist(),w1=model[0].weight.tolist(),b1=model[0].bias.tolist(),w2=model[2].weight[0].tolist(),b2=model[2].bias[0].item())
(folder/'model.json').write_text(json.dumps(out))
fixtures=[]
for i in valid[:12]:
    xx=torch.tensor((raw[i]-mean)/scale,dtype=torch.float64)
    z=torch.relu(torch.tensor(out['w1'],dtype=torch.float64)@xx+torch.tensor(out['b1'],dtype=torch.float64))
    value=torch.sigmoid(z@torch.tensor(out['w2'],dtype=torch.float64)+out['b2']).item()
    fixtures.append(dict(features=raw[i].tolist(),value=value))
(folder/'parity.json').write_text(json.dumps(fixtures))
(folder/'training.json').write_text(json.dumps(dict(seed=192017,threads=2,trainingRows=len(train),validationRows=len(valid),selectedEpoch=best[1],validationLoss=best[0],elapsedMs=(time.perf_counter()-started)*1000,history=history,note='Negative labels mean no known teacher-subtree witness, not impossibility. This model may only rank branches, never prune them as unsatisfiable. Programs group train/validation; individual programs receive equal total training weight.'),indent=2))
