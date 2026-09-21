import { Random } from "../engine/random";
import type { Macro } from "../dsl/types";
import { genome, type Genome } from "./genome";

/** Reserve every one-edit addition to the incumbent before filling a population
 * with other parents, replacements and crossover. No concept identities enter. */
export function languagePopulation(
  parents: Genome[],
  pool: Macro[],
  seed: number,
  count: number,
  corpusSize: number,
): Genome[] {
  if (!parents.length || count < parents.length + pool.length + 1)
    throw new Error("Population too small to retain incumbent additions");
  const out = new Map<string, Genome>(),
    rng = new Random(seed);
  const put = (macros: Macro[], edit: string, from: string[]) => {
    const g = genome(macros, edit, from, corpusSize);
    if (out.size < count && !out.has(g.id)) out.set(g.id, g);
  };
  const refreshed = parents.map((p) =>
    genome(
      p.macros.map((m) => pool.find((n) => n.name === m.name) ?? m),
      "retain",
      [p.id],
      corpusSize,
    ),
  );
  put([], "base", []);
  refreshed.forEach((p) => put(p.macros, "retain", p.parents));
  const incumbent = refreshed[0];
  if (incumbent.macros.length < 4)
    for (const m of pool)
      put([...incumbent.macros, m], "incumbent-add", [incumbent.id]);
  for (const m of pool) put([m], "single", []);
  for (const p of refreshed) {
    for (let i = 0; i < p.macros.length; i++)
      put(
        p.macros.filter((_, j) => i !== j),
        "delete",
        [p.id],
      );
    if (p.macros.length < 4)
      for (const m of pool) put([...p.macros, m], "parent-add", [p.id]);
  }
  for (let attempt = 0; out.size < count && attempt < count * 100; attempt++) {
    const p = rng.pick(refreshed),
      q = rng.pick(refreshed);
    let ms = [...p.macros],
      edit: string;
    const action = rng.int(4);
    if (action === 0) {
      ms = [
        ...ms,
        ...Array.from({ length: 1 + rng.int(2) }, () => rng.pick(pool)),
      ];
      edit = "multi-add";
    } else if (action === 1) {
      if (ms.length) ms[rng.int(ms.length)] = rng.pick(pool);
      else ms.push(rng.pick(pool));
      edit = "replace";
    } else if (action === 2) {
      ms = [...ms, ...q.macros].filter(() => rng.next() < 0.7);
      edit = "crossover";
    } else {
      ms = Array.from({ length: 1 + rng.int(4) }, () => rng.pick(pool));
      edit = "explore";
    }
    put(ms, edit, [p.id, q.id]);
  }
  return [...out.values()];
}
