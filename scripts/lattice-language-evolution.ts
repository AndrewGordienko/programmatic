import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { makeTasks, inputs } from "../src/dsl/tasks";
import {
  compile,
  expandExpr,
  exprSize,
  paths,
  at,
} from "../src/dsl/expressions";
import type { Expr, Macro, Task, CorpusEntry } from "../src/dsl/types";
import { inverseSearch, type InverseResult } from "../src/joint/inverse";
import { inventions } from "../src/joint/inventions";
import { genome, type Genome } from "../src/joint/genome";
import { languagePopulation } from "../src/joint/population";
import type { JointPolicy } from "../src/joint/policy";

const folder = "output/joint/lattice-evolution-v1";
mkdirSync(folder, { recursive: true });
const hash = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
const policyPath = "output/joint/neural/policy.json",
  policy: JointPolicy = JSON.parse(readFileSync(policyPath, "utf8"));
const files = [
  "scripts/lattice-language-evolution.ts",
  ...readdirSync("src/joint")
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))
    .map((p) => `src/joint/${p}`),
  "src/dsl/expressions.ts",
  "src/dsl/tasks.ts",
  "src/dsl/types.ts",
  "src/engine/language.ts",
  "src/engine/random.ts",
];
const config = {
  seeds: [307, 311, 313, 317, 331, 337, 347, 349],
  training: 160,
  development: 96,
  confirmation: 80,
  testing: 200,
  additionalExamples: { count: 50, range: 5 },
  wakeBudget: 1024,
  finalBudget: 512,
  population: 256,
  shortlist: 12,
  parents: 4,
  complexityPenalty: 0.0005,
  rounds: [
    { screen: 8, medium: 16, budget: 128, reps: 2 },
    { screen: 8, medium: 16, budget: 256, reps: 2 },
    { screen: 12, medium: 36, budget: 256, reps: 3 },
  ],
  search: {
    diverseBeam: true,
    affineDifferences: 32,
    maxNodes: 96,
    semanticRank: 2,
    affineFits: 512,
    fitDedup: true,
    primitiveDifferences: true,
    macroForward: 48,
    macroBindings: 8,
    localAffineNeighbors: 6,
    lattice: true,
  },
};
const specification = {
  version: "lattice-evolution-v1",
  innerConfirmationHash: hash(
    readFileSync("output/joint/inner-fresh-confirmation-v1/analysis.json"),
  ),
  config,
  policyHash: hash(readFileSync(policyPath)),
  sourceHashes: Object.fromEntries(
    files.map((p) => [p, hash(readFileSync(p))]),
  ),
  note: "Eight predeclared language-training runs from empty libraries with the independently confirmed local6+lattice inner solver. Shared frozen prior, unchanged population objective and acceptance criterion. No surrogate, oracle library or new neural training. All historical task functions, prior exposure, fresh inner development/confirmation and downstream-stream functions excluded from dev/confirmation/final. All eight runs retained. Four final arms at matched budgets. Report overall, nested and longer utility intervals independently, including rejection/fallback. Counts, point work, process CPU and observational wall separate; no claim of broad structural transfer unless both group intervals improve.",
};
const protocolHash = hash(JSON.stringify(specification)),
  protocol = { ...specification, protocolHash };
const protocolPath = `${folder}/protocol.json`;
if (existsSync(protocolPath)) {
  if (
    JSON.parse(readFileSync(protocolPath, "utf8")).protocolHash !== protocolHash
  )
    throw new Error("Frozen protocol/source changed; use a new version");
} else writeFileSync(protocolPath, JSON.stringify(protocol, null, 2));
const priorData: { library?: Macro[]; programs: { tree: Expr }[] } = JSON.parse(
  gunzipSync(readFileSync("output/joint/neural/data.json.gz")).toString(),
);
const probes = inputs(903141, 97, 7),
  excluded = new Set<string>();
for (const { tree } of priorData.programs)
  for (const path of paths(tree)) {
    const f = compile(at(tree, path), priorData.library ?? []);
    excluded.add(probes.map((x) => f(...x).toFixed(6)).join(","));
  }
