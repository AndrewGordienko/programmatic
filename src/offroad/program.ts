import { Random } from "../engine/random";
import {
  ANGLES,
  INPUTS,
  OPS,
  RAYS,
  SCALAR_INPUTS,
  VECTOR_INPUTS,
  type Controls,
  type Gene,
  type Macro,
  type Observation,
  type Op,
  type Program,
  type Value,
  type ValueType,
} from "./types";
import { clamp } from "./terrain";
export const inputTypes: ValueType[] = [
  ...VECTOR_INPUTS.map(() => "vector" as const),
  ...SCALAR_INPUTS.map(() => "scalar" as const),
];
export const operations = (macros: Macro[]): Op[] => [...OPS, ...macros];
export function activeGenes(p: Program) {
  const seen = new Set<number>();
  const visit = (r: number) => {
    if (r < INPUTS) return;
    const i = r - INPUTS;
    if (seen.has(i)) return;
    seen.add(i);
    if (!p.genes[i]) throw Error("Invalid program reference");
    p.genes[i].refs.forEach(visit);
  };
  visit(p.steering);
  visit(p.acceleration);
  return [...seen].sort((a, b) => a - b);
}
export function validate(p: Program) {
  try {
    const types = [...inputTypes];
    for (const g of p.genes) {
      const op = operations(p.macros).find((o) => o.name === g.op);
      if (
        !op ||
        op.output !== g.type ||
        op.args.length !== g.refs.length ||
        !Number.isFinite(g.value)
      )
        return false;
      for (let j = 0; j < g.refs.length; j++)
        if (!Number.isInteger(g.refs[j]) || types[g.refs[j]] !== op.args[j])
          return false;
      types.push(g.type);
    }
    return (
      p.genes.length <= 40 &&
      types[p.steering] === "angle" &&
      types[p.acceleration] === "scalar"
    );
  } catch {
    return false;
  }
}
function primitive(name: string, args: Value[], constant = 1): Value {
  const a = args[0],
    b = args[1];
  if (name.startsWith("v_")) {
    const result = new Float64Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      const x = (a as Float64Array)[i],
        y =
          name === "v_scale"
            ? (b as number)
            : ((b as Float64Array | undefined)?.[i] ?? 0);
      let v = 0;
      switch (name) {
        case "v_add":
          v = x + y;
          break;
        case "v_sub":
          v = x - y;
          break;
        case "v_mul":
          v = x * y;
          break;
        case "v_min":
          v = Math.min(x, y);
          break;
        case "v_max":
          v = Math.max(x, y);
          break;
        case "v_scale":
          v = x * y;
          break;
        case "v_negate":
          v = -x;
          break;
      }
      result[i] = clamp(v, -20, 20);
    }
    return result;
  }
  if (name === "argmax") {
    const v = a as Float64Array;
    let index = (RAYS - 1) / 2;
    for (let i = 0; i < RAYS; i++) if (v[i] > v[index] + 1e-9) index = i;
    return ANGLES[index] / 1.35;
  }
  if (name === "center") return (a as Float64Array)[(RAYS - 1) / 2];
  if (name === "minimum") return Math.min(...(a as Float64Array));
  const x = a as number,
    y = b as number;
  switch (name) {
    case "angle_add":
      return clamp(x + y, -2, 2);
    case "angle_scale":
      return clamp(x * y, -2, 2);
    case "add":
      return clamp(x + y, -20, 20);
    case "subtract":
      return clamp(x - y, -20, 20);
    case "multiply":
      return clamp(x * y, -20, 20);
    case "min":
      return Math.min(x, y);
    case "max":
      return Math.max(x, y);
    case "tanh":
      return Math.tanh(x);
    case "negate":
      return -x;
    case "constant":
      return constant;
    default:
      throw Error(`Unknown op ${name}`);
  }
}
export function runOp(
  name: string,
  args: Value[],
  constant: number,
  macros: Macro[],
): Value {
  const macro = macros.find((m) => m.name === name);
  if (!macro) return primitive(name, args, constant);
  const inner = OPS.find((o) => o.name === macro.inner)!;
  const outer = OPS.find((o) => o.name === macro.outer)!;
  const innerValue = primitive(macro.inner, args.slice(0, inner.args.length));
  let n = inner.args.length;
  return primitive(
    macro.outer,
    outer.args.map((_, i) => (i === macro.slot ? innerValue : args[n++])),
  );
}
export function compile(p: Program): (o: Observation) => Controls {
  if (!validate(p)) throw Error("Ill-typed off-road program");
  const active = activeGenes(p),
    values: Value[] = new Array(INPUTS + p.genes.length);
  return (o) => {
    o.vectors.forEach((v, i) => (values[i] = v));
    o.scalars.forEach((v, i) => (values[VECTOR_INPUTS.length + i] = v));
    for (const i of active) {
      const g = p.genes[i];
      values[INPUTS + i] = runOp(
        g.op,
        g.refs.map((r) => values[r]),
        g.value,
        p.macros,
      );
    }
    return {
      steering: clamp(values[p.steering] as number, -1, 1),
      acceleration: clamp(values[p.acceleration] as number, -1, 1),
    };
  };
}
export function randomGene(
  rng: Random,
  types: ValueType[],
  macros: Macro[],
  forced?: Op,
): Gene {
  const op =
    forced ??
    rng.pick(
      operations(macros).filter((o) => o.args.every((t) => types.includes(t))),
    );
  return {
    op: op.name,
    type: op.output,
    refs: op.args.map((t) =>
      rng.pick(types.map((x, i) => (x === t ? i : -1)).filter((i) => i >= 0)),
    ),
    value: (rng.next() * 2 - 1) * 3,
  };
}
export function expandedSize(p: Program) {
  return activeGenes(p).reduce(
    (n, i) => n + (p.macros.some((m) => m.name === p.genes[i].op) ? 2 : 1),
    0,
  );
}
export function programLines(p: Program) {
  const active = activeGenes(p),
    names = new Map(active.map((i, n) => [INPUTS + i, `v${n}`]));
  const ref = (r: number) =>
    r < VECTOR_INPUTS.length
      ? `scan.${VECTOR_INPUTS[r]}`
      : r < INPUTS
        ? `state.${SCALAR_INPUTS[r - VECTOR_INPUTS.length]}`
        : names.get(r)!;
  return [
    ...p.macros
      .filter((m) => active.some((i) => p.genes[i].op === m.name))
      .map((m) => m.definition),
    "def drive(scan, state):",
    ...active.map((i) => {
      const g = p.genes[i];
      return `  ${names.get(INPUTS + i)} = ${g.op === "constant" ? g.value.toFixed(4) : `${g.op}(${g.refs.map(ref).join(", ")})`}`;
    }),
    `  return clip(${ref(p.steering)}, -1, 1),`,
    `         clip(${ref(p.acceleration)}, -1, 1)`,
  ];
}
export function mineMacros(programs: Program[], existing: Macro[]): Macro[] {
  const proposals = new Map<string, { m: Macro; count: number }>();
  for (const p of programs)
    for (const i of activeGenes(p)) {
      const g = p.genes[i],
        outer = OPS.find((o) => o.name === g.op);
      if (!outer || outer.output !== "vector") continue;
      g.refs.forEach((r, slot) => {
        if (r < INPUTS) return;
        const inner = OPS.find((o) => o.name === p.genes[r - INPUTS].op);
        if (!inner || !inner.args.length || inner.output !== "vector") return;
        const signature = `${inner.name}/${outer.name}/${slot}`;
        if (
          existing.some((m) => `${m.inner}/${m.outer}/${m.slot}` === signature)
        )
          return;
        const args = [
          ...inner.args,
          ...outer.args.filter((_, j) => j !== slot),
        ];
        const letters = ["a", "b", "c", "d"];
        let n = inner.args.length;
        const expression = `${outer.name}(${outer.args.map((_, j) => (j === slot ? `${inner.name}(${letters.slice(0, inner.args.length).join(", ")})` : letters[n++])).join(", ")})`;
        const name = `terrain_fn_${existing.length + 1}`,
          m: Macro = {
            name,
            output: outer.output,
            args,
            inner: inner.name,
            outer: outer.name,
            slot,
            definition: `${name}(${letters.slice(0, args.length).join(", ")}) = ${expression}`,
          };
        const found = proposals.get(signature);
        if (found) found.count++;
        else proposals.set(signature, { m, count: 1 });
      });
    }
  return [...proposals.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((x) => x.m);
}
