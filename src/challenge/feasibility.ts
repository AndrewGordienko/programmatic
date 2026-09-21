import {
  initialState,
  maximumDriveAcceleration,
  uphillGravityAcceleration,
} from "../offroad/simulator";
import type { Terrain } from "../offroad/types";

export type StartDiagnosis = {
  code: "immobile-start";
  pitchDegrees: number;
  maximumDrive: number;
  opposingGravity: number;
  explanation: string;
};

// A narrow impossibility certificate for the CURRENT forward-only simulator.
// Starting at rest, if even full throttle cannot overcome gravity, all controls
// leave speed = 0. Yaw and translation are speed-dependent, so position and
// heading cannot change either. The invariant persists for the whole episode.
// Passing this check does NOT certify a feasible route or a solvable terrain.
export function diagnoseStart(t: Terrain): StartDiagnosis | null {
  const s = initialState(t);
  if (Math.hypot(t.goal.x - s.x, t.goal.z - s.z) < 4) return null;
  const maximumDrive = maximumDriveAcceleration(s.grip);
  const opposingGravity = uphillGravityAcceleration(s.pitch);
  if (opposingGravity <= maximumDrive + 1e-6) return null;
  return {
    code: "immobile-start",
    pitchDegrees: (s.pitch * 180) / Math.PI,
    maximumDrive,
    opposingGravity,
    explanation:
      "Full throttle cannot overcome the uphill force at this start. This simulator has no reverse motion, and steering cannot turn a stationary truck. No controller can leave the start.",
  };
}
