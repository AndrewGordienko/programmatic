import { writeFileSync } from "node:fs";
import { synthesize } from "../src/dsl/search";
import { synthesizeDiverse } from "../src/prospective/synthesis";
import { synthesizeReplay } from "../src/prospective/replay";
import { makeTasks } from "../src/dsl/tasks";
import { DEFAULT, type CorpusEntry } from "../src/dsl/types";
import { fitPrior } from "../src/dsl/prior";
const old = makeTasks(DEFAULT),
  excluded = new Set(
    Object.values(old)
      .flat()
      .map((t) => t.signature),
  );
const suite = makeTasks(DEFAULT, {
  seed: 911327,
  exclude: excluded,
  prefix: "prospective",
});
const corpus: CorpusEntry[] = [];
for (let i = 0; i < 100; i++) {
  const s = synthesize(suite.training[i], [], undefined, 9000 + i * 97, 1536);
  if (s.solved) corpus.push({ task: suite.training[i], tree: s.tree });
}
const prior = fitPrior(corpus, [], 501);
const rows: {
  task: string;
  seed: number;
  base: ReturnType<typeof synthesize>;
  diverse: ReturnType<typeof synthesize>;
  replay: ReturnType<typeof synthesize>;
}[] = [];
// Calibration is restricted to training tasks and does not use the final suite.
for (const task of suite.training.slice(100, 180))
  for (const seed of [0, 7, 42]) {
    const base = synthesize(task, [], prior, seed, 1536),
      diverse = synthesizeDiverse(task, [], prior, seed, 1536),
      replay = synthesizeReplay(task, [], prior, seed, 1536, corpus);
    rows.push({ task: task.id, seed, base, diverse, replay });
  }
const stats = (k: "base" | "diverse" | "replay") => ({
  solves: rows.filter((r) => r[k].solved).length,
  trials: rows.length,
  effort: rows.reduce((s, r) => s + r[k].effort, 0),
  wallMs: rows.reduce((s, r) => s + r[k].elapsedMs, 0),
});
const result = {
  description:
    "Inner search calibration on training tasks only. Same prior, seeds and 1536-proposal cap. New suite excludes all v1 task signatures. Replay reuses only the separate first-100-task solved corpus; every seed program is charged.",
  corpus: corpus.length,
  base: stats("base"),
  diverse: stats("diverse"),
  replay: stats("replay"),
  rows,
};
writeFileSync(
  "output/prospective/inner-calibration.json",
  JSON.stringify(result),
);
console.log(
  JSON.stringify({
    base: result.base,
    diverse: result.diverse,
    replay: result.replay,
  }),
);
