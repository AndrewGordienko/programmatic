import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/inverse-policy-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const old: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const fresh: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural-inverse/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v3.json", "utf8"),
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
const settings = {
  diverseBeam: true,
  affineDifferences: 32,
  maxNodes: 96,
  affineFits: 512,
  fitDedup: true,
  primitiveDifferences: true,
  semanticRank: 2,
};
const rows = tasks.flatMap((task, i) =>
  [0, 7, 42].map((seed) => ({
    task: task.id,
    group: task.group,
    seed,
    oldBase: inverseSearch(task, [], old, seed + i * 97, 512, settings),
    oldLibrary: inverseSearch(task, library, old, seed + i * 97, 512, settings),
    freshBase: inverseSearch(task, [], fresh, seed + i * 97, 512, settings),
    freshLibrary: inverseSearch(
      task,
      library,
      fresh,
      seed + i * 97,
      512,
      settings,
    ),
    relational: inverseSearch(task, library, fresh, seed + i * 97, 512, {
      ...settings,
      relational: true,
    }),
  })),
);
const summary = Object.fromEntries(
  ["oldBase", "oldLibrary", "freshBase", "freshLibrary", "relational"].map(
    (arm) => {
      const rs = rows.map((r) => r[arm as "oldBase"]);
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
              rows.filter((r) => r.group === g && r[arm as "oldBase"].solved)
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
    version: "inverse-policy-calibration-v1",
    note: "Adaptive calibration only. Policy receives actual inverse specification intervals at the current hole. Trained on paired base/library representations with legal-production masks. No final target programs are used; fresh exposure audit required before testing.",
    summary,
    rows,
  }),
);
console.log(summary);
