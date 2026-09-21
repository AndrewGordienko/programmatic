"""Train on executed dreams and solved programs; export the semantic scorer."""
import copy
import gzip
import json
import math
from pathlib import Path
import time
import torch
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, default=64)
options = parser.parse_args()
if options.width < 1:
    raise ValueError('Positive width required')

torch.manual_seed(7721)
torch.set_num_threads(4)
torch.use_deterministic_algorithms(True)
folder = Path('output/joint/neural')
with gzip.open(folder / 'data.json.gz', 'rt') as source:
    data = json.load(source)
rows = data['decisions']
x = torch.tensor([r['x'] for r in rows], dtype=torch.float32)
y = torch.tensor([r['y'] for r in rows], dtype=torch.long)
s = torch.tensor(data['semantics'], dtype=torch.float32)
train = torch.tensor([i for i, r in enumerate(rows) if r['split'] == 'training'])
corpus = torch.tensor([i for i, r in enumerate(rows) if r['source'] == 'corpus'])
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
            loss = torch.nn.functional.cross_entropy(forward(x[indices]), y[indices])
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 2.0)
            opt.step()
            updates += len(indices)
    with torch.no_grad():
        logits = forward(x[valid])
        val_loss = torch.nn.functional.cross_entropy(logits, y[valid]).item()
        accuracy = (logits.argmax(-1) == y[valid]).float().mean().item()
    history.append(dict(epoch=epoch, validationLoss=val_loss, validationAccuracy=accuracy))
    if val_loss < best_loss:
        best_loss = val_loss
        best = copy.deepcopy([p.detach().tolist() for p in params])
    if epoch % 10 == 0:
        print(history[-1], flush=True)

model = dict(version='joint-semantic-v1', contextWeights=best[0], operatorWeights=best[1], bias=best[2], decisions=updates, loss=best_loss)
(destination / 'policy.json').write_text(json.dumps(model))
(destination / 'training.json').write_text(json.dumps(dict(torchVersion=torch.__version__, seed=7721, device='cpu', threads=4, width=width, updates=updates, elapsedMs=(time.perf_counter()-started)*1000, history=history), indent=2))
