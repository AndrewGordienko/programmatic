// Oracle concepts exist ONLY in this diagnostic. Production proposal/selection
// code never imports this module or receives these labels or generating ASTs.
import { mkdirSync, writeFileSync } from "node:fs";
import { Random } from "../src/engine/random";
import { evalExpr } from "../src/dsl/expressions";
import { mine } from "../src/dsl/mining";
import { makeTasks } from "../src/dsl/tasks";
import { synthesize } from "../src/dsl/search";
import type { CorpusEntry, Macro } from "../src/dsl/types";
import { genome, propose } from "../src/joint/genome";
const normalized = process.argv.includes("--normalized");
const rng = new Random(7723),
  probes = [
    -10,
    -4,
    -1,
    -0.5,
    0,
    0.25,
    0.5,
    1,
    2,
    4,
    10,
    ...Array.from({ length: 200 }, () => rng.next() * 20 - 10),
  ];
const concepts = {
  magnitude: (x: number) => Math.abs(x),
  positivePart: (x: number) => Math.max(0, x),
  unitClamp: (x: number) => Math.max(0, Math.min(1, x)),
};
const matches = (macros: Macro[]) =>
  Object.fromEntries(
    Object.entries(concepts).map(([name, f]) => [
      name,
      macros
        .filter(
          (m) =>
            m.arity === 1 &&
            probes.every((x) => Math.abs(evalExpr(m.body, [x]) - f(x)) < 1e-8),
        )
        .map((m) => m.definition),
    ]),
  );
const runs = [0, 7, 42].map((seed) => {
  const suite = makeTasks(
    { training: 200, development: 48, confirmation: 24, testing: 80 },
    { seed: 20260921 + seed * 1009, prefix: `joint-${seed}` },
  );
  const corpus: CorpusEntry[] = [];
  for (let i = 0; i < 200; i++) {
    const task = suite.training[i],
      r = synthesize(task, [], undefined, seed * 100003 + i * 97, 1536);
    if (r.solved) corpus.push({ task, tree: r.tree });
  }
  const mined = mine(corpus, []).map((x) => x.macro),
    languages = propose([genome([])], corpus, seed, 128, { normalized }),
    macros = [
      ...new Map(
        languages.flatMap((l) => l.macros).map((m) => [m.name, m]),
      ).values(),
    ];
  return {
    seed,
    corpus: corpus.length,
    mined: { count: mined.length, matches: matches(mined) },
    proposed: {
      languages: languages.length,
      definitions: macros.length,
      matches: matches(macros),
    },
  };
});
mkdirSync("output/joint", { recursive: true });
writeFileSync(
  normalized
    ? "output/joint/proposal-recall-normalized.json"
    : "output/joint/proposal-recall.json",
  JSON.stringify(
    {
      note: "Diagnostic labels only; not fed into proposal ranking, selection or training.",
      runs,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(runs, null, 2));
