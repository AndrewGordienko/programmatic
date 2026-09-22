import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import { type JointPolicy } from "../src/joint/policy";
import { gunzipSync } from "node:zlib";
const out = "output/joint/branch-allocation-v1.json";
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
const common: Parameters<typeof inverseSearch>[5] = {
  localAffineNeighbors: 6,
  lattice: true,
  affineStrategy: "constraints",
  affineHoleBudget: 64,
};
const arms: {
  name: string;
  policy: JointPolicy;
  options: Parameters<typeof inverseSearch>[5];
}[] = [
  { name: "original", policy, options: common },
  { name: "unique", policy, options: { ...common, uniqueChildren: true } },
  {
    name: "share50",
    policy,
    options: { ...common, branchShare: 0.5, relational: true },
  },
  {
    name: "share25",
    policy,
    options: { ...common, branchShare: 0.25, relational: true },
  },
  {
    name: "visited-share50",
    policy: visited,
    options: { ...common, branchShare: 0.5, relational: true },
  },
  {
    name: "visited-share25",
    policy: visited,
    options: { ...common, branchShare: 0.25, relational: true },
  },
  {
    name: "visited-unique",
    policy: visited,
    options: { ...common, uniqueChildren: true, relational: true },
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
    note: "Adaptive calibration, not final evidence. Compare root branch work allocation and exact child-specification deduplication. Learned unary relations are available when specified. Fixed learned languages are old v4 and replication7, no oracle concepts. All tasks adaptive calibration only, not final evidence. All complete executions and inverse/fitting work charged; point comparisons and wall time also reported. No oracle syntax or hidden checks guide search.",
    rows,
  }),
);
