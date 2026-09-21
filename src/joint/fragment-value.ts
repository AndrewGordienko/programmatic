import type { Example, Expr, Macro } from "../dsl/types";
import { exprSize, expandExpr, at, paths } from "../dsl/expressions";
import { BASE } from "../dsl/types";

/** Executed-value features for ranking a candidate subprogram, not its name.
 * All observations enter aggregate comparisons; the first 75 also retain their
 * joint task/fragment geometry. This model is a soft rank, never a sound prune. */
export function fragmentFeatures(
  examples: Example[],
  values: number[],
  tree: Expr,
  macros: Macro[],
): number[] {
  if (values.length !== examples.length || !examples.length)
    throw new Error("Fragment/exemplar mismatch");
  const target = examples.map((e) => e.output),
    mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const norm = (xs: number[]) => Math.sqrt(mean(xs.map((v) => v * v))) + 1e-8;
  const ty = norm(target),
    fy = norm(values),
    e = expandExpr(tree, macros),
    nodes = paths(e).map((p) => at(e, p));
  const unary = (ys: number[]) => {
    const m = mean(ys),
      scale = norm(ys);
    return [
      Math.tanh(m / 4),
      Math.tanh(Math.min(...ys) / 4),
      Math.tanh(Math.max(...ys) / 4),
      Math.tanh(scale / 4),
      mean(ys.map((v) => Number(Math.abs(v) < 1e-7))),
      mean(ys.map((v) => Number(v < 0))),
      mean(ys.map((v) => Number(v > 0))),
      mean(ys.map((v) => Number(Math.abs(v - Math.round(v)) < 1e-7))),
    ];
  };
  return [
    ...Array.from({ length: 75 }, (_, i) => [
      Math.tanh((target[i] ?? 0) / 4),
      Math.tanh((values[i] ?? 0) / 4),
      Math.tanh(((values[i] ?? 0) - (target[i] ?? 0)) / 4),
    ]).flat(),
    ...unary(target),
    ...unary(values),
    mean(values.map((v, i) => Number(Math.abs(v - target[i]) < 1e-7))),
    mean(values.map((v, i) => Number(v < target[i] - 1e-7))),
    mean(values.map((v, i) => Number(v > target[i] + 1e-7))),
    Math.tanh(mean(values.map((v, i) => Math.abs(v - target[i]))) / ty),
    mean(values.map((v, i) => v * target[i])) / (ty * fy),
    Math.tanh(fy / ty),
    exprSize(tree) / 96,
    exprSize(e) / 96,
    ...BASE.map(
      (op) =>
        nodes.filter((n) => n.op === op).length / Math.max(1, nodes.length),
    ),
  ];
}
export type FragmentValueModel = {
  version: "executed-fragment-value-v1";
  mean: number[];
  scale: number[];
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
};
export function predictFragmentValue(
  model: FragmentValueModel,
  features: number[],
): number {
  if (features.length !== model.mean.length)
    throw new Error("Fragment-value feature mismatch");
  const x = features.map((v, i) => (v - model.mean[i]) / model.scale[i]);
  const logit =
    model.b2 +
    model.w1.reduce(
      (s, w, j) =>
        s +
        model.w2[j] *
          Math.max(
            0,
            w.reduce((sum, v, i) => sum + v * x[i], model.b1[j]),
          ),
      0,
    );
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, logit))));
}
