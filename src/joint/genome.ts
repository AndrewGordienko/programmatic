import { Random } from "../engine/random";
import {
  at,
  paths,
  replace,
  exprSize,
  formatExpr,
  key,
  evalExpr,
  validLibrary,
  expandExpr,
} from "../dsl/expressions";
import { mine } from "../dsl/mining";
import {
  BASE,
  ARITY,
  type Expr,
  type Macro,
  type CorpusEntry,
} from "../dsl/types";
import { PROBES } from "./policy";
import { canonical as normalizeExpression } from "./canonical";
import { aliasesBase } from "./semantics";
export type Genome = {
  id: string;
  macros: Macro[];
  edit: string;
  parents: string[];
  features: number[];
};
const hash = (s: string) => {
  let n = 2166136261;
  for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
};
const arg = (value: number): Expr => ({ op: "arg", value, args: [] });
export const signature = (body: Expr) =>
  PROBES.map((xs) => evalExpr(body, xs))
    .map((v) => v.toFixed(6))
    .join(",");
export function abstraction(
  source: Expr,
  support = 0,
  sourceTasks: string[] = [],
  normalized = false,
): Macro | null {
  if (normalized) source = normalizeExpression(source);
  const ids = new Map<number, number>();
  const canonical = (e: Expr): Expr => {
    if (e.op === "arg") {
      if (!ids.has(e.value!)) ids.set(e.value!, ids.size);
      return arg(ids.get(e.value!)!);
    }
    return { ...e, args: e.args.map(canonical) };
  };
  const body = canonical(source),
    arity = ids.size,
    size = exprSize(body),
    name = `fn_${hash(key(body))}`;
  const macro = {
    name,
    body,
    arity,
    support,
    sourceTasks,
    size,
    definition: `${name}(${["a", "b", "c"].slice(0, arity).join(", ")}) = ${formatExpr(body, ["a", "b", "c"])}`,
  };
  if (!validLibrary([macro]) || size < 3) return null;
  if (normalized && aliasesBase(macro)) return null;
  const values = PROBES.map((xs) => evalExpr(body, xs));
  if (
    values.some((v) => !Number.isFinite(v)) ||
    values.every((v) => Math.abs(v - values[0]) < 1e-8)
  )
    return null;
  if (
    Array.from({ length: arity }, (_, i) => i).some((i) =>
      values.every((v, j) => Math.abs(v - PROBES[j][i]) < 1e-8),
    )
  )
    return null;
  return macro;
}
export function genome(
  ms: Macro[],
  edit = "base",
  parents: string[] = [],
  corpusSize = 0,
): Genome {
  const seen = new Set<string>();
  const macros = ms
    .filter((m) => {
      const s = signature(m.body);
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    })
    .slice(0, 4)
    .sort((a, b) => a.name.localeCompare(b.name));
  const n = macros.length;
  return {
    id: "L" + hash(macros.map((m) => key(m.body)).join("|")),
    macros,
    edit,
    parents,
    features: [
      n,
      macros.reduce((s, m) => s + m.size, 0),
      macros.reduce((s, m) => s + m.arity, 0) / Math.max(1, n),
      macros.reduce((s, m) => s + m.support, 0),
      Math.max(0, ...macros.map((m) => m.support)),
      corpusSize,
      new Set(macros.flatMap((m) => paths(m.body).map((p) => at(m.body, p).op)))
        .size,
      macros.reduce((s, m) => s + m.size - m.arity - 1, 0),
    ],
  };
}
/** Proposals can cross valleys by adding pairs/crossing whole libraries. Every
 * definition expands to the same bounded base algebra; types are not evolved. */
