import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activeDriveGenes,
  compileDriveProgram,
  macroValue,
  validateDriveProgram,
} from "./program";
import { DrivingSearch } from "./search";
import { interpolateDrivePose } from "./render";
import {
  evaluateDrive,
  initialDriveState,
  observeDrive,
  simulateDrive,
  stepDrive,
  vehicleHitsObstacle,
} from "./simulator";
import {
  DRIVE_CONFIG,
  INPUT_COUNT,
  type DriveProgram,
  type DriveSnapshot,
  type DrivingWorld,
} from "./types";
import { makeDrivingWorld } from "./world";

const straightWorld: DrivingWorld = {
  seed: 0,
  kind: "coastal",
  width: 9,
  length: 300,
  grip: 1,
  obstacles: [],
  startOffset: 0,
  startHeading: 0,
  speedLimit: 14,
  points: Array.from({ length: 151 }, (_, i) => ({
    x: 0,
    z: i * 2,
    s: i * 2,
    heading: 0,
  })),
};
const straight: DriveProgram = {
  id: "straight",
  origin: "random",
  macros: [],
  steering: 14,
  acceleration: 17,
  genes: [{ op: "copy", a: 0, b: 0, value: 0 }],
};

test("render interpolation is continuous across physics ticks and heading wrap", () => {
  const a = initialDriveState(straightWorld);
  const b = { ...a, x: 2, z: 5, heading: -Math.PI + 0.1 };
  const before = { ...a, heading: Math.PI - 0.1 };
  const middle = interpolateDrivePose(before, b, 0.5);
  assert.equal(middle.x, 1);
  assert.equal(middle.z, 4);
  assert.ok(Math.abs(Math.abs(middle.heading) - Math.PI) < 1e-10);
  const c = { ...b, x: 4, z: 7 };
  assert.deepEqual(
    interpolateDrivePose(before, b, 1),
    interpolateDrivePose(b, c, 0),
  );
  assert.equal(a.x, 0);
});

test("program output directly changes vehicle motion; there is no route-following override", () => {
  const world = makeDrivingWorld(42000, "coastal");
  assert.deepEqual(world, makeDrivingWorld(42000, "coastal"));
  assert.equal(simulateDrive(straight, world).end.status, "offroad");
  const stopped = simulateDrive(
    { ...straight, acceleration: 12 },
    straightWorld,
  );
  assert.equal(stopped.end.status, "timeout");
  assert.equal(stopped.end.distance, 0);
  let left = { ...initialDriveState(straightWorld), speed: 10 };
  let right = structuredClone(left);
  for (let i = 0; i < 5; i++) {
    left = stepDrive(
      left,
      { steering: -0.5, throttle: 0, brake: 0 },
      straightWorld,
    );
    right = stepDrive(
      right,
      { steering: 0.5, throttle: 0, brake: 0 },
      straightWorld,
    );
  }
  assert.ok(left.x < 0 && right.x > 0);
  const braking = stepDrive(
    right,
    { steering: 0, throttle: 0, brake: 1 },
    straightWorld,
  );
  assert.ok(braking.speed < right.speed);
});

test("vehicle footprint and substeps catch collisions; sensors detect actual obstacles", () => {
  const world = structuredClone(straightWorld);
  const state = { ...initialDriveState(world), speed: 23 };
  world.obstacles.push({ x: 0, z: 6.5, s: 6.5, radius: 0.3, kind: "cone" });
  assert.equal(vehicleHitsObstacle(state, world), false);
  assert.ok(observeDrive(state, world)[6] < 0.1);
  const hit = stepDrive(state, { steering: 0, throttle: 1, brake: 0 }, world);
  assert.equal(hit.status, "collision");
  assert.ok(hit.z < 6.5);
  const corner = {
    ...world,
    obstacles: [{ x: 1, z: 5, s: 5, radius: 0.3, kind: "cone" as const }],
  };
  assert.equal(vehicleHitsObstacle(state, corner), true);
  const departed = stepDrive(
    { ...state, x: 4.2 },
    { steering: 0, throttle: 0, brake: 0 },
    straightWorld,
  );
  assert.equal(departed.status, "offroad");
});

test("seeded driving search is reproducible, elitist, valid, and accounts for vehicle rollouts", () => {
  const config = {
    ...DRIVE_CONFIG,
    population: 16,
    generations: 5,
    worlds: 2,
    maxNodes: 8,
    evolveDSL: false,
  };
  const first = new DrivingSearch(config),
    second = new DrivingSearch(config);
  for (let i = 0; i < config.generations; i++) {
    const a = first.step(),
      b = second.step();
    assert.deepEqual(a.best, b.best);
    assert.deepEqual(a.history, b.history);
    assert.ok(a.leaders.every((c) => validateDriveProgram(c.program)));
    if (i) assert.ok(a.history[i].best >= a.history[i - 1].best);
  }
  assert.equal(first.evaluations, (16 + 4 * 13) * 2);
  assert.throws(() => new DrivingSearch({ ...config, seed: -1 }));
});

test("shipped learned driver improves on generation one and live stepping matches evaluation", () => {
  const reference: DriveSnapshot = JSON.parse(
    readFileSync("public/driving-reference.json", "utf8"),
  );
  const worlds = new DrivingSearch(reference.config).worlds;
  const final = evaluateDrive(reference.best.program, worlds);
  const initial = evaluateDrive(reference.initial.program, worlds);
  assert.equal(final.fitness, reference.best.fitness);
  assert.ok(final.fitness > initial.fitness + 10);
  assert.ok(final.success > initial.success);
  const episode = simulateDrive(reference.best.program, worlds[0], true);
  const policy = compileDriveProgram(reference.best.program);
  let live = initialDriveState(worlds[0]);
  for (const frame of episode.frames!.slice(1)) {
    const sensors = observeDrive(live, worlds[0]);
    live = stepDrive(live, policy(sensors), worlds[0]);
    live.sensors = sensors;
    assert.deepEqual(live, frame);
  }
  assert.equal(live.status, "finished");
});

test("DSL abstractions execute their bounded composition and reject cyclic graphs", () => {
  const macro = {
    name: "m",
    inner: "add",
    outer: "negate",
    side: "left",
    definition: "m(a,b) = negate(add(a,b))",
  } as const;
  assert.equal(macroValue(macro, 18, 18), -20);
  const program: DriveProgram = {
    ...straight,
    steering: INPUT_COUNT,
    macros: [macro],
    genes: [{ op: "m", a: 0, b: 1, value: 0 }],
  };
  assert.equal(validateDriveProgram(program), true);
  assert.deepEqual(activeDriveGenes(program), [0]);
  const controls = compileDriveProgram(program)([
    0.1, 0.2, 0, 0, 0, 1, 1, 1, 1, 1, 0,
  ]);
  assert.ok(Math.abs(controls.steering + 0.3) < 1e-10);
  assert.equal(
    validateDriveProgram({
      ...program,
      genes: [{ op: "add", a: INPUT_COUNT, b: 0, value: 0 }],
    }),
    false,
  );
});
