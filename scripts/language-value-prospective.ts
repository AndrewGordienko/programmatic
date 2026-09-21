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
import type { Task, CorpusEntry, Macro, Expr } from "../src/dsl/types";
import { Random } from "../src/engine/random";
import { inverseSearch, type InverseResult } from "../src/joint/inverse";
import { inventions } from "../src/joint/inventions";
import { genome, type Genome } from "../src/joint/genome";
import { languagePopulation } from "../src/joint/population";
import {
  languageValueFeatures,
  predictLanguageValue,
} from "../src/joint/language-value";

const folder = "output/joint/language-value-prospective-v1";
mkdirSync(folder, { recursive: true });
const hash = (x: string | Buffer) =>
  createHash("sha256").update(x).digest("hex");
const modelBytes = readFileSync("output/joint/language-value-v1/model.json"),
  model = JSON.parse(modelBytes.toString());
const policyBytes = readFileSync("output/joint/neural/policy.json"),
  policy = JSON.parse(policyBytes.toString());
const previous = JSON.parse(
  readFileSync("output/joint/replication-v1/protocol.json", "utf8"),
);
const config = {
  seeds: [101, 107, 113, 127, 131, 139, 149, 157],
  training: 128,
  population: 256,
  selected: 16,
  screen: 12,
  screenBudget: 256,
  confirmation: 80,
  confirmationBudget: 512,
  reps: 2,
  search: previous.config.search,
  additionalExamples: { count: 50, range: 5 },
};
const specification = {
  version: "prospective-library-value-v1",
  config,
  modelHash: hash(modelBytes),
  policyHash: hash(policyBytes),
  sources: Object.fromEntries(
    [
      "scripts/language-value-prospective.ts",
      ...Object.keys(previous.sourceHashes).filter((p) => p.startsWith("src/")),
      "src/joint/language-value.ts",
    ].map((p) => [p, hash(readFileSync(p))]),
  ),
  note: "Predeclared eight fresh language-training states. Freeze value/compression/random rankings before candidate synthesis. Evaluate their selected subsets, then remaining population solely as a full-reference research audit. Reference oracle is the best measured screening utility, not an oracle over future tasks. Winner confirmation uses fresh functions. Report actual total research cost, each strategy's query/work cost and shared training costs separately; retrospective pretraining labels and the full audit are not free. No test/confirmation labels train the frozen value model.",
};
const protocolHash = hash(JSON.stringify(specification)),
  protocol = { ...specification, protocolHash };
if (existsSync(`${folder}/protocol.json`)) {
  if (
    JSON.parse(readFileSync(`${folder}/protocol.json`, "utf8")).protocolHash !==
    protocolHash
  )
    throw new Error("Protocol changed");
} else
  writeFileSync(`${folder}/protocol.json`, JSON.stringify(protocol, null, 2));
const excluded = new Set<string>(),
  probes = inputs(903141, 97, 7);
const priorData: { programs: { tree: Expr }[]; library?: Macro[] } = JSON.parse(
  gunzipSync(readFileSync("output/joint/neural/data.json.gz")).toString(),
);
for (const { tree } of priorData.programs)
  for (const p of paths(tree)) {
    const f = compile(at(tree, p), priorData.library ?? []);
    excluded.add(probes.map((xs) => f(...xs).toFixed(6)).join(","));
  }
for (const seed of previous.config.seeds) {
  const r = JSON.parse(
    gunzipSync(
      readFileSync(`output/joint/replication-v1/seed-${seed}.json.gz`),
    ).toString(),
  );
  for (const s of [
    ...r.trainingSignatures,
    ...Object.values(r.splitSignatures).flat(),
  ] as string[])
    excluded.add(s);
}
for (let v = 1; v <= 4; v++) {
  const r = JSON.parse(
    readFileSync(`output/joint/inverse-language-pilot-v${v}.json`, "utf8"),
  );
  for (const s of Object.values(r.splitSignatures).flat() as string[])
    excluded.add(s);
}
for (const [seed, counts] of [
  [31092026, { training: 160, development: 40, confirmation: 20, testing: 20 }],
  [59377215, { training: 10, development: 10, confirmation: 10, testing: 50 }],
] as const)
  for (const task of Object.values(makeTasks(counts, { seed })).flat())
    excluded.add(task.signature);
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const utility = (r: InverseResult) =>
  r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0;
