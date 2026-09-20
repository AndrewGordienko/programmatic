import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NeuralPrior } from "./neural";
import {
  activeIndices,
  evaluateProgram,
  exportPython,
  validateProgram,
} from "./program";
import { Random } from "./random";
import { Search } from "./search";
import { simulate, transferTest } from "./simulator";
import { DEFAULT_CONFIG, type Program, type Snapshot } from "./types";
import { distance, key, makeWorld } from "./world";
import {
  evalExpr,
  expandExpr,
  evolveLanguage,
  exprSize,
  type Expr,
  type Macro,
} from "./language";

const compact: Program = {
  id: "test",
  origin: "random",
  genes: [
    { op: "progress", a: 0, b: 0, value: 0 },
    { op: "visits", a: 0, b: 0, value: 0 },
    { op: "subtract", a: 0, b: 1, value: 0 },
    { op: "constant", a: 0, b: 0, value: 2 },
  ],
  output: 2,
};

test("programs execute only their connected subgraph and reject cyclic genes", () => {
  assert.equal(validateProgram(compact), true);
  assert.deepEqual(activeIndices(compact), [0, 1, 2]);
  assert.equal(evaluateProgram(compact, [1, 3, 0, 0.5]), -2);
  assert.equal(
    validateProgram({
      ...compact,
      genes: [{ op: "add", a: 0, b: 0, value: 0 }],
    }),
    false,
  );
  assert.equal(validateProgram({ ...compact, output: 99 }), false);
});

test("procedural worlds are deterministic and solvable, and traces never cross obstacles", () => {
  for (const family of ["warehouse", "terrain", "maze"] as const)
    for (const seed of [0, 42, 100, 1_500_000_000]) {
      const world = makeWorld(seed, family);
      assert.deepEqual(world, makeWorld(seed, family));
      assert.ok(world.shortest > 0);
      const episode = simulate(compact, world, true);
      assert.ok(episode.steps <= world.size ** 2);
      assert.equal(episode.frames.length, episode.steps + 1);
      for (let i = 1; i < episode.frames.length; i++) {
        const p = episode.frames[i];
        assert.ok(!world.walls.includes(key(p, world.size)));
        assert.equal(distance(episode.frames[i - 1], p), 1);
      }
      assert.equal(
        episode.success,
        distance(episode.frames.at(-1)!, world.goal) === 0,
      );
    }
});

test("seeded search is reproducible, bounded, elitist, and spends its declared budget", () => {
  const config = {
    ...DEFAULT_CONFIG,
    population: 16,
    trainingWorlds: 4,
    generations: 6,
    maxNodes: 8,
  };
  const first = new Search(config),
    second = new Search(config);
  for (let i = 0; i < config.generations; i++) {
    const a = first.step(),
      b = second.step();
    assert.deepEqual(a.best, b.best);
    assert.deepEqual(a.history, b.history);
    assert.ok(
      a.leaders.every(
        (c) => validateProgram(c.program) && c.activeNodes <= config.maxNodes,
      ),
    );
    if (i > 0) assert.ok(a.history[i].best >= a.history[i - 1].best);
  }
  assert.equal(first.snapshot().evaluations, (16 + 5 * 14) * 4);
  assert.equal(first.step().generation, config.generations);
  assert.throws(() => new Search({ ...config, population: 100000 }));
});

