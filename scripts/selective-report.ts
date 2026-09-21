import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Random } from "../src/engine/random";
import { validLibrary } from "../src/dsl/expressions";
import { aliasesBase } from "../src/joint/semantics";
import type { Genome } from "../src/joint/genome";
import type { InverseResult } from "../src/joint/inverse";
const folder = "output/joint/selective-evolution-v1",
  protocol = JSON.parse(readFileSync(`${folder}/protocol.json`, "utf8"));
const policy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
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
  selector: string;
  protocolHash: string;
  candidate: Genome;
  frozenHash: string;
  accepted: boolean;
  trainingSignatures: string[];
  splitSignatures: Record<string, string[]>;
  trials: Trial[];
  rounds: {
    screen: { genome: Genome }[];
    screened: number;
    proposals: number;
  }[];
  cost: {
    incrementalEvaluations: number;
    incrementalExpansions: number;
    discoveryWallMs: number;
    candidateQueries: number;
    rankingMs: number;
  };
};
const runs: Run[] = protocol.config.seeds.flatMap((seed: number) =>
  protocol.config.selectors
    .filter((s: string) =>
      existsSync(`${folder}/seed-${seed}-${s}.summary.json`),
    )
    .map((selector: string) =>
      JSON.parse(
        gunzipSync(
          readFileSync(`${folder}/seed-${seed}-${selector}.json.gz`),
        ).toString(),
      ),
    ),
);
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const bounds = (xs: number[]) => {
  if (!xs.length) return null;
  if (xs.length < 2)
    return {
      mean: mean(xs),
      lower: null,
      upper: null,
      pairedMetaSeeds: xs.length,
    };
  const r = new Random(982731);
  const boot = Array.from({ length: 10000 }, () =>
    mean(xs.map(() => r.pick(xs))),
  ).sort((a, b) => a - b);
  return {
    mean: mean(xs),
    lower: boot[249],
    upper: boot[9749],
    pairedMetaSeeds: xs.length,
  };
};
const u = (r: InverseResult) =>
  r.solved ? 1 - r.work / (r.budget + r.expansionBudget) : 0;
const groups = [
  "all",
  "Related compositions",
  "Nested compositions",
  "Longer expressions",
];
const metrics = {
  solve: (r: InverseResult) => Number(r.solved),
  workAuc: u,
  work: (r: InverseResult) => r.work,
  wallMs: (r: InverseResult) => r.elapsedMs,
};
const score = (
  r: Run,
  arm: string,
  group: string,
  f: (r: InverseResult) => number,
) =>
  mean(
    r.trials
      .filter(
        (t) =>
          t.arm ===
            (arm === "accepted-guided"
              ? r.accepted
                ? "candidate-guided"
                : "base-guided"
              : arm) &&
          (group === "all" || t.group === group),
      )
      .map((t) => f(t.result)),
  );
