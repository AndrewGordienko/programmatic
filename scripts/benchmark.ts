import { mkdirSync, writeFileSync } from "node:fs";
import { evolveLanguage } from "../src/engine/language";

// Fixed, predeclared seed suite; keep losses as well as improvements.
const seeds = [0, 1, 2, 3, 42];
const rows = seeds.map((seed) => {
  const generator = evolveLanguage(seed);
  let step = generator.next();
  while (!step.done) step = generator.next();
  const r = step.value;
  const row = {
    seed,
    fixedSolves: r.trials.filter((t) => t.fixed.solved).length,
    evolvedSolves: r.trials.filter((t) => t.evolved.solved).length,
    trials: r.trials.length,
    macros: r.macros.map((m) => m.definition),
    discoveryEvaluations: r.discoveryEvaluations,
    comparisonEvaluations: r.comparisonEvaluations,
  };
  console.log(JSON.stringify(row));
  return row;
});
mkdirSync("output", { recursive: true });
writeFileSync(
  "output/dsl-benchmark.json",
  JSON.stringify(
    {
      description:
        "Five predeclared language-search seeds, nine paired final trials per seed. Synthetic scalar tasks only; no statistical-significance claim.",
      seeds,
      rows,
      totals: {
        fixed: rows.reduce((a, r) => a + r.fixedSolves, 0),
        evolved: rows.reduce((a, r) => a + r.evolvedSolves, 0),
        pairedTrials: rows.reduce((a, r) => a + r.trials, 0),
      },
    },
    null,
    2,
  ),
);
