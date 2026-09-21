import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/inverse-calibration-v3.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const rows = suite.training
  .slice(100)
  .flatMap((task, i) =>
    [0, 7, 42].map((seed) => ({
      task: task.id,
      seed,
      uniform: inverseSearch(task, [], undefined, seed + i * 97, 512),
      guided: inverseSearch(task, [], policy, seed + i * 97, 512),
      noFits: inverseSearch(task, [], policy, seed + i * 97, 512, {
        affineFits: 0,
      }),
    })),
  );
const summary = Object.fromEntries(
  ["uniform", "guided", "noFits"].map((arm) => {
    const rs = rows.map((r) => r[arm as "uniform"]);
    return [
      arm,
      {
        solved: rs.filter((r) => r.solved).length,
        trials: rs.length,
        evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
        expansions: rs.reduce((s, r) => s + r.expansions, 0),
        constraintPoints: rs.reduce((s, r) => s + r.constraintPoints, 0),
        wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
      },
    ];
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    version: "inverse-calibration-v3",
    note: "Training-only. Domain-specific affine proposals and inverse interval specifications. Support-screening executions and duplicate proposals are charged; cached semantics can be reused. No concept ASTs are supplied. Program cap512, structural cap4096, plane fits and constraint queries charged.",
    summary,
    rows,
  }),
);
console.log(summary);