for (let v = 1; v <= 4; v++) {
  const old = JSON.parse(
    readFileSync(`output/joint/inverse-language-pilot-v${v}.json`, "utf8"),
  );
  for (const sig of Object.values(old.splitSignatures).flat() as string[])
    excluded.add(sig);
}
for (const task of Object.values(
  makeTasks(
    { training: 160, development: 40, confirmation: 20, testing: 20 },
    { seed: 31092026 },
  ),
).flat())
  excluded.add(task.signature);
for (const task of Object.values(
  makeTasks(
    { training: 10, development: 10, confirmation: 10, testing: 50 },
    { seed: 59377215 },
  ),
).flat())
  excluded.add(task.signature);
const read = (p: string) =>
  JSON.parse(
    p.endsWith(".gz")
      ? gunzipSync(readFileSync(p)).toString()
      : readFileSync(p, "utf8"),
  );
for (const name of [
  "replication-v1",
  "language-value-prospective-v1",
  "selective-evolution-v1",
])
  for (const file of readdirSync(`output/joint/${name}`).filter((p) =>
    /^seed-.*\.json\.gz$/.test(p),
  )) {
    const r = read(`output/joint/${name}/${file}`);
    for (const sig of [
      ...r.trainingSignatures,
      ...(r.splitSignatures
        ? Object.values(r.splitSignatures).flat()
        : [...r.screenSignatures, ...r.confirmationSignatures]),
    ] as string[])
      excluded.add(sig);
  }
for (const name of [
  "inner-fresh-development-v1",
  "inner-fresh-confirmation-v1",
])
  for (const t of read(`output/joint/${name}/tasks.json.gz`).tasks)
    excluded.add(t.signature);
for (const b of read("output/joint/downstream-stream-v1/sealed.json").batches)
  for (const t of read(
    `output/joint/downstream-stream-v1/tasks-${b.batch}.json.gz`,
  ).tasks)
    excluded.add(t.signature);
