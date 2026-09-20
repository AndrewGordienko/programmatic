/// <reference lib="webworker" />
import { Search } from "./search";
import { transferTest } from "./simulator";
import type { Config, Program } from "./types";

let search: Search | null = null;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function tick() {
  if (!running || !search) return;
  try {
    const snapshot = search.step();
    self.postMessage({ type: "progress", snapshot });
    if (snapshot.generation >= snapshot.config.generations) {
      running = false;
      self.postMessage({ type: "complete" });
    } else timer = setTimeout(tick, 95);
  } catch (error) {
    running = false;
    self.postMessage({ type: "error", message: String(error) });
  }
}
self.onmessage = (
  event: MessageEvent<{
    type: string;
    config?: Config;
    program?: Program;
    seed?: number;
  }>,
) => {
  try {
    const { type, config, program, seed } = event.data;
    if (type === "start" && config) {
      clearTimeout(timer);
      search = new Search(config);
      running = true;
      tick();
    } else if (type === "pause") {
      running = false;
      clearTimeout(timer);
    } else if (type === "resume" && search && !running) {
      running = true;
      tick();
    } else if (type === "transfer" && program)
      self.postMessage({
        type: "transfer",
        results: transferTest(program, seed),
      });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
