import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import { inventions } from "../src/joint/inventions";
import { evalExpr, exprSize } from "../src/dsl/expressions";
import { Random } from "../src/engine/random";
import type { JointPolicy } from "../src/joint/policy";
import type { CorpusEntry } from "../src/dsl/types";
const out = "output/joint/inverse-corpus-v4.json";
if (existsSync(out)) throw new Error("Preserve corpus");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const start = performance.now();
const rows = suite.training.flatMap((task, i) =>
  [0, 7, 42].map((seed) => ({
    task: task.id,
    seed,
    result: inverseSearch(task, [], policy, seed + i * 97, 512),
  })),
);
const corpus: CorpusEntry[] = [];
for (const task of suite.training) {
  const best = rows
    .filter((r) => r.task === task.id && r.result.solved)
    .sort((a, b) => exprSize(a.result.tree) - exprSize(b.result.tree))[0];
  if (best) corpus.push({ task, tree: best.result.tree });
}
const proposed = inventions(corpus);
const discoveryMs = performance.now() - start;
// Oracle names occur only AFTER proposal generation in this diagnostic. They
// never enter proposal ranking or selection.
const rng = new Random(7723),
  probes = [
    -10,
    -4,
    -1,
    -0.5,
    0,
    0.25,
    0.5,
    1,
    2,
    4,
    10,
    ...Array.from({ length: 200 }, () => rng.next() * 20 - 10),
  ];
const concepts = {
  magnitude: (x: number) => Math.abs(x),
  positivePart: (x: number) => Math.max(0, x),
  unitClamp: (x: number) => Math.max(0, Math.min(1, x)),
};
const matches = Object.fromEntries(
  Object.entries(concepts).map(([name, f]) => [
    name,
    proposed
      .filter(
        ({ macro: m }) =>
          m.arity === 1 &&
          probes.every((x) => Math.abs(evalExpr(m.body, [x]) - f(x)) < 1e-8),
      )
      .map((r) => ({
        definition: r.macro.definition,
        support: r.macro.support,
        compression: r.compression,
      })),
  ]),
);
const summary = {
  solvedTasks: corpus.length,
  trainingTasks: suite.training.length,
  solvedTrials: rows.filter((r) => r.result.solved).length,
  trials: rows.length,
  evaluations: rows.reduce((s, r) => s + r.result.evaluations, 0),
  expansions: rows.reduce((s, r) => s + r.result.expansions, 0),
  proposed: proposed.length,
  discoveryMs,
  matches,
};
writeFileSync(
  out,
  JSON.stringify({
    version: "inverse-corpus-v4",
    note: "Training-only corpus and proposal diagnostic, not evidence of fresh search utility. Ground-truth names used only for post-hoc recall report.",
    summary,
    corpus,
    proposed,
    rows,
  }),
);
console.log(summary);
