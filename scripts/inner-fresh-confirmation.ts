import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inputs, makeTasks } from "../src/dsl/tasks";
import { compile, paths, at } from "../src/dsl/expressions";
import type { Expr, Macro } from "../src/dsl/types";
import { inverseSearch } from "../src/joint/inverse";

const folder = "output/joint/inner-fresh-confirmation-v1";
mkdirSync(folder, { recursive: true });
const hash = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
const read = (p: string) =>
  JSON.parse(
    p.endsWith(".gz")
      ? gunzipSync(readFileSync(p)).toString()
      : readFileSync(p, "utf8"),
  );
const policy = read("output/joint/neural/policy.json");
const languages: { name: string; macros: Macro[] }[] = [
  { name: "base", macros: [] },
  {
    name: "pilot-v4",
    macros: read("output/joint/inverse-language-pilot-v4.json").candidate
      .macros,
  },
  {
    name: "replication-7",
    macros: read("output/joint/replication-v1/seed-7.json.gz").candidate.macros,
  },
];
const settings = {
  diverseBeam: true,
  affineDifferences: 32,
  maxNodes: 96,
  semanticRank: 2,
  affineFits: 512,
  fitDedup: true,
  primitiveDifferences: true,
  macroForward: 48,
  macroBindings: 8,
};
const variants = [
  { name: "original", options: {} },
  {
    name: "local6-lattice",
    options: { localAffineNeighbors: 6, lattice: true },
  },
];
const sourceFiles = [
  "scripts/inner-fresh-confirmation.ts",
  ...readdirSync("src/joint")
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))
    .map((p) => `src/joint/${p}`),
  "src/dsl/tasks.ts",
  "src/dsl/expressions.ts",
  "src/dsl/types.ts",
  "src/engine/random.ts",
  "src/engine/language.ts",
];
const protocol = {
  version: "inner-fresh-confirmation-v1",
  seed: 41492721,
  tasks: 500,
  reps: [0, 7],
  budget: 512,
  observations: 75,
  settings,
  variants,
  languages,
  developmentReportHash: hash(
    readFileSync("output/joint/inner-fresh-development-v1/analysis.json"),
  ),
  developmentTasksHash: hash(
    readFileSync("output/joint/inner-fresh-development-v1/tasks.json.gz"),
  ),
  policyHash: hash(JSON.stringify(policy)),
  sourceHashes: Object.fromEntries(
    sourceFiles.map((p) => [p, hash(readFileSync(p))]),
  ),
  note: "Fresh confirmation of the one variant selected on inner-fresh-development-v1. 500 new functions, two paired optimizer seeds, same three frozen languages. No further algorithm or language selection from these outcomes. Confirm inner improvement if the task-cluster 95% lower bound for balanced work-AUC gain is above zero, every structural-group mean gain is positive, and mean gain is positive for each frozen language. This tests a synthesis heuristic, not newly evolved DSLs. Counts are matched; extra point arithmetic and observational wall are separate. Nested/longer functions are fresh but their families were inspected during algorithm development.",
};
const protocolHash = hash(JSON.stringify(protocol));
if (existsSync(`${folder}/protocol.json`)) {
  if (read(`${folder}/protocol.json`).protocolHash !== protocolHash)
    throw new Error("Protocol changed");
} else
  writeFileSync(
    `${folder}/protocol.json`,
    JSON.stringify({ ...protocol, protocolHash }, null, 2),
  );
const probes = inputs(903141, 97, 7),
  excluded = new Set<string>();
const excludeTree = (tree: Expr, macros: Macro[] = []) => {
  const f = compile(tree, macros);
  excluded.add(probes.map((p) => f(...p).toFixed(6)).join(","));
};
const prior = read("output/joint/neural/data.json.gz");
for (const { tree } of prior.programs)
  for (const path of paths(tree))
    excludeTree(at(tree, path), prior.library ?? []);
