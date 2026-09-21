# Inner synthesis calibration checkpoint

This checkpoint prioritizes the requested live 3D synthesis race and hill-physics correction. Prospective surrogate selection and adaptive racing are not implemented yet; the existing value-model result remains an offline ranking probe with zero measured compute savings.

Two attempts to improve scalar inner search were tested on training data only, before any prospective evaluation:

- A semantic fragment bank with bottom-up combinations and lexicase-style parent selection.
- Replaying previously synthesized training programs, followed by targeted leaf mutation and the existing genetic search. All replay proposals are charged against the inner budget.

Both use the same task-conditioned prior as the original search. The new task suite uses seed 911327 and empirically excludes every signature in the original 800-task suite. Its first 100 training tasks supply a bootstrap corpus; the next 80 training tasks are calibration cases, with optimizer seeds 0, 7, 42 and a 1,536-proposal cap. No development or final-test result is used here.

| Inner search                  | Solved / 240 trials | Capped effort | Search wall time |
| ----------------------------- | ------------------: | ------------: | ---------------: |
| Original genetic search       |                   9 |       361,815 |           2.17 s |
| Semantic fragment bank        |                   2 |       367,622 |           4.63 s |
| Corpus replay + leaf mutation |                   8 |       362,971 |           2.36 s |

Neither variant improved this calibration, so neither replaces the production search. This is a negative exploratory result, not a held-out evaluation or evidence that replay generally cannot help. Raw per-task records, programs, errors, budgets and timings are in `output/prospective/inner-calibration.json`. Reproduce with `npm run inner:calibration`.
