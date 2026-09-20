export type TerrainKind = "woodland" | "quarry" | "ridge";
export type Surface = "earth" | "gravel" | "mud";
export type Rock = { x: number; z: number; radius: number; height: number };
export type Hill = { x: number; z: number; height: number; radius: number };
export type Patch = {
  x: number;
  z: number;
  radius: number;
  grip: number;
  surface: Surface;
};
export type Terrain = {
  seed: number;
  kind: TerrainKind;
  size: number;
  resolution: number;
  heights: number[];
  grips: number[];
  hills: Hill[];
  rocks: Rock[];
  patches: Patch[];
  start: { x: number; z: number; heading: number };
  goal: { x: number; z: number };
  initialDistance: number;
};
export type Truck = {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
  pitch: number;
  roll: number;
  grip: number;
  slip: number;
  clearance: number;
  time: number;
  distance: number;
  status:
    | "driving"
    | "arrived"
    | "collision"
    | "rollover"
    | "grounded"
    | "boundary"
    | "timeout";
  controls: Controls;
  scans?: Observation;
};
export type Controls = { steering: number; acceleration: number };
export const RAYS = 19;
export const SCAN_RANGE = 22;
export const ANGLES = Array.from(
  { length: RAYS },
  (_, i) => ((i / (RAYS - 1)) * 2 - 1) * 1.35,
);
export const VECTOR_INPUTS = [
  "goal_alignment",
  "clearance",
  "slope",
  "roughness",
  "traction",
] as const;
export const SCALAR_INPUTS = [
  "speed",
  "pitch",
  "roll",
  "previous_steer",
  "goal_distance",
  "zero",
  "one",
  "half",
  "minus_one",
] as const;
export const INPUTS = VECTOR_INPUTS.length + SCALAR_INPUTS.length;
export type ValueType = "vector" | "scalar" | "angle";
export type Value = number | Float64Array;
export type Observation = { vectors: Float64Array[]; scalars: number[] };
export type Op = { name: string; output: ValueType; args: ValueType[] };
export const OPS: Op[] = [
  { name: "v_add", output: "vector", args: ["vector", "vector"] },
  { name: "v_sub", output: "vector", args: ["vector", "vector"] },
  { name: "v_mul", output: "vector", args: ["vector", "vector"] },
  { name: "v_min", output: "vector", args: ["vector", "vector"] },
  { name: "v_max", output: "vector", args: ["vector", "vector"] },
  { name: "v_scale", output: "vector", args: ["vector", "scalar"] },
  { name: "v_negate", output: "vector", args: ["vector"] },
  { name: "argmax", output: "angle", args: ["vector"] },
  { name: "angle_scale", output: "angle", args: ["angle", "scalar"] },
  { name: "angle_add", output: "angle", args: ["angle", "angle"] },
  { name: "center", output: "scalar", args: ["vector"] },
  { name: "minimum", output: "scalar", args: ["vector"] },
  { name: "add", output: "scalar", args: ["scalar", "scalar"] },
  { name: "subtract", output: "scalar", args: ["scalar", "scalar"] },
  { name: "multiply", output: "scalar", args: ["scalar", "scalar"] },
  { name: "min", output: "scalar", args: ["scalar", "scalar"] },
  { name: "max", output: "scalar", args: ["scalar", "scalar"] },
  { name: "tanh", output: "scalar", args: ["scalar"] },
  { name: "negate", output: "scalar", args: ["scalar"] },
  { name: "constant", output: "scalar", args: [] },
];
export type Gene = {
  op: string;
  refs: number[];
  value: number;
  type: ValueType;
};
export type Macro = {
  name: string;
  output: ValueType;
  args: ValueType[];
  inner: string;
  outer: string;
  slot: number;
  definition: string;
};
export type Program = {
  id: string;
  genes: Gene[];
  steering: number;
  acceleration: number;
  macros: Macro[];
  origin: string;
};
export type Episode = {
  fitness: number;
  completion: number;
  success: boolean;
  end: Truck;
  steps: number;
  frames?: Truck[];
};
export type Candidate = {
  program: Program;
  fitness: number;
  success: number;
  completion: number;
  collisions: number;
  instabilities: number;
  timeouts: number;
  nodes: number;
  expandedNodes: number;
  scores: number[];
};
export type Config = {
  seed: number;
  population: number;
  generations: number;
  worlds: number;
  nodes: number;
  neural: boolean;
  evolveDSL: boolean;
};
export const CONFIG: Config = {
  seed: 42,
  population: 64,
  generations: 60,
  worlds: 9,
  nodes: 16,
  neural: true,
  evolveDSL: true,
};
export type Invention = {
  generation: number;
  macro: Macro;
  before: number;
  after: number;
  used: number;
  accepted: boolean;
  rollouts: number;
};
export type Snapshot = {
  config: Config;
  generation: number;
  best: Candidate;
  initial: Candidate;
  history: {
    generation: number;
    best: number;
    mean: number;
    success: number;
    nodes: number;
    diversity: number;
  }[];
  checkpoints: { generation: number; candidate: Candidate }[];
  macros: Macro[];
  inventions: Invention[];
  rollouts: number;
  discoveryRollouts: number;
  elapsedMs: number;
};
export type Evaluation = {
  kind: TerrainKind;
  count: number;
  success: number;
  collisions: number;
  instabilities: number;
  timeouts: number;
  completion: number;
  seeds: number[];
};
