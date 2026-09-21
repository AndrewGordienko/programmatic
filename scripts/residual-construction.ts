import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
import {
  predictFragmentValue,
  type FragmentValueModel,
} from "../src/joint/fragment-value";
import assert from "node:assert/strict";
const out = "output/joint/residual-construction-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const model: FragmentValueModel = JSON.parse(
  readFileSync("output/joint/fragment-value-v1/model.json", "utf8"),
);
for (const r of JSON.parse(
  readFileSync("output/joint/fragment-value-v1/parity.json", "utf8"),
))
  assert.ok(
    Math.abs(predictFragmentValue(model, r.features) - r.value) < 1e-10,
  );
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v4.json", "utf8"),
).candidate.macros;
const train = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  {
    seed: 31092026,
    prefix: "semantic-calibration",
    additionalExamples: { count: 50, range: 5 },
  },
).training.slice(100);
const diagnostic = makeTasks(
  { training: 10, development: 10, confirmation: 10, testing: 50 },
  {
    seed: 59377215,
    prefix: "composition-calibration",
    additionalExamples: { count: 50, range: 5 },
  },
).testing;
const tasks = [...train, ...diagnostic];
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
const arms = [
  { name: "original", options: {} },
  { name: "residual32", options: { residualBuild: 32 } },
  { name: "residual64", options: { residualBuild: 64 } },
  {
    name: "residual64-inverse",
    options: { residualBuild: 64, relational: true },
  },
  {
    name: "residual64-extra",
    options: { residualBuild: 64, relational: true, workBudget: 8192 },
  },
];
const rows = [];
for (const arm of arms)
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
          { ...settings, ...arm.options },
        ),
      })),
    );
    const summary = {
      arm: arm.name,
      learned,
      solved: trials.filter((t) => t.result.solved).length,
      work: trials.reduce((s, t) => s + t.result.work, 0),
      wallMs: trials.reduce((s, t) => s + t.result.elapsedMs, 0),
      groups: Object.fromEntries(
        [...new Set(trials.map((r) => r.group))].map((g) => [
          g,
          {
            solved: trials.filter((r) => r.group === g && r.result.solved)
              .length,
            fit: trials.filter(
              (r) => r.group === g && r.result.trainError < 1e-8,
            ).length,
          },
        ]),
      ),
    };
    console.log(summary);
    rows.push({ summary, trials });
  }
writeFileSync(
  out,
  JSON.stringify({
    note: "Adaptive calibration only. Residual-directed affine fragment fitting, not hidden generator components. All complete candidates charged; lattice coefficient sorting adds overhead captured in wall time but not structural counters.",
    rows,
  }),
);
