import { Random } from "../engine/random";
import type { Terrain, TerrainKind } from "./types";
export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
export const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
export function makeTerrain(
  seed: number,
  kind: TerrainKind = "woodland",
): Terrain {
  const rng = new Random(seed),
    size = 100,
    resolution = 101;
  const start = {
    x: (rng.next() - 0.5) * 18,
    z: -40,
    heading: (rng.next() - 0.5) * 0.16,
  };
  const goal = { x: (rng.next() - 0.5) * 30, z: 40 };
  const hills = Array.from({ length: kind === "ridge" ? 12 : 9 }, () => ({
    x: (rng.next() - 0.5) * 100,
    z: (rng.next() - 0.5) * 100,
    height: (rng.next() - 0.27) * (kind === "ridge" ? 13 : 7),
    radius: 7 + rng.next() * 16,
  }));
  const patches = Array.from({ length: 7 }, (_, i) => ({
    x: (rng.next() - 0.5) * 80,
    z: (rng.next() - 0.5) * 75,
    radius: 5 + rng.next() * 10,
    grip: i % 3 === 0 ? 0.3 : 0.65,
    surface: i % 3 === 0 ? ("mud" as const) : ("gravel" as const),
  }));
  const rocks = [];
  // Force at least one obstacle on the direct start-to-goal line. Its side is
  // not prescribed: the program must select a traversable direction itself.
  for (let i = 0; i < (kind === "quarry" ? 17 : 12); i++) {
    const t = 0.23 + rng.next() * 0.55;
    const x =
      i < 2
        ? start.x + (goal.x - start.x) * t + (rng.next() - 0.5) * 1.5
        : (rng.next() - 0.5) * 76;
    const z =
      i < 2 ? start.z + (goal.z - start.z) * t : (rng.next() - 0.5) * 68;
    rocks.push({
      x,
      z,
      radius: (kind === "quarry" ? 1.2 : 0.8) + rng.next() * 1.6,
      height: 1.1 + rng.next() * 2.4,
    });
  }
  const heights: number[] = [],
    grips: number[] = [];
  const phase = rng.next() * 6.28;
  for (let iz = 0; iz < resolution; iz++)
    for (let ix = 0; ix < resolution; ix++) {
      const x = ix - size / 2,
        z = iz - size / 2;
      let y = 0.24 * Math.sin(x * 0.32 + phase) * Math.sin(z * 0.27 - phase);
      for (const h of hills)
        y +=
          h.height *
          Math.exp(
            -((x - h.x) ** 2 + (z - h.z) ** 2) / (2 * h.radius * h.radius),
          );
      heights.push(y);
      let grip = kind === "quarry" ? 0.67 : 0.88;
      for (const p of patches)
        if (Math.hypot(x - p.x, z - p.z) < p.radius)
          grip = Math.min(grip, p.grip);
      grips.push(grip);
    }
  return {
    seed,
    kind,
    size,
    resolution,
    heights,
    grips,
    hills,
    rocks,
    patches,
    start,
    goal,
    initialDistance: Math.hypot(goal.x - start.x, goal.z - start.z),
  };
}
function sample(t: Terrain, field: number[], x: number, z: number) {
  const u = clamp(
      (x / t.size + 0.5) * (t.resolution - 1),
      0,
      t.resolution - 1.00001,
    ),
    v = clamp(
      (z / t.size + 0.5) * (t.resolution - 1),
      0,
      t.resolution - 1.00001,
    );
  const ix = Math.floor(u),
    iz = Math.floor(v),
    a = u - ix,
    b = v - iz,
    k = iz * t.resolution + ix;
  return (
    (field[k] * (1 - a) + field[k + 1] * a) * (1 - b) +
    (field[k + t.resolution] * (1 - a) + field[k + t.resolution + 1] * a) * b
  );
}
export const heightAt = (t: Terrain, x: number, z: number) =>
  sample(t, t.heights, x, z);
export const gripAt = (t: Terrain, x: number, z: number) =>
  sample(t, t.grips, x, z);
export function groundPose(t: Terrain, x: number, z: number, heading: number) {
  const dx = Math.sin(heading),
    dz = Math.cos(heading),
    nx = dz,
    nz = -dx;
  const fl = heightAt(t, x + dx * 1.65 - nx, z + dz * 1.65 - nz),
    fr = heightAt(t, x + dx * 1.65 + nx, z + dz * 1.65 + nz);
  const rl = heightAt(t, x - dx * 1.65 - nx, z - dz * 1.65 - nz),
    rr = heightAt(t, x - dx * 1.65 + nx, z - dz * 1.65 + nz);
  const front = (fl + fr) / 2,
    rear = (rl + rr) / 2,
    left = (fl + rl) / 2,
    right = (fr + rr) / 2;
  const average = (fl + fr + rl + rr) / 4;
  return {
    y: average,
    pitch: Math.atan2(front - rear, 3.3),
    roll: Math.atan2(right - left, 2),
    clearance: 0.48 - (heightAt(t, x, z) - average),
  };
}
export function trainingTerrains(seed: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeTerrain(
      seed * 1000 + i * 113,
      (["woodland", "quarry", "ridge"] as const)[i % 3],
    ),
  );
}
export function testTerrains(kind: TerrainKind, count = 12) {
  const k = ["woodland", "quarry", "ridge"].indexOf(kind);
  return Array.from({ length: count }, (_, i) =>
    makeTerrain(1_900_000_000 + k * 100000 + i * 97, kind),
  );
}
