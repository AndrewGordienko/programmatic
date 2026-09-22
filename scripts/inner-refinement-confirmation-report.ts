import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Random } from "../src/engine/random";
const folder = "output/joint/inner-refinement-confirmation-v1";
const read = (path: string) =>
  JSON.parse(
    path.endsWith(".gz")
      ? gunzipSync(readFileSync(path)).toString()
      : readFileSync(path, "utf8"),
  );
const protocol = read(`${folder}/protocol.json`);
type Trial = {
  task: string;
  group: string;
  seed: number;
  result: {
    solved: boolean;
    work: number;
    budget: number;
    expansionBudget: number;
  };
};
type Run = {
  protocolHash: string;
  summary: {
    variant: string;
    language: string;
    balancedAuc: number;
    solved: number;
    work: number;
    wallMs: number;
    cpuMicros: number;
    constraintPoints: number;
    criticPredictions: number;
    criticTreeComparisons: number;
    byGroup: Record<string, { solved: number; trials: number; auc: number }>;
  };
  trials: Trial[];
};
const runs: Run[] = [];
for (const v of protocol.variants)
  for (const l of protocol.languages) {
    const path = `${folder}/${v.name}-${l.name}.json.gz`;
    if (existsSync(path)) {
      const r = read(path);
      if (r.protocolHash !== protocol.protocolHash)
        throw new Error("Mixed protocol");
      runs.push(r);
    }
  }
const complete =
  runs.length === protocol.variants.length * protocol.languages.length;
const score = (r: Trial) =>
  r.result.solved
    ? 1 - r.result.work / (r.result.budget + r.result.expansionBudget)
    : 0;
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const summaries = protocol.variants.map((v: { name: string }) => {
  const rows = runs.filter((r) => r.summary.variant === v.name);
  return {
    name: v.name,
    completedLanguages: rows.length,
    balancedAuc:
      rows.length === protocol.languages.length
        ? mean(rows.map((r) => r.summary.balancedAuc))
        : null,
    solved: rows.reduce((s, r) => s + r.summary.solved, 0),
    work: rows.reduce((s, r) => s + r.summary.work, 0),
    cpuMicros: rows.reduce((s, r) => s + r.summary.cpuMicros, 0),
    wallMs: rows.reduce((s, r) => s + r.summary.wallMs, 0),
    constraintPoints: rows.reduce((s, r) => s + r.summary.constraintPoints, 0),
    criticPredictions: rows.reduce(
      (s, r) => s + r.summary.criticPredictions,
      0,
    ),
    criticTreeComparisons: rows.reduce(
      (s, r) => s + r.summary.criticTreeComparisons,
      0,
    ),
  };
});
const comparisons = [];
if (complete)
  for (const variant of protocol.variants.filter(
    (v: { name: string }) => v.name !== "original",
  )) {
    const byTask = new Map<
      string,
      { group: string; deltas: number[]; solveDeltas: number[] }
    >();
    for (const language of protocol.languages) {
      const base = runs.find(
        (r) =>
          r.summary.variant === "original" &&
          r.summary.language === language.name,
      )!;
      const next = runs.find(
        (r) =>
          r.summary.variant === variant.name &&
          r.summary.language === language.name,
      )!;
      for (let i = 0; i < base.trials.length; i++) {
        const b = base.trials[i],
          n = next.trials[i];
        if (b.task !== n.task || b.seed !== n.seed)
          throw new Error("Pair mismatch");
        const row = byTask.get(b.task) ?? {
          group: b.group,
          deltas: [],
          solveDeltas: [],
        };
        row.deltas.push(score(n) - score(b));
        row.solveDeltas.push(Number(n.result.solved) - Number(b.result.solved));
        byTask.set(b.task, row);
      }
    }
    const groups = [...new Set([...byTask.values()].map((r) => r.group))];
    const groupRows = groups.map((g) =>
      [...byTask.values()]
        .filter((r) => r.group === g)
        .map((r) => ({ auc: mean(r.deltas), solved: mean(r.solveDeltas) })),
    );
    const rng = new Random(173291);
    const draws = Array.from({ length: 3000 }, () =>
      mean(
        groupRows.map((rs) =>
          mean(
            Array.from({ length: rs.length }, () => rs[rng.int(rs.length)].auc),
          ),
        ),
      ),
    ).sort((a, b) => a - b);
    comparisons.push({
      variant: variant.name,
      balancedAucDelta: mean(groupRows.map((rs) => mean(rs.map((r) => r.auc)))),
      interval: [draws[75], draws[2924]],
      groups: groups.map((group, i) => ({
        group,
        tasks: groupRows[i].length,
        aucDelta: mean(groupRows[i].map((r) => r.auc)),
        solveDelta: mean(groupRows[i].map((r) => r.solved)),
      })),
    });
  }
const report = {
  protocolHash: protocol.protocolHash,
  complete,
  completed: runs.length,
  expected: protocol.variants.length * protocol.languages.length,
  note: "Preselected CONFIRMATION comparison. Task-cluster bootstrap retains optimizer/library correlation and stratifies by group. One new variant was fixed before these outcomes. Search work excludes separately reported critic inference; process CPU is reported separately from observational wall. Excluding all historical functions changes this finite generator's mixture, so old calibration rates are not directly comparable.",
  summaries,
  comparisons,
  confirmed: complete
    ? comparisons[0].interval[0] > 0 &&
      comparisons[0].groups.every((g) => g.aucDelta > 0) &&
      runs
        .filter((r) => r.summary.variant !== "original")
        .every(
          (r) =>
            r.summary.balancedAuc >
            runs.find(
              (b) =>
                b.summary.variant === "original" &&
                b.summary.language === r.summary.language,
            )!.summary.balancedAuc,
        )
    : null,
  runs: runs.map((r) => r.summary),
};
writeFileSync(`${folder}/analysis.json`, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      complete,
      completed: report.completed,
      confirmed: report.confirmed,
      summaries,
      comparisons,
    },
    null,
    2,
  ),
);
