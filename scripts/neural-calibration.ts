import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { search } from "../src/joint/search";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/neural/calibration.json";
if (existsSync(out))
  throw new Error("Preserve the calibration; version future attempts");
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
      uniform: search(task, [], undefined, seed + i * 97, 1024, 8192, {
        evolutionary: true,
      }),
      learned: search(task, [], policy, seed + i * 97, 1024, 8192, {
        evolutionary: true,
      }),
    })),
  );
const summary = Object.fromEntries(
  ["uniform", "learned"].map((arm) => {
    const rs = rows.map((r) => r[arm as "uniform"]);
    return [
      arm,
      {
        solved: rs.filter((r) => r.solved).length,
        trials: rs.length,
        evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
        expansions: rs.reduce((s, r) => s + r.expansions, 0),
        wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
      },
    ];
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    version: "neural-calibration-v1",
    note: "Training-only held-out 60 tasks, same as prior calibrations. Policy trained on separate first 100 tasks and independently sampled executed dreams.",
    summary,
    rows,
  }),
);
console.log(summary);
