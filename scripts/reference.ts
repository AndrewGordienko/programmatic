import { writeFileSync } from "node:fs";
import { Search } from "../src/engine/search";
import { DEFAULT_CONFIG } from "../src/engine/types";
import { programLines } from "../src/engine/program";
import { transferTest } from "../src/engine/simulator";
const search = new Search(DEFAULT_CONFIG);
for (let i = 0; i < DEFAULT_CONFIG.generations; i++) search.step();
const snapshot = search.snapshot();
writeFileSync("public/reference-run.json", JSON.stringify(snapshot));
console.log(
  JSON.stringify(
    {
      fitness: snapshot.best.fitness,
      success: snapshot.best.success,
      nodes: snapshot.best.activeNodes,
      ms: snapshot.elapsedMs,
      history: snapshot.history.map((h) => Number(h.best.toFixed(1))),
      code: programLines(snapshot.best.program),
      transfer: transferTest(snapshot.best.program).map((t) => ({
        family: t.family,
        success: t.success,
      })),
    },
    null,
    2,
  ),
);
