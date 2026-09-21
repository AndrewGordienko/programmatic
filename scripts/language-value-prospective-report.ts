import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Random } from "../src/engine/random";
import { validLibrary } from "../src/dsl/expressions";
import { aliasesBase } from "../src/joint/semantics";
import {
  languageValueFeatures,
  predictLanguageValue,
} from "../src/joint/language-value";
import type { Genome } from "../src/joint/genome";
import type { InverseResult } from "../src/joint/inverse";

const folder = "output/joint/language-value-prospective-v1";
const protocol = JSON.parse(readFileSync(`${folder}/protocol.json`, "utf8"));
const modelBytes = readFileSync("output/joint/language-value-v1/model.json"),
  model = JSON.parse(modelBytes.toString());
assert.equal(
  createHash("sha256").update(modelBytes).digest("hex"),
  protocol.modelHash,
);
type Race = {
  genome: Genome;
  score: number;
  elapsedMs: number;
  rows: { task: string; rep: number; result: InverseResult }[];
};
type Strategy = {
  name: string;
  queries: number;
  screenRegret: number;
  confirmationUtility: number;
  confirmationLower: number;
  solved: number;
  baseSolved: number;
  trials: number;
  screeningEvaluations: number;
  screeningWork: number;
  screeningWallMs: number;
  candidate: Genome;
};
type Run = {
  seed: number;
  protocolHash: string;
  corpus: number;
  trainingSignatures: string[];
  screenSignatures: string[];
  confirmationSignatures: string[];
  elapsedMs: number;
  wake: Race;
  screen: Race[];
  confirmation: Race[];
  strategies: Strategy[];
  ranking: {
    languages: Genome[];
    rankingMs: number;
    rankings: Record<string, string[]>;
    shortlists: Record<string, string[]>;
    scored: { g: Genome; value: number }[];
  };
};
const runs: Run[] = protocol.config.seeds
  .filter((seed: number) => existsSync(`${folder}/seed-${seed}.summary.json`))
  .map((seed: number) =>
    JSON.parse(
      gunzipSync(readFileSync(`${folder}/seed-${seed}.json.gz`)).toString(),
    ),
  );
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const bounds = (xs: number[]) => {
  const r = new Random(89132),
    boot = Array.from({ length: 10000 }, () =>
      mean(xs.map(() => r.pick(xs))),
    ).sort((a, b) => a - b);
  return {
    mean: mean(xs),
    lower: boot[249],
    upper: boot[9749],
    seeds: xs.length,
  };
};
const utility = (r: InverseResult) =>
  r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0;
