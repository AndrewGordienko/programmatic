// A deliberately small outer value-model probe. Features must be available
// before the expensive development race; outcome fields are never features.
import type { Proposal, Result } from "./types";
export const FEATURE_NAMES = [
  "net compression",
  "definition count",
  "definition nodes",
  "mean arity",
  "mean corpus support",
  "maximum corpus support",
  "solved corpus size",
  "outer round",
];
export function editFeatures(p: Proposal, r: Result): number[] {
  const n = p.macros.length;
  return [
    Math.log1p(Math.max(0, p.compression)),
    n,
    p.macros.reduce((s, m) => s + m.size, 0),
    n ? p.macros.reduce((s, m) => s + m.arity, 0) / n : 0,
    n ? p.macros.reduce((s, m) => s + m.support, 0) / n : 0,
    Math.max(0, ...p.macros.map((m) => m.support)),
    r.rounds.find((x) => x.round === p.round)?.corpus ?? 0,
    p.round,
  ];
}
export type ValueModel = {
  center: number[];
  scale: number[];
  weights: number[];
  intercept: number;
  features: string[];
};
export function fitValue(
  rows: { x: number[]; y: number }[],
  ridge = 1,
): ValueModel {
  if (!rows.length)
    throw new Error("Value model needs labeled training edits.");
  const d = rows[0].x.length,
    n = rows.length;
  const center = Array.from(
    { length: d },
    (_, i) => rows.reduce((s, r) => s + r.x[i], 0) / n,
  );
  const scale = center.map(
    (v, i) =>
      Math.sqrt(rows.reduce((s, r) => s + (r.x[i] - v) ** 2, 0) / n) || 1,
  );
  const intercept = rows.reduce((s, r) => s + r.y, 0) / n;
  const xs = rows.map((r) => r.x.map((v, i) => (v - center[i]) / scale[i]));
  const matrix = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d + 1 }, (_, j) =>
      j === d
        ? rows.reduce((s, r, k) => s + xs[k][i] * (r.y - intercept), 0)
        : xs.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? ridge : 0),
    ),
  );
  for (let i = 0; i < d; i++) {
    let pivot = i;
    for (let k = i + 1; k < d; k++)
      if (Math.abs(matrix[k][i]) > Math.abs(matrix[pivot][i])) pivot = k;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const norm = matrix[i][i];
    for (let j = i; j <= d; j++) matrix[i][j] /= norm;
    for (let k = 0; k < d; k++)
      if (k !== i) {
        const factor = matrix[k][i];
        for (let j = i; j <= d; j++) matrix[k][j] -= factor * matrix[i][j];
      }
  }
  return {
    center,
    scale,
    weights: matrix.map((row) => row[d]),
    intercept,
    features: FEATURE_NAMES,
  };
}
export const predictValue = (m: ValueModel, x: number[]) =>
  m.intercept +
  x.reduce((s, v, i) => s + ((v - m.center[i]) / m.scale[i]) * m.weights[i], 0);
