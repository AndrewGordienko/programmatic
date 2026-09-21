"""Independent double-precision inference fixtures for exported policies."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import torch

parser = argparse.ArgumentParser()
parser.add_argument('--folder', default='output/joint/neural-inverse')
folder = Path(parser.parse_args().folder)
if (folder / 'parity.json').exists():
    raise FileExistsError('Preserve inference fixture')
model = json.loads((folder / 'policy.json').read_text())
with gzip.open(folder / 'data.json.gz', 'rt') as source:
    data = json.load(source)
wc = torch.tensor(model['contextWeights'], dtype=torch.float64)
wo = torch.tensor(model['operatorWeights'], dtype=torch.float64)
bias = torch.tensor(model['bias'], dtype=torch.float64)
semantics = torch.tensor(data['semantics'], dtype=torch.float64)
rows = []
counts = {}
for row in data['decisions']:
    if row['split'] != 'validation':
        continue
    available = [i for i, yes in enumerate(row.get('legal', [True] * len(semantics))) if yes]
    n = len(available)
    if counts.get(n, 0) >= 4:
        continue
    counts[n] = counts.get(n, 0) + 1
    x = torch.tensor(row['x'], dtype=torch.float64)
    s = semantics[available]
    logits = torch.tanh(x @ wc.T) @ torch.tanh(s @ wo.T).T / wc.shape[0]**.5 + s @ bias
    probabilities = (.95 * torch.softmax(logits, -1) + .05 / n).tolist()
    rows.append(dict(context=row['x'], available=available, probabilities=probabilities))
    if len(rows) >= 8:
        break
(folder / 'parity.json').write_text(json.dumps(dict(library=data.get('library', []), modelSha256=hashlib.sha256((folder / 'policy.json').read_bytes()).hexdigest(), rows=rows)))
print(dict(fixtures=len(rows), availableProductions=counts))
