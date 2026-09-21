import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const folder = "output/joint/downstream-stream-v1";
const read = (p: string) =>
  JSON.parse(
    p.endsWith(".gz")
      ? gunzipSync(readFileSync(p)).toString()
      : readFileSync(p, "utf8"),
  );
const protocol = read(`${folder}/protocol.json`),
  seal = read(`${folder}/sealed.json`);
const source = read(
  "output/joint/selective-evolution-v1/seed-211-value.json.gz",
);
if (
  createHash("sha256")
    .update(
      readFileSync(
        "output/joint/selective-evolution-v1/seed-211-value.json.gz",
      ),
    )
    .digest("hex") !== protocol.sourceHash
)
  throw new Error("Source changed");
const discoveryWork =
  source.cost.incrementalEvaluations + source.cost.incrementalExpansions;
const sourceValueWork =
  source.cost.sourceValueInvestment.recordedSourceDiscoveryWork;
type Result = {
  solved: boolean;
  evaluations: number;
  expansions: number;
  work: number;
  elapsedMs: number;
  constraintPoints: number;
  trainError: number;
};
type Row = {
  index: number;
  signature: string;
  group: string;
  result: { base: Result; learned: Result };
};
const rows: Row[] = [];
let batches = 0;
for (const b of seal.batches) {
  const p = `${folder}/batch-${b.batch}.json.gz`;
  if (!existsSync(p)) break;
  const r = read(p);
  if (r.protocolHash !== protocol.protocolHash || r.batch !== b.batch)
    throw new Error("Protocol mismatch");
  rows.push(...r.trials);
  batches++;
}
const seen = new Set<string>();
const timingAnomalies: { index: number; arm: string; elapsedMs: number }[] = [];
const totals = {
  base: {
    work: 0,
    evaluations: 0,
    expansions: 0,
    wallMs: 0,
    solved: 0,
    points: 0,
  },
  learned: {
    work: 0,
    evaluations: 0,
    expansions: 0,
    wallMs: 0,
    solved: 0,
    points: 0,
  },
};
let firstWorkCrossing: number | null = null,
  firstWallCrossing: number | null = null,
  firstIncludingValueCrossing: number | null = null;
const curve = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.index !== i || seen.has(r.signature))
    throw new Error("Order or empirical function repetition");
  seen.add(r.signature);
  for (const arm of ["base", "learned"] as const) {
    const t = totals[arm],
      x = r.result[arm];
    if (x.elapsedMs > 60000)
      timingAnomalies.push({ index: r.index, arm, elapsedMs: x.elapsedMs });
    if (
      x.evaluations > protocol.config.budget ||
      x.expansions > protocol.config.budget * 8 ||
      x.work !== x.evaluations + x.expansions
    )
      throw new Error("Budget/accounting mismatch");
    t.work += x.work;
    t.evaluations += x.evaluations;
    t.expansions += x.expansions;
    t.wallMs += x.elapsedMs;
    t.solved += Number(x.solved);
    t.points += x.constraintPoints;
  }
  const netWork = totals.base.work - totals.learned.work - discoveryWork;
  const netWall =
    totals.base.wallMs - totals.learned.wallMs - source.cost.discoveryWallMs;
  if (netWork >= 0 && firstWorkCrossing === null) firstWorkCrossing = i + 1;
  if (netWall >= 0 && firstWallCrossing === null) firstWallCrossing = i + 1;
  if (netWork >= sourceValueWork && firstIncludingValueCrossing === null)
    firstIncludingValueCrossing = i + 1;
  if ((i + 1) % 100 === 0 || i === rows.length - 1)
    curve.push({
      tasks: i + 1,
      baseWork: totals.base.work,
      learnedWorkIncludingDiscovery: totals.learned.work + discoveryWork,
      learnedWorkIncludingValueInvestment:
        totals.learned.work + discoveryWork + sourceValueWork,
      netWork,
      baseWallMs: totals.base.wallMs,
      learnedWallMsIncludingDiscovery:
        totals.learned.wallMs + source.cost.discoveryWallMs,
      netWall,
    });
}
const complete = batches === seal.batches.length;
const groups = [...new Set(rows.map((r) => r.group))].map((group) => {
  const rs = rows.filter((r) => r.group === group);
  return {
    group,
    tasks: rs.length,
    baseSolved: rs.filter((r) => r.result.base.solved).length,
    learnedSolved: rs.filter((r) => r.result.learned.solved).length,
    baseFits: rs.filter((r) => r.result.base.trainError < 1e-8).length,
    learnedFits: rs.filter((r) => r.result.learned.trainError < 1e-8).length,
    workSaved: rs.reduce(
      (s, r) => s + r.result.base.work - r.result.learned.work,
      0,
    ),
  };
});
const report = {
  protocolHash: protocol.protocolHash,
  complete,
  batches,
  plannedBatches: seal.batches.length,
  tasks: rows.length,
  uniqueEmpiricalFunctions: seen.size,
  totals,
  groups,
  discovery: {
    work: discoveryWork,
    evaluations: source.cost.incrementalEvaluations,
    expansions: source.cost.incrementalExpansions,
    wallMs: source.cost.discoveryWallMs,
    sharedValueSourceWork: sourceValueWork,
    sharedValueTrainingMs: source.cost.sourceValueInvestment.training.elapsedMs,
    note: "Incremental language cost includes wake synthesis, selection, confirmation. Value-model source labels/fitting and shared inner-policy pretraining remain additional; prior cost cancels only in the matched-prior comparison. Earlier R&D is not fully priced.",
  },
  firstWorkCrossing,
  firstWallCrossing: timingAnomalies.length ? null : firstWallCrossing,
  rawFirstWallCrossing: firstWallCrossing,
  timingAnomalies,
  wallPaybackAssessable: timingAnomalies.length === 0,
  firstIncludingValueCrossing,
  netWorkAtCurrentEnd: totals.base.work - totals.learned.work - discoveryWork,
  netWallMsAtCurrentEnd:
    totals.base.wallMs - totals.learned.wallMs - source.cost.discoveryWallMs,
  curve,
  note: "One preselected frozen language, 20,000 sealed empirically distinct functions, fixed horizon. Observed incremental payback is conditional on the pretrained value model already existing. It does not repay all historical research or shared model costs. A first crossing may be transient: inspect end balance and full curve. Program proposals, structural operations, point comparisons and wall are distinct metrics; no claim of fewer proposals follows from lower aggregate work. Raw wall measurements are retained, including an unexplained >52M-ms elapsed-time jump on one base trial. Wall payback is unassessable from this run; no rows are discarded or winsorized to manufacture a timing result. Some later batches also share the host with independent confirmation work.",
};
writeFileSync(`${folder}/analysis.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, curve: undefined }, null, 2));
