import { Random } from "../engine/random";
import {
  at,
  compile,
  expandExpr,
  exprSize,
  formatExpr,
  key,
  paths,
  replace,
} from "../dsl/expressions";
import { distribution } from "../dsl/prior";
import {
  ARITY,
  BASE,
  type Expr,
  type Macro,
  type PriorData,
  type Solution,
  type Task,
} from "../dsl/types";

type Member = {
  tree: Expr;
  values: number[];
  error: number;
  size: number;
  expanded: number;
  depth: number;
};
const depth = (e: Expr): number => 1 + Math.max(0, ...e.args.map(depth));
const commutative = new Set(["add", "mul", "min", "max"]);
function normalize(e: Expr): Expr {
  const args = e.args.map(normalize);
  if (commutative.has(e.op) && key(args[0]) > key(args[1])) args.reverse();
  return { ...e, args };
}

// Generic fragment reuse + behavioral diversity. No target syntax, named
// concepts, affine fitting, inverse target oracle, or validation-driven updates.
export function synthesizeDiverse(
  task: Task,
  macros: Macro[],
  prior: PriorData | undefined,
  seed: number,
  budget: number,
): Solution {
  if (!Number.isInteger(budget) || budget < 1)
    throw new Error("Positive integer search budget required.");
  const start = performance.now(),
    rng = new Random(seed),
    ops = [...BASE, ...macros.map((m) => m.name)],
    probs = distribution(prior, task.examples, ops);
  const arity = (op: string) =>
    ARITY[op] ?? macros.find((m) => m.name === op)!.arity;
  const pickOp = () => {
    let p = rng.next();
    for (let i = 0; i < ops.length; i++) {
      p -= probs[i];
      if (p <= 0) return ops[i];
    }
    return ops.at(-1)!;
  };
  const terminals: Expr[] = [
    { op: "arg", value: 0, args: [] },
    { op: "arg", value: 1, args: [] },
    ...[-2, -1, 0, 1, 2].map((value) => ({ op: "const", value, args: [] })),
  ];
  // Enumerate shallow building blocks in a seed/prior-dependent order.
  const initial = ops
    .flatMap((op) =>
      arity(op) === 1
        ? terminals.map((a) => ({ op, args: [a] }))
        : arity(op) === 2
          ? terminals.flatMap((a) =>
              terminals.map((b) => ({ op, args: [a, b] })),
            )
          : [],
    )
    .map((tree) => ({
      tree,
      rank: -Math.log(Math.max(1e-9, rng.next())) / probs[ops.indexOf(tree.op)],
    }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.tree);
  const queue = [...terminals, ...initial],
    syntax = new Set<string>(),
    behaviors = new Map<string, Member>();
  let bank: Member[] = [],
    elite: Member[] = [],
    best: Member | null = null,
    count = 0,
    duplicates = 0,
    invalid = 0,
    macroProposals = 0;
  const macroCount = (e: Expr): number =>
    Number(e.op.startsWith("fn_")) +
    e.args.reduce((s, a) => s + macroCount(a), 0);
  const refresh = () => {
    const all = [...behaviors.values()];
    elite = [...all]
      .sort((a, b) => a.error - b.error || a.size - b.size)
      .slice(0, 24);
    // Keep useful partial computations even when they are not close to the
    // complete target. Small size strata prevent their loss to larger elites.
    bank = [];
    for (let size = 1; size <= 15; size++) {
      const layer = all.filter((a) => a.size === size);
      const byError = [...layer].sort((a, b) => a.error - b.error).slice(0, 8);
      const random = [...layer]
        .sort((a, b) => a.expanded - b.expanded)
        .slice(0, 80);
      for (let j = 0; j < 8 && random.length; j++)
        byError.push(random.splice(rng.int(random.length), 1)[0]);
      bank.push(...new Set(byError));
    }
    bank.push(...elite);
  };
  const select = (): Member => {
    if (rng.next() < 0.5) return rng.pick(bank);
    // Approximate lexicase on randomly sampled I/O cases retains complementary
    // partial solutions to piecewise tasks; it does not look at check examples.
    let choices = Array.from({ length: 8 }, () => rng.pick(bank));
    for (let k = 0; k < 3 && choices.length > 1; k++) {
      const i = rng.int(task.examples.length),
        target = task.examples[i].output;
      const errors = choices.map((c) => Math.abs(c.values[i] - target)),
        min = Math.min(...errors);
      choices = choices.filter((_, j) => errors[j] <= min + 0.02);
    }
    return rng.pick(choices);
  };
  while (count < budget) {
    let tree: Expr;
    if (count < queue.length) tree = queue[count];
    else {
      const p = rng.next(),
        parent = select().tree;
      if (p < 0.65) {
        const op = pickOp();
        tree = {
          op,
          args: Array.from({ length: arity(op) }, () =>
            rng.next() < 0.22 ? rng.pick(terminals) : select().tree,
          ),
        };
      } else if (p < 0.88) {
        const path = rng.pick(paths(parent));
        tree = replace(parent, path, select().tree);
      } else {
        const path = rng.pick(paths(parent)),
          old = at(parent, path),
          op = pickOp();
        tree = replace(parent, path, {
          op,
          args: Array.from({ length: arity(op) }, (_, i) =>
            i === 0 ? old : rng.pick(terminals),
          ),
        });
      }
    }
    tree = normalize(tree);
    const size = exprSize(tree),
      expanded = exprSize(expandExpr(tree, macros)),
      d = depth(tree);
    count++;
    if (size > 31 || expanded > 96 || d > 10) {
      invalid++;
      continue;
    }
    const signature = key(tree);
    // Charge duplicates against the same proposal budget, even though caching
    // avoids executing them again. Wall time is also reported separately.
    if (syntax.has(signature)) {
      duplicates++;
      continue;
    }
    syntax.add(signature);
    const f = compile(tree, macros),
      values = task.examples.map((e) => f(...e.input));
    const error =
      values.reduce(
        (s, v, i) =>
          s +
          (Number.isFinite(v)
            ? Math.min(1e6, Math.abs(v - task.examples[i].output))
            : 1e6),
        0,
      ) / values.length;
    const member = { tree, values, error, size, expanded, depth: d };
    if (macroCount(tree)) macroProposals++;
    if (
      !best ||
      error < best.error ||
      (error === best.error && size < best.size)
    )
      best = member;
    const behavior = values
      .map((v) => (Number.isFinite(v) ? v.toFixed(7) : "invalid"))
      .join(",");
    const old = behaviors.get(behavior);
    if (!old || size < old.size) behaviors.set(behavior, member);
    if (count <= terminals.length || count % 32 === 0 || count === queue.length)
      refresh();
    if (error < 1e-8) break;
  }
  const b = best!,
    f = compile(b.tree, macros),
    checkError =
      task.checks.reduce(
        (s, e) => s + Math.min(1e6, Math.abs(f(...e.input) - e.output)),
        0,
      ) / task.checks.length;
  const solved = b.error < 1e-8 && checkError < 1e-8;
  return {
    tree: b.tree,
    expression: formatExpr(b.tree),
    solved,
    evaluations: count,
    effort: solved ? count : budget,
    budget,
    trainError: b.error,
    checkError,
    nodes: b.size,
    expandedNodes: b.expanded,
    macroCalls: macroCount(b.tree),
    elapsedMs: performance.now() - start,
    duplicates,
    validFraction: 1 - invalid / count,
    macroProposalFraction: macroProposals / count,
    entropy: -probs.reduce((s, p) => s + p * Math.log(p), 0),
    depth: b.depth,
  };
}
