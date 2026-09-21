import { Random } from "../engine/random";
import { synthesize } from "../dsl/search";
import { expandExpr } from "../dsl/expressions";
import { fitValue, predictValue } from "../dsl/value";
import type { CorpusEntry, Task } from "../dsl/types";
import { fitJoint, type JointPolicy } from "./policy";
import { genome, propose, type Genome } from "./genome";
import { search, auc, type SearchResult } from "./search";

export type JointConfig = {
  seed: number;
  rounds: number;
  proposals: number;
  shortlist: number;
  exploration: number;
  survivors: number;
  finalists: number;
  wakeBudget: number;
  screenBudget: number;
  mediumBudget: number;
  finalBudget: number;
  replicates: number;
  tasksPerStage: number;
  complexityPenalty: number;
  workPenalty: number;
  amortizationHorizon: number;
};
export const PILOT: JointConfig = {
  seed: 0,
  rounds: 2,
  proposals: 128,
  shortlist: 16,
  exploration: 4,
  survivors: 8,
  finalists: 4,
  wakeBudget: 1536,
  screenBudget: 128,
  mediumBudget: 512,
  finalBudget: 1024,
  replicates: 3,
  tasksPerStage: 12,
  complexityPenalty: 0.0005,
  workPenalty: 0.01,
  amortizationHorizon: 1000,
};
export type Suite = {
  training: Task[];
  development: Task[];
  confirmation: Task[];
  testing: Task[];
};
type Measurement = { task: string; replicate: number; result: SearchResult };
type Race = {
  genome: Genome;
  stage: string;
  rows: Measurement[];
  auc: number;
  score: number;
  evaluations: number;
  expansions: number;
  elapsedMs: number;
};
type Cost = {
  bootstrapEvaluations: number;
  wakeEvaluations: number;
  wakeExpansions: number;
  raceEvaluations: number;
  raceExpansions: number;
  confirmationEvaluations: number;
  confirmationExpansions: number;
  policyMs: number;
  policyDecisions: number;
  surrogateMs: number;
};
export function summarize(rows: SearchResult[]) {
  const n = rows.length;
  return {
    trials: n,
    solved: rows.filter((r) => r.solved).length,
    auc: rows.reduce((s, r) => s + auc(r), 0) / Math.max(1, n),
    evaluations: rows.reduce((s, r) => s + r.evaluations, 0),
    expansions: rows.reduce((s, r) => s + r.expansions, 0),
    effort: rows.reduce((s, r) => s + r.effort, 0),
    wallMs: rows.reduce((s, r) => s + r.elapsedMs, 0),
    macroUses: rows.filter((r) => r.solved && r.macroCalls > 0).length,
  };
}
export function confirmation(races: Race[], c: JointConfig) {
  const [base, candidate] = races;
  const ids = [...new Set(base.rows.map((r) => r.task))];
  const differences = ids.map((id) => {
    const score = (race: Race) =>
      race.rows
        .filter((r) => r.task === id)
        .reduce((s, r) => s + auc(r.result), 0) / c.replicates;
    return (
      score(candidate) -
      score(base) -
      c.complexityPenalty *
        candidate.genome.macros.reduce((s, m) => s + m.size, 0)
    );
  });
  const mean = differences.reduce((a, b) => a + b, 0) / differences.length;
  const se =
    differences.length > 1
      ? Math.sqrt(
          differences.reduce((s, d) => s + (d - mean) ** 2, 0) /
            (differences.length - 1) /
            differences.length,
        )
      : Infinity;
  return {
    mean,
    standardError: se,
    lowerHeuristicBound: mean - 2 * se,
    accepted:
      candidate.genome.macros.length > 0 &&
      differences.length >= 20 &&
      mean - 2 * se > 0,
    taskDifferences: differences,
    note: "Single frozen candidate, task-clustered mean ± 2 SE heuristic; not a sequential confidence guarantee.",
  };
}
export function experiment(
  suite: Suite,
  c: JointConfig,
  emit: (s: string) => void = () => {},
) {
  if (suite.development.length < c.rounds * 2 * c.tasksPerStage)
    throw new Error("Fresh development batches required for every stage");
  if (
    new Set(
      Object.values(suite)
        .flat()
        .map((t) => t.signature),
    ).size !== Object.values(suite).flat().length
  )
    throw new Error("Task splits overlap");
  const start = performance.now(),
    rng = new Random(c.seed),
    corpus: CorpusEntry[] = [];
  const cost: Cost = {
    bootstrapEvaluations: 0,
    wakeEvaluations: 0,
    wakeExpansions: 0,
    raceEvaluations: 0,
    raceExpansions: 0,
    confirmationEvaluations: 0,
    confirmationExpansions: 0,
    policyMs: 0,
    policyDecisions: 0,
    surrogateMs: 0,
  };
  for (let i = 0; i < suite.training.length; i++) {
    const task = suite.training[i],
      result = synthesize(
        task,
        [],
        undefined,
        c.seed * 100003 + i * 97,
        c.wakeBudget,
      );
    cost.bootstrapEvaluations += result.evaluations;
    if (result.solved) corpus.push({ task, tree: result.tree });
  }
  const bootstrapCoverage = corpus.length;
  emit(`seed ${c.seed}: bootstrap ${corpus.length}/${suite.training.length}`);
  const train = (library: Genome, previous?: JointPolicy) => {
    const t = performance.now(),
      p = fitJoint(
        corpus,
        library.macros,
        c.seed + 701 + (previous?.decisions ?? 0),
        previous,
      );
    cost.policyMs += performance.now() - t;
    cost.policyDecisions += p.decisions - (previous?.decisions ?? 0);
    return p;
  };
  let population = [genome([])],
    policy = train(population[0]);
  const labels: { x: number[]; y: number; round: number; genome: string }[] =
      [],
    rounds = [];
  const measure = (
    g: Genome,
    tasks: Task[],
    budget: number,
    reps: number,
    stage: string,
    round: number,
  ): Race => {
    const rows = tasks.flatMap((task, i) =>
      Array.from({ length: reps }, (_, replicate) => ({
        task: task.id,
        replicate,
        result: search(
          task,
          g.macros,
          policy,
          c.seed * 100003 + round * 10007 + i * 97 + replicate * 7919,
          budget,
        ),
      })),
    );
    const stats = summarize(rows.map((r) => r.result));
    if (stage === "confirmation") {
      cost.confirmationEvaluations += stats.evaluations;
      cost.confirmationExpansions += stats.expansions;
    } else {
      cost.raceEvaluations += stats.evaluations;
      cost.raceExpansions += stats.expansions;
    }
    const work = stats.evaluations + stats.expansions;
    return {
      genome: g,
      stage,
      rows,
      auc: stats.auc,
      evaluations: stats.evaluations,
      expansions: stats.expansions,
      elapsedMs: stats.wallMs,
      score:
        stats.auc -
        c.complexityPenalty * g.macros.reduce((s, m) => s + m.size, 0) -
        (c.workPenalty * work) / (rows.length * 9 * budget) -
        work / (c.amortizationHorizon * 9 * c.finalBudget),
    };
  };
  for (let round = 0; round < c.rounds; round++) {
    const candidates = propose(
      population,
      corpus,
      c.seed + round * 3001,
      c.proposals,
    );
    const t = performance.now();
    // Train on past rounds only. Rank and commit IDs before any current race.
    const value = labels.length ? fitValue(labels, 3) : undefined;
    if (value)
      value.features = [
        "definition count",
        "definition nodes",
        "mean arity",
        "total corpus support",
        "maximum corpus support",
        "corpus size",
        "distinct body operations",
        "syntactic savings proxy",
      ];
    const ranked = candidates.map((g) => ({
      genome: g,
      prediction: value
        ? predictValue(value, g.features)
        : g.macros.reduce((s, m) => s + m.support * (m.size - m.arity - 1), 0),
    }));
    ranked.sort(
      (a, b) =>
        b.prediction - a.prediction || a.genome.id.localeCompare(b.genome.id),
    );
    const selection = new Map(
      ranked.slice(0, c.shortlist).map((r) => [r.genome.id, r.genome]),
    );
    const rest = ranked.filter((r) => !selection.has(r.genome.id));
    for (let i = 0; i < c.exploration && rest.length; i++) {
      const selected = rest.splice(rng.int(rest.length), 1)[0];
      selection.set(selected.genome.id, selected.genome);
    }
    for (const g of population) selection.set(g.id, g);
    const base = genome([]);
    selection.set(base.id, base);
    cost.surrogateMs += performance.now() - t;
    const decision = {
      candidates: ranked.map((r) => ({
        id: r.genome.id,
        edit: r.genome.edit,
        prediction: r.prediction,
      })),
      selected: [...selection.keys()],
      modelTrainingRows: labels.length,
      model: value,
    };
    const start = round * c.tasksPerStage * 2;
    const screen = [...selection.values()].map((g) =>
      measure(
        g,
        suite.development.slice(start, start + c.tasksPerStage),
        c.screenBudget,
        1,
        "screen",
        round,
      ),
    );
    screen.sort(
      (a, b) => b.score - a.score || a.genome.id.localeCompare(b.genome.id),
    );
    // Labels share budget/stage: do not mix cheap and full utility targets.
    const baseScore = screen.find((r) => r.genome.id === base.id)!.score;
    for (const r of screen)
      labels.push({
        x: r.genome.features,
        y: r.score - baseScore,
        round,
        genome: r.genome.id,
      });
    const finalists = screen.slice(0, c.finalists).map((r) => r.genome);
    if (!finalists.some((g) => g.id === base.id)) finalists.push(base);
    const medium = finalists.map((g) =>
      measure(
        g,
        suite.development.slice(
          start + c.tasksPerStage,
          start + 2 * c.tasksPerStage,
        ),
        c.mediumBudget,
        2,
        "medium",
        round,
      ),
    );
    medium.sort(
      (a, b) => b.score - a.score || a.genome.id.localeCompare(b.genome.id),
    );
    const survivors = new Map(medium.map((r) => [r.genome.id, r.genome]));
    for (const r of screen)
      if (survivors.size < c.survivors) survivors.set(r.genome.id, r.genome);
    population = [...survivors.values()];
    const winner = medium[0].genome;
    // New solutions from TRAINING only feed the next joint policy/library cycle.
    let added = 0;
    for (let i = 0; i < suite.training.length; i++) {
      const task = suite.training[i];
      if (corpus.some((e) => e.task.id === task.id)) continue;
      const r = search(
        task,
        winner.macros,
        policy,
        c.seed * 100003 + round * 3001 + i,
        c.mediumBudget,
      );
      cost.wakeEvaluations += r.evaluations;
      cost.wakeExpansions += r.expansions;
      if (r.solved) {
        corpus.push({ task, tree: expandExpr(r.tree, winner.macros) });
        added++;
      }
    }
    policy = train(winner, policy);
    rounds.push({
      round,
      decision,
      screen,
      medium,
      survivors: population.map((g) => g.id),
      winner,
      added,
      corpus: corpus.length,
    });
    emit(
      `seed ${c.seed}: round ${round + 1}, ${candidates.length} languages → ${screen.length} short → ${medium.length} medium; winner ${winner.macros.length} macros, corpus ${corpus.length}`,
    );
  }
  // Exactly one development-selected library, with the final shared policy now frozen.
  const selected = rounds.at(-1)!.winner,
    policySnapshot = JSON.stringify(policy);
  const confirmed = [genome([]), selected].map((g) =>
    measure(
      g,
      suite.confirmation,
      c.finalBudget,
      c.replicates,
      "confirmation",
      c.rounds,
    ),
  );
  const confirm = confirmation(confirmed, c);
  const discoveryMs = performance.now() - start;
  emit(
    `seed ${c.seed}: frozen ${selected.macros.length} macros; confirmation ${confirm.mean.toFixed(4)}, lower ${confirm.lowerHeuristicBound.toFixed(4)}`,
  );
  const arms = [
    "fixed-uniform",
    "fixed-joint",
    "candidate-uniform",
    "candidate-joint",
  ] as const;
  const trials = suite.testing.flatMap((task, i) =>
    Array.from({ length: c.replicates }, (_, replicate) =>
      arms.map((arm) => ({
        task: task.id,
        group: task.group,
        replicate,
        arm,
        result: search(
          task,
          arm.startsWith("candidate") ? selected.macros : [],
          arm.endsWith("joint") ? policy : undefined,
          c.seed * 100003 + 900007 + i * 97 + replicate * 7919,
          c.finalBudget,
        ),
      })),
    ).flat(),
  );
  if (JSON.stringify(policy) !== policySnapshot)
    throw new Error("Frozen policy changed during testing");
  const summary = Object.fromEntries(
    arms.map((arm) => [
      arm,
      summarize(trials.filter((t) => t.arm === arm).map((t) => t.result)),
    ]),
  );
  return {
    version: "joint-language-v1" as const,
    config: c,
    bootstrapCoverage,
    corpusCoverage: corpus.length,
    splits: Object.fromEntries(
      Object.entries(suite).map(([k, ts]) => [
        k,
        ts.map((t) => ({ id: t.id, signature: t.signature, group: t.group })),
      ]),
    ),
    selected,
    policy,
    confirmation: confirm,
    confirmationRaces: confirmed,
    rounds,
    labels,
    trials,
    summary,
    cost,
    discoveryMs,
    elapsedMs: performance.now() - start,
    note: "Candidate selected on development and tested even if confirmation rejects it. No automatic promotion. Restricted scalar library genomes; no evolved types or semantics. Equal complete/partial caps, not equal CPU time.",
  };
}
