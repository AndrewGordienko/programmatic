import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
import { predictHoleValue, type HoleValueModel } from "../src/joint/hole-value";
import assert from "node:assert/strict";
const out = "output/joint/hole-tree-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const model: HoleValueModel = JSON.parse(
  readFileSync("output/joint/neural-visited-v1/model.json", "utf8"),
);
for (const r of JSON.parse(
  readFileSync("output/joint/neural-visited-v1/parity.json", "utf8"),
))
  assert.ok(Math.abs(predictHoleValue(model, r.features) - r.value) < 1e-10);
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
const tree: HoleValueModel = JSON.parse(
  readFileSync("output/joint/neural-visited-v1/tree8/model.json", "utf8"),
);
const forest: HoleValueModel = JSON.parse(
  readFileSync("output/joint/neural-visited-v1/forest16/model.json", "utf8"),
);
for (const [m, folder] of [
  [tree, "tree8"],
  [forest, "forest16"],
] as const)
  for (const fixture of JSON.parse(
    readFileSync(
      `output/joint/neural-visited-v1/${folder}/parity.json`,
      "utf8",
    ),
  ))
    assert.ok(
      Math.abs(predictHoleValue(m, fixture.features) - fixture.value) < 1e-10,
    );
const arms = [
  { name: "original", options: {} },
  { name: "tree-half", options: { holeValue: tree, holeValueWeight: 0.5 } },
  { name: "tree-one", options: { holeValue: tree, holeValueWeight: 1 } },
  { name: "forest-half", options: { holeValue: forest, holeValueWeight: 0.5 } },
  { name: "forest-one", options: { holeValue: forest, holeValueWeight: 1 } },
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
      criticTreeComparisons: trials.reduce(
        (s, t) => s + t.result.holeValueTreeComparisons,
        0,
      ),
      criticPredictions: trials.reduce(
        (s, t) => s + t.result.holeValuePredictions,
        0,
      ),
      criticMultiplications: trials.reduce(
        (s, t) => s + t.result.holeValueMultiplications,
        0,
      ),
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
    note: "Adaptive calibration only, with v4 library and 75 observations. Visited-state witness critic only ranks candidate branches; it never proves infeasibility or prunes on a classification threshold. Neural predictions/multiplications and wall time are separate from structural-work counters. Calibration targets are adaptive, not final evidence.",
    rows,
  }),
);
