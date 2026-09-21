import test from "node:test";
import assert from "node:assert/strict";
import { Random } from "../engine/random";
import { inputs, makeTasks } from "../dsl/tasks";
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
import {
  linearPieces,
  inversePieces,
  contains,
  inverseApplied,
} from "./domains";
import { additiveJoin } from "./joins";
import { dreamDataset } from "./dreams";
import { paths, at } from "../dsl/expressions";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { encoder, productions, type JointPolicy } from "./policy";
import { specificationFeatures } from "./specification";
import { languagePopulation } from "./population";
import { genome } from "./genome";
import {
  affineSkeleton,
  fitAffineSkeleton,
  instantiateAffine,
} from "./parametric";
import { parametricSearch } from "./parametric-search";
import { languageValueFeatures, predictLanguageValue } from "./language-value";
import { fragmentFeatures, predictFragmentValue } from "./fragment-value";
import { fullObservationContext, specificationFeature } from "./full-context";
import { predictHoleValue, predictHoleTree } from "./hole-value";
import { latticeCompose } from "./lattice";
import type { Expr } from "../dsl/types";

test("min/max cover executes its inferred expression and obeys construction limits", () => {
  const xs = inputs(913718, 75, 5);
  const x = { op: "arg", value: 0, args: [] },
    y = { op: "arg", value: 1, args: [] };
  const shifted = { op: "add", args: [x, { op: "const", value: 1, args: [] }] };
  const pieces = [x, y, shifted].map((tree) => ({
    tree,
    size: exprSize(tree),
    values: xs.map((v) => compile(tree, [])(...v)),
  }));
  const target = xs.map(([a, b]) => Math.max(a, Math.min(b, a + 1)));
  let operations = 0,
    pointOperations = 0,
    evaluations = 0;
  const execute = (tree: Expr) => {
    evaluations++;
    return {
      tree,
      size: exprSize(tree),
      values: xs.map((v) => compile(tree, [])(...v)),
    };
  };
  const tree = latticeCompose(
    pieces,
    target,
    () => ++operations <= 4096,
    (n) => {
      pointOperations += n;
    },
    execute,
  );
  assert.ok(tree);
  assert.ok(operations > 0 && pointOperations > 0 && evaluations > 0);
  const f = compile(tree, []);
  for (const [a, b] of inputs(730922, 120, 7))
    assert.ok(Math.abs(f(a, b) - Math.max(a, Math.min(b, a + 1))) < 1e-8);
  let capped = 0;
  assert.equal(
    latticeCompose(
      pieces,
      target,
      () => ++capped <= 1,
      () => {},
      () => {
        throw new Error("No execution allowance");
      },
    ),
    undefined,
  );
});

test("visited-state critics match independent exports and lazy disjoint-domain features", () => {
  const roots = ["neural-visited-v1", "neural-visited-v2"];
  for (const root of roots) {
    for (const suffix of root.endsWith("v1")
      ? ["", "/tree8", "/forest16"]
      : ["/tree8", "/forest16"]) {
      const folder = `output/joint/${root}${suffix}/`;
      const model = JSON.parse(readFileSync(folder + "model.json", "utf8"));
      for (const row of JSON.parse(
        readFileSync(folder + "parity.json", "utf8"),
      )) {
        assert.ok(
          Math.abs(predictHoleValue(model, row.features) - row.value) < 1e-10,
        );
        if (model.version === "visited-hole-tree-v1")
          assert.equal(
            predictHoleTree(model, (i) => row.features[i]),
            predictHoleValue(model, row.features),
          );
      }
    }
  }
  const spec = {
    low: [-Infinity, -2, 0],
    high: [Infinity, 2, 1],
    ranges: [
      [[-Infinity, Infinity]],
      [
        [-2, -1],
        [1, 2],
      ],
      [
        [0, 0],
        [0.25, 0.5],
        [1, 1],
      ],
    ] as [number, number][][],
  };
  assert.deepEqual(
    Array.from({ length: 375 }, (_, i) => specificationFeature(spec, i)),
    specificationFeatures(spec, 75),
  );
});

