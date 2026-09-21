"""Soft executed-fragment ranking; no sound-pruning claim."""
import gzip
import json
import time
from pathlib import Path
import numpy as np
import torch

folder = Path('output/joint/fragment-value-v1')
if (folder / 'model.json').exists(): raise FileExistsError('Preserve trained fragment model')
with gzip.open(folder / 'data.json.gz', 'rt') as source: data = json.load(source)
rows = data['rows']
torch.manual_seed(803121)
np.random.seed(803121)
torch.set_num_threads(2)
training = np.array([i for i, r in enumerate(rows) if r['split'] == 'training'])
validation = np.array([i for i, r in enumerate(rows) if r['split'] == 'validation'])
raw = np.array([r['x'] for r in rows], dtype=np.float64)
assert np.isfinite(raw).all()
mean, scale = raw[training].mean(0), np.maximum(raw[training].std(0), .001)
x = torch.tensor((raw-mean)/scale, dtype=torch.float32)
y = torch.tensor([r['y'] for r in rows], dtype=torch.float32)
model = torch.nn.Sequential(torch.nn.Linear(x.shape[1], 64), torch.nn.ReLU(), torch.nn.Linear(64, 1))
optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.002)
loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=(1-y[training]).sum()/y[training].sum())
started = time.perf_counter()
best = None
history = []
updates = 0
for epoch in range(81):
    model.train()
    for ids in np.array_split(np.random.permutation(training), max(1, int(np.ceil(len(training)/512)))):
        loss = loss_fn(model(x[ids]).squeeze(-1), y[ids])
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5)
        optimizer.step()
        updates += 1
    if epoch % 5 == 0:
        model.eval()
        with torch.no_grad():
            logits = model(x[validation]).squeeze(-1)
            val_loss = loss_fn(logits, y[validation]).item()
            accuracy = ((logits>0) == (y[validation]>.5)).float().mean().item()
        history.append(dict(epoch=epoch, validationLoss=val_loss, accuracy=accuracy))
        if best is None or val_loss < best[0]: best = val_loss, epoch, {k: v.detach().clone() for k, v in model.state_dict().items()}
        if epoch % 10 == 0: print(history[-1], flush=True)
model.load_state_dict(best[2])
export = dict(version='executed-fragment-value-v1', mean=mean.tolist(), scale=scale.tolist(), w1=model[0].weight.tolist(), b1=model[0].bias.tolist(), w2=model[2].weight[0].tolist(), b2=model[2].bias[0].item())
(folder / 'model.json').write_text(json.dumps(export))
w1, b1, w2 = [torch.tensor(export[k], dtype=torch.float64) for k in ['w1', 'b1', 'w2']]
fixtures = []
for i in validation[:12]:
    feature = torch.tensor((raw[i]-mean)/scale, dtype=torch.float64)
    value = torch.sigmoid(torch.clamp(torch.relu(w1@feature+b1)@w2+export['b2'], -40, 40)).item()
    fixtures.append(dict(features=raw[i].tolist(), value=value))
(folder / 'parity.json').write_text(json.dumps(fixtures))
(folder / 'training.json').write_text(json.dumps(dict(seed=803121, trainingRows=len(training), validationRows=len(validation), selectedEpoch=best[1], validationLoss=best[0], updates=updates, elapsedMs=(time.perf_counter()-started)*1000, history=history, note='Classifier labels concern membership in the sampled teacher decomposition, not all valid solutions. Held-out teacher accuracy cannot substitute for a fresh downstream search calibration. No final task outcomes are used.'), indent=2))
