import { compileDriveProgram, activeDriveGenes } from "./program";
import { clamp, makeDrivingWorld, pointAt, projectOnRoad, wrap } from "./world";
import type {
  DriveCandidate,
  DriveControls,
  DriveEpisode,
  DriveEvaluation,
  DriveProgram,
  DriveState,
  DrivingWorld,
  RoadKind,
} from "./types";

export const DT = 0.1,
  WHEELBASE = 2.7,
  MAX_STEER = 0.55,
  MAX_SPEED = 23;
export const RAY_ANGLES = [-0.25, 0, 0.25, -0.6, 0.6];

export function initialDriveState(world: DrivingWorld): DriveState {
  const p = pointAt(world, 3);
  return {
    x: p.x + Math.cos(p.heading) * world.startOffset,
    z: p.z - Math.sin(p.heading) * world.startOffset,
    heading: p.heading + world.startHeading,
    speed: 0,
    steer: 0,
    time: 0,
    progress: 3,
    nearest: 1,
    lateral: world.startOffset,
    status: "driving",
    controls: { steering: 0, throttle: 0, brake: 0 },
    sensors: [],
    distance: 0,
  };
}
export function obstacleRanges(
  state: DriveState,
  world: DrivingWorld,
): number[] {
  return RAY_ANGLES.map((angle) => {
    const heading = state.heading + angle,
      dx = Math.sin(heading),
      dz = Math.cos(heading);
    const ox = state.x + Math.sin(state.heading) * 2,
      oz = state.z + Math.cos(state.heading) * 2;
    let range = 35;
    for (const o of world.obstacles) {
      const x = o.x - ox,
        z = o.z - oz,
        dot = x * dx + z * dz;
      const r = o.radius + 0.45,
        cross2 = x * x + z * z - dot * dot;
      if (dot > 0 && cross2 < r * r)
        range = Math.min(range, Math.max(0, dot - Math.sqrt(r * r - cross2)));
    }
    return range / 35;
  });
}
export function observeDrive(state: DriveState, world: DrivingWorld): number[] {
  const road = projectOnRoad(world, state.x, state.z, state.nearest);
  const lookahead = pointAt(
    world,
    road.progress + 7 + state.speed * 0.5,
    road.index,
  );
  const range = obstacleRanges(state, world);
  return [
    clamp(wrap(road.heading - state.heading) / 0.6, -3, 3),
    clamp(
      wrap(
        Math.atan2(lookahead.x - state.x, lookahead.z - state.z) -
          state.heading,
      ) / 0.6,
      -3,
      3,
    ),
    clamp(road.lateral / (world.width / 2), -3, 3),
    state.speed / 18,
    (world.speedLimit - state.speed) / world.speedLimit,
    ...range,
    state.steer / MAX_STEER,
  ];
}
export function vehicleHitsObstacle(
  state: DriveState,
  world: DrivingWorld,
): boolean {
  const sin = Math.sin(state.heading),
    cos = Math.cos(state.heading);
  return world.obstacles.some((o) => {
    const dx = o.x - state.x,
      dz = o.z - state.z;
    const lateral = Math.abs(dx * cos - dz * sin),
      longitudinal = Math.abs(dx * sin + dz * cos);
    return (
      Math.max(0, lateral - 0.9) ** 2 + Math.max(0, longitudinal - 2.1) ** 2 <
      o.radius ** 2
    );
  });
}
export function stepDrive(
  state: DriveState,
  controls: DriveControls,
  world: DrivingWorld,
  dt = DT,
): DriveState {
  if (state.status !== "driving") return state;
  const c = {
    steering: clamp(controls.steering, -1, 1),
    throttle: clamp(controls.throttle, 0, 1),
    brake: clamp(controls.brake, 0, 1),
  };
  const next = { ...state, controls: c };
  const parts = Math.max(2, Math.ceil((state.speed * dt) / 0.45));
  const h = dt / parts;
  for (let i = 0; i < parts; i++) {
    next.steer += clamp(c.steering * MAX_STEER - next.steer, -1.1 * h, 1.1 * h);
    const acceleration =
      c.throttle * 4.3 -
      c.brake * 8 -
      0.055 * next.speed -
      0.005 * next.speed ** 2;
    next.speed = clamp(next.speed + acceleration * h, 0, MAX_SPEED);
    const kinematicYaw = (next.speed / WHEELBASE) * Math.tan(next.steer);
    const gripYaw = (world.grip * 9.81) / Math.max(1, next.speed);
    next.heading = wrap(
      next.heading + clamp(kinematicYaw, -gripYaw, gripYaw) * h,
    );
    next.x += Math.sin(next.heading) * next.speed * h;
    next.z += Math.cos(next.heading) * next.speed * h;
    next.distance += next.speed * h;
    const road = projectOnRoad(world, next.x, next.z, next.nearest);
    next.nearest = road.index;
    next.progress = road.progress;
    next.lateral = road.lateral;
    const relative = wrap(next.heading - road.heading);
    const halfExtent =
      0.9 * Math.abs(Math.cos(relative)) + 2.1 * Math.abs(Math.sin(relative));
    if (vehicleHitsObstacle(next, world)) {
      next.status = "collision";
      break;
    }
    if (Math.abs(road.lateral) + halfExtent > world.width / 2) {
      next.status = "offroad";
      break;
    }
    if (next.progress >= world.length - 4) {
      next.status = "finished";
      break;
    }
  }
  next.time += dt;
  if (next.time >= 55 && next.status === "driving") next.status = "timeout";
  return next;
}
export function simulateDrive(
  program: DriveProgram,
  world: DrivingWorld,
  record = false,
): DriveEpisode {
  const policy = compileDriveProgram(program);
  let state = initialDriveState(world),
    steps = 0,
    center = 0,
    speed = 0,
    steeringChange = 0,
    lastSteer = 0;
  const frames: DriveState[] = [];
  if (record) {
    state.sensors = observeDrive(state, world);
    frames.push(state);
  }
  while (state.status === "driving" && steps < 551) {
    const sensors = observeDrive(state, world),
      controls = policy(sensors);
    state = stepDrive(state, controls, world);
    state.sensors = sensors;
    center += Math.min(1, Math.abs(state.lateral) / (world.width / 2));
    speed += state.speed;
    steeringChange += Math.abs(controls.steering - lastSteer);
    lastSteer = controls.steering;
    steps++;
    if (record) frames.push(state);
  }
  const completion = clamp((state.progress - 3) / (world.length - 7), 0, 1),
    success = state.status === "finished";
  const reward =
    completion * 65 +
    (success
      ? 20 + 10 * Math.min(1, world.length / (Math.max(0.1, state.time) * 14))
      : -5) +
    5 * (1 - center / Math.max(1, steps)) -
    Math.min(4, (steeringChange / Math.max(1, steps)) * 4);
  return {
    completion,
    success,
    reward,
    steps,
    end: state,
    meanSpeed: speed / Math.max(1, steps),
    ...(record ? { frames } : {}),
  };
}
export function evaluateDrive(
  program: DriveProgram,
  worlds: DrivingWorld[],
): DriveCandidate {
  const episodes = worlds.map((w) => simulateDrive(program, w));
  const nodes = activeDriveGenes(program).length;
  return {
    program,
    fitness:
      episodes.reduce((s, e) => s + e.reward, 0) / episodes.length -
      nodes * 0.08,
    success: episodes.filter((e) => e.success).length / episodes.length,
    completion:
      episodes.reduce((s, e) => s + e.completion, 0) / episodes.length,
    meanSpeed: episodes.reduce((s, e) => s + e.meanSpeed, 0) / episodes.length,
    nodes,
    collisions: episodes.filter((e) => e.end.status === "collision").length,
    departures: episodes.filter((e) => e.end.status === "offroad").length,
  };
}
export function evaluateDrivingTransfer(
  program: DriveProgram,
  count = 8,
): DriveEvaluation[] {
  return (["coastal", "switchbacks", "obstacles"] as RoadKind[]).map(
    (kind, k) => {
      const seeds = Array.from(
        { length: count },
        (_, i) => 1_700_000_000 + k * 10000 + i * 97,
      );
      const c = evaluateDrive(
        program,
        seeds.map((seed) => makeDrivingWorld(seed, kind)),
      );
      return {
        kind,
        success: c.success,
        completion: c.completion,
        meanSpeed: c.meanSpeed,
        collisions: c.collisions,
        departures: c.departures,
        count,
        seeds,
      };
    },
  );
}
