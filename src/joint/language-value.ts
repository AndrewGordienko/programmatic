import type { Genome } from "./genome";
import { evalExpr, paths, at } from "../dsl/expressions";
import { BASE } from "../dsl/types";
import { ALIAS_PROBES } from "./semantics";

/** Name-free, permutation-invariant library features. These execute proposed
 * definitions on fixed probes, never on final task outputs. Interactions enter
 * through dispersion and pairwise semantic distances, not oracle concept names. */
export function languageValueFeatures(
  g: Genome,
  context: {
    corpus: number;
    training: number;
    budget: number;
    tasks: number;
    reps: number;
  },
): number[] {
  const embeddings = g.macros.map((m) => [
    m.arity / 3,
    m.size / 15,
    ...ALIAS_PROBES.slice(0, 64).map((xs) =>
      Math.tanh(evalExpr(m.body, xs) / 4),
    ),
  ]);
  const columns = Array.from({ length: 66 }, (_, i) =>
    embeddings.map((e) => e[i]),
  );
  const aggregate = columns.flatMap((xs) => {
    if (!xs.length) return [0, 0, 0, 0];
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    return [
      mean,
      Math.min(...xs),
      Math.max(...xs),
      Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length),
    ];
  });
  const distances: number[] = [];
  for (let i = 0; i < embeddings.length; i++)
    for (let j = i + 1; j < embeddings.length; j++)
      distances.push(
        Math.sqrt(
          embeddings[i].reduce(
            (s, v, k) => s + (v - embeddings[j][k]) ** 2,
            0,
          ) / 66,
        ),
      );
  const nodes = g.macros.flatMap((m) =>
    paths(m.body).map((p) => at(m.body, p)),
  );
  return [
    g.macros.length / 4,
    nodes.length / 60,
    g.macros.reduce((s, m) => s + m.support, 0) /
      Math.max(1, context.corpus * 4),
    Math.max(0, ...g.macros.map((m) => m.support)) /
      Math.max(1, context.corpus),
    context.corpus / Math.max(1, context.training),
    Math.log2(context.budget) / 12,
    context.tasks / 100,
    context.reps / 3,
    ...BASE.map(
      (op) =>
        nodes.filter((n) => n.op === op).length / Math.max(1, nodes.length),
    ),
    distances.length ? Math.min(...distances) : 0,
    distances.length ? Math.max(...distances) : 0,
    ...aggregate,
  ];
}
export type LanguageValueModel = {
  version: "semantic-library-value-v1";
  mean: number[];
  scale: number[];
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
};
export function predictLanguageValue(
  model: LanguageValueModel,
  features: number[],
): number {
  if (features.length !== model.mean.length)
    throw new Error("Language-value feature mismatch");
  const x = features.map((v, i) => (v - model.mean[i]) / model.scale[i]);
  return (
    model.b2 +
    model.w1.reduce(
      (sum, w, j) =>
        sum +
        model.w2[j] *
          Math.max(
            0,
            w.reduce((s, v, i) => s + v * x[i], model.b1[j]),
          ),
      0,
    )
  );
}
