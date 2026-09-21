import test from "node:test";
import assert from "node:assert/strict";
import { inputs } from "../dsl/tasks";
import { validLibrary, evalExpr } from "../dsl/expressions";
import type { Expr, Task } from "../dsl/types";
import { context, encoder, fitJoint, hole, productions } from "./policy";
import { abstraction, genome, propose } from "./genome";
import { search } from "./search";
import { experiment, PILOT } from "./experiment";
const arg = (value: number): Expr => ({ op: "arg", value, args: [] });
const task = (f: (x: number, y: number) => number): Task => ({
  id: "test",
  group: "test",
  signature: "test",
  examples: inputs(301, 25, 3).map((input) => ({ input, output: f(...input) })),
  checks: inputs(809, 65, 5).map((input) => ({ input, output: f(...input) })),
});

test("joint search respects both caps, is deterministic and never uses checks to guide search", () => {
  const t = task((x) => x),
    a = search(t, [], undefined, 13, 64),
    b = search(t, [], undefined, 13, 64);
  const scrub = (r: typeof a) => ({ ...r, elapsedMs: 0 });
  assert.deepEqual(scrub(a), scrub(b));
  assert.equal(a.solved, true);
  const hostile = {
    ...t,
    checks: t.checks.map((e) => ({ ...e, output: 1000 })),
  };
  const c = search(hostile, [], undefined, 13, 64);
  assert.deepEqual(c.tree, a.tree);
  assert.equal(c.evaluations, a.evaluations);
  assert.equal(c.expansions, a.expansions);
  assert.equal(c.solved, false);
  for (const cap of [1, 2, 7, 64]) {
    const r = search(
      task((x, y) => x * y + 0.3719),
      [],
      undefined,
      5,
      64,
      cap,
    );
    assert.ok(r.evaluations <= 64);
    assert.ok(r.expansions <= cap);
    assert.equal(r.solved, false);
  }
});

test("operator semantics are independent of invented token names and distinguish argument roles", () => {
  const m = abstraction({
    op: "max",
    args: [arg(0), { op: "neg", args: [arg(0)] }],
  })!;
  assert.ok(m);
  const renamed = { ...m, name: "fn_991" };
  const a = productions([m]),
    b = productions([renamed]);
  assert.deepEqual(a.at(-1)!.semantic, b.at(-1)!.semantic);
  assert.notDeepEqual(a[0].semantic, a[1].semantic);
  const t = task((x) => Math.abs(x));
  const p = fitJoint([{ task: t, tree: m.body }], [], 1, undefined, {
    dreams: 8,
    epochs: 2,
  });
  const pa = encoder(p, a)(context(t.examples, hole(), [], a, [m]));
  const pb = encoder(p, b)(context(t.examples, hole(), [], b, [renamed]));
  assert.deepEqual(pa, pb);
  assert.ok(Math.abs(pa.reduce((s, n) => s + n, 0) - 1) < 1e-10);
  const otherTask = context(task((x, y) => x - y).examples, hole(), [], a, [m]);
  const partial = {
    op: "max",
    args: [{ op: "const", value: 0, args: [] }, hole()],
  };
  const otherHole = context(t.examples, partial, [1], a, [m]);
  assert.notDeepEqual(encoder(p, a)(otherTask), pa);
  assert.notDeepEqual(encoder(p, a)(otherHole), pa);
  const before = JSON.stringify(p);
  search(t, [m], p, 3, 64);
  assert.equal(JSON.stringify(p), before);
});

test("population proposals include jointly added definitions and non-mining edits while preserving executable base semantics", () => {
  const identity = abstraction(arg(0));
  assert.equal(identity, null);
  const m = abstraction({
    op: "max",
    args: [arg(0), { op: "const", value: 0, args: [] }],
  })!;
  const rows = propose([genome([]), genome([m])], [], 7, 128);
  assert.equal(rows.length, 128);
  assert.ok(rows.some((r) => r.edit === "add-pair" && r.macros.length >= 2));
  assert.ok(
    rows.some((r) =>
      ["specialize", "generalize", "replace", "merge"].includes(r.edit),
    ),
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const g of rows) {
    assert.ok(validLibrary(g.macros));
    assert.ok(g.macros.length <= 4);
    for (const m of g.macros) {
      const args = [
        arg(0),
        arg(1),
        { op: "const", value: 0.5, args: [] },
      ].slice(0, m.arity);
      assert.equal(
        evalExpr({ op: m.name, args }, [-2, 3], g.macros),
        evalExpr(m.body, [-2, 3, 0.5]),
      );
    }
  }
});

test("outer learner ranks before racing, uses fresh stage tasks and freezes before accessing final examples", () => {
  let frozen = false;
  const tasks = Array.from({ length: 10 }, (_, i) => ({
    ...task((x) => x + i),
    id: `t${i}`,
    signature: `s${i}`,
  }));
  const final = tasks.slice(8).map((t) => ({
    ...t,
    get examples() {
      assert.ok(frozen, "Final examples accessed before freeze");
      return t.examples;
    },
  }));
  const result = experiment(
    {
      training: tasks.slice(0, 2),
      development: tasks.slice(2, 6),
      confirmation: tasks.slice(6, 8),
      testing: final,
    },
    {
      ...PILOT,
      proposals: 12,
      shortlist: 2,
      exploration: 1,
      survivors: 2,
      finalists: 1,
      tasksPerStage: 1,
      wakeBudget: 32,
      screenBudget: 16,
      mediumBudget: 32,
      finalBudget: 32,
      replicates: 1,
    },
    (message) => {
      if (message.includes("frozen")) frozen = true;
    },
  );
  assert.equal(result.rounds[0].decision.modelTrainingRows, 0);
  assert.equal(
    result.rounds[1].decision.modelTrainingRows,
    result.rounds[0].screen.length,
  );
  assert.equal(result.trials.length, 8);
  const used = result.rounds.flatMap((r) => [
    r.screen[0].rows[0].task,
    r.medium[0].rows[0].task,
  ]);
  assert.equal(new Set(used).size, 4);
  for (const round of result.rounds) {
    assert.deepEqual(
      [...round.decision.selected].sort(),
      round.screen.map((r) => r.genome.id).sort(),
    );
  }
  const races = result.rounds.flatMap((r) => [...r.screen, ...r.medium]);
  assert.equal(
    result.cost.raceEvaluations,
    races.reduce((s, r) => s + r.evaluations, 0),
  );
  assert.equal(
    result.cost.raceExpansions,
    races.reduce((s, r) => s + r.expansions, 0),
  );
});
