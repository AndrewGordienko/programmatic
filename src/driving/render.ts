import type { DriveState } from "./types";
import { clamp, wrap } from "./world";

// Rendering runs at display refresh rate; policy and physics stay deterministic
// at their original fixed timestep. Interpolation never feeds back into physics.
export function interpolateDrivePose(
  previous: DriveState,
  current: DriveState,
  fraction: number,
) {
  const t = clamp(fraction, 0, 1);
  return {
    x: previous.x + (current.x - previous.x) * t,
    z: previous.z + (current.z - previous.z) * t,
    heading: wrap(
      previous.heading + wrap(current.heading - previous.heading) * t,
    ),
    steer: previous.steer + (current.steer - previous.steer) * t,
  };
}
