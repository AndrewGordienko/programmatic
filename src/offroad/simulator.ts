import { compile, activeGenes, expandedSize } from "./program";
import {
  clamp,
  gripAt,
  groundPose,
  heightAt,
  testTerrains,
  wrap,
} from "./terrain";
import {
  ANGLES,
  RAYS,
  SCAN_RANGE,
  type Candidate,
  type Controls,
  type Episode,
  type Evaluation,
  type Observation,
  type Program,
  type Terrain,
  type Truck,
} from "./types";
export const DT = 0.2,
  MAX_STEER = 0.58;
export const SIMULATOR_VERSION = "offroad-support-v2";
export const maximumDriveAcceleration = (grip: number) =>
  Math.min(3.3, grip * 9.81);
export const uphillGravityAcceleration = (pitch: number) =>
  9.81 * Math.sin(pitch);
// Generic model dimensions, not calibrated specifications of a real vehicle.
export const SUPPORT = {
  halfTrack: 1,
  halfWheelbase: 1.65,
  centerHeight: 1,
  persistence: 0.4,
};
// Project gravity + outward turning inertia onto an orthonormal terrain frame.
// The resultant intersects the support plane H * tangential / normal from the
// center. A ratio >1 means that intersection is beyond the wheel footprint.
// This is a quasi-static support test, not simulated wheel lift/body dynamics.
export function supportLoad(
  pitch: number,
  roll: number,
  lateralAcceleration: number,
) {
  const a = Math.tan(roll),
    b = Math.tan(pitch),
    norm = Math.hypot(a, 1, b);
  const nx = -a / norm,
    ny = 1 / norm,
    nz = -b / norm;
  const rx = Math.cos(roll),
    ry = Math.sin(roll);
  const fx = ry * nz,
    fy = -rx * nz; // right × normal = forward
  const down = Math.max(1e-6, lateralAcceleration * nx + 9.81 * ny);
  return {
    lateral:
      (SUPPORT.centerHeight * Math.abs(-lateralAcceleration * rx - 9.81 * ry)) /
      (down * SUPPORT.halfTrack),
    longitudinal:
      (SUPPORT.centerHeight * Math.abs(-lateralAcceleration * fx - 9.81 * fy)) /
      (down * SUPPORT.halfWheelbase),
  };
}
export function initialState(t: Terrain): Truck {
  const { x, z, heading } = t.start;
  const pose = groundPose(t, x, z, heading);
  return {
    x,
    z,
    heading,
    ...pose,
    speed: 0,
    steer: 0,
    grip: gripAt(t, x, z),
    slip: 0,
    time: 0,
    distance: 0,
    status: "driving",
    controls: { steering: 0, acceleration: 0 },
    stability: {
      ...supportLoad(pose.pitch, pose.roll, 0),
      unsupportedSeconds: 0,
    },
  };
}
export function observe(s: Truck, t: Terrain): Observation {
  const vectors = Array.from({ length: 5 }, () => new Float64Array(RAYS));
  const goal = Math.atan2(t.goal.x - s.x, t.goal.z - s.z),
    baseHeight = heightAt(t, s.x, s.z);
  for (let i = 0; i < RAYS; i++) {
    const heading = s.heading + ANGLES[i],
      dx = Math.sin(heading),
      dz = Math.cos(heading);
    let range = SCAN_RANGE;
    for (const rock of t.rocks) {
      const x = rock.x - s.x,
        z = rock.z - s.z,
        dot = x * dx + z * dz,
        r = rock.radius + 1.6,
        cross2 = x * x + z * z - dot * dot;
      if (dot > 0 && cross2 < r * r)
        range = Math.min(range, Math.max(0, dot - Math.sqrt(r * r - cross2)));
    }
    let previous = baseHeight,
      slope = 0,
      roughness = 0,
      lastGrade = 0,
      grip = 1;
    for (let j = 1; j <= 4; j++) {
      const distance = j * 4,
        x = s.x + dx * distance,
        z = s.z + dz * distance,
        y = heightAt(t, x, z),
        grade = (y - previous) / 4;
      slope = Math.max(slope, Math.abs(grade));
      roughness = Math.max(roughness, Math.abs(grade - lastGrade));
      grip = Math.min(grip, gripAt(t, x, z));
      previous = y;
      lastGrade = grade;
      if (Math.abs(x) > t.size / 2 - 2 || Math.abs(z) > t.size / 2 - 2)
        range = Math.min(range, distance);
    }
    vectors[0][i] = Math.cos(wrap(heading - goal));
    vectors[1][i] = range / SCAN_RANGE;
    vectors[2][i] = clamp(slope / 0.7, 0, 2);
    vectors[3][i] = clamp(roughness / 0.5, 0, 2);
    vectors[4][i] = grip;
  }
  return {
    vectors,
    scalars: [
      s.speed / 8,
      s.pitch / 0.6,
      s.roll / 0.6,
      s.steer / MAX_STEER,
      Math.min(
        2,
        Math.hypot(t.goal.x - s.x, t.goal.z - s.z) / t.initialDistance,
      ),
      0,
      1,
      0.5,
      -1,
    ],
  };
}
export function step(s: Truck, c: Controls, t: Terrain, dt = DT): Truck {
  if (s.status !== "driving") return s;
  const controls = {
      steering: clamp(c.steering, -1, 1),
      acceleration: clamp(c.acceleration, -1, 1),
    },
    n = { ...s, controls };
  const parts = Math.max(4, Math.ceil((s.speed * dt) / 0.35)),
    h = dt / parts;
  for (let i = 0; i < parts; i++) {
    const ground = groundPose(t, n.x, n.z, n.heading);
    Object.assign(n, ground);
    n.grip = gripAt(t, n.x, n.z);
    n.steer += clamp(
      controls.steering * MAX_STEER - n.steer,
      -0.85 * h,
      0.85 * h,
    );
    const force =
      controls.acceleration >= 0
        ? controls.acceleration * maximumDriveAcceleration(n.grip)
        : controls.acceleration * 7;
    n.speed = clamp(
      n.speed +
        (force -
          uphillGravityAcceleration(n.pitch) -
          0.12 * n.speed -
          0.018 * n.speed * n.speed) *
          h,
      0,
      9,
    );
    const demand = (n.speed / 3.3) * Math.tan(n.steer),
      limit = (n.grip * 9.81) / Math.max(1, n.speed),
      yaw = clamp(demand, -limit, limit);
    n.slip = Math.abs(demand - yaw);
    n.heading = wrap(n.heading + yaw * h);
    n.x += Math.sin(n.heading) * n.speed * h;
    n.z += Math.cos(n.heading) * n.speed * h;
    n.distance += n.speed * h;
    Object.assign(n, groundPose(t, n.x, n.z, n.heading));
    const load = supportLoad(n.pitch, n.roll, n.speed * yaw);
    n.stability = {
      ...load,
      unsupportedSeconds:
        Math.max(load.lateral, load.longitudinal) > 1
          ? (n.stability?.unsupportedSeconds ?? 0) + h
          : 0,
    };
    // Rectangular footprint against each rock; no obstacle avoidance mask.
    const sin = Math.sin(n.heading),
      cos = Math.cos(n.heading);
    if (
      t.rocks.some((r) => {
        const x = r.x - n.x,
          z = r.z - n.z;
        return (
          Math.max(0, Math.abs(x * cos - z * sin) - 1.02) ** 2 +
            Math.max(0, Math.abs(x * sin + z * cos) - 2.45) ** 2 <
          r.radius * r.radius
        );
      })
    )
      n.status = "collision";
    else if (n.stability.unsupportedSeconds >= SUPPORT.persistence - 1e-9)
      n.status = "rollover";
    else if (n.clearance < 0.09) n.status = "grounded";
    else if (Math.abs(n.x) > t.size / 2 - 2 || Math.abs(n.z) > t.size / 2 - 2)
      n.status = "boundary";
    else if (Math.hypot(t.goal.x - n.x, t.goal.z - n.z) < 4)
      n.status = "arrived";
    if (n.status !== "driving") break;
  }
  n.time += dt;
  if (n.time >= 42 && n.status === "driving") n.status = "timeout";
  return n;
}
export function simulate(p: Program, t: Terrain, record = false): Episode {
  const policy = compile(p);
  let s = initialState(t),
    steps = 0,
    jerk = 0,
    previous = 0;
  const frames: Truck[] = [];
  if (record) frames.push(s);
  while (s.status === "driving" && steps < 211) {
    const scans = observe(s, t),
      c = policy(scans);
    s = step(s, c, t);
    if (record) s.scans = scans;
    jerk += Math.abs(c.steering - previous);
    previous = c.steering;
    steps++;
    if (record) frames.push(s);
  }
  const completion = clamp(
      1 -
        (Math.hypot(t.goal.x - s.x, t.goal.z - s.z) - 4) /
          (t.initialDistance - 4),
      0,
      1,
    ),
    success = s.status === "arrived";
  const failureCost =
    s.status === "collision"
      ? 28
      : s.status === "rollover" || s.status === "grounded"
        ? 32
        : s.status === "boundary"
          ? 25
          : 12;
  const fitness =
    (success
      ? 80 +
        12 * Math.min(1, t.initialDistance / (Math.max(1, s.time) * 6)) +
        8 * Math.min(1, t.initialDistance / Math.max(1, s.distance))
      : completion * 60 - failureCost) -
    Math.min(3, (jerk / Math.max(1, steps)) * 2);
  return {
    fitness,
    completion,
    success,
    end: s,
    steps,
    ...(record ? { frames } : {}),
  };
}
export function evaluate(p: Program, terrains: Terrain[]): Candidate {
  const episodes = terrains.map((t) => simulate(p, t));
  return {
    program: p,
    fitness:
      episodes.reduce((n, e) => n + e.fitness, 0) / episodes.length -
      activeGenes(p).length * 0.035,
    success: episodes.filter((e) => e.success).length / episodes.length,
    completion:
      episodes.reduce((n, e) => n + e.completion, 0) / episodes.length,
    collisions: episodes.filter((e) => e.end.status === "collision").length,
    instabilities: episodes.filter((e) =>
      ["rollover", "grounded", "boundary"].includes(e.end.status),
    ).length,
    timeouts: episodes.filter((e) => e.end.status === "timeout").length,
    nodes: activeGenes(p).length,
    expandedNodes: expandedSize(p),
    scores: episodes.map((e) => e.fitness),
  };
}
export function transfer(p: Program, count = 12): Evaluation[] {
  return (["woodland", "quarry", "ridge"] as const).map((kind) => {
    const terrains = testTerrains(kind, count),
      c = evaluate(p, terrains);
    return {
      kind,
      count,
      success: c.success,
      collisions: c.collisions,
      instabilities: c.instabilities,
      timeouts: c.timeouts,
      completion: c.completion,
      seeds: terrains.map((t) => t.seed),
    };
  });
}
