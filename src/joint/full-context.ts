import type { Example } from "../dsl/types";
import type { Box } from "./domains";
import { specificationFeatures } from "./specification";
export function fullObservationContext(
  examples: Example[],
  spec: Box,
): number[] {
  return [
    ...Array.from({ length: 75 }, (_, i) => {
      const e = examples[i];
      return e
        ? [
            Math.tanh(e.input[0] / 5),
            Math.tanh(e.input[1] / 5),
            Math.tanh(e.output / 4),
          ]
        : [0, 0, 0];
    }).flat(),
    ...specificationFeatures(spec, 75),
  ];
}
