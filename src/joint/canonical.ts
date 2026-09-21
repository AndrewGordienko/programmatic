import { evalExpr, key } from "../dsl/expressions";
import type { Expr } from "../dsl/types";
import { interval } from "./semantics";
const constant = (value: number): Expr => ({ op: "const", value, args: [] });
const unknownArgs = (e: Expr): Expr =>
  e.op === "arg"
    ? { op: "?", args: [] }
    : { ...e, args: e.args.map(unknownArgs) };
/** Small explicit algebraic rewrites, not an oracle vocabulary. */
export function canonical(e: Expr): Expr {
  if (!e.args.length) return e;
  const args = e.args.map(canonical),
    [a, b] = args;
  if (args.every((v) => v.op === "const")) {
    const value = evalExpr({ ...e, args }, []);
    if (Number.isFinite(value)) return constant(value);
  }
  if (e.op === "neg" && a.op === "neg") return a.args[0];
  if (e.op === "add") {
    if (a.op === "const" && a.value === 0) return b;
    if (b.op === "const" && b.value === 0) return a;
    if (b.op === "neg") return canonical({ op: "sub", args: [a, b.args[0]] });
    if (a.op === "neg") return canonical({ op: "sub", args: [b, a.args[0]] });
  }
  if (e.op === "sub") {
    if (key(a) === key(b)) return constant(0);
    if (b.op === "const" && b.value === 0) return a;
    if (a.op === "const" && a.value === 0)
      return canonical({ op: "neg", args: [b] });
    if (b.op === "neg") return canonical({ op: "add", args: [a, b.args[0]] });
  }
  if (e.op === "mul") {
    if (args.some((v) => v.op === "const" && v.value === 0)) return constant(0);
    if (a.op === "const" && a.value === 1) return b;
    if (b.op === "const" && b.value === 1) return a;
    if (a.op === "const" && a.value === -1)
      return canonical({ op: "neg", args: [b] });
    if (b.op === "const" && b.value === -1)
      return canonical({ op: "neg", args: [a] });
  }
  if (e.op === "min" || e.op === "max") {
    if (key(a) === key(b)) return a;
    const [al, ah] = interval(unknownArgs(a))(0, 0),
      [bl, bh] = interval(unknownArgs(b))(0, 0);
    if (e.op === "min") {
      if (ah <= bl) return a;
      if (bh <= al) return b;
    } else {
      if (al >= bh) return a;
      if (bl >= ah) return b;
    }
    // Absorption: max(a,min(a,b))=a and its dual.
    const other = e.op === "max" ? "min" : "max";
    if (b.op === other && b.args.some((v) => key(v) === key(a))) return a;
    if (a.op === other && a.args.some((v) => key(v) === key(b))) return b;
  }
  if (["add", "mul", "min", "max"].includes(e.op))
    args.sort((x, y) => key(x).localeCompare(key(y)));
  return { ...e, args };
}
