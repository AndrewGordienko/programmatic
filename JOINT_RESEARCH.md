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

On the **40 previously unused development tasks × three seeds**, the larger policy gets **33/120 solves**, versus **16/120 uniform** and **17/120 legacy**. It uses 96,418 program evaluations versus 111,567 uniform, but takes 6.26 seconds versus 2.30 seconds uniform and 0.63 seconds legacy on this machine. Therefore this is not a wall-clock efficiency win or a final Gate 3 result. Task conditioning is cached without changing probabilities; inference and search overhead still matter. There has been no new expensive outer-language run or final test using this policy.

The interval experiment has a separate bound-check counter and charges checks to the partial-work cap. It is preserved, not enabled by default. Case-wise parent selection retains distinct error behavior among up to 64 candidates instead of keeping only the best mean-error variants.

### Proposal recall and alias audit

`scripts/proposal-recall.ts` keeps ground-truth abs/positive-part/clamp functions **only in a diagnostic**. Neither proposal generation nor selection imports those labels. It finds that useful concepts sometimes exist before selection: original seed 0 proposes all three; seed 7 proposes positive-part and clamp equivalents; seed 42 proposes magnitude but loses a mined positive-part candidate during random language generation. Several definitions are unnecessarily bloated.

The opt-in normalized proposal mode adds algebraic constant folding, identity/cancellation and min/max absorption/bound simplification; it rejects base-production aliases using 272 semantic probes. It preserves mined singletons and some mined pairs before filling the population with mutations. After normalization, seed 0 proposes compact equivalents of all three concepts and seed 42 preserves magnitude and positive-part. Seed 7 still proposes none. Thus both proposal coverage and selection need improvement; normalization alone has not solved discovery. Probe-based equivalence checks remain empirical.

Artifacts: `output/joint/semantic-calibration.json`, `evolution-calibration.json`, `proposal-recall*.json`, and `output/joint/neural/`. Reproduction scripts are named after those experiments; neural training uses the locally installed PyTorch 2.10.0 on CPU and exports ordinary JSON weights. These additional training costs have not been amortized. The next target is stronger executable/inverse guidance at holes, with fresh validation and explicit work accounting.