test("critic and tracing preserve budgets and never use final checks for search", () => {
  const model = JSON.parse(
    readFileSync("output/joint/neural-visited-v2/forest16/model.json", "utf8"),
  );
  const examples = inputs(19281, 75, 5).map((input) => ({
    input,
    output: Math.abs(input[0]) + Math.max(0, input[1]),
  }));
  const settings = {
    affineFits: 64,
    maxNodes: 96,
    holeValue: model,
    holeValueWeight: 1,
  };
  const t = { examples, checks: examples };
  const eager = inverseSearch(t, [], undefined, 817, 128, settings);
  const lazy = inverseSearch(t, [], undefined, 817, 128, {
    ...settings,
    lazyHoleFeatures: true,
  });
  const changedChecks = inverseSearch(
    { ...t, checks: examples.map((e) => ({ ...e, output: 100000 })) },
    [],
    undefined,
    817,
    128,
    {
      ...settings,
      lazyHoleFeatures: true,
      traceStates: true,
      tracePhase: "entry",
    },
  );
  assert.ok(lazy.holeValuePredictions > 0);
  for (const row of [lazy, changedChecks]) {
    assert.deepEqual(row.tree, eager.tree);
    assert.equal(row.evaluations, eager.evaluations);
    assert.equal(row.expansions, eager.expansions);
    assert.ok(row.evaluations <= 128 && row.expansions <= 1024);
  }
  assert.ok(changedChecks.traceStates!.length > 0);
  const easyExamples = inputs(7319, 25, 3).map((input) => ({
    input,
    output: input[0] + input[1],
  }));
  const easy = { examples: easyExamples, checks: easyExamples };
  const entry = inverseSearch(easy, [], undefined, 913, 128, {
    affineFits: 0,
    traceStates: true,
    tracePhase: "entry",
  });
  const decision = inverseSearch(easy, [], undefined, 913, 128, {
    affineFits: 0,
    traceStates: true,
    tracePhase: "decision",
  });
  assert.deepEqual(entry.tree, decision.tree);
  assert.equal(entry.expansions, decision.expansions);
});

test("full-observation policy matches PyTorch and includes later inputs and hole constraints", () => {
  const folder = "output/joint/neural-full-v1/width-128/";
  const model = JSON.parse(readFileSync(folder + "policy.json", "utf8"));
  const parity = JSON.parse(readFileSync(folder + "parity.json", "utf8"));
  const ps = parity.semantics.map((values: number[], i: number) => ({
    id: String(i),
    node: { op: "arg", value: 0, args: [] },
    arity: 0,
    semantic: values.slice(0, -1),
  }));
  for (const row of parity.fixtures) {
    const actual = encoder(
      model,
      ps.filter((_: unknown, i: number) => row.legal[i]),
    )(row.x);
    actual.forEach((v, i) =>
      assert.ok(Math.abs(v - row.probabilities[i]) < 1e-10),
    );
  }
  const examples = inputs(3891, 75, 5).map((input) => ({ input, output: 0 }));
  const spec = { low: Array(75).fill(0), high: Array(75).fill(0) };
  const before = fullObservationContext(examples, spec);
  examples[64].output = 3;
  spec.low[70] = -2;
  const after = fullObservationContext(examples, spec);
  assert.equal(before.length, 600);
  assert.notEqual(before[64 * 3 + 2], after[64 * 3 + 2]);
  assert.notEqual(before[225 + 70 * 5], after[225 + 70 * 5]);
});

test("compiled partial applications reuse derivations while checking every observation", () => {
  const body = {
    op: "add",
    args: [
      { op: "arg", value: 0, args: [] },
      {
        op: "max",
        args: [
          { op: "arg", value: 1, args: [] },
          { op: "const", value: 0, args: [] },
        ],
      },
    ],
  };
  const known = [Array.from({ length: 75 }, (_, i) => i % 3)],
    values = known[0].map((v) => v + 2);
  const target = { low: values, high: values };
  let cold = 0,
    compiled = 0,
    points = 0;
  const a = inverseApplied(body, known, target, () => {
    cold++;
    return true;
  });
  const b = inverseApplied(
    body,
    known,
    target,
    () => {
      compiled++;
      return true;
    },
    {
      cache: new Map(),
      point: () => {
        points++;
      },
    },
  );
  assert.deepEqual(a, b);
  assert.equal(cold, 75);
  assert.equal(compiled, 3);
  assert.equal(points, 75);
  assert.ok(
    b && values.every((_, i) => contains(b, i, 2) && !contains(b, i, 1)),
  );
});

