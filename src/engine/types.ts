export type Family = "warehouse" | "terrain" | "maze";
export type Point = { x: number; y: number };
export type World = {
  size: number;
  seed: number;
  family: Family;
  walls: number[];
  start: Point;
  goal: Point;
  shortest: number;
};
export const OPS = [
  "progress",
  "visits",
  "momentum",
  "clearance",
  "constant",
  "add",
  "subtract",
  "multiply",
  "min",
  "max",
  "negate",
] as const;
export type Op = (typeof OPS)[number];
export type Gene = { op: Op; a: number; b: number; value: number };
export type Program = {
  id: string;
  genes: Gene[];
  output: number;
  origin: "random" | "neural" | "mutation" | "crossover";
};
export type Frame = Point & {
  action: string;
  scores: number[];
  selected: number;
  reached: boolean;
};
export type Episode = {
  success: boolean;
  steps: number;
  reward: number;
  frames: Frame[];
  shortest: number;
};
export type Candidate = {
  program: Program;
  fitness: number;
  success: number;
  meanSteps: number;
  activeNodes: number;
};
export type Config = {
  population: number;
  generations: number;
  maxNodes: number;
  mutationRate: number;
  seed: number;
  trainingWorlds: number;
  neural: boolean;
  diverse: boolean;
  complexity: number;
};
export type Generation = {
  generation: number;
  best: number;
  mean: number;
  success: number;
  nodes: number;
  diversity: number;
};
export type Snapshot = {
  config: Config;
  generation: number;
  history: Generation[];
  best: Candidate;
  leaders: Candidate[];
  evaluations: number;
  elapsedMs: number;
  prior: number[];
};
export type TransferResult = {
  family: Family;
  success: number;
  reward: number;
  meanSteps: number;
  count: number;
  seeds: number[];
};
export type SavedRun = {
  selectedRank?: number;
  id: string;
  name: string;
  createdAt: string;
  snapshot: Snapshot;
};
export const DEFAULT_CONFIG: Config = {
  population: 64,
  generations: 40,
  maxNodes: 12,
  mutationRate: 0.2,
  seed: 42,
  trainingWorlds: 12,
  neural: true,
  diverse: true,
  complexity: 0.25,
};
