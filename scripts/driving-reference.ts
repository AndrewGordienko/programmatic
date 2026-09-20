import { writeFileSync } from "node:fs";
import { DrivingSearch } from "../src/driving/search";
import { DRIVE_CONFIG } from "../src/driving/types";
import { driveProgramLines } from "../src/driving/program";
import { evaluateDrivingTransfer } from "../src/driving/simulator";
const search = new DrivingSearch(DRIVE_CONFIG);
for (let i = 0; i < DRIVE_CONFIG.generations; i++) {
  const snapshot = search.step();
  if (i % 5 === 0 || i === DRIVE_CONFIG.generations - 1)
    console.log(
      JSON.stringify({
        generation: snapshot.generation,
        fitness: snapshot.best.fitness,
        success: snapshot.best.success,
        completion: snapshot.best.completion,
        speed: snapshot.best.meanSpeed,
        nodes: snapshot.best.nodes,
        ms: snapshot.elapsedMs,
      }),
    );
}
const result = search.snapshot();
writeFileSync("public/driving-reference.json", JSON.stringify(result));
console.log(driveProgramLines(result.best.program).join("\n"));
console.log(
  JSON.stringify(
    {
      macros: result.macros,
      inventions: result.inventions,
      transfer: evaluateDrivingTransfer(result.best.program),
    },
    null,
    2,
  ),
);
