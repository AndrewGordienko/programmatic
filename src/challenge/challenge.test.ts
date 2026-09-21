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
import { simulate } from "../offroad/simulator";
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
