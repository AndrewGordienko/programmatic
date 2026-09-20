import { writeFileSync } from "node:fs";
import { OffroadSearch } from "../src/offroad/search";
import { CONFIG } from "../src/offroad/types";
import { programLines } from "../src/offroad/program";
import { transfer } from "../src/offroad/simulator";
const search = new OffroadSearch(CONFIG);
for (let i = 0; i < CONFIG.generations; i++) {
  const s = search.step();
  if (i % 10 === 0 || i === CONFIG.generations - 1)
    console.log(
      JSON.stringify({
        generation: s.generation,
        fitness: s.best.fitness,
        success: s.best.success,
        collisions: s.best.collisions,
        nodes: s.best.nodes,
        seconds: s.elapsedMs / 1000,
        macros: s.macros.length,
      }),
    );
}
const snapshot = search.snapshot();
writeFileSync("public/offroad-reference.json", JSON.stringify(snapshot));
console.log(programLines(snapshot.best.program).join("\n"));
console.log(
  JSON.stringify(
    {
      inventions: snapshot.inventions,
      transfer: transfer(snapshot.best.program),
    },
    null,
    2,
  ),
);
