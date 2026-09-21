import { domainAt, type Box } from "./domains";

/** Fixed-size neural representation of the actual specification at a hole.
 * Retains the first two disjoint intervals and their count, rather than
 * replacing an unknown subtree with zero. This guides ranking, never pruning. */
export function specificationFeatures(spec: Box): number[] {
  return Array.from({ length: 25 }, (_, i) => {
    const ds = i < spec.low.length ? domainAt(spec, i) : [];
    return [
      ...[0, 1].flatMap((j) =>
        ds[j] ? ds[j].map((v) => Math.tanh(v / 4)) : [0, 0],
      ),
      Math.min(4, ds.length) / 4,
    ];
  }).flat();
}
