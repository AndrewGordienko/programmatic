import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeTasks } from "../src/dsl/tasks";
import { inverseSearch } from "../src/joint/inverse";
import type { JointPolicy } from "../src/joint/policy";
const envelope = process.argv.includes("--envelope"),
  version = envelope ? "join-calibration-v2" : "join-calibration-v1";
const out = `output/joint/${version}.json`;
if (existsSync(out)) throw new Error("Preserve calibration");
const policy: JointPolicy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v2.json", "utf8"),
).candidate.macros;
const suite = makeTasks(
  { training: 160, development: 40, confirmation: 20, testing: 20 },
  { seed: 31092026, prefix: "semantic-calibration" },
);
const diagnostic = makeTasks(
  { training: 10, development: 10, confirmation: 10, testing: 50 },
  { seed: 59377215, prefix: "composition-calibration" },
).testing;
const tasks = [...suite.training.slice(100), ...diagnostic];
const settings = {
  diverseBeam: true,
  affineDifferences: 32,
  maxNodes: 96,
  affineFits: 512,
  fitDedup: true,
  primitiveDifferences: true,
  semanticRank: 2,
  ...(envelope ? { envelopePlanes: 64 } : {}),
};
const rows = tasks.flatMap((task, i) =>
  [0, 7, 42].map((seed) => ({
    task: task.id,
    group: task.group,
    seed,
    base: inverseSearch(task, [], policy, seed + i * 97, 512, settings),
    library: inverseSearch(task, library, policy, seed + i * 97, 512, settings),
    joinBase: inverseSearch(task, [], policy, seed + i * 97, 512, {
      ...settings,
      joinBudget: 1024,
    }),
    joinLibrary: inverseSearch(task, library, policy, seed + i * 97, 512, {
      ...settings,
      joinBudget: 1024,
    }),
  })),
);
const summary = Object.fromEntries(
  ["base", "library", "joinBase", "joinLibrary"].map((arm) => {
    const rs = rows.map((r) => r[arm as "base"]);
    return [
      arm,
      {
        solved: rs.filter((r) => r.solved).length,
        trials: rs.length,
        evaluations: rs.reduce((s, r) => s + r.evaluations, 0),
        expansions: rs.reduce((s, r) => s + r.expansions, 0),
        wallMs: rs.reduce((s, r) => s + r.elapsedMs, 0),
        groups: Object.fromEntries(
          [...new Set(rows.map((r) => r.group))].map((g) => [
            g,
            rows.filter((r) => r.group === g && r[arm as "base"].solved).length,
          ]),
        ),
      },
    ];
  }),
);
writeFileSync(
  out,
  JSON.stringify({
    version,
    settings,
    note: "Adaptive calibration, not final evidence. Indexed inverse search over additive prefixes with a hole. Known fragment signatures locate a possible residual; complete programs are fully evaluated and charged. All prefix/query/static-analysis operations charge the structural budget. Affine-closed banks are skipped for non-affine targets. Envelope variant proposes up to 64 affine support planes from one-sided I/O constraints; bound queries and actual candidate executions are charged.",
    summary,
    rows,
  }),
);
console.log(summary);
