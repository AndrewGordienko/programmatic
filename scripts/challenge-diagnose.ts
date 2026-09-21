import { mkdirSync, writeFileSync } from "node:fs";
import { diagnoseStart } from "../src/challenge/feasibility";
import { makeTerrain } from "../src/offroad/terrain";
import {
  initialState,
  step,
  SIMULATOR_VERSION,
} from "../src/offroad/simulator";
import type { TerrainKind } from "../src/offroad/types";
const seed = Number(process.argv[2] ?? 2124797507),
  kind = (process.argv[3] ?? "ridge") as TerrainKind;
if (!Number.isInteger(seed) || !["woodland", "quarry", "ridge"].includes(kind))
  throw Error(
    "Usage: challenge:diagnose -- <integer terrain seed> <woodland|quarry|ridge>",
  );
const terrain = makeTerrain(seed, kind),
  diagnosis = diagnoseStart(terrain);
const probes = [];
for (const steering of [-1, 0, 1]) {
  let state = initialState(terrain);
  while (state.status === "driving")
    state = step(state, { steering, acceleration: 1 }, terrain);
  probes.push({
    steering,
    throttle: 1,
    end: state.status,
    distance: state.distance,
    speed: state.speed,
    time: state.time,
  });
}
const report = {
  simulatorVersion: SIMULATOR_VERSION,
  seed,
  kind,
  diagnosis,
  probes,
  scope:
    "Post-hoc diagnosis of a user-reported failed terrain. No replacement seed, simulator parameter change, or DSL-learning benefit. These diagnostic rollouts are separate from synthesis evaluations.",
};
mkdirSync("output/challenge", { recursive: true });
writeFileSync(
  `output/challenge/diagnosis-${seed}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
