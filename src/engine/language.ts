import { Random } from "./random";

// A deliberately small grammar-induction experiment, separate from navigation.
// Task targets are accessible ONLY to the fitness oracle; they are never supplied
// as syntax, initial solutions, or macro candidates to the synthesizer.
export type Expr = { op: string; args: Expr[]; value?: number };
export type Macro = {
  name: string;
  body: Expr;
  arity: number;
  support: number;
  sourceTasks: string[];
  definition: string;
  size: number;
};
export type Synthesis = {
  tree: Expr;
  error: number;
  validationError: number;
  solved: boolean;
  firstSolved: number | null;
  evaluations: number;
  expression: string;
  size: number;
  expandedSize: number;
  macroCalls: number;
};
export type LanguageTrial = {
  task: string;
  label: string;
  seed: number;
  fixed: Synthesis;
  evolved: Synthesis;
};
export type Proposal = {
  macro: Macro;
  accepted: boolean;
  before: number;
  after: number;
  reason: string;
  evaluations: number;
};
export type LanguageResult = {
  seed: number;
  rounds: number;
  macros: Macro[];
  proposals: Proposal[];
  induction: { task: string; solution: Synthesis }[];
  trials: LanguageTrial[];
  discoveryEvaluations: number;
  comparisonEvaluations: number;
  elapsedMs: number;
  phase: string;
  progress: number;
  completed: boolean;
};
type Task = {
  id: string;
  label: string;
  target: (x: number, y: number) => number;
};
const BASE = ["add", "sub", "mul", "min", "max", "neg"];
const ARITY: Record<string, number> = {
  add: 2,
  sub: 2,
  mul: 2,
  min: 2,
  max: 2,
  neg: 1,
};
const MAX_NODES = 25,
  MAX_EXPANDED = 60;
const positive = (x: number) => Math.max(0, x),
  clamp = (x: number) => Math.min(1, Math.max(0, x));
const INDUCTION: Task[] = [
  { id: "positive-x", label: "Positive component", target: (x) => positive(x) },
  {
    id: "positive-gap",
    label: "Positive difference",
    target: (x, y) => positive(y - x),
  },
  { id: "absolute-x", label: "Signal magnitude", target: (x) => Math.abs(x) },
  {
    id: "absolute-y",
    label: "Second signal magnitude",
    target: (_, y) => Math.abs(y),
  },
  { id: "bounded-x", label: "Bounded signal", target: (x) => clamp(x) },
  {
    id: "bounded-y",
    label: "Second bounded signal",
    target: (_, y) => clamp(y),
  },
];
// Development tasks choose the grammar; final tasks below are never consulted
// during mining, proposal ranking, or acceptance. This is a task-level split.
const DEVELOPMENT: Task[] = [
  {
    id: "sum-positive",
    label: "Combined positive components",
    target: (x, y) => positive(x) + positive(y),
  },
  {
    id: "sum-absolute",
    label: "Combined magnitudes",
    target: (x, y) => Math.abs(x) + Math.abs(y),
  },
  {
    id: "sum-bounded",
    label: "Combined bounded signals",
    target: (x, y) => clamp(x) + clamp(y),
  },
];
const FINAL: Task[] = [
  {
    id: "absolute-gap",
    label: "Magnitude of a difference",
    target: (x, y) => Math.abs(x - y),
  },
  {
    id: "positive-sum",
    label: "Positive part of a sum",
    target: (x, y) => positive(x + y),
  },
  { id: "bounded-sum", label: "Bounded sum", target: (x, y) => clamp(x + y) },
];

export const exprSize = (e: Expr): number =>
  1 + e.args.reduce((n, a) => n + exprSize(a), 0);
export function formatExpr(e: Expr, params = ["x", "y"]): string {
  const a = e.args.map((arg) => formatExpr(arg, params));
  if (e.op === "arg") return params[e.value ?? 0];
  if (e.op === "const") return String(e.value);
  if (e.op === "neg") return `(-${a[0]})`;
  if (["add", "sub", "mul"].includes(e.op))
    return `(${a[0]} ${{ add: "+", sub: "-", mul: "*" }[e.op]} ${a[1]})`;
  return `${e.op}(${a.join(", ")})`;
}

