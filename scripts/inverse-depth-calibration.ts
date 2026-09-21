import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/inverse-depth-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
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
  macroForward: 48,
  macroBindings: 8,
};
const rows = [];
for (const limit of [4096, 16384, 65536])
  for (const learned of [false, true]) {
    const trials = tasks.flatMap((task, i) =>
      [0, 7, 42].map((seed) => ({
        task: task.id,
        group: task.group,
        seed,
        result: inverseSearch(
          task,
          learned ? library : [],
          policy,
          seed + i * 97,
          512,
          { ...settings, workBudget: limit, depth: limit === 4096 ? 3 : 5 },
        ),
      })),
    );
    const summary = {
      limit,
      learned,
      solved: trials.filter((t) => t.result.solved).length,
      work: trials.reduce((s, t) => s + t.result.work, 0),
      wallMs: trials.reduce((s, t) => s + t.result.elapsedMs, 0),
      groups: Object.fromEntries(
        [...new Set(trials.map((r) => r.group))].map((g) => [
          g,
          trials.filter((r) => r.group === g && r.result.solved).length,
        ]),
      ),
    };
    console.log(summary);
    rows.push({ summary, trials });
  }
writeFileSync(
  out,
  JSON.stringify({
    note: "Adaptive training and structural-development calibration. Program cap stays 512; explicit partial-search cap increases. This is a compute/coverage tradeoff, not equal-total-compute evidence against the older solver.",
    rows,
  }),
);
