import { readFileSync, writeFileSync } from "node:fs";
import { Random } from "../src/engine/random";
import type { InverseResult } from "../src/joint/inverse";
type Trial = {
  task: string;
  group: string;
  arm: string;
  result: InverseResult;
};
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const intervals = (xs: number[], seed: number) => {
  const rng = new Random(seed),
    boot = Array.from({ length: 10000 }, () =>
      mean(xs.map(() => rng.pick(xs))),
    ).sort((a, b) => a - b);
  return {
    mean: mean(xs),
    lower: boot[249],
    upper: boot[9749],
    tasks: xs.length,
  };
};
const reports = [1, 2].map((version) => {
  const r = JSON.parse(
    readFileSync(
      `output/joint/inverse-language-pilot-v${version}.json`,
      "utf8",
    ),
  );
  const trials: Trial[] = r.trials,
    ids = [...new Set(trials.map((t) => t.task))];
  const metrics = {
    solveGain: (x: InverseResult) => Number(x.solved),
    workAucGain: (x: InverseResult) =>
      x.solved ? 1 - x.work / (x.budget + x.expansionBudget) : 0,
    programAucGain: (x: InverseResult) =>
      x.solved ? 1 - x.evaluations / x.budget : 0,
    workSaving: (x: InverseResult) => -x.work,
    wallSavingMs: (x: InverseResult) => -x.elapsedMs,
    programProposalSaving: (x: InverseResult) => -x.evaluations,
  };
  const groups = ["all", ...new Set(trials.map((t) => t.group))];
  const comparisons = Object.fromEntries(
    ["guided", "uniform"].map((mode) => [
      mode,
      Object.fromEntries(
        groups.map((group) => {
          const selected = ids.filter(
            (id) =>
              group === "all" ||
              trials.find((t) => t.task === id)!.group === group,
          );
          return [
            group,
            Object.fromEntries(
              Object.entries(metrics).map(([name, f]) => [
                name,
                intervals(
                  selected.map((id) => {
                    const score = (arm: string) =>
                      mean(
                        trials
                          .filter((t) => t.task === id && t.arm === arm)
                          .map((t) => f(t.result)),
                      );
                    return score(`candidate-${mode}`) - score(`base-${mode}`);
                  }),
                  9912,
                ),
              ]),
            ),
          ];
        }),
      ),
    ]),
  );
  const sameTasks = ids.filter((id) =>
    ["base-guided", "candidate-guided"].every((arm) =>
      trials
        .filter((t) => t.task === id && t.arm === arm)
        .every((t) => t.result.solved),
    ),
  );
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const jointSolved = Object.fromEntries(
    ["base-guided", "candidate-guided"].map((arm) => {
      const rs = trials.filter(
        (t) => sameTasks.includes(t.task) && t.arm === arm,
      );
      return [
        arm,
        {
          tasks: sameTasks.length,
          medianProgramProposals: median(rs.map((t) => t.result.evaluations)),
          medianWork: median(rs.map((t) => t.result.work)),
          medianWallMs: median(rs.map((t) => t.result.elapsedMs)),
        },
      ];
    }),
  );
  const selectionWork =
      r.cost.selectionEvaluations + r.cost.selectionExpansions,
    corpusWork = r.cost.corpus.evaluations + r.cost.corpus.expansions;
  const perTask = comparisons.guided.all,
    wallCostLowerBound =
      r.cost.selectionSearchMs +
      r.cost.corpus.discoveryMs +
      r.cost.priorData.generationMs +
      r.cost.priorTraining.elapsedMs;
  return {
    version,
    accepted: r.accepted,
    definitions: r.candidate.macros.map(
      (m: { definition: string }) => m.definition,
    ),
    comparisons,
    jointSolved,
    cost: {
      selectionWork,
      corpusWork,
      additionalPriorBootstrapEvaluations:
        r.cost.priorData.bootstrapEvaluations,
      priorTrainingUpdates: r.cost.priorTraining.updates,
      wallCostLowerBoundMs: wallCostLowerBound,
    },
    amortization: {
      note: "Extrapolation from task-clustered means, not an observed future stream. Heterogeneous structural units are not CPU equivalents. Wall cost is a lower bound: earlier bootstrap wall time, calibration/development research and runner overhead are not fully available. No robust finite break-even if saving interval includes zero.",
      searchWorkBreakEven:
        perTask.workSaving.mean > 0
          ? Math.ceil(
              (selectionWork +
                corpusWork +
                r.cost.priorData.bootstrapEvaluations) /
                perTask.workSaving.mean,
            )
          : null,
      wallBreakEvenLowerBound:
        perTask.wallSavingMs.mean > 0
          ? Math.ceil(wallCostLowerBound / perTask.wallSavingMs.mean)
          : null,
      workSavingsRobust: perTask.workSaving.lower > 0,
      wallSavingsRobust: perTask.wallSavingMs.lower > 0,
    },
  };
});
writeFileSync(
  "output/joint/inverse-language-analysis.json",
  JSON.stringify(
    {
      note: "Paired task-cluster bootstrap percentile intervals, 10,000 resamples, descriptive pilot uncertainty; search replicates are not independent task samples.",
      reports,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    reports.map((r) => ({
      version: r.version,
      overall: r.comparisons.guided.all,
      transfer: {
        nested: r.comparisons.guided["Nested compositions"].solveGain,
        longer: r.comparisons.guided["Longer expressions"].solveGain,
      },
      amortization: r.amortization,
    })),
    null,
    2,
  ),
);
