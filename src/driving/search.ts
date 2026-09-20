import { Random } from "../engine/random";
import { NeuralPrior, type Decision } from "../engine/neural";
import { activeDriveGenes, mineDriveMacros, randomDriveGene } from "./program";
import { evaluateDrive } from "./simulator";
import {
  DRIVE_OPS,
  INPUT_COUNT,
  type DriveCandidate,
  type DriveConfig,
  type DriveMacro,
  type DriveProgram,
  type DriveSnapshot,
  type DrivingWorld,
} from "./types";
import { makeDrivingWorld } from "./world";

export class DrivingSearch {
  config: DriveConfig;
  rng: Random;
  prior: NeuralPrior;
  worlds: DrivingWorld[];
  macros: DriveMacro[];
  population: DriveCandidate[] = [];
  generation = 0;
  evaluations = 0;
  elapsedMs = 0;
  history: DriveSnapshot["history"] = [];
  inventions: DriveSnapshot["inventions"] = [];
  checkpoints: DriveSnapshot["checkpoints"] = [];
  initial: DriveCandidate | null = null;
  private serial = 0;
  private archive: DriveProgram[] = [];
  constructor(
    config: DriveConfig,
    options?: {
      worlds?: DrivingWorld[];
      macros?: DriveMacro[];
      parents?: DriveProgram[];
    },
  ) {
    if (
      !Number.isInteger(config.seed) ||
      config.seed < 0 ||
      config.seed > 999999 ||
      config.population < 16 ||
      config.population > 160 ||
      config.generations < 1 ||
      config.generations > 150 ||
      config.maxNodes < 4 ||
      config.maxNodes > 40 ||
      config.worlds < 1 ||
      config.worlds > 20
    )
      throw new Error("Invalid driving-search configuration.");
    this.config = { ...config };
    this.rng = new Random(config.seed);
    this.prior = new NeuralPrior(this.rng, DRIVE_OPS.length, DRIVE_OPS.length);
    this.macros = structuredClone(options?.macros ?? []);
    this.worlds =
      options?.worlds ??
      Array.from({ length: config.worlds }, (_, i) =>
        makeDrivingWorld(
          config.seed * 1000 + i * 113,
          i % 4 === 3 ? "obstacles" : i % 4 === 2 ? "switchbacks" : "coastal",
        ),
      );
    if (options?.parents) {
      this.population = options.parents
        .map((p) =>
          evaluateDrive(
            { ...structuredClone(p), macros: this.macros },
            this.worlds,
          ),
        )
        .sort((a, b) => b.fitness - a.fitness);
      this.evaluations += this.population.length * this.worlds.length;
    }
  }
  private id() {
    return `d${String(++this.serial).padStart(5, "0")}`;
  }
  private fresh(): { program: DriveProgram; decisions: Decision[] } {
    const guided = this.config.neural && this.rng.next() < 0.7;
    const decisions: Decision[] = [];
    let previous = -1;
    const genes = Array.from({ length: this.config.maxNodes }, (_, i) => {
      if (!guided || (this.macros.length && this.rng.next() < 0.15))
        return randomDriveGene(this.rng, i, this.macros);
      const d = this.prior.sample(this.rng, i, this.config.maxNodes, previous);
      decisions.push(d);
      previous = d.choice;
      return randomDriveGene(this.rng, i, this.macros, DRIVE_OPS[d.choice]);
    });
    return {
      program: {
        id: this.id(),
        genes,
        steering: this.rng.int(INPUT_COUNT + genes.length),
        acceleration: this.rng.int(INPUT_COUNT + genes.length),
        macros: this.macros,
        origin: guided ? "neural" : "random",
      },
      decisions,
    };
  }
  private mutate(parent: DriveProgram): DriveProgram {
    const p: DriveProgram = {
      ...structuredClone(parent),
      id: this.id(),
      origin: "mutation",
      macros: this.macros,
    };
    const active = activeDriveGenes(p);
    const method = this.rng.next();
    if (method < 0.16) p.steering = this.rng.int(INPUT_COUNT + p.genes.length);
    else if (method < 0.32)
      p.acceleration = this.rng.int(INPUT_COUNT + p.genes.length);
    else {
      const i =
        active.length && this.rng.next() < 0.75
          ? this.rng.pick(active)
          : this.rng.int(p.genes.length);
      const gene = p.genes[i];
      const part = this.rng.int(5);
      if (part === 0) gene.a = this.rng.int(INPUT_COUNT + i);
      else if (part === 1) gene.b = this.rng.int(INPUT_COUNT + i);
      else if (part === 2) gene.value += (this.rng.next() - 0.5) * 1.2;
      else p.genes[i] = randomDriveGene(this.rng, i, this.macros);
      if (!active.length && this.rng.next() < 0.7) p.steering = INPUT_COUNT + i;
    }
    return p;
  }
  private discover() {
    const proposals = mineDriveMacros(
      [...this.population.slice(0, 16).map((c) => c.program), ...this.archive],
      this.macros,
    );
    if (!proposals.length) return;
    const worlds = Array.from({ length: 4 }, (_, i) =>
      makeDrivingWorld(
        1_300_000_000 + i * 137,
        i % 2 === 0 ? "coastal" : "obstacles",
      ),
    );
    const config = {
      ...this.config,
      seed: (this.config.seed + 7000 + this.generation) % 999999,
      population: 24,
      generations: 5,
      evolveDSL: false,
    };
    const evaluateLanguage = (macros: DriveMacro[]) => {
      const search = new DrivingSearch(config, {
        worlds,
        macros,
        parents: this.population.slice(0, 4).map((c) => c.program),
      });
      for (let i = 0; i < config.generations; i++) search.step();
      this.evaluations += search.evaluations;
      return search.snapshot();
    };
    const baseline = evaluateLanguage(this.macros);
    let selected: { macro: DriveMacro; fitness: number; index: number } | null =
      null;
    for (const macro of proposals) {
      const variant = evaluateLanguage([...this.macros, macro]);
      // A changed sampler alone can find a better old-language program. Require
      // the development winner to actually use the proposed abstraction.
      const used = activeDriveGenes(variant.best.program).some(
        (i) => variant.best.program.genes[i].op === macro.name,
      );
      this.inventions.push({
        generation: this.generation,
        definition: macro.definition,
        before: baseline.best.fitness,
        after: variant.best.fitness,
        accepted: false,
        used,
        evaluations: variant.evaluations,
      });
      if (
        used &&
        variant.best.fitness > baseline.best.fitness + 0.15 &&
        (!selected || variant.best.fitness > selected.fitness)
      )
        selected = {
          macro,
          fitness: variant.best.fitness,
          index: this.inventions.length - 1,
        };
    }
    if (selected) {
      this.macros.push(selected.macro);
      this.inventions[selected.index].accepted = true;
    }
  }
  step(): DriveSnapshot {
    if (this.generation >= this.config.generations) return this.snapshot();
    const started = performance.now();
    const candidates = this.population.slice(
      0,
      Math.max(3, Math.floor(this.config.population * 0.1)),
    );
    const elites = this.population.slice(
      0,
      Math.max(4, Math.floor(this.config.population * 0.22)),
    );
    const batch: { decisions: Decision[]; reward: number }[] = [];
    while (candidates.length < this.config.population) {
      let program: DriveProgram,
        decisions: Decision[] = [];
      const choice = this.rng.next();
      if (elites.length && choice < 0.64)
        program = this.mutate(this.rng.pick(elites).program);
      else if (elites.length && choice < 0.81) {
        const p = this.rng.pick(elites).program,
          q = this.rng.pick(elites).program,
          cut = this.rng.int(p.genes.length);
        program = {
          ...structuredClone(p),
          id: this.id(),
          origin: "crossover",
          macros: this.macros,
          genes: p.genes.map((g, i) => ({ ...(i < cut ? g : q.genes[i]) })),
          acceleration: this.rng.next() < 0.5 ? q.acceleration : p.acceleration,
        };
      } else ({ program, decisions } = this.fresh());
      const candidate = evaluateDrive(program, this.worlds);
      candidates.push(candidate);
      this.evaluations += this.worlds.length;
      if (decisions.length)
        batch.push({ decisions, reward: candidate.fitness });
    }
    if (this.config.neural) this.prior.update(batch);
    this.population = candidates.sort(
      (a, b) => b.fitness - a.fitness || a.nodes - b.nodes,
    );
    for (const c of this.population
      .filter(
        (c) =>
          c.nodes >= 2 &&
          c.nodes <= 12 &&
          c.fitness > this.population[0].fitness * 0.5,
      )
      .slice(0, 6)) {
      if (!this.archive.some((p) => p.id === c.program.id))
        this.archive.push(structuredClone(c.program));
    }
    this.archive = this.archive.slice(-64);
    this.generation++;
    if (!this.initial) this.initial = structuredClone(this.population[0]);
    const best = this.population[0];
    this.history.push({
      generation: this.generation,
      best: best.fitness,
      mean: candidates.reduce((n, c) => n + c.fitness, 0) / candidates.length,
      success: best.success,
      nodes: best.nodes,
      diversity:
        new Set(candidates.map((c) => Math.round(c.fitness * 100))).size /
        candidates.length,
    });
    if (
      this.generation === 1 ||
      this.generation % 5 === 0 ||
      this.generation === this.config.generations
    )
      this.checkpoints.push({
        generation: this.generation,
        candidate: structuredClone(best),
      });
    if (
      this.config.evolveDSL &&
      (this.generation === 15 || this.generation === 30)
    )
      this.discover();
    this.elapsedMs += performance.now() - started;
    return this.snapshot();
  }
  snapshot(): DriveSnapshot {
    return {
      config: this.config,
      generation: this.generation,
      best: this.population[0],
      initial: this.initial ?? this.population[0],
      history: [...this.history],
      evaluations: this.evaluations,
      elapsedMs: this.elapsedMs,
      leaders: this.population.slice(0, 5),
      macros: [...this.macros],
      inventions: [...this.inventions],
      checkpoints: [...this.checkpoints],
    };
  }
}
