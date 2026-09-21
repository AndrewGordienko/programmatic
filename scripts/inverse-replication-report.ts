import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Random } from "../src/engine/random";
import { compile, validLibrary } from "../src/dsl/expressions";
import { aliasesBase } from "../src/joint/semantics";
import type { InverseResult } from "../src/joint/inverse";
import type { Genome } from "../src/joint/genome";

type Trial = {
  task: string;
  signature: string;
  group: string;
  rep: number;
  arm: string;
  result: InverseResult;
};
type Run = {
  seed: number;
  protocolHash: string;
  accepted: boolean;
  candidate: Genome;
  frozenHash: string;
  trainingSignatures: string[];
  splitSignatures: Record<string, string[]>;
  trials: Trial[];
  cost: {
    discoveryWallMs: number;
    incrementalEvaluations: number;
    incrementalExpansions: number;
    sharedPriorData: { generationMs: number };
    sharedPriorTraining: { elapsedMs: number };
  };
};
const folder = "output/joint/replication-v1",
  protocol = JSON.parse(readFileSync(`${folder}/protocol.json`, "utf8"));
const runs: Run[] = protocol.config.seeds
  .filter((seed: number) => existsSync(`${folder}/seed-${seed}.summary.json`))
  .map((seed: number) =>
    JSON.parse(
      gunzipSync(readFileSync(`${folder}/seed-${seed}.json.gz`)).toString(),
    ),
  );
const policy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const bounds = (xs: number[]) => {
  if (!xs.length) return null;
  const rng = new Random(61723),
    boot = Array.from({ length: 10000 }, () =>
      mean(xs.map(() => rng.pick(xs))),
    ).sort((a, b) => a - b);
  return {
    mean: mean(xs),
    lower: boot[249],
    upper: boot[9749],
    metaSeeds: xs.length,
  };
};
const groups = [
  "all",
  "Related compositions",
  "Nested compositions",
  "Longer expressions",
];
const metrics = {
  solve: (r: InverseResult) => Number(r.solved),
  workAuc: (r: InverseResult) =>
    r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0,
  work: (r: InverseResult) => r.work,
  wallMs: (r: InverseResult) => r.elapsedMs,
  proposals: (r: InverseResult) => r.evaluations,
};
const comparisons = [
  ["library-guided", "candidate-guided", "base-guided"],
  ["library-uniform", "candidate-uniform", "base-uniform"],
  ["prior-base", "base-guided", "base-uniform"],
  ["prior-library", "candidate-guided", "candidate-uniform"],
  ["accepted-library", "accepted-guided", "base-guided"],
];
for (const run of runs) {
  if (run.protocolHash !== protocol.protocolHash)
    throw new Error("Mixed protocol");
  if (
    !validLibrary(run.candidate.macros) ||
    run.candidate.macros.some(aliasesBase)
  )
    throw new Error("Invalid/aliased library");
  const frozen = createHash("sha256")
    .update(
      JSON.stringify({
        candidate: run.candidate,
        policy,
        config: protocol.config,
      }),
    )
    .digest("hex");
  if (frozen !== run.frozenHash) throw new Error("Frozen artifact mismatch");
  const training = new Set(run.trainingSignatures),
    seen = new Set<string>();
  for (const signatures of Object.values(run.splitSignatures))
    for (const signature of signatures) {
      if (training.has(signature) || seen.has(signature))
        throw new Error("Split overlap");
      seen.add(signature);
    }
  for (const trial of run.trials) {
    if (
      trial.result.evaluations > protocol.config.finalBudget ||
      trial.result.expansions > protocol.config.finalBudget * 8
    )
      throw new Error("Budget overrun");
    if (!run.splitSignatures.testing.includes(trial.signature))
      throw new Error("Unknown final task");
    compile(
      trial.result.tree,
      trial.arm.startsWith("candidate") ? run.candidate.macros : [],
    );
  }
  if (run.trials.length !== protocol.config.testing * 3 * 4)
    throw new Error("Missing final trials");
}
const score = (
  run: Run,
  arm: string,
  group: string,
  metric: (r: InverseResult) => number,
) => {
  if (arm === "accepted-guided")
    arm = run.accepted ? "candidate-guided" : "base-guided";
  return mean(
    run.trials
      .filter((t) => t.arm === arm && (group === "all" || t.group === group))
      .map((t) => metric(t.result)),
  );
};
const comparison = Object.fromEntries(
  comparisons.map(([name, left, right]) => [
    name,
    Object.fromEntries(
      groups.map((group) => [
        group,
        Object.fromEntries(
          Object.entries(metrics).map(([metric, f]) => [
            metric,
            bounds(
              runs.map(
                (run) =>
                  score(run, left, group, f) - score(run, right, group, f),
              ),
            ),
          ]),
        ),
      ]),
    ),
  ]),
);
const perSeed = runs.map((run) => {
  const macroTrials = run.trials.filter(
    (t) => t.arm === "candidate-guided" && t.result.solved,
  );
  const workSaving =
      score(run, "base-guided", "all", metrics.work) -
      score(run, "accepted-guided", "all", metrics.work),
    wallSaving =
      score(run, "base-guided", "all", metrics.wallMs) -
      score(run, "accepted-guided", "all", metrics.wallMs);
  return {
    seed: run.seed,
    accepted: run.accepted,
    definitions: run.candidate.macros.map((m) => m.definition),
    solveDelta:
      score(run, "candidate-guided", "all", metrics.solve) -
      score(run, "base-guided", "all", metrics.solve),
    workAucDelta:
      score(run, "candidate-guided", "all", metrics.workAuc) -
      score(run, "base-guided", "all", metrics.workAuc),
    nestedDelta:
      score(run, "candidate-guided", "Nested compositions", metrics.solve) -
      score(run, "base-guided", "Nested compositions", metrics.solve),
    longerDelta:
      score(run, "candidate-guided", "Longer expressions", metrics.solve) -
      score(run, "base-guided", "Longer expressions", metrics.solve),
    macroUse: macroTrials.filter((t) => t.result.macroCalls > 0).length,
    solved: macroTrials.length,
    cost: run.cost,
    incrementalBreakEven: {
      work:
        workSaving > 0
          ? Math.ceil(
              (run.cost.incrementalEvaluations +
                run.cost.incrementalExpansions) /
                workSaving,
            )
          : null,
      wall:
        wallSaving > 0
          ? Math.ceil(run.cost.discoveryWallMs / wallSaving)
          : null,
    },
  };
});
const occurrences = new Map<string, number>();
for (const run of runs)
  for (const sig of run.splitSignatures.testing)
    occurrences.set(sig, (occurrences.get(sig) ?? 0) + 1);