export function evalExpr(
  e: Expr,
  values: number[],
  macros: Macro[] = [],
): number {
  if (e.op === "arg") return values[e.value ?? 0];
  if (e.op === "const") return e.value ?? 0;
  const a = e.args.map((arg) => evalExpr(arg, values, macros));
  switch (e.op) {
    case "add":
      return a[0] + a[1];
    case "sub":
      return a[0] - a[1];
    case "mul":
      return a[0] * a[1];
    case "min":
      return Math.min(...a);
    case "max":
      return Math.max(...a);
    case "neg":
      return -a[0];
    default: {
      const macro = macros.find((m) => m.name === e.op);
      if (!macro) throw new Error(`Unknown DSL operator ${e.op}`);
      return evalExpr(macro.body, a, macros);
    }
  }
}

export function expandExpr(e: Expr, macros: Macro[]): Expr {
  const macro = macros.find((m) => m.name === e.op);
  if (!macro) return { ...e, args: e.args.map((a) => expandExpr(a, macros)) };
  const args = e.args.map((a) => expandExpr(a, macros));
  const substitute = (body: Expr): Expr =>
    body.op === "arg"
      ? args[body.value ?? 0]
      : { ...body, args: body.args.map(substitute) };
  return expandExpr(substitute(macro.body), macros);
}

function randomExpr(rng: Random, macros: Macro[], depth: number): Expr {
  if (depth <= 0 || rng.next() < 0.28)
    return rng.next() < 0.67
      ? { op: "arg", value: rng.int(2), args: [] }
      : { op: "const", value: rng.pick([-1, 0, 1, 2]), args: [] };
  const op = rng.pick([...BASE, ...macros.map((m) => m.name)]);
  const arity = ARITY[op] ?? macros.find((m) => m.name === op)!.arity;
  return {
    op,
    args: Array.from({ length: arity }, () =>
      randomExpr(rng, macros, depth - 1),
    ),
  };
}
function paths(e: Expr, prefix: number[] = []): number[][] {
  return [prefix, ...e.args.flatMap((a, i) => paths(a, [...prefix, i]))];
}
function at(e: Expr, path: number[]): Expr {
  return path.reduce((node, i) => node.args[i], e);
}
function replace(e: Expr, path: number[], node: Expr): Expr {
  if (!path.length) return node;
  return {
    ...e,
    args: e.args.map((a, i) =>
      i === path[0] ? replace(a, path.slice(1), node) : a,
    ),
  };
}
function examples(seed: number, count: number, range: number): number[][] {
  const rng = new Random(seed);
  return [
    [0, 0],
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, -1],
    ...Array.from({ length: count - 5 }, () => [
      (rng.next() * 2 - 1) * range,
      (rng.next() * 2 - 1) * range,
    ]),
  ];
}
function loss(
  tree: Expr,
  task: Task,
  samples: number[][],
  macros: Macro[],
): number {
  let sum = 0;
  for (const [x, y] of samples) {
    const delta = Math.abs(evalExpr(tree, [x, y], macros) - task.target(x, y));
    if (!Number.isFinite(delta)) return 1e9;
    sum += Math.min(1e6, delta);
  }
  return sum / samples.length;
}

