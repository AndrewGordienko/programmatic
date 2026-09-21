import type { Expr, Example } from "../dsl/types";
import { canonical } from "./canonical";

type Fragment = { tree: Expr; values: number[]; size: number };
// Beam pursuit over executable fragments. Linear fitting is a proposal
// heuristic; only rounded integer coefficients become base-DSL programs.
export function sparseCompose(
  fragments: Fragment[],
  examples: Example[],
  options: { width: number; depth: number; steps: number },
  charge: () => boolean,
  points: (n: number) => void,
  complete: (e: Expr) => boolean,
): Expr | undefined {
  let steps = 0;
  const tick = () => steps++ < options.steps && charge();
  const target = examples.map((e) => e.output),
    n = target.length;
  const dot = (x: number[], y: number[]) => {
    points(n);
    return x.reduce((s, v, i) => s + v * y[i], 0);
  };
  const norms = fragments.map((f) => dot(f.values, f.values));
  type State = { ids: number[]; residual: number[]; error: number };
  let beam: State[] = [
    { ids: [], residual: target, error: dot(target, target) },
  ];
  const gram = new Map<string, number>();
  const inner = (i: number, j: number) => {
    const k = [Math.min(i, j), Math.max(i, j)].join(":");
    if (!gram.has(k))
      gram.set(k, dot(fragments[i].values, fragments[j].values));
    return gram.get(k)!;
  };
  const rhs = fragments.map((f) => dot(f.values, target));
  const constant = (v: number): Expr =>
    Math.abs(v) <= 2
      ? { op: "const", value: v, args: [] }
      : v < 0
        ? { op: "neg", args: [constant(-v)] }
        : v % 2 === 0
          ? { op: "mul", args: [constant(2), constant(v / 2)] }
          : { op: "add", args: [constant(1), constant(v - 1)] };
  const fit = (ids: number[]) => {
    const a = ids.map((i) => [...ids.map((j) => inner(i, j)), rhs[i]]),
      d = ids.length;
    for (let i = 0; i < d; i++) {
      if (!tick()) return;
      let pivot = i;
      for (let j = i + 1; j < d; j++)
        if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
      if (Math.abs(a[pivot][i]) < 1e-8) return;
      [a[i], a[pivot]] = [a[pivot], a[i]];
      const div = a[i][i];
      for (let k = i; k <= d; k++) a[i][k] /= div;
      for (let j = 0; j < d; j++)
        if (j !== i) {
          const v = a[j][i];
          for (let k = i; k <= d; k++) a[j][k] -= v * a[i][k];
        }
      points(d * d);
    }
    return a.map((row) => row[d]);
  };
  const seen = new Set<string>();
  for (let depth = 0; depth < options.depth; depth++) {
    const next: State[] = [];
    for (const state of beam) {
      const candidates = [];
      for (let i = 0; i < fragments.length; i++) {
        if (!tick()) return;
        if (state.ids.includes(i) || norms[i] < 1e-9) continue;
        const corr = dot(fragments[i].values, state.residual);
        candidates.push({ i, score: (corr * corr) / norms[i] });
      }
      candidates.sort((a, b) => b.score - a.score);
      for (const candidate of candidates.slice(0, options.width * 2)) {
        const ids = [...state.ids, candidate.i].sort((a, b) => a - b),
          k = ids.join(",");
        if (seen.has(k)) continue;
        seen.add(k);
        const weights = fit(ids);
        if (!weights) continue;
        const residual = target.map(
          (y, i) =>
            y -
            ids.reduce(
              (s, id, j) => s + weights[j] * fragments[id].values[i],
              0,
            ),
        );
        points(n * ids.length);
        next.push({ ids, residual, error: dot(residual, residual) });
        const ints = weights.map(Math.round);
        if (ints.some((v) => Math.abs(v) > 8) || ints.every((v) => v === 0))
          continue;
        const terms = ids.flatMap((id, j) =>
          ints[j] === 0
            ? []
            : [
                ints[j] === 1
                  ? fragments[id].tree
                  : {
                      op: "mul",
                      args: [constant(ints[j]), fragments[id].tree],
                    },
              ],
        );
        const tree = canonical(
          terms
            .slice(1)
            .reduce((s, t) => ({ op: "add", args: [s, t] }), terms[0]),
        );
        if (!tick()) return;
        if (complete(tree)) return tree;
      }
    }
    beam = next.sort((a, b) => a.error - b.error).slice(0, options.width);
    if (!beam.length) return;
  }
}
