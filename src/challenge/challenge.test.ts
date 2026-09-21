import { diagnoseStart } from "./feasibility";
import { makeTerrain } from "../offroad/terrain";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ChallengeSearch,
  freshSpecs,
  validateArtifact,
  validateManifest,
  VERSION,
  SEED_MIN,
  type FrozenArtifact,
  type Manifest,
} from "./protocol";
import { simulate, initialState, step } from "../offroad/simulator";
import { validate } from "../offroad/program";
import { Random } from "../engine/random";
const artifact: FrozenArtifact = JSON.parse(
  readFileSync("public/offroad-frozen.json", "utf8"),
);
const spec = { seed: SEED_MIN + 100, kind: "ridge" as const, searchSeed: 42 };
test("frozen artifact has a verified hash, separate seed namespace and no policy", () => {
  validateArtifact(artifact);
  assert.equal(
    createHash("sha256").update(JSON.stringify(artifact.payload)).digest("hex"),
    artifact.hash,
  );
  assert.ok(!("program" in artifact.payload));
  const m: Manifest = {
    version: VERSION,
    createdAt: new Date().toISOString(),
    artifactHash: artifact.hash,
    budget: 31,
    challenges: [spec],
    mode: "learned",
  };
  validateManifest(m, artifact);
  assert.throws(() =>
    validateManifest(
      { ...m, challenges: [{ ...spec, seed: 42000 }] },
      artifact,
    ),
  );
  assert.throws(() =>
    validateManifest({ ...m, artifactHash: "changed" }, artifact),
  );
  assert.throws(() =>
    validateManifest({ ...m, createdAt: "2020-01-01T00:00:00Z" }, artifact),
  );
  assert.throws(() =>
    validateManifest({ ...m, challenges: [spec, spec] }, artifact),
  );
});
test("challenge generation rejects reused seeds without filtering outcomes", () => {
  const rng = new Random(27),
    word = () => Math.floor(rng.next() * 2 ** 32);
  const first = freshSpecs(10, new Set(), word),
    second = freshSpecs(10, new Set(first.map((c) => c.seed)), word);
  assert.equal(new Set([...first, ...second].map((c) => c.seed)).size, 20);
  assert.ok(first.every((c) => c.seed >= SEED_MIN));
});
test("paired searches start empty, freeze weights, respect exact caps and reproduce without macros", () => {
  const a = new ChallengeSearch(artifact, spec, 137, []),
    b = new ChallengeSearch(artifact, spec, 137, []);
  const weights = JSON.stringify(a.search.prior.freeze());
  assert.equal(a.search.population.length, 0);
  while (a.state().status === "searching") {
    const x = a.advance(),
      y = b.advance();
    assert.equal(x.evaluations, y.evaluations);
    assert.deepEqual(x.best, y.best);
    assert.deepEqual(x.solution, y.solution);
  }
  assert.ok(a.state().evaluations <= 137);
  if (a.state().status === "exhausted")
    assert.equal(a.state().evaluations, 137);
  assert.equal(JSON.stringify(a.search.prior.freeze()), weights);
  assert.equal(a.search.discoveryRollouts, 0);
  assert.deepEqual(a.search.macros, []);
  const stopped = a.state().evaluations;
  a.advance();
  assert.equal(a.state().evaluations, stopped);
});
test("a discovered solution is the evaluated program and reproduces in deployment", () => {
  // This is a deterministic implementation fixture, not a selected demo result.
  const race = new ChallengeSearch(
    artifact,
    { seed: SEED_MIN + 250, kind: "woodland", searchSeed: 27 },
    500,
    [],
  );
  while (race.state().status === "searching") race.advance();
  const s = race.state();
  assert.ok(s.best && validate(s.best.program));
  if (s.solution) {
    assert.equal(simulate(s.solution.program, race.terrain).success, true);
    assert.equal(s.solution.success, 1);
  } else assert.equal(s.evaluations, 500);
});

test("reported ridge start is immobile under arbitrary bounded commands and costs no new synthesis", () => {
  const badSpec = {
    seed: 2124797507,
    kind: "ridge" as const,
    searchSeed: 881497,
  };
  const race = new ChallengeSearch(artifact, badSpec, 50_000, []);
  const diagnosis = diagnoseStart(race.terrain)!;
  assert.equal(diagnosis.code, "immobile-start");
  assert.ok(diagnosis.opposingGravity > diagnosis.maximumDrive);
  assert.ok(Math.abs(diagnosis.pitchDegrees - 20.812098686273213) < 1e-10);
  const before = initialState(race.terrain),
    rng = new Random(72);
  let state = before;
  while (state.status === "driving")
    state = step(
      state,
      { steering: rng.next() * 2 - 1, acceleration: rng.next() * 2 - 1 },
      race.terrain,
    );
  assert.equal(state.distance, 0);
  assert.equal(state.speed, 0);
  assert.equal(state.status, "timeout");
  assert.equal(state.x, before.x);
  assert.equal(state.z, before.z);
  assert.equal(race.advance().status, "infeasible");
  assert.equal(race.state().evaluations, 0);
  assert.equal(race.state().solution, null);
  // Historical manifests without the check still reproduce the old search.
  const old = new ChallengeSearch(artifact, badSpec, 3, [], false);
  assert.equal(old.advance().status, "exhausted");
  assert.equal(old.state().evaluations, 3);
});

test("immobility check does not mistake ordinary hills or downhill starts for impossibility", () => {
  const t = makeTerrain(5, "ridge");
  t.rocks = [];
  t.start = { x: 0, z: 0, heading: 0 };
  t.grips.fill(0.88);
  for (const grade of [0, 0.2, -0.7]) {
    t.heights = t.heights.map(
      (_, i) => (Math.floor(i / t.resolution) - 50) * grade,
    );
    assert.equal(diagnoseStart(t), null);
  }
  t.heights = t.heights.map(
    (_, i) => (Math.floor(i / t.resolution) - 50) * 0.1,
  );
  t.grips.fill(0.01);
  assert.equal(diagnoseStart(t)?.code, "immobile-start");
});
