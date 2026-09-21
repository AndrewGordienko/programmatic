import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { inputs } from "../src/dsl/tasks";
import {
  compile,
  expandExpr,
  exprSize,
  rewrite,
  paths,
  at,
  key,
} from "../src/dsl/expressions";
import type { Expr, Macro } from "../src/dsl/types";
import { inverseSearch } from "../src/joint/inverse";
import { productions } from "../src/joint/policy";
import { contains } from "../src/joint/domains";
const folder = "output/joint/neural-visited-v1";
if (existsSync(`${folder}/data.json.gz`))
  throw new Error("Preserve visited-state data");
const source: { programs: { tree: Expr; source: string }[]; library: Macro[] } =
  JSON.parse(
    gunzipSync(readFileSync("output/joint/neural-v2/data.json.gz")).toString(),
  );
const policy = JSON.parse(
  readFileSync("output/joint/neural/policy.json", "utf8"),
);
const all = productions(source.library),
  xs = [...inputs(301, 25, 3), ...inputs(602, 50, 5)],
  probes = inputs(903141, 97, 7);
const started = performance.now();
const lower = (e: Expr): Expr => {
  if (e.op === "const" && Math.abs(e.value!) > 2) {
    const n = e.value!;
    if (!Number.isInteger(n) || Math.abs(n) > 1000)
      throw new Error("Literal range");
    return n < 0
      ? { op: "neg", args: [lower({ ...e, value: -n })] }
      : n % 2 === 0
        ? {
            op: "mul",
            args: [
              { op: "const", value: 2, args: [] },
              lower({ ...e, value: n / 2 }),
            ],
          }
        : {
            op: "add",
            args: [
              { op: "const", value: 1, args: [] },
              lower({ ...e, value: n - 1 }),
            ],
          };
  }
  return { ...e, args: e.args.map(lower) };
};
const seeds = [];
for (let seed = 0; seed < 12; seed++) {
  const r = JSON.parse(
    gunzipSync(
      readFileSync(`output/joint/replication-v1/seed-${seed}.json.gz`),
    ).toString(),
  );
  seeds.push(
    ...r.corpus.map((c: { tree: Expr }) => ({
      tree: lower(rewrite(c.tree, source.library, { commutative: true })),
      source: "corpus",
    })),
  );
}
seeds.push(
  ...source.programs.filter((p) => p.source === "dream").slice(0, 2000),
);
const programs: {
    tree: Expr;
    source: string;
    signature: string;
    split: string;
  }[] = [],
  seen = new Set<string>();
let signatureExecutions = 0;
for (const row of seeds) {
  const tree = expandExpr(row.tree, source.library);
  if (exprSize(tree) > 96) continue;
  const f = compile(tree, []),
    signature = probes.map((x) => f(...x).toFixed(6)).join(",");
  signatureExecutions++;
  if (seen.has(signature)) continue;
  seen.add(signature);
  const split =
    parseInt(
      createHash("sha256").update(signature).digest("hex").slice(0, 8),
      16,
    ) %
      10 ===
    0
      ? "validation"
      : "training";
  programs.push({ ...row, signature, split });
}
const rows: {
  x: number[];
  positive: boolean[];
  legal: boolean[];
  witness: boolean;
  size: number;
  program: number;
  source: string;
  split: string;
}[] = [];
const cost = {
  signatureExecutions,
  signaturePoints: signatureExecutions * 97,
  searches: 0,
  evaluations: 0,
  expansions: 0,
  searchMs: 0,
  witnessProgramExecutions: 0,
  witnessPointExecutions: 0,
  witnessComparisons: 0,
  featureProbes: 0,
};
const exposures = new Map<string, Expr>();
for (let id = 0; id < programs.length; id++) {
  const p = programs[id],
    expanded = expandExpr(p.tree, source.library);
  for (const macros of [[], source.library]) {
    const tree = macros.length ? p.tree : expanded,
      ps = productions(macros),
      f = compile(tree, macros);
    const examples = xs.map((input) => ({ input, output: f(...input) }));
    cost.witnessProgramExecutions++;
    cost.witnessPointExecutions += xs.length;
    const result = inverseSearch(
      { examples, checks: examples },
      macros,
      id % 2 ? policy : undefined,
      71813 + id * 97,
      512,
      {
        diverseBeam: true,
        affineDifferences: 32,
        maxNodes: 96,
        semanticRank: 2,
        affineFits: 512,
        fitDedup: true,
        primitiveDifferences: true,
        macroForward: 48,
        macroBindings: 8,
        traceStates: true,
      },
    );
    cost.searches++;
    cost.evaluations += result.evaluations;
    cost.expansions += result.expansions;
    cost.searchMs += result.elapsedMs;
    const witnesses = [
      ...new Map(
        paths(tree).map((path) => {
          const node = at(tree, path);
          return [key(node), node] as const;
        }),
      ).values(),
    ].map((node) => {
      const n = expandExpr(node, macros);
      exposures.set(key(n), n);
      const execute = compile(node, macros);
      cost.witnessProgramExecutions++;
      cost.witnessPointExecutions += xs.length;
      return {
        values: xs.map((x) => execute(...x)),
        size: exprSize(node),
        label: all.findIndex(
          (p) => p.node.op === node.op && p.node.value === node.value,
        ),
      };
    });
    const legal = all.map((p) => ps.some((q) => p.id === q.id));
    // Training witnesses are used only after search stops. Failure to find a
    // witness is a weak negative, never a proof of semantic infeasibility.
    for (const state of result.traceStates ?? []) {
      const matched = witnesses.filter(
        (w) =>
          w.label >= 0 &&
          w.values.every((v, i) => {
            cost.witnessComparisons++;
            return contains(state.spec, i, v);
          }),
      );
      rows.push({
        x: state.x,
        positive: all.map((_, i) => matched.some((w) => w.label === i)),
        legal,
        witness: !!matched.length,
        size: Math.min(96, ...matched.map((w) => w.size)),
        program: id,
        source: p.source,
        split: p.split,
      });
      cost.featureProbes += 6;
    }
  }
  if (id % 200 === 0)
    console.log({ program: id, total: programs.length, states: rows.length });
}
mkdirSync(folder, { recursive: true });
const flat = new Float32Array(rows.length * 671);
rows.forEach((r, i) => flat.set(r.x, i * 671));
writeFileSync(`${folder}/features.f32.gz`, gzipSync(Buffer.from(flat.buffer)));
writeFileSync(
  `${folder}/data.json.gz`,
  gzipSync(
    JSON.stringify({
      version: "visited-search-witness-v1",
      contextKind: "full-observations-v1",
      library: source.library,
      semantics: all.map((p) => [...p.semantic, 1]),
      programs,
      exposureTrees: [...exposures.values()],
      featureFile: "features.f32.gz",
      featureShape: [rows.length, 671],
      decisions: rows.map(({ x, ...r }) => r),
    }),
  ),
);
writeFileSync(
  `${folder}/data-manifest.json`,
  JSON.stringify(
    {
      programs: programs.length,
      states: rows.length,
      positive: rows.filter((r) => r.witness).length,
      cost,
      generationMs: performance.now() - started,
      note: "States visited by the existing solver on synthesized training programs and executed dreams. Known witness subtrees label feasible productions after synthesis; missing witnesses are weak negatives, not impossibility proofs. Whole-function signatures partition training/validation. No final targets or check feedback guide trajectories. Wider state features and all witness executions are charged separately. Future evaluation must exclude all exposed roots and subtrees.",
    },
    null,
    2,
  ),
);
console.log({
  states: rows.length,
  positive: rows.filter((r) => r.witness).length,
});
