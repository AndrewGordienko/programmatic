import {
  at,
  paths,
  key,
  exprSize,
  rewrite,
  expandExpr,
} from "../dsl/expressions";
import type { Expr, CorpusEntry, Macro } from "../dsl/types";
import { canonical } from "./canonical";
import { abstraction, signature } from "./genome";

/** Equality-aware abstraction: one parameter replaces EVERY occurrence of the
 * same computation. There are no domain concept templates or target programs.
 * Unlike replacing a single AST occurrence, this preserves argument sharing. */
export function sharedAbstractions(tree: Expr): Expr[] {
  const out = new Map<string, Expr>();
  const put = (e: Expr) => {
    if (exprSize(e) <= 15) out.set(key(e), e);
  };
  for (const path of paths(tree)) {
    const source = at(tree, path);
    if (exprSize(source) < 3) continue;
    put(source);
    const parts = [
      ...new Map(
        paths(source)
          .slice(1)
          .map((p) => {
            const e = at(source, p);
            return [key(e), e] as const;
          }),
      ).values(),
    ].filter((e) => e.op !== "const");
    const abstract = (targets: Expr[]) => {
      const visit = (e: Expr): Expr => {
        const i = targets.findIndex((t) => key(t) === key(e));
        return i >= 0
          ? { op: "arg", value: 2 + i, args: [] }
          : { ...e, args: e.args.map(visit) };
      };
      put(visit(source));
    };
    for (let i = 0; i < parts.length; i++) {
      abstract([parts[i]]);
      for (let j = i + 1; j < parts.length; j++) abstract([parts[i], parts[j]]);
    }
  }
  return [...out.values()];
}

export function inventions(
  corpus: CorpusEntry[],
  options: { count?: number; maxArity?: number } = {},
): { macro: Macro; compression: number }[] {
  const normalized = corpus.map((c) => ({
    ...c,
    tree: canonical(expandExpr(c.tree, [])),
  }));
  const candidates = new Map<string, Macro>();
  for (const entry of normalized)
    for (const body of sharedAbstractions(entry.tree)) {
      const m = abstraction(body, 1, [entry.task.id], true);
      if (!m || m.arity > (options.maxArity ?? 3)) continue;
      const sig = signature(m.body),
        old = candidates.get(sig);
      if (!old) candidates.set(sig, m);
      else {
        const sources = [...new Set([...old.sourceTasks, entry.task.id])];
        candidates.set(sig, {
          ...(m.size < old.size ? m : old),
          support: sources.length,
          sourceTasks: sources,
        });
      }
    }
  const initial = normalized.reduce((s, c) => s + exprSize(c.tree), 0);
  // Compression is only a proposal rank. Selection must run fresh synthesis.
  return [...candidates.values()]
    .filter((m) => m.support >= 2)
    .sort(
      (a, b) =>
        b.support * (b.size - b.arity - 1) - a.support * (a.size - a.arity - 1),
    )
    .slice(0, 256)
    .map((macro) => ({
      macro,
      compression:
        initial -
        normalized.reduce(
          (s, c) =>
            s + exprSize(rewrite(c.tree, [macro], { commutative: true })),
          0,
        ) -
        macro.size,
    }))
    .filter((r) => r.compression > 0)
    .sort((a, b) => b.compression - a.compression)
    .slice(0, options.count ?? 100);
}
