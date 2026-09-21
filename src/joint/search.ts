import { Random } from "../engine/random";
import {
  compile,
  exprSize,
  expandExpr,
  formatExpr,
  key,
  paths,
  at,
  replace,
} from "../dsl/expressions";
import type { Expr, Macro, Task } from "../dsl/types";
import {
  context,
  encoder,
  firstHole,
  hole,
  productions,
  type JointPolicy,
} from "./policy";

export type SearchResult = {
  tree: Expr;
  expression: string;
  solved: boolean;
  evaluations: number;
  expansions: number;
  budget: number;
  expansionBudget: number;
  effort: number;
  work: number;
  trainError: number;
  checkError: number;
  nodes: number;
  macroCalls: number;
  duplicates: number;
  elapsedMs: number;
  termination: "fit" | "evaluations" | "expansions" | "frontier";
};
type Item = { tree: Expr; cost: number; priority: number };
class Queue {
  rows: Item[] = [];
  push(row: Item) {
    this.rows.push(row);
    let i = this.rows.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.rows[p].priority <= row.priority) break;
      this.rows[i] = this.rows[p];
      i = p;
    }
    this.rows[i] = row;
  }
  pop() {
    const top = this.rows[0],
      last = this.rows.pop();
    if (!this.rows.length || !last) return top;
    let i = 0;
    while (i * 2 + 1 < this.rows.length) {
      let child = i * 2 + 1;
      if (
        child + 1 < this.rows.length &&
        this.rows[child + 1].priority < this.rows[child].priority
      )
        child++;
      if (last.priority <= this.rows[child].priority) break;
      this.rows[i] = this.rows[child];
      i = child;
    }
    this.rows[i] = last;
    return top;
  }
  trim() {
    if (this.rows.length > 2048) {
      const keep = this.rows
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 512);
      this.rows = [];
      keep.forEach((r) => this.push(r));
    }
  }
}
/** Bounded best-first hole expansion plus subtree-mutation restarts. Checks are
 * accessed exactly once after stopping; they cannot rank or resume a search. */
