import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Expr, Macro } from "../src/dsl/types";
import { linearPieces, type Segment } from "../src/joint/domains";
const folder = "output/joint/lattice-evolution-v1";
const protocol = JSON.parse(readFileSync(`${folder}/protocol.json`, "utf8"));
const a: Expr = { op: "arg", value: 0, args: [] },
  c = (value: number): Expr => ({ op: "const", value, args: [] }),
  op = (op: string, ...args: Expr[]): Expr => ({ op, args });
// Auditor-only ground truth. Called solely on retained completed-run artifacts;
// these names and equivalence labels never enter proposals, selection or policy.
const concepts = {
  magnitude: op("max", a, op("neg", a)),
  positivePart: op("max", c(0), a),
  clamp01: op("max", c(0), op("min", c(1), a)),
};
let derivations = 0,
  intervalComparisons = 0;
const derive = (e: Expr) => {
  derivations++;
  return linearPieces(e);
};
const targets = Object.fromEntries(
  Object.entries(concepts).map(([name, tree]) => [name, derive(tree)!]),
);
const equivalent = (left: Segment[] | null, right: Segment[]) => {
  if (!left) return false;
  const boundaries = [
    ...new Set([...left, ...right].flatMap((s) => [s.lo, s.hi])),
  ].sort((a, b) => a - b);
  for (let i = 0; i < boundaries.length - 1; i++) {
    intervalComparisons++;
    const lo = boundaries[i],
      hi = boundaries[i + 1];
    const probe =
      Number.isFinite(lo) && Number.isFinite(hi)
        ? lo + (hi - lo) / 2
        : Number.isFinite(lo)
          ? lo + 1
          : Number.isFinite(hi)
            ? hi - 1
            : 0;
    const p = left.find((s) => s.lo < probe && s.hi > probe),
      q = right.find((s) => s.lo < probe && s.hi > probe);
    if (!p || !q || Math.abs(p.a - q.a) > 1e-9 || Math.abs(p.b - q.b) > 1e-9)
      return false;
  }
  return true;
};
const cache = new Map<string, unknown>();
const classify = (macro: Macro) => {
  if (macro.arity !== 1) return null;
  const key = JSON.stringify(macro.body);
  if (cache.has(key)) return cache.get(key);
  const exact = derive(macro.body),
    matches = [];
  for (const [name, target] of Object.entries(targets)) {
    if (equivalent(exact, target)) {
      matches.push({ concept: name, kind: "direct", sign: 1, offset: 0 });
      continue;
    }
    let found = false;
    for (const sign of [1, -1])
      for (const offset of [0, 1, -1, 2, -2]) {
        if (found || (sign === 1 && offset === 0)) continue;
        const arg = op("add", op("mul", c(sign), a), c(offset));
        const substitute = (e: Expr): Expr =>
          e.op === "arg" ? arg : { ...e, args: e.args.map(substitute) };
        if (equivalent(derive(substitute(macro.body)), target)) {
          matches.push({
            concept: name,
            kind: "affine-input-reparameterization",
            sign,
            offset,
          });
          found = true;
        }
      }
  }
  cache.set(key, matches);
  return matches;
};
const runs = [];
for (const seed of protocol.config.seeds) {
  const path = `${folder}/seed-${seed}.json.gz`;
  if (!existsSync(path)) continue;
  const run = JSON.parse(gunzipSync(readFileSync(path)).toString());
  if (run.protocolHash !== protocol.protocolHash)
    throw new Error("Protocol mismatch");
  const stage = (macros: Macro[]) =>
    macros.map((m) => ({
      definition: m.definition,
      support: m.support,
      matches: classify(m),
    }));
  runs.push({
    seed,
    accepted: run.accepted,
    rounds: run.rounds.map(
      (r: {
        round: number;
        corpus: number;
        proposed: { macro: Macro }[];
        medium: { genome: { macros: Macro[] } }[];
      }) => ({
        round: r.round,
        corpus: r.corpus,
        proposals: stage(r.proposed.slice(0, 100).map((p) => p.macro)),
        selected: stage(r.medium[0].genome.macros),
      }),
    ),
    frozen: stage(run.candidate.macros),
  });
}
writeFileSync(
  `${folder}/concept-audit.json`,
  JSON.stringify(
    {
      protocolHash: protocol.protocolHash,
      complete: runs.length === protocol.config.seeds.length,
      derivations,
      intervalComparisons,
      note: "Post-hoc auditor only, never a learner feature or selection label. Unary macros are compared by their piecewise-affine segment coefficients across every induced interval, with floating-point tolerance; this is not a general equivalence prover. Direct equivalence is distinguished from an explicit sign/offset input substitution. Multi-argument macros are unclassified, not declared useless. Audit cost is separate research overhead.",
      runs,
    },
    null,
    2,
  ),
);
console.log(runs.map((r) => ({ seed: r.seed, frozen: r.frozen })));
