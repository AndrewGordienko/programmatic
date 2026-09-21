import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import { genome } from "../src/joint/genome";
import type { JointPolicy } from "../src/joint/policy";
import type { Macro } from "../src/dsl/types";
const out = "output/joint/inverse-extension-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const corpus = JSON.parse(
  readFileSync("output/joint/inverse-corpus-v5.json", "utf8"),
);
const parent = genome(corpus.parentLibrary);
const languages = [
  ...new Map(
    [
      parent,
      ...corpus.proposed
        .filter((r: { macro: Macro }) => r.macro.arity === 1)
        .map((r: { macro: Macro }) =>
          genome([...parent.macros, r.macro], "incumbent-add", [parent.id]),
        ),
    ].map((g) => [g.id, g]),
  ).values(),
];
const training = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
).training;
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
const run = (
  g: typeof parent,
  relational: false | "monotone",
  tasks: typeof training,
) => {
  const rows = tasks.flatMap((t, i) =>
    [0, 7, 42].map((seed) => ({
      task: t.id,
      seed,
      result: inverseSearch(t, g.macros, policy, seed + i * 97, 512, {
        ...settings,
        relational,
      }),
    })),
  );
  return {
    genome: g,
    relational,
    solved: rows.filter((r) => r.result.solved).length,
    auc:
      rows.reduce(
        (s, r) =>
          s +
          (r.result.solved
            ? 1 - r.result.work / (r.result.budget + r.result.expansionBudget)
            : 0),
        0,
      ) / rows.length,
    rows,
  };
};
const screen = languages
  .flatMap((g) =>
    ([false, "monotone"] as const).map((mode) =>
      run(g, mode, training.slice(100, 132)),
    ),
  )
  .sort((a, b) => b.auc - a.auc);
const medium = [
  ...screen.slice(0, 8),
  ...screen.filter((r) => r.genome.id === parent.id),
].map((r) => run(r.genome, r.relational, training.slice(132)));
writeFileSync(
  out,
  JSON.stringify({
    note: "Adaptive training-only search calibration. All unary additions to the mined incumbent, with generic monotone inverse semantics enabled/disabled. No final evidence.",
    screen,
    medium,
  }),
);
console.log(
  medium.map((r) => ({
    macros: r.genome.macros.map((m) => m.definition),
    mode: r.relational,
    solved: r.solved,
    trials: r.rows.length,
    auc: r.auc,
  })),
);
