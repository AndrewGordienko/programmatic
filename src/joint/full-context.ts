import type { Example } from "../dsl/types";
import { domainAt, type Box } from "./domains";
import { specificationFeatures } from "./specification";
export function fullObservationContext(
  examples: Example[],
  spec: Box,
): number[] {
  return [...observationFeatures(examples), ...specificationFeatures(spec, 75)];
}
export function observationFeatures(examples: Example[]): number[] {
  return Array.from({ length: 75 }, (_, i) => {
    const e = examples[i];
    return e
      ? [
          Math.tanh(e.input[0] / 5),
          Math.tanh(e.input[1] / 5),
          Math.tanh(e.output / 4),
        ]
      : [0, 0, 0];
  }).flat();
}
export function specificationFeature(spec: Box, index: number): number {
  const i = Math.floor(index / 5),
    j = index % 5,
    ds = i < spec.low.length ? domainAt(spec, i) : [];
  if (j === 4) return Math.min(4, ds.length) / 4;
  const range = ds[Math.floor(j / 2)];
  return range ? Math.tanh(range[j % 2] / 4) : 0;
}
