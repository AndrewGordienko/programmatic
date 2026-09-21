"""Train only on development-race labels from predeclared meta-seed splits."""
import gzip
import json
import time
from pathlib import Path
import numpy as np
import torch

folder = Path('output/joint/language-value-v1')
if (folder / 'model.json').exists():
    raise FileExistsError('Preserve fitted value model')
with gzip.open(folder / 'data.json.gz', 'rt') as stream:
    data = json.load(stream)
rows = data['rows']
torch.manual_seed(909017)
np.random.seed(909017)
torch.set_num_threads(2)
train = np.array([i for i, r in enumerate(rows) if r['split'] == 'training'])
validation = np.array([i for i, r in enumerate(rows) if r['split'] == 'validation'])
raw = np.array([r['x'] for r in rows], dtype=np.float64)
mean = raw[train].mean(0)
scale = np.maximum(raw[train].std(0), .001)
x = torch.tensor((raw-mean)/scale, dtype=torch.float32)
y = torch.tensor([r['y'] for r in rows], dtype=torch.float32)
w = torch.tensor([r['weight'] for r in rows], dtype=torch.float32)
model = torch.nn.Sequential(torch.nn.Linear(x.shape[1], 64), torch.nn.ReLU(), torch.nn.Linear(64, 1))
optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.002)
started = time.perf_counter()
best = None
history = []
updates = 0
for epoch in range(201):
    model.train()
    for ids in np.array_split(np.random.permutation(train), max(1, int(np.ceil(len(train)/512)))):
        predicted = model(x[ids]).squeeze(-1)
        loss = ((predicted-y[ids])**2*w[ids]).sum()/w[ids].sum()
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5)
        optimizer.step()
        updates += 1
    if epoch % 5 == 0:
        model.eval()
        with torch.no_grad():
            predicted = model(x[validation]).squeeze(-1)
            error = (((predicted-y[validation])**2*w[validation]).sum()/w[validation].sum()).item()
        history.append(dict(epoch=epoch, validationMse=error))
        if best is None or error < best[0]: best = error, epoch, {k: v.detach().clone() for k, v in model.state_dict().items()}
        if epoch % 25 == 0: print(history[-1], flush=True)
model.load_state_dict(best[2])
export = dict(version='semantic-library-value-v1', mean=mean.tolist(), scale=scale.tolist(), w1=model[0].weight.tolist(), b1=model[0].bias.tolist(), w2=model[2].weight[0].tolist(), b2=model[2].bias[0].item())
(folder / 'model.json').write_text(json.dumps(export))
with torch.no_grad():
    # Recompute in double precision to verify exported JS arithmetic separately.
    m1 = torch.tensor(export['w1'], dtype=torch.float64)
    b1 = torch.tensor(export['b1'], dtype=torch.float64)
    m2 = torch.tensor(export['w2'], dtype=torch.float64)
    fixtures = []
    for i in validation[:12]:
        features = torch.tensor((raw[i]-mean)/scale, dtype=torch.float64)
        value = (torch.relu(m1@features+b1)@m2+export['b2']).item()
        fixtures.append(dict(features=raw[i].tolist(), value=value))
(folder / 'parity.json').write_text(json.dumps(fixtures))
(folder / 'training.json').write_text(json.dumps(dict(seed=909017, trainingRows=len(train), validationRows=len(validation), selectedEpoch=best[1], validationMse=best[0], updates=updates, elapsedMs=(time.perf_counter()-started)*1000, history=history, sourceProtocolHash=data['sourceProtocolHash'], note='Model and checkpoint selection see only meta-seeds 0–15 development-race labels. No test-seed or confirmation/final outcome enters training. No compute-saving claim follows from retrospective labels.'), indent=2))