for (const tree of read("output/joint/neural-visited-v2/data.json.gz")
  .exposureTrees) {
  const f = compile(tree, []);
  excluded.add(probes.map((x) => f(...x).toFixed(6)).join(","));
}
if (process.argv.includes("--prepare-only")) process.exit(0);
type MeasuredResult = InverseResult & {
  cpuUserMicros: number;
  cpuSystemMicros: number;
  cpuMicros: number;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const utility = (r: InverseResult) =>
  r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0;
type Row = { task: string; group: string; rep: number; result: MeasuredResult };
const selected = process.argv.includes("--seed")
  ? [Number(process.argv[process.argv.indexOf("--seed") + 1])]
  : config.seeds;
if (selected.some((s) => !config.seeds.includes(s)))
  throw new Error("Seed not predeclared");
for (const seed of selected) {
  const path = `${folder}/seed-${seed}.json.gz`;
  if (existsSync(path)) {
    const done = JSON.parse(gunzipSync(readFileSync(path)).toString());
    if (done.protocolHash !== protocolHash)
      throw new Error("Protocol mismatch");
    console.log("Retaining completed seed", seed);
    continue;
  }
  const started = performance.now(),
    startedCpu = process.cpuUsage();
  const training = makeTasks(
    { training: config.training, development: 1, confirmation: 1, testing: 1 },
    {
      seed: 773091 + seed * 77137,
      prefix: `meta-${seed}-train`,
      additionalExamples: config.additionalExamples,
    },
  ).training;
  const exclude = new Set([...excluded, ...training.map((t) => t.signature)]);
  const suite = makeTasks(
    {
      training: 1,
      development: config.development,
      confirmation: config.confirmation,
      testing: config.testing,
    },
    {
      seed: 873091 + seed * 81713,
      prefix: `meta-${seed}-eval`,
      exclude,
      additionalExamples: config.additionalExamples,
    },
  );
  const trial = (
    task: Task,
    g: Genome,
    rep: number,
    budget: number,
    guided = true,
  ): MeasuredResult => {
    const cpuStart = process.cpuUsage();
    const result = inverseSearch(
      task,
      g.macros,
      guided ? policy : undefined,
      97031 +
        seed * 1000003 +
        rep * 7919 +
        Number(task.id.split("-").at(-1)) * 97,
      budget,
      config.search,
    );
    const cpu = process.cpuUsage(cpuStart);
    return {
      ...result,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
      cpuMicros: cpu.user + cpu.system,
    };
  };
  const race = (g: Genome, tasks: Task[], budget: number, reps: number) => {
    const rows: Row[] = tasks.flatMap((t) =>
      Array.from({ length: reps }, (_, rep) => ({
        task: t.id,
        group: t.group,
        rep,
        result: trial(t, g, rep, budget),
      })),
    );
    return {
      genome: g,
      rows,
      score:
        mean(rows.map((r) => utility(r.result))) -
        g.macros.reduce((s, m) => s + m.size, 0) * config.complexityPenalty,
    };
  };
  const base = genome([]),
    corpus = new Map<string, CorpusEntry>();
  let parents = [base],
    offset = 0;
  const rounds = [];
  for (let round = 0; round < config.rounds.length; round++) {
    const stage = config.rounds[round],
      wakeStart = performance.now();
    const wake = race(parents[0], training, config.wakeBudget, 2);
    for (const task of training) {
      const solved = wake.rows
        .filter((r) => r.task === task.id && r.result.solved)
        .map((r) => expandExpr(r.result.tree, parents[0].macros))
        .sort((a, b) => exprSize(a) - exprSize(b))[0];
      if (
        solved &&
        (!corpus.has(task.id) ||
          exprSize(solved) < exprSize(corpus.get(task.id)!.tree))
      )
        corpus.set(task.id, { task, tree: solved });
    }
    const proposed = inventions([...corpus.values()]),
      wakeMs = performance.now() - wakeStart;
    const languages = languagePopulation(
      parents,
      proposed.map((p) => p.macro),
      seed * 1031 + round * 100003 + 8172,
      config.population,
      corpus.size,
    );
    console.log(
      `Seed ${seed}, generation ${round}: ${corpus.size}/${training.length} corpus tasks; ${languages.length} languages`,
    );
    const screen = languages
      .map((g) =>
        race(
          g,
          suite.development.slice(offset, offset + stage.screen),
          stage.budget,
          1,
        ),
      )
      .sort((a, b) => b.score - a.score);
    offset += stage.screen;
    const finalists = [
      ...new Map(
        [
          base,
          ...parents,
          ...screen.slice(0, config.shortlist).map((r) => r.genome),
        ].map((g) => [g.id, g]),
      ).values(),
    ];
    const medium = finalists
      .map((g) =>
        race(
          g,
          suite.development.slice(offset, offset + stage.medium),
          config.finalBudget,
          stage.reps,
        ),
      )
      .sort((a, b) => b.score - a.score);
    offset += stage.medium;
    parents = medium.slice(0, config.parents).map((r) => r.genome);
    rounds.push({
      round,
      wake,
      wakeMs,
      corpus: corpus.size,
      proposed,
      screen,
      medium,
    });
    writeFileSync(
      `${folder}/seed-${seed}.progress.json`,
      JSON.stringify(
        {
          protocolHash,
          seed,
          round,
          corpus: corpus.size,
          parents,
          elapsedMs: performance.now() - started,
        },
        null,
        2,
      ),
    );
  }
  if (offset !== config.development)
    throw new Error("Unaccounted development tasks");
  const candidate = parents[0],
    frozenHash = hash(JSON.stringify({ candidate, policy, config })),
    frozenAt = new Date().toISOString();
  writeFileSync(
    `${folder}/seed-${seed}.frozen.json`,
    JSON.stringify(
      { protocolHash, seed, frozenHash, frozenAt, candidate },
      null,
      2,
    ),
  );
  console.log(
    `Seed ${seed}: frozen ${candidate.macros.map((m) => m.definition).join("; ")}`,
  );
  const confirmation = [
    race(base, suite.confirmation, config.finalBudget, 3),
    race(candidate, suite.confirmation, config.finalBudget, 3),
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
    lower -
      candidate.macros.reduce((s, m) => s + m.size, 0) *
        config.complexityPenalty >
      0;
  const discoveryWallMs = performance.now() - started;
  const discoveryCpu = process.cpuUsage(startedCpu);
  const trials = suite.testing.flatMap((t) =>
    [0, 1, 2].flatMap((rep) =>
      [false, true].flatMap((guided) =>
        [false, true].map((learned) => ({
          task: t.id,
          signature: t.signature,
          group: t.group,
          rep,
          arm: `${learned ? "candidate" : "base"}-${guided ? "guided" : "uniform"}`,
          result: trial(
            t,
            learned ? candidate : base,
            rep,
            config.finalBudget,
            guided,
          ),
        })),
      ),
    ),
  );
  const summary = Object.fromEntries(
    [...new Set(trials.map((r) => r.arm))].map((arm) => {
      const rows = trials.filter((r) => r.arm === arm);
      return [
        arm,
        {
          solved: rows.filter((r) => r.result.solved).length,
          trials: rows.length,
          workAuc: mean(rows.map((r) => utility(r.result))),
          work: rows.reduce((s, r) => s + r.result.work, 0),
          wallMs: rows.reduce((s, r) => s + r.result.elapsedMs, 0),
          groups: Object.fromEntries(
            [...new Set(rows.map((r) => r.group))].map((group) => [
              group,
              rows.filter((r) => r.group === group && r.result.solved).length,
            ]),
          ),
        },
      ];
    }),
  );
  const discoveryRows = [
    ...rounds.flatMap((r) => [
      ...r.wake.rows,
      ...r.screen.flatMap((s) => s.rows),
      ...r.medium.flatMap((s) => s.rows),
    ]),
    ...confirmation.flatMap((r) => r.rows),
  ];
  const cost = {
    discoveryWallMs,
    discoveryCpuMicros: discoveryCpu.user + discoveryCpu.system,
    incrementalSearchCpuMicros: discoveryRows.reduce(
      (s, r) => s + r.result.cpuMicros,
      0,
    ),
    incrementalConstraintPoints: discoveryRows.reduce(
      (s, r) => s + r.result.constraintPoints,
      0,
    ),
    incrementalEvaluations: discoveryRows.reduce(
      (s, r) => s + r.result.evaluations,
      0,
    ),
    incrementalExpansions: discoveryRows.reduce(
      (s, r) => s + r.result.expansions,
      0,
    ),
    incrementalSearchMs: discoveryRows.reduce(
      (s, r) => s + r.result.elapsedMs,
      0,
    ),
    wakeAndMiningMs: rounds.reduce((s, r) => s + r.wakeMs, 0),
    totalRunMs: performance.now() - started,
    sharedPriorData: JSON.parse(
      readFileSync("output/joint/neural/data-manifest.json", "utf8"),
    ),
    sharedPriorTraining: JSON.parse(
      readFileSync("output/joint/neural/training.json", "utf8"),
    ),
  };
  const result = {
    protocolHash,
    seed,
    excludedSignatures: exclude.size,
    trainingSignatures: training.map((t) => t.signature),
    splitSignatures: Object.fromEntries(
      Object.entries(suite).map(([k, ts]) => [k, ts.map((t) => t.signature)]),
    ),
    candidate,
    frozenHash,
    frozenAt,
    accepted,
    confirmationGain: { mean: gain, standardError: se, lower },
    corpus: [...corpus.values()],
    rounds,
    confirmation,
    trials,
    summary,
    cost,
  };
  writeFileSync(path, gzipSync(JSON.stringify(result)));
  writeFileSync(
    `${folder}/seed-${seed}.summary.json`,
    JSON.stringify(
      {
        protocolHash,
        seed,
        accepted,
        definitions: candidate.macros.map((m) => m.definition),
        confirmationGain: result.confirmationGain,
        summary,
        cost,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      seed,
      accepted,
      base: summary["base-guided"],
      candidate: summary["candidate-guided"],
    }),
  );
}
