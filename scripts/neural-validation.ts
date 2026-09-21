import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { synthesize } from "../src/dsl/search";
import { search } from "../src/joint/search";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/neural/validation.json";
if (existsSync(out))
  throw new Error("Keep the declared validation; version later experiments");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const rows = suite.development.flatMap((task, i) =>
  [0, 7, 42].map((seed) => ({
    task: task.id,
    seed,
    legacy: synthesize(task, [], undefined, seed + i * 97, 1024),
    uniform: search(task, [], undefined, seed + i * 97, 1024, 8192, {
      evolutionary: true,
      fastPolicy: true,
    }),
    learned: search(task, [], policy, seed + i * 97, 1024, 8192, {
      evolutionary: true,
      fastPolicy: true,
    }),
  })),
);
const summary = Object.fromEntries(
  ["legacy", "uniform", "learned"].map((arm) => {
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
    version: "neural-validation-v1",
    note: "Previously unused 40 development tasks. Matched 1024 complete/8192 partial caps. Final 40 tasks still unopened. All methods run sequentially.",
    summary,
    rows,
  }),
);
console.log(summary);
