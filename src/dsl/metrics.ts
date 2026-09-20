import { ARMS, type Arm, type Result, type Trial } from "./types";
export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
export function summarize(trials: Trial[], arm: Arm) {
  const ts = trials.filter((t) => t.arm === arm),
    solves = ts.filter((t) => t.solution.solved);
  return {
    arm,
    count: ts.length,
    solves: solves.length,
    rate: ts.length ? solves.length / ts.length : 0,
    medianSolved: median(solves.map((t) => t.solution.effort)),
    meanEffort: mean(ts.map((t) => t.solution.effort)),
    evaluations: ts.reduce((s, t) => s + t.solution.evaluations, 0),
    wallMs: ts.reduce((s, t) => s + t.solution.elapsedMs, 0),
    meanMs: mean(ts.map((t) => t.solution.elapsedMs)),
    macroUsage: solves.length
      ? solves.filter((t) => t.solution.macroCalls > 0).length / solves.length
      : 0,
    duplicateRate: mean(
      ts.map((t) => t.solution.duplicates / t.solution.evaluations),
    ),
    validRate: mean(ts.map((t) => t.solution.validFraction)),
    macroProposalRate: mean(ts.map((t) => t.solution.macroProposalFraction)),
    entropy: mean(ts.map((t) => t.solution.entropy)),
    medianSize: median(solves.map((t) => t.solution.nodes)),
    medianDepth: median(solves.map((t) => t.solution.depth)),
  };
}
export function discoveryCost(r: Result) {
  return (
    r.budget.wake +
    r.budget.screen +
    r.budget.development +
    r.budget.confirmation
  );
}
export function comparison(
  r: Result,
  a: Arm = "fixed-uniform",
  b: Arm = "library-prior",
) {
  const fixed = summarize(r.trials, a),
    learned = summarize(r.trials, b);
  const matched = r.trials
    .filter((t) => t.arm === a && t.solution.solved)
    .flatMap((t) => {
      const other = r.trials.find(
        (x) =>
          x.arm === b &&
          x.task === t.task &&
          x.seed === t.seed &&
          x.solution.solved,
      );
      return other ? [t.solution.effort / other.solution.effort] : [];
    });
  const saving = fixed.meanEffort - learned.meanEffort,
    wallSaving = fixed.meanMs - learned.meanMs;
  const tasks = [...new Set(r.trials.map((t) => t.task))];
  const deltas = tasks.map(
    (task) =>
      summarize(
        r.trials.filter((t) => t.task === task),
        b,
      ).rate -
      summarize(
        r.trials.filter((t) => t.task === task),
        a,
      ).rate,
  );
  const avg = mean(deltas),
    se =
      deltas.length > 1
        ? Math.sqrt(
            deltas.reduce((s, v) => s + (v - avg) ** 2, 0) /
              (deltas.length - 1) /
              deltas.length,
          )
        : 0;
  return {
    fixed,
    learned,
    matched: matched.length,
    matchedSpeedup: median(matched),
    saving,
    discovery: discoveryCost(r),
    breakEven:
      saving > 0 && learned.rate >= fixed.rate
        ? Math.ceil(discoveryCost(r) / saving)
        : null,
    wallBreakEven:
      wallSaving > 0 && learned.rate >= fixed.rate
        ? Math.ceil(r.discoveryMs / wallSaving)
        : null,
    rateDelta: learned.rate - fixed.rate,
    rateInterval: [avg - 2 * se, avg + 2 * se],
    totalFixed: fixed.evaluations,
    totalLearned: discoveryCost(r) + learned.evaluations,
  };
}
export function curves(r: Result) {
  return ARMS.map((arm) => ({
    arm,
    points: Array.from({ length: 41 }, (_, i) => {
      const budget = (r.config.finalBudget * i) / 40,
        ts = r.trials.filter((t) => t.arm === arm);
      return {
        x: budget,
        y: ts.length
          ? ts.filter((t) => t.solution.solved && t.solution.effort <= budget)
              .length / ts.length
          : 0,
      };
    }),
  }));
}