test("experimental composition heuristics preserve execution caps and keep checks out of search", () => {
  const macros = JSON.parse(
    readFileSync("output/joint/inverse-language-pilot-v4.json", "utf8"),
  ).candidate.macros;
  const examples = inputs(19307, 75, 5).map((input) => ({
    input,
    output: Math.abs(input[0]) + Math.max(0, input[1]),
  }));
  const options = [
    { sparseWidth: 2, sparseSteps: 256 },
    { residualBuild: 32 },
    { unaryFirst: 0.4 },
    { affineLattice: 32, forwardFraction: 0.7 },
    {
      specificationFragments: 16,
      relational: true,
      literalBindings: true,
      compiledRelations: true,
    },
    { lattice: true, localAffineNeighbors: 6, memoAffine: true },
  ];
  for (const option of options) {
    const task = { examples, checks: examples };
    const a = inverseSearch(task, macros, undefined, 73, 128, {
      ...option,
      affineFits: 64,
      macroForward: 12,
      maxNodes: 96,
    });
    const b = inverseSearch(
      { ...task, checks: examples.map((e) => ({ ...e, output: 123456 })) },
      macros,
      undefined,
      73,
      128,
      { ...option, affineFits: 64, macroForward: 12, maxNodes: 96 },
    );
    assert.deepEqual(a.tree, b.tree);
    assert.equal(a.evaluations, b.evaluations);
    assert.equal(a.expansions, b.expansions);
    assert.ok(a.evaluations <= 128 && a.expansions <= 1024);
    assert.ok(valid(a.tree, macros));
  }
});

test("outer semantic value model matches independent PyTorch inference", () => {
  const folder = "output/joint/language-value-v1/";
  const model = JSON.parse(readFileSync(folder + "model.json", "utf8"));
  for (const row of JSON.parse(readFileSync(folder + "parity.json", "utf8")))
    assert.ok(
      Math.abs(predictLanguageValue(model, row.features) - row.value) < 1e-10,
    );
});

test("fragment guide matches independent PyTorch inference and preserves later observation geometry", () => {
  const folder = "output/joint/fragment-value-v1/";
  const model = JSON.parse(readFileSync(folder + "model.json", "utf8"));
  for (const row of JSON.parse(readFileSync(folder + "parity.json", "utf8")))
    assert.ok(
      Math.abs(predictFragmentValue(model, row.features) - row.value) < 1e-10,
    );
  const examples = inputs(6112, 75, 5).map((input) => ({ input, output: 0 }));
  examples[55].output = 2;
  examples[56].output = -2;
  const swapped = examples.map((e) => ({ ...e }));
  swapped[55].output = -2;
  swapped[56].output = 2;
  const tree = { op: "const", value: 1, args: [] },
    values = Array(75).fill(1);
  assert.notDeepEqual(
    fragmentFeatures(examples, values, tree, []),
    fragmentFeatures(swapped, values, tree, []),
  );
});

test("outer value features ignore invented names and library order while retaining executable behavior", () => {
  const run = JSON.parse(
    readFileSync("output/joint/inverse-language-pilot-v4.json", "utf8"),
  );
  const g = run.candidate;
  const context = {
    corpus: 133,
    training: 160,
    budget: 512,
    tasks: 12,
    reps: 3,
  };
  const original = languageValueFeatures(g, context);
  const renamed = {
    ...g,
    macros: [...g.macros]
      .reverse()
      .map((m: Parameters<typeof genome>[0][number], i: number) => ({
        ...m,
        name: `renamed_${i}`,
        definition: "opaque label",
      })),
  };
  const changed = languageValueFeatures(renamed, context);
  assert.equal(original.length, 280);
  for (let i = 0; i < original.length; i++)
    assert.ok(Math.abs(original[i] - changed[i]) < 1e-12);
  assert.notDeepEqual(original, languageValueFeatures(genome([]), context));
});

