"""Train on executed dreams and solved programs; export the semantic scorer."""
import copy
import gzip
import json
import math
from pathlib import Path
import time
import torch
import argparse
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, default=64)
parser.add_argument('--folder', default='output/joint/neural')
parser.add_argument('--seed', type=int, default=7721)
options = parser.parse_args()
if options.width < 1:
    raise ValueError('Positive width required')

torch.manual_seed(options.seed)
torch.set_num_threads(2)
torch.use_deterministic_algorithms(True)
folder = Path(options.folder)
with gzip.open(folder / 'data.json.gz', 'rt') as source:
    data = json.load(source)
rows = data['decisions']
x = torch.from_numpy(np.frombuffer(gzip.open(folder / data['featureFile'], 'rb').read(), dtype='<f4').copy().reshape(data['featureShape']))
y = torch.tensor([r['y'] for r in rows], dtype=torch.long)
s = torch.tensor(data['semantics'], dtype=torch.float32)
legal = torch.tensor([r.get('legal', [True] * len(data['semantics'])) for r in rows], dtype=torch.bool)
train = torch.tensor([i for i, r in enumerate(rows) if r['split'] == 'training'])
corpus = torch.tensor([i for i, r in enumerate(rows) if r['source'] == 'corpus' and r['split'] == 'training'])
dream = torch.tensor([i for i, r in enumerate(rows) if r['split'] == 'training' and r['source'] == 'dream'])
valid = torch.tensor([i for i, r in enumerate(rows) if r['split'] == 'validation'])
width = options.width
destination = folder if width == 64 else folder / ('width-' + str(width))
destination.mkdir(parents=True, exist_ok=True)
if (destination / 'policy.json').exists():
    raise FileExistsError('Preserve the existing model; version a new training attempt')
wc = torch.nn.Parameter(torch.randn(width, x.shape[1]) * .1)
wo = torch.nn.Parameter(torch.randn(width, s.shape[1]) * .1)
bias = torch.nn.Parameter(torch.zeros(s.shape[1]))
params = [wc, wo, bias]
opt = torch.optim.AdamW(params, lr=.003, weight_decay=.0001)

def forward(batch):
    return torch.tanh(batch @ wc.T) @ torch.tanh(s @ wo.T).T / math.sqrt(width) + s @ bias

started = time.perf_counter()
history = []
best = None
best_loss = float('inf')
updates = 0
for epoch in range(61):
    if epoch:
        for _ in range(max(1, len(train) // 512)):
            left = corpus[torch.randint(len(corpus), (256,))] if len(corpus) else dream[torch.randint(len(dream), (256,))]
            indices = torch.cat([left, dream[torch.randint(len(dream), (256,))]])
            loss = torch.nn.functional.cross_entropy(forward(x[indices]).masked_fill(~legal[indices], -1e9), y[indices])
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 2.0)
            opt.step()
            updates += len(indices)
    with torch.no_grad():
        logits = forward(x[valid]).masked_fill(~legal[valid], -1e9)
        val_loss = torch.nn.functional.cross_entropy(logits, y[valid]).item()
        accuracy = (logits.argmax(-1) == y[valid]).float().mean().item()
    history.append(dict(epoch=epoch, validationLoss=val_loss, validationAccuracy=accuracy))
    if val_loss < best_loss:
        best_loss = val_loss
        best = copy.deepcopy([p.detach().tolist() for p in params])
    if epoch % 10 == 0:
        print(history[-1], flush=True)

model = dict(version='joint-semantic-v1', contextWeights=best[0], operatorWeights=best[1], bias=best[2], decisions=updates, loss=best_loss)
if data.get('contextKind'):
    model['contextKind'] = data['contextKind']
(destination / 'policy.json').write_text(json.dumps(model))
(destination / 'training.json').write_text(json.dumps(dict(torchVersion=torch.__version__, seed=options.seed, device='cpu', threads=2, width=width, updates=updates, elapsedMs=(time.perf_counter()-started)*1000, history=history), indent=2))

# Independent double-precision exported inference fixtures, with legal masks.
a=torch.tensor(model['contextWeights'],dtype=torch.float64)
b=torch.tensor(model['operatorWeights'],dtype=torch.float64)
bias64=torch.tensor(model['bias'],dtype=torch.float64)
ss=torch.tensor(data['semantics'],dtype=torch.float64);fixtures=[]
for i in valid[:12]:
    xx=x[i].double(); logits=torch.tanh(a@xx)@torch.tanh(ss@b.T).T/math.sqrt(width)+ss@bias64
    logits=logits.masked_fill(~legal[i],float('-inf'))
    probs=.95*torch.softmax(logits,0)+.05*legal[i].double()/legal[i].sum()
    fixtures.append(dict(x=xx.tolist(),legal=legal[i].tolist(),probabilities=probs[legal[i]].tolist()))
(destination / 'parity.json').write_text(json.dumps(dict(semantics=data['semantics'],fixtures=fixtures)))
