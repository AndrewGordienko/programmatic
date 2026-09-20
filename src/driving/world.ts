import { Random } from "../engine/random";
import type { DrivingWorld, RoadKind, RoadPoint } from "./types";

export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
export const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

export function makeDrivingWorld(
  seed: number,
  kind: RoadKind = "coastal",
): DrivingWorld {
  const rng = new Random(seed);
  const a = (kind === "switchbacks" ? 19 : 10) + rng.next() * 9;
  const wave = (kind === "switchbacks" ? 25 : 38) + rng.next() * 12;
  const phase = rng.next() * Math.PI * 2,
    second = rng.next() * Math.PI * 2;
  const roadX = (z: number) =>
    a * Math.sin(z / wave + phase) +
    a * 0.28 * Math.sin(z / (wave * 0.48) + second);
  const startX = roadX(0);
  const points: RoadPoint[] = [];
  let s = 0;
  for (let z = 0; z <= 260; z += 2) {
    const x = roadX(z) - startX;
    if (points.length) s += Math.hypot(x - points.at(-1)!.x, 2);
    points.push({
      x,
      z,
      s,
      heading: Math.atan2(roadX(z + 0.1) - roadX(z - 0.1), 0.2),
    });
  }
  const world: DrivingWorld = {
    seed,
    kind,
    points,
    width: kind === "switchbacks" ? 8 : 9,
    length: s,
    grip: kind === "switchbacks" ? 0.65 : 0.85 + rng.next() * 0.15,
    obstacles: [],
    startOffset: (rng.next() - 0.5) * 1.3,
    startHeading: (rng.next() - 0.5) * 0.12,
    speedLimit: 14,
  };
  if (kind === "obstacles") {
    for (let i = 0; i < 3; i++) {
      const p = points[28 + i * 31 + rng.int(8)];
      const offset = (i % 2 ? -1 : 1) * (1.4 + rng.next() * 0.6);
      world.obstacles.push({
        x: p.x + Math.cos(p.heading) * offset,
        z: p.z - Math.sin(p.heading) * offset,
        radius: 0.65 + rng.next() * 0.2,
        kind: "barrier",
        s: p.s,
      });
    }
  }
  return world;
}

export function projectOnRoad(
  world: DrivingWorld,
  x: number,
  z: number,
  hint = 0,
) {
  const points = world.points;
  let best = Infinity,
    bestIndex = hint,
    fraction = 0,
    px = 0,
    pz = 0;
  const center = clamp(hint, 0, points.length - 2);
  for (
    let i = Math.max(0, center - 5);
    i < Math.min(points.length - 1, center + 8);
    i++
  ) {
    const a = points[i],
      b = points[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = clamp(
      ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz),
      0,
      1,
    );
    const qx = a.x + t * dx,
      qz = a.z + t * dz,
      d = (x - qx) ** 2 + (z - qz) ** 2;
    if (d < best) {
      best = d;
      bestIndex = i;
      fraction = t;
      px = qx;
      pz = qz;
    }
  }
  const a = points[bestIndex],
    b = points[bestIndex + 1];
  const heading = Math.atan2(b.x - a.x, b.z - a.z);
  return {
    index: bestIndex,
    x: px,
    z: pz,
    heading,
    lateral: (x - px) * Math.cos(heading) - (z - pz) * Math.sin(heading),
    progress: a.s + fraction * (b.s - a.s),
  };
}

export function pointAt(
  world: DrivingWorld,
  distance: number,
  hint = 0,
): RoadPoint {
  const points = world.points;
  let i = Math.max(0, Math.min(points.length - 2, hint));
  while (i < points.length - 2 && points[i + 1].s < distance) i++;
  while (i > 0 && points[i].s > distance) i--;
  const a = points[i],
    b = points[i + 1],
    t = clamp((distance - a.s) / (b.s - a.s), 0, 1);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    s: a.s + (b.s - a.s) * t,
    heading: a.heading + wrap(b.heading - a.heading) * t,
  };
}
