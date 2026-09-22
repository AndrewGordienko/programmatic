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

const folder = "output/joint/inner-refinement-confirmation-v1";
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
const visited = read("output/joint/neural-visited-policy-v1/policy.json");
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
const developmentFolder = "output/joint/inner-refinement-development-v1";
const development = read(`${developmentFolder}/analysis.json`);
const developmentProtocol = read(`${developmentFolder}/protocol.json`);
if (
  !development.complete ||
  development.protocolHash !== developmentProtocol.protocolHash
)
  throw new Error("Complete matching development report required");
for (const [path, expected] of Object.entries(developmentProtocol.sourceHashes))
  if (hash(readFileSync(path)) !== expected)
    throw new Error(`Development source changed: ${path}`);
const selected = developmentProtocol.variants.find(
  (v: { name: string }) => v.name === development.selectedForFreshConfirmation,
);
if (!selected || selected.name === "original")
  throw new Error("No new solver selected");
const variants: {
  name: string;
  policyKind: "original" | "visited";
  options: Parameters<typeof inverseSearch>[5];
}[] = [
  developmentProtocol.variants.find(
    (v: { name: string }) => v.name === "original",
  ),
  selected,
];
const sourceFiles = [
  "scripts/inner-refinement-confirmation.ts",
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
  version: "inner-refinement-confirmation-v1",
  seed: 73492731,
  tasks: 500,
  reps: [0, 7],
  budget: 512,
  observations: 75,
  settings,
  variants,
  developmentReportHash: hash(
    readFileSync(`${developmentFolder}/analysis.json`),
  ),
  developmentTasksHash: hash(
    readFileSync(`${developmentFolder}/tasks.json.gz`),
  ),
  visitedPolicyHash: hash(JSON.stringify(visited)),
  languages,
  policyHash: hash(JSON.stringify(policy)),
  sourceHashes: Object.fromEntries(
    sourceFiles.map((p) => [p, hash(readFileSync(p))]),
  ),
  note: "Fresh confirmation of one solver selected on inner-refinement-development-v1. Five hundred new functions and two paired optimizer seeds, across the same three frozen languages. No new selection or tuning from these outcomes. Require task-cluster 95% lower bound above zero for balanced work-AUC gain, positive mean for every structural group and every library. This tests synthesis, not newly evolved languages. Process CPU, point operations and model training are separate from heterogeneous work. Historical families were inspected, final functions are fresh. Shared policy-training costs are not amortized by this comparison.",
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
  "lattice-evolution-v1",
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
for (const source of [
  "inner-fresh-development-v1",
  "inner-fresh-confirmation-v1",
  "inner-refinement-development-v1",
])
  for (const t of read(`output/joint/${source}/tasks.json.gz`).tasks)
    excluded.add(t.signature);
for (const file of readdirSync("output/joint/downstream-stream-v1").filter(
  (f) => /^tasks-.*\.json\.gz$/.test(f),
)) {
  const batch = read(`output/joint/downstream-stream-v1/${file}`);
  for (const t of batch.tasks) excluded.add(t.signature);
}
const tasks = makeTasks(
  { training: 5, development: 5, confirmation: 5, testing: 500 },
  {
    seed: protocol.seed,
    exclude: excluded,
    prefix: "inner-refinement-confirmation",
    additionalExamples: { count: 50, range: 5 },
  },
).testing;
writeFileSync(
  `${folder}/tasks.json.gz`,
  gzipSync(JSON.stringify({ excludedSignatures: excluded.size, tasks })),
);
if (process.argv.includes("--prepare-only")) process.exit(0);
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
        result: (() => {
          const start = process.cpuUsage();
          const result = inverseSearch(
            task,
            language.macros,
            variant.policyKind === "visited" ? visited : policy,
            seed + i * 97,
            protocol.budget,
            { ...settings, ...variant.options },
          );
          const cpu = process.cpuUsage(start);
          return { ...result, cpuMicros: cpu.user + cpu.system };
        })(),
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
      cpuMicros: trials.reduce((s, t) => s + t.result.cpuMicros, 0),
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
