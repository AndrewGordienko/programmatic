import type { Expr } from "../dsl/types";

type Piece = { tree: Expr; values: number[]; size: number };

/** A domain-specific min/max cover heuristic over executed affine pieces.
 * It uses only supplied I/O values. All intermediate and final expressions are
 * passed to the ordinary evaluator; no piecewise predicate enters the DSL.
 * Finite-sample consistency is not a proof of equivalence beyond observations.
 */
export function latticeCompose(
  pieces: Piece[],
  target: number[],
  charge: () => boolean,
  points: (n: number) => void,
  execute: (tree: Expr) => Piece | undefined,
): Expr | undefined {
  if (!pieces.length) return;
  const join = (op: string, trees: Expr[]): Expr =>
    trees.slice(1).reduce((a, b) => ({ op, args: [a, b] }), trees[0]);
  for (const orientation of [1, -1]) {
    const inner = orientation === 1 ? "min" : "max",
      outer = orientation === 1 ? "max" : "min";
    const above: boolean[][] = [],
      below: boolean[][] = [],
      equal: boolean[][] = [];
    for (const p of pieces) {
      if (!charge()) return;
      points(target.length);
      above.push(
        p.values.map((v, i) => orientation * (v - target[i]) >= -1e-7),
      );
      below.push(p.values.map((v, i) => orientation * (v - target[i]) <= 1e-7));
      equal.push(p.values.map((v, i) => Math.abs(v - target[i]) <= 1e-7));
    }
    const terms: { tree: Expr; covered: boolean[] }[] = [],
      seen = new Set<string>();
    for (let pivot = 0; pivot < target.length; pivot++) {
      if (!charge()) return;
      const available = pieces.map((_, i) => i).filter((i) => above[i][pivot]);
      const exact = available
        .filter((i) => equal[i][pivot])
        .sort((a, b) => pieces[a].size - pieces[b].size);
      if (!exact.length) continue;
      const selected = [exact[0]],
        covered = [...below[exact[0]]];
      while (!covered.every(Boolean)) {
        let best = -1,
          gain = 0;
        for (const id of available) {
          if (selected.includes(id)) continue;
          if (!charge()) return;
          points(target.length);
          const n = below[id].reduce(
            (s, v, i) => s + Number(v && !covered[i]),
            0,
          );
          if (
            n > gain ||
            (n === gain && n > 0 && pieces[id].size < pieces[best].size)
          ) {
            best = id;
            gain = n;
          }
        }
        if (!gain) break;
        selected.push(best);
        for (let i = 0; i < covered.length; i++) covered[i] ||= below[best][i];
      }
      if (!covered.every(Boolean)) continue;
      const signature = [...selected].sort((a, b) => a - b).join(",");
      if (seen.has(signature)) continue;
      seen.add(signature);
      const tree = join(
          inner,
          selected.map((i) => pieces[i].tree),
        ),
        row = execute(tree);
      if (!row) continue;
      points(target.length);
      const matches = row.values.map((v, i) => Math.abs(v - target[i]) <= 1e-7);
      if (matches.every(Boolean)) return tree;
      if (row.values.every((v, i) => orientation * (v - target[i]) <= 1e-7))
        terms.push({ tree, covered: matches });
    }
    const covered = target.map(() => false),
      selected: Expr[] = [];
    while (!covered.every(Boolean)) {
      let best = -1,
        gain = 0;
      for (let id = 0; id < terms.length; id++) {
        if (!charge()) return;
        points(target.length);
        const n = terms[id].covered.reduce(
          (s, v, i) => s + Number(v && !covered[i]),
          0,
        );
        if (n > gain) {
          best = id;
          gain = n;
        }
      }
      if (!gain) break;
      selected.push(terms[best].tree);
      for (let i = 0; i < covered.length; i++)
        covered[i] ||= terms[best].covered[i];
    }
    if (covered.every(Boolean)) {
      const tree = join(outer, selected),
        row = execute(tree);
      if (row && row.values.every((v, i) => Math.abs(v - target[i]) <= 1e-7))
        return tree;
    }
  }
}
