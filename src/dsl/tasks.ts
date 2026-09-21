import { Random } from "../engine/random";
import type { Config, Example, Task } from "./types";

export function inputs(
  seed: number,
  count: number,
  range: number,
): [number, number][] {
  const r = new Random(seed);
  const boundary: [number, number][] = [
    [0, 0],
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, -1],
    [2, 0],
    [0, 2],
    [-2, 0],
    [0, -2],
  ];
  return [
    ...boundary,
    ...Array.from(
      { length: count - boundary.length },
      () =>
        [(r.next() * 2 - 1) * range, (r.next() * 2 - 1) * range] as [
          number,
          number,
        ],
    ),
  ];
}
// The generator is an oracle, not a source of candidate syntax or names.
// All splits share this deliberately related scalar distribution.
function target(r: Random, group: string): (x: number, y: number) => number {
  const concepts = [
    (v: number) => Math.abs(v),
    (v: number) => Math.max(0, v),
    (v: number) => Math.max(0, Math.min(1, v)),
  ];
  const affine = () => {
    const a = r.pick([-2, -1, 0, 1, 2]),
      b = a === 0 ? r.pick([-2, -1, 1, 2]) : r.pick([-1, 0, 1]);
    const c = r.pick([-2, -1, 0, 0, 0, 1, 2]);
    return (x: number, y: number) => a * x + b * y + c;
  };
  const f = r.pick(concepts),
    g = r.pick(concepts),
    a = affine(),
    b = affine();
  const mode = r.next(),
    sign = r.pick([-1, 1]);
  if (group === "Nested compositions")
    return (x, y) => f(g(a(x, y)) + sign * b(x, y));
  if (group === "Longer expressions") {
    const h = r.pick(concepts),
      c = affine();
    return (x, y) => f(a(x, y)) + sign * g(b(x, y)) + h(c(x, y));
  }
  if (mode < 0.65) return (x, y) => f(a(x, y));
  return (x, y) => f(a(x, y)) + sign * g(b(x, y));
}

export function makeTasks(
  c: Pick<Config, "training" | "development" | "confirmation" | "testing">,
  options: {
    seed?: number;
    exclude?: ReadonlySet<string>;
    prefix?: string;
    additionalExamples?: { count: number; range: number };
  } = {},
) {
  const rng = new Random(options.seed ?? 812731),
    probes = inputs(903141, 97, 7);
  const additional = options.additionalExamples;
  if (
    additional &&
    (!Number.isInteger(additional.count) ||
      additional.count < 9 ||
      additional.count > 1000 ||
      !Number.isFinite(additional.range) ||
      additional.range <= 0)
  )
    throw new Error(
      "Additional observations require 9–1000 inputs and a positive finite range",
    );
  const trainInputs = [
      ...inputs(301, 25, 3),
      ...(additional ? inputs(602, additional.count, additional.range) : []),
    ],
    checkInputs = inputs(809, 65, 5);
  const seen = new Set<string>(options.exclude),
    tasks: Task[] = [];
  const total = c.training + c.development + c.confirmation + c.testing;
  if (total > 2000 || total < 4)
    throw new Error("Task suite must contain 4–2000 tasks.");
  for (
    let attempts = 0;
    tasks.length < total && attempts < 100000;
    attempts++
  ) {
    const testStart = c.training + c.development + c.confirmation;
    const testIndex = tasks.length - testStart;
    const group =
      testIndex < 0 || testIndex < c.testing * 0.6
        ? "Related compositions"
        : testIndex < c.testing * 0.8
          ? "Nested compositions"
          : "Longer expressions";
    const f = target(rng, group),
      outputs = probes.map(([x, y]) => f(x, y));
    const signature = outputs.map((v) => v.toFixed(6)).join(",");
    if (seen.has(signature) || outputs.every((v) => v === outputs[0])) continue;
    seen.add(signature);
    const examples = (xs: [number, number][]): Example[] =>
      xs.map((input) => ({ input, output: f(...input) }));
    tasks.push({
      id: `${options.prefix ?? "task"}-${String(tasks.length + 1).padStart(3, "0")}`,
      examples: examples(trainInputs),
      checks: examples(checkInputs),
      signature,
      group,
    });
  }
  if (tasks.length !== total)
    throw new Error("Task generator exhausted its support.");
  // Independent pseudorandom draws; nested/longer compositions appear only in test.
  let at = 0;
  const take = (n: number) => tasks.slice(at, (at += n));
  return {
    training: take(c.training),
    development: take(c.development),
    confirmation: take(c.confirmation),
    testing: take(c.testing),
  };
}
