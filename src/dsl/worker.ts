import { ablations, experiment } from "./experiment";
import type { Config, Result } from "./types";
let iterator: Generator<Result, Result> | null = null;
onmessage = (
  e: MessageEvent<{ type: string; config: Config; result: Result }>,
) => {
  try {
    iterator =
      e.data.type === "ablations"
        ? ablations(e.data.result)
        : experiment(e.data.config);
    const tick = () => {
      try {
        const next = iterator!.next();
        postMessage({ type: "progress", result: next.value, done: next.done });
        if (!next.done) setTimeout(tick, 0);
      } catch (error) {
        postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    tick();
  } catch (error) {
    postMessage({ type: "error", message: String(error) });
  }
};
