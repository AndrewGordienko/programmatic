import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inputs } from "../src/dsl/tasks";
import { compile, expandExpr, at, paths, key } from "../src/dsl/expressions";
import type { Expr, Macro } from "../src/dsl/types";
import { Random } from "../src/engine/random";
import { fragmentFeatures } from "../src/joint/fragment-value";
const folder = "output/joint/fragment-value-v1";
if (existsSync(`${folder}/data.json.gz`))
  throw new Error("Preserve fragment dataset");
const started = performance.now(),
  rng = new Random(711091);
const data: {
  programs: { tree: Expr; source: string; id: number }[];
  library: Macro[];
} = JSON.parse(
  gunzipSync(readFileSync("output/joint/neural-v2/data.json.gz")).toString(),
);
const xs = [...inputs(301, 25, 3), ...inputs(602, 50, 5)],
  probes = inputs(903141, 97, 7);
const pool = new Map<string, { tree: Expr; values: number[] }>();
let programExecutions = 0,
  exampleExecutions = 0;
const evaluate = (tree: Expr, inputs: number[][]) => {
  programExecutions++;
  exampleExecutions += inputs.length;
  const f = compile(tree, []);
  return inputs.map((x) => f(x[0], x[1]));
};
for (const p of data.programs) {
  const expanded = expandExpr(p.tree, data.library);
  for (const path of paths(expanded)) {
    const tree = at(expanded, path),
      k = key(tree);
    if (!pool.has(k)) pool.set(k, { tree, values: evaluate(tree, xs) });
  }
}
const fragments = [...pool.values()],
  rows: {
    x: number[];
    y: number;
    task: string;
    program: number;
    split: string;
    negativeKind?: string;
  }[] = [],
  exposures = new Map<string, Expr>();
for (const p of data.programs) {
  const tree = expandExpr(p.tree, data.library),
    behavior = evaluate(tree, probes)
      .map((v) => v.toFixed(6))
      .join(","),
    id = createHash("sha256").update(behavior).digest("hex");
  const split =
    parseInt(id.slice(0, 8), 16) % 10 === 0 ? "validation" : "training";
  const outputs = pool.get(key(tree))!.values,
    examples = xs.map((input, i) => ({ input, output: outputs[i] }));
  const positive = [
    ...new Map(
      paths(tree)
        .slice(1)
        .map((path) => {
          const e = at(tree, path);
          return [key(e), pool.get(key(e))!] as const;
        }),
    ).values(),
  ];
  const signatures = new Set(
    positive.map((r) => r.values.map((v) => v.toFixed(6)).join(",")),
  );
  const selected = [...positive];
  for (let i = 0; i < selected.length; i++) {
    const j = i + rng.int(selected.length - i);
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  const put = (
    f: (typeof fragments)[number],
    y: number,
    negativeKind?: string,
  ) => {
    rows.push({
      x: fragmentFeatures(examples, f.values, f.tree, []),
      y,
      task: id,
      program: p.id,
      split,
      negativeKind,
    });
    exposures.set(key(f.tree), f.tree);
  };
  for (const f of selected.slice(0, 4)) put(f, 1);
  const negatives = Array.from({ length: 64 }, () =>
    rng.pick(fragments),
  ).filter(
    (f) =>
      !signatures.has(f.values.map((v) => v.toFixed(6)).join(",")) &&
      f.values.some((v, i) => Math.abs(v - outputs[i]) > 1e-7),
  );
  const error = (f: (typeof fragments)[number]) =>
    f.values.reduce((s, v, i) => s + Math.abs(v - outputs[i]), 0);
  for (const f of [...negatives]
    .sort((a, b) => error(a) - error(b))
    .slice(0, 2))
    put(f, 0, "close-output");
  for (const f of negatives.slice(0, 2)) put(f, 0, "random");
  exposures.set(key(tree), tree);
}
mkdirSync(folder, { recursive: true });
writeFileSync(
  `${folder}/data.json.gz`,
  gzipSync(
    JSON.stringify({
      version: "executed-fragment-data-v1",
      rows,
      exposureTrees: [...exposures.values()],
    }),
  ),
);
writeFileSync(
  `${folder}/data-manifest.json`,
  JSON.stringify(
    {
      rows: rows.length,
      features: rows[0].x.length,
      positive: rows.filter((r) => r.y === 1).length,
      training: rows.filter((r) => r.split === "training").length,
      validation: rows.filter((r) => r.split === "validation").length,
      exposureTrees: exposures.size,
      programExecutions,
      exampleExecutions,
      generationMs: performance.now() - started,
      note: "Experimental subtree-usefulness labels from executed corpus/dream programs, with random and output-close negatives. No final tasks. Alternative useful decompositions can be labeled negative, so this is only a ranking heuristic. Validation is grouped by empirical whole-function signature. Every generated root and sampled fragment must enter future exposure exclusions.",
    },
    null,
    2,
  ),
);
console.log({ rows: rows.length, features: rows[0].x.length });