export function synthesize(
  task: Task,
  macros: Macro[],
  seed: number,
  population = 40,
  generations = 18,
): Synthesis {
  const rng = new Random(seed);
  // Sample sets do not depend on the grammar or the optimizer seed.
  const train = examples(301, 25, 3),
    validation = examples(809, 65, 5);
  type Member = { tree: Expr; error: number; cost: number; expanded: number };
  let pool: Member[] = [],
    evaluations = 0,
    firstSolved: number | null = null;
  for (let generation = 0; generation < generations; generation++) {
    const next = pool.slice(0, 3);
    while (next.length < population) {
      let tree: Expr;
      if (!pool.length || rng.next() < 0.23)
        tree = randomExpr(rng, macros, 2 + rng.int(3));
      else {
        const parent = rng.pick(
          pool.slice(0, Math.max(4, population / 4)),
        ).tree;
        const path = rng.pick(paths(parent));
        const donor = rng.pick(pool).tree;
        const child =
          rng.next() < 0.28
            ? at(donor, rng.pick(paths(donor)))
            : randomExpr(rng, macros, rng.int(3));
        tree = replace(parent, path, child);
      }
      let size = exprSize(tree),
        expanded = exprSize(expandExpr(tree, macros));
      if (size > MAX_NODES || expanded > MAX_EXPANDED) {
        tree = { op: "arg", value: rng.int(2), args: [] };
        size = 1;
        expanded = 1;
      }
      const error = loss(tree, task, train, macros);
      evaluations++;
      // Validation is never used to drive selection. Exact-solve timing is
      // measured only on search examples; final solved status also uses validation.
      if (error < 1e-8 && firstSolved === null) firstSolved = evaluations;
      next.push({ tree, error, cost: size, expanded });
    }
    pool = next.sort(
      (a, b) => a.error - b.error || a.cost - b.cost || a.expanded - b.expanded,
    );
  }
  const best = pool[0],
    validationError = loss(best.tree, task, validation, macros);
  const macroCalls = (tree: Expr): number =>
    Number(macros.some((m) => m.name === tree.op)) +
    tree.args.reduce((sum, a) => sum + macroCalls(a), 0);
  return {
    tree: best.tree,
    error: best.error,
    validationError,
    solved: best.error < 1e-8 && validationError < 1e-8,
    firstSolved,
    evaluations,
    expression: formatExpr(best.tree),
    size: best.cost,
    expandedSize: best.expanded,
    macroCalls: macroCalls(best.tree),
  };
}

export function mineMacros(
  solutions: { task: string; solution: Synthesis }[],
  existing: Macro[] = [],
): Macro[] {
  const candidates = new Map<
    string,
    { body: Expr; arity: number; tasks: Set<string> }
  >();
  for (const { task, solution } of solutions) {
    if (!solution.solved) continue;
    for (const path of paths(solution.tree)) {
      const subtree = at(solution.tree, path);
      const map = new Map<number, number>();
      const canonical = (e: Expr): Expr => {
        if (e.op === "arg") {
          const n = e.value ?? 0;
          if (!map.has(n)) map.set(n, map.size);
          return { op: "arg", args: [], value: map.get(n)! };
        }
        return { ...e, args: e.args.map(canonical) };
      };
      const body = canonical(subtree),
        size = exprSize(body),
        arity = map.size;
      if (!arity || size < arity + 2 || size > 13) continue;
      const key = JSON.stringify(body);
      const known = candidates.get(key);
      if (known) known.tasks.add(task);
      else candidates.set(key, { body, arity, tasks: new Set([task]) });
    }
  }
  const probes = examples(1771, 17, 4);
  const signatures = new Set(
    existing.map((m) =>
      probes.map((p) => evalExpr(m.body, p, existing).toFixed(6)).join(","),
    ),
  );
  const out: Macro[] = [];
  for (const { body, arity, tasks } of candidates.values()) {
    const values = probes.map((p) => evalExpr(body, p, existing));
    if (
      values.every((v) => Math.abs(v - values[0]) < 1e-8) ||
      [0, 1].some((i) =>
        values.every((v, j) => Math.abs(v - probes[j][i]) < 1e-8),
      )
    )
      continue;
    const signature = values.map((v) => v.toFixed(6)).join(",");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const name = `fn_${existing.length + out.length + 1}`;
    out.push({
      name,
      body,
      arity,
      support: tasks.size,
      sourceTasks: [...tasks],
      definition: `${name}(${["a", "b"].slice(0, arity).join(", ")}) = ${formatExpr(body, ["a", "b"])}`,
      size: exprSize(body),
    });
  }
  return out.sort(
    (a, b) =>
      b.support * (b.size - b.arity - 1) - a.support * (a.size - a.arity - 1),
  );
}