const complete = runs.length === protocol.config.seeds.length;
const positive = (name: string, group: string, metric: string) => {
  const c = comparison[name][group][metric];
  return !!c && c.lower > 0;
};
const summary = {
  protocolHash: protocol.protocolHash,
  status: complete ? "complete" : "partial",
  completed: runs.length,
  planned: protocol.config.seeds.length,
  accepted: runs.filter((r) => r.accepted).length,
  uniqueFinalFunctions: occurrences.size,
  finalTaskInstances: runs.length * protocol.config.testing,
  repeatedAcrossRuns: [...occurrences.values()].filter((n) => n > 1).length,
  totalTrialsPerArm: runs.length * protocol.config.testing * 3,
  aucWins: perSeed.filter((s) => s.workAucDelta > 1e-12).length,
  aucTies: perSeed.filter((s) => Math.abs(s.workAucDelta) <= 1e-12).length,
  aucLosses: perSeed.filter((s) => s.workAucDelta < -1e-12).length,
  comparisons: comparison,
  gates: complete
    ? {
        priorBenefit: positive("prior-base", "all", "workAuc"),
        confirmedLanguageUtility:
          runs.filter((r) => r.accepted).length >= 16 &&
          perSeed.filter((s) => s.workAucDelta > 0).length >= 16 &&
          positive("accepted-library", "all", "workAuc"),
        nestedTransfer: positive(
          "accepted-library",
          "Nested compositions",
          "solve",
        ),
        longerTransfer: positive(
          "accepted-library",
          "Longer expressions",
          "solve",
        ),
        observedAmortization: false,
        offroadTransfer: false,
      }
    : null,
  perSeed,
  note: "Meta-seed bootstrap intervals conditional on one shared pretrained policy and this task distribution; optimizer repetitions are averaged. Partial reports do not establish robustness. Across-run repeated task functions are disclosed. Rejected candidates remain in candidate comparisons; accepted-policy comparison falls back to base. Work/proposal/wall deltas use candidate minus baseline, so negative means saving. Incremental break-even is an extrapolation from per-task means, not observed amortization; heterogeneous work is not CPU-equivalent. Shared prior cost cancels only in the matched-prior comparison; uniform baseline comparisons must include it. Historical R&D and global protocol setup are not included in incremental run timing.",
};
writeFileSync(`${folder}/analysis.json`, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      status: summary.status,
      completed: summary.completed,
      accepted: summary.accepted,
      wins: summary.aucWins,
      gates: summary.gates,
      overall: comparison["accepted-library"]?.all,
      nested: comparison["accepted-library"]?.["Nested compositions"]?.solve,
      longer: comparison["accepted-library"]?.["Longer expressions"]?.solve,
    },
    null,
    2,
  ),
);
