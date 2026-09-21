import { writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { synthesize } from "../src/dsl/search";
import type { CorpusEntry } from "../src/dsl/types";
import { fitJoint } from "../src/joint/policy";
import { search } from "../src/joint/search";
const out = "output/joint/evolution-calibration.json";
if (existsSync(out))
  throw new Error("Preserve existing calibration; version the next attempt");
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const corpus: CorpusEntry[] = [];
for (let i = 0; i < 100; i++) {
  const task = suite.training[i],
    r = synthesize(task, [], undefined, i * 97, 1536);
  if (r.solved) corpus.push({ task, tree: r.tree });
}
const policy = fitJoint(corpus, [], 501);
const rows = suite.training
  .slice(100)
  .flatMap((task, i) =>
    [0, 7, 42].map((seed) => ({
      task: task.id,
      seed,
      legacy: synthesize(task, [], undefined, seed + i * 97, 1024),
      uniform: search(task, [], undefined, seed + i * 97, 1024, 8192, {
        evolutionary: true,
      }),
      guided: search(task, [], policy, seed + i * 97, 1024, 8192, {
        evolutionary: true,
      }),
    })),
  );
const summary = Object.fromEntries(
  ["legacy", "uniform", "guided"].map((arm) => {
    const rs = rows.map((r) => r[arm as "uniform"]);
    return [
      arm,
      {
        solved: rs.filter((r) => r.solved).length,
        trials: rs.length,
        evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
        expansions: rs.reduce((s, r) => s + (r.expansions ?? 0), 0),
        wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
      },
    ];
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    version: "evolution-calibration-v1",
    note: "Same training-only calibration tasks, no final testing. Conditional hole completion and lexicase selection.",
    corpus: corpus.length,
    summary,
    rows,
  }),
);
console.log(summary);
