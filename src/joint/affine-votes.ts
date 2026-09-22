import type { Example } from "../dsl/types";
import { simpleSlopes } from "./affine-slopes";

/** Infer an integer intercept from each observation for every bounded slope.
 * Votes propose affine fragments, not complete task solutions. Every retained
 * fragment must still be executed by the caller and charged as a program. */
export function affineVotes(
  examples: Example[],
  charge: () => boolean,
  point: () => void,
  minimumSupport = 4,
  requireIndependent = false,
): { coeff: number[]; support: number }[] {
  const rows: { coeff: number[]; support: number }[] = [];
  for (const { alpha, beta } of simpleSlopes) {
    if (!charge()) break;
    const intercepts = new Map<
      number,
      { support: number; p: number[]; q?: number[]; independent: boolean }
    >();
    for (const e of examples) {
      point();
      const raw = e.output - alpha * e.input[0] - beta * e.input[1];
      const gamma = Math.round(raw);
      if (Math.abs(raw - gamma) <= 1e-7 && Math.abs(gamma) <= 8) {
        const row = intercepts.get(gamma);
        if (!row)
          intercepts.set(gamma, { support: 1, p: e.input, independent: false });
        else {
          row.support++;
          if (requireIndependent && !row.independent) {
            const dx = e.input[0] - row.p[0],
              dy = e.input[1] - row.p[1];
            if (!row.q && Math.max(Math.abs(dx), Math.abs(dy)) > 1e-9)
              row.q = e.input;
            else if (
              row.q &&
              Math.abs(
                dx * (row.q[1] - row.p[1]) - dy * (row.q[0] - row.p[0]),
              ) > 1e-9
            )
              row.independent = true;
          }
        }
      }
    }
    for (const [gamma, row] of intercepts)
      if (
        row.support >= minimumSupport &&
        (!requireIndependent || row.independent)
      )
        rows.push({ coeff: [alpha, beta, gamma], support: row.support });
  }
  return rows.sort(
    (a, b) =>
      b.support - a.support ||
      a.coeff.reduce((s, v) => s + Math.abs(v), 0) -
        b.coeff.reduce((s, v) => s + Math.abs(v), 0),
  );
}
