import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evalExpr } from "../src/dsl/expressions";
import type { Task, Macro, Expr } from "../src/dsl/types";
const input: { tasks: Task[]; library: Macro[] } = JSON.parse(
  readFileSync("output/joint/constraint-input-v1.json", "utf8"),
);
const report: {
  rows: {
    task: string;
    arm: string;
    result: { tree: Expr | null };
    checkError: number | null;
    solved: boolean;
  }[];
} = JSON.parse(
  readFileSync("output/joint/constraint-calibration-v1.json", "utf8"),
);
let executed = 0;
for (const row of report.rows) {
  const task = input.tasks.find((t) => t.id === row.task)!;
  if (!row.result.tree) {
    assert.equal(row.solved, false);
    continue;
  }
  const library = row.arm === "library" ? input.library : [];
  const error =
    task.checks.reduce(
      (s, e) =>
        s + Math.abs(evalExpr(row.result.tree!, e.input, library) - e.output),
      0,
    ) / task.checks.length;
  assert.ok(Math.abs(error - row.checkError!) < 1e-8);
  assert.equal(error < 1e-8, row.solved);
  for (const e of task.examples)
    assert.ok(
      Math.abs(evalExpr(row.result.tree, e.input, library) - e.output) < 1e-7,
    );
  executed++;
}
console.log({ verifiedPrograms: executed, pairedRows: report.rows.length });
