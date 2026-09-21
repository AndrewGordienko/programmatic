import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const out = "output/joint/inverse-observation-calibration-v1.json";
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v3.json", "utf8"),
).candidate.macros;
const settings = {
  diverseBeam: true,
  affineDifferences: 32,
  maxNodes: 96,
  affineFits: 512,
  fitDedup: true,
  primitiveDifferences: true,
  semanticRank: 2,
  macroForward: 48,
  macroBindings: 8,
};
const rows = [];
for (const count of [0, 50, 150]) {
  const additionalExamples = count ? { count, range: 5 } : undefined;
  const suite = makeTasks(
    { training: 160, development: 40, confirmation: 20, testing: 20 },
    { seed: 31092026, prefix: "semantic-calibration", additionalExamples },
  );
  const diagnostic = makeTasks(
    { training: 10, development: 10, confirmation: 10, testing: 50 },
    { seed: 59377215, prefix: "composition-calibration", additionalExamples },
  ).testing;
  const tasks = [...suite.training.slice(100), ...diagnostic];
  for (const learned of [false, true]) {
    const trials = tasks.flatMap((task, i) =>
      [0, 7, 42].map((seed) => ({
        task: task.id,
        group: task.group,
        seed,
        result: inverseSearch(
          task,
          learned ? library : [],
          policy,
          seed + i * 97,
          512,
          settings,
        ),
      })),
    );
    const summary = {
      count: 25 + count,
      learned,
      solved: trials.filter((t) => t.result.solved).length,
      work: trials.reduce((s, t) => s + t.result.work, 0),
      wallMs: trials.reduce((s, t) => s + t.result.elapsedMs, 0),
      groups: Object.fromEntries(
        [...new Set(trials.map((r) => r.group))].map((g) => [
          g,
          {
            solved: trials.filter((r) => r.group === g && r.result.solved)
              .length,
            fit: trials.filter(
              (r) => r.group === g && r.result.trainError < 1e-8,
            ).length,
          },
        ]),
      ),
    };
    console.log(summary);
    rows.push({ summary, trials });
  }
}
writeFileSync(
  out,
  JSON.stringify({
    note: "Adaptive calibration with richer problem specifications: original 25 observations retained, extra independent inputs available equally to both languages; independent check outputs remain hidden. More examples are extra information and computation, not an algorithmic improvement at the original observation budget. Task functions remain the same.",
    rows,
  }),
);
