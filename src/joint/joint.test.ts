import test from "node:test";
import assert from "node:assert/strict";
import { inputs } from "../dsl/tasks";
import { validLibrary, evalExpr } from "../dsl/expressions";
import type { Expr, Task } from "../dsl/types";
import { context, encoder, fitJoint, hole, productions } from "./policy";
import { abstraction, genome, propose } from "./genome";
import { search } from "./search";
import { experiment, PILOT } from "./experiment";
import { aliasesBase, feasible, interval } from "./semantics";
import { Random } from "../engine/random";
import { canonical } from "./canonical";
import { readFileSync } from "node:fs";
import { taskContext, type JointPolicy } from "./policy";
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

test("interval pruning retains arbitrary sampled completions, including correlated macro arguments", () => {
  const rng = new Random(8721);
  const random = (depth: number, holes: boolean): Expr => {
    if (depth === 0 || rng.next() < 0.35)
      return holes && rng.next() < 0.5
        ? hole()
        : rng.next() < 0.6
          ? arg(rng.int(2))
          : { op: "const", value: rng.pick([-2, -1, 0, 1, 2]), args: [] };
    const op = rng.pick(["add", "sub", "mul", "min", "max", "neg"]);
    return {
      op,
      args: Array.from({ length: op === "neg" ? 1 : 2 }, () =>
        random(depth - 1, holes),
      ),
    };
  };
  const complete = (e: Expr): Expr =>
    e.op === "?" ? random(2, false) : { ...e, args: e.args.map(complete) };
  for (let i = 0; i < 300; i++) {
    const partial = random(3, true),
      full = complete(partial),
      bound = interval(partial);
    const examples = inputs(i, 25, 5).map((input) => ({
      input,
      output: evalExpr(full, input),
    }));
    assert.ok(feasible(partial, examples, []));
    for (const e of examples) {
      const [lo, hi] = bound(...e.input);
      assert.ok(e.output >= lo - 1e-7 && e.output <= hi + 1e-7);
    }
  }
  const impossible = {
    op: "max",
    args: [{ op: "const", value: 0, args: [] }, hole()],
  };
  assert.equal(feasible(impossible, task(() => -1).examples, []), false);
  const alias = abstraction({
    op: "add",
    args: [arg(0), { op: "neg", args: [arg(1)] }],
  })!;
  assert.equal(aliasesBase(alias), true);
  assert.equal(abstraction(alias.body, 0, [], true), null);
  const magnitude = abstraction({
    op: "max",
    args: [arg(0), { op: "neg", args: [arg(0)] }],
  })!;
  assert.equal(aliasesBase(magnitude), false);
  assert.ok(
    feasible(
      { op: magnitude.name, args: [hole()] },
      task((x) => Math.abs(x)).examples,
      [magnitude],
    ),
  );
  for (const cap of [1, 2, 11, 100]) {
    const r = search(
      task((x) => x + 0.123),
      [],
      undefined,
      7,
      32,
      cap,
      { semanticPruning: true },
    );
    assert.ok(r.expansions + r.boundChecks! <= cap);
    assert.ok(r.evaluations <= 32);
  }
});

test("canonical algebra preserves finite scalar behavior and removes redundant clamp syntax", () => {
  const c = (value: number): Expr => ({ op: "const", value, args: [] });
  const clip = { op: "max", args: [{ op: "min", args: [arg(0), c(1)] }, c(0)] };
  const redundant = {
    op: "max",
    args: [
      { op: "min", args: [clip, c(1)] },
      { op: "min", args: [c(0), c(1)] },
    ],
  };
  const result = canonical(redundant);
  assert.equal(JSON.stringify(result), JSON.stringify(canonical(clip)));
  for (const input of inputs(31, 100, 20))
    assert.equal(evalExpr(redundant, input), evalExpr(result, input));
});

test("exported larger policy agrees with PyTorch and cached conditioning preserves predictions", () => {
  const policy: JointPolicy = JSON.parse(
    readFileSync("output/joint/neural/policy.json", "utf8"),
  );
  const fixture: { contexts: number[][]; probabilities: number[][] } =
    JSON.parse(readFileSync("output/joint/neural/parity.json", "utf8"));
  const ps = productions([]),
    predict = encoder(policy, ps);
  fixture.contexts.forEach((x, j) =>
    predict(x).forEach((v, i) =>
      assert.ok(Math.abs(v - fixture.probabilities[j][i]) < 1e-10),
    ),
  );
  const t = task((x) => Math.abs(x)),
    fast = taskContext(t.examples, ps, []),
    partial = { op: "max", args: [arg(0), hole()] };
  const a = context(t.examples, partial, [1], ps, []),
    b = fast(partial, [1]);
  assert.deepEqual(a, b);
  assert.deepEqual(predict(a), encoder(policy, ps, a.slice(0, 29))(b));
  const full = search(t, [], policy, 7, 128, 1024, { evolutionary: true }),
    cached = search(t, [], policy, 7, 128, 1024, {
      evolutionary: true,
      fastPolicy: true,
    });
  assert.deepEqual({ ...full, elapsedMs: 0 }, { ...cached, elapsedMs: 0 });
  const retrained = fitJoint(
    [
      {
        task: t,
        tree: { op: "max", args: [arg(0), { op: "neg", args: [arg(0)] }] },
      },
    ],
    [],
    3,
    policy,
    { dreams: 2, epochs: 1 },
  );
  assert.equal(retrained.contextWeights.length, 64);
  assert.ok(Number.isFinite(retrained.loss));
});
