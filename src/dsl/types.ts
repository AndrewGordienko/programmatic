import type { Expr, Macro } from "../engine/language";
export type { Expr, Macro };
export const BASE = ["add", "sub", "mul", "min", "max", "neg"];
export const ARITY: Record<string, number> = {
  add: 2,
  sub: 2,
  mul: 2,
  min: 2,
  max: 2,
  neg: 1,
};
export type Example = { input: [number, number]; output: number };
// Only input/output examples cross the task-generator boundary. No target AST.
export type Task = {
  id: string;
  examples: Example[];
  checks: Example[];
  signature: string;
  group: string;
};
export type CorpusEntry = { task: Task; tree: Expr };
export type PriorData = {
  ops: string[];
  w1: number[][];
  w2: number[][];
  samples: number;
  loss: number;
};
export type Solution = {
  tree: Expr;
  expression: string;
  solved: boolean;
  evaluations: number;
  effort: number;
  budget: number;
  trainError: number;
  checkError: number;
  nodes: number;
  expandedNodes: number;
  macroCalls: number;
  elapsedMs: number;
  duplicates: number;
  validFraction: number;
  macroProposalFraction: number;
  entropy: number;
  depth: number;
};
export type Config = {
  seed: number;
  rounds: number;
  training: number;
  development: number;
  confirmation: number;
  testing: number;
  replicates: number;
  wakeBudget: number;
  finalBudget: number;
  screenBudget: number;
  developmentBudget: number;
  confirmationBudget: number;
  shortlist: number;
  finalists: number;
};
export const DEFAULT: Config = {
  seed: 42,
  rounds: 2,
  training: 500,
  development: 60,
  confirmation: 40,
  testing: 200,
  replicates: 3,
  wakeBudget: 1536,
  finalBudget: 2048,
  screenBudget: 256,
  developmentBudget: 1024,
  confirmationBudget: 1536,
  shortlist: 12,
  finalists: 3,
};
export type Arm =
  "fixed-uniform" | "fixed-prior" | "library-uniform" | "library-prior";
export const ARMS: Arm[] = [
  "fixed-uniform",
  "fixed-prior",
  "library-uniform",
  "library-prior",
];
export const LABELS: Record<Arm, string> = {
  "fixed-uniform": "Fixed DSL · uniform",
  "fixed-prior": "Fixed DSL · learned prior",
  "library-uniform": "Learned DSL · uniform",
  "library-prior": "Learned DSL · learned prior",
};
export type Trial = {
  task: string;
  seed: number;
  arm: Arm;
  solution: Solution;
};
export type Proposal = {
  round: number;
  label: string;
  macros: Macro[];
  compression: number;
  stage: string;
  screen?: number;
  development?: number;
  gain?: number;
  lowerBound?: number;
  seedWins?: number;
  accepted: boolean;
  reason: string;
  seedScores?: number[];
  branching?: number;
};
export type Round = {
  round: number;
  corpus: number;
  candidates: number;
  screened: number;
  tested: number;
  accepted: string | null;
  librarySize: number;
};
export type Budget = {
  wake: number;
  screen: number;
  development: number;
  confirmation: number;
  final: number;
  searchCalls: number;
  priorFits: number;
  priorMs: number;
};
export type Result = {
  version: "library-search-v1";
  config: Config;
  phase: string;
  progress: number;
  completed: boolean;
  macros: Macro[];
  rounds: Round[];
  proposals: Proposal[];
  trials: Trial[];
  corpus: { task: string; expression: string; tree: Expr }[];
  priors: { fixed?: PriorData; learned?: PriorData };
  probabilities: { op: string; probability: number }[];
  splits: Record<string, string[]>;
  budget: Budget;
  elapsedMs: number;
  discoveryMs: number;
  ablations?: {
    label: string;
    applicable: boolean;
    reason: string;
    trials: Trial[];
  }[];
};
