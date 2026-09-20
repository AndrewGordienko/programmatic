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
} from "./expressions";
import { distribution } from "./prior";
import {
  ARITY,
  BASE,
  type Expr,
  type Macro,
  type PriorData,
  type Solution,
  type Task,
} from "./types";
const depth = (e: Expr): number => 1 + Math.max(0, ...e.args.map(depth));
export function synthesize(
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
  const pick = () => {
    let n = rng.next();
    for (let i = 0; i < ops.length; i++) {
      n -= probs[i];
      if (n <= 0) return ops[i];
    }
    return ops.at(-1)!;
  };
  const random = (d: number): Expr => {
    if (d <= 0 || rng.next() < 0.3)
      return rng.next() < 0.7
        ? { op: "arg", value: rng.int(2), args: [] }
        : { op: "const", value: rng.pick([-2, -1, 0, 1, 2]), args: [] };
    const op = pick();
    return {
      op,
      args: Array.from(
        { length: ARITY[op] ?? macros.find((m) => m.name === op)!.arity },
        () => random(d - 1),
      ),
    };
  };
  type Candidate = {
    tree: Expr;
    error: number;
    size: number;
    expanded: number;
  };
  let pool: Candidate[] = [],
    best: Candidate | null = null,
    count = 0,
    invalid = 0,
    duplicates = 0,
    macroProposals = 0;
  const seen = new Set<string>(),
    population = 32;
  const macroCount = (e: Expr): number =>
    Number(!BASE.includes(e.op) && e.op !== "arg" && e.op !== "const") +
    e.args.reduce((s, a) => s + macroCount(a), 0);
  while (count < budget) {
    const batch: Candidate[] = pool.slice(0, 3);
    while (batch.length < population && count < budget) {
      let tree: Expr;
      if (!pool.length || rng.next() < 0.3) tree = random(2 + rng.int(3));
      else {
        const parent = rng.pick(pool.slice(0, 8)).tree,
          path = rng.pick(paths(parent)),
          donor = rng.pick(pool).tree;
        tree = replace(
          parent,
          path,
          rng.next() < 0.22
            ? at(donor, rng.pick(paths(donor)))
            : random(rng.int(3)),
        );
      }
      let size = exprSize(tree),
        expanded = exprSize(expandExpr(tree, macros));
      if (size > 31 || expanded > 96 || depth(tree) > 10) {
        invalid++;
        tree = { op: "arg", args: [], value: rng.int(2) };
        size = expanded = 1;
      }
      const signature = key(tree);
      if (seen.has(signature)) duplicates++;
      seen.add(signature);
      if (macroCount(tree) > 0) macroProposals++;
      const f = compile(tree, macros);
      let error = 0;
      for (const e of task.examples) {
        const d = Math.abs(f(...e.input) - e.output);
        error += Number.isFinite(d) ? Math.min(1e6, d) : 1e6;
      }
      error /= task.examples.length;
      count++;
      const candidate = { tree, error, size, expanded };
      batch.push(candidate);
      if (
        !best ||
        error < best.error ||
        (error === best.error && size < best.size)
      )
        best = candidate;
      // Stop on SEARCH examples only. Independent checks never steer the search.
      if (error < 1e-8) break;
    }
    if (best!.error < 1e-8) break;
    pool = batch
      .sort((a, b) => a.error - b.error || a.size - b.size)
      .slice(0, population);
  }
  const b = best!,
    f = compile(b.tree, macros);
  const checkError =
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
    depth: depth(b.tree),
  };
}
