import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { DEFAULT } from "../src/dsl/types";
import { experiment, PILOT } from "../src/joint/experiment";

const smoke = process.argv.includes("--smoke");
const iid = process.argv.includes("--iid");
const seeds = smoke ? [0] : [0, 7, 42];
// Fresh distribution draws; exclude all prior task signatures, not just old test rows.
const excluded = new Set<string>();
for (const seed of [812731, 911327, 10093017]) {
  const old = makeTasks(DEFAULT, {
    seed,
    exclude: seed === 911327 ? excluded : undefined,
  });
  for (const t of Object.values(old).flat()) excluded.add(t.signature);
}
const config = smoke
  ? {
      ...PILOT,
      rounds: 2,
      proposals: 24,
      shortlist: 4,
      exploration: 2,
      survivors: 4,
      finalists: 2,
      tasksPerStage: 3,
      wakeBudget: 128,
      screenBudget: 32,
      mediumBudget: 64,
      finalBudget: 128,
      replicates: 1,
    }
  : PILOT;
const sizes = {
  training: smoke ? 16 : 200,
  development: config.rounds * config.tasksPerStage * 2,
  confirmation: smoke ? 4 : 24,
  testing: smoke ? 10 : 80,
};
const folder = smoke
  ? "output/joint/smoke"
  : iid
    ? "output/joint/iid"
    : "output/joint/pilot";
mkdirSync(folder, { recursive: true });
// Independent draws from the same remaining support. Do not deplete the
// distribution between meta-seeds (that would make later runs systematically harder).
const manifest = {
  version: "joint-language-v1",
  distribution: iid ? "original-support" : "historical-functions-excluded",
  seeds,
  config,
  sizes,
  generatedBeforeRuns: new Date().toISOString(),
  suites: [] as { seed: number; hash: string }[],
};
const suites = seeds.map((seed) => {
  const suite = makeTasks(sizes, {
    seed: 20260921 + seed * 1009,
    exclude: iid ? undefined : excluded,
    prefix: `joint-${seed}`,
  });
  manifest.suites.push({
    seed,
    hash: createHash("sha256").update(JSON.stringify(suite)).digest("hex"),
  });
  return suite;
});
// Refuse accidental overwrites of a finished scientific run.
if (seeds.some((seed) => existsSync(`${folder}/seed-${seed}.json`)))
  throw new Error(
    `Existing results in ${folder}; use a new protocol/output directory to rerun.`,
  );
writeFileSync(`${folder}/manifest.json`, JSON.stringify(manifest, null, 2));
const results = seeds.map((seed, i) => {
  const result = experiment(suites[i], { ...config, seed }, console.log);
  const frozenHash = createHash("sha256")
    .update(JSON.stringify({ library: result.selected, policy: result.policy }))
    .digest("hex");
  writeFileSync(
    `${folder}/seed-${seed}.json`,
    JSON.stringify({ ...result, frozenHash }),
  );
  console.log(
    JSON.stringify({
      seed,
      summary: result.summary,
      confirmation: result.confirmation.accepted,
    }),
  );
  return result;
});
const summary = {
  version: "joint-language-v1",
  description:
    "Predeclared three-seed pilot, independent meta-task draws. Not the 20-seed acceptance benchmark.",
  distribution: manifest.distribution,
  seeds,
  sizes,
  config,
  runs: results.map((r) => ({
    seed: r.config.seed,
    selected: r.selected,
    confirmation: r.confirmation,
    corpus: r.corpusCoverage,
    summary: r.summary,
    cost: r.cost,
    discoveryMs: r.discoveryMs,
    rounds: r.rounds.map((x) => ({
      round: x.round,
      candidates: x.decision.candidates.length,
      selected: x.decision.selected.length,
      modelTrainingRows: x.decision.modelTrainingRows,
      winner: x.winner.id,
    })),
  })),
};
writeFileSync(`${folder}/summary.json`, JSON.stringify(summary, null, 2));
if (!smoke)
  writeFileSync(
    iid ? "public/joint-iid.json" : "public/joint-pilot.json",
    JSON.stringify(summary),
  );
