import { Random } from "../engine/random";
import {
  at,
  paths,
  replace,
  key,
  exprSize,
  expandExpr,
  compile,
  formatExpr,
} from "../dsl/expressions";
import type { Expr, Macro, Task } from "../dsl/types";
import { productions, encoder, context, type JointPolicy } from "./policy";
import { fitAffineSkeleton } from "./parametric";
import type { SearchResult } from "./search";

type Individual = {
  template: Expr;
  weights: number[];
  tree: Expr;
  error: number;
  score: number;
};
export function parametricSearch(
  task: Pick<Task, "examples" | "checks">,
  macros: Macro[],
  policy: JointPolicy | undefined,
  seed: number,
  budget: number,
  options: {
    steps?: number;
    restarts?: number;
    workBudget?: number;
    population?: number;
    compoundEdits?: boolean;
  } = {},
): SearchResult & {
  templates: number;
  parameterWork: number;
  exampleExecutions: number;
} {
  if (policy?.contextKind)
    throw new Error(
      "Parametric template policy uses ordinary partial-program context",
    );
  const started = performance.now(),
    rng = new Random(seed),
    ps = productions(macros),
    predict = encoder(policy, ps),
    ops = ps.filter((p) => p.arity > 0);
  const workBudget = options.workBudget ?? 1e9;
  let evaluations = 0,
    parameterWork = 0,
    templates = 0,
    expansions = 0,
    duplicates = 0;
  const population: Individual[] = [],
    seen = new Set<string>();
  const chargeEvaluation = () => {
    if (evaluations >= budget) return false;
    evaluations++;
    return true;
  };
  const chargeWork = (n: number) => {
    if (parameterWork + n > workBudget) return false;
    parameterWork += n;
    return true;
  };
  const fit = (template: Expr, initial?: number[]) => {
    if (exprSize(expandExpr(template, macros)) > 96) return;
    const signature = key(template);
    if (seen.has(signature)) {
      duplicates++;
      return;
    }
    seen.add(signature);
    templates++;
    const result = fitAffineSkeleton(template, macros, task.examples, rng, {
      steps: options.steps ?? 16,
      restarts: options.restarts ?? 2,
      initial,
      chargeEvaluation,
      chargeWork,
    });
    if (!result) return;
    const candidate = {
      template,
      ...result,
      score: result.error + 0.00001 * exprSize(result.tree),
    };
    population.push(candidate);
    population.sort((a, b) => a.score - b.score);
    population.splice(options.population ?? 16);
    return candidate;
  };
  fit({ op: "?", value: 0, args: [] });
  let answer = population[0]?.error < 1e-8;
  for (
    let attempt = 0;
    !answer &&
    evaluations < budget &&
    parameterWork < workBudget &&
    attempt < budget;
    attempt++
  ) {
    expansions++;
    const parent = population[Math.floor(rng.next() ** 2 * population.length)];
    if (!parent) break;
    const positions = paths(parent.template),
      path = rng.pick(positions),
      selected = at(parent.template, path);
    const probs = predict(
      policy ? context(task.examples, parent.template, path, ps, macros) : [],
    );
    const weights = ops.map((p) => probs[ps.indexOf(p)]),
      sum = weights.reduce((a, b) => a + b, 0);
    let u = rng.next() * sum,
      index = 0;
    while (index < ops.length - 1 && u > weights[index]) u -= weights[index++];
    const op = ops[index];
    let next = parent.weights.length / 3;
    const initial = [...parent.weights];
    const fresh = (): Expr => {
      const value = next++;
      initial.push(rng.int(5) - 2, rng.int(5) - 2, rng.int(5) - 2);
      return { op: "?", value, args: [] };
    };
    const expanded: Expr = {
      op: op.node.op,
      args: [selected, ...Array.from({ length: op.arity - 1 }, fresh)],
    };
    if (options.compoundEdits && op.arity > 1 && rng.next() < 0.65) {
      let v = rng.next() * sum,
        j = 0;
      while (j < ops.length - 1 && v > weights[j]) v -= weights[j++];
      const second = ops[j],
        slot = 1 + rng.int(op.arity - 1);
      expanded.args[slot] = {
        op: second.node.op,
        args: [
          expanded.args[slot],
          ...Array.from({ length: second.arity - 1 }, fresh),
        ],
      };
    }
    // Reindex retained parameters by occurrence so every template has a canonical key.
    const ids = new Map<number, number>(),
      warm: number[] = [];
    const renumber = (e: Expr): Expr => {
      if (e.op === "?") {
        if (!ids.has(e.value!)) {
          ids.set(e.value!, ids.size);
          warm.push(...initial.slice(e.value! * 3, e.value! * 3 + 3));
        }
        return { ...e, value: ids.get(e.value!) };
      }
      return { ...e, args: e.args.map(renumber) };
    };
    const candidate = fit(
      renumber(replace(parent.template, path, expanded)),
      warm,
    );
    answer = !!candidate && candidate.error < 1e-8;
  }
  const best = population[0],
    tree = best?.tree ?? { op: "const", value: 0, args: [] },
    f = compile(tree, macros);
  const checkError =
    task.checks.reduce((s, e) => s + Math.abs(f(...e.input) - e.output), 0) /
    task.checks.length;
  const solved = !!best && best.error < 1e-8 && checkError < 1e-8;
  return {
    tree,
    expression: formatExpr(tree),
    solved,
    evaluations,
    expansions,
    budget,
    expansionBudget: budget,
    effort: solved ? evaluations : budget,
    work: evaluations + expansions,
    trainError: best?.error ?? Infinity,
    checkError,
    nodes: exprSize(tree),
    macroCalls: paths(tree).filter((p) =>
      macros.some((m) => m.name === at(tree, p).op),
    ).length,
    duplicates,
    elapsedMs: performance.now() - started,
    termination:
      best?.error !== undefined && best.error < 1e-8
        ? "fit"
        : evaluations >= budget
          ? "evaluations"
          : parameterWork >= workBudget
            ? "expansions"
            : "frontier",
    templates,
    parameterWork,
    exampleExecutions: evaluations * task.examples.length,
  };
}
