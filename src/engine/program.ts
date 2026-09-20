import { Random } from "./random";
import { OPS, type Gene, type Program } from "./types";

export const isBinary = (op: Gene["op"]) =>
  ["add", "subtract", "multiply", "min", "max"].includes(op);
export const isUnary = (op: Gene["op"]) => op === "negate";
export const activeIndices = (program: Program): number[] => {
  const active = new Set<number>();
  function visit(i: number) {
    if (active.has(i)) return;
    const gene = program.genes[i];
    active.add(i);
    if (isBinary(gene.op) || isUnary(gene.op)) visit(gene.a);
    if (isBinary(gene.op)) visit(gene.b);
  }
  visit(program.output);
  return [...active].sort((a, b) => a - b);
};

export function randomGene(rng: Random, index: number, op?: Gene["op"]): Gene {
  return {
    op: op ?? rng.pick(index === 0 ? OPS.slice(0, 5) : OPS),
    a: rng.int(Math.max(1, index)),
    b: rng.int(Math.max(1, index)),
    value: rng.pick([-2, -1, -0.5, 0.5, 1, 2]),
  };
}

export function validateProgram(program: Program): boolean {
  return (
    Number.isInteger(program.output) &&
    program.output >= 0 &&
    program.output < program.genes.length &&
    program.genes.length <= 24 &&
    program.genes.every(
      (g, i) =>
        OPS.includes(g.op) &&
        Number.isFinite(g.value) &&
        (!(isBinary(g.op) || isUnary(g.op)) ||
          (Number.isInteger(g.a) && g.a >= 0 && g.a < i)) &&
        (!isBinary(g.op) || (Number.isInteger(g.b) && g.b >= 0 && g.b < i)),
    )
  );
}

export function evaluateProgram(
  program: Program,
  features: number[],
  active = activeIndices(program),
): number {
  const values = new Float64Array(program.genes.length);
  for (const i of active) {
    const g = program.genes[i];
    const a = values[g.a],
      b = values[g.b];
    switch (g.op) {
      case "progress":
        values[i] = features[0];
        break;
      case "visits":
        values[i] = features[1];
        break;
      case "momentum":
        values[i] = features[2];
        break;
      case "clearance":
        values[i] = features[3];
        break;
      case "constant":
        values[i] = g.value;
        break;
      case "add":
        values[i] = a + b;
        break;
      case "subtract":
        values[i] = a - b;
        break;
      case "multiply":
        values[i] = a * b;
        break;
      case "min":
        values[i] = Math.min(a, b);
        break;
      case "max":
        values[i] = Math.max(a, b);
        break;
      case "negate":
        values[i] = -a;
        break;
    }
    values[i] = Math.max(-100, Math.min(100, values[i]));
  }
  return values[program.output];
}

export function programLines(program: Program): string[] {
  const active = activeIndices(program);
  const names = new Map(active.map((i, n) => [i, `v${n}`]));
  return active
    .map((i) => {
      const g = program.genes[i],
        a = names.get(g.a),
        b = names.get(g.b);
      const expressions: Record<Gene["op"], string> = {
        progress: "goal_progress(move)",
        visits: "visit_count(move)",
        momentum: "same_direction(move)",
        clearance: "free_neighbors(move)",
        constant: `${g.value}`,
        add: `${a} + ${b}`,
        subtract: `${a} - ${b}`,
        multiply: `${a} * ${b}`,
        min: `min(${a}, ${b})`,
        max: `max(${a}, ${b})`,
        negate: `-${a}`,
      };
      return `    ${names.get(i)} = ${expressions[g.op]}`;
    })
    .concat(`    return ${names.get(program.output)}`);
}

export function exportPython(program: Program): string {
  const lines = programLines(program).map((line) => {
    for (const [before, after] of [
      ["goal_progress(move)", "progress"],
      ["visit_count(move)", "visit_count"],
      ["same_direction(move)", "momentum"],
      ["free_neighbors(move)", "clearance"],
    ])
      line = line.replace(before, after);
    if (line.includes(" = ")) {
      const [lhs, rhs] = line.split(" = ");
      return `${lhs} = max(-100, min(100, ${rhs}))`;
    }
    return line;
  });
  return `"""Argos Lab evolved policy ${program.id}.
Pure Python, no dependencies. Coordinates are (x, y); walls are (x, y) tuples.
Call choose_move each tick. Increment visits at the starting cell and after each
move, and pass the last direction as previous. Tie order is east/south/west/north.
"""

def score(progress, visit_count, momentum, clearance):
${lines.join("\n")}

def choose_move(position, goal, walls, visits, previous=None, size=12):
    directions = [(1, 0), (0, 1), (-1, 0), (0, -1)]
    def legal(p):
        return 0 <= p[0] < size and 0 <= p[1] < size and p not in walls
    def distance(p):
        return abs(p[0] - goal[0]) + abs(p[1] - goal[1])
    candidates = []
    for d in directions:
        p = (position[0] + d[0], position[1] + d[1])
        if legal(p):
            clearance = sum(legal((p[0] + e[0], p[1] + e[1])) for e in directions) / 4
            value = score(distance(position) - distance(p), min(8, visits.get(p, 0)), int(d == previous), clearance)
            candidates.append((value, p))
    return max(candidates, key=lambda pair: pair[0])[1] if candidates else position
`;
}
