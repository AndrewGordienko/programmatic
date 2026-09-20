import { mkdirSync, writeFileSync } from "node:fs";
import { OffroadSearch } from "../src/offroad/search";
import { compile, programLines } from "../src/offroad/program";
import {
  initialState,
  observe,
  step,
  transfer,
} from "../src/offroad/simulator";
import { testTerrains } from "../src/offroad/terrain";
import { CONFIG, type Program } from "../src/offroad/types";
const seeds = [0, 7, 42];
const arms = [
  { name: "Evolution · fixed DSL", neural: false, evolveDSL: false },
  { name: "Neural + evolution · fixed DSL", neural: true, evolveDSL: false },
  { name: "Evolution · evolving DSL", neural: false, evolveDSL: true },
  { name: "Neural + evolution · evolving DSL", neural: true, evolveDSL: true },
];
function blindness(p: Program) {
  let arrivals = 0,
    collisions = 0;
  for (const kind of ["woodland", "quarry", "ridge"] as const)
    for (const t of testTerrains(kind)) {
      let s = initialState(t);
      const policy = compile(p);
      while (s.status === "driving") {
        const o = observe(s, t);
        o.vectors[1].fill(1);
        s = step(s, policy(o), t);
      }
      if (s.status === "arrived") arrivals++;
      if (s.status === "collision") collisions++;
    }
  return { arrivals, collisions, count: 36 };
}
const report = {
  version: 1,
  config: CONFIG,
  seeds,
  testSeedBase: 1_900_000_000,
  budgetProtocol:
    "Identical main-search generations, population and rollout count. DSL discovery overhead is separately charged; totals are not matched.",
  arms: [] as unknown[],
};
mkdirSync("output/offroad", { recursive: true });
for (const arm of arms) {
  const runs = [];
  for (const seed of seeds) {
    const search = new OffroadSearch({ ...CONFIG, ...arm, seed });
    for (let g = 0; g < CONFIG.generations; g++) search.step();
    const s = search.snapshot(),
      results = transfer(s.best.program);
    const run = {
      seed,
      arrivals: results.reduce(
        (n, r) => n + Math.round(r.success * r.count),
        0,
      ),
      count: 36,
      collisions: results.reduce((n, r) => n + r.collisions, 0),
      instabilities: results.reduce((n, r) => n + r.instabilities, 0),
      trainingRollouts: s.rollouts,
      discoveryRollouts: s.discoveryRollouts,
      seconds: s.elapsedMs / 1000,
      macros: s.macros.length,
      trainingArrivals: Math.round(s.best.success * s.config.worlds),
      blindObstacleSensors: blindness(s.best.program),
      results,
      program: s.best.program,
      code: programLines(s.best.program),
      inventions: s.inventions,
    };
    runs.push(run);
    writeFileSync(
      `output/offroad/seed-${seed}-neural-${arm.neural}-dsl-${arm.evolveDSL}.json`,
      JSON.stringify(s),
    );
    console.log(
      JSON.stringify({
        arm: arm.name,
        ...run,
        program: undefined,
        code: undefined,
        inventions: undefined,
        results: undefined,
      }),
    );
    if (seed === 42 && arm.neural && arm.evolveDSL)
      writeFileSync("public/offroad-reference.json", JSON.stringify(s));
  }
  report.arms.push({ ...arm, runs });
}
writeFileSync("public/offroad-benchmark.json", JSON.stringify(report));
writeFileSync("output/offroad-benchmark.json", JSON.stringify(report, null, 2));
