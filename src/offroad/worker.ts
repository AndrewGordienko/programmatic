/// <reference lib="webworker" />
import { OffroadSearch } from "./search";
import { transfer } from "./simulator";
import type { Config, Program } from "./types";
let search: OffroadSearch | null = null,
  running = false,
  timer: ReturnType<typeof setTimeout> | undefined;
function tick() {
  if (!search || !running) return;
  try {
    const snapshot = search.step();
    self.postMessage({ type: "progress", snapshot });
    if (snapshot.generation >= snapshot.config.generations) {
      running = false;
      self.postMessage({ type: "complete" });
    } else timer = setTimeout(tick, 20);
  } catch (error) {
    running = false;
    self.postMessage({ type: "error", message: String(error) });
  }
}
self.onmessage = (
  e: MessageEvent<{ type: string; config?: Config; program?: Program }>,
) => {
  try {
    const m = e.data;
    if (m.type === "start" && m.config) {
      clearTimeout(timer);
      search = new OffroadSearch(m.config);
      running = true;
      tick();
    } else if (m.type === "pause") {
      running = false;
      clearTimeout(timer);
    } else if (m.type === "resume" && search) {
      running = true;
      tick();
    } else if (m.type === "evaluate" && m.program)
      self.postMessage({ type: "evaluation", results: transfer(m.program) });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
