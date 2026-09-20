import { Random } from "./random";
import { OPS } from "./types";

// Tiny, real neural grammar prior. Input: relative gene position + preceding
// operator. One tanh hidden layer predicts the next operator. Trained with
// REINFORCE using normalized episodic fitness, with a batch-mean baseline.
const HIDDEN = 16;
export type Decision = { input: number[]; choice: number; first: boolean };
type Forward = { hidden: number[]; probs: number[] };
export class NeuralPrior {
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
  private inputs: number;
  private outputs: number;
  private firstAllowed: number;
  constructor(
    rng: Random,
    operatorCount: number = OPS.length,
    firstAllowed = 5,
  ) {
    this.inputs = operatorCount + 2;
    this.outputs = operatorCount;
    this.firstAllowed = firstAllowed;
    this.w1 = Array.from({ length: HIDDEN }, () =>
      Array.from({ length: this.inputs }, () => (rng.next() - 0.5) * 0.3),
    );
    this.w2 = Array.from({ length: this.outputs }, () =>
      Array.from({ length: HIDDEN }, () => (rng.next() - 0.5) * 0.3),
    );
    this.b1 = Array(HIDDEN).fill(0);
    this.b2 = Array(this.outputs).fill(0);
  }
  forward(input: number[], first: boolean): Forward {
    const hidden = this.w1.map((row, h) =>
      Math.tanh(row.reduce((v, w, i) => v + w * input[i], this.b1[h])),
    );
    const logits = this.w2.map((row, o) =>
      first && o >= this.firstAllowed
        ? -1e9
        : row.reduce((v, w, h) => v + w * hidden[h], this.b2[o]),
    );
    const max = Math.max(...logits),
      exp = logits.map((l) => Math.exp(l - max)),
      total = exp.reduce((a, b) => a + b, 0);
    return { hidden, probs: exp.map((e) => e / total) };
  }
  sample(
    rng: Random,
    index: number,
    length: number,
    previous: number,
  ): Decision {
    const input = Array(this.inputs).fill(0);
    input[0] = index / length;
    input[1] = 1;
    if (previous >= 0) input[previous + 2] = 1;
    const first = index === 0,
      { probs } = this.forward(input, first);
    let p = rng.next(),
      choice = 0;
    for (; choice < probs.length - 1; choice++) {
      p -= probs[choice];
      if (p <= 0) break;
    }
    return { input, choice, first };
  }
  update(batch: { decisions: Decision[]; reward: number }[]) {
    if (batch.length < 2) return;
    const mean = batch.reduce((a, b) => a + b.reward, 0) / batch.length;
    const std =
      Math.sqrt(
        batch.reduce((a, b) => a + (b.reward - mean) ** 2, 0) / batch.length,
      ) + 1e-6;
    // Batch gradients keep all likelihoods under the distribution that sampled
    // the population; no parameter updates occur halfway through the batch.
    const dw1 = this.w1.map((row) => row.map(() => 0)),
      dw2 = this.w2.map((row) => row.map(() => 0));
    const db1 = this.b1.map(() => 0),
      db2 = this.b2.map(() => 0);
    for (const item of batch) {
      const advantage = (item.reward - mean) / std;
      for (const d of item.decisions) {
        const { hidden, probs } = this.forward(d.input, d.first);
        const delta = probs.map(
          (p, o) => advantage * (Number(o === d.choice) - p),
        );
        for (let h = 0; h < HIDDEN; h++) {
          const dh =
            delta.reduce((a, v, o) => a + v * this.w2[o][h], 0) *
            (1 - hidden[h] ** 2);
          db1[h] += dh;
          for (let i = 0; i < this.inputs; i++) dw1[h][i] += dh * d.input[i];
        }
        for (let o = 0; o < this.outputs; o++) {
          db2[o] += delta[o];
          for (let h = 0; h < HIDDEN; h++) dw2[o][h] += delta[o] * hidden[h];
        }
      }
    }
    const rate = 0.04 / batch.length;
    for (let h = 0; h < HIDDEN; h++) {
      this.b1[h] += rate * db1[h];
      for (let i = 0; i < this.inputs; i++) this.w1[h][i] += rate * dw1[h][i];
    }
    for (let o = 0; o < this.outputs; o++) {
      this.b2[o] += rate * db2[o];
      for (let h = 0; h < HIDDEN; h++) this.w2[o][h] += rate * dw2[o][h];
    }
  }
  distribution() {
    const input = Array(this.inputs).fill(0);
    input[0] = 0.5;
    input[1] = 1;
    return this.forward(input, false).probs;
  }
}
