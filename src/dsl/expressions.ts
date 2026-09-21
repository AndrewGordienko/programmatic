import { evalExpr, expandExpr, exprSize, formatExpr } from "../engine/language";
import { ARITY, type Expr, type Macro } from "./types";
export { evalExpr, expandExpr, exprSize, formatExpr };
export function paths(e: Expr, p: number[] = []): number[][] {
  return [p, ...e.args.flatMap((a, i) => paths(a, [...p, i]))];
}
export function at(e: Expr, p: number[]): Expr {
  return p.reduce((a, i) => a.args[i], e);
}
export function replace(e: Expr, p: number[], n: Expr): Expr {
  return !p.length
    ? n
    : {
        ...e,
        args: e.args.map((a, i) =>
          i === p[0] ? replace(a, p.slice(1), n) : a,
        ),
      };
}
export const key = (e: Expr) => JSON.stringify(e);
export function valid(
  e: Expr,
  macros: Macro[],
  parameters = 2,
  depth = 0,
): boolean {
  if (depth > 32 || !e || !Array.isArray(e.args)) return false;
  if (e.op === "arg")
    return (
      e.args.length === 0 &&
      Number.isInteger(e.value) &&
      e.value! >= 0 &&
      e.value! < parameters
    );
  if (e.op === "const") return e.args.length === 0 && Number.isFinite(e.value);
  const n = ARITY[e.op] ?? macros.find((m) => m.name === e.op)?.arity;
  return (
    n !== undefined &&
    e.args.length === n &&
    e.args.every((a) => valid(a, macros, parameters, depth + 1))
  );
}
export function validLibrary(ms: Macro[]): boolean {
  return (
    new Set(ms.map((m) => m.name)).size === ms.length &&
    ms.every(
      (m) =>
        /^fn_\d+$/.test(m.name) &&
        m.arity >= 1 &&
        m.arity <= 3 &&
        valid(m.body, [], m.arity) &&
        exprSize(m.body) <= 15,
    )
  );
}
// Pattern matching permits arbitrary expression arguments and repeated holes.
function match(
  pattern: Expr,
  e: Expr,
  args: Map<number, Expr>,
  commutative = false,
): boolean {
  if (pattern.op === "arg") {
    const i = pattern.value!,
      old = args.get(i);
    if (old) return key(old) === key(e);
    args.set(i, e);
    return true;
  }
  if (commutative) {
    if (
      pattern.op !== e.op ||
      pattern.value !== e.value ||
      pattern.args.length !== e.args.length
    )
      return false;
    const orders = [e.args];
    if (["add", "mul", "min", "max"].includes(e.op))
      orders.push([...e.args].reverse());
    for (const order of orders) {
      const local = new Map(args);
      if (pattern.args.every((p, i) => match(p, order[i], local, true))) {
        for (const [i, value] of local) args.set(i, value);
        return true;
      }
    }
    return false;
  }
  return (
    pattern.op === e.op &&
    pattern.value === e.value &&
    pattern.args.length === e.args.length &&
    pattern.args.every((p, i) => match(p, e.args[i], args))
  );
}
export function rewrite(
  e: Expr,
  macros: Macro[],
  options: { commutative?: boolean } = {},
): Expr {
  // Corpus is expanded first: learned definitions remain independent base ASTs.
  const visit = (node: Expr): Expr => {
    let best = { ...node, args: node.args.map(visit) };
    for (const m of macros) {
      const args = new Map<number, Expr>();
      if (
        !match(m.body, node, args, options.commutative) ||
        args.size !== m.arity
      )
        continue;
      const candidate = {
        op: m.name,
        args: Array.from({ length: m.arity }, (_, i) => visit(args.get(i)!)),
      };
      if (exprSize(candidate) < exprSize(best)) best = candidate;
    }
    return best;
  };
  return visit(expandExpr(e, macros));
}
// Compile to closures; no generated JavaScript/eval. Definitions are expanded
// before execution so the expanded-node limit applies to every grammar.
export function compile(
  tree: Expr,
  ms: Macro[],
): (x: number, y: number) => number {
  const build = (e: Expr): ((x: number, y: number) => number) => {
    if (e.op === "arg") return e.value === 0 ? (x) => x : (_, y) => y;
    if (e.op === "const") return () => e.value!;
    const a = build(e.args[0]),
      b = e.args[1] ? build(e.args[1]) : a;
    switch (e.op) {
      case "add":
        return (x, y) => a(x, y) + b(x, y);
      case "sub":
        return (x, y) => a(x, y) - b(x, y);
      case "mul":
        return (x, y) => a(x, y) * b(x, y);
      case "min":
        return (x, y) => Math.min(a(x, y), b(x, y));
      case "max":
        return (x, y) => Math.max(a(x, y), b(x, y));
      case "neg":
        return (x, y) => -a(x, y);
      default:
        throw new Error(`Unknown operator ${e.op}`);
    }
  };
  return build(expandExpr(tree, ms));
}
