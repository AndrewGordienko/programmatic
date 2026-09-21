import { mkdirSync, writeFileSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { DEFAULT, type CorpusEntry } from "../src/dsl/types";
import { synthesize } from "../src/dsl/search";
import { fitJoint } from "../src/joint/policy";
import { search } from "../src/joint/search";
const suite = makeTasks(DEFAULT, {
  seed: 10093017,
  prefix: "joint-calibration",
});
const corpus: CorpusEntry[] = [];
for (let i = 0; i < 100; i++) {
  const task = suite.training[i],
    r = synthesize(task, [], undefined, i * 97, 1536);
  if (r.solved) corpus.push({ task, tree: r.tree });
}
console.log("Corpus", corpus.length);
const policy = fitJoint(corpus, [], 501);
console.log("Policy", policy.decisions, policy.loss);
const rows = suite.training
  .slice(100, 120)
  .map((task, i) => ({
    task: task.id,
    legacy: synthesize(task, [], undefined, i, 512),
    uniform: search(task, [], undefined, i, 512),
    joint: search(task, [], policy, i, 512),
  }));
const summary = Object.fromEntries(
  ["legacy", "uniform", "joint"].map((k) => {
    const rs = rows.map((r) => r[k as "uniform"]);
    return [
      k,
      {
        solved: rs.filter((r) => r.solved).length,
        evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
        expansions: rs.reduce((s, r) => s + (r.expansions ?? 0), 0),
        wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
      },
    ];
  }),
);
mkdirSync("output/joint", { recursive: true });
writeFileSync(
  "output/joint/calibration.json",
  JSON.stringify({
    version: "joint-calibration-v1",
    note: "Only training tasks; final suite unopened.",
    corpus: corpus.length,
    summary,
    rows,
  }),
);
console.log(summary);
