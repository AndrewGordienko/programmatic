import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Random } from "../src/engine/random";
import { inputs, makeTasks } from "../src/dsl/tasks";
import { compile, paths, at } from "../src/dsl/expressions";
import { inverseSearch } from "../src/joint/inverse";
import type { Task } from "../src/dsl/types";

const folder = "output/joint/downstream-stream-v1";
mkdirSync(folder, { recursive: true });
const hash = (x: Buffer | string) =>
  createHash("sha256").update(x).digest("hex");
const read = (p: string) =>
  JSON.parse(
    p.endsWith(".gz")
      ? gunzipSync(readFileSync(p)).toString()
      : readFileSync(p, "utf8"),
  );
const sourcePath = "output/joint/selective-evolution-v1/seed-211-value.json.gz";
const source = read(sourcePath),
  oldProtocol = read("output/joint/selective-evolution-v1/protocol.json");
if (!source.accepted)
  throw new Error("Preselected first meta-run was not accepted");
for (const [p, digest] of Object.entries(oldProtocol.sourceHashes))
  if (p.startsWith("src/") && hash(readFileSync(p)) !== digest)
    throw new Error(`Frozen engine mismatch ${p}`);
const policy = read("output/joint/neural/policy.json");
if (
  hash(readFileSync("output/joint/neural/policy.json")) !==
  oldProtocol.policyHash
)
  throw new Error("Policy changed");
const config = {
  seed: 71942026,
  batches: 40,
  tasksPerBatch: 500,
  budget: 512,
  observations: 75,
  librarySeed: 211,
  search: oldProtocol.config.search,
};
const protocol = {
  version: "downstream-stream-v1",
  config,
  sourceHash: hash(readFileSync(sourcePath)),
  sourceFrozenHash: source.frozenHash,
  sourcePolicyHash: oldProtocol.policyHash,
  sourceHashes: oldProtocol.sourceHashes,
  runnerHash: hash(readFileSync("scripts/downstream-stream.ts")),
  note: "Predeclared 20,000-task downstream stream for the FIRST selective/value meta-run (211), not the best observed run. Freeze the accepted language, prior and original solver. Seal all task batches before synthesis. Both arms share tasks, seeds and budgets; arm execution order alternates. Functions are empirically distinct across the stream and excluded from prior exposure and all historical discovery/confirmation/test suites. Fixed 40-batch horizon; never stop at a favorable crossing. Measure incremental language-discovery payback separately from the additional 455.4M-work shared value-training investment, shared inner-policy pretraining and historical R&D. This is one conditional downstream demonstration, not multi-language replication. Structural work, complete executions, point arithmetic and observational wall are separate.",
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

if (!existsSync(`${folder}/sealed.json`)) {
  const excluded = new Set<string>(),
    probes = inputs(903141, 97, 7);
  const data = read("output/joint/neural/data.json.gz");
  for (const { tree } of data.programs)
    for (const path of paths(tree)) {
      const f = compile(at(tree, path), data.library ?? []);
      excluded.add(probes.map((p) => f(...p).toFixed(6)).join(","));
    }
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
  for (const name of [
    "replication-v1",
    "language-value-prospective-v1",
    "selective-evolution-v1",
  ])
    for (const file of readdirSync(`output/joint/${name}`).filter((p) =>
      /^seed-.*\.json\.gz$/.test(p),
    )) {
      const r = read(`output/joint/${name}/${file}`);
      for (const sig of [
        ...r.trainingSignatures,
        ...(r.splitSignatures
          ? Object.values(r.splitSignatures).flat()
          : [...r.screenSignatures, ...r.confirmationSignatures]),
      ] as string[])
        excluded.add(sig);
    }
  const initialExcluded = excluded.size,
    batches = [];
  for (let batch = 0; batch < config.batches; batch++) {
    const suite = makeTasks(
      {
        training: 1,
        development: 1,
        confirmation: 1,
        testing: config.tasksPerBatch,
      },
      {
        seed: config.seed + batch * 100003,
        exclude: excluded,
        prefix: `stream-${batch}`,
        additionalExamples: { count: 50, range: 5 },
      },
    );
    for (const t of Object.values(suite).flat()) excluded.add(t.signature);
    const tasks = suite.testing,
      rng = new Random(config.seed + batch * 8137);
    for (let i = tasks.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }
    const bytes = gzipSync(JSON.stringify({ protocolHash, batch, tasks }));
    writeFileSync(`${folder}/tasks-${batch}.json.gz`, bytes);
    batches.push({ batch, hash: hash(bytes), tasks: tasks.length });
  }
  writeFileSync(
    `${folder}/sealed.json`,
    JSON.stringify(
      {
        protocolHash,
        sealedAt: new Date().toISOString(),
        initialExcluded,
        finalExcluded: excluded.size,
        batches,
      },
      null,
      2,
    ),
  );
  console.log("Sealed every downstream task before synthesis");
}
if (process.argv.includes("--seal-only")) process.exit(0);
const seal = read(`${folder}/sealed.json`);
if (seal.protocolHash !== protocolHash) throw new Error("Seal mismatch");
for (const batch of seal.batches) {
  const path = `${folder}/batch-${batch.batch}.json.gz`;
  if (existsSync(path)) {
    if (read(path).protocolHash !== protocolHash)
      throw new Error("Mixed result");
    continue;
  }
  const bytes = readFileSync(`${folder}/tasks-${batch.batch}.json.gz`);
  if (hash(bytes) !== batch.hash) throw new Error("Task mutation");
  const tasks: Task[] = JSON.parse(gunzipSync(bytes).toString()).tasks;
  const started = performance.now();
  const trials = tasks.map((task, i) => {
    const index = batch.batch * config.tasksPerBatch + i,
      seed = config.seed + index * 97;
    const order = index % 2 ? [true, false] : [false, true];
    const result = Object.fromEntries(
      order.map((learned) => [
        learned ? "learned" : "base",
        inverseSearch(
          task,
          learned ? source.candidate.macros : [],
          policy,
          seed,
          config.budget,
          config.search,
        ),
      ]),
    );
    return {
      task: task.id,
      signature: task.signature,
      group: task.group,
      index,
      seed,
      result,
    };
  });
  writeFileSync(
    path,
    gzipSync(
      JSON.stringify({
        protocolHash,
        batch: batch.batch,
        startedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started,
        trials,
      }),
    ),
  );
  const solved = (arm: string) =>
    trials.filter((t) => t.result[arm].solved).length;
  console.log(
    `Batch ${batch.batch + 1}/${config.batches}: base ${solved("base")}, learned ${solved("learned")}/${tasks.length}`,
  );
}
