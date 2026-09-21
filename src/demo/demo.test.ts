import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveEvidence, type DemoEvidence } from "./evidence";
import { ChallengeSearch, type FrozenArtifact } from "../challenge/protocol";
import { simulate } from "../offroad/simulator";
import { REHEARSAL, DEMO_BUDGET } from "./useSynthesis";
const read = (p: string) => JSON.parse(readFileSync(`public/${p}`, "utf8"));
test("presentation evidence reproduces the recorded benchmark and source hashes", () => {
  const e: DemoEvidence = read("demo-evidence.json");
  const { sources, ...recorded } = e;
  assert.deepEqual(
    recorded,
    deriveEvidence(
      read("offroad-benchmark.json"),
      read("offroad-reference.json"),
      read("library-benchmark.json"),
      read("library-reference.json"),
    ),
  );
  for (const source of sources)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(`public${source.path}`))
        .digest("hex"),
      source.sha256,
    );
  const mismatch = read("offroad-reference.json");
  mismatch.simulatorVersion = "old";
  assert.throws(() =>
    deriveEvidence(
      read("offroad-benchmark.json"),
      mismatch,
      read("library-benchmark.json"),
      read("library-reference.json"),
    ),
  );
});
test("rehearsal synthesizes from an empty population and the returned program drives to the goal", () => {
  const artifact: FrozenArtifact = read("offroad-frozen.json");
  const race = new ChallengeSearch(artifact, REHEARSAL, DEMO_BUDGET, []);
  assert.equal(race.search.population.length, 0);
  while (race.state().status === "searching") race.advance();
  const result = race.state();
  assert.equal(result.status, "solved");
  assert.ok(result.evaluations > 0 && result.evaluations <= DEMO_BUDGET);
  assert.ok(result.solution);
  assert.equal(
    simulate(result.solution.program, race.terrain).end.status,
    "arrived",
  );
});