for (const r of runs) {
  assert.equal(r.protocolHash, protocol.protocolHash);
  const seen = new Set<string>();
  for (const sig of [
    ...r.trainingSignatures,
    ...r.screenSignatures,
    ...r.confirmationSignatures,
  ]) {
    assert.ok(!seen.has(sig));
    seen.add(sig);
  }
  assert.equal(r.screen.length, protocol.config.population);
  for (const g of r.ranking.languages) {
    assert.ok(validLibrary(g.macros));
    assert.ok(!g.macros.some(aliasesBase));
  }
  const context = {
    corpus: r.corpus,
    training: protocol.config.training,
    budget: protocol.config.screenBudget,
    tasks: protocol.config.screen,
    reps: 1,
  };
  for (const row of r.ranking.scored)
    assert.ok(
      Math.abs(
        row.value -
          predictLanguageValue(model, languageValueFeatures(row.g, context)),
      ) < 1e-10,
    );
  assert.deepEqual(
    r.ranking.rankings.value,
    [...r.ranking.scored]
      .sort((a, b) => b.value - a.value)
      .map((row) => row.g.id),
  );
  const base = r.confirmation.find((x) => x.genome.macros.length === 0)!;
  for (const s of r.strategies) {
    const selected =
      s.name === "full-reference"
        ? r.screen
        : r.screen.filter((row) =>
            r.ranking.shortlists[s.name].includes(row.genome.id),
          );
    const best = [...selected].sort((a, b) => b.score - a.score)[0];
    assert.equal(s.candidate.id, best.genome.id);
    assert.equal(s.queries, selected.length);
    const fresh = r.confirmation.find(
      (row) => row.genome.id === s.candidate.id,
    )!;
    assert.ok(
      Math.abs(
        s.confirmationUtility -
          (mean(fresh.rows.map((row) => utility(row.result))) -
            mean(base.rows.map((row) => utility(row.result)))),
      ) < 1e-10,
    );
    for (const row of [...selected.flatMap((x) => x.rows), ...fresh.rows]) {
      assert.ok(row.result.evaluations <= row.result.budget);
      assert.ok(row.result.expansions <= row.result.expansionBudget);
    }
  }
}
const names = ["value", "compression", "random", "full-reference"];
const strategies = Object.fromEntries(
  names.map((name) => {
    const xs = runs.map((r) => r.strategies.find((s) => s.name === name)!);
    return [
      name,
      {
        confirmed: xs.filter((s) => s.confirmationLower > 0).length,
        screenRegret: bounds(xs.map((s) => s.screenRegret)),
        confirmationUtility: bounds(xs.map((s) => s.confirmationUtility)),
        solved: xs.reduce((s, x) => s + x.solved, 0),
        baseSolved: xs.reduce((s, x) => s + x.baseSolved, 0),
        trials: xs.reduce((s, x) => s + x.trials, 0),
        queries: xs.reduce((s, x) => s + x.queries, 0),
        screeningEvaluations: xs.reduce(
          (s, x) => s + x.screeningEvaluations,
          0,
        ),
        screeningWork: xs.reduce((s, x) => s + x.screeningWork, 0),
        screeningWallMs: xs.reduce((s, x) => s + x.screeningWallMs, 0),
      },
    ];
  }),
);
const comparisons = Object.fromEntries(
  ["compression", "random", "full-reference"].map((name) => [
    name,
    bounds(
      runs.map(
        (r) =>
          r.strategies.find((s) => s.name === "value")!.confirmationUtility -
          r.strategies.find((s) => s.name === name)!.confirmationUtility,
      ),
    ),
  ]),
);
const actual = runs.flatMap((r) => [r.wake, ...r.screen, ...r.confirmation]);
const source = JSON.parse(
  readFileSync("output/joint/replication-v1/analysis.json", "utf8"),
);
const result = {
  protocolHash: protocol.protocolHash,
  status: runs.length === protocol.config.seeds.length ? "complete" : "partial",
  completed: runs.length,
  planned: protocol.config.seeds.length,
  strategies,
  comparisons,
  actualResearchCost: {
    completeEvaluations: actual.reduce(
      (s, r) => s + r.rows.reduce((t, row) => t + row.result.evaluations, 0),
      0,
    ),
    structuralWork: actual.reduce(
      (s, r) => s + r.rows.reduce((t, row) => t + row.result.work, 0),
      0,
    ),
    elapsedMs: runs.reduce((s, r) => s + r.elapsedMs, 0),
    rankingMs: runs.reduce((s, r) => s + r.ranking.rankingMs, 0),
  },
  additionalPriorCost: {
    valueTraining: JSON.parse(
      readFileSync("output/joint/language-value-v1/training.json", "utf8"),
    ),
    entireSourceDiscoveryWork: source.perSeed.reduce(
      (
        s: number,
        r: {
          cost: {
            incrementalEvaluations: number;
            incrementalExpansions: number;
          };
        },
      ) => s + r.cost.incrementalEvaluations + r.cost.incrementalExpansions,
      0,
    ),
    note: "Conservative recorded source investment for the dataset: entire 20-run language-discovery pipeline, including upstream corpus synthesis/confirmation, not only the regression labels. Shared inner-policy pretraining and historical R&D are additional; no double counting with the per-run prospective totals.",
  },
  note: "Meta-seed bootstrap over eight predeclared fresh populations, conditional on one frozen value model and inner policy. All screening labels were actually executed: total experiment savings are zero because it includes exhaustive reference auditing. Individual strategy costs are measured sums over rankings sealed before labels; they exclude common wake and confirmation work shown in actual research cost. Full reference maximizes screening utility, not future true utility. No noninferiority margin was predeclared, so intervals describe differences without proving equal quality. This is one-generation selection, not the previous three-generation learner. No observed amortization follows.",
};
writeFileSync(`${folder}/analysis.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      status: result.status,
      completed: result.completed,
      strategies,
      comparisons,
    },
    null,
    2,
  ),
);
