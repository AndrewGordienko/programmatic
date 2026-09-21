import { Random } from "../engine/random";
import {
  at,
  paths,
  replace,
  exprSize,
  compile,
  key,
  rewrite,
} from "../dsl/expressions";
import { inputs } from "../dsl/tasks";
import type { CorpusEntry, Expr, Macro } from "../dsl/types";
import { context, hole, productions } from "./policy";

export function dreamDataset(
  corpus: CorpusEntry[],
  macros: Macro[],
  seed: number,
  count = 3000,
  options: { commutative?: boolean; lowerIntegerLiterals?: boolean } = {},
) {
  const rng = new Random(seed),
    ps = productions(macros),
    probeInputs = inputs(301, 25, 3);
  let programProposals = 0,
    programExecutions = 0,
    exampleExecutions = 0;
  const random = (depth: number): Expr => {
    const terminal = depth <= 0 || rng.next() < 0.3;
    const p = rng.pick(ps.filter((p) => (terminal ? !p.arity : p.arity > 0)));
    return {
      ...p.node,
      args: Array.from({ length: p.arity }, () => random(depth - 1)),
    };
  };
  const simplify = (e: Expr): Expr => {
    const args = e.args.map(simplify),
      a = args[0],
      b = args[1];
    if (!args.length) return e;
    if (e.op === "neg" && a.op === "neg") return a.args[0];
    if ((e.op === "min" || e.op === "max") && key(a) === key(b)) return a;
    if (e.op === "add" && a.op === "const" && a.value === 0) return b;
    if ((e.op === "add" || e.op === "sub") && b.op === "const" && b.value === 0)
      return a;
    if (e.op === "mul" && a.op === "const" && a.value === 1) return b;
    if (e.op === "mul" && b.op === "const" && b.value === 1) return a;
    return { ...e, args };
  };
  const sources = corpus.map((c) => ({
    ...c,
    tree: rewrite(c.tree, macros, { commutative: options.commutative }),
  }));
  const lower = (e: Expr): Expr => {
    if (
      e.op === "const" &&
      !ps.some((p) => p.node.op === "const" && p.node.value === e.value)
    ) {
      const n = e.value!;
      if (!Number.isInteger(n) || Math.abs(n) > 1000)
        throw new Error("Teacher literal outside bounded integer grammar");
      if (n < 0)
        return {
          op: "neg",
          args: [lower({ op: "const", value: -n, args: [] })],
        };
      return n % 2 === 0
        ? {
            op: "mul",
            args: [
              { op: "const", value: 2, args: [] },
              lower({ op: "const", value: n / 2, args: [] }),
            ],
          }
        : {
            op: "add",
            args: [
              { op: "const", value: 1, args: [] },
              lower({ op: "const", value: n - 1, args: [] }),
            ],
          };
    }
    return { ...e, args: e.args.map(lower) };
  };
  const unique = new Map<
    string,
    {
      tree: Expr;
      examples: CorpusEntry["task"]["examples"];
      source: "corpus" | "dream";
    }
  >();
  const add = (source: Expr, origin: "corpus" | "dream") => {
    programProposals++;
    const tree = simplify(
      options.lowerIntegerLiterals ? lower(source) : source,
    );
    if (exprSize(tree) > 25) return;
    programExecutions++;
    exampleExecutions += probeInputs.length;
    const f = compile(tree, macros),
      outputs = probeInputs.map((input) => f(...input));
    if (
      outputs.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e5) ||
      outputs.every((v) => Math.abs(v - outputs[0]) < 1e-8)
    )
      return;
    const signature = outputs.map((v) => v.toFixed(8)).join(",");
    const old = unique.get(signature);
    if (old && exprSize(old.tree) <= exprSize(tree)) return;
    unique.set(signature, {
      tree,
      examples: probeInputs.map((input, i) => ({ input, output: outputs[i] })),
      source: old?.source === "corpus" ? "corpus" : origin,
    });
  };
  sources.forEach((c) => add(c.tree, "corpus"));
  for (
    let attempt = 0;
    unique.size < count && attempt < count * 30;
    attempt++
  ) {
    let tree = random(2 + rng.int(3));
    if (sources.length && rng.next() < 0.65) {
      const base = rng.pick(sources).tree;
      const donor = rng.pick(sources).tree;
      tree = replace(
        base,
        rng.pick(paths(base)),
        rng.next() < 0.5 ? random(2) : at(donor, rng.pick(paths(donor))),
      );
    }
    if (tree) add(tree, "dream");
  }
  const decisions: {
    x: number[];
    y: number;
    program: number;
    source: string;
    split: string;
  }[] = [];
  const programs = [...unique.values()];
  programs.forEach((row, program) => {
    const split =
      row.source === "dream" && program % 10 === 0 ? "validation" : "training";
    let partial = hole();
    for (const path of paths(row.tree)) {
      const e = at(row.tree, path),
        y = ps.findIndex((p) => p.node.op === e.op && p.node.value === e.value);
      if (y < 0) throw new Error("Unavailable teacher production");
      decisions.push({
        x: context(row.examples, partial, path, ps, macros),
        y,
        program,
        source: row.source,
        split,
      });
      partial = replace(partial, path, ps[y].node);
    }
  });
  return {
    version:
      options.commutative || options.lowerIntegerLiterals
        ? "semantic-dream-data-v2"
        : "semantic-dream-data-v1",
    library: macros,
    accounting: {
      programProposals,
      programExecutions,
      exampleExecutions,
      partialFeatureProbes: decisions.length * 6,
      teacherDecisions: decisions.length,
    },
    seed,
    requested: count,
    semantics: ps.map((p) => [...p.semantic, 1]),
    programs: programs.map((p, i) => ({
      id: i,
      tree: p.tree,
      source: p.source,
    })),
    decisions,
  };
}
