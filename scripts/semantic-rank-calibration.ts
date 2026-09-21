import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/semantic-rank-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v2.json", "utf8"),
).candidate.macros;
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const diagnostic = makeTasks(
  { training: 10, development: 10, confirmation: 10, testing: 50 },
  { seed: 59377215, prefix: "composition-calibration" },
).testing;
const tasks = [...suite.training.slice(100), ...diagnostic];
const settings = { diverseBeam: true, affineDifferences: 32, maxNodes: 96 };
const rows = tasks.flatMap((task, i) =>
  [0, 7, 42].map((seed) => ({
    task: task.id,
    group: task.group,
    seed,
    base: inverseSearch(task, [], policy, seed + i * 97, 512, settings),
    forward: inverseSearch(task, library, policy, seed + i * 97, 512, settings),
    rankedBase: inverseSearch(task, [], policy, seed + i * 97, 512, {
      ...settings,
      semanticRank: 2,
    }),
    rankedLibrary: inverseSearch(task, library, policy, seed + i * 97, 512, {
      ...settings,
      semanticRank: 2,
    }),
    relational: inverseSearch(task, library, policy, seed + i * 97, 512, {
      ...settings,
      relational: true,
      semanticRank: 2,
    }),
  })),
);
const summary = Object.fromEntries(
  ["base", "forward", "rankedBase", "rankedLibrary", "relational"].map(
    (arm) => {
      const rs = rows.map((r) => r[arm as "base"]);
      return [
        arm,
        {
          solved: rs.filter((r) => r.solved).length,
          trials: rs.length,
          evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
          expansions: rs.reduce((s, r) => s + r.expansions, 0),
          wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
          groups: Object.fromEntries(
            [...new Set(rows.map((r) => r.group))].map((g) => [
              g,
              rows.filter((r) => r.group === g && r[arm as "base"].solved)
                .length,
            ]),
          ),
        },
      ];
    },
  ),
);
writeFileSync(
  out,
  JSON.stringify({
    version: "semantic-rank-calibration-v1",
    note: "Adaptive calibration only, including an explicitly development-only structural task sample. No final evidence. Shared library from pilot v2; paired search seeds. Semantic rank prefers lower residual magnitude after inverse constraints, weighted by 2.",
    summary,
    rows,
  }),
);
console.log(summary);