for (const tree of read("output/joint/neural-visited-v2/data.json.gz")
  .exposureTrees)
  excludeTree(tree);
for (let v = 1; v <= 4; v++)
  for (const sig of Object.values(
    read(`output/joint/inverse-language-pilot-v${v}.json`).splitSignatures,
  ).flat() as string[])
    excluded.add(sig);
for (const suite of [
  makeTasks(
    { training: 160, development: 40, confirmation: 20, testing: 20 },
    { seed: 31092026 },
  ),
  makeTasks(
    { training: 10, development: 10, confirmation: 10, testing: 50 },
    { seed: 59377215 },
  ),
])
  for (const t of Object.values(suite).flat()) excluded.add(t.signature);
for (const source of [
  "replication-v1",
  "language-value-prospective-v1",
  "selective-evolution-v1",
])
  for (const name of readdirSync(`output/joint/${source}`).filter((p) =>
    /^seed-.*\.json\.gz$/.test(p),
  )) {
    const row = read(`output/joint/${source}/${name}`);
    for (const sig of [
      ...row.trainingSignatures,
      ...(row.splitSignatures
        ? Object.values(row.splitSignatures).flat()
        : [...row.screenSignatures, ...row.confirmationSignatures]),
    ] as string[])
      excluded.add(sig);
  }
for (const task of read("output/joint/inner-fresh-development-v1/tasks.json.gz")
  .tasks)
  excluded.add(task.signature);
const tasks = makeTasks(
  { training: 5, development: 5, confirmation: 5, testing: 500 },
  {
    seed: protocol.seed,
    exclude: excluded,
    prefix: "fresh-inner-confirmation",
    additionalExamples: { count: 50, range: 5 },
  },
).testing;
writeFileSync(
  `${folder}/tasks.json.gz`,
  gzipSync(JSON.stringify({ excludedSignatures: excluded.size, tasks })),
);
const groups = [...new Set(tasks.map((t) => t.group))];
for (const variant of variants)
  for (const language of languages) {
    const dest = `${folder}/${variant.name}-${language.name}.json.gz`;
    if (existsSync(dest)) continue;
    const trials = tasks.flatMap((task, i) =>
      protocol.reps.map((seed) => ({
        task: task.id,
        group: task.group,
        seed,
        result: inverseSearch(
          task,
          language.macros,
          policy,
          seed + i * 97,
          protocol.budget,
          { ...settings, ...variant.options },
        ),
      })),
    );
    const byGroup = Object.fromEntries(
      groups.map((group) => {
        const rows = trials.filter((t) => t.group === group);
        return [
          group,
          {
            trials: rows.length,
            solved: rows.filter((t) => t.result.solved).length,
            fitted: rows.filter((t) => t.result.trainError < 1e-8).length,
            auc:
              rows.reduce(
                (s, t) =>
                  s +
                  (t.result.solved
                    ? 1 -
                      t.result.work /
                        (t.result.budget + t.result.expansionBudget)
                    : 0),
                0,
              ) / rows.length,
          },
        ];
      }),
    );
    const summary = {
      variant: variant.name,
      language: language.name,
      solved: trials.filter((t) => t.result.solved).length,
      work: trials.reduce((s, t) => s + t.result.work, 0),
      wallMs: trials.reduce((s, t) => s + t.result.elapsedMs, 0),
      constraintPoints: trials.reduce(
        (s, t) => s + t.result.constraintPoints,
        0,
      ),
      criticPredictions: trials.reduce(
        (s, t) => s + t.result.holeValuePredictions,
        0,
      ),
      criticTreeComparisons: trials.reduce(
        (s, t) => s + t.result.holeValueTreeComparisons,
        0,
      ),
      byGroup,
      balancedAuc:
        Object.values(byGroup).reduce((s, g) => s + g.auc, 0) / groups.length,
    };
    writeFileSync(
      dest,
      gzipSync(JSON.stringify({ protocolHash, summary, trials })),
    );
    console.log(summary);
  }
