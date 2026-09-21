import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inputs, makeTasks } from "../src/dsl/tasks";
import { compile } from "../src/dsl/expressions";
import type { Macro, Expr, Task } from "../src/dsl/types";
import { inverseSearch, type InverseResult } from "../src/joint/inverse";
import { genome, type Genome } from "../src/joint/genome";
import type { JointPolicy } from "../src/joint/policy";
import { Random } from "../src/engine/random";

const v2 = process.argv.includes("--v2"),
  version = v2 ? "inverse-language-pilot-v2" : "inverse-language-pilot-v1";
const out = `output/joint/${version}.json`;
if (existsSync(out)) throw new Error("Preserve completed pilot");
const start = performance.now(),
  policy: JointPolicy = JSON.parse(
    readFileSync("output/joint/neural/policy.json", "utf8"),
  );
const priorData: { programs: { tree: Expr }[] } = JSON.parse(
  gunzipSync(readFileSync("output/joint/neural/data.json.gz")).toString(),
);
const corpus = JSON.parse(
  readFileSync("output/joint/inverse-corpus-v4.json", "utf8"),
);
const xs = inputs(903141, 97, 7),
  priorSignatures = new Set(
    priorData.programs.map(({ tree }) => {
      const f = compile(tree, []);
      return xs.map((x) => f(...x).toFixed(6)).join(",");
    }),
  );
const oldSuite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const exposure = Object.fromEntries(
  Object.entries(oldSuite).map(([k, tasks]) => [
    k,
    {
      tasks: tasks.length,
      priorOverlap: tasks.filter((t) => priorSignatures.has(t.signature))
        .length,
    },
  ]),
);
const exclude = new Set([
  ...priorSignatures,
  ...Object.values(oldSuite)
    .flat()
    .map((t) => t.signature),
]);
if (v2) {
  const old = JSON.parse(
    readFileSync("output/joint/inverse-language-pilot-v1.json", "utf8"),
  );
  for (const sig of Object.values(old.splitSignatures).flat() as string[])
    exclude.add(sig);
}
const suite = makeTasks(
  { training: 1, development: 36, confirmation: 48, testing: 100 },
  { seed: v2 ? 53092127 : 53092126, exclude, prefix: version },
);
// Restricted unary-library experiment: the current inverse solver only supports
// unary invented productions in its forward fragment stage. No oracle concepts.
const pool: Macro[] = corpus.proposed
  .map((r: { macro: Macro }) => r.macro)
  .filter((m: Macro) => m.arity === 1);
const base = genome([]),
  languages = new Map([[base.id, base]]),
  rng = new Random(815721);
for (const m of pool) {
  const g = genome([m], "single");
  languages.set(g.id, g);
}
for (let i = 0; i < 8; i++)
  for (let j = i + 1; j < 8; j++) {
    const g = genome([pool[i], pool[j]], "pair");
    languages.set(g.id, g);
  }
while (languages.size < 128) {
  const g = genome(
    Array.from({ length: 1 + rng.int(4) }, () => rng.pick(pool)),
    "multi-add",
  );
  languages.set(g.id, g);
}
const searchOptions = v2
  ? { diverseBeam: true, affineDifferences: 32, maxNodes: 96 }
  : {};
const trial = (
  t: Task,
  g: Genome,
  rep: number,
  budget: number,
  guided = true,
) =>
  inverseSearch(
    t,
    g.macros,
    guided ? policy : undefined,
    77231 + rep * 100003 + Number(t.id.split("-").at(-1)) * 97,
    budget,
    searchOptions,
  );
const utility = (r: InverseResult) =>
  r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const race = (g: Genome, tasks: Task[], budget: number, reps: number) => {
  const rows = tasks.flatMap((t) =>
    Array.from({ length: reps }, (_, rep) => ({
      task: t.id,
      rep,
      result: trial(t, g, rep, budget),
    })),
  );
  return {
    genome: g,
    rows,
    score:
      mean(rows.map((r) => utility(r.result))) -
      g.macros.reduce((s, m) => s + m.size, 0) * 0.0005,
  };
};
console.log(
  `Screening ${languages.size} unary-library genomes; ${exclude.size} training/calibration signatures excluded.`,
);
const screen = [...languages.values()].map((g) =>
  race(g, suite.development.slice(0, 12), 256, 1),
);
const shortlisted = [
  ...new Map(
    [
      base,
      ...screen
        .sort((a, b) => b.score - a.score)
        .slice(0, 16)
        .map((r) => r.genome),
    ].map((g) => [g.id, g]),
  ).values(),
];
console.log(
  `Confirming ${shortlisted.length} development finalists on fresh stage tasks.`,
);
const medium = shortlisted
  .map((g) => race(g, suite.development.slice(12), 512, 3))
  .sort((a, b) => b.score - a.score);
