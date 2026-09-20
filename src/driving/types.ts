export type RoadKind = "coastal" | "switchbacks" | "obstacles";
export type RoadPoint = { x: number; z: number; s: number; heading: number };
export type Obstacle = {
  x: number;
  z: number;
  radius: number;
  kind: "barrier" | "cone";
  s: number;
};
export type DrivingWorld = {
  seed: number;
  kind: RoadKind;
  points: RoadPoint[];
  width: number;
  length: number;
  grip: number;
  obstacles: Obstacle[];
  startOffset: number;
  startHeading: number;
  speedLimit: number;
};
export type DriveState = {
  x: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
  time: number;
  progress: number;
  nearest: number;
  lateral: number;
  status: "driving" | "finished" | "collision" | "offroad" | "timeout";
  controls: DriveControls;
  sensors: number[];
  distance: number;
};
export type DriveControls = {
  steering: number;
  throttle: number;
  brake: number;
};
export const SENSOR_NAMES = [
  "heading_error",
  "lookahead_error",
  "cross_track",
  "speed",
  "speed_error",
  "range_left",
  "range_front",
  "range_right",
  "range_far_left",
  "range_far_right",
  "previous_steer",
] as const;
export const CONSTANTS = [-2, -1, -0.5, 0, 0.25, 0.5, 1, 2];
export const INPUT_COUNT = SENSOR_NAMES.length + CONSTANTS.length;
export const DRIVE_OPS = [
  "copy",
  "add",
  "subtract",
  "multiply",
  "divide",
  "min",
  "max",
  "tanh",
  "negate",
  "scale",
] as const;
export type DriveOp = (typeof DRIVE_OPS)[number];
export type DriveGene = { op: string; a: number; b: number; value: number };
export type DriveMacro = {
  name: string;
  inner: DriveOp;
  outer: DriveOp;
  side: "left" | "right";
  definition: string;
};
export type DriveProgram = {
  id: string;
  genes: DriveGene[];
  steering: number;
  acceleration: number;
  origin: "random" | "neural" | "mutation" | "crossover";
  macros: DriveMacro[];
};
export type DriveEpisode = {
  completion: number;
  success: boolean;
  reward: number;
  steps: number;
  end: DriveState;
  meanSpeed: number;
  frames?: DriveState[];
};
export type DriveCandidate = {
  program: DriveProgram;
  fitness: number;
  success: number;
  completion: number;
  meanSpeed: number;
  nodes: number;
  collisions: number;
  departures: number;
};
export type DriveConfig = {
  seed: number;
  population: number;
  generations: number;
  worlds: number;
  maxNodes: number;
  neural: boolean;
  evolveDSL: boolean;
};
export const DRIVE_CONFIG: DriveConfig = {
  seed: 42,
  population: 80,
  generations: 50,
  worlds: 8,
  maxNodes: 20,
  neural: true,
  evolveDSL: true,
};
export type DriveGeneration = {
  generation: number;
  best: number;
  mean: number;
  success: number;
  nodes: number;
  diversity: number;
};
export type DriveSnapshot = {
  config: DriveConfig;
  generation: number;
  best: DriveCandidate;
  history: DriveGeneration[];
  evaluations: number;
  elapsedMs: number;
  leaders: DriveCandidate[];
  initial: DriveCandidate;
  macros: DriveMacro[];
  inventions: {
    generation: number;
    definition: string;
    accepted: boolean;
    used: boolean;
    before: number;
    after: number;
    evaluations: number;
  }[];
  checkpoints: { generation: number; candidate: DriveCandidate }[];
};
export type DriveEvaluation = {
  kind: RoadKind;
  success: number;
  completion: number;
  meanSpeed: number;
  collisions: number;
  departures: number;
  count: number;
  seeds: number[];
};
