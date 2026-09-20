import {
  at,
  expandExpr,
  exprSize,
  formatExpr,
  key,
  paths,
  replace,
  rewrite,
} from "./expressions";
import { inputs } from "./tasks";
import { evalExpr } from "../engine/language";
import type { CorpusEntry, Expr, Macro } from "./types";

export function mine(
  corpus: CorpusEntry[],
  existing: Macro[],
): { macro: Macro; compression: number }[] {
  const candidates = new Map<
    string,
    { body: Expr; arity: number; tasks: Set<string> }
  >();
  for (const entry of corpus) {
    const tree = expandExpr(entry.tree, existing);
    for (const path of paths(tree)) {
      const subtree = at(tree, path);
      if (exprSize(subtree) < 3 || exprSize(subtree) > 15) continue;
      const variations: Expr[] = [subtree];
      // Abstract internal computations too, rather than only renaming x/y.
      for (const hole of paths(subtree).slice(1)) {
        if (at(subtree, hole).args.length)
          variations.push(
            replace(subtree, hole, { op: "arg", value: 2, args: [] }),
          );
      }
      for (const source of variations) {
        const ids = new Map<number, number>();
        const canonical = (e: Expr): Expr => {
          if (e.op === "arg") {
            if (!ids.has(e.value!)) ids.set(e.value!, ids.size);
            return { op: "arg", value: ids.get(e.value!), args: [] };
          }
          return { ...e, args: e.args.map(canonical) };
        };
        const body = canonical(source),
          arity = ids.size;
        if (!arity || arity > 3 || exprSize(body) <= arity + 1) continue;
        const k = key(body),
          known = candidates.get(k);
        if (known) known.tasks.add(entry.task.id);
        else
          candidates.set(k, { body, arity, tasks: new Set([entry.task.id]) });
      }
    }
  }
  const probes = inputs(1771, 25, 4),
    signatures = new Set(
      existing.map((m) =>
        probes
          .map((p) => evalExpr(m.body, [...p, p[0] - p[1]]))
          .map((v) => v.toFixed(6))
          .join(","),
      ),
    );
  const initial = corpus.reduce(
      (s, c) => s + exprSize(rewrite(c.tree, existing)),
      0,
    ),
    out: { macro: Macro; compression: number }[] = [];
  let index = Math.max(0, ...existing.map((m) => Number(m.name.slice(3)))) + 1;
  // Frequency is only cheap ranking, never the acceptance criterion.
  const frequent = [...candidates.values()]
    .filter((c) => c.tasks.size >= 2)
    .sort(
      (a, b) =>
        b.tasks.size * (exprSize(b.body) - b.arity - 1) -
        a.tasks.size * (exprSize(a.body) - a.arity - 1),
    )
    .slice(0, 100);
  for (const c of frequent) {
    const values = probes.map((p) => evalExpr(c.body, [...p, p[0] - p[1]]));
    const signature = values.map((v) => v.toFixed(6)).join(",");
    if (
      signatures.has(signature) ||
      values.every((v) => Math.abs(v - values[0]) < 1e-8)
    )
      continue;
    signatures.add(signature);
    const name = `fn_${index++}`,
      macro: Macro = {
        ...c,
        name,
        support: c.tasks.size,
        sourceTasks: [...c.tasks],
        size: exprSize(c.body),
        definition: `${name}(${["a", "b", "c"].slice(0, c.arity).join(", ")}) = ${formatExpr(c.body, ["a", "b", "c"])}`,
      };
    const compressed = corpus.reduce(
      (s, e) => s + exprSize(rewrite(e.tree, [...existing, macro])),
      0,
    );
    const compression = initial - compressed - macro.size;
    if (compression > 0) out.push({ macro, compression });
  }
  return out.sort((a, b) => b.compression - a.compression);
}
