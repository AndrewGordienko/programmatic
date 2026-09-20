import { writeFileSync } from "node:fs";
import { evolveLanguage } from "../src/engine/language";
const generator = evolveLanguage(42);
let step = generator.next();
while (!step.done) {
  console.log(step.value.phase);
  step = generator.next();
}
writeFileSync("public/language-reference.json", JSON.stringify(step.value));
console.log(
  JSON.stringify(
    {
      macros: step.value.macros.map((m) => m.definition),
      fixed: step.value.trials.filter((t) => t.fixed.solved).length,
      evolved: step.value.trials.filter((t) => t.evolved.solved).length,
      discovery: step.value.discoveryEvaluations,
      comparison: step.value.comparisonEvaluations,
      ms: step.value.elapsedMs,
    },
    null,
    2,
  ),
);
