import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import { encoder, type JointPolicy } from "../src/joint/policy";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
const out = "output/joint/visited-policy-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
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
const visited: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural-visited-policy-v1/policy.json", "utf8"),
);
const learned = JSON.parse(
  gunzipSync(
    readFileSync("output/joint/replication-v1/seed-7.json.gz"),
  ).toString(),
).candidate.macros;
const parity = JSON.parse(
  readFileSync("output/joint/neural-visited-policy-v1/parity.json", "utf8"),
);
const ps = parity.semantics.map((values: number[], i: number) => ({
  id: String(i),
  node: { op: "arg", value: 0, args: [] },
  arity: 0,
  semantic: values.slice(0, -1),
}));
for (const fixture of parity.fixtures) {
  const probabilities = encoder(
    visited,
    ps.filter((_: unknown, i: number) => fixture.legal[i]),
  )(fixture.x);
  probabilities.forEach((p, i) =>
    assert.ok(Math.abs(p - fixture.probabilities[i]) < 1e-10),
  );
}
const arms = [
  {
    name: "original",
    policy,
    options: { localAffineNeighbors: 6, lattice: true },
  },
  {
    name: "original-relations",
    policy,
    options: {
      localAffineNeighbors: 6,
      lattice: true,
      relational: true,
      compiledRelations: true,
    },
  },
  {
    name: "visited",
    policy: visited,
    options: { localAffineNeighbors: 6, lattice: true },
  },
  {
    name: "visited-relations",
    policy: visited,
    options: {
      localAffineNeighbors: 6,
      lattice: true,
      relational: true,
      compiledRelations: true,
    },
  },
];
const rows = [];
for (const arm of arms)
  for (const [language, macros] of [
    ["base", []],
    ["learned", library],
    ["replication7", learned],
  ] as const) {
    const trials = tasks.flatMap((task, i) =>
      [0, 7, 42].map((seed) => ({
        task: task.id,
        group: task.group,
        seed,
        result: (() => {
          const start = process.cpuUsage();
          const result = inverseSearch(
            task,
            macros,
            arm.policy,
            seed + i * 97,
            512,
            {
              ...settings,
              ...arm.options,
            },
          );
          const cpu = process.cpuUsage(start);
          return { ...result, cpuMicros: cpu.user + cpu.system };
        })(),
      })),
    );
    const summary = {
      arm: arm.name,
      language,
      solved: trials.filter((t) => t.result.solved).length,
      work: trials.reduce((s, t) => s + t.result.work, 0),
      wallMs: trials.reduce((s, t) => s + t.result.elapsedMs, 0),
      cpuMicros: trials.reduce((s, t) => s + t.result.cpuMicros, 0),
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
    note: "Adaptive calibration, not final evidence. Production policy trained on known compatible witnesses at actual visited decision states. Fixed learned languages are old v4 and replication7, no oracle concepts. All tasks adaptive calibration only, not final evidence. Independent double-precision PyTorch export parity checked before searches. All complete executions and inverse/fitting work charged; point comparisons and wall time also reported. No oracle syntax or hidden checks guide search.",
    rows,
  }),
);
