import { expandExpr, evalExpr } from "../dsl/expressions";
import { ARITY, BASE, type Expr, type Example, type Macro } from "../dsl/types";
import { PROBES } from "./policy";
import { Random } from "../engine/random";
const aliasRandom = new Random(991273);
export const ALIAS_PROBES = [
  ...PROBES,
  ...Array.from({ length: 256 }, () =>
    Array.from({ length: 3 }, () => aliasRandom.next() * 20 - 10),
  ),
];
type Range = [number, number];
type Bound = (x: number, y: number) => Range;
const all: Range = [-Infinity, Infinity];
/** Conservative interval abstraction. Repeated holes lose correlations, so this
 * may retain impossible prefixes; it must never assume holes are zero. */
export function interval(tree: Expr, macros: Macro[] = []): Bound {
  const build = (e: Expr): Bound => {
    if (e.op === "?") return () => all;
    if (e.op === "arg") return (x, y) => (e.value === 0 ? [x, x] : [y, y]);
    if (e.op === "const") return () => [e.value!, e.value!];
    const a = build(e.args[0]),
      b = e.args[1] ? build(e.args[1]) : a;
    return (x, y) => {
      const [lo, hi] = a(x, y),
        [bl, bh] = b(x, y);
      if (e.op === "neg") return [-hi, -lo];
      if (e.op === "add") return [lo + bl, hi + bh];
      if (e.op === "sub") return [lo - bh, hi - bl];
      if (e.op === "min") return [Math.min(lo, bl), Math.min(hi, bh)];
      if (e.op === "max") return [Math.max(lo, bl), Math.max(hi, bh)];
      if (e.op === "mul") {
        if ((lo === 0 && hi === 0) || (bl === 0 && bh === 0)) return [0, 0];
        const products = [lo * bl, lo * bh, hi * bl, hi * bh].map((v) =>
          Number.isNaN(v) ? 0 : v,
        );
        return [Math.min(...products), Math.max(...products)];
      }
      throw new Error(`Unknown interval production ${e.op}`);
    };
  };
  return build(expandExpr(tree, macros));
}
export function feasible(
  tree: Expr,
  examples: Example[],
  macros: Macro[],
): boolean {
  const bounds = interval(tree, macros);
  return examples.every((e) => {
    const [lo, hi] = bounds(...e.input);
    // Search accepts mean absolute error < 1e-8, so one point may differ by
    // up to N * 1e-8. Additional relative slack covers ordinary roundoff.
    const slack =
      1e-8 * examples.length +
      1e-12 *
        Math.max(
          1,
          Math.abs(e.output),
          Number.isFinite(lo) ? Math.abs(lo) : 0,
          Number.isFinite(hi) ? Math.abs(hi) : 0,
        );
    return !(e.output < lo - slack || e.output > hi + slack);
  });
}
export function aliasesBase(m: Macro): boolean {
  const args = Array.from({ length: m.arity }, (_, value) => ({
    op: "arg",
    value,
    args: [],
  }));
  const values = ALIAS_PROBES.map((xs) => evalExpr(m.body, xs));
  return BASE.filter((op) => ARITY[op] === m.arity).some((op) =>
    ALIAS_PROBES.every(
      (xs, i) => Math.abs(evalExpr({ op, args }, xs) - values[i]) < 1e-8,
    ),
  );
}
