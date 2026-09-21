import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeTasks } from "../src/dsl/tasks";
import { synthesize } from "../src/dsl/search";
import { inverseSearch } from "../src/joint/inverse";
import { search } from "../src/joint/search";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/inverse-validation-v3.json";
if (existsSync(out)) throw new Error("Preserve validation");
const frozenHash = createHash("sha256")
  .update(readFileSync("src/joint/inverse.ts"))
  .update(readFileSync("output/joint/neural/policy.json"))
  .digest("hex");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const tasks = [...suite.confirmation, ...suite.testing];
const rows = tasks.flatMap((task, i) =>
  [0, 7, 42].map((seed) => ({
    task: task.id,
    group: task.group,
    seed,
    legacy: synthesize(task, [], undefined, seed + i * 97, 512),
    joint: search(task, [], policy, seed + i * 97, 512, 4096, {
      evolutionary: true,
      fastPolicy: true,
    }),
    uniform: inverseSearch(task, [], undefined, seed + i * 97, 512),
    guided: inverseSearch(task, [], policy, seed + i * 97, 512),
    noFits: inverseSearch(task, [], policy, seed + i * 97, 512, {
      affineFits: 0,
    }),
  })),
);
const summary = Object.fromEntries(
  ["legacy", "joint", "uniform", "guided", "noFits"].map((arm) => {
    const rs = rows.map((r) => r[arm as "guided"]);
    return [
      arm,
      {
        solved: rs.filter((r) => r.solved).length,
        trials: rs.length,
        evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
        expansions: rs.reduce((s, r) => s + (r.expansions ?? 0), 0),
        wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
        groups: Object.fromEntries(
          [...new Set(rows.map((r) => r.group))].map((g) => [
            g,
            rows.filter((r) => r.group === g && r[arm as "guided"].solved)
              .length,
          ]),
        ),
      },
    ];
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    version: "inverse-validation-v3",
    note: "Fresh 20 confirmation plus 20 final inner-calibration tasks, after freezing inverse solver. Same 512-program cap; joint and inverse have 4096 structural-work cap. Structural work has different cost per operation; compare wall time separately. No DSL is learned here. This policy shares one training seed across search replicates.",
    frozenHash,
    summary,
    rows,
  }),
);
console.log(summary);
