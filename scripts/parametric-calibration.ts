import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { parametricSearch } from "../src/joint/parametric-search";
import type { JointPolicy } from "../src/joint/policy";
const compound = process.argv.includes("--compound"),
  large = process.argv.includes("--large");
const out = `output/joint/parametric-calibration-v${large ? 3 : compound ? 2 : 1}.json`;
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v3.json", "utf8"),
).candidate.macros;
const tasks = makeTasks(
  { training: 10, development: 10, confirmation: 10, testing: 50 },
  {
    seed: 59377215,
    prefix: "composition-calibration",
    additionalExamples: { count: 50, range: 5 },
  },
).testing;
const rows: {
  task: string;
  group: string;
  base: ReturnType<typeof parametricSearch>;
  library: ReturnType<typeof parametricSearch>;
}[] = [];
for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i],
    seed = 42 + i * 97;
  const row = {
    task: task.id,
    group: task.group,
    base: parametricSearch(task, [], policy, seed, large ? 8192 : 2048, {
      compoundEdits: compound || large,
    }),
    library: parametricSearch(
      task,
      library,
      policy,
      seed,
      large ? 8192 : 2048,
      { compoundEdits: compound || large },
    ),
  };
  rows.push(row);
  if (i % 10 === 9)
    console.log(
      i + 1,
      rows.filter((r) => r.base.solved).length,
      rows.filter((r) => r.library.solved).length,
    );
}
const summary = Object.fromEntries(
  ["base", "library"].map((arm) => [
    arm,
    {
      solved: rows.filter((r) => r[arm as "base"].solved).length,
      wallMs: rows.reduce((s, r) => s + r[arm as "base"].elapsedMs, 0),
      groups: Object.fromEntries(
        [...new Set(rows.map((r) => r.group))].map((g) => [
          g,
          rows.filter((r) => r.group === g && r[arm as "base"].solved).length,
        ]),
      ),
    },
  ]),
);
writeFileSync(
  out,
  JSON.stringify({
    note: `Adaptive calibration, not final evidence. Generic production mutations with joint integer affine-hole fitting. Every floating/rounded fitting execution counts against ${large ? 8192 : 2048} candidate budget; derivative/linear algebra work and wall time are separate. Both languages receive the same 75 observations. Compound edits: ${compound || large}.`,
    summary,
    rows,
  }),
);
console.log(summary);
