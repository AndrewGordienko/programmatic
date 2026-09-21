import { Random } from "../engine/random";
import {
  evalExpr,
  exprSize,
  paths,
  at,
  replace,
  rewrite,
} from "../dsl/expressions";
import { inputs } from "../dsl/tasks";
import {
  ARITY,
  BASE,
  type Expr,
  type Macro,
  type Example,
  type CorpusEntry,
} from "../dsl/types";

export const hole = (): Expr => ({ op: "?", args: [] });
export const firstHole = (tree: Expr) =>
  paths(tree).find((p) => at(tree, p).op === "?");
export type Production = {
  id: string;
  node: Expr;
  arity: number;
  semantic: number[];
};
// Independent arguments include asymmetric and off-diagonal probes. No concept labels.
export const PROBES = Array.from({ length: 16 }, (_, i) => [
  [-3, -1, 0, 0.5, 1, 2, 4][i % 7],
  [2, -2, 1, 0, 3][i % 5],
  [-1, 3, 0, -2][i % 4],
]);
export function productions(macros: Macro[]): Production[] {
  const nodes: Expr[] = [
    ...[0, 1].map((value) => ({ op: "arg", value, args: [] })),
    ...[-2, -1, 0, 1, 2].map((value) => ({ op: "const", value, args: [] })),
    ...[...BASE, ...macros.map((m) => m.name)].map((op) => ({
      op,
      args: Array.from(
        { length: ARITY[op] ?? macros.find((m) => m.name === op)!.arity },
        hole,
      ),
    })),
  ];
  return nodes.map((node) => {
    const body = node.args.length
      ? {
          ...node,
          args: node.args.map((_, value) => ({ op: "arg", value, args: [] })),
        }
      : node;
    return {
      id: node.op + ":" + (node.value ?? ""),
      node,
      arity: node.args.length,
      semantic: [
        node.args.length / 3,
        Number(!node.args.length),
        ...PROBES.map((xs) => Math.tanh(evalExpr(body, xs, macros) / 4)),
      ],
    };
  });
}
const fill = (e: Expr): Expr =>
  e.op === "?"
    ? { op: "const", value: 0, args: [] }
    : { ...e, args: e.args.map(fill) };
export function context(
  examples: Example[],
  tree: Expr,
  path: number[],
  ps: Production[],
  macros: Macro[],
  fixed?: { task: number[]; language: number[] },
): number[] {
  const nodes = paths(tree).map((p) => at(tree, p));
  const parent = path.length ? at(tree, path.slice(0, -1)) : null;
  const parentProduction = ps.find(
    (p) => p.node.op === parent?.op && p.node.value === parent?.value,
  );
  const filled = fill(tree);
  return [
    ...(fixed?.task ?? [
      ...Array.from({ length: 25 }, (_, i) =>
        Math.tanh((examples[i]?.output ?? 0) / 4),
      ),
      ...[0, 1].flatMap((j) => [
        examples.reduce((s, e) => s + e.input[j], 0) / examples.length / 4,
        examples.reduce((s, e) => s + Math.abs(e.input[j]), 0) /
          examples.length /
          4,
      ]),
    ]),
    path.length / 10,
    (path.at(-1) ?? -1) / 3,
    exprSize(tree) / 31,
    nodes.filter((n) => n.op === "?").length / 15,
    ...BASE.map((op) => nodes.filter((n) => n.op === op).length / 10),
    ...(parentProduction?.semantic ?? Array(18).fill(0)),
    ...PROBES.slice(0, 6).map((xs) =>
      Math.tanh(evalExpr(filled, xs, macros) / 4),
    ),
    ...(fixed?.language ?? [
      ps.length / 24,
      ...Array.from(
        { length: 6 },
        (_, i) => ps.reduce((s, p) => s + p.semantic[i + 2], 0) / ps.length,
      ),
      1,
    ]),
  ];
}
export function taskContext(
  examples: Example[],
  ps: Production[],
  macros: Macro[],
) {
  const initial = context(examples, hole(), [], ps, macros);
  const fixed = { task: initial.slice(0, 29), language: initial.slice(-8) };
  return (tree: Expr, path: number[]) =>
    context(examples, tree, path, ps, macros, fixed);
}
const H = 12;
export type JointPolicy = {
  version: "joint-semantic-v1";
  contextWeights: number[][];
  operatorWeights: number[][];
  bias: number[];
  decisions: number;
  loss: number;
};
const dot = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * b[i], 0);
export const softmax = (xs: number[]) => {
  const max = Math.max(...xs),
    es = xs.map((v) => Math.exp(v - max)),
    sum = es.reduce((a, b) => a + b, 0);
  return es.map((v) => v / sum);
};
export function encoder(
  p: JointPolicy | undefined,
  ps: Production[],
  prefix?: number[],
) {
  const ys = ps.map((op) => [...op.semantic, 1]);
  const embeddings =
    p && ys.map((y) => p.operatorWeights.map((w) => Math.tanh(dot(w, y))));
  const biases = p && ys.map((y) => dot(p.bias, y));
  const starts =
    p &&
    prefix &&
    p.contextWeights.map((w) => prefix.reduce((s, v, i) => s + w[i] * v, 0));
  return (x: number[]) => {
    if (!p || !embeddings) return ps.map(() => 1 / ps.length);
    const h = p.contextWeights.map((w, k) => {
      if (!starts || !prefix) return Math.tanh(dot(w, x));
      let sum = starts[k];
      for (let i = prefix.length; i < x.length; i++) sum += w[i] * x[i];
      return Math.tanh(sum);
    });
    const probs = softmax(
      embeddings.map(
        (e, i) => dot(h, e) / Math.sqrt(p.contextWeights.length) + biases![i],
      ),
    );
    return probs.map((v) => 0.95 * v + 0.05 / ps.length);
  };
}

