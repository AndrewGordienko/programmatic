import { Random } from "../engine/random";
import { GraphPrior, type Decision } from "./prior";
import {
  activeGenes,
  inputTypes,
  mineMacros,
  operations,
  randomGene,
} from "./program";
import { evaluate } from "./simulator";
import { makeTerrain, trainingTerrains } from "./terrain";
import {
  INPUTS,
  type Candidate,
  type Config,
  type Gene,
  type Macro,
  type Program,
  type Snapshot,
  type Terrain,
  type ValueType,
} from "./types";
export class OffroadSearch {
  config: Config;
  rng: Random;
  prior: GraphPrior;
  terrains: Terrain[];
  macros: Macro[];
  population: Candidate[] = [];
  generation = 0;
  rollouts = 0;
  discoveryRollouts = 0;
  elapsedMs = 0;
  history: Snapshot["history"] = [];
  checkpoints: Snapshot["checkpoints"] = [];
  inventions: Snapshot["inventions"] = [];
  initial: Candidate | null = null;
  private serial = 0;
  private archive: Program[] = [];
  constructor(
    config: Config,
    options?: { terrains?: Terrain[]; macros?: Macro[]; parents?: Program[] },
  ) {
    if (
      !Number.isInteger(config.seed) ||
      config.seed < 0 ||
      config.seed > 999999 ||
      !Number.isInteger(config.population) ||
      config.population < 16 ||
      config.population > 160 ||
      config.generations < 1 ||
      config.generations > 200 ||
      config.nodes < 8 ||
      config.nodes > 32 ||
      config.worlds < 3 ||
      config.worlds > 18
    )
      throw Error("Invalid off-road search configuration");
    this.config = { ...config };
    this.rng = new Random(config.seed);
    this.prior = new GraphPrior(this.rng);
    this.terrains =
      options?.terrains ?? trainingTerrains(config.seed, config.worlds);
    this.macros = structuredClone(options?.macros ?? []);
    if (options?.parents) {
      this.population = options.parents
        .map((p) =>
          evaluate(
            { ...structuredClone(p), macros: this.macros },
            this.terrains,
          ),
        )
        .sort((a, b) => b.fitness - a.fitness);
      this.rollouts += this.population.length * this.terrains.length;
    }
  }
  private id() {
    return `off-${String(++this.serial).padStart(5, "0")}`;
  }
  private fresh() {
    const guided = this.config.neural && this.rng.next() < 0.75,
      decisions: Decision[] = [],
      genes: Gene[] = [],
      types = [...inputTypes],
      ops = operations(this.macros);
    for (let i = 0; i < this.config.nodes; i++) {
      const type: ValueType =
        i === this.config.nodes - 1
          ? "angle"
          : i === this.config.nodes - 2
            ? "scalar"
            : this.rng.pick(["vector", "vector", "angle", "scalar"]);
      const validOps = ops.filter(
        (o) => o.output === type && o.args.every((t) => types.includes(t)),
      );
      if (!guided) {
        const g = randomGene(
          this.rng,
          types,
          this.macros,
          this.rng.pick(validOps),
        );
        genes.push(g);
        types.push(g.type);
        continue;
      }
      const d = this.prior.sample(
        this.rng,
        this.prior.context(genes, type, 0),
        ops
          .map((o, j) => (validOps.includes(o) ? j : -1))
          .filter((j) => j >= 0),
      );
      decisions.push(d);
      const op = ops[d.choice];
      const refs = op.args.map((t, j) => {
        const choice = this.prior.sample(
          this.rng,
          this.prior.context(genes, t, j + 1),
          types.map((v, k) => (v === t ? k : -1)).filter((k) => k >= 0),
        );
        decisions.push(choice);
        return choice.choice;
      });
      genes.push({
        op: op.name,
        type: op.output,
        refs,
        value: (this.rng.next() * 2 - 1) * 3,
      });
      types.push(op.output);
    }
    const output = (role: number) => {
      const outType = role === 4 ? "angle" : "scalar";
      const legal = types
        .map((t, i) => (t === outType ? i : -1))
        .filter((i) => i >= 0);
      if (!guided) return this.rng.pick(legal);
      const d = this.prior.sample(
        this.rng,
        this.prior.context(genes, outType, role),
        legal,
      );
      decisions.push(d);
      return d.choice;
    };
    return {
      program: {
        id: this.id(),
        genes,
        steering: output(4),
        acceleration: output(5),
        macros: this.macros,
        origin: guided ? "neural proposal" : "random proposal",
      } satisfies Program,
      decisions,
    };
  }
  private mutate(parent: Program) {
    const p: Program = {
        ...structuredClone(parent),
        id: this.id(),
        macros: this.macros,
        origin: "mutation",
      },
      active = activeGenes(p),
      types = [...inputTypes, ...p.genes.map((g) => g.type)];
    const mode = this.rng.next();
    if (mode < 0.12)
      p.steering = this.rng.pick(
        types.map((t, i) => (t === "angle" ? i : -1)).filter((i) => i >= 0),
      );
    else if (mode < 0.24)
      p.acceleration = this.rng.pick(
        types.map((t, i) => (t === "scalar" ? i : -1)).filter((i) => i >= 0),
      );
    else {
      const i =
          active.length && this.rng.next() < 0.8
            ? this.rng.pick(active)
            : this.rng.int(p.genes.length),
        g = p.genes[i],
        available = types.slice(0, INPUTS + i),
        op = operations(this.macros).find((o) => o.name === g.op)!;
      if (this.rng.next() < 0.35 && g.refs.length) {
        // Grow a connected expression through an unused earlier CGP slot. This
        // preserves the existing useful operand while introducing a new term.
        const j = this.rng.int(g.refs.length),
          original = g.refs[j],
          type = op.args[j];
        const slots = p.genes
          .map((v, k) =>
            k < i &&
            !active.includes(k) &&
            v.type === type &&
            INPUTS + k > original
              ? k
              : -1,
          )
          .filter((k) => k >= 0);
        if (slots.length) {
          const slot = this.rng.pick(slots),
            newOp = this.rng.pick(
              operations(this.macros).filter(
                (o) =>
                  o.output === type &&
                  o.args.includes(type) &&
                  o.args.every((t) =>
                    types.slice(0, INPUTS + slot).includes(t),
                  ),
              ),
            );
          const inserted = randomGene(
            this.rng,
            types.slice(0, INPUTS + slot),
            this.macros,
            newOp,
          );
          inserted.refs[newOp.args.indexOf(type)] = original;
          p.genes[slot] = inserted;
          g.refs[j] = INPUTS + slot;
        }
      } else if (this.rng.next() < 0.65 && g.refs.length) {
        const j = this.rng.int(g.refs.length);
        g.refs[j] = this.rng.pick(
          available
            .map((t, k) => (t === op.args[j] ? k : -1))
            .filter((k) => k >= 0),
        );
      } else if (g.op === "constant" && this.rng.next() < 0.75)
        g.value += (this.rng.next() - 0.5) * 1.4;
      else
        p.genes[i] = randomGene(
          this.rng,
          available,
          this.macros,
          this.rng.pick(
            operations(this.macros).filter(
              (o) =>
                o.output === g.type &&
                o.args.every((t) => available.includes(t)),
            ),
          ),
        );
    }
    return p;
  }
  private crossover(a: Program, b: Program) {
    const p: Program = {
      ...structuredClone(a),
      id: this.id(),
      origin: "crossover",
      macros: this.macros,
    };
    const types = [...inputTypes, ...p.genes.map((g) => g.type)];
    for (let i = this.rng.int(p.genes.length); i < p.genes.length; i++) {
      const g = b.genes[i],
        op = operations(this.macros).find((o) => o.name === g.op)!;
      if (
        g.type === p.genes[i].type &&
        g.refs.every((r, j) => types[r] === op.args[j])
      )
        p.genes[i] = structuredClone(g);
    }
    return p;
  }
  private discover() {
    if (this.macros.length >= 3) return;
    const proposals = mineMacros(
      [...this.population.slice(0, 12).map((c) => c.program), ...this.archive],
      this.macros,
    );
    if (!proposals.length) return;
    const terrains = Array.from({ length: 3 }, (_, i) =>
      makeTerrain(
        1_300_000_000 + i * 137,
        (["woodland", "quarry", "ridge"] as const)[i],
      ),
    );
    const config = {
      ...this.config,
      population: 20,
      generations: 6,
      evolveDSL: false,
    };
    const trial = (macros: Macro[], seed: number) => {
      const s = new OffroadSearch({ ...config, seed }, { terrains, macros });
      for (let i = 0; i < config.generations; i++) s.step();
      this.discoveryRollouts += s.rollouts;
      return s.snapshot();
    };
    const seeds = [
      (this.config.seed + 5000 + this.generation) % 999999,
      (this.config.seed + 9000 + this.generation) % 999999,
    ];
    const base = seeds.map((seed) => trial(this.macros, seed));
    const before = base.reduce((n, s) => n + s.best.fitness, 0) / base.length;
    let chosen = -1,
      best = before + 0.5;
    for (const macro of proposals) {
      const variants = seeds.map((seed) =>
          trial([...this.macros, macro], seed),
        ),
        after =
          variants.reduce((n, s) => n + s.best.fitness, 0) / variants.length,
        used = variants.filter((s) =>
          activeGenes(s.best.program).some(
            (i) => s.best.program.genes[i].op === macro.name,
          ),
        ).length;
      this.inventions.push({
        generation: this.generation,
        macro,
        before,
        after,
        used,
        accepted: false,
        rollouts: variants.reduce((n, s) => n + s.rollouts, 0),
      });
      if (used === variants.length && after > best) {
        best = after;
        chosen = this.inventions.length - 1;
      }
    }
    if (chosen >= 0) {
      const m = this.inventions[chosen];
      m.accepted = true;
      this.macros.push(m.macro);
    }
  }
  private parent() {
    let pool = this.population;
    const cases = this.terrains.map((_, i) => i);
    while (cases.length && pool.length > 1) {
      const j = this.rng.int(cases.length),
        k = cases.splice(j, 1)[0],
        best = Math.max(...pool.map((c) => c.scores[k]));
      pool = pool.filter((c) => c.scores[k] >= best - 8);
    }
    return this.rng.pick(pool).program;
  }
  step() {
    if (this.generation >= this.config.generations) return this.snapshot();
    const start = performance.now();
    const elites = this.population.slice(
        0,
        Math.max(5, Math.floor(this.config.population * 0.25)),
      ),
      next = this.population.slice(
        0,
        Math.max(3, Math.floor(this.config.population * 0.1)),
      ),
      batch: { decisions: Decision[]; reward: number }[] = [];
    while (next.length < this.config.population) {
      let program: Program,
        decisions: Decision[] = [];
      const mode = this.rng.next();
      if (elites.length && mode < 0.68)
        program = this.mutate(
          this.rng.next() < 0.65
            ? this.parent()
            : this.rng.pick(elites).program,
        );
      else if (elites.length && mode < 0.81)
        program = this.crossover(this.parent(), this.parent());
      else ({ program, decisions } = this.fresh());
      const c = evaluate(program, this.terrains);
      next.push(c);
      this.rollouts += this.terrains.length;
      if (decisions.length) batch.push({ decisions, reward: c.fitness });
    }
    if (this.config.neural) this.prior.update(batch);
    this.population = next.sort((a, b) => b.fitness - a.fitness);
    this.generation++;
    const best = this.population[0];
    if (!this.initial) this.initial = structuredClone(best);
    this.history.push({
      generation: this.generation,
      best: best.fitness,
      mean: next.reduce((n, c) => n + c.fitness, 0) / next.length,
      success: best.success,
      nodes: best.nodes,
      diversity:
        new Set(next.map((c) => Math.round(c.fitness * 100))).size /
        next.length,
    });
    if (
      this.generation === 1 ||
      this.generation % 10 === 0 ||
      this.generation === this.config.generations
    )
      this.checkpoints.push({
        generation: this.generation,
        candidate: structuredClone(best),
      });
    this.archive.push(
      ...next
        .filter((c) => c.fitness > 20 && c.nodes >= 3)
        .slice(0, 3)
        .map((c) => structuredClone(c.program)),
    );
    this.archive = this.archive.slice(-36);
    if (this.config.evolveDSL && [20, 40].includes(this.generation))
      this.discover();
    this.elapsedMs += performance.now() - start;
    return this.snapshot();
  }
  snapshot(): Snapshot {
    return {
      config: this.config,
      generation: this.generation,
      best: this.population[0],
      initial: this.initial ?? this.population[0],
      history: [...this.history],
      checkpoints: [...this.checkpoints],
      macros: [...this.macros],
      inventions: [...this.inventions],
      rollouts: this.rollouts,
      discoveryRollouts: this.discoveryRollouts,
      elapsedMs: this.elapsedMs,
    };
  }
}
