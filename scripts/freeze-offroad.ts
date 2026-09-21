import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { OffroadSearch } from "../src/offroad/search";
import { SIMULATOR_VERSION } from "../src/offroad/simulator";
import { CONFIG } from "../src/offroad/types";
import {
  VERSION,
  validateArtifact,
  type FrozenArtifact,
} from "../src/challenge/protocol";
const s = new OffroadSearch(CONFIG);
for (let i = 0; i < CONFIG.generations; i++) {
  s.step();
  if (i % 10 === 9) console.log(`training ${i + 1}/${CONFIG.generations}`);
}
const payload: FrozenArtifact["payload"] = {
  version: VERSION,
  simulatorVersion: SIMULATOR_VERSION,
  frozenAt: new Date().toISOString(),
  config: CONFIG,
  prior: s.prior.freeze(),
  macros: s.macros,
  trainingSeeds: s.terrains.map((t) => t.seed),
  developmentSeeds: [1_300_000_000, 1_300_000_137, 1_300_000_274],
  trainingEvaluations: s.rollouts,
  discoveryEvaluations: s.discoveryRollouts,
  trainingMs: s.elapsedMs,
  source:
    "Default seed-42 off-road training, 60 generations. No challenge terrain used. No policy weights or controller carried into challenge search.",
  acceptance:
    "Existing off-road development rule: macro used in both development optimizer runs and mean fitness improves by >0.5. This is weaker than the scalar confirmation protocol; no statistical guarantee.",
};
const artifact = {
  hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  payload,
};
validateArtifact(artifact);
writeFileSync("public/offroad-frozen.json", JSON.stringify(artifact));
console.log(
  JSON.stringify({
    hash: artifact.hash,
    macros: payload.macros.length,
    evaluations: payload.trainingEvaluations + payload.discoveryEvaluations,
  }),
);
