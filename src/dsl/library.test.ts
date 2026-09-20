import assert from "node:assert/strict";
import test from "node:test";
import { compile, exprSize, rewrite, validLibrary } from "./expressions";
import { experiment, pairedGain } from "./experiment";
import { comparison } from "./metrics";
import { mine } from "./mining";
import { distribution, fitPrior } from "./prior";
import { synthesize } from "./search";
import { makeTasks } from "./tasks";
import { BASE, DEFAULT, type Expr, type Macro, type Task } from "./types";
import { fitValue, predictValue } from "./value";
const a: Expr = { op: "arg", value: 0, args: [] },
  b: Expr = { op: "arg", value: 1, args: [] },
  zero: Expr = { op: "const", value: 0, args: [] };
const macro: Macro = {
  name: "fn_1",
  arity: 1,
  body: { op: "max", args: [a, zero] },
  size: 3,
  support: 2,
  sourceTasks: ["a", "b"],
  definition: "fn_1(a) = max(a, 0)",
};

test("800-task protocol is deterministic, empirically disjoint, and structurally withholds nested/longer tasks", () => {
  const suite = makeTasks(DEFAULT),
    again = makeTasks(DEFAULT);
  assert.deepEqual(suite, again);
  const all = Object.values(suite).flat();
  assert.equal(all.length, 800);
  assert.equal(new Set(all.map((t) => t.signature)).size, 800);
  assert.ok(
    [...suite.training, ...suite.development, ...suite.confirmation].every(
      (t) => t.group === "Related compositions",
    ),
  );
  assert.equal(
    suite.testing.filter((t) => t.group === "Nested compositions").length,
    40,
  );
  assert.equal(
    suite.testing.filter((t) => t.group === "Longer expressions").length,
    40,
  );
  assert.ok(
    all.every(
      (t) =>
        !("tree" in t) &&
        !("target" in t) &&
        t.examples.length === 25 &&
        t.checks.length === 65,
    ),
  );
});
test("library definitions are bounded base expressions; refactoring preserves arbitrary expression arguments", () => {
  assert.ok(validLibrary([macro]));
  assert.equal(
    validLibrary([{ ...macro, body: { op: "fn_1", args: [a] } }]),
    false,
  );
  const tree: Expr = { op: "max", args: [{ op: "sub", args: [a, b] }, zero] },
    short = rewrite(tree, [macro]);
  assert.equal(short.op, "fn_1");
  assert.ok(exprSize(short) < exprSize(tree));
  const f = compile(tree, []),
    g = compile(short, [macro]);
  for (let x = -3; x <= 3; x += 0.3)
    for (let y = -2; y <= 2; y += 0.4) assert.equal(f(x, y), g(x, y));
});
test("mining uses synthesized corpus patterns and charges actual compression", () => {
  const tasks = makeTasks({
    training: 4,
    development: 4,
    confirmation: 4,
    testing: 4,
  }).training;
  const corpus = tasks.map(
    (task, i) =>
      ({
        task,
        tree: {
          op: "add",
          args: [
            { op: "max", args: [i % 2 ? a : b, zero] },
            { op: "max", args: [{ op: "sub", args: [a, b] }, zero] },
          ],
        },
      }) as { task: Task; tree: Expr },
  );
  const found = mine(corpus, []);
  assert.ok(found.length > 0);
  assert.ok(
    found.every(
      (p) =>
        p.compression > 0 && p.macro.support >= 2 && validLibrary([p.macro]),
    ),
  );
  assert.ok(
    found.some((p) => p.macro.body.op === "max" && p.macro.arity === 1),
  );
});
test("search is reproducible and independent validation cannot steer the discovered program", () => {
  const task = makeTasks({
    training: 4,
    development: 4,
    confirmation: 4,
    testing: 4,
  }).training[0];
  const first = synthesize(task, [], undefined, 71, 128),
    second = synthesize(task, [], undefined, 71, 128);
  assert.deepEqual({ ...first, elapsedMs: 0 }, { ...second, elapsedMs: 0 });
  const changed = synthesize(
    {
      ...task,
      checks: task.checks.map((e) => ({ ...e, output: e.output + 999 })),
    },
    [],
    undefined,
    71,
    128,
  );
  assert.deepEqual(first.tree, changed.tree);
  assert.equal(first.evaluations, changed.evaluations);
  assert.equal(changed.solved, false);
  assert.equal(changed.effort, 128);
  assert.ok(
    first.nodes <= 31 && first.expandedNodes <= 96 && first.evaluations <= 128,
  );
});
test("neural prior trains only from corpus/dream I/O and remains normalized when macros are removed", () => {
  const task = makeTasks({
    training: 4,
    development: 4,
    confirmation: 4,
    testing: 4,
  }).training[0];
  const p = fitPrior([{ task, tree: macro.body }], [macro], 42),
    ops = [...BASE, "fn_1"];
  const full = distribution(p, task.examples, ops),
    masked = distribution(p, task.examples, BASE);
  assert.ok(Math.abs(full.reduce((s, n) => s + n, 0) - 1) < 1e-9);
  assert.ok(Math.abs(masked.reduce((s, n) => s + n, 0) - 1) < 1e-9);
  assert.ok(full.every((n) => n > 0));
  assert.notDeepEqual(
    full,
    ops.map(() => 1 / ops.length),
  );
});
test("nested experiment counts actual calls, freezes paired arms, and censors failed solves", () => {
  const config = {
    ...DEFAULT,
    rounds: 1,
    training: 4,
    development: 4,
    confirmation: 4,
    testing: 4,
    replicates: 2,
    wakeBudget: 64,
    screenBudget: 32,
    developmentBudget: 32,
    confirmationBudget: 64,
    finalBudget: 64,
    shortlist: 2,
    finalists: 1,
  };
  const g = experiment(config);
  let n = g.next();
  while (!n.done) n = g.next();
  const r = n.value;
  assert.ok(r.completed);
  assert.equal(r.trials.length, 32);
  assert.equal(
    r.budget.final,
    r.trials.reduce((s, t) => s + t.solution.evaluations, 0),
  );
  assert.ok(r.trials.every((t) => t.solution.budget === 64));
  for (const id of r.splits.testing) {
    const ts = r.trials.filter((t) => t.task === id);
    assert.equal(new Set(ts.map((t) => t.seed)).size, 2);
    assert.ok(!r.corpus.some((c) => c.task === id));
  }
  const metric = comparison(r);
  assert.ok(metric.discovery > 0);
  if (metric.saving <= 0) assert.equal(metric.breakEven, null);
  const trials = r.trials.slice(0, 4).map((t) => t.solution);
  assert.equal(pairedGain(trials, trials, 2).mean, 0);
});
test("outer value model learns a bounded linear ranking from training records alone", () => {
  const data = Array.from({ length: 30 }, (_, i) => ({
    x: [i, i % 3],
    y: 2 * i - (i % 3),
  }));
  const m = fitValue(data, 0.001);
  assert.ok(Math.abs(predictValue(m, [35, 2]) - 68) < 0.1);
  assert.ok(predictValue(m, [10, 0]) > predictValue(m, [9, 2]));
  assert.throws(() => fitValue([]));
});
