import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Random } from "../engine/random";
import { GraphPrior } from "./prior";
import { activeGenes, compile, runOp, validate } from "./program";
import { OffroadSearch } from "./search";
import { evaluate, initialState, observe, simulate, step } from "./simulator";
import {
  groundPose,
  heightAt,
  makeTerrain,
  testTerrains,
  trainingTerrains,
} from "./terrain";
import {
  ANGLES,
  CONFIG,
  INPUTS,
  RAYS,
  type Macro,
  type Program,
  type Snapshot,
  type Terrain,
} from "./types";

function flat(): Terrain {
  const t = makeTerrain(0);
  t.heights.fill(0);
  t.grips.fill(0.9);
  t.rocks = [];
  t.start = { x: 0, z: -40, heading: 0 };
  t.goal = { x: 0, z: 40 };
  t.initialDistance = 80;
  return t;
}

test("terrain is repeatable, genuinely uneven, and has no prescribed route", () => {
  const t = makeTerrain(42, "ridge");
  assert.deepEqual(t, makeTerrain(42, "ridge"));
  assert.ok(Math.max(...t.heights) - Math.min(...t.heights) > 3);
  assert.ok(t.rocks.length >= 12);
  assert.ok(!("points" in t));
  assert.equal(heightAt(t, 0, 0), t.heights[50 * t.resolution + 50]);
  const train = trainingTerrains(999999, 18),
    devBase = 1_300_000_000;
  for (const kind of ["woodland", "quarry", "ridge"] as const)
    for (const t of testTerrains(kind)) {
      assert.ok(t.seed > devBase + 100000);
      assert.ok(train.every((w) => w.seed !== t.seed));
    }
});

test("terrain changes vehicle physics: gravity, traction, tilt, clearance and stability", () => {
  const level = flat(),
    hill = structuredClone(level);
  hill.heights = hill.heights.map(
    (_, i) => (Math.floor(i / hill.resolution) - 50) * 0.25,
  );
  const levelState = step(
      initialState(level),
      { steering: 0, acceleration: 1 },
      level,
      1,
    ),
    hillState = step(
      initialState(hill),
      { steering: 0, acceleration: 1 },
      hill,
      1,
    );
  assert.ok(hillState.pitch > 0.2);
  assert.ok(hillState.speed < levelState.speed);
  const mud = structuredClone(level);
  mud.grips.fill(0.15);
  assert.ok(
    step(initialState(mud), { steering: 0, acceleration: 1 }, mud, 1).speed <
      levelState.speed,
  );
  const steep = structuredClone(level);
  steep.heights = steep.heights.map(
    (_, i) => ((i % steep.resolution) - 50) * 0.9,
  );
  assert.equal(
    step(initialState(steep), { steering: 0, acceleration: 0 }, steep).status,
    "rollover",
  );
  const hump = structuredClone(level);
  hump.start = { x: 0, z: 0, heading: 0 };
  hump.heights[50 * hump.resolution + 50] = 2;
  assert.ok(groundPose(hump, 0, 0, 0).clearance < 0);
  assert.equal(
    step(initialState(hump), { steering: 0, acceleration: 0 }, hump).status,
    "grounded",
  );
});

test("rock sensing and swept rectangular collisions are physical, not avoidance overrides", () => {
  const t = flat(),
    s = { ...initialState(t), speed: 9 };
  t.rocks.push({ x: 0, z: -35.7, radius: 0.7, height: 2 });
  const scan = observe(s, t);
  assert.ok(scan.vectors[1][9] < 0.1);
  assert.equal(scan.vectors.length * RAYS + scan.scalars.length, 104);
  const hit = step(s, { steering: 0, acceleration: 1 }, t);
  assert.equal(hit.status, "collision");
  assert.equal(hit.controls.steering, 0);
  assert.ok(hit.z < -35.7);
  assert.equal(step(hit, { steering: 1, acceleration: -1 }, t), hit);
});

