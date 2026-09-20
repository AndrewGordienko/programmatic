# Learning a language that reduces future search

This is a restricted scalar library-learning experiment, not the off-road demo and not Argos's undisclosed implementation. The previous simulator supplied the difficult representation choices. Its useful controller did not demonstrate useful DSL discovery.

## Protocol v1 — specified before the benchmark

- Base language: `add`, `sub`, `mul`, `min`, `max`, `neg`, scalar variables x/y, constants -2 through 2. All functions are monomorphic scalar→scalar compositions; no new value types or perception.
- 500 training tasks, 60 development-screening tasks, 40 confirmation tasks, 200 final tasks. Confirmation is split into fresh 20-task blocks, one per outer round. Final tasks are inaccessible to library/prior updates.
- Targets are procedural absolute-value, positive-part and bounded-value compositions of affine expressions. Only I/O examples are supplied to synthesis. Related but behaviorally distinct targets are deduplicated across all splits on 97 independent probes. This is empirical deduplication, not proof of semantic inequality.
- Of the final tasks, 120 are new related compositions, 40 are nested compositions and 40 are longer expressions. Nested and longer target structures are excluded from training and development. All remain in the same synthetic scalar domain; this does not establish control or cross-domain transfer.
- Search uses 25 examples. It stops on the first exact fit, then checks that candidate on 65 validation examples, including a wider input range. A failed independent check is counted as an unsolved trial, with no feedback into synthesis. Finite examples do not prove universal correctness.
- Two wake/library/prior rounds. Each training task gets up to 1,536 candidate evaluations. Successful synthesized programs alone enter the corpus. Existing solved programs are retained if later search fails.
- Mining considers up to 100 repeated, parameterized patterns, including holes replacing internal expressions. Actual corpus compression ranks candidates; it does not establish search utility. Up to 12 additions, a joint two-macro addition, and deletions enter short races. All macro definitions are flattened into the base algebra, so deletion is safe and dependencies cannot cycle.
- Short races: first eight development tasks × two inner seeds, 256 evaluations per trial. Best three edits proceed to all 60 development tasks × three seeds at 1,024 evaluations. The best positive edit gets independent confirmation against the incumbent on that round's 20 fresh confirmation tasks × three seeds at 1,536 evaluations.
- Utility per trial: `solved ? 1 - 0.5 * evaluations / budget : 0`. Language cost: `0.0005 * definition_nodes`. Accept only if the paired mean gain minus two task-clustered standard errors and the complexity penalty is positive, at least two of three seed means improve, and confirmation solves do not decrease. This approximate uncertainty gate is a heuristic, not a calibrated sequential hypothesis test.
- The neural prior is a 25-input, 16-hidden-unit MLP predicting operator frequencies from I/O behavior. Training uses refactored successful programs plus 128 executed synthetic “dream” programs. It guides operator choices, not whole-program probabilities or semantic partial-program reasoning. Fixed and learned final priors train on the same solved corpus, expanded or refactored respectively. The library is selected with neural guidance; uniform-library performance is an ablation of that selected library.
- Freeze the library and both priors. Four arms: fixed/uniform, fixed/prior, learned/uniform, learned/prior. Each final task receives the same 2,048-evaluation cap and three paired optimizer seeds. Execution order rotates to reduce systematic timing bias.
- Twenty predeclared meta-seeds: 0–18 and 42. They share the task suite; 12,000 repeated test trials are not 12,000 independent tasks. Preserve every seed and every failure. Report by task group and meta-seed; do not select the best reference result.

## Accounting and falsification

Solve-rate curves use all trials. Mean capped effort charges failures the full search limit; median solved effort is explicitly conditional. Matched-solve speedup uses only paired trials where both arms solve, and reports that count to expose selection bias. Discovery evaluations include wake, incumbent comparisons, short races, large races and confirmation. Wall time includes mining, neural training and all discovery work. Candidate counts are not equal CPU cost across languages.

Break-even is an **extrapolation**: discovery evaluations / mean capped effort saved per attempted future task. It is unavailable when savings are non-positive or solve rate falls. The horizontal axis counts task attempts, not guaranteed solved tasks. Failed or partially fitting searches remain failures. Also report actual discovery-plus-test costs and wall-time break-even; a favorable extrapolation alone does not establish observed savings or an equal-total-compute advantage. No fabricated 2×/20-point thresholds are marked as passed without measurements.

Macro usage is measured in solved final programs. A usage-conditioned speedup is an association, not causal macro credit. Removal and same-arity definition shuffling are post-test interventions with a frozen, masked prior; no ablation outcome changes the selected library. A one-macro library cannot support definition shuffling. Uniform-probability ablation is already one of the four arms.

Candidate edits, definitions, compression, development gains, per-seed gains, confirmation bounds, decisions and full final programs are exported. These are the beginnings of a DSL-edit value-model dataset, not evidence that a surrogate already saves outer-search compute. A credible next experiment must train on past meta-runs, rank unseen edits, and compare selection regret and total evaluation cost against compression and random screening. This implementation does not claim neural-policy decompilation, Stitch's optimizer, arbitrary typing/control-flow invention, or a learned outer surrogate.

## Measured v1 outcome

All 20 meta-runs completed. None accepted a DSL edit. Uniform search solves 589/12,000 final trials; the learned prior solves 692/12,000. The corresponding learned-library arms are exactly identical because their libraries stayed empty. Total discovery cost is 64,578,627 candidate evaluations. This rejects a useful-library claim for this procedure and budget, without establishing that the general research problem is impossible. Overall coverage is low (4.9–5.8%); increasing the task count did not make this a strong inner synthesizer.

Seed 42's reference discovers 98 successful training functions across two rounds but retains no abstractions. It solves 29/600 final trials uniformly and 38/600 with the prior. Discovery costs 3,135,488 evaluations. The default UI compares fixed/prior with learned/prior, so a prior-only benefit cannot masquerade as a DSL improvement. The empirical duplicate-proposal rate is about 32%; useful patterns such as `max(0, a)` are present among rejected candidates.

The frozen offline value-model probe fits ridge regression on 96 fully evaluated finalist edits from seeds 0–15. It tests 24 edits in eight three-candidate ranking groups from seeds 16, 17, 18 and 42. Mean utility regret: model **0.004041**, compression **0.004155**, expected random selection **0.007550**. This tiny difference against compression, on selection-biased groups, does not establish an outer-search advantage. All expensive labels were already paid for; saved synthesis evaluations are **zero**. The model, predictions, cheap feature vectors and measured labels are exported to support a prospective follow-up.

The 20 runs use the same task distribution and split, not independent domains. Results were retained without changing search budgets or acceptance gates after inspecting final performance. Two benchmark processes ran concurrently; CPU contention and other machine activity limit wall-time comparisons. The seed-42 reference ran separately. Candidate counts are the reproducible cost measure.

## Research context

[DreamCoder](https://arxiv.org/abs/2006.08381) jointly learns libraries and neural search guidance. [Stitch](https://stitch-bindings.readthedocs.io/en/latest/compression_objectives.html) optimizes corpus compression; this implementation uses a small custom pattern miner rather than Stitch. [LILO](https://arxiv.org/abs/2310.19791) combines program generation, symbolic compression and documentation. [Palmarini et al. (ICML 2024)](https://proceedings.mlr.press/v235/palmarini24a.html) extract components from learned search-policy knowledge. These motivate the experiment; this repository reproduces none of those systems.

```sh
npm run library:reference
npm run library:benchmark
# Continue an interrupted, unchanged protocol:
npm run library:benchmark -- --resume
```
