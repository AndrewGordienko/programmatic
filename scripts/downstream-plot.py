"""Plot retained counters; do not use contaminated wall measurements."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
folder = Path('output/joint/downstream-stream-v1')
r = json.loads((folder / 'analysis.json').read_text())
assert r['complete'] and r['tasks'] == 20000
curve = r['curve']
x = [0] + [p['tasks'] for p in curve]
base = [0] + [p['baseWork'] / 1e6 for p in curve]
learned = [r['discovery']['work'] / 1e6] + [p['learnedWorkIncludingDiscovery'] / 1e6 for p in curve]
full = [(r['discovery']['work'] + r['discovery']['sharedValueSourceWork']) / 1e6] + [p['learnedWorkIncludingValueInvestment'] / 1e6 for p in curve]
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10, 'svg.fonttype':'none'})
fig, axes = plt.subplots(1, 2, figsize=(12, 5.8))
fig.patch.set_facecolor('#fbfcff')
for ax in axes:
    ax.set_facecolor('#fbfcff')
    ax.spines[['top','right']].set_visible(False)
    ax.grid(axis='y', color='#e3e7ef', linewidth=.7)
    ax.set_xlabel('Distinct downstream tasks')
    ax.set_ylabel('Cumulative recorded work (millions)')
    ax.set_xlim(0,20000)
    ax.set_xticks([0,5000,10000,15000,20000], ['0','5k','10k','15k','20k'])
    ax.plot(x, base, label='Fixed DSL', color='#7b8496', linewidth=2)
axes[0].plot(x, learned, label='Learned DSL + discovery', color='#2455d6', linewidth=2.5)
axes[0].axvline(r['firstWorkCrossing'], color='#2455d6', linestyle=':', linewidth=1)
axes[0].text(r['firstWorkCrossing']+350, 6, 'First crossing\ntask 8,944', color='#2455d6', fontsize=9)
axes[0].set_title('Incremental language cost is repaid', loc='left', fontweight='bold', pad=13)
axes[0].set_ylim(0,72)
axes[0].legend(loc='upper left', frameon=False)
axes[1].plot(x, full, label='Learned + discovery + value-model source work', color='#2455d6', linewidth=2.5)
axes[1].set_ylim(0,560)
axes[1].set_title('Shared value-model investment is not repaid', loc='left', fontweight='bold', pad=13)
axes[1].legend(loc='center left', frameon=False, fontsize=8)
fig.suptitle('20,000 sealed future tasks · one preselected frozen language', fontsize=16, x=.06, ha='left', y=.98)
fig.text(.06,.89, '10,238 learned-language solves vs 5,863 fixed-language solves · 7.44M net incremental work saved', fontsize=10, color='#414d64')
fig.text(.06,.065,'Work counts combine complete proposals and structural operations, not CPU instructions. Program proposals increase.\nAdditional point arithmetic, model fitting, shared inner-policy pretraining and historical R&D remain separate. Wall payback is unassessable.', fontsize=8, color='#566074')
fig.subplots_adjust(left=.065,right=.98,bottom=.2,top=.78,wspace=.25)
fig.savefig(folder/'payback.svg', facecolor=fig.get_facecolor())
fig.savefig(folder/'payback.png', dpi=150, facecolor=fig.get_facecolor())