export function search(
  task: Pick<Task, "examples" | "checks">,
  macros: Macro[],
  policy: JointPolicy | undefined,
  seed: number,
  budget: number,
  expansionBudget = budget * 8,
): SearchResult {
  if (
    !Number.isInteger(budget) ||
    budget < 1 ||
    !Number.isInteger(expansionBudget) ||
    expansionBudget < 1
  )
    throw new Error("Positive integer budgets required");
  const start = performance.now(),
    rng = new Random(seed),
    ps = productions(macros),
    predict = encoder(policy, ps);
  const q = new Queue(),
    seen = new Set<string>();
  q.push({ tree: hole(), cost: 0, priority: 0 });
  let evaluations = 0,
    expansions = 0,
    duplicates = 0,
    best: Expr = { op: "const", value: 0, args: [] },
    error = Infinity;
  const pool: { tree: Expr; error: number }[] = [];
  let lastSampled = -1;
  while (
    q.rows.length &&
    evaluations < budget &&
    expansions < expansionBudget
  ) {
    // Interleave conditional stochastic completions with best-first expansion.
    // This reaches deeper trees before exhaustive prefix search gets there.
    if (evaluations % 2 === 0 && evaluations !== lastSampled) {
      lastSampled = evaluations;
      let partial = hole();
      if (pool.length && rng.next() < 0.7) {
        const parent = rng.pick(pool.slice(0, 8)).tree;
        partial = replace(parent, rng.pick(paths(parent)), hole());
      }
      const depthLimit = 2 + rng.int(4);
      let h = firstHole(partial);
      while (h && expansions < expansionBudget) {
        const probabilities = predict(
          context(task.examples, partial, h, ps, macros),
        );
        const terminal =
          h.length >= depthLimit || exprSize(partial) >= 29 || rng.next() < 0.3;
        const legal = ps
          .map((p, i) => ({ p, i }))
          .filter(({ p }) =>
            terminal
              ? !p.arity
              : p.arity > 0 && exprSize(partial) + p.arity <= 31,
          );
        const sum = legal.reduce((s, { i }) => s + probabilities[i], 0);
        let u = rng.next() * sum,
          selected = legal.at(-1)!;
        for (const option of legal) {
          u -= probabilities[option.i];
          if (u <= 0) {
            selected = option;
            break;
          }
        }
        partial = replace(partial, h, selected.p.node);
        expansions++;
        h = firstHole(partial);
      }
      if (!h) q.push({ tree: partial, cost: 0, priority: -2 });
    }
    const row = q.pop(),
      path = firstHole(row.tree);
    if (path) {
      if (expansions >= expansionBudget) break;
      expansions++;
      const probs = predict(context(task.examples, row.tree, path, ps, macros));
      const n = exprSize(row.tree),
        depth = path.length;
      ps.forEach((p, i) => {
        if (n + p.arity > 31 || (depth >= 9 && p.arity)) return;
        const tree = replace(row.tree, path, p.node);
        const cost = row.cost - Math.log(probs[i]);
        // Unnormalized prefix cost: length normalization rewarded opening more
        // holes and starved completed programs under a finite expansion budget.
        q.push({
          tree,
          cost,
          priority: cost + 0.1 * exprSize(tree) + rng.next() * 0.1,
        });
      });
      q.trim();
      continue;
    }
    evaluations++; // Every complete proposal is charged, including duplicates/oversize.
    const k = key(row.tree);
    if (seen.has(k)) {
      duplicates++;
      continue;
    }
    seen.add(k);
    if (exprSize(expandExpr(row.tree, macros)) > 96) continue;
    const f = compile(row.tree, macros);
    const err =
      task.examples.reduce((s, e) => {
        const d = Math.abs(f(...e.input) - e.output);
        return s + (Number.isFinite(d) ? Math.min(1e6, d) : 1e6);
      }, 0) / task.examples.length;
    if (err < error || (err === error && exprSize(row.tree) < exprSize(best))) {
      error = err;
      best = row.tree;
    }
    pool.push({ tree: row.tree, error: err });
    pool.sort(
      (a, b) => a.error - b.error || exprSize(a.tree) - exprSize(b.tree),
    );
    pool.splice(16);
    if (error < 1e-8) break;
    // Evolution proposes partial trees; the same conditional policy fills holes.
    if (evaluations % 8 === 0 && pool.length) {
      const parent = rng.pick(pool.slice(0, 8)).tree,
        p = rng.pick(paths(parent));
      q.push({ tree: replace(parent, p, hole()), cost: 0, priority: -1 });
    }
  }
  // A no-complete-program run has no uncharged fallback evaluation.
  const checker = compile(best, macros);
  const checkError = Number.isFinite(error)
    ? task.checks.reduce((s, e) => {
        const d = Math.abs(checker(...e.input) - e.output);
        return s + (Number.isFinite(d) ? Math.min(1e6, d) : 1e6);
      }, 0) / task.checks.length
    : Infinity;
  const solved = error < 1e-8 && checkError < 1e-8;
  return {
    tree: best,
    expression: formatExpr(best),
    solved,
    evaluations,
    expansions,
    budget,
    expansionBudget,
    effort: solved ? evaluations : budget,
    work: evaluations + expansions,
    trainError: error,
    checkError,
    nodes: exprSize(best),
    macroCalls: paths(best).filter((p) =>
      macros.some((m) => m.name === at(best, p).op),
    ).length,
    duplicates,
    elapsedMs: performance.now() - start,
    termination:
      error < 1e-8
        ? "fit"
        : evaluations >= budget
          ? "evaluations"
          : expansions >= expansionBudget
            ? "expansions"
            : "frontier",
  };
}
export const auc = (r: SearchResult) =>
  r.solved ? 1 - r.evaluations / r.budget : 0;