test("richer observation protocol preserves task identity and hides independent checks", () => {
  const counts = {
    training: 10,
    development: 10,
    confirmation: 10,
    testing: 10,
  };
  const base = makeTasks(counts, { seed: 3721 }),
    rich = makeTasks(counts, {
      seed: 3721,
      additionalExamples: { count: 50, range: 5 },
    });
  const a = Object.values(base).flat(),
    b = Object.values(rich).flat();
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].signature, b[i].signature);
    assert.deepEqual(a[i].checks, b[i].checks);
    assert.deepEqual(a[i].examples, b[i].examples.slice(0, 25));
    assert.equal(b[i].examples.length, 75);
  }
});

test("parametric search respects execution caps and final checks cannot steer fitting", () => {
  const t = task((x, y) => x - y + 1);
  const a = parametricSearch(t, [], undefined, 381, 128);
  const b = parametricSearch(
    { ...t, checks: t.checks.map((e) => ({ ...e, output: e.output + 100 })) },
    [],
    undefined,
    381,
    128,
  );
  assert.ok(a.solved);
  assert.equal(b.solved, false);
  assert.deepEqual(a.tree, b.tree);
  assert.equal(a.evaluations, b.evaluations);
  assert.ok(a.evaluations <= 128 && a.parameterWork > 0);
  assert.equal(a.exampleExecutions, a.evaluations * t.examples.length);
});

test("joint affine fitting differentiates shared macro arguments and counts every executed parameter proposal", () => {
  const a = { op: "arg", value: 0, args: [] };
  const magnitude = abstraction(
    { op: "max", args: [a, { op: "neg", args: [a] }] },
    1,
    [],
    true,
  )!;
  const template = {
    op: "add",
    args: [
      { op: magnitude.name, args: [{ op: "?", value: 0, args: [] }] },
      { op: "?", value: 1, args: [] },
    ],
  };
  const weights = [1.2, -0.4, 0.7, -0.2, 1.3, -1],
    input = [1.8, -0.9];
  const model = affineSkeleton(template, [magnitude]);
  const row = model.evaluate(weights, input);
  for (let i = 0; i < weights.length; i++) {
    const plus = [...weights],
      minus = [...weights];
    plus[i] += 1e-6;
    minus[i] -= 1e-6;
    assert.ok(
      Math.abs(
        row.derivative[i] -
          (model.evaluate(plus, input).value -
            model.evaluate(minus, input).value) /
            2e-6,
      ) < 1e-6,
    );
  }
  assert.ok(
    Math.abs(
      row.value -
        evalExpr(instantiateAffine(template, weights), input, [magnitude]),
    ) < 1e-10,
  );
  let executions = 0,
    work = 0;
  const examples = inputs(4821, 75, 5).map((input) => ({
    input,
    output: Math.abs(input[0] - input[1]) + 2 * input[1] + 1,
  }));
  const fit = fitAffineSkeleton(
    template,
    [magnitude],
    examples,
    new Random(72),
    {
      restarts: 12,
      steps: 24,
      chargeEvaluation: () => ++executions <= 512,
      chargeWork: (n) => {
        work += n;
        return true;
      },
    },
  );
  assert.ok(fit);
  assert.ok(fit.error < 1e-8);
  assert.ok(executions <= 512 && work > 0);
  for (const input of inputs(8291, 100, 8))
    assert.ok(
      Math.abs(
        evalExpr(fit.tree, input, [magnitude]) -
          (Math.abs(input[0] - input[1]) + 2 * input[1] + 1),
      ) < 1e-8,
    );
});

