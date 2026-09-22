# Joint language/search pilot

This is a new, versioned attempt at Gates 3–5, not a successful reproduction of an undisclosed Argos algorithm. The v1 library benchmark remains unchanged. Open [the recorded pilot](http://localhost:5180/#joint), or the [four-screen presentation](http://localhost:5180/#demo).

## Implemented

`src/joint/policy.ts` learns a shared conditional scorer. Inputs contain task outputs and input statistics, current-hole depth/role, partial-tree structure and probe behavior, parent-production semantics, and available-language summaries. A second learned encoder consumes each production's arity and behavior on 16 asymmetric probes. Scores combine these embeddings, with a learned semantic bias. Newly named macros need no new output token or retraining to receive a score. This is a small feature-based neural model, not a full AST transformer or a perception model.

`search.ts` interleaves bounded best-first hole expansion, stochastic conditional completion, and evolutionary subtree restarts. Every complete proposal is charged, including duplicates. Partial expansions have a separate cap and counter. Search stops on training-example fit, then performs one independent correctness check; a failed check cannot restart or steer search. The initial length-normalized priority starved complete programs and was removed during training-only calibration. Calibration still solved 0/20 tasks for both new variants versus 2/20 for legacy genetic search at 512 evaluations. Architectural completeness has not made this a strong synthesizer.

`genome.ts` proposes populations of entire libraries using add, delete, generalize, specialize, merge, joint addition, replacement and crossover. Definitions originate in solved-program subtrees and random base-algebra compositions. Proposals need not compress the corpus. Libraries contain at most four definitions, with one to three scalar arguments and at most 15 expanded definition nodes. Primitive types, six base operators and control structures remain fixed. Behavioral deduplication is empirical; it is not an equivalence proof.

`experiment.ts` starts with a legacy-search bootstrap, then alternates library tournaments, new training-task synthesis and joint-policy training. Each round proposes 128 genomes; shortlists 16 plus four random exploration choices; retains previous survivors and the base; runs cheap races; sends four finalists (plus base if necessary) to fresh larger races; and retains up to eight competing languages. The ridge value model is trained only on prior rounds' short-race labels. The first round uses a support/compression proxy. Selected IDs and model-training counts are recorded before evaluation. Existing v1 edit labels are deliberately not pooled with this different synthesis protocol.

For a solved task, normalized solve-curve AUC is `1 - evaluations / budget`; for a failure it is zero. The tournament score subtracts definition-node cost, normalized inner work and candidate-evaluation overhead over a declared 1,000-task horizon. Compression is a proposal heuristic, not tournament fitness. Full training/discovery cost is also reported separately.

## Frozen pilot protocol

- Three predeclared meta-seeds: 0, 7, 42. Each draws its own task split from generator seed `20260921 + 1009 * metaSeed`.
- Per run: 200 training, 48 development, 24 confirmation and 80 final tasks. Twenty percent of final tasks are nested compositions; another twenty percent are longer expressions. These structures are withheld from this run's training/selection.
- Two outer rounds, each using 12 new short-race tasks and 12 new medium-race tasks. Short cap 128, medium cap 512. Training bootstrap cap 1,536; later wake cap 512.
- Final and confirmation cap 1,024 complete proposals and 8,192 partial expansions, with three inner seeds per task. Final four arms compare base/candidate libraries × uniform/joint policy. Both joint arms use the **same frozen neural weights**. This includes the remove-all-macros ablation.
- One development-selected candidate is frozen before confirmation and final tests. It remains in the final comparison even if confirmation rejects it. No rejected language is deployed or called accepted. The single-candidate confirmation heuristic uses a task-clustered mean minus two standard errors and requires at least 20 tasks. This is not a sequential confidence guarantee.
- Same caps do not mean same CPU compute. Neural inference, probing, library generation and training have wall-clock costs; expansions are additional work, not interchangeable CPU units. The two runners overlapped, so recorded wall times are descriptive.

## Measured result on the original distribution

| Arm                      | Solved / 720 | Solve-curve AUC | Failure-censored evaluations | Partial expansions |
| ------------------------ | -----------: | --------------: | ---------------------------: | -----------------: |
| Base + uniform           |           28 |           2.25% |                      720,693 |          2,367,264 |
| Base + joint policy      |           38 |           2.94% |                      715,592 |          2,490,408 |
| Candidate + uniform      |           25 |           1.90% |                      723,305 |          2,437,195 |
| Candidate + joint policy |           46 |           3.59% |                      710,839 |          2,539,008 |

These are 240 task instances × three optimizer replicates, not 720 independent functions; task draws can also overlap across meta-seeds. The candidate/joint arm solves 5/144 nested trials and 0/144 longer-expression trials. Base/joint solves 4/144 and 2/144 respectively. There is no demonstrated deeper-structure advantage.

Training coverage grows 44→53, 34→38, and 39→50 out of 200. Seed 7 retains the empty library. The other development-selected definitions are:

```
seed 0:  fn_4196283515(a, b) = a + (-b)
seed 42: fn_4277500659(a, b) = min((a + b) - 1, 1)
```

The first is semantically redundant with the existing subtraction primitive. This exposes a missing base-operator-equivalence filter; changes in sampling alone can masquerade as conceptual discovery. Both candidates fail fresh confirmation: penalized mean AUC changes −1.58 and −3.51 percentage points. **Zero candidates are accepted. Gates 3–5 remain unproven.**

Training and discovery cost **2,201,438 complete-program evaluations plus 5,326,408 partial expansions**, including 59,292 neural training decisions (training time included in total discovery wall time). Candidate/joint final search is slower in wall time than base/joint. No compute-cost amortization is established.

## A separate task-distribution failure

The first runner excluded every function generated by three historical suites. Because the synthetic generator has finite support, that removed many easy functions and materially changed the task distribution. Its bootstrap coverage was only 4/200, 5/200 and 6/200. All three selected libraries remained empty, with 3/720 uniform solves and 1/720 joint-policy solves.

That harsher run is preserved under `output/joint/pilot/` and in the UI's **Historical functions excluded** view. A training-only diagnostic with identical bootstrap settings found 44/200 on the original support versus 4/200 after exclusion. The separate original-support experiment was declared before its final runs and is preserved under `output/joint/iid/`. It keeps strict disjointness within each run but may overlap historical experiments; no historical corpus, prior or learned library is loaded. Do not describe these tasks as never encountered anywhere in the project's history.

## Next experiments, not established results

1. Strengthen the inner search on training/development tasks, using executable semantics and sound partial-program feasibility bounds. Then evaluate on a newly frozen split.
2. Filter aliases of base productions and diagnose whether learned definitions reduce search depth rather than merely duplicating probability mass.
3. Calibrate the neural policy on more diverse successful trajectories and executed dreams. A 12-unit feature model with a few thousand decisions is currently weak.
4. Compare prospective selection against random/compression selection and a separately charged full-pool audit. Current unmeasured candidates do not establish quality-preserving savings; no 10× or 100× claim is warranted.
5. Only after a clear pilot improvement, freeze a larger multi-seed protocol with uncertainty, matched-work comparisons, macro removal, and amortization tests.

The joint library/search loop is motivated by [DreamCoder](https://arxiv.org/abs/2006.08381). [Neural-guided bidirectional search](https://arxiv.org/abs/2110.11536) is a relevant primary reference for combining execution with inverse semantics. These are references for research direction, not performance claims about this implementation.

## Reproduce

`npm run joint:calibration` uses training tasks only. `npm run joint:pilot` runs the original-support experiment; `npm run joint:filtered` runs the historically filtered variant. Completed benchmark files are never silently overwritten: version the output path/protocol for new runs. `npm run joint:report` validates frozen hashes and rebuilds the combined UI artifact from raw trials. `npm test` checks conditional features, token-renaming invariance, both search caps, final-example isolation, frozen weights, library semantics, prospective ranking and race accounting.

## Subsequent inner-search experiments (not a new final benchmark)

The next iteration isolates the inner synthesizer. Generator seed 31092026 supplies 100 bootstrap tasks, 60 training-only calibration tasks, 40 previously unused development tasks, and 40 further confirmation/final tasks that remain unopened. Three optimizer seeds repeat each calibration task at a 1,024-program cap.

| Training-only calibration                                   | Solves / 180 | Outcome                                |
| ----------------------------------------------------------- | -----------: | -------------------------------------- |
| Legacy genetic search                                       |           17 | Reference                              |
| Initial joint search                                        |           14 | Still weaker                           |
| Interval-pruned search                                      |           11 | Regression after charging bound checks |
| Conditional evolution + case-wise parent selection, uniform |           22 | Better corpus search                   |
| Same search, original small joint policy                    |           21 | Small policy still unhelpful           |
| Same search, extensively trained 64-unit policy             |           45 | Promising calibration improvement      |
| Same policy controlling terminal/operator choice too        |           41 | Fewer solves, lower wall time          |

The new policy is trained from 23 solved bootstrap programs plus 5,000 executed random/corpus-mutated programs. No oracle concept ASTs enter training. This yields 63,571 construction decisions; PyTorch training makes 3,440,640 decision updates, selecting weights on held-out **dream programs**, not final tasks. Dream validation next-production accuracy rises from about 6.5% to 31.2%. Models of widths 12 and 32 are also retained as calibration candidates. Exported weights are used by the same TypeScript interpreter; an independent PyTorch probability fixture checks inference parity. The original v1 search settings remain available by default.

On the **40 previously unused development tasks × three seeds**, the larger policy gets **33/120 solves**, versus **16/120 uniform** and **17/120 legacy**. It uses 96,418 program evaluations versus 111,567 uniform, but takes 6.26 seconds versus 2.30 seconds uniform and 0.63 seconds legacy on this machine. Therefore this is not a wall-clock efficiency win or a final Gate 3 result. **A later semantic exposure audit found 14/40 functions also occurred in executed neural-training dreams.** These tasks were unused for calibration, but were not all functionally unseen. Task conditioning is cached without changing probabilities; inference and search overhead still matter.

The interval experiment has a separate bound-check counter and charges checks to the partial-work cap. It is preserved, not enabled by default. Case-wise parent selection retains distinct error behavior among up to 64 candidates instead of keeping only the best mean-error variants.

### Proposal recall and alias audit

`scripts/proposal-recall.ts` keeps ground-truth abs/positive-part/clamp functions **only in a diagnostic**. Neither proposal generation nor selection imports those labels. It finds that useful concepts sometimes exist before selection: original seed 0 proposes all three; seed 7 proposes positive-part and clamp equivalents; seed 42 proposes magnitude but loses a mined positive-part candidate during random language generation. Several definitions are unnecessarily bloated.

The opt-in normalized proposal mode adds algebraic constant folding, identity/cancellation and min/max absorption/bound simplification; it rejects base-production aliases using 272 semantic probes. It preserves mined singletons and some mined pairs before filling the population with mutations. After normalization, seed 0 proposes compact equivalents of all three concepts and seed 42 preserves magnitude and positive-part. Seed 7 still proposes none. Thus both proposal coverage and selection need improvement; normalization alone has not solved discovery. Probe-based equivalence checks remain empirical.

Artifacts: `output/joint/semantic-calibration.json`, `evolution-calibration.json`, `proposal-recall*.json`, and `output/joint/neural/`. Reproduction scripts are named after those experiments; neural training uses the locally installed PyTorch 2.10.0 on CPU and exports ordinary JSON weights. These additional training costs have not been amortized. The next target is stronger executable/inverse guidance at holes, with fresh validation and explicit work accounting.

## Executable inverse-search iteration

`src/joint/inverse.ts` adds a **piecewise-affine scalar-domain heuristic**, not a general solution to language discovery. It infers bounded integer affine fragments from I/O triples, builds them from the original arithmetic operators, and propagates desired output intervals backward through add/subtract/multiply/min/max/negation. A semantic fragment bank answers inverse constraints. The same frozen neural policy ranks remaining production choices. There are no abs, positive-part or clamp templates in the solver.

Every proposed complete expression, including support screening and duplicates, counts against the program cap. Plane fits, inverse steps and constraint queries have a separate structural cap; constraint-point checks and wall time are reported too. These heterogeneous operations are not equivalent CPU units. The initial exploratory `inverse-calibration.json` omitted support-screening executions and is explicitly invalid for compute claims. Corrected v2 and v3 artifacts are retained; v3 also fixes reuse of cached fragment semantics.

With a cap of 512 program proposals and 4,096 structural operations, v3 training-only calibration obtains 87/180 guided solves, 80/180 uniform solves, and 41/180 with the affine heuristic removed. The subsequent **fresh 40-task inner-validation batch × three optimizer seeds** gives:

| Solver                            | Solved / 120 | Program proposals | Structural operations | Wall time |
| --------------------------------- | -----------: | ----------------: | --------------------: | --------: |
| Legacy genetic                    |           11 |            58,988 |                     — |    0.32 s |
| Previous joint solver             |           34 |            48,457 |               225,853 |    3.32 s |
| Inverse, uniform                  |           52 |             9,501 |               302,027 |    0.58 s |
| Inverse, frozen joint policy      |           61 |             8,631 |               224,977 |    0.45 s |
| Inverse, affine heuristic removed |           26 |             1,706 |               405,156 |    0.78 s |

The guided inverse solver gets 57/96 related, 4/12 nested and 0/12 longer-expression solves. These are 40 task instances, not 120 independent tasks or independently trained policies. **The later exposure audit found 12/40 functions also occurred in neural-training dreams.** The batch was not previously used for tuning, but should not be described as entirely unseen by the policy. All arms have the same program cap; heterogeneous work and CPU overhead still differ. The three optimizer seeds share one previously trained policy. This is an inner-search diagnostic, not a final multi-meta-seed language-learning result.

That solver produces correct programs for **90/160 training tasks** across three searches each (264/480 successful trials). Equality-aware abstraction replaces all occurrences of the same computation with one shared argument. A commutative pattern-matching fix prevents equivalent min/max operand orders from hiding compression. The resulting 94 proposed definitions include:

```
fn_2352281741(a) = max(a, -a)       support: 23 training tasks
fn_715306984(a)  = max(a, 0)        support: 58 training tasks
fn_2597717659(a) = min(1, max(a,0)) support: 22 training tasks
```

These were mined from synthesized programs; oracle names enter only the subsequent diagnostic. They are **proposals, not accepted language improvements**. No fresh downstream selection, structural-transfer advantage or discovery amortization has yet been established for them. The inverse engine currently uses arbitrary unary macros as forward fragments; general macro inversion remains unimplemented.

Artifacts: `inverse-calibration-v3.json`, `inverse-validation-v3.json`, `inverse-corpus-v4.json`. The corpus took 36,914 program proposals, 877,042 structural operations and about 2.23 seconds including abstraction mining on this machine, excluding earlier neural-data generation/training and research calibration. Report those additional costs before claiming total amortization. Tests cover inverse-constraint soundness, out-of-sample execution, check-output isolation, budget caps, shared arguments and commutative rewriting.

## Strict-exposure language pilots

The next pilots exclude every function in the recorded neural corpus/dream set and the preceding calibration suite, using the same 97-probe empirical signatures as the task generator. Pilot v2 additionally excludes every v1 selection, confirmation and test function. This is a stricter distribution, with many easy functions removed; its solve rates are not directly comparable with the preceding inner calibration. It is still finite-probe disjointness, not a proof of mathematical inequivalence or global novelty across every historical experiment.

Both pilots use the automatically mined corpus and a **restricted unary library** population: 128 candidate languages with up to four definitions, including singletons, pairs and multi-additions. Twelve development tasks screen the population; 24 fresh development tasks × three optimizer seeds select one candidate. The library and shared policy freeze before 48 confirmation tasks and 100 final tasks × three seeds. Each final task has a 512-proposal cap and 4,096 structural-operation cap in all four arms. No surrogate savings are claimed by these pilots.

V1 accepts a language on confirmation, but its final guided result is only 49/300 versus 44/300. The task-clustered solve-rate interval includes zero, with no nested/longer gain and no search-cost saving.

V2 uses a production-diverse beam and up to 32 differences between observed affine fragments to expose components of compound outputs. Both arms permit **96 active and 96 expanded nodes**, preventing macros from winning solely by bypassing the earlier 31-node active cap. It autonomously selects:

```
fn_2352281741(a) = max(a, -a)
fn_715306984(a) = max(a, 0)
```

| V2 final arm                 | Solved / 300 | Work-curve AUC | Search work | Wall time |
| ---------------------------- | -----------: | -------------: | ----------: | --------: |
| Base, uniform                |           29 |          6.97% |   1,040,339 |    1.83 s |
| Learned library, uniform     |           79 |         22.82% |     885,647 |    1.62 s |
| Base, shared frozen policy   |           51 |         13.61% |     898,809 |    1.63 s |
| Learned library, same policy |           80 |         22.74% |     813,755 |    1.50 s |

The guided comparison gains **9.67 percentage points** in solve rate, with a descriptive paired task-bootstrap 95% interval **[5.0, 15.0] pp**. Work-curve AUC gains **9.14 pp [4.66, 14.03]**. Fifty-seven of the 80 successful learned-library trials use an invented function. The base/shared-policy arm is the remove-all-macros ablation with identical tasks, seeds, weights and search settings. Complete-program proposals actually increase by about 12.7 per task on average; the saving is in structural search and recorded wall time, not fewer complete proposals.

**Structural transfer is not established:** related solves improve 23→51 out of 180, nested changes 28→27 out of 60, and longer changes 0→2 out of 60. The latter gain is too small and uncertain. These pilots share one policy and one library-training corpus; three optimizer seeds do not establish robustness across independent meta-training runs.

Search-work savings extrapolate to roughly **27,102 future tasks** to repay the counted corpus/selection/prior-bootstrap work. A wall-time projection is at least **47,984 future tasks**, using only available training/discovery timing. This is **not observed amortization**; earlier bootstrap wall time, research calibration and some runner overhead are not fully available, so the total wall cost is a lower bound. Structural work counts combine heterogeneous operations and must not be interpreted as CPU equivalents. The benchmark's finite support also limits extrapolation to large streams of distinct future functions.

`inverse-language-analysis.json` reports paired task-cluster uncertainty, common-solved-task metrics and these limitations. Results are an encouraging restricted language-learning pilot, not Gates 3–5 across seeds or general DSL invention.

### Continuing inner-search diagnostics

`domains.ts` derives exact piecewise-affine unary semantics from arbitrary base-language definitions and inverts them into unions of intervals. It preserves both branches of non-monotone functions; nonlinear multiplication remains unsupported for inverse execution. Property checks verify forward/inverse agreement and reject points between disjoint solution branches. Initial calibration of this feature regressed, so it is **not enabled** in the v2 pilot.

`semantic-rank-calibration-v1.json` tests residual-magnitude ranking on the original training batch plus an explicitly development-only structural sample. With the v2 library it improves 194→210 solves out of 330; the matched base solver improves 179→189. Longer solves remain only 3/30 and nested 9/30, so deeper synthesis remains the bottleneck. These adaptive diagnostics are not new final evidence.

## A second wake round and third fresh pilot

Re-solving the original 160 training tasks with the accepted v2 language and a larger, charged 2,048-proposal training budget produces correct programs for **133/160 tasks** (381/480 trials). It costs 32,046 proposals and 1,304,819 structural operations. The stronger solver uses 512 affine fits, reuses cached fragment semantics, normalizes integer directions of affine differences, and ranks inverse branches by residual magnitude. This coverage increase cannot be attributed to the DSL alone because the training budget and search settings also changed.

Equality-aware mining of that corpus proposes compound functions, including positive-part of one argument plus magnitude of another. Pilot v3 evaluates 192 libraries allowing arities 1–3; forward tuple proposals and charged, partially applied inverse semantics make multi-argument definitions executable during search. It retains the previous language as a candidate. V3 excludes all v1/v2 functions and the structural calibration sample before generating new selection, confirmation and final tasks. It again selects the **same two unary magnitude/positive-part definitions**; larger proposed functions do not win selection.

| V3 final arm                 | Solved / 300 | Work-curve AUC | Search work | Wall time |
| ---------------------------- | -----------: | -------------: | ----------: | --------: |
| Base, uniform                |           39 |          8.41% |   1,062,282 |    1.66 s |
| Learned library, uniform     |          111 |         26.71% |     853,546 |    1.53 s |
| Base, shared frozen policy   |           74 |         17.60% |     902,824 |    1.61 s |
| Learned library, same policy |          121 |         29.60% |     761,339 |    1.42 s |

The guided solve-rate gain is **15.67 pp [9.33, 22.33]**, and work-AUC gain **12.00 pp [7.27, 17.13]**, using the same descriptive task bootstrap. Invented functions appear in 115/121 successful learned-library trials. Related solves improve 48→91/180, nested 20→21/60, and longer 6→9/60. The two structural-group improvement intervals include zero. This is another fresh task cohort, **not independent meta-training replication**.

The cost report recursively includes the parent v2 corpus and language-selection stages, counting shared prior training once. It projects roughly **37,710 tasks** to repay recorded search work and a lower-bound **68,003 tasks** for available wall costs. Neither is observed amortization; the earlier caveats still apply. Complete proposal count increases while structural work decreases. Parameter inference is an explicit scalar-domain search heuristic, and symbolic constant folding may produce integer literals outside the neural sampler's small terminal vocabulary.

### Rejected extensions and policy refresh

`join-calibration-v1.json` tests indexed inverse search over additive prefixes with one remaining hole. Every prefix/query/static-analysis operation is charged, and a found complete program must pass the full example evaluator. It does not improve the structural calibration. `join-calibration-v2.json` adds affine envelope proposals inferred from one-sided I/O constraints and also regresses. Both are disabled in the successful pilots. Keeping these failures prevents confusing additional machinery with progress.

The policy-refresh experiment refactors the richer training corpus into the learned language and generates **10,000 executed dream programs / 129,458 construction decisions**. Integer constants folded by the solver are lowered to available base arithmetic before producing teacher decisions. The new 64-unit model reaches about **45.5% held-out dream production accuracy**, but the downstream calibration regresses: learned-library solves **216/330**, versus **222/330** with the old policy; base-language solves also regress 193→180. Longer calibration solves rise only 3→5/30. The new model is retained under `output/joint/neural-v2/`, **not promoted**.

Dream-generation counters now include discarded/duplicate proposals, actual program and example executions, and partial-program feature probes. A deterministic replay audit verifies the existing v2 dataset's program, decision and semantic arrays before adding accounting; it does not alter its trained examples or weights. Neural teacher accuracy alone is not the optimization objective. The next policy experiment should expose the actual residual/inverse specification at the hole and evaluate downstream search, rather than just scaling imitation of whole-program construction.

Nested/longer generator classes are withheld from language selection in the successful pilots. Executed random dreams can contain similar structural patterns; these results are not a claim that the neural policy has never encountered any nested syntax. The final function-exposure audit and uniform-prior ablation remain necessary.

### Residual-conditioned policy: implemented, not promoted

`neural-inverse/` contains a second rejected policy experiment. Its context includes the actual inverse output specification at the hole: up to two disjoint intervals per example, with interval count, alongside the original task/partial-program/operator features. Executed dream programs provide paired base/library teachers; legal-production masks prevent unavailable macros from entering the base-language training loss. Both representations of a source program stay in the same training/validation partition.

The resulting 64-unit model trains on **85,780 decisions** and reaches approximately **59.1% teacher accuracy**. Independent double-precision PyTorch fixtures agree with TypeScript inference, including the legal-operator softmax and cached task encoding. This is not an export or masking failure: downstream search still gives **220/330 library solves versus 222/330** with the old policy, and **190/330 base solves versus 193/330**. Longer calibration solves change 3→5/30, with no reliable broader gain. The original policy remains selected. The new dataset records teacher subprogram exposure, which must also be excluded if a later experiment promotes this model; the older strict-pilot exclusions are insufficient for it.

A separate population audit found that retaining the incumbent while randomly sampling most new libraries did not guarantee its useful extensions were tested. `population.ts` now reserves every single addition to the incumbent before filling remaining slots with additions, replacements, deletions and crossover. This changes the proposal process, not the confirmation threshold or final labels. New calibration and fresh selection are required before attributing any improvement to it.

Training-only extension calibration now explicitly compares every unary addition to the incumbent. Clamp reaches the shortlist, but on the next 28 training tasks × three seeds it solves 62–64/84 versus 66/84 for the incumbent. Generic monotone-only inverse semantics do not materially change that outcome; they remain optional. The proposal gap was real, but fixing it has not yet yielded another accepted concept.

Increasing the structural-search cap from 4,096 to 65,536 operations (with depth raised from three to five and the complete-proposal cap held at 512) changes the calibration library result only 222→223/330. Longer solves stay 3/30. The intermediate setting regresses. `inverse-depth-calibration-v1.json` records the cost/coverage tradeoff; these are adaptive diagnostics and wall timing shared the machine with routine checks. More depth/compute alone is not an effective fix.

## Specification ambiguity and rejected solver alternatives

The nested calibration exposes an observation problem separately from search: with 25 supplied I/O pairs, the guided inverse/library arm fits 25/30 trials exactly, but only 9/30 pass the independent checks. Increasing search depth cannot distinguish functions that agree on all supplied examples.

An opt-in protocol now preserves those original 25 pairs and supplies additional independent inputs to both arms. Checks remain hidden. With 50 extra pairs, the same adaptive calibration changes base solves **193→209/330** and library solves **222→244/330**; nested library solves change **9→16/30**, and fitted nested programs now agree with checks. With 150 extra pairs, library solves reach 256/330, still only 3/30 longer solves. This supplies more information and increases point-evaluation cost: it is **not an algorithmic gain at the old observation budget**. Task identities/signatures stay unchanged. These adaptive results are in `inverse-observation-calibration-v1.json`.

Increasing the fragment bank and additive-join budget helps only slightly: on the 60 structural calibration trials with 75 observations, the largest tested configuration changes library solves 19→23, including longer 3→6/30, while spending roughly an order of magnitude more structural work. It remains disabled.

`parametric.ts` and `parametric-search.ts` test joint fitting of bounded integer affine arguments inside evolving program structures. Automatic derivatives and damped linear-system steps operate on the actual DSL body; there are no hidden-concept templates. Every floating or rounded fitting execution is charged against the program budget, and derivative/linear-algebra work and wall time are separate. Derivatives, expanded execution and check isolation have independent tests. At 2,048 executions on the 50-task adaptive sample, base/library solve **30/27**; simultaneous two-production mutations give **27/26**. Both variants solve zero longer tasks. They are retained but **not promoted**.

A separate optional Python prototype uses [Z3](https://github.com/Z3Prover/z3) for bounded piecewise-affine circuits. Both arms receive affine leaves and exclude interior nonlinear products; this is a restricted synthesis heuristic, not the full base grammar. It incrementally adds counterexamples from the supplied observations only, records solver calls/statistics, and evaluates independent checks after returning a program. The seven-task pilot at a nominal three-second task cap solves **1/7 in both arms**. Encoding time is included in measured wall time; the timeout is soft because construction cannot be interrupted inside a stage. Solver effort is not disguised as a single cheap program evaluation. This prototype is also unpromoted.

Reproduce the optional constraint diagnostic with `python3 -m venv .venv-research`, `.venv-research/bin/python -m pip install -r requirements-smt.txt`, then `.venv-research/bin/python scripts/constraint-synthesis.py --input output/joint/constraint-input-v1.json --output <new-output-path>`. Existing artifacts are never overwritten. None of these alternatives supplies new final evidence for DSL transfer.

## Fourth fresh pilot: a third abstraction, with mixed transfer

V4 supplies **75 observations** to every task in every arm. It evaluates 512 libraries, explicitly including additions to the incumbent, through 12-task screening, 32-task medium races and 56-task full development races. It freezes the winning library and shared policy before 80 confirmation tasks and 200 final tasks × three optimizer seeds. All v1–v3 task functions, prior/dream functions and the structural calibration sample are excluded by the same 97-probe signature audit. This remains one training lineage, not independent meta-training replication.

Selection adds `fn_56758583(a,b) = max(a + min(b,1), a)` to magnitude and positive-part. Algebraically, this is `a + clamp01(b)`; the concept name is an interpretation after selection. The proposal came from synthesized training programs. It passes independent confirmation with work-utility gain 25.30 pp and the predeclared lower-bound estimate 18.42 pp before complexity penalty.

| V4 final arm                 | Solved / 600 | Work-curve AUC | Search work | Wall time |
| ---------------------------- | -----------: | -------------: | ----------: | --------: |
| Base, uniform                |          110 |         10.78% |   2,238,374 |    8.60 s |
| Learned library, uniform     |          253 |         31.36% |   1,761,392 |    7.53 s |
| Base, shared frozen policy   |          201 |         22.95% |   1,929,917 |    8.06 s |
| Learned library, same policy |          313 |         37.62% |   1,607,515 |    6.88 s |

The guided solve-rate gain is **18.67 pp [13.0, 24.17]** and work-AUC gain **14.67 pp [10.64, 18.67]**, using descriptive task-cluster bootstrap intervals. Invented functions occur in 308/313 successful learned-library trials. Removing all macros gives the matched base/shared-policy arm.

Transfer is mixed: related solves improve 123→228/360; nested declines **78→71/120**, a difference of −5.83 pp [−15.0, 2.5]; longer improves **0→14/120**, +11.67 pp [3.33, 21.67]. This is the first pilot with a positive longer-composition interval, but it does not establish uniform structural improvement or robustness across independently learned languages. V4 changes both selection and observation protocol, so its score cannot be treated as a causal improvement over v3.

Complete proposals again increase (about 83 per task) while structural work and measured time decrease. The cumulative accounting projects **76,937 future tasks** for search-work payback and a lower-bound **70,802 tasks** for recorded wall costs; neither is observed amortization. These conservative projections include shared prior costs, even in the comparison where both arms use that same prior. A future accounting should separate shared pretraining from incremental language-discovery costs, while still displaying both. Earlier research/calibration overhead is not fully charged by these estimates. No surrogate compute savings or off-road transfer have been demonstrated.

## Replication and search-cost models

`REPLICATION_PROTOCOL.md` predeclares 20 language-training runs starting from empty libraries, conditional on the same frozen pretrained policy. The runner was committed before evaluation; `protocol.json` recorded the policy and source hashes before the first run. Each run re-solves training tasks and evolves the library over three generations. All 20 predeclared runs have now finished; `output/joint/replication-v1/analysis.json` verifies the frozen protocol, budgets and splits before aggregating them. Completed compressed reports and frozen candidates are retained. Some later wall measurements share the 15-logical-CPU host with separate model experiments; `host-load-events.json` records that. Evaluation/work budgets and result trajectories remain unchanged by host load, and wall times are observational rather than controlled CPU benchmarks.

A prepared outer value-model pipeline uses only development-race utility differences against the paired base library. Its inputs are name-free pooled operator semantics, structural costs, training-corpus support and budget metadata. Seeds 0–11 train, 12–15 validate, and 16–18/42 test ranking. No confirmation or final-test outcomes become labels. The scripts refuse to build the dataset before every predeclared run finishes. This is initially an offline ranking test, with **zero claimed saved compute**; prospective selection must follow separately.

The next inner-search experiment targets operand selection rather than only production probabilities. [BUSTLE](https://research.google/pubs/bustle-bottom-up-program-synthesis-through-learning-guided-exploration/) learns to prioritize executed intermediate programs; [CrossBeam](https://research.google/pubs/crossbeam-learning-to-search-in-bottom-up-program-synthesis/) learns how to combine previously explored programs. These motivate the experiment, not a claim that this implementation reproduces either paper.

The executed-fragment classifier trains on 79,762 task/subprogram examples derived from synthesized programs and executed dreams, with random and output-close negatives. It sees all 75 observation positions and aggregate behavior. Whole-function empirical signatures group validation; exported inference matches independent PyTorch fixtures. Its held-out teacher accuracy reaches roughly 92–93%, but labels describe one sampled decomposition, not every possible useful subprogram. It is a soft ranking heuristic, never a sound pruning rule.

The isolated `research/fragment-ranking` worktree tests that classifier without changing the running replication. On the adaptive 330-trial calibration with the v4 library, original search solves 241; pure learned ranking solves 257; balanced ranking plus operand guidance solves 258. The latter's wall time increases from about 2.68 to 3.05 seconds. Nested solves stay 17/30 and longer regress 3→0/30. Thus the classifier improves related-task coverage but does **not** solve the structural bottleneck and is **not promoted**. The base-language result stays 209/330. The first artifact records neural overhead through wall time; subsequent instrumentation separately counts fragment predictions, feature pairs and matrix multiplications, which must not be treated as free structural operations.

## Completed 20-run replication

Every run starts with an empty symbolic library and independently drawn language-training tasks and optimizer seeds. All 20 pass the unchanged fresh confirmation rule and improve final work-AUC. They share **one frozen pretrained neural policy**; this is conditional language-learning replication, not independent neural pretraining or a new domain.

| Final arm                    | Solved / 12,000 | Recorded search work | Complete proposals |
| ---------------------------- | --------------: | -------------------: | -----------------: |
| Base, uniform                |           1,860 |           45,697,503 |            568,892 |
| Learned library, uniform     |           5,217 |           34,520,746 |          1,353,341 |
| Base, frozen policy          |           3,736 |           39,165,607 |            644,451 |
| Learned library, same policy |           6,254 |           31,251,746 |          1,371,977 |

Across meta-seeds, the matched-policy solve gain is **20.98 pp [19.81, 22.04]**, and work-AUC gain **17.10 pp [15.80, 18.26]**. The neural prior itself improves base solve rate by **15.63 pp [14.72, 16.53]**. Invented primitives appear in **5,946/6,254** successful learned-language trials. The base/shared-policy comparison removes all macros while retaining the same weights; the uniform arms independently support a language benefit.

The held-out distribution contains 4,000 task instances and **3,879 empirically distinct functions**; 113 functions recur across independently drawn runs. Each task has three optimizer repetitions. Intervals bootstrap meta-seed means and are conditional on this task distribution, shared policy and empirical exposure exclusions. They do not establish formal functional disjointness or universality.

Structural transfer remains mixed. Longer solves improve **7.83 pp [6.04, 9.62]**, while nested solves change **−0.58 pp [−1.71, 0.50]**. Consequently, the predeclared broad structural gate fails. The result supports useful scalar abstraction discovery and longer-composition transfer, not every remaining gate.

Across all 20 independent discoveries, cost is **21,954,267 complete proposals + 433,402,802 structural operations**, with 1,899.8 seconds of recorded incremental discovery time. These are heterogeneous counters, not interchangeable CPU instructions. Mean per-task search work falls by 659.5 units, but complete proposals rise by 60.6. Median per-run incremental payback extrapolates to **32,821 future searches** (range 26,458–56,672), or about 37,003 using observational wall means. No downstream stream has yet repaid discovery cost. Historical R&D and shared neural pretraining remain additional costs; the latter cancels only in a matched-prior comparison.

The completed replication supplies **16,256 development-race labels** for the separately frozen outer value-model experiment. Meta-seeds 0–11 train, 12–15 validate, and 16–18/42 test ranking. Neither confirmation nor final outcomes become value labels. A separate prospective protocol commits shortlist rankings before measuring candidate synthesis; exhaustive reference auditing is charged as research cost.

The trained 64-unit semantic value model has 9,757 training rows, 3,251 validation rows and 3,248 held-out rows. On the twelve held-out **full screening pools**, top-five mean regret is 0.0180 versus 0.0286 for the compression proxy and 0.1205 for random selection. At top ten, compression is better (0.0114 versus the model's 0.0140); at top 32 it is also better. Thus the model helps very small shortlists but does not dominate the cheap heuristic. These are reused exhaustive labels and establish no compute saving. `language-value-prospective.ts` predeclares eight fresh corpus/population states and freezes model/compression/random shortlists before measuring them, with a separately charged exhaustive reference audit and fresh winner confirmation.

## Prospective outer-value selection: eight fresh populations

The frozen value model is now tested **before candidate labels exist** on eight predeclared fresh training states (101, 107, 113, 127, 131, 139, 149, 157). Each synthesizes a fresh 128-task corpus, proposes 256 languages, seals all model/compression/random rankings, evaluates sixteen candidates plus the base language, and selects by measured screening utility. The exhaustive reference evaluates all 256 on the same screening tasks. Winners freeze before 80 new confirmation functions × two optimizer seeds. Neither rankings nor winners update from confirmation.

| Selection policy     | Screening queries, total | Screening work | Confirmation passes / 8 | Confirmation solves / 1,280 |
| -------------------- | -----------------------: | -------------: | ----------------------: | --------------------------: |
| Frozen value model   |                      136 |      3,206,900 |                       7 |                         568 |
| Compression proxy    |                      136 |      3,265,452 |                       2 |                         476 |
| Random               |                      136 |      3,326,545 |                       4 |                         445 |
| Exhaustive reference |                    2,048 |     50,450,668 |                       7 |                         575 |

The same base language solves 356/1,280. Model selection improves fresh utility by **11.75 pp [8.82, 14.83]** over base and by **6.43 pp [3.01, 10.14]** over compression. Against exhaustive selection, its difference is **+0.22 pp [−0.37, 0.99]**. These are descriptive meta-seed bootstrap intervals; no noninferiority margin was predeclared, so the result does not formally prove equal quality.

Screening uses **15.1× fewer language queries** and **15.7× less recorded screening work** for the model strategy. This is a measured strategy comparison, not an end-to-end savings claim: the study actually executed the complete reference audit, all common corpus synthesis and winner confirmation, and previously paid for 16,256 value labels. The report separately records the complete experiment cost and the conservative 455.4M-work source-discovery investment. Shared inner-policy training and earlier R&D are also additional costs. Global amortization remains unobserved.

This is the first prospective evidence here that a learned selector can reduce expensive language evaluations while retaining useful candidates. It covers **one generation** with a small eight-state sample, conditional on one frozen model and prior. The next test must run the full multi-generation learner with selective evaluation and compare its complete discovery cost and frozen final performance. Raw rankings, frozen winners, all labels and audited analysis are in `output/joint/language-value-prospective-v1/`.

## Full selective evolution: four paired meta-seeds

The predeclared `SELECTIVE_PROTOCOL.md` experiment completes all twelve runs: full, compression and value selection on four identical task/seed suites. Every run starts empty, alternates wake synthesis with language selection for three generations, and freezes before confirmation and four-arm final testing. All twelve candidates pass confirmation. An audit verifies that baseline program trajectories are identical across selectors, excluding elapsed time; subsequent learned languages/corpora are allowed to diverge.

| Outer selector     | Final learned/prior solves / 2,400 | Complete incremental discovery work | Recorded discovery time |
| ------------------ | ---------------------------------: | ----------------------------------: | ----------------------: |
| Full population    |                              1,200 |                          76,865,098 |                 310.7 s |
| Frozen value model |                              1,245 |                          28,752,543 |                 124.7 s |
| Compression proxy  |                                969 |                          33,551,897 |                 139.7 s |

Value selection uses **2.68× less discovery work on average across paired seeds [2.55, 2.89]**, now including corpus synthesis, all selection stages and confirmation. Its final solve-rate difference against full selection is **+1.88 pp [0, 3.75]**, while work-AUC differs by **+1.13 pp [−0.41, 3.82]**. These four-seed descriptive intervals do not prove equal utility or broad robustness. The pre-existing 20-seed result establishes the restricted language benefit; this smaller experiment studies the cost of selecting it.

The value arm's projected incremental language payback is 9,385–13,505 future searches (median 10,427), versus 24,821–44,956 for full selection. Those projections assume the already-trained value model exists. Its conservative **455.4M-work source-label investment**, model fitting and shared inner-policy training remain additional costs. The observed discovery-work saving would project repayment of that source investment after roughly 38 comparable language-learning runs; this is also an extrapolation. Neither language nor value-model payback has been observed in a downstream stream.

Nested transfer still fails the broad gate: the value arm's aggregate nested count is one solve below its base arm across 480 trials, while longer improves. This pipeline is therefore useful bounded library learning with promising selective evaluation, not a complete solution to general language discovery. `output/joint/selective-evolution-v1/analysis.json` contains paired quality/cost differences, each frozen library and group, raw rejected-policy handling, and all accounting. Some timings shared the host with independent neural-policy experiments; `host-load-events.json` records that.

## Sealed downstream stream: observed incremental work payback

`downstream-stream.ts` predeclares the first selective/value meta-run (211), rather than choosing the best language after inspecting future performance. All **20,000 tasks** are generated and cryptographically sealed before any stream search. Functions are empirically distinct across the stream, excluded from historical training/selection/confirmation/testing and prior exposure, and shuffled within fixed 500-task batches. Both arms use the original frozen solver, the same neural weights, identical search seeds and equal caps. Execution order alternates; learning remains disabled. The entire 40-batch horizon is retained, including failures after the first cost crossing.

| Stream arm | Solved / 20,000 | Search work | Complete proposals |
| --- | ---: | ---: | ---: |
| Base DSL, frozen prior | 5,863 | 66,258,403 | 1,035,921 |
| Learned DSL, same prior | 10,238 | 52,366,804 | 2,250,200 |

The selected language cost **6,448,868 work units** to discover, including wake synthesis, selection and confirmation. Its cumulative search savings first cover that incremental investment at **task 8,944**. After the complete stream, language discovery plus learned search costs 58,815,672 versus 66,258,403 for the base arm: a net saving of **7,442,731 recorded work units**. This is an observed conditional amortization result for one preselected language, not another 20-language replication or a universal guarantee. The extra **455,357,069-work source investment** in the shared outer value model, its fitting, inner-policy pretraining and historical R&D are additional; the stream has not repaid all of those. Complete proposal count increases, so this is not a candidate-evaluation speedup claim.

Related solves improve 3,242→7,361/12,000 and longer 180→459/4,000. Nested changes 2,441→2,418/4,000. That repeated negative result still prevents a broad structural-transfer claim. The stream's exclusion-conditioned finite task distribution also differs from an unrestricted draw from the original generator.

**Wall-clock payback is unassessable.** One base search at zero-based index 1,215 records an unexplained 52,704,466.9 ms elapsed-time jump, whereas the other searches are short. Raw timings and that row remain intact. The report flags the anomaly and does not remove it, winsorize durations or use the resulting artificial wall crossing as evidence. Later batches also share the host with independent inner-search confirmation. The execution audit rechecks every returned program on all supplied and hidden examples and replays selected searches, including the anomalous trial, against exact program/evaluation/expansion counters. Audit expense is separate research work.

`output/joint/downstream-stream-v1/` retains the protocol, all sealed tasks, every trial/program, the complete cumulative curve and audit. The successful main engine was unchanged throughout this experiment.

### Post-search component audit and broader construction (experimental branch)

`fragment-coverage-v1.json` audits the existing adaptive nested/longer sample against one known generating expression, **only after synthesis returns**. A separate auditor mirror must exactly reproduce all 80 task signatures and supplied/check outputs before diagnosis; no oracle expression enters search. It checks empirical equivalence of known components to executed fragments. In the 27 failed learned-language longer trials, none has all three known nonlinear terms in the bank. The first/second/third terms are present in only 4/5/13 trials. In 13 failed nested trials, only one contains both the known inner transform and other affine operand; that pair never both survives the active-bank cutoff. These are findings about one decomposition, not proof that it is necessary for every solution.

`fragment-construction-v1.json` tries generic bounded-integer affine enumeration, different forward allocation, unary inverse semantics and wider additive joins. All complete proposals are charged, but coefficient-grid ordering overhead is additionally captured only by wall time. Every added configuration regresses overall learned-language solves from 241/330 to 219–233/330; none improves longer solves. The extra components consume budget without solving composition. These flags remain disabled and are not part of the main replication. Search needs better targeted component construction/composition, not just a larger undirected bank.

### Additional composition heuristics remain unpromoted

Residual-directed fragment construction fits candidate affine pieces to the current hole specification, applies legal DSL productions, and tests compositions without seeing hidden target syntax. At the matched calibration budget it regresses the learned-library result to 194–200/330 (241 baseline); a larger work budget reaches only 206. A sparse beam-pursuit alternative fits integer linear combinations of executed fragments, charging candidate executions, fitting steps and point arithmetic. Width four reaches 249/330 but nested falls 17→15/30 and longer changes only 3→4/30. Undirected affine expansion combined with it regresses further. These do not solve structural transfer.

An independent scheduler reserves an explicit fraction of the same structural budget for early unary-macro inversion, using exact semantics derived from definitions. Matched-budget variants reach 233–239/330, versus 241; doubling the structural allowance reaches 248, including nested 19/30, but has substantially higher work and wall cost. It is not a matched-compute improvement. `residual-construction-v1.json`, `sparse-construction-v1.json` and `unary-scheduling-v1.json` retain every tested configuration. None changes the successful main benchmark.

### Full-observation neural policy: still not promoted

The previous operator policy sees the first 25 task outputs and the first 25 hole constraints, even when the inverse solver has 75 observations. The `neural-full-v1` experiment supplies all 75 input/output triples and all 75 disjoint hole domains, alongside existing partial-program/DSL features (671 context features total). A 128-unit model trains on 85,780 executed teacher decisions. Empirical whole-function signatures group training/validation across both base/library representations; legal-production masks remain enforced. Binary float32 features occupy 18.8 MB compressed, with generation/semantic-execution accounting and teacher subprogram exposure retained.

Teacher validation accuracy reaches about **66.6%**, but the downstream adaptive result is **240/330 versus 241/330** with the old policy. Nested changes 17→15/30, longer 3→5/30; base solves regress 209→206/330. Enabling unary inverse relations reduces library solves further to 231–232. A wider model and complete observations do not establish better search. The policy is unpromoted. Export checks use independent double-precision PyTorch fixtures with original semantic probes; an earlier float32-semantic fixture mismatch is retained separately, and correcting the fixture changed no weights.

Caching repeated partial-application symbolic derivations preserves the current calibration solve count (241/330) while reducing recorded structural work 621,859→601,715. Every observation is still semantically checked. The cache has an independent equivalence/accounting test; it is optional and has not changed the frozen main studies. This is a small execution optimization, not a solution to nested transfer.

### Visited-state value models: cheaper inference, limited structural benefit

`neural-visited-v1` labels 43,211 states visited by actual synthesis on 2,719 synthesized training functions and executed dreams. A positive label means a known teacher subtree satisfies the current hole specification. Missing witnesses are weak negatives, not evidence of impossibility. The critic ranks branches and never soundly prunes them. Whole-function signatures group training and validation; all exposed roots and subtrees are retained for exclusion from any future evaluation. No final task labels train the model.

A 64-unit neural critic changes adaptive library solves **241→252/330**, but wall time rises about 2.67→4.18 seconds. The first dataset omits states completed by quick fragment/affine checks. A second dataset records states on solver entry, including those quick successes: **414,283 states / 16,926 positive witnesses**. Each dataset costs 323,821 program evaluations plus 11,197,979 structural operations, with witness execution, feature probes and grouping recorded separately. This additional training work is not free.

Depth-eight trees and 16-tree forests provide cheaper inference. Lazy extraction computes only requested feature coordinates, and reproduces every eager-inference program, solve outcome and structural counter on all 3,300 calibration trials. Independent sklearn/PyTorch fixtures, disjoint-domain feature equivalence, hidden-check isolation and budget tests pass. `criticFeatures` in these calibration artifacts counts feature-coordinate requests (with per-candidate memoization), not every arithmetic operation in a shared context computation; tree comparisons, neural multiplications and wall times are also recorded.

The entry-state forest with weight one gives **251/330**, including nested **18/30 versus 17/30** and longer **4/30 versus 3/30**. Base solves remain 209/330. Recorded library wall time is effectively unchanged (2.73 seconds in both arms); timings are sequential observational measurements, not a controlled speed claim. These small structural changes are adaptive calibration findings, not fresh confirmation. All critic variants remain optional and **unpromoted**. High weak-label classification accuracy has again failed to produce a substantial nested-composition improvement.

### Component construction and an explicit oracle-library diagnostic

Hole-local regression over finite inverse-domain endpoints (`specification-fragments-v1`) regresses learned-library coverage to 217–223/330. Prioritizing constant macro arguments (`literal-bindings-v1`) gives 244, with no nested improvement. Both remain optional. Bounded affine memoization yields identical work/outcomes on this sample; cache identities retain exact endpoint values and interrupted inferences are not cached as failures.

`ideal-library-diagnostic-v1` deliberately supplies a hand-written three-function library (magnitude, positive-part, clamp). **This is a capacity diagnostic, never language-discovery evidence or selection data.** Default synthesis solves 252/330, with nested still 17/30; inverse relations reach 19/30. Therefore choosing those three concepts alone would not resolve the remaining composition failures.

`local-geometry-v1` samples three of every four regression triples from nearby input points. It uses only supplied I/O; neighborhood rows, distance arithmetic and subsequent candidate executions are recorded. Six-neighbor regression improves learned-library coverage 241→255/330, but nested stays 17/30 and longer 3/30. Twelve neighbors plus generic inverse relations gives 253/330, including nested 20/30 and longer 2/30 (`ideal-library-local-v2`). These remain adaptive diagnostics.

`lattice.ts` tests a generic min/max-cover construction over inferred affine pieces, motivated by the [max–min representation of piecewise-linear functions](https://arxiv.org/abs/math/0009026). Our finite-sample greedy cover is a heuristic, not a complete implementation of a representation theorem or a generalization proof. It emits ordinary base-language expressions and charges executed candidates and cover comparisons. Both language arms receive identical capabilities. With local regression it reaches **263/330 learned-library solves** and **239/330 base solves** in the best respective tested settings; base nested coverage can exceed learned coverage. This strengthens scalar synthesis without establishing improved language transfer. Some fitted expressions fail independent checks, particularly longer cases; checks never steer synthesis. Tests verify emitted execution, work caps and hidden-check isolation. Runs shared the host with other checks, so wall times are observational.

All these diagnostics use the repeatedly inspected calibration suite. A larger fresh development cohort and a new frozen final protocol are required before promoting any variant. None changes the completed main replication or its conclusions.

### Fresh inner-search development and independent confirmation

`inner-fresh-development-v1` predeclares six variants on 500 new functions × two search seeds × three fixed languages (base, v4 pilot, replication seed 7). Empirical exclusions cover previous task suites, shared prior roots/subtrees and critic exposures. It selects by work-AUC averaged equally across structural groups and languages, with inference/point costs recorded separately. The winning local-six-neighbor regression plus lattice cover gives **1,689/3,000 versus 1,338/3,000** original solves. The forest critic ranks below this simpler composition method.

That one variant is then frozen before `inner-fresh-confirmation-v1`, another 500 functions with the development functions additionally excluded. It passes the predeclared rule: **1,664/3,000 versus 1,315/3,000**, balanced work-AUC gain **8.08 pp [6.26, 10.06]**, positive mean utility change in every group and each of the three languages. Structural work falls **8,576,559→7,305,459**; observed runtime falls 36.9→30.0 seconds, while separately counted point operations rise **1.76M→85.15M**. These heterogeneous counters are not CPU instructions. Some confirmation overlaps the independent downstream stream, so timing is observational.

Compared with the original solver, average solve-rate changes across the frozen languages are related +14.56 pp, nested +4.83 pp, longer +9.67 pp. However, this is **stronger inner synthesis**, not new evidence that learned DSLs beat base DSLs on nested tasks. In the new solver, nested solves are base 133/200, v4 library 124/200, replication-7 library 135/200. The next step is to rerun language evolution from empty libraries using this independently confirmed solver, freeze those languages, and measure new final tasks. The earlier experimental flags remain optional; the selected configuration requires only `localAffineNeighbors: 6` and `lattice: true` in addition to the existing settings.

## Eight fresh language evolutions with the stronger solver

All eight predeclared runs in `LATTICE_PROTOCOL.md` finish, accept nontrivial languages and improve final work-AUC. They start empty and use full population evaluation, without the outer value model. Final paired guided solves are **3,072/4,800 versus 2,055/4,800**, a **21.19 pp gain [18.23, 24.06]** across meta-seeds. Work-AUC gains **13.43 pp [11.28, 15.39]**. Uniform arms independently improve **1,795→2,783/4,800**; the frozen neural prior also has a positive aggregate benefit.

Process CPU is measured separately for every call. Final guided base search takes **53.26 CPU seconds**, learned search **43.68**, with mean paired saving **1.995 ms [1.447, 2.441]** per task. Complete proposals still increase by about 39.5 per task. Discovery costs **152,969,628 recorded work units / 633.99 process CPU seconds** across eight independent runs. Median per-run projected CPU payback is **36,670 future searches**; this projection is distinct from the observed original-solver stream. No outer-value training investment is required for this full-population version, but shared inner-policy training and historical R&D remain additional.

Longer solves improve **8.33 pp [5.52, 11.15]**. Nested changes **+0.94 pp [−1.25, 3.12]**, so the broad structural gate still fails. Stronger inner synthesis has not by itself solved every transfer issue. `concept-audit.json` separately classifies unary proposed/selected functions by piecewise-affine semantics, distinguishing direct matches from explicit input sign/offset substitutions. Those labels are generated only after completed runs and never enter learning or selection. Runs repeatedly recover magnitude, positive-part and clamp variants; eight runs remain a pilot conditional on the same shared prior.

### Visited-state production policy: small adaptive gain, not promoted

`neural-visited-policy-v1` reuses actual visited decision states from the earlier training-only dataset. It trains a semantic operator scorer to put probability mass on productions with known compatible teacher witnesses; states without a witness are omitted rather than labeled impossible. Sampling balances source programs. Independent double-precision inference fixtures agree with the existing runtime.

On the adaptive calibration, with the newly confirmed geometry/lattice solver, the policy changes base solves 235→238/330, v4 library 263→264, and replication-7 library 280→281. Enabling generic inverse relations reaches 265 and 283 for the two libraries, while base remains 238. Nested gains are small and not uniquely attributable to language learning. These are calibration results, not fresh confirmation, and the policy is **not promoted**. None of its weights entered the eight-run study above.

### Affine search and scheduling diagnostics after the eight-run study

`affine-allocation-v1`, `branch-allocation-v1`, `affine-voting-v1/v2`, and `lattice-order-v1` retain all adaptive trials on the old 110-function calibration suite (three optimizer repetitions, three frozen libraries). These are **not fresh evidence**. The frozen eight-run results above are unchanged.

- Ordering bounded slopes by coefficient size and eliminating a coefficient from two exact constraints preserves most calibration solves and reduces some work. A 32-fit per-hole cap regresses; 64 fits is less disruptive. Combining the 64 cap with the visited-state production policy and executable unary relations improves the replication-7 library's nested solves from 18 to 22/30 in calibration.
- Root branch sharing and exact child-constraint deduplication give small, inconsistent gains. No broad search improvement is established.
- Exhaustive bounded-slope/intercept voting initially floods the bank with weak fits: both learned arms collapse to 159/330. Requiring three non-collinear supporting inputs addresses that failure. Base coverage becomes 261/330 versus the local-regression baseline's 235; the two learned libraries reach 266 and 279 versus 263 and 280. Base benefits most. All integer bounds are existing scalar-search assumptions; voting is an engineered search heuristic, **not a discovered language concept**.
- Moving min/max-cover construction after legal unary or macro forward applications does not improve coverage and generally adds work. Removing cover construction is worse. Those failures remain in the artifacts.

Every returned affine fragment is executed through the normal charged evaluator. Coefficient derivations, constraint propagation and point arithmetic are separately recorded; process CPU and wall time are also preserved. Unit tests compare two-equality elimination and intercept voting against exhaustive coefficient enumeration, check independent-input support, preserve global budgets, and verify that final-check outputs do not guide search.

A new `inner-refinement-development-v1` protocol freezes six variants, 500 new functions, two paired optimizer repetitions and three previously fixed languages before results. It excludes the old inner suites, all eight recent language runs, the 20,000-task stream, historical tasks and pretrained-policy exposures. Selection uses balanced work-AUC across structural groups and libraries, not which variant makes a language advantage look largest. A selected variant requires separate fresh confirmation. The source hashes and sealed tasks are retained alongside results; this is a solver experiment, not another claim of successful language evolution.
