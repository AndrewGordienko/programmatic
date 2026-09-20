import { activeIndices, evaluateProgram } from "./program";
import { ACTIONS, DIRECTIONS, distance, key, makeWorld } from "./world";
import type {
  Candidate,
  Episode,
  Family,
  Frame,
  Program,
  TransferResult,
  World,
} from "./types";

export function simulate(
  program: Program,
  world: World,
  trace = false,
): Episode {
  const { size, goal } = world;
  const walls = new Set(world.walls);
  const visits = new Uint16Array(size * size);
  const active = activeIndices(program);
  let position = { ...world.start },
    previous = -1,
    steps = 0;
  const frames: Frame[] = [
    {
      ...position,
      action: "observe",
      scores: [],
      selected: -1,
      reached: false,
    },
  ];
  visits[key(position, size)] = 1;
  const legal = (x: number, y: number) =>
    x >= 0 && x < size && y >= 0 && y < size && !walls.has(y * size + x);
  const maxSteps = size * size;
  while (steps < maxSteps && distance(position, goal) > 0) {
    const scores = DIRECTIONS.map((d, index) => {
      const next = { x: position.x + d.x, y: position.y + d.y };
      if (!legal(next.x, next.y)) return -Infinity;
      const clearance =
        DIRECTIONS.filter((e) => legal(next.x + e.x, next.y + e.y)).length / 4;
      return evaluateProgram(
        program,
        [
          distance(position, goal) - distance(next, goal),
          Math.min(8, visits[key(next, size)]),
          Number(previous === index),
          clearance,
        ],
        active,
      );
    });
    const selected = scores.indexOf(Math.max(...scores));
    if (scores[selected] === -Infinity) break;
    const d = DIRECTIONS[selected];
    position = { x: position.x + d.x, y: position.y + d.y };
    previous = selected;
    visits[key(position, size)]++;
    steps++;
    if (trace)
      frames.push({
        ...position,
        scores: scores.map((s) => (Number.isFinite(s) ? s : -999)),
        action: ACTIONS[selected],
        selected,
        reached: distance(position, goal) === 0,
      });
  }
  const success = distance(position, goal) === 0;
  const progress = Math.max(
    0,
    1 - distance(position, goal) / distance(world.start, goal),
  );
  const reward = success
    ? 70 + (30 * world.shortest) / Math.max(1, steps)
    : progress * 25 + (visits.filter((v) => v > 0).length / (size * size)) * 10;
  return { success, steps, reward, frames, shortest: world.shortest };
}

export function evaluate(
  program: Program,
  worlds: World[],
  complexity: number,
): Candidate {
  let reward = 0,
    successes = 0,
    steps = 0;
  for (const world of worlds) {
    const episode = simulate(program, world);
    reward += episode.reward;
    successes += Number(episode.success);
    steps += episode.steps;
  }
  const activeNodes = activeIndices(program).length;
  return {
    program,
    fitness: reward / worlds.length - complexity * activeNodes,
    success: successes / worlds.length,
    meanSteps: steps / worlds.length,
    activeNodes,
  };
}

export function transferTest(
  program: Program,
  seed = 1_500_000_000,
  count = 24,
): TransferResult[] {
  return (["warehouse", "terrain", "maze"] as Family[]).map((family, f) => {
    const seeds = Array.from(
      { length: count },
      (_, i) => seed + f * 10000 + i * 97,
    );
    const episodes = seeds.map((s) => simulate(program, makeWorld(s, family)));
    return {
      family,
      success: episodes.filter((e) => e.success).length / count,
      reward: episodes.reduce((a, e) => a + e.reward, 0) / count,
      meanSteps: episodes.reduce((a, e) => a + e.steps, 0) / count,
      count,
      seeds,
    };
  });
}
