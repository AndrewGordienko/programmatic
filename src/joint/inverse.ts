import { Random } from "../engine/random";
import {
  compile,
  exprSize,
  expandExpr,
  formatExpr,
  key,
  replace,
  paths,
  at,
} from "../dsl/expressions";
import type { Expr, Macro, Task } from "../dsl/types";
import {
  context,
  encoder,
  hole,
  productions,
  type JointPolicy,
} from "./policy";
import { canonical } from "./canonical";
import type { SearchResult } from "./search";
import { additiveJoin } from "./joins";
import { specificationFeatures } from "./specification";
import {
  type Box,
  type Domain,
  domainAt,
  contains,
  boxFrom,
  intersect,
  linearPieces,
  inversePieces,
  inverseApplied,
} from "./domains";

type Fragment = { tree: Expr; values: number[]; error: number; size: number };
export type InverseResult = SearchResult & {
  linearFits: number;
  inverseSteps: number;
  constraintChecks: number;
  constraintPoints: number;
  bankSize: number;
};
const c = (value: number): Expr => ({ op: "const", value, args: [] });
const a = (value: number): Expr => ({ op: "arg", value, args: [] });
const integer = (n: number): Expr =>
  Math.abs(n) <= 2
    ? c(n)
    : n < 0
      ? { op: "neg", args: [integer(-n)] }
      : n % 2 === 0
        ? { op: "mul", args: [c(2), integer(n / 2)] }
        : { op: "add", args: [c(1), integer(n - 1)] };
const plane = (coeff: number[]): Expr => {
  const leading = coeff.find((v) => v !== 0) ?? 0;
  if (leading < 0)
    return canonical({ op: "neg", args: [plane(coeff.map((v) => -v))] });
  const terms = [
    { op: "mul", args: [integer(coeff[0]), a(0)] },
    { op: "mul", args: [integer(coeff[1]), a(1)] },
    integer(coeff[2]),
  ];
  return canonical({
    op: "add",
    args: [{ op: "add", args: terms.slice(0, 2) }, terms[2]],
  });
};
const boxKey = (b: Box) =>
  b.ranges
    ? b.ranges
        .map((ds) =>
          ds.map(([l, h]) => `${l.toFixed(7)}:${h.toFixed(7)}`).join(";"),
        )
        .join("|")
    : b.low.map((v, i) => `${v.toFixed(7)}:${b.high[i].toFixed(7)}`).join("|");

// Invert an actual base production with one known argument. The result is an
// interval specification for the missing child, not a guessed target program.
export function inverseBox(
  op: string,
  target: Box,
  known?: number[],
): Box | null {
  if (target.ranges)
    return boxFrom(
      target.ranges.map((ds, i) =>
        ds.flatMap(([l, h]) => {
          const b = inverseBox(
            op,
            { low: [l], high: [h] },
            known ? [known[i]] : undefined,
          );
          return b ? [[b.low[0], b.high[0]] as [number, number]] : [];
        }),
      ),
    );
  const low: number[] = [],
    high: number[] = [];
  for (let i = 0; i < target.low.length; i++) {
    const l = target.low[i],
      h = target.high[i],
      x = known?.[i] ?? 0;
    let lo: number, hi: number;
    if (op === "neg") {
      lo = -h;
      hi = -l;
    } else if (op === "add") {
      lo = l - x;
      hi = h - x;
    } else if (op === "sub") {
      lo = x - h;
      hi = x - l;
    } else if (op === "mul") {
      if (x === 0) {
        if (l > 1e-7 || h < -1e-7) return null;
        lo = -Infinity;
        hi = Infinity;
      } else {
        lo = Math.min(l / x, h / x);
        hi = Math.max(l / x, h / x);
      }
    } else if (op === "max") {
      if (x > h + 1e-7) return null;
      lo = x < l - 1e-7 ? l : -Infinity;
      hi = h;
    } else if (op === "min") {
      if (x < l - 1e-7) return null;
      lo = l;
      hi = x > h + 1e-7 ? h : Infinity;
    } else return null;
    low.push(lo);
    high.push(hi);
  }
  return { low, high };
}

