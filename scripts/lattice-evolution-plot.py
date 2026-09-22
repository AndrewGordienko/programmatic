"""Render recorded frozen trials; no new synthesis or model selection."""
import gzip, json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root = Path('output/joint/lattice-evolution-v1')
protocol = json.loads((root/'protocol.json').read_text())
report = json.loads((root/'analysis.json').read_text())
assert report['status'] == 'complete'
runs = [json.load(gzip.open(root/f'seed-{s}.json.gz')) for s in protocol['config']['seeds']]
for run in runs:
    assert run['protocolHash'] == report['protocolHash']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False,
                     'axes.spines.right': False, 'axes.titleweight': 'bold', 'svg.fonttype': 'none'})
fig, axes = plt.subplots(1, 2, figsize=(12.8, 5.1), gridspec_kw={'width_ratios': [1.35, 1]})
fig.subplots_adjust(left=.065, right=.985, top=.77, bottom=.25, wspace=.3)
fig.text(.065,.955,'Useful languages, with a remaining transfer gap',fontsize=19,weight='bold',color='#152439')
fig.text(.065,.898,'8 frozen language-training runs • 4,800 trials per arm • one shared pretrained policy',fontsize=10.5,color='#506076')
colors=['#abb3bf','#506885','#70bfb0','#007b6c']
labels=['Base · uniform','Base · learned prior','Learned · uniform','Learned · same prior']
names=['base-uniform','base-guided','candidate-uniform','candidate-guided']
xs=np.linspace(0,4608,513)
for name,label,color in zip(names,labels,colors):
    curves=[]
    for run in runs:
        trials=[t['result'] for t in run['trials'] if t['arm']==name]
        assert len(trials)==600
        curves.append([100*sum(t['solved'] and t['work']<=x for t in trials)/len(trials) for x in xs])
    axes[0].plot(xs,np.mean(curves,axis=0),label=label,color=color,lw=2.2)
axes[0].set(xlim=(0,4608),ylim=(0,75),xlabel='Search work: complete proposals + structural operations',ylabel='Held-out trials solved (%)',title='Language improves overall search')
axes[0].grid(axis='y',color='#e7ebef',lw=.8)
axes[0].legend(frameon=False,loc='lower right',fontsize=9)
comparison=report['comparisons']['library-guided']
groups=['Related compositions','Nested compositions','Longer expressions']
for i,g in enumerate(groups):
    s=comparison[g]['solve']; m=s['mean']*100; lo=s['lower']*100; hi=s['upper']*100
    color='#9a6710' if lo<=0 else '#007b6c'
    axes[1].errorbar(m,2-i,xerr=[[m-lo],[hi-m]],fmt='o',color=color,capsize=4,markersize=7,lw=2)
    axes[1].text(hi+1.4,2-i,f'{m:+.2f} pp',va='center',fontsize=9,color=color)
axes[1].axvline(0,color='#9aa4b0',lw=1,ls='--')
axes[1].set(yticks=[2,1,0],yticklabels=['Related','Nested','Longer'],xlim=(-5,46),ylim=(-.5,2.5),xlabel='Learned − base solve rate (percentage points)',title='Nested gain is not established')
axes[1].grid(axis='x',color='#e7ebef',lw=.8)
fig.text(.065,.13,'All eight languages passed fresh confirmation. Guided solves: base 2,055/4,800; learned 3,072/4,800.',fontsize=9.5,color='#334155')
fig.text(.065,.08,'Intervals resample eight meta-seed means. 1,571 distinct final functions; 29 repeats across runs. Work units are heterogeneous.',fontsize=8.5,color='#64748b')
fig.text(.065,.035,'Discovery: 152.97M work + 634.0 process CPU seconds. Complete proposal counts increase; off-road transfer is not demonstrated.',fontsize=8.5,color='#64748b')
for suffix in ['svg','png']:
    fig.savefig(root/f'search-transfer.{suffix}',dpi=180,facecolor='white')
