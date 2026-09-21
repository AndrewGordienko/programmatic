import { expandExpr, exprSize } from "../dsl/expressions";
import type { Expr, Macro, Example } from "../dsl/types";
import { canonical } from "./canonical";
import { Random } from "../engine/random";

type Instruction = { op: string; value?: number; args: number[] };
export function affineSkeleton(template: Expr, macros: Macro[]) {
  const instructions: Instruction[] = [];
  const emit = (e: Expr): number => {
    const args = e.args.map(emit);
    instructions.push({ op: e.op, value: e.value, args });
    return instructions.length - 1;
  };
  emit(expandExpr(template, macros));
  const parameters =
    3 *
    (1 +
      Math.max(
        -1,
        ...instructions.filter((i) => i.op === "?").map((i) => i.value!),
      ));
  return {
    parameters,
    evaluate: (weights: number[], input: number[]) => {
      const values: number[] = [],
        derivatives: number[][] = [];
      for (const node of instructions) {
        const d = Array(parameters).fill(0),
          [ai, bi] = node.args,
          a = values[ai],
          b = values[bi];
        let value: number;
        if (node.op === "?") {
          const at = node.value! * 3;
          value =
            weights[at] * input[0] +
            weights[at + 1] * input[1] +
            weights[at + 2];
          d[at] = input[0];
          d[at + 1] = input[1];
          d[at + 2] = 1;
        } else if (node.op === "const") value = node.value!;
        else if (node.op === "arg") value = input[node.value!];
        else {
          let da = 0,
            db = 0;
          if (node.op === "add") {
            value = a + b;
            da = db = 1;
          } else if (node.op === "sub") {
            value = a - b;
            da = 1;
            db = -1;
          } else if (node.op === "mul") {
            value = a * b;
            da = b;
            db = a;
          } else if (node.op === "neg") {
            value = -a;
            da = -1;
          } else if (node.op === "min") {
            value = Math.min(a, b);
            da = a <= b ? 1 : 0;
            db = 1 - da;
          } else if (node.op === "max") {
            value = Math.max(a, b);
            da = a >= b ? 1 : 0;
            db = 1 - da;
          } else
            throw new Error(`Unsupported parametric production ${node.op}`);
          for (let i = 0; i < parameters; i++)
            d[i] =
              da * derivatives[ai][i] +
              (node.args.length > 1 ? db * derivatives[bi][i] : 0);
        }
        values.push(value);
        derivatives.push(d);
      }
      return { value: values.at(-1)!, derivative: derivatives.at(-1)! };
    },
  };
}
const constant = (value: number): Expr => ({ op: "const", value, args: [] });
export function instantiateAffine(template: Expr, weights: number[]): Expr {
  if (template.op === "?") {
    const start = template.value! * 3;
    return canonical({
      op: "add",
      args: [
        {
          op: "add",
          args: [
            {
              op: "mul",
              args: [
                constant(weights[start]),
                { op: "arg", value: 0, args: [] },
              ],
            },
            {
              op: "mul",
              args: [
                constant(weights[start + 1]),
                { op: "arg", value: 1, args: [] },
              ],
            },
          ],
        },
        constant(weights[start + 2]),
      ],
    });
  }
  return canonical({
    ...template,
    args: template.args.map((e) => instantiateAffine(e, weights)),
  });
}
function linearSolve(matrix: number[][], rhs: number[]): number[] {
  const rows = matrix.map((r, i) => [...r, rhs[i]]),
    n = rhs.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-12) return Array(n).fill(0);
    const scale = rows[i][i];
    for (let k = i; k <= n; k++) rows[i][k] /= scale;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const factor = rows[j][i];
        for (let k = i; k <= n; k++) rows[j][k] -= factor * rows[i][k];
      }
  }
  return rows.map((r) => r[n]);
}
/** Jointly fit bounded integer affine holes, without target syntax or checks.
 * Every floating/rounded execution calls chargeEvaluation; each linear-system
 * solve calls chargeWork. Parameter estimation is explicitly extra search work. */
export function fitAffineSkeleton(
  template: Expr,
  macros: Macro[],
  examples: Example[],
  rng: Random,
  options: {
    restarts: number;
    steps: number;
    initial?: number[];
    chargeEvaluation: () => boolean;
    chargeWork: (units: number) => boolean;
  },
) {
  const model = affineSkeleton(template, macros),
    n = model.parameters;
  if (n > 30 || exprSize(expandExpr(template, macros)) > 96) return undefined;
  let best:
      | { weights: number[]; tree: Expr; error: number; steps: number }
      | undefined,
    steps = 0;
  const check = (weights: number[], derivative: boolean) => {
    if (!options.chargeEvaluation()) return undefined;
    steps++;
    const rows = examples.map((e) => {
      const r = model.evaluate(weights, e.input);
      return { ...r, residual: r.value - e.output };
    });
    if (rows.some((r) => !Number.isFinite(r.residual))) return undefined;
    const error =
      rows.reduce((s, r) => s + Math.abs(r.residual), 0) / rows.length;
    if (!derivative && (!best || error < best.error)) {
      const tree = instantiateAffine(template, weights);
      if (exprSize(tree) <= 96 && exprSize(expandExpr(tree, macros)) <= 96)
        best = { weights: [...weights], tree, error, steps };
    }
    return rows;
  };
  for (let restart = 0; restart < options.restarts; restart++) {
    let weights =
      restart === 0 && options.initial?.length === n
        ? [...options.initial]
        : Array.from({ length: n }, () => rng.int(5) - 2);
    let previous = Infinity,
      damping = 0.03;
    for (let iteration = 0; iteration < options.steps; iteration++) {
      const rows = check(weights, true);
      if (!rows) return best;
      const mse =
        rows.reduce((s, r) => s + r.residual * r.residual, 0) / rows.length;
      const rounded = weights.map((v) => Math.round(v));
      if (iteration === 0 || mse < 0.1 || iteration === options.steps - 1) {
        if (!check(rounded, false)) return best;
        if (best?.error !== undefined && best.error < 1e-8) return best;
      }
      if (!options.chargeWork(n * n * n + rows.length * n * n)) return best;
      const matrix = Array.from({ length: n }, () => Array(n).fill(0)),
        rhs = Array(n).fill(0);
      for (const r of rows)
        for (let i = 0; i < n; i++) {
          rhs[i] -= (r.derivative[i] * r.residual) / rows.length;
          for (let j = 0; j < n; j++)
            matrix[i][j] += (r.derivative[i] * r.derivative[j]) / rows.length;
        }
      damping =
        mse > previous
          ? Math.min(10, damping * 3)
          : Math.max(0.0001, damping * 0.5);
      previous = mse;
      for (let i = 0; i < n; i++) matrix[i][i] += damping;
      const delta = linearSolve(matrix, rhs);
      weights = weights.map((v, i) =>
        Math.max(-8, Math.min(8, v + Math.max(-2, Math.min(2, delta[i])))),
      );
    }
  }
  return best;
}
