import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { makeTasks } from "../src/dsl/tasks";
import { synthesize } from "../src/dsl/search";
import type { CorpusEntry } from "../src/dsl/types";
import { dreamDataset } from "../src/joint/dreams";
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const corpus: CorpusEntry[] = [];
let bootstrapEvaluations = 0;
for (let i = 0; i < 100; i++) {
  const task = suite.training[i],
    r = synthesize(task, [], undefined, i * 97, 1536);
  bootstrapEvaluations += r.evaluations;
  if (r.solved) corpus.push({ task, tree: r.tree });
}
const start = performance.now(),
  data = dreamDataset(corpus, [], 7721, 5000);
mkdirSync("output/joint/neural", { recursive: true });
writeFileSync(
  "output/joint/neural/data.json.gz",
  gzipSync(JSON.stringify(data)),
);
writeFileSync(
  "output/joint/neural/data-manifest.json",
  JSON.stringify(
    {
      seed: data.seed,
      corpus: corpus.length,
      programs: data.programs.length,
      decisions: data.decisions.length,
      bootstrapEvaluations,
      generationMs: performance.now() - start,
      note: "Training corpus + executed random/corpus-mutated dreams only. No calibration or final target ASTs.",
    },
    null,
    2,
  ),
);
console.log({
  programs: data.programs.length,
  decisions: data.decisions.length,
});