export function propose(
  population: Genome[],
  corpus: CorpusEntry[],
  seed: number,
  count: number,
  options: { normalized?: boolean } = {},
): Genome[] {
  const rng = new Random(seed),
    pool: Macro[] = [];
  const add = (e: Expr, support = 0, sources: string[] = []) => {
    const m = abstraction(e, support, sources, options.normalized);
    if (!m) return;
    const old = pool.findIndex((p) => signature(p.body) === signature(m.body));
    if (old < 0) pool.push(m);
    else if (options.normalized && m.size < pool[old].size)
      pool[old] = {
        ...m,
        support: Math.max(m.support, pool[old].support),
        sourceTasks: [...new Set([...m.sourceTasks, ...pool[old].sourceTasks])],
      };
  };
  for (const { macro } of mine(corpus, []))
    add(macro.body, macro.support, macro.sourceTasks);
  const mined = [...pool];
  // All synthesized subtrees may contribute, including rare ones; no hidden target syntax.
  for (const c of corpus)
    for (const p of paths(c.tree)) add(at(c.tree, p), 1, [c.task.id]);
  for (const l of population)
    for (const m of l.macros) add(m.body, m.support, m.sourceTasks);
  const random = (depth: number): Expr => {
    if (depth <= 0 || rng.next() < 0.35)
      return rng.next() < 0.7
        ? arg(rng.int(2))
        : { op: "const", value: rng.pick([-2, -1, 0, 1, 2]), args: [] };
    const op = rng.pick(BASE);
    return {
      op,
      args: Array.from({ length: ARITY[op] }, () => random(depth - 1)),
    };
  };
  for (let i = 0; i < 160; i++) add(random(2 + rng.int(2)));
  const out = new Map(
    population.map((p) => [
      p.id,
      genome(p.macros, "retain", [p.id], corpus.length),
    ]),
  );
  if (options.normalized) {
    // Retain mined candidates in the proposal set instead of hoping mutation
    // happens to sample them. Ranking still uses no oracle concept labels.
    for (const m of mined.slice(0, Math.min(32, count - 1))) {
      if (out.size >= count) break;
      const g = genome([m], "mined-single", [], corpus.length);
      out.set(g.id, g);
    }
    for (let i = 0; i < Math.min(8, mined.length); i++)
      for (let j = i + 1; j < Math.min(8, mined.length); j++)
        if (out.size < count) {
          const g = genome(
            [mined[i], mined[j]],
            "mined-pair",
            [],
            corpus.length,
          );
          out.set(g.id, g);
        }
  }
  for (let attempt = 0; out.size < count && attempt < count * 100; attempt++) {
    const parent = rng.pick(population),
      other = rng.pick(population),
      ms = [...parent.macros];
    const operation = rng.pick([
      "add",
      "delete",
      "generalize",
      "specialize",
      "merge",
      "add-pair",
      "replace",
      "crossover",
    ]);
    if (operation === "delete") ms.splice(rng.int(ms.length), 1);
    else if (operation === "crossover")
      ms.push(...other.macros.filter(() => rng.next() < 0.65));
    else if (operation === "add" || operation === "add-pair") {
      if (pool.length) ms.push(rng.pick(pool));
      if (operation === "add-pair" && pool.length) ms.push(rng.pick(pool));
    } else if (pool.length) {
      const base = rng.pick(ms.length ? ms : pool),
        path = rng.pick(paths(base.body));
      let body: Expr;
      if (operation === "generalize")
        body = replace(base.body, path, arg(base.arity));
      else if (operation === "specialize")
        body = replace(base.body, path, {
          op: "const",
          value: rng.pick([-1, 0, 1]),
          args: [],
        });
      else if (operation === "merge")
        body = replace(base.body, path, rng.pick(pool).body);
      else body = replace(base.body, path, random(2));
      const m = abstraction(expandExpr(body, []), 0, [], options.normalized);
      if (!m) continue;
      if (operation === "replace" && ms.length)
        ms.splice(rng.int(ms.length), 1);
      ms.push(m);
    }
    const candidate = genome(
      ms,
      operation,
      operation === "crossover" ? [parent.id, other.id] : [parent.id],
      corpus.length,
    );
    if (!out.has(candidate.id)) out.set(candidate.id, candidate);
  }
  return [...out.values()];
}
