/// <reference lib="webworker" />
import { DrivingSearch } from "./search";
import { evaluateDrivingTransfer } from "./simulator";
import type { DriveConfig, DriveProgram } from "./types";
let search: DrivingSearch | null = null,
  running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function tick() {
  if (!running || !search) return;
  try {
    const snapshot = search.step();
    self.postMessage({ type: "progress", snapshot });
    if (snapshot.generation >= snapshot.config.generations) {
      running = false;
      self.postMessage({ type: "complete" });
    } else timer = setTimeout(tick, 30);
  } catch (e) {
    running = false;
    self.postMessage({ type: "error", message: String(e) });
  }
}
self.onmessage = (
  event: MessageEvent<{
    type: string;
    config?: DriveConfig;
    program?: DriveProgram;
  }>,
) => {
  try {
    const { type, config, program } = event.data;
    if (type === "start" && config) {
      clearTimeout(timer);
      search = new DrivingSearch(config);
      running = true;
      tick();
    } else if (type === "pause") {
      clearTimeout(timer);
      running = false;
    } else if (type === "resume" && search && !running) {
      running = true;
      tick();
    } else if (type === "evaluate" && program)
      self.postMessage({
        type: "evaluation",
        results: evaluateDrivingTransfer(program),
      });
  } catch (e) {
    self.postMessage({ type: "error", message: String(e) });
  }
};
