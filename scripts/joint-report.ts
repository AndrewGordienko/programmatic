import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { experiment } from "../src/joint/experiment";
type Result = ReturnType<typeof experiment> & { frozenHash: string };
const arms = [
  "fixed-uniform",
  "fixed-joint",
  "candidate-uniform",
  "candidate-joint",
];
const summarize = (folder: string) => {
  const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, "utf8"));
  const results: Result[] = manifest.seeds.map((seed: number) =>
    JSON.parse(readFileSync(`${folder}/seed-${seed}.json`, "utf8")),
  );
  for (const r of results) {
    const hash = createHash("sha256")
      .update(JSON.stringify({ library: r.selected, policy: r.policy }))
      .digest("hex");
    if (hash !== r.frozenHash) throw new Error("Frozen artifact hash mismatch");
    if (r.config.finalBudget !== manifest.config.finalBudget)
      throw new Error("Protocol mismatch");
  }
  const trials = results.flatMap((r) => r.trials);
  const rows = arms.map((arm) => {
    const rs = trials.filter((r) => r.arm === arm);
    return {
      arm,
      trials: rs.length,
      solved: rs.filter((t) => t.result.solved).length,
      auc:
        rs.reduce(
          (s, t) =>
            s +
            (t.result.solved ? 1 - t.result.evaluations / t.result.budget : 0),
          0,
        ) / rs.length,
      effort: rs.reduce((s, t) => s + t.result.effort, 0),
      evaluations: rs.reduce((s, t) => s + t.result.evaluations, 0),
      expansions: rs.reduce((s, t) => s + t.result.expansions, 0),
      wallMs: rs.reduce((s, t) => s + t.result.elapsedMs, 0),
      macroSolves: rs.filter((t) => t.result.solved && t.result.macroCalls)
        .length,
      curve: [0, 128, 256, 512, 768, 1024].map((budget) => ({
        budget,
        solved:
          rs.filter((t) => t.result.solved && t.result.evaluations <= budget)
            .length / rs.length,
      })),
      groups: Object.fromEntries(
        [...new Set(rs.map((t) => t.group))].map((group) => {
          const ts = rs.filter((t) => t.group === group);
          return [
            group,
            {
              solved: ts.filter((t) => t.result.solved).length,
              trials: ts.length,
            },
          ];
        }),
      ),
    };
  });
  const costs = results.reduce(
    (s, r) => ({
      evaluations:
        s.evaluations +
        r.cost.bootstrapEvaluations +
        r.cost.wakeEvaluations +
        r.cost.raceEvaluations +
        r.cost.confirmationEvaluations,
      expansions:
        s.expansions +
        r.cost.wakeExpansions +
        r.cost.raceExpansions +
        r.cost.confirmationExpansions,
      wallMs: s.wallMs + r.discoveryMs,
      policyMs: s.policyMs + r.cost.policyMs,
      decisions: s.decisions + r.cost.policyDecisions,
    }),
    { evaluations: 0, expansions: 0, wallMs: 0, policyMs: 0, decisions: 0 },
  );
  return {
    distribution: manifest.distribution ?? "historical-functions-excluded",
    seeds: manifest.seeds,
    sizes: manifest.sizes,
    rows,
    costs,
    runs: results.map((r) => ({
      seed: r.config.seed,
      bootstrap: r.bootstrapCoverage,
      corpus: r.corpusCoverage,
      selected: r.selected,
      confirmation: r.confirmation,
      frozenHash: r.frozenHash,
      solves: Object.fromEntries(
        arms.map((arm) => [arm, r.summary[arm].solved]),
      ),
      selection: r.rounds.map((round) => ({
        round: round.round,
        proposed: round.decision.candidates.length,
        measured: round.decision.selected.length,
        trainedOnPastLabels: round.decision.modelTrainingRows,
      })),
    })),
  };
};
const iid = summarize("output/joint/iid"),
  filtered = summarize("output/joint/pilot");
const report = {
  version: "joint-language-v1",
  iid,
  filtered,
  limitations: [
    "Three meta-seeds, with three optimizer replicates per task; not 720 independent functions.",
    "Final examples are excluded from this run’s training and selection. Original-support functions can overlap historical experiments and other meta-seeds; no historical model or corpus is loaded.",
    "Matched complete-program and partial-expansion caps do not imply matched CPU cost.",
    "Library definitions remain bounded compositions of six hand-designed scalar primitives; types and control forms are fixed.",
    "Value ranking is prospective after round one, but no full-pool oracle or random/compression-selection comparison has established quality-preserving savings.",
    "Final evaluation retains the development-selected candidate even if confirmation rejects it. A candidate is not an accepted DSL.",
    "Runners overlapped in time; wall times are descriptive and affected by machine contention.",
  ],
};
writeFileSync("public/joint-report.json", JSON.stringify(report));
writeFileSync("output/joint/report.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      iid: iid.rows,
      costs: iid.costs,
      filtered: filtered.rows.map((r) => ({ arm: r.arm, solved: r.solved })),
    },
    null,
    2,
  ),
);
