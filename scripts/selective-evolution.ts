import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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

import {
  languageValueFeatures,
  predictLanguageValue,
} from "../src/joint/language-value";
const folder = "output/joint/selective-evolution-v1";
const modelBytes = readFileSync("output/joint/language-value-v1/model.json");
const valueModel = JSON.parse(modelBytes.toString());
mkdirSync(folder, { recursive: true });
const hash = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
const policyPath = "output/joint/neural/policy.json",
  policy: JointPolicy = JSON.parse(readFileSync(policyPath, "utf8"));
const files = [
  "scripts/selective-evolution.ts",
  "src/joint/language-value.ts",
  "src/joint/inverse.ts",
  "src/joint/domains.ts",
  "src/joint/joins.ts",
  "src/joint/policy.ts",
  "src/joint/inventions.ts",
  "src/joint/population.ts",
  "src/joint/genome.ts",
  "src/joint/canonical.ts",
  "src/joint/semantics.ts",
  "src/dsl/expressions.ts",
  "src/dsl/tasks.ts",
  "src/engine/language.ts",
  "src/engine/random.ts",
];
const config = {
  seeds: [211, 223, 227, 229],
  selectors: ["full", "value", "compression"],
  selected: 16,
  training: 160,
  development: 96,
  confirmation: 80,
  testing: 200,
  additionalExamples: { count: 50, range: 5 },
  wakeBudget: 1024,
  finalBudget: 512,
  population: 256,
  shortlist: 4,
  parents: 2,
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
  },
};
const specification = {
  version: "selective-evolution-v1",
  valueModelHash: hash(modelBytes),
  config,
  policyHash: hash(readFileSync(policyPath)),
  sourceHashes: Object.fromEntries(
    files.map((p) => [p, hash(readFileSync(p))]),
  ),
  note: "Four predeclared fresh paired meta-seeds compare full/compression/value screening within the same three-generation learner. All selectors retain four screen winners plus base/parents for medium races; only screening candidate allocation changes. Value model and inner policy stay frozen. Ranking is sealed before synthesis. Each selector independently pays wake, selection and confirmation costs; paired tasks and search seeds are identical, while languages/corpora can diverge. Final evaluation freezes languages and charges discovery. Report actual research work and source-value-training investment separately. Source-label tasks, historical pilot/calibration functions, neural programs/subtrees and each run's training functions are excluded from fresh selection/confirmation/final.",
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
for (const source of ["replication-v1", "language-value-prospective-v1"]) {
  const p = JSON.parse(
    readFileSync(`output/joint/${source}/protocol.json`, "utf8"),
  );
  for (const seed of p.config.seeds) {
    const run = JSON.parse(
      gunzipSync(
        readFileSync(`output/joint/${source}/seed-${seed}-${selector}.json.gz`),
      ).toString(),
    );
    for (const sig of run.trainingSignatures) excluded.add(sig);
    for (const sig of (run.splitSignatures
      ? Object.values(run.splitSignatures).flat()
      : [...run.screenSignatures, ...run.confirmationSignatures]) as string[])
      excluded.add(sig);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const utility = (r: InverseResult) =>
  r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0;
type Row = { task: string; group: string; rep: number; result: InverseResult };
const selected = process.argv.includes("--seed")
  ? [Number(process.argv[process.argv.indexOf("--seed") + 1])]
  : config.seeds;
if (selected.some((s) => !config.seeds.includes(s)))
  throw new Error("Seed not predeclared");
for (const seed of selected)
  for (const selector of config.selectors
    .slice(seed % 3)
    .concat(config.selectors.slice(0, seed % 3))) {
    const path = `${folder}/seed-${seed}-${selector}.json.gz`;
    if (existsSync(path)) {
      const done = JSON.parse(gunzipSync(readFileSync(path)).toString());
      if (done.protocolHash !== protocolHash)
        throw new Error("Protocol mismatch");
      console.log("Retaining completed seed", seed);
      continue;
    }
    if (existsSync(`${folder}/seed-${seed}-${selector}.progress.json`))
      throw new Error("Interrupted compute retained; audit before restart");
    const started = performance.now();
    const training = makeTasks(
      {
        training: config.training,
        development: 1,
        confirmation: 1,
        testing: 1,
      },
      {
        seed: 991733 + seed * 77137,
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
        seed: 173931 + seed * 81713,
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
    ) =>
      inverseSearch(
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
        `Seed ${seed} ${selector}, generation ${round}: ${corpus.size}/${training.length} corpus tasks; ${languages.length} languages`,
      );
      const rankingStarted = performance.now();
      const rankingContext = {
        corpus: corpus.size,
        training: config.training,
        budget: stage.budget,
        tasks: stage.screen,
        reps: 1,
      };
      const scored = languages.map((g) => ({
        genome: g,
        score:
          selector === "value"
            ? predictLanguageValue(
                valueModel,
                languageValueFeatures(g, rankingContext),
              )
            : selector === "compression"
              ? g.macros.reduce(
                  (s, m) => s + m.support * (m.size - m.arity - 1),
                  0,
                )
              : 0,
      }));
      const ranked = [...scored].sort((a, b) => b.score - a.score);
      const screened =
        selector === "full"
          ? languages
          : [
              ...new Map(
                [
                  base,
                  ...parents,
                  ...ranked.slice(0, config.selected).map((r) => r.genome),
                ].map((g) => [g.id, g]),
              ).values(),
            ];
      const rankingMs = performance.now() - rankingStarted;
      writeFileSync(
        `${folder}/seed-${seed}-${selector}.round-${round}.ranking.json`,
        JSON.stringify({
          protocolHash,
          seed,
          selector,
          round,
          scored,
          selected: screened.map((g) => g.id),
          rankingMs,
          createdAt: new Date().toISOString(),
        }),
      );
      const screen = screened
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
        rankingMs,
        selector,
        proposals: languages.length,
        screened: screened.length,
        corpus: corpus.size,
        proposed,
        screen,
        medium,
      });
      writeFileSync(
        `${folder}/seed-${seed}-${selector}.progress.json`,
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
      `${folder}/seed-${seed}-${selector}.frozen.json`,
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
      rankingMs: rounds.reduce((s, r) => s + r.rankingMs, 0),
      candidateQueries: rounds.reduce((s, r) => s + r.screened, 0),
      sourceValueInvestment:
        selector === "value"
          ? {
              modelHash: hash(modelBytes),
              training: JSON.parse(
                readFileSync(
                  "output/joint/language-value-v1/training.json",
                  "utf8",
                ),
              ),
              recordedSourceDiscoveryWork: 455357069,
              note: "Shared additional investment in the pretrained value model; not free or included in per-run incremental cost. Includes the conservative entire source discovery pipeline. Inner-policy pretraining is separately recorded and shared by every arm.",
            }
          : null,
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
      selector,
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
      `${folder}/seed-${seed}-${selector}.summary.json`,
      JSON.stringify(
        {
          protocolHash,
          selector,
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
        selector,
        accepted,
        base: summary["base-guided"],
        candidate: summary["candidate-guided"],
      }),
    );
  }
