import { expandExpr, key } from "../dsl/expressions";
import type { Expr, Example, Macro } from "../dsl/types";
type Fragment = { tree: Expr; values: number[]; size: number };
type Form = [number, number, number];

/** Indexed inverse search over p +/- (q +/- ?). A prefix still has a hole:
 * its required residual is looked up in executed fragments. Every prefix and
 * lookup is charged; complete programs are evaluated by the caller. */
export function additiveJoin(
  fragments: Fragment[],
  examples: Example[],
  macros: Macro[],
  limit: number,
  charge: () => boolean,
  points: (n: number) => void,
  complete: (tree: Expr) => boolean,
): Expr | undefined {
  let steps = 0;
  const tick = () => steps++ < limit && charge();
  const memo = new Map<string, Form | null>();
  const form = (e: Expr): Form | null => {
    const k = key(e);
    if (memo.has(k)) return memo.get(k)!;
    if (!tick()) return null;
    let out: Form | null = null;
    if (e.op === "arg") out = e.value === 0 ? [1, 0, 0] : [0, 1, 0];
    else if (e.op === "const") out = [0, 0, e.value!];
    else {
      const a = form(e.args[0]),
        b = e.args[1] ? form(e.args[1]) : null;
      if (a && e.op === "neg") out = a.map((v) => -v) as Form;
      if (a && b) {
        if (e.op === "add" || e.op === "sub")
          out = a.map((v, i) => v + (e.op === "add" ? 1 : -1) * b[i]) as Form;
        if (e.op === "mul" && ((!a[0] && !a[1]) || (!b[0] && !b[1])))
          out = [
            a[0] * b[2] + b[0] * a[2],
            a[1] * b[2] + b[1] * a[2],
            a[2] * b[2],
          ];
        if (
          (e.op === "min" || e.op === "max") &&
          a[0] === b[0] &&
          a[1] === b[1]
        )
          out = [
            a[0],
            a[1],
            e.op === "min" ? Math.min(a[2], b[2]) : Math.max(a[2], b[2]),
          ];
      }
    }
    memo.set(k, out);
    return out;
  };
  // Linear combinations of affine fragments cannot satisfy non-affine examples.
  // This avoids deliberately handicapping the base language with futile joins.
  if (fragments.every((r) => form(expandExpr(r.tree, macros)) !== null)) {
    const p = examples[0];
    let checked = false;
    for (let j = 1; j < examples.length && !checked; j++)
      for (let k = j + 1; k < examples.length && !checked; k++) {
        const q = examples[j],
          r = examples[k],
          dx = q.input[0] - p.input[0],
          dy = q.input[1] - p.input[1],
          ex = r.input[0] - p.input[0],
          ey = r.input[1] - p.input[1],
          det = dx * ey - dy * ex;
        if (Math.abs(det) < 1e-6) continue;
        if (!tick()) return;
        const dz = q.output - p.output,
          ez = r.output - p.output,
          a = (dz * ey - dy * ez) / det,
          b = (dx * ez - dz * ex) / det,
          c = p.output - a * p.input[0] - b * p.input[1];
        checked = true;
        if (
          examples.some((e) => {
            points(1);
            return (
              Math.abs(a * e.input[0] + b * e.input[1] + c - e.output) > 1e-5
            );
          })
        )
          return;
      }
  }
  const ids = [examples.length - 1, examples.length - 2, examples.length - 3];
  const signature = (values: number[]) =>
    values.map((v) => (Math.abs(v) < 0.5e-6 ? 0 : v).toFixed(6)).join(",");
  const index = new Map<string, Fragment[]>();
  for (const f of fragments) {
    if (!tick()) return;
    const s = signature(ids.map((i) => f.values[i]));
    const bucket = index.get(s) ?? [];
    bucket.push(f);
    index.set(s, bucket);
  }
  // Short prefixes first, with diagonal traversal to retain operand diversity.
  const ordered = [...fragments].sort((a, b) => a.size - b.size);
  for (let diagonal = 0; diagonal < ordered.length * 2; diagonal++)
    for (let i = 0; i < ordered.length; i++) {
      const j = diagonal - i;
      if (j < 0 || j >= ordered.length) continue;
      const p = ordered[i],
        q = ordered[j];
      for (const outer of ["add", "sub"])
        for (const inner of ["add", "sub"]) {
          if (!tick() || !tick() || !tick()) return;
          const s1 = outer === "add" ? 1 : -1,
            s2 = inner === "add" ? 1 : -1;
          const residual = ids.map((k) => {
            points(1);
            return (
              (examples[k].output - p.values[k] - s1 * q.values[k]) / (s1 * s2)
            );
          });
          for (const r of index.get(signature(residual)) ?? []) {
            const tree = {
              op: outer,
              args: [p.tree, { op: inner, args: [q.tree, r.tree] }],
            };
            if (complete(tree)) return tree;
          }
        }
    }
}