for (const r of runs) {
  assert.equal(r.protocolHash, protocol.protocolHash);
  assert.ok(
    validLibrary(r.candidate.macros) && !r.candidate.macros.some(aliasesBase),
  );
  assert.equal(
    r.frozenHash,
    createHash("sha256")
      .update(
        JSON.stringify({
          candidate: r.candidate,
          policy,
          config: protocol.config,
        }),
      )
      .digest("hex"),
  );
  const seen = new Set<string>();
  for (const sig of [
    ...r.trainingSignatures,
    ...Object.values(r.splitSignatures).flat(),
  ]) {
    assert.ok(!seen.has(sig));
    seen.add(sig);
  }
  for (const t of r.trials) {
    assert.ok(t.result.evaluations <= protocol.config.finalBudget);
    assert.ok(t.result.expansions <= 8 * protocol.config.finalBudget);
  }
  assert.equal(r.trials.length, protocol.config.testing * 3 * 4);
  for (let i = 0; i < r.rounds.length; i++) {
    const sealed = JSON.parse(
      readFileSync(
        `${folder}/seed-${r.seed}-${r.selector}.round-${i}.ranking.json`,
        "utf8",
      ),
    );
    assert.deepEqual(
      new Set(sealed.selected),
      new Set(r.rounds[i].screen.map((x) => x.genome.id)),
    );
  }
}
const completeSeeds: number[] = protocol.config.seeds.filter((s: number) =>
  protocol.config.selectors.every((method: string) =>
    runs.some((r) => r.seed === s && r.selector === method),
  ),
);
for (const seed of completeSeeds) {
  const paired = runs.filter((r) => r.seed === seed),
    first = paired[0];
  const comparable = (r: Run) =>
    r.trials
      .filter((t) => t.arm.startsWith("base"))
      .map((t) => {
        const { elapsedMs, ...result } = t.result;
        return { ...t, result };
      });
  for (const r of paired.slice(1)) {
    assert.deepEqual(r.trainingSignatures, first.trainingSignatures);
    assert.deepEqual(r.splitSignatures, first.splitSignatures);
    assert.deepEqual(comparable(r), comparable(first));
  }
}
const perRun = runs.map((r) => {
  const saving =
    score(r, "base-guided", "all", metrics.work) -
    score(r, "accepted-guided", "all", metrics.work);
  return {
    seed: r.seed,
    selector: r.selector,
    accepted: r.accepted,
    definitions: r.candidate.macros.map((m) => m.definition),
    cost: r.cost,
    projectedIncrementalPayback:
      saving > 0
        ? Math.ceil(
            (r.cost.incrementalEvaluations + r.cost.incrementalExpansions) /
              saving,
          )
        : null,
    groups: Object.fromEntries(
      groups.map((g) => [
        g,
        {
          baseSolve: score(r, "base-guided", g, metrics.solve),
          candidateSolve: score(r, "candidate-guided", g, metrics.solve),
          acceptedSolve: score(r, "accepted-guided", g, metrics.solve),
          baseAuc: score(r, "base-guided", g, u),
          candidateAuc: score(r, "candidate-guided", g, u),
          acceptedAuc: score(r, "accepted-guided", g, u),
        },
      ]),
    ),
  };
});
const pairedComparisons = Object.fromEntries(
  ["full", "compression"].map((other) => [
    other,
    {
      discoveryWorkRatio: bounds(
        completeSeeds.map((seed) => {
          const a = runs.find(
              (r) => r.seed === seed && r.selector === "value",
            )!,
            b = runs.find((r) => r.seed === seed && r.selector === other)!;
          return (
            (b.cost.incrementalEvaluations + b.cost.incrementalExpansions) /
            (a.cost.incrementalEvaluations + a.cost.incrementalExpansions)
          );
        }),
      ),
      groups: Object.fromEntries(
        groups.map((g) => [
          g,
          Object.fromEntries(
            Object.entries(metrics).map(([name, f]) => [
              name,
              bounds(
                completeSeeds.map(
                  (seed) =>
                    score(
                      runs.find(
                        (r) => r.seed === seed && r.selector === "value",
                      )!,
                      "accepted-guided",
                      g,
                      f,
                    ) -
                    score(
                      runs.find(
                        (r) => r.seed === seed && r.selector === other,
                      )!,
                      "accepted-guided",
                      g,
                      f,
                    ),
                ),
              ),
            ]),
          ),
        ]),
      ),
    },
  ]),
);
const result = {
  protocolHash: protocol.protocolHash,
  status:
    runs.length ===
    protocol.config.seeds.length * protocol.config.selectors.length
      ? "complete"
      : "partial",
  completed: runs.length,
  planned: 12,
  completePairedSeeds: completeSeeds,
  perRun,
  pairedComparisons,
  note: "Four-seed paired pilot. Shared base-arm trajectories are audited identical, excluding elapsed time. Paired comparisons use only complete triples and accepted-language fallback; raw rejected candidates remain in perRun. All libraries freeze before confirmation/final. Ratios concern full incremental language discovery including wake/confirmation; additional source-value-label investment, model training and shared policy are not erased. Payback is a per-run mean extrapolation, not observed amortization. Final group intervals are descriptive and no noninferiority margin was predeclared. Wall times are observational.",
};
writeFileSync(`${folder}/analysis.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      status: result.status,
      completed: result.completed,
      completePairedSeeds: completeSeeds,
      pairedComparisons,
    },
    null,
    2,
  ),
);
