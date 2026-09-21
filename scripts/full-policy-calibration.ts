import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import { encoder, productions, type JointPolicy } from "../src/joint/policy";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
const out = "output/joint/full-policy-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const fresh: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural-full-v1/width-128/policy.json", "utf8"),
);
const data = JSON.parse(
  gunzipSync(
    readFileSync("output/joint/neural-full-v1/data.json.gz"),
  ).toString(),
);
const ps = productions(data.library);
const parity = JSON.parse(
  readFileSync("output/joint/neural-full-v1/width-128/parity.json", "utf8"),
);
for (const row of parity.fixtures) {
  const actual = encoder(
    fresh,
    ps.filter((_, i) => row.legal[i]),
  )(row.x);
  assert.equal(actual.length, row.probabilities.length);
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - row.probabilities[i]) < 1e-10),
  );
}
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
  { name: "old", policy, options: {} },
  { name: "full", policy: fresh, options: {} },
  { name: "full-inverse", policy: fresh, options: { relational: true } },
  {
    name: "full-compiled",
    policy: fresh,
    options: { relational: true, compiledRelations: true },
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
          arm.policy,
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
    note: "Adaptive calibration only, with v4 library and 75 observations. Full 75-observation and hole-domain neural context, width 128. Teacher classification accuracy is diagnostic only. All exported probabilities match independent masked PyTorch fixtures. Wider neural scoring adds work beyond old structural counters; wall time includes it and is observational on a shared host.",
    rows,
  }),
);
