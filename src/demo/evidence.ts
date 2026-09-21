import type { Invention, Snapshot } from "../offroad/types";
import type { Result } from "../dsl/types";
export type OffroadBenchmark = {
  simulatorVersion: string;
  arms: {
    neural: boolean;
    evolveDSL: boolean;
    runs: {
      seed: number;
      arrivals: number;
      count: number;
      macros: number;
      program: Snapshot["best"]["program"];
    }[];
  }[];
};
export type ScalarBenchmark = {
  version: string;
  completed: number;
  seeds: number[];
  rows: {
    seed: number;
    macros: unknown[];
    comparison: { discovery: number };
    audit: {
      developmentPositive: number;
      confirmationPositive: number;
      clearedUncertainty: number;
    };
  }[];
};
export type Rejection = {
  domain: string;
  stage: string;
  definition: string;
  observation: string;
  reason: string;
};
export type DemoEvidence = {
  version: "presentation-evidence-v1";
  simulatorVersion: string;
  reference: { seed: number; arrivals: number; count: number };
  terrain: {
    accepted: number;
    guided: number;
    unguided: number;
    count: number;
  };
  scalar: {
    runs: number;
    acceptedRuns: number;
    discovery: number;
    developmentPositive: number;
    confirmationPositive: number;
    clearedUncertainty: number;
  };
  rejections: Rejection[];
  sources: { path: string; sha256: string }[];
};
const pp = (n: number) => `${n >= 0 ? "+" : ""}${(100 * n).toFixed(2)} pp`;
// All presentation numbers are derived from the recorded experiments. The
// extraction rules are fixed; this module never trains or selects a policy.
export function deriveEvidence(
  off: OffroadBenchmark,
  reference: Snapshot,
  scalar: ScalarBenchmark,
  library: Result,
): Omit<DemoEvidence, "sources"> {
  if (
    off.simulatorVersion !== reference.simulatorVersion ||
    scalar.version !== library.version ||
    scalar.rows.length !== scalar.completed
  )
    throw Error("Inconsistent presentation evidence");
  const guided = off.arms.find((a) => a.neural && !a.evolveDSL)!,
    plain = off.arms.find((a) => !a.neural && !a.evolveDSL)!;
  const ref = off.arms
    .find((a) => a.neural && a.evolveDSL)
    ?.runs.find((r) => r.seed === reference.config.seed);
  if (
    !guided ||
    !plain ||
    !ref ||
    JSON.stringify(ref.program) !== JSON.stringify(reference.best.program)
  )
    throw Error("Reference does not match recorded benchmark");
  const count = guided.runs.reduce((n, r) => n + r.count, 0);
  if (count !== plain.runs.reduce((n, r) => n + r.count, 0))
    throw Error("Unequal benchmark counts");
  const terrain: Invention | undefined = reference.inventions.find(
    (p) => !p.accepted,
  );
  const full = library.proposals.find(
    (p) => !p.accepted && p.development !== undefined && p.development <= 0,
  );
  const confirmation = library.proposals.find(
    (p) => !p.accepted && p.gain !== undefined && p.lowerBound !== undefined,
  );
  const rejections: Rejection[] = [];
  if (terrain)
    rejections.push({
      domain: `Off-road · seed ${reference.config.seed}`,
      stage: `Generation ${terrain.generation}`,
      definition: terrain.macro.definition,
      observation: `Development fitness ${terrain.before.toFixed(2)} → ${terrain.after.toFixed(2)}. Used in ${terrain.used}/2 winning programs.`,
      reason:
        "Did not meet both the fitness-improvement and usage requirements.",
    });
  if (full)
    rejections.push({
      domain: `Scalar · seed ${library.config.seed}`,
      stage: `Round ${full.round} · development`,
      definition: full.macros.map((m) => m.definition).join("\n"),
      observation: `Development utility change: ${pp(full.development!)}.`,
      reason:
        "Failed to improve fresh-search utility after the language-size penalty.",
    });
  if (confirmation)
    rejections.push({
      domain: `Scalar · seed ${library.config.seed}`,
      stage: `Round ${confirmation.round} · confirmation`,
      definition: confirmation.macros.map((m) => m.definition).join("\n"),
      observation: `Development ${pp(confirmation.development!)}; confirmation ${pp(confirmation.gain!)}. Lower bound ${pp(confirmation.lowerBound!)}.`,
      reason:
        "The apparent development benefit did not survive fresh confirmation.",
    });
  return {
    version: "presentation-evidence-v1",
    simulatorVersion: off.simulatorVersion,
    reference: { seed: ref.seed, arrivals: ref.arrivals, count: ref.count },
    terrain: {
      accepted: off.arms
        .flatMap((a) => a.runs)
        .reduce((n, r) => n + r.macros, 0),
      guided: guided.runs.reduce((n, r) => n + r.arrivals, 0),
      unguided: plain.runs.reduce((n, r) => n + r.arrivals, 0),
      count,
    },
    scalar: {
      runs: scalar.completed,
      acceptedRuns: scalar.rows.filter((r) => r.macros.length > 0).length,
      discovery: scalar.rows.reduce((n, r) => n + r.comparison.discovery, 0),
      developmentPositive: scalar.rows.reduce(
        (n, r) => n + r.audit.developmentPositive,
        0,
      ),
      confirmationPositive: scalar.rows.reduce(
        (n, r) => n + r.audit.confirmationPositive,
        0,
      ),
      clearedUncertainty: scalar.rows.reduce(
        (n, r) => n + r.audit.clearedUncertainty,
        0,
      ),
    },
    rejections,
  };
}
