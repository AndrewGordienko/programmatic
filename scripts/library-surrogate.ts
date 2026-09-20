import { readFileSync, writeFileSync } from "node:fs";
import { editFeatures, fitValue, predictValue } from "../src/dsl/value";
import { mean } from "../src/dsl/metrics";
import type { Result } from "../src/dsl/types";
const trainingSeeds = Array.from({ length: 16 }, (_, i) => i),
  testSeeds = [16, 17, 18, 42];
const records = [...trainingSeeds, ...testSeeds].flatMap((seed) => {
  const r: Result = JSON.parse(
    readFileSync(`output/library/seed-${seed}.json`, "utf8"),
  );
  return r.proposals
    .filter((p) => p.development !== undefined)
    .map((p) => ({
      seed,
      round: p.round,
      label: p.label,
      x: editFeatures(p, r),
      y: p.development!,
      compression: p.compression,
    }));
});
const training = records.filter((r) => trainingSeeds.includes(r.seed)),
  testing = records.filter((r) => testSeeds.includes(r.seed));
const model = fitValue(training),
  rows = [];
for (const seed of testSeeds)
  for (const round of [1, 2]) {
    const candidates = testing.filter(
      (r) => r.seed === seed && r.round === round,
    );
    if (candidates.length < 2) continue;
    const selected = [...candidates].sort(
      (a, b) => predictValue(model, b.x) - predictValue(model, a.x),
    )[0];
    const compressed = [...candidates].sort(
      (a, b) => b.compression - a.compression,
    )[0];
    rows.push({
      seed,
      round,
      oracle: Math.max(...candidates.map((c) => c.y)),
      model: selected.y,
      compression: compressed.y,
      random: mean(candidates.map((c) => c.y)),
      predictions: candidates.map((c) => ({
        ...c,
        predicted: predictValue(model, c.x),
      })),
    });
  }
const result = {
  version: "library-value-probe-v1",
  trainingSeeds,
  testSeeds,
  records: records.length,
  groups: rows.length,
  model,
  rows,
  regret: {
    model: mean(rows.map((r) => r.oracle - r.model)),
    compression: mean(rows.map((r) => r.oracle - r.compression)),
    random: mean(rows.map((r) => r.oracle - r.random)),
  },
  savedSynthesisEvaluations: 0,
  note: "Offline ranking probe among three already-screened, fully evaluated finalists per round. Train meta-seeds 0–15; test 16, 17, 18, 42. Selection-biased labels: this does not measure ranking across all edits, or saved outer-search compute. No final-task outcomes train the model.",
};
writeFileSync("public/library-surrogate.json", JSON.stringify(result));
writeFileSync(
  "output/library/edit-value-dataset.json",
  JSON.stringify({ description: result.note, records }),
);
console.log(
  JSON.stringify({
    records: result.records,
    groups: rows.length,
    regret: result.regret,
  }),
);