test("inverse policy matches independent masked PyTorch inference for base and learned languages", () => {
  const folder = "output/joint/neural-inverse/";
  const model = readFileSync(folder + "policy.json");
  const policy: JointPolicy = JSON.parse(model.toString());
  const fixture = JSON.parse(readFileSync(folder + "parity.json", "utf8"));
  assert.equal(
    createHash("sha256").update(model).digest("hex"),
    fixture.modelSha256,
  );
  const ps = productions(fixture.library);
  for (const row of fixture.rows) {
    const legal = row.available.map((i: number) => ps[i]);
    const actual = encoder(policy, legal)(row.context);
    const cached = encoder(
      policy,
      legal,
      row.context.slice(0, 29),
    )(row.context);
    for (let i = 0; i < actual.length; i++) {
      assert.ok(Math.abs(actual[i] - row.probabilities[i]) < 1e-12);
      assert.ok(Math.abs(cached[i] - actual[i]) < 1e-12);
    }
  }
  assert.throws(
    () => encoder(policy, ps)(Array(71).fill(0)),
    /context mismatch/,
  );
});

test("hole semantic features preserve disjointness and remain finite for unbounded specifications", () => {
  const gap = specificationFeatures({
    low: [-2],
    high: [2],
    ranges: [
      [
        [-2, -2],
        [2, 2],
      ],
    ],
  });
  const convex = specificationFeatures({ low: [-2], high: [2] });
  assert.equal(gap.length, 125);
  assert.notDeepEqual(gap, convex);
  assert.ok(
    specificationFeatures({ low: [-Infinity], high: [Infinity] }).every(
      Number.isFinite,
    ),
  );
});

test("population reserves additions to the incumbent before unrelated languages", () => {
  const c = JSON.parse(
    readFileSync("output/joint/inverse-corpus-v5.json", "utf8"),
  );
  const pool = c.proposed.map(
    (r: { macro: Parameters<typeof genome>[0][number] }) => r.macro,
  );
  const parent = genome(c.parentLibrary);
  const population = languagePopulation([parent], pool, 73, 512, 133);
  const ids = new Set(population.map((g) => g.id));
  assert.equal(ids.size, population.length);
  assert.ok(ids.has(parent.id));
  assert.ok(ids.has(genome([]).id));
  for (const m of pool) assert.ok(ids.has(genome([...parent.macros, m]).id));
  assert.deepEqual(
    languagePopulation([parent], pool, 73, 512, 133),
    population,
  );
  assert.ok(population.every((g) => g.macros.length <= 4));
});

test("refactored dream teachers lower synthesized integer literals into available productions", () => {
  const t = {
    ...task((x, y) => 4 * x + y + 3),
    id: "literal-task",
    signature: "literal-task",
    group: "training",
  };
  const tree = {
    op: "add",
    args: [
      {
        op: "add",
        args: [
          {
            op: "mul",
            args: [
              { op: "const", value: 4, args: [] },
              { op: "arg", value: 0, args: [] },
            ],
          },
          { op: "arg", value: 1, args: [] },
        ],
      },
      { op: "const", value: 3, args: [] },
    ],
  };
  const data = dreamDataset([{ task: t, tree }], [], 19, 32, {
    lowerIntegerLiterals: true,
    commutative: true,
  });
  const teacher = data.programs.find((p) => p.source === "corpus");
  assert.ok(teacher);
  assert.ok(
    paths(teacher.tree).every((p) => {
      const e = at(teacher.tree, p);
      return e.op !== "const" || [-2, -1, 0, 1, 2].includes(e.value!);
    }),
  );
  for (const e of t.checks)
    assert.equal(evalExpr(teacher.tree, e.input), e.output);
  assert.ok(data.accounting.programExecutions >= data.programs.length);
  assert.equal(
    data.accounting.exampleExecutions,
    data.accounting.programExecutions * 25,
  );
  assert.ok(
    data.decisions.every((d) => d.y >= 0 && d.y < data.semantics.length),
  );
});

