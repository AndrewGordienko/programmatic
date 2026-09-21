import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import { abstraction, genome } from "../src/joint/genome";
import type { Expr } from "../src/dsl/types";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/ideal-library-local-v2.json";
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
// Explicit oracle library only diagnoses solver capacity. This is NOT learned-language evidence.
const x: Expr = { op: "arg", value: 0, args: [] };
const c = (value: number): Expr => ({ op: "const", value, args: [] });
const op = (op: string, ...args: Expr[]): Expr => ({ op, args });
const ideal = genome([
  abstraction(op("max", x, op("neg", x)))!,
  abstraction(op("max", c(0), x))!,
  abstraction(op("max", c(0), op("min", c(1), x)))!,
]).macros;
const arms = [
  { name: "local6", options: { localAffineNeighbors: 6 } },
  { name: "local12", options: { localAffineNeighbors: 12 } },
  {
    name: "local12-relations",
    options: {
      localAffineNeighbors: 12,
      relational: true,
      compiledRelations: true,
    },
  },
  {
    name: "local12-lattice-relations",
    options: {
      localAffineNeighbors: 12,
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
    ["oracle", ideal],
  ] as const) {
    const trials = tasks.flatMap((task, i) =>
      [0, 7, 42].map((seed) => ({
        task: task.id,
        group: task.group,
        seed,
        result: inverseSearch(task, macros, policy, seed + i * 97, 512, {
          ...settings,
          ...arm.options,
        }),
      })),
    );
    const summary = {
      arm: arm.name,
      language,
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
    note: "Adaptive calibration, not final evidence. The oracle arm is manually supplied abs/positive-part/clamp solely to diagnose solver capacity; it is not learned-language evidence. Do not use these results as final evaluation or as labels for selection. All complete executions and inverse/fitting work charged; point comparisons and wall time also reported. No oracle syntax or hidden checks guide search.",
    rows,
  }),
);
