import type { Expr } from "../dsl/types";
export type Range = [number, number];
export type Domain = Range[];
export type Box = { low: number[]; high: number[]; ranges?: Domain[] };
export type Segment = { lo: number; hi: number; a: number; b: number };
export function union(ranges: Domain): Domain {
  const sorted = ranges
    .filter(([l, h]) => l <= h && !Number.isNaN(l) && !Number.isNaN(h))
    .sort((a, b) => a[0] - b[0]);
  const out: Domain = [];
  for (const [l, h] of sorted) {
    const last = out.at(-1);
    if (last && l <= last[1] + 1e-10) last[1] = Math.max(last[1], h);
    else out.push([l, h]);
  }
  return out;
}
export const intersect = (a: Domain, b: Domain): Domain =>
  union(
    a.flatMap(([l, h]) =>
      b.map(([ll, hh]) => [Math.max(l, ll), Math.min(h, hh)] as Range),
    ),
  );
export const domainAt = (box: Box, i: number): Domain =>
  box.ranges?.[i] ?? [[box.low[i], box.high[i]]];
export const contains = (box: Box, i: number, v: number) =>
  domainAt(box, i).some(([l, h]) => v >= l - 1e-7 && v <= h + 1e-7);
export function boxFrom(domains: Domain[]): Box | null {
  const ds = domains.map(union);
  if (ds.some((d) => !d.length)) return null;
  return {
    low: ds.map((d) => d[0][0]),
    high: ds.map((d) => d.at(-1)![1]),
    ...(ds.some((d) => d.length > 1) ? { ranges: ds } : {}),
  };
}

/** Exact piecewise-affine semantics derived from a unary definition. This is
 * generic over base ASTs, not a lookup table of known concepts. Nonlinear
 * multiplication is explicitly unsupported and remains forward-only. */
export function linearPieces(tree: Expr): Segment[] | null {
  if (tree.op === "arg")
    return tree.value === 0
      ? [{ lo: -Infinity, hi: Infinity, a: 1, b: 0 }]
      : null;
  if (tree.op === "const")
    return [{ lo: -Infinity, hi: Infinity, a: 0, b: tree.value! }];
  const left = linearPieces(tree.args[0]);
  if (!left) return null;
  if (tree.op === "neg") return left.map((p) => ({ ...p, a: -p.a, b: -p.b }));
  const right = linearPieces(tree.args[1]);
  if (!right) return null;
  const out: Segment[] = [];
  for (const x of left)
    for (const y of right) {
      const lo = Math.max(x.lo, y.lo),
        hi = Math.min(x.hi, y.hi);
      if (lo > hi) continue;
      if (tree.op === "add" || tree.op === "sub") {
        const sign = tree.op === "add" ? 1 : -1;
        out.push({ lo, hi, a: x.a + sign * y.a, b: x.b + sign * y.b });
      } else if (tree.op === "mul") {
        if (x.a !== 0 && y.a !== 0) return null;
        out.push({ lo, hi, a: x.a * y.b + y.a * x.b, b: x.b * y.b });
      } else if (tree.op === "min" || tree.op === "max") {
        const root = x.a === y.a ? Infinity : (y.b - x.b) / (x.a - y.a);
        const cuts = root > lo && root < hi ? [lo, root, hi] : [lo, hi];
        for (let i = 0; i < cuts.length - 1; i++) {
          const l = cuts[i],
            h = cuts[i + 1],
            probe =
              Number.isFinite(l) && Number.isFinite(h)
                ? (l + h) / 2
                : Number.isFinite(l)
                  ? l + 1
                  : Number.isFinite(h)
                    ? h - 1
                    : 0;
          const xv = x.a * probe + x.b,
            yv = y.a * probe + y.b;
          const chosen = (tree.op === "min" ? xv <= yv : xv >= yv) ? x : y;
          out.push({ ...chosen, lo: l, hi: h });
        }
      } else return null;
      if (out.length > 256) return null;
    }
  out.sort((x, y) => x.lo - y.lo || x.hi - y.hi);
  const merged: Segment[] = [];
  for (const p of out) {
    const last = merged.at(-1);
    if (last && last.a === p.a && last.b === p.b && p.lo <= last.hi)
      last.hi = Math.max(last.hi, p.hi);
    else merged.push({ ...p });
  }
  return merged;
}

export function inversePieces(pieces: Segment[], target: Box): Box | null {
  return boxFrom(
    target.low.map((_, i) =>
      domainAt(target, i).flatMap(([l, h]) =>
        pieces.flatMap((p) => {
          if (p.a === 0)
            return p.b >= l - 1e-7 && p.b <= h + 1e-7
              ? [[p.lo, p.hi] as Range]
              : [];
          const a = (l - p.b) / p.a,
            b = (h - p.b) / p.a;
          return [
            [
              Math.max(p.lo, Math.min(a, b)),
              Math.min(p.hi, Math.max(a, b)),
            ] as Range,
          ];
        }),
      ),
    ),
  );
}

/** Partially apply observed arguments, leaving the final parameter symbolic.
 * Each example has its own known values. The caller charges every derivation.
 */
export function inverseApplied(
  body: Expr,
  known: number[][],
  target: Box,
  charge: () => boolean,
): Box | null {
  const domains: Domain[] = [];
  for (let i = 0; i < target.low.length; i++) {
    if (!charge()) return null;
    const bind = (e: Expr): Expr =>
      e.op === "arg"
        ? e.value === known.length
          ? { op: "arg", value: 0, args: [] }
          : { op: "const", value: known[e.value!][i], args: [] }
        : { ...e, args: e.args.map(bind) };
    const pieces = linearPieces(bind(body));
    if (!pieces) return null;
    const one = boxFrom([domainAt(target, i)])!,
      inverse = inversePieces(pieces, one);
    if (!inverse) return null;
    domains.push(domainAt(inverse, 0));
  }
  return boxFrom(domains);
}