test("typed programs reject invalid directions and preserve learned macro semantics", () => {
  const macro: Macro = {
    name: "m",
    output: "vector",
    args: ["vector", "vector", "vector"],
    inner: "v_add",
    outer: "v_mul",
    slot: 0,
    definition: "m(a,b,c) = v_mul(v_add(a,b),c)",
  };
  const a = Float64Array.from(ANGLES),
    b = new Float64Array(RAYS).fill(2),
    c = new Float64Array(RAYS).fill(0.5);
  const expanded = runOp("v_mul", [runOp("v_add", [a, b], 0, []), c], 0, []);
  assert.deepEqual(runOp("m", [a, b, c], 0, [macro]), expanded);
  const p: Program = {
    id: "test",
    origin: "unit test only",
    macros: [macro],
    genes: [
      { op: "m", type: "vector", refs: [0, 1, 4], value: 0 },
      { op: "argmax", type: "angle", refs: [INPUTS], value: 0 },
    ],
    steering: INPUTS + 1,
    acceleration: 11,
  };
  assert.equal(validate(p), true);
  assert.deepEqual(activeGenes(p), [0, 1]);
  assert.equal(validate({ ...p, steering: 11 }), false);
  assert.equal(
    validate({
      ...p,
      genes: [{ ...p.genes[0], refs: [INPUTS, 1, 4] }, p.genes[1]],
    }),
    false,
  );
  const controls = compile(p)({
    vectors: [a, b, a, a, c],
    scalars: [0, 0, 0, 0, 1, 0, 1, 0.5, -1],
  });
  assert.equal(controls.acceleration, 1);
  assert.equal(controls.steering, 1);
});

test("neural graph prior conditions on structure, respects masks and learns from reward", () => {
  const rng = new Random(4),
    p = new GraphPrior(rng);
  const a = p.context([], "angle", 4),
    b = p.context(
      [{ op: "v_mul", type: "vector", refs: [0, 1], value: 0 }],
      "angle",
      4,
    );
  assert.notDeepEqual(a, b);
  const before = p.forward(a, [7, 8, 9]).probs;
  const batch = Array.from({ length: 25 }, () => {
    const d = p.sample(rng, a, [7, 8, 9]);
    assert.ok([7, 8, 9].includes(d.choice));
    return { decisions: [d], reward: d.choice === 7 ? 100 : 0 };
  });
  p.update(batch);
  const after = p.forward(a, [7, 8, 9]).probs;
  assert.ok(after[0] > before[0]);
  assert.ok(Math.abs(after.reduce((n, x) => n + x, 0) - 1) < 1e-10);
});

test("typed evolution is reproducible, bounded, elitist, and counts all main rollouts", () => {
  const config = {
    ...CONFIG,
    population: 16,
    generations: 7,
    worlds: 3,
    nodes: 10,
    evolveDSL: false,
  };
  const a = new OffroadSearch(config),
    b = new OffroadSearch(config);
  for (let i = 0; i < config.generations; i++) {
    const x = a.step(),
      y = b.step();
    assert.deepEqual(x.best, y.best);
    assert.deepEqual(x.history, y.history);
    assert.ok(a.population.every((c) => validate(c.program)));
    if (i) assert.ok(x.history[i].best >= x.history[i - 1].best);
  }
  assert.equal(a.rollouts, (16 + 6 * 13) * 3);
  assert.equal(a.discoveryRollouts, 0);
  assert.throws(() => new OffroadSearch({ ...config, seed: -1 }));
});

test("reference metrics come from real rollouts and obstacle inputs affect the controller", () => {
  const s: Snapshot = JSON.parse(
    readFileSync("public/offroad-reference.json", "utf8"),
  );
  const terrains = trainingTerrains(s.config.seed, s.config.worlds),
    actual = evaluate(s.best.program, terrains);
  assert.equal(actual.fitness, s.best.fitness);
  assert.ok(actual.success > s.initial.success);
  assert.ok(
    activeGenes(s.best.program).some((i) =>
      s.best.program.genes[i].refs.includes(1),
    ),
  );
  const policy = compile(s.best.program),
    observation = observe(initialState(flat()), flat()),
    clear = policy(observation);
  observation.vectors[1].fill(0.02, 6, 13);
  const blocked = policy(observation);
  assert.notDeepEqual(clear, blocked);
  const episode = simulate(s.best.program, terrains[0], true);
  let live = initialState(terrains[0]);
  for (const frame of episode.frames!.slice(1)) {
    const scans = observe(live, terrains[0]);
    live = step(live, policy(scans), terrains[0]);
    live.scans = scans;
    assert.deepEqual(live, frame);
  }
});
