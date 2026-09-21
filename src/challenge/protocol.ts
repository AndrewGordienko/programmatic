import { SIMULATOR_VERSION } from "../offroad/simulator";
import { OffroadSearch } from "../offroad/search";
import { GraphPrior, type GraphPriorData } from "../offroad/prior";
import { Random } from "../engine/random";
import {
  OPS,
  type Config,
  type Macro,
  type Candidate,
  type TerrainKind,
} from "../offroad/types";
import { makeTerrain } from "../offroad/terrain";
import { diagnoseStart, type StartDiagnosis } from "./feasibility";

export const VERSION = "unseen-terrain-v1";
export const START_CHECK = "immobile-start-v1";
export const SEED_MIN = 2_100_000_000,
  SEED_RANGE = 40_000_000;
export type FrozenPayload = {
  version: typeof VERSION;
  simulatorVersion: string;
  frozenAt: string;
  config: Config;
  prior: GraphPriorData;
  macros: Macro[];
  trainingSeeds: number[];
  developmentSeeds: number[];
  trainingEvaluations: number;
  discoveryEvaluations: number;
  trainingMs: number;
  source: string;
  acceptance: string;
};
export type FrozenArtifact = { hash: string; payload: FrozenPayload };
export type ChallengeSpec = {
  seed: number;
  kind: TerrainKind;
  searchSeed: number;
};
export type Manifest = {
  version: typeof VERSION;
  createdAt: string;
  artifactHash: string;
  budget: number;
  challenges: ChallengeSpec[];
  ablationOf?: string;
  mode: "learned" | "remove-macros";
  startCheck?: typeof START_CHECK;
};
export type RaceState = {
  evaluations: number;
  budget: number;
  status: "searching" | "solved" | "exhausted" | "infeasible";
  diagnosis?: StartDiagnosis;
  startCheckMs?: number;
  best: Candidate | null;
  solution: Candidate | null;
  computeMs: number;
  elapsedMs: number;
  generation: number;
};
export function validateArtifact(a: FrozenArtifact) {
  const p = a.payload;
  if (
    p.simulatorVersion !== SIMULATOR_VERSION ||
    p.version !== VERSION ||
    !Number.isFinite(Date.parse(p.frozenAt)) ||
    !/^[a-f0-9]{64}$/.test(a.hash)
  )
    throw Error("Invalid frozen artifact");
  new GraphPrior(new Random(0)).restore(p.prior);
  if (
    p.macros.length > 3 ||
    new Set(p.macros.map((m) => m.name)).size !== p.macros.length
  )
    throw Error("Invalid macro library");
  for (const m of p.macros) {
    const inner = OPS.find((o) => o.name === m.inner),
      outer = OPS.find((o) => o.name === m.outer);
    if (
      !inner ||
      !outer ||
      OPS.some((o) => o.name === m.name) ||
      !Number.isInteger(m.slot) ||
      m.slot < 0 ||
      m.slot >= outer.args.length ||
      outer.args[m.slot] !== inner.output ||
      m.output !== outer.output ||
      JSON.stringify(m.args) !==
        JSON.stringify([
          ...inner.args,
          ...outer.args.filter((_, i) => i !== m.slot),
        ])
    )
      throw Error("Invalid macro signature");
  }
  if (
    [...p.trainingSeeds, ...p.developmentSeeds].some(
      (s) => !Number.isInteger(s) || s >= SEED_MIN,
    )
  )
    throw Error("Training/challenge namespace overlap");
}
export function validateManifest(m: Manifest, artifact: FrozenArtifact) {
  validateArtifact(artifact);
  if (
    m.version !== VERSION ||
    m.artifactHash !== artifact.hash ||
    !Number.isInteger(m.budget) ||
    m.budget < 1 ||
    m.budget > 50_000 ||
    !["learned", "remove-macros"].includes(m.mode) ||
    (m.startCheck !== undefined && m.startCheck !== START_CHECK) ||
    Date.parse(m.createdAt) < Date.parse(artifact.payload.frozenAt) ||
    !Number.isFinite(Date.parse(m.createdAt))
  )
    throw Error("Invalid challenge manifest");
  if (
    !m.challenges.length ||
    m.challenges.length > 10 ||
    new Set(m.challenges.map((c) => c.seed)).size !== m.challenges.length
  )
    throw Error("Invalid sealed challenge list");
  for (const c of m.challenges)
    if (
      !Number.isInteger(c.seed) ||
      c.seed < SEED_MIN ||
      c.seed >= SEED_MIN + SEED_RANGE ||
      !["woodland", "quarry", "ridge"].includes(c.kind) ||
      !Number.isInteger(c.searchSeed) ||
      c.searchSeed < 0 ||
      c.searchSeed > 999999
    )
      throw Error("Invalid challenge seed");
}
// The browser supplies crypto random words only AFTER verifying the artifact.
// Only seed reuse causes rejection. No terrain is simulated or filtered here.
export function freshSpecs(
  count: number,
  used: Set<number>,
  randomWord: () => number,
): ChallengeSpec[] {
  const specs: ChallengeSpec[] = [],
    seen = new Set(used);
  const draw = (range: number) => {
    const limit = Math.floor(2 ** 32 / range) * range;
    let n = randomWord();
    while (n >= limit) n = randomWord();
    return n % range;
  };
  if (!Number.isInteger(count) || count < 1 || count > 10)
    throw Error("Choose 1–10 challenges");
  for (let attempts = 0; specs.length < count; attempts++) {
    if (attempts > 10000)
      throw Error("Could not generate unused challenge seeds");
    const seed = SEED_MIN + draw(SEED_RANGE);
    if (seen.has(seed)) continue;
    seen.add(seed);
    specs.push({
      seed,
      kind: (["woodland", "quarry", "ridge"] as const)[draw(3)],
      searchSeed: draw(1_000_000),
    });
  }
  return specs;
}
export class ChallengeSearch {
  readonly search: OffroadSearch;
  readonly terrain;
  private started = performance.now();
  private finishedMs: number | null = null;
  readonly diagnosis: StartDiagnosis | null;
  readonly startCheckMs: number;
  constructor(
    readonly artifact: FrozenArtifact,
    readonly spec: ChallengeSpec,
    readonly budget: number,
    macros: Macro[],
    startCheck = true,
  ) {
    this.terrain = makeTerrain(spec.seed, spec.kind);
    const checkStart = performance.now();
    this.diagnosis = startCheck ? diagnoseStart(this.terrain) : null;
    this.startCheckMs = performance.now() - checkStart;
    this.search = new OffroadSearch(
      { ...artifact.payload.config, seed: spec.searchSeed, evolveDSL: false },
      { terrains: [this.terrain], macros, frozenPrior: artifact.payload.prior },
    );
  }
  advance(): RaceState {
    if (
      !this.diagnosis &&
      this.search.rollouts < this.budget &&
      !this.search.solution
    ) {
      this.search.step({
        evaluations: this.budget - this.search.rollouts,
        stopOnSuccess: true,
        beyondGenerations: true,
      });
    }
    const state = this.state();
    if (state.status !== "searching" && this.finishedMs === null)
      this.finishedMs = state.elapsedMs;
    return this.state();
  }
  state(): RaceState {
    return {
      evaluations: this.search.rollouts,
      budget: this.budget,
      status: this.diagnosis
        ? "infeasible"
        : this.search.solution
          ? "solved"
          : this.search.rollouts >= this.budget
            ? "exhausted"
            : "searching",
      best: this.search.population[0] ?? null,
      solution: this.search.solution,
      computeMs: this.search.elapsedMs,
      elapsedMs: this.finishedMs ?? performance.now() - this.started,
      generation: this.search.generation,
      ...(this.diagnosis ? { diagnosis: this.diagnosis } : {}),
      startCheckMs: this.startCheckMs,
    };
  }
}
