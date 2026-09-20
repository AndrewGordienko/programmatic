import { expandExpr, exprSize, formatExpr } from "./expressions";
import { mine } from "./mining";
import { distribution, fitPrior } from "./prior";
import { synthesize } from "./search";
import { makeTasks } from "./tasks";
import {
  ARMS,
  BASE,
  DEFAULT,
  type Arm,
  type Budget,
  type Config,
  type CorpusEntry,
  type Macro,
  type PriorData,
  type Proposal,
  type Result,
  type Solution,
  type Task,
} from "./types";

export const utility = (s: Solution) =>
  s.solved ? 1 - (0.5 * s.effort) / s.budget : 0;
export function pairedGain(a: Solution[], b: Solution[], replicates: number) {
  const deltas = a.map((x, i) => utility(b[i]) - utility(x));
  const grouped = Array.from(
    { length: a.length / replicates },
    (_, i) =>
      deltas
        .slice(i * replicates, (i + 1) * replicates)
        .reduce((s, d) => s + d, 0) / replicates,
  );
  const mean = grouped.reduce((s, d) => s + d, 0) / grouped.length;
  const se =
    grouped.length > 1
      ? Math.sqrt(
          grouped.reduce((s, d) => s + (d - mean) ** 2, 0) /
            (grouped.length - 1) /
            grouped.length,
        )
      : Infinity;
  const seedScores = Array.from(
    { length: replicates },
    (_, r) =>
      deltas.filter((_, i) => i % replicates === r).reduce((s, d) => s + d, 0) /
      (a.length / replicates),
  );
  return {
    mean,
    lowerBound: mean - 2 * se,
    seedScores,
    seedWins: seedScores.filter((v) => v > 0).length,
  };
}
export function validConfig(c: Config) {
  for (const [k, v] of Object.entries(c))
    if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid ${k}`);
  if (
    c.seed > 999999 ||
    c.rounds < 1 ||
    c.rounds > 4 ||
    c.training < 4 ||
    c.development < 4 ||
    c.confirmation < c.rounds * 2 ||
    c.testing < 4 ||
    c.replicates < 2 ||
    c.replicates > 5 ||
    c.shortlist < 1 ||
    c.shortlist > 20 ||
    c.finalists < 1 ||
    c.finalists > c.shortlist
  )
    throw new Error("Configuration outside supported bounds.");
  for (const k of [
    "wakeBudget",
    "finalBudget",
    "screenBudget",
    "developmentBudget",
    "confirmationBudget",
  ] as const)
    if (c[k] < 32 || c[k] > 8192)
      throw new Error("Search budgets must be 32–8192.");
}
export function* experiment(
  config: Config = DEFAULT,
): Generator<Result, Result> {
  validConfig(config);
  const start = performance.now(),
    tasks = makeTasks(config),
    corpus = new Map<string, CorpusEntry>();
  const r: Result = {
    version: "library-search-v1",
    config,
    phase: "Starting",
    progress: 0,
    completed: false,
    macros: [],
    rounds: [],
    proposals: [],
    trials: [],
    corpus: [],
    priors: {},
    probabilities: [],
    splits: Object.fromEntries(
      Object.entries(tasks).map(([k, v]) => [k, v.map((t) => t.id)]),
    ),
    budget: {
      wake: 0,
      screen: 0,
      development: 0,
      confirmation: 0,
      final: 0,
      searchCalls: 0,
      priorFits: 0,
      priorMs: 0,
    },
    elapsedMs: 0,
    discoveryMs: 0,
  };
  const checkpoint = (phase: string, progress: number) => {
    r.phase = phase;
    r.progress = progress;
    r.elapsedMs = performance.now() - start;
    return structuredClone(r);
  };
  const fit = (ms: Macro[], salt = 0) => {
    const t = performance.now(),
      p = fitPrior([...corpus.values()], ms, config.seed + 92000 + salt);
    r.budget.priorFits++;
    r.budget.priorMs += performance.now() - t;
    return p;
  };
  const run = (
    t: Task,
    ms: Macro[],
    p: PriorData | undefined,
    seed: number,
    budget: number,
    category: keyof Pick<
      Budget,
      "wake" | "screen" | "development" | "confirmation" | "final"
    >,
  ) => {
    const s = synthesize(t, ms, p, seed, budget);
    r.budget[category] += s.evaluations;
    r.budget.searchCalls++;
    return s;
  };
  const races = (
    ts: Task[],
    ms: Macro[],
    p: PriorData,
    seed: number,
    budget: number,
    category: "screen" | "development" | "confirmation",
    reps = config.replicates,
  ) =>
    ts.flatMap((t, i) =>
      Array.from({ length: reps }, (_, j) =>
        run(t, ms, p, seed + i * 97 + j * 1009, budget, category),
      ),
    );
  const score = (xs: Solution[], ms: Macro[]) =>
    xs.reduce((s, x) => s + utility(x), 0) / xs.length -
    0.0005 * ms.reduce((s, m) => s + m.size, 0);
  let current: PriorData | undefined;
  for (let round = 0; round < config.rounds; round++) {
    for (let i = 0; i < tasks.training.length; i++) {
      const task = tasks.training[i],
        s = run(
          task,
          r.macros,
          current,
          config.seed + round * 100000 + i * 271,
          config.wakeBudget,
          "wake",
        );
      if (s.solved) {
        const tree = expandExpr(s.tree, r.macros),
          old = corpus.get(task.id);
        if (!old || exprSize(tree) < exprSize(old.tree))
          corpus.set(task.id, { task, tree });
      }
      if (i % 10 === 0)
        yield checkpoint(
          `Round ${round + 1}: solving training task ${i + 1}/${tasks.training.length}`,
          (round / config.rounds) * 65 +
            ((i / tasks.training.length) * 15) / config.rounds,
        );
    }
    r.corpus = [...corpus.values()].map((c) => ({
      task: c.task.id,
      expression: formatExpr(c.tree),
      tree: c.tree,
    }));
    current = fit(r.macros, round);
    const mined = mine([...corpus.values()], r.macros);
    const choices: Proposal[] = mined
      .slice(0, config.shortlist)
      .map(({ macro, compression }) => ({
        round: round + 1,
        label: `Add ${macro.name}`,
        macros: [...r.macros, macro],
        compression,
        stage: "compression",
        accepted: false,
        reason: "Ranked by actual corpus compression.",
        branching: 1 / (BASE.length + r.macros.length),
      }));
    // A joint edit exposes some delayed credit; deletion can undo a bad library bias.
    if (mined.length >= 2)
      choices.push({
        round: round + 1,
        label: `Compose library: ${mined[0].macro.name} + ${mined[1].macro.name}`,
        macros: [...r.macros, ...mined.slice(0, 2).map((m) => m.macro)],
        compression: mined[0].compression + mined[1].compression,
        stage: "compression",
        accepted: false,
        reason: "Joint two-abstraction candidate.",
      });
    for (const m of r.macros)
      choices.push({
        round: round + 1,
        label: `Delete ${m.name}`,
        macros: r.macros.filter((x) => x.name !== m.name),
        compression: m.size,
        stage: "compression",
        accepted: false,
        reason: "Deletion candidate.",
      });
    r.proposals.push(...choices);
    const priors = new Map<Proposal, PriorData>(),
      screenTasks = tasks.development.slice(0, 8),
      seed = config.seed + 300000 + round * 100000;
    const baseScreen = races(
      screenTasks,
      r.macros,
      current,
      seed,
      config.screenBudget,
      "screen",
      2,
    );
    for (let i = 0; i < choices.length; i++) {
      const p = choices[i],
        prior = fit(p.macros, round);
      priors.set(p, prior);
      const xs = races(
        screenTasks,
        p.macros,
        prior,
        seed,
        config.screenBudget,
        "screen",
        2,
      );
      p.screen = score(xs, p.macros) - score(baseScreen, r.macros);
      p.stage = "short race";
      p.reason = "Short race completed; waiting for shortlist selection.";
      yield checkpoint(
        `Round ${round + 1}: short synthesis race ${i + 1}/${choices.length}`,
        (round / config.rounds) * 65 +
          20 / config.rounds +
          ((i / Math.max(1, choices.length)) * 15) / config.rounds,
      );
    }
    const finalists = [...choices]
      .sort((a, b) => b.screen! - a.screen!)
      .slice(0, config.finalists);
    for (const p of choices)
      if (!finalists.includes(p))
        p.reason = "Not shortlisted by short-budget development search.";
    const baseline = races(
      tasks.development,
      r.macros,
      current,
      seed + 30000,
      config.developmentBudget,
      "development",
    );
    for (let i = 0; i < finalists.length; i++) {
      const p = finalists[i],
        xs = races(
          tasks.development,
          p.macros,
          priors.get(p)!,
          seed + 30000,
          config.developmentBudget,
          "development",
        );
      p.development = score(xs, p.macros) - score(baseline, r.macros);
      p.stage = "full development";
      p.seedScores = pairedGain(baseline, xs, config.replicates).seedScores;
      p.reason = "Full development race completed.";
      yield checkpoint(
        `Round ${round + 1}: full development race ${i + 1}/${finalists.length}`,
        (round / config.rounds) * 65 +
          40 / config.rounds +
          ((i / Math.max(1, finalists.length)) * 12) / config.rounds,
      );
    }
    const best = [...finalists].sort(
      (a, b) => b.development! - a.development!,
    )[0];
    if (best && best.development! > 0) {
      // Each round uses a fresh, disjoint confirmation slice. Final test is untouched.
      const begin = Math.floor(
          (round * tasks.confirmation.length) / config.rounds,
        ),
        end = Math.floor(
          ((round + 1) * tasks.confirmation.length) / config.rounds,
        ),
        ts = tasks.confirmation.slice(begin, end);
      const before = races(
        ts,
        r.macros,
        current,
        seed + 60000,
        config.confirmationBudget,
        "confirmation",
      );
      const after = races(
        ts,
        best.macros,
        priors.get(best)!,
        seed + 60000,
        config.confirmationBudget,
        "confirmation",
      );
      const g = pairedGain(before, after, config.replicates),
        penalty =
          0.0005 *
          (best.macros.reduce((s, m) => s + m.size, 0) -
            r.macros.reduce((s, m) => s + m.size, 0));
      best.gain = g.mean - penalty;
      best.lowerBound = g.lowerBound - penalty;
      best.seedWins = g.seedWins;
      best.seedScores = g.seedScores;
      best.stage = "confirmation";
      best.accepted =
        best.lowerBound > 0 &&
        g.seedWins >= Math.ceil((config.replicates * 2) / 3) &&
        after.filter((s) => s.solved).length >=
          before.filter((s) => s.solved).length;
      best.reason = best.accepted
        ? "Accepted: positive task-clustered lower bound, majority seed gains, no loss in confirmed solves."
        : "Rejected: independent confirmation did not clear the uncertainty, consistency and solve-rate gates.";
      if (best.accepted) {
        r.macros = best.macros;
        current = priors.get(best)!;
      }
    }
    r.rounds.push({
      round: round + 1,
      corpus: corpus.size,
      candidates: mined.length,
      screened: choices.length,
      tested: finalists.length,
      accepted: best?.accepted ? best.label : null,
      librarySize: r.macros.length,
    });
    yield checkpoint(
      `Round ${round + 1} complete: ${r.macros.length} library definitions`,
      ((round + 1) / config.rounds) * 65,
    );
  }
  // Same solved corpus, expanded for fixed DSL and refactored for learned DSL.
  // Train independently; neither model sees test-task solutions or outcomes.
  r.priors.fixed = fit([], 999);
  r.priors.learned = fit(r.macros, 999);
  const ops = [...BASE, ...r.macros.map((m) => m.name)];
  r.probabilities = ops.map((op, i) => ({
    op,
    probability:
      tasks.training.reduce(
        (s, t) => s + distribution(r.priors.learned, t.examples, ops)[i],
        0,
      ) / tasks.training.length,
  }));
  r.discoveryMs = performance.now() - start;
  yield checkpoint(
    "DSL and both priors frozen. Beginning untouched test tasks.",
    65,
  );
  for (let i = 0; i < tasks.testing.length; i++)
    for (let j = 0; j < config.replicates; j++) {
      const task = tasks.testing[i],
        seed = config.seed + 1500000 + i * 101 + j * 1009;
      // Rotate execution order to reduce systematic wall-clock warmup bias.
      const order = ARMS.map((_, k) => ARMS[(k + i + j) % ARMS.length]);
      for (const arm of order) {
        const ms = arm.startsWith("library") ? r.macros : [],
          p = arm.endsWith("prior")
            ? arm.startsWith("library")
              ? r.priors.learned
              : r.priors.fixed
            : undefined;
        const solution = run(task, ms, p, seed, config.finalBudget, "final");
        r.trials.push({ task: task.id, arm, seed, solution });
      }
      if (j === config.replicates - 1)
        yield checkpoint(
          `Frozen test: ${i + 1}/${tasks.testing.length} tasks · four paired arms`,
          65 + ((i + 1) / tasks.testing.length) * 35,
        );
    }
  r.completed = true;
  return checkpoint(
    "Experiment complete. Final tests never updated the library or prior.",
    100,
  );
}

export function* ablations(r: Result): Generator<Result, Result> {
  if (!r.completed) throw new Error("Finish and freeze an experiment first.");
  const tasks = makeTasks(r.config).testing;
  const counts = new Map(r.macros.map((m) => [m.name, 0]));
  const visit = (e: Solution["tree"]) => {
    if (counts.has(e.op)) counts.set(e.op, counts.get(e.op)! + 1);
    e.args.forEach(visit);
  };
  r.trials
    .filter((t) => t.arm === "library-prior" && t.solution.solved)
    .forEach((t) => visit(t.solution.tree));
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const shuffled = structuredClone(r.macros);
  let changed = false;
  for (const arity of [1, 2, 3]) {
    const group = shuffled.filter((m) => m.arity === arity);
    if (group.length > 1) {
      const bodies = group.map((m) => m.body);
      group.forEach((m, i) => {
        m.body = bodies[(i + 1) % group.length];
      });
      changed = true;
    }
  }
  const variants = [
    {
      label: "Top-used macro removed",
      ms: r.macros.filter((m) => m.name !== top),
      applicable: !!top,
      reason:
        "Post-test intervention. Frozen prior is masked and renormalized; no retraining.",
    },
    {
      label: "Same-arity definitions shuffled",
      ms: shuffled,
      applicable: changed,
      reason: changed
        ? "Macro bodies permuted within arity groups; names and learned probabilities frozen."
        : "Needs at least two learned macros of the same arity.",
    },
  ];
  r.ablations = [];
  for (const v of variants) {
    const entry = {
      label: v.label,
      applicable: v.applicable,
      reason: v.reason,
      trials: [] as Result["trials"],
    };
    r.ablations.push(entry);
    if (!v.applicable) continue;
    for (let i = 0; i < tasks.length; i++) {
      for (let j = 0; j < r.config.replicates; j++) {
        const seed = r.config.seed + 1500000 + i * 101 + j * 1009;
        entry.trials.push({
          task: tasks[i].id,
          seed,
          arm: "library-prior" as Arm,
          solution: synthesize(
            tasks[i],
            v.ms,
            r.priors.learned,
            seed,
            r.config.finalBudget,
          ),
        });
      }
      r.phase = `${v.label}: ${i + 1}/${tasks.length}`;
      yield structuredClone(r);
    }
  }
  r.phase =
    "Ablations complete. These results cannot change the frozen experiment.";
  return structuredClone(r);
}
