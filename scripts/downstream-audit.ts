import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { compile, valid } from "../src/dsl/expressions";
import { inverseSearch } from "../src/joint/inverse";
const folder = "output/joint/downstream-stream-v1";
if (existsSync(`${folder}/audit.json`)) throw new Error("Preserve audit");
const read = (p: string) =>
  JSON.parse(
    p.endsWith(".gz")
      ? gunzipSync(readFileSync(p)).toString()
      : readFileSync(p, "utf8"),
  );
const protocol = read(`${folder}/protocol.json`),
  seal = read(`${folder}/sealed.json`),
  source = read("output/joint/selective-evolution-v1/seed-211-value.json.gz"),
  policy = read("output/joint/neural/policy.json");
const selected = new Set([
    0,
    1215,
    19999,
    ...Array.from({ length: 20 }, (_, i) => i * 997),
  ]),
  replays = [];
let programs = 0,
  pointExecutions = 0;
const started = performance.now();
for (const b of seal.batches) {
  const taskBytes = readFileSync(`${folder}/tasks-${b.batch}.json.gz`);
  assert.equal(createHash("sha256").update(taskBytes).digest("hex"), b.hash);
  const tasks = JSON.parse(gunzipSync(taskBytes).toString()).tasks;
  const rows = read(`${folder}/batch-${b.batch}.json.gz`).trials;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i],
      task = tasks[i];
    assert.equal(row.signature, task.signature);
    for (const arm of ["base", "learned"]) {
      const macros = arm === "base" ? [] : source.candidate.macros,
        r = row.result[arm];
      assert.ok(valid(r.tree, macros));
      const f = compile(r.tree, macros);
      programs++;
      const error = (xs: typeof task.examples) =>
        xs.reduce(
          (s: number, e: { input: [number, number]; output: number }) => {
            pointExecutions++;
            return s + Math.abs(f(...e.input) - e.output);
          },
          0,
        ) / xs.length;
      const train = error(task.examples),
        check = error(task.checks);
      assert.ok(Math.abs(train - r.trainError) < 1e-8);
      assert.ok(Math.abs(check - r.checkError) < 1e-8);
      assert.equal(r.solved, train < 1e-8 && check < 1e-8);
      if (selected.has(row.index)) {
        const repeat = inverseSearch(
          task,
          macros,
          policy,
          row.seed,
          protocol.config.budget,
          protocol.config.search,
        );
        assert.deepEqual(repeat.tree, r.tree);
        assert.equal(repeat.evaluations, r.evaluations);
        assert.equal(repeat.expansions, r.expansions);
        replays.push({
          index: row.index,
          arm,
          work: repeat.work,
          evaluations: repeat.evaluations,
          recordedMs: r.elapsedMs,
          replayMs: repeat.elapsedMs,
        });
      }
    }
  }
}
writeFileSync(
  `${folder}/audit.json`,
  JSON.stringify(
    {
      protocolHash: protocol.protocolHash,
      programs,
      pointExecutions,
      replays,
      elapsedMs: performance.now() - started,
      replayWork: replays.reduce((s, r) => s + r.work, 0),
      note: "Post-run verification expense, separately charged as research audit. Every returned program is re-executed on all observations/checks; deterministic selected searches include the timing-anomaly trial. Timings are not replaced. Equal trajectories/counters on replay support count-based results, not a wall-payback claim.",
    },
    null,
    2,
  ),
);
console.log(
  `Verified ${programs} programs and ${replays.length} exact search replays`,
);
