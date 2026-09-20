/// <reference lib="webworker" />
import { evolveLanguage } from "./language";
self.onmessage = (event: MessageEvent<{ seed: number }>) => {
  try {
    const generator = evolveLanguage(event.data.seed);
    const next = () => {
      try {
        const step = generator.next();
        self.postMessage({ type: "progress", result: step.value });
        if (!step.done) setTimeout(next, 25);
      } catch (error) {
        self.postMessage({ type: "error", message: String(error) });
      }
    };
    next();
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