export function fitJoint(
  corpus: CorpusEntry[],
  macros: Macro[],
  seed: number,
  previous?: JointPolicy,
  options = { dreams: 128, epochs: 6 },
): JointPolicy {
  const rng = new Random(seed),
    ps = productions(macros),
    xs = inputs(301, 25, 3);
  const rows = corpus.map((c) => ({
    examples: c.task.examples,
    tree: rewrite(c.tree, macros),
  }));
  const dream = (depth: number): Expr => {
    const p = rng.pick(
      depth <= 0 || rng.next() < 0.35
        ? ps.filter((p) => !p.arity)
        : ps.filter((p) => p.arity),
    );
    return {
      ...p.node,
      args: Array.from({ length: p.arity }, () => dream(depth - 1)),
    };
  };
  for (let i = 0; i < options.dreams; i++) {
    const tree = dream(2 + rng.int(2));
    rows.push({
      tree,
      examples: xs.map((input) => ({
        input,
        output: evalExpr(tree, input, macros),
      })),
    });
  }
  const decisions: { x: number[]; target: number }[] = [];
  for (const row of rows) {
    let partial = hole();
    for (const path of paths(row.tree)) {
      const node = at(row.tree, path),
        target = ps.findIndex(
          (p) => p.node.op === node.op && p.node.value === node.value,
        );
      if (target < 0) throw new Error("Corpus contains unavailable production");
      decisions.push({
        x: context(row.examples, partial, path, ps, macros),
        target,
      });
      partial = replace(partial, path, ps[target].node);
    }
  }
  const init = (n: number) =>
    Array.from({ length: n }, () => (rng.next() - 0.5) * 0.25);
  const p: JointPolicy = previous
    ? structuredClone(previous)
    : {
        version: "joint-semantic-v1",
        contextWeights: Array.from({ length: H }, () =>
          init(
            decisions[0]?.x.length ??
              context(
                xs.map((input) => ({ input, output: 0 })),
                hole(),
                [],
                ps,
                macros,
              ).length,
          ),
        ),
        operatorWeights: Array.from({ length: H }, () => init(19)),
        bias: Array(19).fill(0),
        decisions: 0,
        loss: 0,
      };
  const ys = ps.map((op) => [...op.semantic, 1]);
  let loss = 0;
  const width = p.contextWeights.length;
  for (let epoch = 0; epoch < options.epochs; epoch++) {
    // Fisher-Yates shuffle, never sorted with a random comparator.
    for (let i = decisions.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [decisions[i], decisions[j]] = [decisions[j], decisions[i]];
    }
    for (const row of decisions) {
      const h = p.contextWeights.map((w) => Math.tanh(dot(w, row.x)));
      const es = ys.map((y) =>
        p.operatorWeights.map((w) => Math.tanh(dot(w, y))),
      );
      const probs = softmax(
        es.map((e, i) => dot(h, e) / Math.sqrt(width) + dot(p.bias, ys[i])),
      );
      const dh = Array(width).fill(0),
        dw = p.operatorWeights.map((w) => w.map(() => 0));
      const db = p.bias.map(() => 0);
      loss += -Math.log(Math.max(1e-12, probs[row.target]));
      probs.forEach((prob, i) => {
        const d = (Number(i === row.target) - prob) / Math.sqrt(width);
        for (let k = 0; k < width; k++) {
          dh[k] += d * es[i][k];
          for (let j = 0; j < ys[i].length; j++)
            dw[k][j] += d * h[k] * (1 - es[i][k] ** 2) * ys[i][j];
        }
        for (let j = 0; j < db.length; j++)
          db[j] += (Number(i === row.target) - prob) * ys[i][j];
      });
      for (let k = 0; k < width; k++) {
        for (let j = 0; j < row.x.length; j++)
          p.contextWeights[k][j] += 0.018 * dh[k] * (1 - h[k] ** 2) * row.x[j];
        for (let j = 0; j < dw[k].length; j++)
          p.operatorWeights[k][j] += 0.018 * dw[k][j];
      }
      for (let j = 0; j < db.length; j++) p.bias[j] += 0.018 * db[j];
    }
  }
  p.decisions += decisions.length * options.epochs;
  p.loss = loss / Math.max(1, decisions.length * options.epochs);
  return p;
}