test("additive inverse joins charge partial work and validate complete candidates on every example", () => {
  const x = { op: "arg", value: 0, args: [] },
    y = { op: "arg", value: 1, args: [] };
  const magnitude = abstraction({
    op: "max",
    args: [x, { op: "neg", args: [x] }],
  })!;
  const positive = abstraction({
    op: "max",
    args: [x, { op: "const", value: 0, args: [] }],
  })!;
  const macros = [magnitude, positive],
    t = task((x, y) => Math.abs(x) + Math.max(0, y) + Math.abs(x - y));
  const trees = [
    x,
    y,
    { op: "const", value: 0, args: [] },
    { op: magnitude.name, args: [x] },
    { op: positive.name, args: [y] },
    { op: magnitude.name, args: [{ op: "sub", args: [x, y] }] },
  ];
  const fragments = trees.map((tree) => ({
    tree,
    size: exprSize(tree),
    values: t.examples.map((e) => evalExpr(tree, e.input, macros)),
  }));
  let steps = 0,
    probes = 0,
    evaluations = 0;
  const result = additiveJoin(
    fragments,
    t.examples,
    macros,
    4096,
    () => {
      steps++;
      return true;
    },
    (n) => {
      probes += n;
    },
    (tree) => {
      evaluations++;
      return t.examples.every(
        (e) => Math.abs(evalExpr(tree, e.input, macros) - e.output) < 1e-8,
      );
    },
  );
  assert.ok(result);
  assert.ok(steps <= 4096);
  assert.ok(probes > 0 && evaluations > 0);
  assert.ok(
    t.checks.every(
      (e) => Math.abs(evalExpr(result, e.input, macros) - e.output) < 1e-8,
    ),
  );
  let limited = 0;
  assert.equal(
    additiveJoin(
      fragments,
      t.examples,
      macros,
      4096,
      () => {
        if (limited >= 3) return false;
        limited++;
        return true;
      },
      () => {},
      () => false,
    ),
    undefined,
  );
  assert.equal(limited, 3);
  let executed = 0;
  const impossible = task((x) => Math.abs(x));
  assert.equal(
    additiveJoin(
      fragments.slice(0, 3),
      impossible.examples,
      [],
      4096,
      () => true,
      () => {},
      () => {
        executed++;
        return false;
      },
    ),
    undefined,
  );
  assert.equal(executed, 0);
});

test("partially applied multi-argument definitions invert the correct operand and charge derivations", () => {
  const arg = (value: number) => ({ op: "arg", value, args: [] });
  const body = {
    op: "add",
    args: [
      { op: "max", args: [arg(0), { op: "const", value: 0, args: [] }] },
      { op: "max", args: [arg(1), { op: "neg", args: [arg(1)] }] },
    ],
  };
  const known = [[-3, 2, 5]],
    unknown = [-2, 4, -7],
    outputs = unknown.map((x, i) => evalExpr(body, [known[0][i], x]));
  let charges = 0;
  const inverse = inverseApplied(
    body,
    known,
    { low: outputs, high: outputs },
    () => {
      charges++;
      return true;
    },
  );
  assert.ok(inverse);
  assert.equal(charges, 3);
  unknown.forEach((v, i) => {
    assert.ok(contains(inverse, i, v));
    assert.ok(contains(inverse, i, -v));
    assert.equal(contains(inverse, i, 0), false);
  });
  assert.equal(
    inverseApplied(body, known, { low: outputs, high: outputs }, () => false),
    null,
  );
  const macro = abstraction(body)!;
  const t = task((x, y) => Math.max(0, x) + Math.abs(y));
  const options = {
    macroBindings: 8,
    macroForward: 32,
    relational: true,
    diverseBeam: true,
    maxNodes: 96,
    semanticRank: 2,
  };
  const r = inverseSearch(t, [macro], undefined, 13, 512, options);
  assert.ok(r.solved);
  assert.ok(r.evaluations <= 512 && r.expansions <= 4096);
  const hostile = inverseSearch(
    { ...t, checks: t.checks.map((e) => ({ ...e, output: e.output + 1 })) },
    [macro],
    undefined,
    13,
    512,
    options,
  );
  assert.deepEqual(hostile.tree, r.tree);
  assert.equal(hostile.solved, false);
});

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