export function* evolveLanguage(
  seed = 42,
  rounds = 2,
): Generator<LanguageResult, LanguageResult> {
  const start = performance.now();
  const result: LanguageResult = {
    seed,
    rounds,
    macros: [],
    proposals: [],
    induction: [],
    trials: [],
    discoveryEvaluations: 0,
    comparisonEvaluations: 0,
    elapsedMs: 0,
    phase: "Discovering programs in the base language",
    progress: 0,
    completed: false,
  };
  const checkpoint = (phase: string, progress: number) => {
    result.phase = phase;
    result.progress = progress;
    result.elapsedMs = performance.now() - start;
    return structuredClone(result);
  };
  for (let round = 0; round < rounds; round++) {
    const solutions: { task: string; solution: Synthesis }[] = [];
    for (let i = 0; i < INDUCTION.length; i++) {
      const solution = synthesize(
        INDUCTION[i],
        result.macros,
        seed + round * 7000 + i * 271,
        56,
        30,
      );
      result.discoveryEvaluations += solution.evaluations;
      solutions.push({ task: INDUCTION[i].label, solution });
      result.induction = solutions;
      yield checkpoint(
        `Round ${round + 1}: synthesizing ${INDUCTION[i].label.toLowerCase()}`,
        round * 30 + i * 2,
      );
    }
    const proposals = mineMacros(solutions, result.macros).slice(0, 4);
    // The incumbent and every proposal receive exactly the same fresh inner
    // search budget, task set, and optimizer seeds. Charge ALL of this to discovery.
    const evaluateGrammar = (macros: Macro[]) => {
      let score = 0,
        count = 0;
      for (let task = 0; task < DEVELOPMENT.length; task++)
        for (let replicate = 0; replicate < 2; replicate++) {
          const s = synthesize(
            DEVELOPMENT[task],
            macros,
            seed + 100000 + task * 97 + replicate * 1009,
          );
          result.discoveryEvaluations += s.evaluations;
          count += s.evaluations;
          score +=
            Number(s.solved) * 2 + 1 / (1 + s.validationError) - s.size * 0.001;
        }
      return { score: score / 6, count };
    };
    const baseline = evaluateGrammar(result.macros);
    let best: { macro: Macro; score: number; proposal: Proposal } | null = null;
    for (let p = 0; p < proposals.length; p++) {
      const source = proposals[p];
      const name = `fn_${result.macros.length + 1}`;
      const macro = {
        ...source,
        name,
        definition: source.definition.replace(/fn_\d+\(/, `${name}(`),
      };
      const measured = evaluateGrammar([...result.macros, macro]);
      const proposal: Proposal = {
        macro,
        accepted: false,
        before: baseline.score,
        after: measured.score,
        reason:
          measured.score > baseline.score + 0.005
            ? "Improves development-task search; awaiting comparison with other proposals."
            : "No measured improvement over the incumbent language.",
        evaluations: measured.count,
      };
      result.proposals.push(proposal);
      if (
        measured.score > baseline.score + 0.005 &&
        (!best || measured.score > best.score)
      )
        best = { macro, score: measured.score, proposal };
      yield checkpoint(
        `Round ${round + 1}: testing abstraction ${p + 1} of ${proposals.length}`,
        round * 30 + 13 + p * 4,
      );
    }
    if (best) {
      best.proposal.accepted = true;
      best.proposal.reason =
        "Best measured development-task improvement in this round. Added to the language.";
      result.macros.push(best.macro);
    }
    for (const proposal of result.proposals)
      if (!proposal.accepted && proposal.reason.includes("awaiting"))
        proposal.reason = "Another proposal performed better in this round.";
    yield checkpoint(
      `Round ${round + 1} complete: ${result.macros.length} accepted abstractions`,
      (round + 1) * 30,
    );
  }
  // Neither these task targets nor outcomes influenced grammar selection.
  for (let i = 0; i < FINAL.length; i++)
    for (let replicate = 0; replicate < 3; replicate++) {
      const trialSeed = seed + 400000 + i * 101 + replicate * 1009;
      const fixed = synthesize(FINAL[i], [], trialSeed),
        evolved = synthesize(FINAL[i], result.macros, trialSeed);
      result.comparisonEvaluations += fixed.evaluations + evolved.evaluations;
      result.trials.push({
        task: FINAL[i].id,
        label: FINAL[i].label,
        seed: trialSeed,
        fixed,
        evolved,
      });
      yield checkpoint(
        `Held-out comparison: ${i * 3 + replicate + 1} of 9 paired trials`,
        60 + (i * 3 + replicate + 1) * 4,
      );
    }
  result.completed = true;
  return checkpoint("Experiment complete", 100);
}
