import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
const out = "output/joint/constraint-input-v1.json";
if (existsSync(out)) throw new Error("Preserve constraint input");
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v3.json", "utf8"),
).candidate.macros;
const diagnostic = makeTasks(
  { training: 10, development: 10, confirmation: 10, testing: 50 },
  {
    seed: 59377215,
    prefix: "composition-calibration",
    additionalExamples: { count: 50, range: 5 },
  },
).testing;
writeFileSync(
  out,
  JSON.stringify({
    library,
    tasks: [
      ...diagnostic.slice(0, 2),
      ...diagnostic.slice(30, 32),
      ...diagnostic.slice(40, 43),
    ],
  }),
);
