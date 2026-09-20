import { Random } from "../engine/random";
import {
  CONSTANTS,
  DRIVE_OPS,
  INPUT_COUNT,
  SENSOR_NAMES,
  type DriveControls,
  type DriveGene,
  type DriveMacro,
  type DriveOp,
  type DriveProgram,
} from "./types";
import { clamp } from "./world";

export const unary = (op: string) =>
  ["copy", "tanh", "negate", "scale"].includes(op);
export function scalar(op: string, a: number, b: number, value = 1): number {
  switch (op) {
    case "copy":
      return a;
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      return Math.abs(b) < 0.05 ? a : a / b;
    case "min":
      return Math.min(a, b);
    case "max":
      return Math.max(a, b);
    case "tanh":
      return Math.tanh(a);
    case "negate":
      return -a;
    case "scale":
      return a * value;
    default:
      throw new Error(`Unknown driving operator: ${op}`);
  }
}
export function macroValue(m: DriveMacro, a: number, b: number) {
  const inner = clamp(scalar(m.inner, a, b), -20, 20);
  return scalar(
    m.outer,
    m.side === "left" ? inner : a,
    m.side === "left" ? b : inner,
  );
}
export function activeDriveGenes(program: DriveProgram): number[] {
  const seen = new Set<number>();
  const visit = (ref: number) => {
    if (ref < INPUT_COUNT) return;
    const i = ref - INPUT_COUNT;
    if (seen.has(i)) return;
    seen.add(i);
    const g = program.genes[i];
    if (!g) throw new Error("Invalid graph reference");
    visit(g.a);
    if (!unary(g.op)) visit(g.b);
  };
  visit(program.steering);
  visit(program.acceleration);
  return [...seen].sort((a, b) => a - b);
}
export function validateDriveProgram(p: DriveProgram): boolean {
  const limit = INPUT_COUNT + p.genes.length;
  const ref = (v: number, max: number) =>
    Number.isInteger(v) && v >= 0 && v < max;
  return (
    p.genes.length > 0 &&
    p.genes.length <= 40 &&
    ref(p.steering, limit) &&
    ref(p.acceleration, limit) &&
    p.genes.every(
      (g, i) =>
        (DRIVE_OPS.includes(g.op as DriveOp) ||
          p.macros.some((m) => m.name === g.op)) &&
        ref(g.a, INPUT_COUNT + i) &&
        ref(g.b, INPUT_COUNT + i) &&
        Number.isFinite(g.value),
    )
  );
}
export function compileDriveProgram(
  program: DriveProgram,
): (sensors: number[]) => DriveControls {
  const active = activeDriveGenes(program);
  const values = new Float64Array(INPUT_COUNT + program.genes.length);
  CONSTANTS.forEach((c, i) => {
    values[SENSOR_NAMES.length + i] = c;
  });
  return (sensors: number[]) => {
    for (let i = 0; i < SENSOR_NAMES.length; i++) values[i] = sensors[i];
    for (const i of active) {
      const g = program.genes[i],
        a = values[g.a],
        b = values[g.b];
      const macro = program.macros.find((m) => m.name === g.op);
      const value = macro
        ? macroValue(macro, a, b)
        : scalar(g.op, a, b, g.value);
      values[INPUT_COUNT + i] = Number.isFinite(value)
        ? clamp(value, -20, 20)
        : 0;
    }
    const steering = clamp(values[program.steering], -1, 1),
      acceleration = clamp(values[program.acceleration], -1, 1);
    return {
      steering,
      throttle: Math.max(0, acceleration),
      brake: Math.max(0, -acceleration),
    };
  };
}
export function randomDriveGene(
  rng: Random,
  i: number,
  macros: DriveMacro[],
  op?: string,
): DriveGene {
  return {
    op: op ?? rng.pick([...DRIVE_OPS, ...macros.map((m) => m.name)]),
    a: rng.int(INPUT_COUNT + i),
    b: rng.int(INPUT_COUNT + i),
    value: (rng.next() * 2 - 1) * 3,
  };
}
export function driveProgramLines(program: DriveProgram): string[] {
  const active = activeDriveGenes(program),
    names = new Map(active.map((i, n) => [INPUT_COUNT + i, `v${n}`]));
  const ref = (r: number) =>
    r < SENSOR_NAMES.length
      ? `s.${SENSOR_NAMES[r]}`
      : r < INPUT_COUNT
        ? String(CONSTANTS[r - SENSOR_NAMES.length])
        : names.get(r)!;
  const lines = ["def drive(s):"];
  for (const i of active) {
    const g = program.genes[i],
      a = ref(g.a),
      b = ref(g.b);
    const expressions: Record<string, string> = {
      copy: a,
      add: `${a} + ${b}`,
      subtract: `${a} - ${b}`,
      multiply: `${a} * ${b}`,
      divide: `safe_div(${a}, ${b})`,
      min: `min(${a}, ${b})`,
      max: `max(${a}, ${b})`,
      tanh: `tanh(${a})`,
      negate: `-${a}`,
      scale: `${a} * ${g.value.toFixed(3)}`,
    };
    lines.push(
      `    ${names.get(INPUT_COUNT + i)} = ${expressions[g.op] ?? `${g.op}(${a}, ${b})`}`,
    );
  }
  lines.push(
    `    steer = clip(${ref(program.steering)}, -1, 1)`,
    `    accel = clip(${ref(program.acceleration)}, -1, 1)`,
    "    return steer, max(0, accel), max(0, -accel)",
  );
  return lines;
}

