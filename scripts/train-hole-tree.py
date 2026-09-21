"""Cheap interpretable branch-rank models; weak witnesses never prove infeasibility."""
import argparse,gzip,json,time
from pathlib import Path
import numpy as np
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import log_loss
p=argparse.ArgumentParser();p.add_argument('--folder',default='output/joint/neural-visited-v1');a=p.parse_args()
folder=Path(a.folder);data=json.load(gzip.open(folder/'data.json.gz','rt'));rows=data['decisions']
x=np.frombuffer(gzip.open(folder/data['featureFile'],'rb').read(),dtype='<f4').reshape(data['featureShape']);y=np.array([r['witness'] for r in rows])
train=np.array([i for i,r in enumerate(rows) if r['split']=='training']);valid=np.array([i for i,r in enumerate(rows) if r['split']=='validation'])
counts={}
for i in train:counts[rows[i]['program']]=counts.get(rows[i]['program'],0)+1
weights=np.array([1/max(1,counts.get(r['program'],1)) for r in rows])
for name,model in [('tree8',DecisionTreeClassifier(max_depth=8,min_samples_leaf=20,random_state=91273)),('forest16',RandomForestClassifier(n_estimators=16,max_depth=8,min_samples_leaf=20,max_features=.5,n_jobs=2,random_state=91273))]:
    out=folder/name
    if (out/'model.json').exists():raise FileExistsError('Preserve fitted critic')
    start=time.perf_counter();model.fit(x[train],y[train],sample_weight=weights[train]);elapsed=(time.perf_counter()-start)*1000
    pos=list(model.classes_).index(True)
    trees=[]
    for estimator in getattr(model,'estimators_',[model]):
        t=estimator.tree_;v=t.value[:,0,:];probs=v[:,pos]/v.sum(1)
        trees.append(dict(feature=t.feature.tolist(),threshold=t.threshold.tolist(),left=t.children_left.tolist(),right=t.children_right.tolist(),positive=probs.tolist()))
    exported=dict(version='visited-hole-tree-v1',features=x.shape[1],trees=trees)
    out.mkdir(parents=True,exist_ok=True);(out/'model.json').write_text(json.dumps(exported))
    fixtures=[dict(features=x[i].astype(float).tolist(),value=float(model.predict_proba(x[i:i+1])[0,pos])) for i in valid[:24]]
    (out/'parity.json').write_text(json.dumps(fixtures))
    pred=model.predict_proba(x[valid])[:,pos]
    metrics=dict(seed=91273,trainingRows=len(train),validationRows=len(valid),elapsedMs=elapsed,validationAccuracy=float(((pred>.5)==y[valid]).mean()),validationLogLoss=float(log_loss(y[valid],pred)),treeNodes=sum(len(t['feature']) for t in trees),note='One decision tree and a 16-tree forest are predeclared alternatives; no downstream calibration labels train them. Float32 comparisons match sklearn prediction. Per-program training weights; empirical whole-function validation grouping. Weak witness labels guide ranking only.')
    (out/'training.json').write_text(json.dumps(metrics,indent=2));print(name,metrics,flush=True)
