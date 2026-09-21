export type NeuralHoleValueModel = {
  version: "visited-hole-value-v1";
  mean: number[];
  scale: number[];
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
};
export type TreeHoleValueModel = {
  version: "visited-hole-tree-v1";
  features: number;
  trees: {
    feature: number[];
    threshold: number[];
    left: number[];
    right: number[];
    positive: number[];
  }[];
};
export type HoleValueModel = NeuralHoleValueModel | TreeHoleValueModel;
export function predictHoleTree(
  model: TreeHoleValueModel,
  feature: (index: number) => number,
  record?: (steps: number) => void,
): number {
  let total = 0,
    steps = 0;
  for (const tree of model.trees) {
    let i = 0;
    while (tree.feature[i] >= 0) {
      steps++;
      i =
        Math.fround(feature(tree.feature[i])) <= tree.threshold[i]
          ? tree.left[i]
          : tree.right[i];
    }
    total += tree.positive[i];
  }
  record?.(steps);
  return total / model.trees.length;
}
export function predictHoleValue(
  model: HoleValueModel,
  features: number[],
  recordTreeComparisons?: (n: number) => void,
): number {
  if (model.version === "visited-hole-tree-v1") {
    if (features.length !== model.features)
      throw new Error("Hole tree feature mismatch");
    return predictHoleTree(model, (i) => features[i], recordTreeComparisons);
  }
  if (features.length !== model.mean.length)
    throw new Error("Hole-value feature mismatch");
  const x = features.map((v, i) => (v - model.mean[i]) / model.scale[i]);
  let score = model.b2;
  for (let j = 0; j < model.w1.length; j++) {
    let z = model.b1[j];
    const w = model.w1[j];
    for (let i = 0; i < x.length; i++) z += w[i] * x[i];
    score += Math.max(0, z) * model.w2[j];
  }
  return 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, score))));
}