/** Domain-specific scalar synthesis experiment. Affine proposals are inferred
 * from I/O triples, assembled solely from base arithmetic, and all executed
 * programs are charged. No abs/clamp templates or target ASTs are supplied. */
export function inverseSearch(
  task: Pick<Task, "examples" | "checks">,
  macros: Macro[],
  policy: JointPolicy | undefined,
  seed: number,
  budget: number,
  options: {
    workBudget?: number;
    affineFits?: number;
    depth?: number;
    beam?: number;
    relational?: boolean | "monotone";
    diverseBeam?: boolean;
    affineDifferences?: number;
    maxNodes?: number;
    semanticRank?: number;
    fitDedup?: boolean;
    primitiveDifferences?: boolean;
    macroForward?: number;
    macroBindings?: number;
    joinBudget?: number;
    envelopePlanes?: number;
  } = {},
): InverseResult {
  if (!Number.isInteger(budget) || budget < 1)
    throw new Error("Positive budget required");
  const start = performance.now(),
    rng = new Random(seed),
    limit = options.workBudget ?? budget * 8;
  const maxNodes = options.maxNodes ?? 31;
  let evaluations = 0,
    expansions = 0,
    linearFits = 0,
    inverseSteps = 0,
    constraintChecks = 0,
    constraintPoints = 0,
    duplicates = 0;
  let best: Fragment | undefined, answer: Expr | undefined;
  const bank: Fragment[] = [],
    syntax = new Map<string, Fragment>(),
    behavior = new Set<string>();
  const fittedPlanes = new Map<string, number[]>();
  const relations = new Map(
    macros
      .filter((m) => m.arity === 1 && options.relational)
      .map((m) => {
        const pieces = linearPieces(m.body);
        return [
          m.name,
          options.relational === "monotone" &&
          pieces &&
          !pieces.every((p) => p.a >= 0) &&
          !pieces.every((p) => p.a <= 0)
            ? null
            : pieces,
        ] as const;
      }),
  );
  const charge = () => {
    if (expansions >= limit) return false;
    expansions++;
    return true;
  };
  const evaluate = (tree: Expr, add = true): Fragment | undefined => {
    if (evaluations >= budget || (add && expansions >= limit)) return;
    if (exprSize(tree) > maxNodes || exprSize(expandExpr(tree, macros)) > 96)
      return;
    evaluations++;
    const k = key(tree);
    if (syntax.has(k)) {
      duplicates++;
      return syntax.get(k);
    }
    const f = compile(tree, macros),
      values = task.examples.map((e) => f(...e.input));
    const error =
      values.reduce(
        (s, v, i) => s + Math.min(1e6, Math.abs(v - task.examples[i].output)),
        0,
      ) / values.length;
    const row = { tree, values, error, size: exprSize(tree) };
    syntax.set(k, row);
    if (
      !best ||
      error < best.error ||
      (error === best.error && row.size < best.size)
    )
      best = row;
    if (error < 1e-8) answer = tree;
    const signature = values.map((v) => v.toFixed(8)).join(",");
    if (add && !behavior.has(signature) && values.every(Number.isFinite)) {
      bank.push(row);
      behavior.add(signature);
    }
    return row;
  };
  for (const tree of [a(0), a(1), ...[-2, -1, 0, 1, 2].map(c)]) {
    evaluate(tree);
    if (answer) break;
  }
  // Parameter estimation is a search heuristic, not a new executable primitive.
  for (
    let fit = 0;
    !answer && fit < (options.affineFits ?? 128) && charge();
    fit++
  ) {
    linearFits++;
    const es = [
      rng.pick(task.examples),
      rng.pick(task.examples),
      rng.pick(task.examples),
    ];
    const [p, q, r] = es,
      [x, y] = p.input,
      dx = q.input[0] - x,
      dy = q.input[1] - y,
      ex = r.input[0] - x,
      ey = r.input[1] - y;
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-9) continue;
    const dz = q.output - p.output,
      ez = r.output - p.output;
    const alpha = (dz * ey - dy * ez) / det,
      beta = (dx * ez - dz * ex) / det,
      gamma = p.output - alpha * x - beta * y;
    const raw = [alpha, beta, gamma],
      coeff = raw.map(Math.round);
    if (
      raw.some((v, i) => Math.abs(v - coeff[i]) > 1e-6) ||
      coeff.some((v) => Math.abs(v) > 8)
    )
      continue;
    // Support screening itself executes a complete candidate. Charge it before
    // deciding whether this fragment belongs in the bank.
    const fittedTree = plane(coeff);
    const row =
      (options.fitDedup ? syntax.get(key(fittedTree)) : undefined) ??
      evaluate(fittedTree, false);
    if (!row) continue;
    const support = row.values.filter(
      (v, i) => Math.abs(v - task.examples[i].output) < 1e-7,
    ).length;
    const signature = row.values.map((v) => v.toFixed(8)).join(",");
    if (support >= 4 && !behavior.has(signature)) {
      bank.push(row);
      behavior.add(signature);
    }
    if (support >= 4) fittedPlanes.set(coeff.join(","), coeff);
  }
  if (options.envelopePlanes && !answer) {
    const grid = Array.from({ length: 17 }, (_, i) => i - 8),
      slopes = grid
        .flatMap((alpha) => grid.map((beta) => ({ alpha, beta })))
        .sort(
          (a, b) =>
            Math.abs(a.alpha) +
            Math.abs(a.beta) -
            Math.abs(b.alpha) -
            Math.abs(b.beta),
        );
    let proposed = 0;
    for (const { alpha, beta } of slopes) {
      if (proposed >= options.envelopePlanes || answer || !charge()) break;
      linearFits++;
      let lo = Infinity,
        hi = -Infinity;
      for (const e of task.examples) {
        constraintPoints++;
        const residual = e.output - alpha * e.input[0] - beta * e.input[1];
        lo = Math.min(lo, residual);
        hi = Math.max(hi, residual);
      }
      for (const bound of [lo, hi]) {
        const gamma = Math.round(bound);
        if (Math.abs(gamma - bound) > 1e-6 || Math.abs(gamma) > 8) continue;
        const coeff = [alpha, beta, gamma],
          tree = plane(coeff);
        if (syntax.has(key(tree))) continue;
        if (proposed >= options.envelopePlanes) break;
        proposed++;
        const row = evaluate(tree, false);
        if (!row) continue;
        const support = row.values.filter(
          (v, i) => Math.abs(v - task.examples[i].output) < 1e-7,
        ).length;
        const signature = row.values.map((v) => v.toFixed(8)).join(",");
        if (support >= 2 && !behavior.has(signature)) {
          bank.push(row);
          behavior.add(signature);
          fittedPlanes.set(coeff.join(","), coeff);
        }
      }
    }
  }
  if (options.affineDifferences && !answer) {
    const planes = [...fittedPlanes.values()].slice(
        0,
        options.envelopePlanes ? 24 : undefined,
      ),
      differences = new Map<string, number[]>();
    for (const x of planes)
      for (const y of planes) {
        if (!charge()) break;
        const coeff = x.map((v, i) => v - y[i]);
        if (coeff.some((v) => Math.abs(v) > 8) || (!coeff[0] && !coeff[1]))
          continue;
        differences.set(coeff.join(","), coeff);
        if (options.primitiveDifferences) {
          const gcd = (a: number, b: number): number =>
            b ? gcd(b, a % b) : Math.abs(a);
          const divisor = coeff.reduce((a, b) => gcd(a, b), 0);
          if (divisor > 1) {
            const normalized = coeff.map((v) => v / divisor);
            differences.set(normalized.join(","), normalized);
          }
        }
      }
    const candidates = [...differences.values()]
      .map((coeff) => ({
        tree: plane(coeff),
        cost: coeff.reduce((s, v) => s + Math.abs(v), 0),
      }))
      .filter((r) => !syntax.has(key(r.tree)))
      .sort((a, b) => exprSize(a.tree) - exprSize(b.tree) || a.cost - b.cost);
    for (const { tree } of candidates.slice(0, options.affineDifferences)) {
      evaluate(tree);
      if (answer) break;
    }
  }
  // Unary productions are cheap forward links; definitions are arbitrary DSL bodies.
  const seeds = [...bank];
  const unaryOps = [
    "neg",
    ...macros.filter((m) => m.arity === 1).map((m) => m.name),
  ];
  const links = options.affineDifferences
    ? seeds.flatMap((row) => unaryOps.map((op) => ({ row, op })))
    : unaryOps.flatMap((op) => seeds.map((row) => ({ row, op })));
  for (const { row, op } of links) {
    if (answer || evaluations >= Math.max(16, Math.floor(budget * 0.5))) break;
    evaluate({ op, args: [row.tree] });
  }
  if (options.macroForward && !answer) {
    const forwardRng = new Random(seed ^ 731291);
    const simple = [...seeds]
      .sort((a, b) => a.size - b.size)
      .slice(0, Math.max(4, Math.ceil(seeds.length / 2)));
    for (const m of macros.filter((m) => m.arity > 1))
      for (let attempt = 0; attempt < options.macroForward; attempt++) {
        if (answer || evaluations >= Math.floor(budget * 0.65) || !seeds.length)
          break;
        const args = Array.from(
          { length: m.arity },
          () => forwardRng.pick(forwardRng.next() < 0.5 ? simple : seeds).tree,
        );
        evaluate({ op: m.name, args });
      }
  }
  bank.sort((x, y) => x.error - y.error || x.size - y.size);
  const active = bank.slice(0, 64),
    ps = productions(macros),
    predict = encoder(policy, ps);
  const indexes = task.examples.map((_, i) =>
    active
      .map((r, id) => ({ value: r.values[i], id }))
      .sort((x, y) => x.value - y.value),
  );
  const find = (b: Box): Fragment | undefined => {
    if (!charge()) return;
    constraintChecks++;
    let ids: number[] | undefined;
    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i];
      const lower = (value: number) => {
        let l = 0,
          h = index.length;
        while (l < h) {
          const m = (l + h) >> 1;
          if (index[m].value < value) l = m + 1;
          else h = m;
        }
        return l;
      };
      const begin = lower(b.low[i] - 1e-7),
        end = lower(b.high[i] + 1e-7);
      if (begin === end) return;
      if (!ids || end - begin < ids.length)
        ids = index.slice(begin, end).map((v) => v.id);
    }
    for (const id of ids ?? []) {
      if (!charge()) return;
      constraintChecks++;
      const row = active[id];
      const yes = row.values.every((v, i) => {
        constraintPoints++;
        return b.ranges
          ? contains(b, i, v)
          : v >= b.low[i] - 1e-7 && v <= b.high[i] + 1e-7;
      });
      if (yes) return row;
    }
  };
  const target: Box = {
    low: task.examples.map((e) => e.output),
    high: task.examples.map((e) => e.output),
  };
  const affine = (spec: Box): Expr | undefined => {
    if (options.affineFits === 0) return;
    const exact = spec.low
      .map((v, i) =>
        Number.isFinite(v) && Math.abs(v - spec.high[i]) < 1e-8 ? i : -1,
      )
      .filter((i) => i >= 0);
    const accepts = (row: Fragment) =>
      row.values.every((v, i) => {
        constraintPoints++;
        return spec.ranges
          ? contains(spec, i, v)
          : v >= spec.low[i] - 1e-7 && v <= spec.high[i] + 1e-7;
      });
    // Three independent equalities uniquely determine a plane. A failed
    // consistency check need not launch a coefficient grid search.
    if (exact.length >= 3) {
      const i = exact[0];
      for (let j = 1; j < exact.length; j++)
        for (let k = j + 1; k < exact.length; k++) {
          const p = task.examples[i].input,
            q = task.examples[exact[j]].input,
            r = task.examples[exact[k]].input;
          const dx = q[0] - p[0],
            dy = q[1] - p[1],
            ex = r[0] - p[0],
            ey = r[1] - p[1],
            det = dx * ey - dy * ex;
          if (Math.abs(det) < 1e-9) continue;
          if (!charge()) return;
          linearFits++;
          const dz = spec.low[exact[j]] - spec.low[i],
            ez = spec.low[exact[k]] - spec.low[i];
          const alpha = (dz * ey - dy * ez) / det,
            beta = (dx * ez - dz * ex) / det,
            coeff = [alpha, beta, spec.low[i] - alpha * p[0] - beta * p[1]],
            ints = coeff.map(Math.round);
          if (
            coeff.some((v, n) => Math.abs(v - ints[n]) > 1e-6) ||
            ints.some((v) => Math.abs(v) > 8)
          )
            return;
          const tree = plane(ints),
            cached = syntax.get(key(tree));
          const row = cached ?? evaluate(tree, false);
          return row && accepts(row) ? tree : undefined;
        }
    }
    // In interval-valued goals (e.g. a hole under min/max), propagate the
    // inequalities to the unknown intercept for each bounded slope pair.
    const grid = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8];
    for (const alpha of grid)
      for (const beta of grid) {
        if (!charge()) return;
        linearFits++;
        if (spec.ranges) {
          let intercepts: Domain = [[-8, 8]];
          for (let i = 0; i < task.examples.length && intercepts.length; i++) {
            constraintPoints++;
            const [x, y] = task.examples[i].input,
              v = alpha * x + beta * y;
            intercepts = intersect(
              intercepts,
              domainAt(spec, i).map(([l, h]) => [l - v - 1e-7, h - v + 1e-7]),
            );
          }
          for (const [low, high] of intercepts) {
            const l = Math.ceil(low),
              h = Math.floor(high);
            if (l > h) continue;
            const gamma =
                l <= 0 && h >= 0 ? 0 : Math.abs(l) < Math.abs(h) ? l : h,
              tree = plane([alpha, beta, gamma]);
            const row = syntax.get(key(tree)) ?? evaluate(tree, false);
            if (row && accepts(row)) return tree;
          }
          continue;
        }
        let low = -8,
          high = 8;
        for (let i = 0; i < task.examples.length; i++) {
          constraintPoints++;
          const [x, y] = task.examples[i].input,
            v = alpha * x + beta * y;
          low = Math.max(low, spec.low[i] - v);
          high = Math.min(high, spec.high[i] - v);
          if (low > high + 1e-7) break;
        }
        if (low > high + 1e-7) continue;
        const l = Math.ceil(low - 1e-7),
          h = Math.floor(high + 1e-7);
        if (l > h) continue;
        const gamma = l <= 0 && h >= 0 ? 0 : Math.abs(l) < Math.abs(h) ? l : h,
          tree = plane([alpha, beta, gamma]);
        const cached = syntax.get(key(tree)),
          row = cached ?? evaluate(tree, false);
        if (row && accepts(row)) return tree;
      }
  };
  const solve = (
    spec: Box,
    depth: number,
    partial: Expr,
    path: number[],
    ancestors: Set<string>,
  ): Expr | undefined => {
    if (expansions >= limit || evaluations >= budget) return;
    const direct = find(spec);
    if (direct) return direct.tree;
    const fitted = affine(spec);
    if (fitted) return fitted;
    if (depth <= 0) return;
    const sk = boxKey(spec);
    if (ancestors.has(sk)) return;
    const history = new Set(ancestors);
    history.add(sk);
    const neuralContext = policy
      ? context(task.examples, partial, path, ps, macros)
      : [];
    if (policy?.contextKind === "inverse-domains-v1")
      neuralContext.push(...specificationFeatures(spec));
    const probabilities = predict(neuralContext);
    const candidates: { tree: Expr; child: Box; cost: number; slot: number }[] =
      [];
    const ops = ps
      .filter(
        (p) =>
          ["add", "sub", "mul", "min", "max", "neg"].includes(p.node.op) ||
          !!relations.get(p.node.op) ||
          (!!options.macroBindings &&
            p.arity > 1 &&
            macros.some((m) => m.name === p.node.op)),
      )
      .sort(
        (x, y) => probabilities[ps.indexOf(y)] - probabilities[ps.indexOf(x)],
      );
    for (const p of ops) {
      const macro = macros.find((m) => m.name === p.node.op);
      const bindings: Fragment[][] =
        p.arity === 1
          ? [[]]
          : macro
            ? active
                .slice(0, options.macroBindings ?? 0)
                .map((row, i) =>
                  Array.from({ length: p.arity - 1 }, (_, j) =>
                    j === 0 ? row : active[(i * 7 + j * 3) % active.length],
                  ),
                )
            : active.map((row) => [row]);
      for (const known of bindings) {
        if (!charge()) break;
        inverseSteps++;
        const pieces = relations.get(p.node.op);
        const child =
          macro && p.arity > 1
            ? inverseApplied(
                macro.body,
                known.map((r) => r.values),
                spec,
                () => {
                  constraintPoints++;
                  return charge();
                },
              )
            : pieces
              ? inversePieces(pieces, spec)
              : inverseBox(p.node.op, spec, known[0]?.values);
        if (pieces) constraintPoints += spec.low.length * pieces.length;
        if (!child || boxKey(child) === sk) continue;
        const tree: Expr = {
            op: p.node.op,
            args: [...known.map((r) => r.tree), hole()],
          },
          slot = known.length;
        const found = find(child);
        if (found) {
          const completed = replace(tree, [slot], found.tree);
          if (exprSize(replace(partial, path, completed)) <= maxNodes)
            return completed;
        }
        const cost =
          -Math.log(probabilities[ps.indexOf(p)]) +
          0.02 * known.reduce((s, r) => s + r.size, 0) +
          ((options.semanticRank ?? 0) *
            child.low.reduce(
              (s, l, i) =>
                s + (l > 0 ? l : child.high[i] < 0 ? -child.high[i] : 0),
              0,
            )) /
            Math.max(
              1,
              spec.low.reduce(
                (s, l, i) =>
                  s +
                  (Number.isFinite(l)
                    ? Math.abs(l)
                    : Number.isFinite(spec.high[i])
                      ? Math.abs(spec.high[i])
                      : 0),
                0,
              ),
            ) +
          rng.next() * 0.01;
        candidates.push({ tree, child, cost, slot });
      }
    }
    if (path.length === 0 && options.joinBudget) {
      const joined = additiveJoin(
        active,
        task.examples,
        macros,
        options.joinBudget,
        charge,
        (n) => {
          constraintPoints += n;
        },
        (tree) => {
          const r = evaluate(tree, false);
          return !!r && r.error < 1e-8;
        },
      );
      if (joined) return joined;
    }
    candidates.sort((x, y) => x.cost - y.cost);
    let frontier = candidates.slice(0, options.beam ?? 12);
    if (options.diverseBeam) {
      const first = [
        ...new Map(
          [...candidates].reverse().map((c) => [c.tree.op, c]),
        ).values(),
      ].sort((a, b) => a.cost - b.cost);
      frontier = [
        ...first,
        ...candidates.filter((c) => !first.includes(c)),
      ].slice(0, options.beam ?? 12);
    }
    for (const candidate of frontier) {
      const next = replace(partial, path, candidate.tree),
        p = [...path, candidate.slot];
      const result = solve(candidate.child, depth - 1, next, p, history);
      if (result) {
        const completed = replace(candidate.tree, [candidate.slot], result);
        if (exprSize(replace(partial, path, completed)) <= maxNodes)
          return completed;
      }
    }
  };
  if (!answer) {
    const result = solve(target, options.depth ?? 3, hole(), [], new Set());
    if (result && !answer) evaluate(result, false);
  }
  const selected = best ?? { tree: c(0), values: [], error: Infinity, size: 1 },
    f = compile(selected.tree, macros);
  const checkError = Number.isFinite(selected.error)
    ? task.checks.reduce((s, e) => s + Math.abs(f(...e.input) - e.output), 0) /
      task.checks.length
    : Infinity;
  const solved = selected.error < 1e-8 && checkError < 1e-8;
  return {
    tree: selected.tree,
    expression: formatExpr(selected.tree),
    solved,
    evaluations,
    expansions,
    budget,
    expansionBudget: limit,
    effort: solved ? evaluations : budget,
    work: evaluations + expansions,
    trainError: selected.error,
    checkError,
    nodes: selected.size,
    macroCalls: paths(selected.tree).filter((p) =>
      macros.some((m) => m.name === at(selected.tree, p).op),
    ).length,
    duplicates,
    elapsedMs: performance.now() - start,
    termination:
      selected.error < 1e-8
        ? "fit"
        : expansions >= limit
          ? "expansions"
          : evaluations >= budget
            ? "evaluations"
            : "frontier",
    linearFits,
    inverseSteps,
    constraintChecks,
    constraintPoints,
    bankSize: bank.length,
  };
}