// Mine two-operation compositions already present in active driving programs.
// These are real DSL proposals subsequently evaluated by fresh vehicle searches.
export function mineDriveMacros(
  programs: DriveProgram[],
  existing: DriveMacro[],
): DriveMacro[] {
  const unique = new Map<string, { macro: DriveMacro; count: number }>();
  for (const p of programs)
    for (const i of activeDriveGenes(p)) {
      const outer = p.genes[i];
      if (
        !DRIVE_OPS.includes(outer.op as DriveOp) ||
        ["copy", "scale"].includes(outer.op)
      )
        continue;
      for (const side of ["left", "right"] as const) {
        if (side === "right" && unary(outer.op)) continue;
        const child = (side === "left" ? outer.a : outer.b) - INPUT_COUNT;
        if (child < 0) continue;
        const inner = p.genes[child];
        if (
          !DRIVE_OPS.includes(inner.op as DriveOp) ||
          ["copy", "scale"].includes(inner.op)
        )
          continue;
        const other = side === "left" ? outer.b : outer.a;
        if (!unary(outer.op) && other !== inner.a && other !== inner.b)
          continue;
        // Preserve argument wiring exactly, not just the names of the operators.
        if (
          !unary(outer.op) &&
          (side === "left" ? other !== inner.b : other !== inner.a)
        )
          continue;
        const name = `drive_fn_${existing.length + 1}`;
        const innerText = unary(inner.op)
          ? `${inner.op}(a)`
          : `${inner.op}(a, b)`;
        const def = unary(outer.op)
          ? `${outer.op}(${innerText})`
          : side === "left"
            ? `${outer.op}(${innerText}, b)`
            : `${outer.op}(a, ${innerText})`;
        if (existing.some((m) => m.definition.endsWith(`= ${def}`))) continue;
        const macro: DriveMacro = {
          name,
          inner: inner.op as DriveOp,
          outer: outer.op as DriveOp,
          side,
          definition: `${name}(a, b) = ${def}`,
        };
        const key = `${inner.op}/${outer.op}/${side}`;
        const item = unique.get(key);
        if (item) item.count++;
        else unique.set(key, { macro, count: 1 });
      }
    }
  return [...unique.values()]
    .sort((a, b) => b.count - a.count)
    .map((v) => v.macro)
    .slice(0, 2);
}
