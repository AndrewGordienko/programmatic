import test from "node:test";
import assert from "node:assert/strict";
import { Random } from "../engine/random";
import { inputs } from "../dsl/tasks";
import {
  compile,
  valid,
  rewrite,
  exprSize,
  evalExpr,
} from "../dsl/expressions";
import { inverseBox, inverseSearch } from "./inverse";
import { sharedAbstractions } from "./inventions";
import { abstraction } from "./genome";
import { linearPieces, inversePieces, contains } from "./domains";

const task = (f: (x: number, y: number) => number) => ({
  examples: inputs(301, 25, 3).map((input) => ({ input, output: f(...input) })),
  checks: inputs(809, 65, 5).map((input) => ({ input, output: f(...input) })),
});

test("inverse specifications contain every sampled satisfying operand and exclude impossible min/max branches", () => {
  const rng = new Random(12773);
  const ops: Record<string, (a: number, b: number) => number> = {
    add: (a, b) => a + b,
    sub: (a, b) => a - b,
    mul: (a, b) => a * b,
    min: Math.min,
    max: Math.max,
    neg: (_, b) => -b,
  };
  for (const [op, f] of Object.entries(ops))
    for (let i = 0; i < 500; i++) {
      const a = i % 10 === 0 ? 0 : rng.next() * 20 - 10,
        b = rng.next() * 20 - 10,
        y = f(a, b);
      const box = inverseBox(
        op,
        { low: [y - rng.next()], high: [y + rng.next()] },
        [a],
      );
      assert.ok(box);
      assert.ok(b >= box.low[0] - 1e-7 && b <= box.high[0] + 1e-7);
      for (let j = 0; j < 3; j++) {
        const z = rng.next() * 40 - 20;
        const exact = inverseBox(op, { low: [y], high: [y] }, [a]);
        if (exact && z >= exact.low[0] && z <= exact.high[0])
          assert.ok(Math.abs(f(a, z) - y) < 1e-7);
      }
    }
  assert.equal(inverseBox("max", { low: [0], high: [1] }, [2]), null);
  assert.equal(inverseBox("min", { low: [0], high: [1] }, [-1]), null);
  assert.equal(inverseBox("mul", { low: [1], high: [2] }, [0]), null);
  assert.deepEqual(inverseBox("mul", { low: [1], high: [1] }, [1e-10]), {
    low: [1e10],
    high: [1e10],
  });
});

test("inverse solver synthesizes executable base programs, respects caps, and does not learn from check outputs", () => {
  for (const f of [
    (x: number, y: number) => 2 * x - y + 1,
    (x: number, y: number) => Math.max(0, x - y),
    (x: number, y: number) => Math.abs(x + 2 * y),
    (x: number) => Math.max(0, Math.min(1, x)),
  ]) {
    const t = task(f),
      a = inverseSearch(t, [], undefined, 42, 512),
      b = inverseSearch(t, [], undefined, 42, 512);
    assert.equal(a.solved, true);
    assert.ok(valid(a.tree, []));
    assert.ok(a.evaluations <= 512 && a.expansions <= 4096);
    assert.deepEqual({ ...a, elapsedMs: 0 }, { ...b, elapsedMs: 0 });
    const changed = inverseSearch(
      { ...t, checks: t.checks.map((e) => ({ ...e, output: e.output + 100 })) },
      [],
      undefined,
      42,
      512,
    );
    assert.deepEqual(changed.tree, a.tree);
    assert.equal(changed.evaluations, a.evaluations);
    assert.equal(changed.expansions, a.expansions);
    assert.equal(changed.solved, false);
    const execute = compile(a.tree, []);
    for (const [x, y] of inputs(9991, 250, 20))
      assert.ok(Math.abs(execute(x, y) - f(x, y)) < 1e-7);
  }
  for (const budget of [1, 2, 7, 32])
    for (const workBudget of [0, 1, 9, 100]) {
      const r = inverseSearch(
        task((x, y) => x * y + 0.3719),
        [],
        undefined,
        7,
        budget,
        { workBudget },
      );
      assert.ok(r.evaluations <= budget && r.expansions <= workBudget);
      assert.equal(r.solved, false);
    }
  const noFits = inverseSearch(
    task((x, y) => Math.max(0, x - y)),
    [],
    undefined,
    42,
    512,
    { affineFits: 0 },
  );
  assert.equal(noFits.linearFits, 0);
});

test("abstraction preserves repeated computations and commutative rewriting preserves argument bindings", () => {
  const x = { op: "arg", value: 0, args: [] },
    y = { op: "arg", value: 1, args: [] },
    c = (value: number) => ({ op: "const", value, args: [] });
  const inner = { op: "add", args: [x, { op: "mul", args: [y, c(2)] }] };
  const expression = { op: "max", args: [inner, { op: "neg", args: [inner] }] };
  const proposals = sharedAbstractions(expression)
    .map((e) => abstraction(e, 1, [], true))
    .filter((m) => m?.arity === 1);
  assert.ok(
    proposals.some((m) =>
      [-4, -1, 0, 2, 7].every((v) => evalExpr(m!.body, [v]) === Math.abs(v)),
    ),
  );
  const clip = abstraction(
    { op: "max", args: [c(0), { op: "min", args: [x, c(1)] }] },
    1,
    [],
    true,
  )!;
  const source = {
    op: "max",
    args: [{ op: "min", args: [c(1), inner] }, c(0)],
  };
  const compressed = rewrite(source, [clip], { commutative: true });
  assert.ok(exprSize(compressed) < exprSize(source));
  for (const input of inputs(7321, 100, 10))
    assert.equal(evalExpr(source, input), evalExpr(compressed, input, [clip]));
});

test("invented unary semantics invert disjoint branches without admitting values in the gap", () => {
  const a = { op: "arg", value: 0, args: [] },
    c = (value: number) => ({ op: "const", value, args: [] });
  const magnitude = { op: "max", args: [a, { op: "neg", args: [a] }] };
  const pieces = linearPieces(magnitude)!;
  const domain = inversePieces(pieces, { low: [2], high: [2] })!;
  assert.equal(contains(domain, 0, -2), true);
  assert.equal(contains(domain, 0, 2), true);
  assert.equal(contains(domain, 0, 0), false);
  assert.equal(linearPieces({ op: "mul", args: [a, a] }), null);
  const rng = new Random(93012);
  const random = (depth: number): typeof a => {
    if (!depth) return rng.next() < 0.7 ? a : c(rng.int(7) - 3);
    const op = rng.pick(["add", "sub", "mul", "min", "max"]);
    return {
      op,
      args: [
        random(depth - 1),
        op === "mul" ? c(rng.int(7) - 3) : random(depth - 1),
      ],
    } as typeof a;
  };
  for (let n = 0; n < 100; n++) {
    const e = random(3),
      ps = linearPieces(e);
    assert.ok(ps);
    for (let i = 0; i < 30; i++) {
      const x = rng.next() * 40 - 20,
        y = evalExpr(e, [x]),
        p = ps.find((p) => x >= p.lo && x <= p.hi);
      assert.ok(p);
      assert.ok(Math.abs(y - (p.a * x + p.b)) < 1e-7);
      const b = inversePieces(ps, { low: [y - 0.01], high: [y + 0.01] });
      assert.ok(b);
      assert.ok(contains(b, 0, x));
      const z = rng.next() * 40 - 20;
      if (contains(b, 0, z))
        assert.ok(Math.abs(evalExpr(e, [z]) - y) < 0.010001);
    }
  }
});
