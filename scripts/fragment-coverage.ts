import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Random } from "../src/engine/random";
import { makeTasks, inputs } from "../src/dsl/tasks";
import { compile, formatExpr } from "../src/dsl/expressions";
import type { Expr } from "../src/dsl/types";
import { inverseSearch } from "../src/joint/inverse";

// An auditor-only mirror of the existing generator. It never supplies an AST,
// latent concept or component to inverseSearch. Assert all generated functions
// against the production generator before using this mirror for diagnosis.
const c = (value: number): Expr => ({ op: "const", value, args: [] });
const a = (value: number): Expr => ({ op: "arg", value, args: [] });
const op = (op: string, ...args: Expr[]): Expr => ({ op, args });
const r = new Random(59377215),
  probes = inputs(903141, 97, 7);
const concepts = [
  (v: Expr) => op("max", v, op("neg", v)),
  (v: Expr) => op("max", c(0), v),
  (v: Expr) => op("max", c(0), op("min", c(1), v)),
];
const affine = () => {
  const x = r.pick([-2, -1, 0, 1, 2]);
  const y = x === 0 ? r.pick([-2, -1, 1, 2]) : r.pick([-1, 0, 1]);
  const offset = r.pick([-2, -1, 0, 0, 0, 1, 2]);
  return op(
    "add",
    op("add", op("mul", c(x), a(0)), op("mul", c(y), a(1))),
    c(offset),
  );
};
const suite = makeTasks(
  { training: 10, development: 10, confirmation: 10, testing: 50 },
  {
    seed: 59377215,
    prefix: "composition-calibration",
    additionalExamples: { count: 50, range: 5 },
  },
);
const tasks = [
  ...suite.training,
  ...suite.development,
  ...suite.confirmation,
  ...suite.testing,
];
const oracles: { tree: Expr; components: Record<string, Expr> }[] = [],
  seen = new Set<string>();
while (oracles.length < tasks.length) {
  const f = r.pick(concepts),
    g = r.pick(concepts),
    x = affine(),
    y = affine();
  const mode = r.next(),
    sign = r.pick([-1, 1]),
    group = tasks[oracles.length].group;
  const sx = f(x),
    sy = op("mul", c(sign), g(y));
  let tree: Expr, components: Record<string, Expr>;
  if (group === "Nested compositions") {
    const inside = op("add", g(x), op("mul", c(sign), y));
    tree = f(inside);
    components = { affine_a: x, affine_b: y, inner: g(x), inside };
  } else if (group === "Longer expressions") {
    const h = r.pick(concepts),
      z = affine(),
      sz = h(z);
    tree = op("add", op("add", sx, sy), sz);
    components = {
      affine_a: x,
      affine_b: y,
      affine_c: z,
      term_a: sx,
      term_b: sy,
      term_c: sz,
    };
  } else if (mode < 0.65) {
    tree = sx;
    components = { affine_a: x };
  } else {
    tree = op("add", sx, sy);
    components = { affine_a: x, affine_b: y, term_a: sx, term_b: sy };
  }
  const fn = compile(tree, []),
    values = probes.map(([x, y]) => fn(x, y));
  const signature = values.map((v) => v.toFixed(6)).join(",");
  if (seen.has(signature) || values.every((v) => v === values[0])) continue;
  assert.equal(
    signature,
    tasks[oracles.length].signature,
    "Auditor must preserve generator sequence",
  );
  for (const e of [
    ...tasks[oracles.length].examples,
    ...tasks[oracles.length].checks,
  ])
    assert.ok(Math.abs(fn(...e.input) - e.output) < 1e-8);
  seen.add(signature);
  oracles.push({ tree, components });
}
const policy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const library = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v4.json", "utf8"),
).candidate.macros;
const settings = {
  diverseBeam: true,
  affineDifferences: 32,
  maxNodes: 96,
  affineFits: 512,
  fitDedup: true,
  primitiveDifferences: true,
  semanticRank: 2,
  macroForward: 48,
  macroBindings: 8,
};
const rows = [];
for (const learned of [false, true])
  for (let i = 60; i < tasks.length; i++)
    for (const seed of [0, 7, 42]) {
      const task = tasks[i],
        macros = learned ? library : [];
      const result = inverseSearch(
        task,
        macros,
        policy,
        seed + (60 + i - 30) * 97,
        512,
        { ...settings, debugBank: true },
      );
      // Everything below executes AFTER synthesis. Oracle outputs never enter it.
      const bank = result.debugFragments!.map((row) => ({
        ...row,
        fn: compile(row.tree, macros),
      }));
      const components = Object.fromEntries(
        Object.entries(oracles[i].components).map(([name, tree]) => {
          const fn = compile(tree, []);
          const equivalent = bank.filter((row) =>
            task.examples.every(
              (e) => Math.abs(fn(...e.input) - row.fn(...e.input)) < 1e-8,
            ),
          );
          return [
            name,
            {
              expression: formatExpr(tree),
              bank: !!equivalent.length,
              active: equivalent.some((row) => row.active),
            },
          ];
        }),
      );
      const { debugFragments, ...lean } = result;
      rows.push({
        task: task.id,
        group: task.group,
        learned,
        seed,
        oracle: formatExpr(oracles[i].tree),
        components,
        result: lean,
      });
    }
const summary = [];
for (const learned of [false, true])
  for (const group of ["Nested compositions", "Longer expressions"]) {
    const trials = rows.filter(
        (row) => row.learned === learned && row.group === group,
      ),
      failed = trials.filter((row) => !row.result.solved);
    const names = Object.keys(trials[0].components);
    const coverage = Object.fromEntries(
      names.map((name) => [
        name,
        {
          bank: failed.filter((row) => row.components[name].bank).length,
          active: failed.filter((row) => row.components[name].active).length,
        },
      ]),
    );
    const required =
      group === "Longer expressions"
        ? ["term_a", "term_b", "term_c"]
        : ["inner", "affine_b"];
    summary.push({
      learned,
      group,
      trials: trials.length,
      solved: trials.length - failed.length,
      failed: failed.length,
      coverage,
      failedWithAllComponentsInBank: failed.filter((row) =>
        required.every((name) => row.components[name].bank),
      ).length,
      failedWithAllComponentsActive: failed.filter((row) =>
        required.every((name) => row.components[name].active),
      ).length,
    });
  }
const out = "output/joint/fragment-coverage-v1.json";
if (existsSync(out)) throw new Error("Preserve audit");
writeFileSync(
  out,
  JSON.stringify({
    note: "Post-search diagnostic on adaptive calibration tasks only. Auditor mirror is verified against unchanged generator; oracle syntax never enters search. Coverage is empirical on supplied observations and relative to ONE known decomposition, not a requirement for all valid solutions.",
    summary,
    rows,
  }),
);
console.log(JSON.stringify(summary, null, 2));
