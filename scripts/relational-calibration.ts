import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/relational-calibration-v3.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v1.json", "utf8"),
).candidate.macros;
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
      base: inverseSearch(task, [], policy, seed + i * 97, 512, {
        diverseBeam: true,
        affineDifferences: 32,
      }),
      forward: inverseSearch(task, library, policy, seed + i * 97, 512, {
        diverseBeam: true,
        affineDifferences: 32,
      }),
      relational: inverseSearch(task, library, policy, seed + i * 97, 512, {
        relational: true,
        diverseBeam: true,
        affineDifferences: 32,
      }),
    })),
  );
const summary = Object.fromEntries(
  ["base", "forward", "relational"].map((arm) => {
    const rs = rows.map((r) => r[arm as "base"]);
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
    version: "relational-calibration-v3",
    note: "Training-only adaptive calibration. Uses previously selected library; no new final test. All arms use diverse beam plus 32 differences between data-inferred affine fragments; coefficient derivations and actual executions charged. Unary forward proposals interleaved across productions.",
    summary,
    rows,
  }),
);
console.log(summary);
