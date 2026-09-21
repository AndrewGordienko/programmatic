import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  compile,
  expandExpr,
  exprSize,
  replace,
  key,
} from "../src/dsl/expressions";
import { inputs } from "../src/dsl/tasks";
import type { Expr, Macro } from "../src/dsl/types";
import { context, hole, productions } from "../src/joint/policy";
import { inverseBox } from "../src/joint/inverse";
import {
  inverseApplied,
  inversePieces,
  linearPieces,
  type Box,
} from "../src/joint/domains";
import { fullObservationContext } from "../src/joint/full-context";
import { createHash } from "node:crypto";

const folder = "output/joint/neural-full-v1";
if (existsSync(`${folder}/data.json.gz`)) throw new Error("Preserve dataset");
const source: {
  library: Macro[];
  programs: { id: number; tree: Expr; source: "corpus" | "dream" }[];
} = JSON.parse(
  gunzipSync(readFileSync("output/joint/neural-v2/data.json.gz")).toString(),
);
const started = performance.now(),
  all = productions(source.library),
  xs = [...inputs(301, 25, 3), ...inputs(602, 50, 5)];
const decisions: {
  x: number[];
  y: number;
  program: number;
  source: string;
  split: string;
  legal: boolean[];
}[] = [];
const exposures = new Map<string, Expr>();
let programExecutions = 0,
  exampleExecutions = 0,
  inverseDerivations = 0,
  omitted = 0;
const execute = (tree: Expr, ms: Macro[]) => {
  programExecutions++;
  exampleExecutions += xs.length;
  const f = compile(tree, ms);
  return xs.map((x) => f(...x));
};
for (const program of source.programs) {
  const expanded = expandExpr(program.tree, source.library);
  if (exprSize(expanded) > 96) {
    omitted++;
    continue;
  }
  for (const library of [[], source.library]) {
    const ps = productions(library),
      tree = library.length ? program.tree : expanded;
    const outputs = execute(tree, library),
      examples = xs.map((input, i) => ({ input, output: outputs[i] }));
    const legal = all.map((p) => ps.some((a) => a.id === p.id));
    const f = compile(expanded, []);
    const signature = inputs(903141, 97, 7)
      .map((x) => f(...x).toFixed(6))
      .join(",");
    const split =
      parseInt(
        createHash("sha256").update(signature).digest("hex").slice(0, 8),
        16,
      ) %
        10 ===
      0
        ? "validation"
        : "training";
    let e = tree,
      partial = hole(),
      path: number[] = [],
      spec: Box | null = { low: outputs, high: outputs };
    for (let depth = 0; depth < 16 && spec; depth++) {
      const y = all.findIndex(
        (p) => p.node.op === e.op && p.node.value === e.value,
      );
      if (y < 0)
        throw new Error(`Unavailable inverse teacher production: ${key(e)}`);
      decisions.push({
        x: [
          ...context(examples, partial, path, ps, library),
          ...fullObservationContext(examples, spec),
        ],
        y,
        program: program.id,
        source: program.source,
        split,
        legal,
      });
      exposures.set(key(e), e);
      if (!e.args.length) break;
      const known = e.args.slice(0, -1),
        values = known.map((a) => execute(a, library));
      const macro = library.find((m) => m.name === e.op);
      if (macro) {
        if (macro.arity === 1) {
          const pieces = linearPieces(macro.body);
          inverseDerivations++;
          spec = pieces ? inversePieces(pieces, spec) : null;
        } else
          spec = inverseApplied(macro.body, values, spec, () => {
            inverseDerivations++;
            return true;
          });
      } else {
        inverseDerivations++;
        spec = inverseBox(e.op, spec, values[0]);
      }
      partial = replace(partial, path, { op: e.op, args: [...known, hole()] });
      path = [...path, e.args.length - 1];
      e = e.args.at(-1)!;
    }
  }
}
const data = {
  version: "inverse-teacher-data-v1",
  contextKind: "full-observations-v1",
  seed: 90121,
  semantics: all.map((p) => [...p.semantic, 1]),
  library: source.library,
  programs: source.programs,
  exposureTrees: [...exposures.values()],
  decisions: decisions.map(({ x, ...row }) => row),
  featureShape: [decisions.length, decisions[0].x.length],
  featureFile: "features.f32.gz",
  accounting: {
    programExecutions,
    exampleExecutions,
    signatureProgramExecutions: 2 * (source.programs.length - omitted),
    signatureExampleExecutions: 194 * (source.programs.length - omitted),
    inverseDerivations,
    partialFeatureProbes: decisions.length * 6,
    omittedExpandedPrograms: omitted,
  },
};
mkdirSync(folder, { recursive: true });
const flat = new Float32Array(decisions.length * decisions[0].x.length);
for (let i = 0; i < decisions.length; i++)
  flat.set(decisions[i].x, i * decisions[0].x.length);
writeFileSync(`${folder}/features.f32.gz`, gzipSync(Buffer.from(flat.buffer)));
writeFileSync(`${folder}/data.json.gz`, gzipSync(JSON.stringify(data)));
writeFileSync(
  `${folder}/data-manifest.json`,
  JSON.stringify(
    {
      version: data.version,
      contextKind: data.contextKind,
      source: "output/joint/neural-v2/data.json.gz",
      programs: source.programs.length,
      decisions: decisions.length,
      exposureTrees: exposures.size,
      features: decisions[0].x.length,
      accounting: data.accounting,
      generationMs: performance.now() - started,
      note: "Paired base/library representations of executed programs. Teacher traverses the rightmost unknown child with actual inverse constraints and known sibling programs. Whole-function empirical signatures group both representations and every source in the same training/validation split. All 75 observations, including inputs, and hole specifications enter the policy. Float32 binary features avoid excessive JSON storage. Legal-production masks remove unavailable macro actions. Final tasks are not used; exposure audit must include all recorded teacher subprograms.",
    },
    null,
    2,
  ),
);
console.log({
  decisions: decisions.length,
  features: decisions[0].x.length,
  exposures: exposures.size,
  omitted,
});