test("neural prior masks illegal first-gene operators and learns from reward", () => {
  const rng = new Random(80),
    prior = new NeuralPrior(rng);
  const before = prior.distribution();
  const batch = Array.from({ length: 30 }, () => {
    const first = prior.sample(rng, 0, 12, -1);
    assert.ok(first.choice < 5);
    const next = prior.sample(rng, 1, 12, first.choice);
    return {
      decisions: [first, next],
      reward: next.choice === 0 ? 100 : next.choice,
    };
  });
  prior.update(batch);
  const after = prior.distribution();
  assert.ok(after.every((p) => p >= 0 && Number.isFinite(p)));
  assert.ok(Math.abs(after.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  assert.notDeepEqual(before, after);
});

test("exported standalone Python agrees with the JS interpreter on complete trajectories", () => {
  const snapshot: Snapshot = JSON.parse(
    readFileSync("public/reference-run.json", "utf8"),
  );
  const worlds = ["warehouse", "terrain", "maze"].flatMap((family, i) =>
    Array.from({ length: 3 }, (_, j) =>
      makeWorld(
        1_500_000_000 + i * 10000 + j * 97,
        family as "warehouse" | "terrain" | "maze",
      ),
    ),
  );
  const script = `${exportPython(snapshot.best.program)}\nimport json, sys\nworlds = json.load(sys.stdin)\noutput = []\nfor w in worlds:\n    p = (w['start']['x'], w['start']['y'])\n    goal = (w['goal']['x'], w['goal']['y'])\n    walls = {(k % w['size'], k // w['size']) for k in w['walls']}\n    visits, previous, trace = {p: 1}, None, [list(p)]\n    for _ in range(w['size'] ** 2):\n        if p == goal: break\n        n = choose_move(p, goal, walls, visits, previous, w['size'])\n        previous = (n[0] - p[0], n[1] - p[1])\n        p = n\n        visits[p] = visits.get(p, 0) + 1\n        trace.append(list(p))\n    output.append(trace)\nprint(json.dumps(output))\n`;
  const py = spawnSync("python3", ["-c", script], {
    input: JSON.stringify(worlds),
    encoding: "utf8",
  });
  assert.equal(py.status, 0, py.stderr);
  const traces = JSON.parse(py.stdout);
  worlds.forEach((world, i) =>
    assert.deepEqual(
      traces[i],
      simulate(snapshot.best.program, world, true).frames.map((f) => [
        f.x,
        f.y,
      ]),
    ),
  );
});

test("transfer seeds are disjoint from the entire configured training-seed range", () => {
  const results = transferTest(compact, 1_500_000_000, 3);
  for (const result of results) {
    assert.equal(result.count, 3);
    assert.ok(result.seeds.every((seed) => seed > 1_000_000_000));
    assert.ok(result.success >= 0 && result.success <= 1);
  }
});

test("learned macro calls preserve their expanded expression semantics", () => {
  const a: Expr = { op: "arg", value: 0, args: [] };
  const macro: Macro = {
    name: "fn_1",
    arity: 1,
    body: { op: "max", args: [a, { op: "const", value: 0, args: [] }] },
    definition: "fn_1(a) = max(a, 0)",
    support: 2,
    sourceTasks: ["a", "b"],
    size: 3,
  };
  const expression: Expr = {
    op: "fn_1",
    args: [{ op: "sub", args: [a, { op: "arg", value: 1, args: [] }] }],
  };
  const expanded = expandExpr(expression, [macro]);
  for (let x = -5; x <= 5; x += 0.5)
    for (let y = -5; y <= 5; y += 0.5)
      assert.equal(
        evalExpr(expression, [x, y], [macro]),
        evalExpr(expanded, [x, y]),
      );
  assert.ok(exprSize(expression) < exprSize(expanded));
});

test("language discovery uses separate final tasks and equal inner-search budgets", () => {
  const generator = evolveLanguage(42, 1);
  let step = generator.next();
  while (!step.done) step = generator.next();
  const result = step.value;
  assert.equal(result.completed, true);
  assert.equal(result.trials.length, 9);
  assert.ok(result.discoveryEvaluations > result.comparisonEvaluations);
  assert.equal(result.comparisonEvaluations, 9 * 2 * 669);
  for (const trial of result.trials) {
    assert.equal(trial.fixed.evaluations, trial.evolved.evaluations);
    assert.equal(trial.fixed.evaluations, 669);
    assert.ok(
      trial.fixed.expandedSize <= 60 && trial.evolved.expandedSize <= 60,
    );
    assert.ok(!result.induction.some((i) => i.task === trial.label));
    if (trial.evolved.solved) assert.ok(trial.evolved.validationError < 1e-8);
  }
  for (const p of result.proposals.filter((p) => p.accepted))
    assert.ok(p.after > p.before + 0.005);
});
