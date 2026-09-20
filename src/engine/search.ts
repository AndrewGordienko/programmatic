import { NeuralPrior, type Decision } from "./neural";
import { randomGene } from "./program";
import { Random } from "./random";
import { evaluate } from "./simulator";
import {
  OPS,
  type Candidate,
  type Config,
  type Generation,
  type Program,
  type Snapshot,
  type World,
} from "./types";
import { makeWorld } from "./world";

export class Search {
  readonly config: Config;
  rng: Random;
  prior: NeuralPrior;
  worlds: World[];
  population: Candidate[] = [];
  history: Generation[] = [];
  generation = 0;
  evaluations = 0;
  elapsedMs = 0;
  private serial = 0;
  constructor(config: Config) {
    if (
      !Number.isInteger(config.seed) ||
      config.seed < 0 ||
      config.seed > 999999 ||
      !Number.isInteger(config.population) ||
      config.population < 8 ||
      config.population > 256 ||
      !Number.isInteger(config.maxNodes) ||
      config.maxNodes < 2 ||
      config.maxNodes > 24 ||
      !Number.isInteger(config.trainingWorlds) ||
      config.trainingWorlds < 1 ||
      config.trainingWorlds > 48 ||
      !Number.isInteger(config.generations) ||
      config.generations < 1 ||
      config.generations > 200 ||
      config.mutationRate < 0 ||
      config.mutationRate > 1 ||
      !Number.isFinite(config.complexity) ||
      config.complexity < 0
    )
      throw new Error("Invalid experiment configuration.");
    this.config = { ...config };
    this.rng = new Random(config.seed);
    this.prior = new NeuralPrior(this.rng);
    this.worlds = Array.from({ length: config.trainingWorlds }, (_, i) =>
      makeWorld(
        config.seed * 1000 + i * 31,
        config.diverse && i % 3 === 0 ? "terrain" : "warehouse",
      ),
    );
  }
  private id() {
    return `p${String(++this.serial).padStart(4, "0")}`;
  }
  private fresh(guided: boolean): { program: Program; decisions: Decision[] } {
    const decisions: Decision[] = [];
    let previous = -1;
    const genes = Array.from({ length: this.config.maxNodes }, (_, i) => {
      if (!guided) return randomGene(this.rng, i);
      const d = this.prior.sample(this.rng, i, this.config.maxNodes, previous);
      decisions.push(d);
      previous = d.choice;
      return randomGene(this.rng, i, OPS[d.choice]);
    });
    return {
      program: {
        id: this.id(),
        genes,
        output: genes.length - 1,
        origin: guided ? "neural" : "random",
      },
      decisions,
    };
  }
  private mutate(parent: Program): Program {
    const genes = parent.genes.map((g, i) =>
      this.rng.next() < this.config.mutationRate
        ? randomGene(this.rng, i)
        : { ...g },
    );
    // Always give the child at least one mutation, while preserving CGP links.
    const i = this.rng.int(genes.length);
    genes[i] = randomGene(this.rng, i);
    return {
      id: this.id(),
      genes,
      output:
        this.rng.next() < 0.12 ? this.rng.int(genes.length) : parent.output,
      origin: "mutation",
    };
  }
  step(): Snapshot {
    if (this.generation >= this.config.generations) return this.snapshot();
    const start = performance.now();
    const candidates: Candidate[] = [];
    const batch: { decisions: Decision[]; reward: number }[] = [];
    if (this.population.length)
      candidates.push(
        ...this.population.slice(
          0,
          Math.max(2, Math.floor(this.config.population * 0.1)),
        ),
      );
    const elite = this.population.slice(
      0,
      Math.max(2, Math.floor(this.config.population * 0.25)),
    );
    while (candidates.length < this.config.population) {
      let program: Program,
        decisions: Decision[] = [];
      const method = this.rng.next();
      if (elite.length && method < 0.55)
        program = this.mutate(this.rng.pick(elite).program);
      else if (elite.length && method < 0.72) {
        const p = this.rng.pick(elite).program,
          q = this.rng.pick(elite).program,
          cut = 1 + this.rng.int(p.genes.length - 1);
        program = {
          id: this.id(),
          genes: p.genes.map((g, i) => ({ ...(i < cut ? g : q.genes[i]) })),
          output: p.output,
          origin: "crossover",
        };
      } else
        ({ program, decisions } = this.fresh(
          this.config.neural && (this.generation > 0 || this.rng.next() > 0.5),
        ));
      const candidate = evaluate(program, this.worlds, this.config.complexity);
      candidates.push(candidate);
      this.evaluations += this.worlds.length;
      if (decisions.length)
        batch.push({ decisions, reward: candidate.fitness });
    }
    if (this.config.neural) this.prior.update(batch);
    this.population = candidates.sort(
      (a, b) => b.fitness - a.fitness || a.activeNodes - b.activeNodes,
    );
    this.generation++;
    const best = this.population[0];
    this.history.push({
      generation: this.generation,
      best: best.fitness,
      mean: candidates.reduce((a, c) => a + c.fitness, 0) / candidates.length,
      success: best.success,
      nodes: best.activeNodes,
      diversity:
        new Set(candidates.map((c) => Math.round(c.fitness * 100))).size /
        candidates.length,
    });
    this.elapsedMs += performance.now() - start;
    return this.snapshot();
  }
  snapshot(): Snapshot {
    return {
      config: this.config,
      generation: this.generation,
      history: [...this.history],
      best: this.population[0],
      leaders: this.population.slice(0, 6),
      evaluations: this.evaluations,
      elapsedMs: this.elapsedMs,
      prior: this.prior.distribution(),
    };
  }
}
