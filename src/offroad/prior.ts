import { Random } from "../engine/random";
import { INPUTS, OPS, type Gene, type ValueType } from "./types";
const FEATURES = 32,
  HIDDEN = 16,
  CHOICES = 64;
export type Decision = { context: number[]; legal: number[]; choice: number };
// A masked neural prior over both operators and graph connections. It sees a
// summary of the partial typed graph, operand role, and requested output type.
export class GraphPrior {
  w1: number[][];
  w2: number[][];
  b1: number[];
  b2: number[];
  constructor(rng: Random) {
    this.w1 = Array.from({ length: HIDDEN }, () =>
      Array.from({ length: FEATURES }, () => (rng.next() - 0.5) * 0.2),
    );
    this.w2 = Array.from({ length: CHOICES }, () =>
      Array.from({ length: HIDDEN }, () => (rng.next() - 0.5) * 0.2),
    );
    this.b1 = Array(HIDDEN).fill(0);
    this.b2 = Array(CHOICES).fill(0);
  }
  context(genes: Gene[], type: ValueType, role: number) {
    const x = Array(FEATURES).fill(0);
    x[0] = 1;
    x[1] = genes.length / 32;
    x[2] = type === "vector" ? 1 : type === "angle" ? 0.5 : 0;
    x[3] = role / 5;
    for (const g of genes) {
      const i = OPS.findIndex((o) => o.name === g.op);
      if (i >= 0) x[4 + i] += 1 / Math.max(1, genes.length);
    }
    x[24] =
      (genes.filter((g) => g.type === "vector").length + 5) /
      (genes.length + INPUTS);
    x[25] =
      genes.at(-1)?.type === "vector"
        ? 1
        : genes.at(-1)?.type === "angle"
          ? 0.5
          : 0;
    x[26] =
      genes.at(-2)?.type === "vector"
        ? 1
        : genes.at(-2)?.type === "angle"
          ? 0.5
          : 0;
    x[27] = genes.at(-1)?.op === "argmax" ? 1 : 0;
    x[28] =
      genes.filter((g) => g.refs.some((r) => r === 1)).length /
      Math.max(1, genes.length);
    x[29] =
      genes.filter((g) => g.refs.some((r) => r === 2 || r === 4)).length /
      Math.max(1, genes.length);
    return x;
  }
  forward(x: number[], legal: number[]) {
    const hidden = this.w1.map((row, h) =>
      Math.tanh(row.reduce((n, w, i) => n + w * x[i], this.b1[h])),
    );
    const logits = legal.map((k) =>
      this.w2[k].reduce((n, w, h) => n + w * hidden[h], this.b2[k]),
    );
    const max = Math.max(...logits),
      exp = logits.map((l) => Math.exp(l - max)),
      sum = exp.reduce((a, b) => a + b, 0);
    return { hidden, probs: exp.map((v) => v / sum) };
  }
  sample(rng: Random, context: number[], legal: number[]): Decision {
    const { probs } = this.forward(context, legal);
    let q = rng.next(),
      i = 0;
    for (; i < legal.length - 1; i++) {
      q -= probs[i];
      if (q <= 0) break;
    }
    return { context, legal, choice: legal[i] };
  }
  update(batch: { decisions: Decision[]; reward: number }[]) {
    if (batch.length < 2) return;
    const mean = batch.reduce((n, b) => n + b.reward, 0) / batch.length,
      std =
        Math.sqrt(
          batch.reduce((n, b) => n + (b.reward - mean) ** 2, 0) / batch.length,
        ) + 1e-5;
    const g1 = this.w1.map((r) => r.map(() => 0)),
      g2 = this.w2.map((r) => r.map(() => 0)),
      b1 = this.b1.map(() => 0),
      b2 = this.b2.map(() => 0);
    for (const item of batch)
      for (const d of item.decisions) {
        const { hidden, probs } = this.forward(d.context, d.legal),
          adv = (item.reward - mean) / std;
        const deltas = d.legal.map(
          (k, j) => adv * ((k === d.choice ? 1 : 0) - probs[j]),
        );
        for (let h = 0; h < HIDDEN; h++) {
          const dh =
            d.legal.reduce((n, k, j) => n + deltas[j] * this.w2[k][h], 0) *
            (1 - hidden[h] * hidden[h]);
          b1[h] += dh;
          for (let i = 0; i < FEATURES; i++) g1[h][i] += dh * d.context[i];
        }
        d.legal.forEach((k, j) => {
          b2[k] += deltas[j];
          for (let h = 0; h < HIDDEN; h++) g2[k][h] += deltas[j] * hidden[h];
        });
      }
    const rate = 0.012 / batch.length;
    for (let h = 0; h < HIDDEN; h++) {
      this.b1[h] += rate * clipped(b1[h]);
      for (let i = 0; i < FEATURES; i++)
        this.w1[h][i] += rate * clipped(g1[h][i]);
    }
    for (let k = 0; k < CHOICES; k++) {
      this.b2[k] += rate * clipped(b2[k]);
      for (let h = 0; h < HIDDEN; h++)
        this.w2[k][h] += rate * clipped(g2[k][h]);
    }
  }
}
const clipped = (x: number) => Math.max(-100, Math.min(100, x));