const candidate = medium[0].genome;
const frozenHash = createHash("sha256")
  .update(JSON.stringify({ candidate, policy }))
  .digest("hex");
console.log(
  "Language and shared policy frozen:",
  candidate.macros.map((m) => m.definition),
);
const confirmation = [
  race(base, suite.confirmation, 512, 3),
  race(candidate, suite.confirmation, 512, 3),
];
const diffs = suite.confirmation.map(
  (t) =>
    mean(
      confirmation[1].rows
        .filter((r) => r.task === t.id)
        .map((r) => utility(r.result)),
    ) -
    mean(
      confirmation[0].rows
        .filter((r) => r.task === t.id)
        .map((r) => utility(r.result)),
    ),
);
const gain = mean(diffs),
  se = Math.sqrt(
    diffs.reduce((s, v) => s + (v - gain) ** 2, 0) /
      (diffs.length - 1) /
      diffs.length,
  ),
  lower = gain - 2 * se;
const accepted =
  candidate.macros.length > 0 &&
  lower - candidate.macros.reduce((s, m) => s + m.size, 0) * 0.0005 > 0;
const trials = suite.testing.flatMap((t) =>
  [0, 1, 2].flatMap((rep) =>
    [false, true].flatMap((guided) =>
      [false, true].map((learned) => ({
        task: t.id,
        group: t.group,
        rep,
        arm: `${learned ? "candidate" : "base"}-${guided ? "guided" : "uniform"}`,
        result: trial(t, learned ? candidate : base, rep, 512, guided),
      })),
    ),
  ),
);
const summary = Object.fromEntries(
  [...new Set(trials.map((t) => t.arm))].map((arm) => {
    const rs = trials.filter((t) => t.arm === arm);
    return [
      arm,
      {
        trials: rs.length,
        solved: rs.filter((t) => t.result.solved).length,
        workAuc: mean(rs.map((t) => utility(t.result))),
        programAuc: mean(
          rs.map((t) =>
            t.result.solved ? 1 - t.result.evaluations / t.result.budget : 0,
          ),
        ),
        work: rs.reduce((s, r) => s + r.result.work, 0),
        wallMs: rs.reduce((s, r) => s + r.result.elapsedMs, 0),
        macroUse: rs.filter((t) => t.result.solved && t.result.macroCalls > 0)
          .length,
        groups: Object.fromEntries(
          [...new Set(rs.map((t) => t.group))].map((group) => [
            group,
            {
              trials: rs.filter((t) => t.group === group).length,
              solved: rs.filter((t) => t.group === group && t.result.solved)
                .length,
            },
          ]),
        ),
      },
    ];
  }),
);
const races = [...screen, ...medium, ...confirmation],
  cost = {
    corpus: corpus.summary,
    selectionEvaluations: races.reduce(
      (s, r) => s + r.rows.reduce((n, t) => n + t.result.evaluations, 0),
      0,
    ),
    selectionExpansions: races.reduce(
      (s, r) => s + r.rows.reduce((n, t) => n + t.result.expansions, 0),
      0,
    ),
    selectionSearchMs: races.reduce(
      (s, r) => s + r.rows.reduce((n, t) => n + t.result.elapsedMs, 0),
      0,
    ),
    priorData: JSON.parse(
      readFileSync("output/joint/neural/data-manifest.json", "utf8"),
    ),
    priorTraining: JSON.parse(
      readFileSync("output/joint/neural/training.json", "utf8"),
    ),
    totalPilotMs: performance.now() - start,
  };
writeFileSync(
  out,
  JSON.stringify({
    version,
    searchOptions,
    note: "Restricted unary library pilot. Shared fixed prior. Novel relative to recorded prior/dream/calibration functions by 97-probe signatures, not formal equivalence. 128 languages -> 16 fresh-stage finalists -> one frozen candidate -> 48 confirmation tasks -> 100 tests. Candidate evaluated even when rejected. No oracle labels in selection. No surrogate savings claimed. Structural work units heterogeneous; wall time separately reported. V2 also excludes all v1 task functions and uses equal 96-node expanded/active limits.",
    exposure,
    excludedSignatures: exclude.size,
    splitSignatures: Object.fromEntries(
      Object.entries(suite).map(([k, ts]) => [k, ts.map((t) => t.signature)]),
    ),
    candidate,
    frozenHash,
    accepted,
    confirmationGain: { mean: gain, standardError: se, lower },
    summary,
    cost,
    screen,
    medium,
    confirmation,
    trials,
  }),
);
console.log(JSON.stringify({ accepted, gain, lower, summary }, null, 2));
