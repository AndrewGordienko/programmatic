import { Random } from "./random";
import type { Family, Point, World } from "./types";

export const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
export const ACTIONS = ["east", "south", "west", "north"];
export const key = (p: Point, size: number) => p.y * size + p.x;
export const distance = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function shortestPath(
  size: number,
  walls: Set<number>,
  start: Point,
  goal: Point,
): number {
  const queue = [{ ...start, depth: 0 }];
  const seen = new Set([key(start, size)]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.x === goal.x && p.y === goal.y) return p.depth;
    for (const d of DIRECTIONS) {
      const next = { x: p.x + d.x, y: p.y + d.y };
      const k = key(next, size);
      if (
        next.x >= 0 &&
        next.x < size &&
        next.y >= 0 &&
        next.y < size &&
        !walls.has(k) &&
        !seen.has(k)
      ) {
        seen.add(k);
        queue.push({ ...next, depth: p.depth + 1 });
      }
    }
  }
  return -1;
}

export function makeWorld(seed: number, family: Family = "warehouse"): World {
  const rng = new Random(seed);
  const size = 12;
  const rotation = rng.int(4);
  const rotate = (p: Point): Point =>
    rotation === 0
      ? p
      : rotation === 1
        ? { x: 11 - p.x, y: 11 - p.y }
        : rotation === 2
          ? { x: p.y, y: 11 - p.x }
          : { x: 11 - p.y, y: p.x };
  const start = rotate({ x: 1 + rng.int(4), y: 7 + rng.int(4) });
  const goal = rotate({ x: 7 + rng.int(4), y: 1 + rng.int(4) });
  // Retry layouts, never route the agent with this oracle. BFS only rejects
  // impossible training episodes and measures path efficiency after execution.
  for (let attempt = 0; attempt < 50; attempt++) {
    const walls = new Set<number>();
    if (family === "warehouse") {
      for (let x = 2; x < 11; x += 3) {
        const gap = 2 + rng.int(7);
        for (let y = 2; y < 10; y++) {
          if (Math.abs(y - gap) > 1 && rng.next() > 0.14)
            walls.add(y * size + x);
        }
      }
    } else if (family === "terrain") {
      for (let y = 1; y < 11; y++)
        for (let x = 1; x < 11; x++)
          if (rng.next() < 0.22) walls.add(y * size + x);
    } else {
      for (let x = 3; x <= 9; x += 3) {
        const gap = 1 + rng.int(10);
        for (let y = 0; y < size; y++) if (y !== gap) walls.add(y * size + x);
      }
    }
    walls.delete(key(start, size));
    walls.delete(key(goal, size));
    const shortest = shortestPath(size, walls, start, goal);
    if (shortest > 0)
      return { size, seed, family, walls: [...walls], start, goal, shortest };
  }
  return {
    size,
    seed,
    family,
    walls: [],
    start,
    goal,
    shortest: distance(start, goal),
  };
}