const selectedSeed = process.argv.indexOf("--seed");
const seeds =
  selectedSeed < 0 ? config.seeds : [Number(process.argv[selectedSeed + 1])];
if (seeds.some((s) => !config.seeds.includes(s)))
  throw new Error("Undeclared seed");
for (const seed of seeds) {
  const out = `${folder}/seed-${seed}.json.gz`;
  if (existsSync(out)) {
    console.log("Retaining completed", seed);
    continue;
  }
  if (existsSync(`${folder}/seed-${seed}.ranking.json`))
    throw new Error(
      "Interrupted attempt retained; account for it explicitly before restarting",
    );
  const started = performance.now();
  const training = makeTasks(
    { training: config.training, development: 1, confirmation: 1, testing: 1 },
    {
      seed: 913078 + seed * 77137,
      prefix: `value-${seed}-train`,
      additionalExamples: config.additionalExamples,
    },
  ).training;
  const suite = makeTasks(
    {
      training: 1,
      development: config.screen,
      confirmation: config.confirmation,
      testing: 1,
    },
    {
      seed: 173029 + seed * 81713,
      prefix: `value-${seed}-dev`,
      additionalExamples: config.additionalExamples,
      exclude: new Set([...excluded, ...training.map((t) => t.signature)]),
    },
  );
  const base = genome([]);
  const trial = (task: Task, g: Genome, rep: number, budget: number) =>
    inverseSearch(
      task,
      g.macros,
      policy,
      31897 +
        seed * 100003 +
        rep * 7919 +
        Number(task.id.split("-").at(-1)) * 97,
      budget,
      config.search,
    );
  const race = (g: Genome, tasks: Task[], budget: number, reps: number) => {
    const start = performance.now();
    const rows = tasks.flatMap((task) =>
      Array.from({ length: reps }, (_, rep) => ({
        task: task.id,
        rep,
        result: trial(task, g, rep, budget),
      })),
    );
    return {
      genome: g,
      rows,
      score:
        mean(rows.map((r) => utility(r.result))) -
        0.0005 * g.macros.reduce((s, m) => s + m.size, 0),
      elapsedMs: performance.now() - start,
    };
  };
  const wake = race(base, training, 1024, 2),
    corpus: CorpusEntry[] = [];
  for (const task of training) {
    const solved = wake.rows
      .filter((r) => r.task === task.id && r.result.solved)
      .map((r) => expandExpr(r.result.tree, []))
      .sort((a, b) => exprSize(a) - exprSize(b))[0];
    if (solved) corpus.push({ task, tree: solved });
  }
  const proposed = inventions(corpus),
    languages = languagePopulation(
      [base],
      proposed.map((p) => p.macro),
      seed * 100003 + 8931,
      config.population,
      corpus.length,
    );
  const rankingStarted = performance.now(),
    context = {
      corpus: corpus.length,
      training: config.training,
      budget: config.screenBudget,
      tasks: config.screen,
      reps: 1,
    };
  const scored = languages
    .filter((g) => g.id !== base.id)
    .map((g) => ({
      g,
      value: predictLanguageValue(model, languageValueFeatures(g, context)),
      compression: g.macros.reduce(
        (s, m) => s + m.support * (m.size - m.arity - 1),
        0,
      ),
    }));
  const rng = new Random(seed * 19871 + 7937),
    random = [...scored];
  for (let i = random.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [random[i], random[j]] = [random[j], random[i]];
  }
  const rankings = {
    value: [...scored].sort((a, b) => b.value - a.value).map((r) => r.g.id),
    compression: [...scored]
      .sort((a, b) => b.compression - a.compression)
      .map((r) => r.g.id),
    random: random.map((r) => r.g.id),
  };
  const shortlists = Object.fromEntries(
    Object.entries(rankings).map(([name, ids]) => [
      name,
      [base.id, ...ids.slice(0, config.selected)],
    ]),
  );
  const rankingMs = performance.now() - rankingStarted;
  // Persist predictions and choices BEFORE expensive candidate labels exist.
  const sealed = {
    protocolHash,
    seed,
    languages,
    scored,
    rankings,
    shortlists,
    rankingMs,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(`${folder}/seed-${seed}.ranking.json`, JSON.stringify(sealed));
  const order = [
    ...new Set([
      ...Object.values(shortlists).flat(),
      ...languages.map((g) => g.id),
    ]),
  ];
  const screen = order.map((id) =>
    race(
      languages.find((g) => g.id === id)!,
      suite.development,
      config.screenBudget,
      1,
    ),
  );
  const winning = (ids: string[]) =>
    screen
      .filter((r) => ids.includes(r.genome.id))
      .sort((a, b) => b.score - a.score)[0];
  const winners = Object.fromEntries(
    [
      ...Object.entries(shortlists),
      ["full-reference", languages.map((g) => g.id)] as [string, string[]],
    ].map(([name, ids]) => [name, winning(ids)]),
  );
  const frozen = {
    protocolHash,
    seed,
    selected: Object.fromEntries(
      Object.entries(winners).map(([name, r]) => [name, r.genome]),
    ),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(`${folder}/seed-${seed}.frozen.json`, JSON.stringify(frozen));
  const confirmation = [
    ...new Set([base.id, ...Object.values(winners).map((w) => w.genome.id)]),
  ].map((id) =>
    race(
      languages.find((g) => g.id === id)!,
      suite.confirmation,
      config.confirmationBudget,
      config.reps,
    ),
  );
  const baseline = confirmation.find((r) => r.genome.id === base.id)!;
  const strategies = Object.entries(winners).map(([name, w]) => {
    const ids =
      name === "full-reference" ? languages.map((g) => g.id) : shortlists[name];
    const calls = screen.filter((r) => ids.includes(r.genome.id)),
      fresh = confirmation.find((r) => r.genome.id === w.genome.id)!;
    const deltas = suite.confirmation.map(
      (task) =>
        mean(
          fresh.rows
            .filter((r) => r.task === task.id)
            .map((r) => utility(r.result)),
        ) -
        mean(
          baseline.rows
            .filter((r) => r.task === task.id)
            .map((r) => utility(r.result)),
        ),
    );
    const average = mean(deltas),
      se = Math.sqrt(
        mean(deltas.map((v) => (v - average) ** 2)) / (deltas.length - 1),
      );
    return {
      name,
      candidate: w.genome,
      queries: calls.length,
      screenRegret: winners["full-reference"].score - w.score,
      confirmationUtility: average,
      confirmationLower:
        average -
        2 * se -
        0.0005 * w.genome.macros.reduce((s, m) => s + m.size, 0),
      solved: fresh.rows.filter((r) => r.result.solved).length,
      baseSolved: baseline.rows.filter((r) => r.result.solved).length,
      trials: fresh.rows.length,
      screeningEvaluations: calls.reduce(
        (s, c) => s + c.rows.reduce((t, r) => t + r.result.evaluations, 0),
        0,
      ),
      screeningWork: calls.reduce(
        (s, c) => s + c.rows.reduce((t, r) => t + r.result.work, 0),
        0,
      ),
      screeningWallMs: calls.reduce((s, c) => s + c.elapsedMs, 0),
    };
  });
  const output = {
    protocolHash,
    seed,
    corpus: corpus.length,
    trainingSignatures: training.map((t) => t.signature),
    screenSignatures: suite.development.map((t) => t.signature),
    confirmationSignatures: suite.confirmation.map((t) => t.signature),
    wake,
    proposed,
    ranking: sealed,
    screen,
    confirmation,
    strategies,
    elapsedMs: performance.now() - started,
    note: "All candidate screening labels, including the full-reference audit, were actually paid for. Query reduction describes individual frozen selection strategies, not saved total experiment compute. Winner selection uses screen only; confirmation cannot update rankings or winners. Finite-probe disjointness is empirical. Global value-label generation and neural pretraining costs remain additional shared investments.",
  };
  writeFileSync(out, gzipSync(JSON.stringify(output)));
  writeFileSync(
    `${folder}/seed-${seed}.summary.json`,
    JSON.stringify(
      {
        protocolHash,
        seed,
        corpus: corpus.length,
        strategies,
        elapsedMs: output.elapsedMs,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      seed,
      corpus: corpus.length,
      strategies: strategies.map(
        ({
          name,
          queries,
          screenRegret,
          confirmationUtility,
          confirmationLower,
          solved,
          baseSolved,
        }) => ({
          name,
          queries,
          screenRegret,
          confirmationUtility,
          confirmationLower,
          solved,
          baseSolved,
        }),
      ),
    }),
  );
}
