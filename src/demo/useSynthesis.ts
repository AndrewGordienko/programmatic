import { useEffect, useRef, useState } from "react";
import {
  START_CHECK,
  VERSION,
  validateArtifact,
  validateManifest,
  type ChallengeSpec,
  type FrozenArtifact,
  type Manifest,
  type RaceState,
} from "../challenge/protocol";
import type { Truck } from "../offroad/types";
export const REHEARSAL: ChallengeSpec = {
  seed: 2108263671,
  kind: "quarry",
  searchSeed: 245899,
};
export const DEMO_BUDGET = 5000;
const STORE = "argos-presentation-runs-v1";
export type DemoRun = {
  id: string;
  mode: "rehearsal";
  manifest: Manifest;
  status: "searching" | "deploying" | "complete" | "interrupted" | "error";
  state?: RaceState;
  deployment?: Truck["status"];
  message?: string;
};
async function hash(value: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function useSynthesis() {
  const [artifact, setArtifact] = useState<FrozenArtifact | null>(null),
    [error, setError] = useState(""),
    [run, setRun] = useState<DemoRun | null>(null),
    [preparing, setPreparing] = useState(false);
  const worker = useRef<Worker | null>(null),
    current = useRef<DemoRun | null>(null),
    token = useRef(0),
    lastSave = useRef(0);
  const persist = (next: DemoRun) => {
    const stored: DemoRun[] = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    if (!Array.isArray(stored))
      throw Error(
        "Invalid saved presentation history; export or repair it before a new run.",
      );
    localStorage.setItem(
      STORE,
      JSON.stringify([...stored.filter((r) => r.id !== next.id), next]),
    );
    lastSave.current = performance.now();
  };
  const publish = (next: DemoRun, save = false) => {
    current.current = next;
    setRun(next);
    if (save) persist(next);
  };
  const fail = (message: string) => {
    worker.current?.terminate();
    worker.current = null;
    token.current++;
    setError(message);
    if (current.current) {
      const next = { ...current.current, status: "error" as const, message };
      try {
        publish(next, true);
      } catch {
        publish(next);
      }
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    fetch("/offroad-frozen.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error("Training artifact is unavailable.");
        return r.json();
      })
      .then(async (a: FrozenArtifact) => {
        validateArtifact(a);
        if ((await hash(a.payload)) !== a.hash)
          throw Error("Training artifact checksum mismatch.");
        if (!abort.signal.aborted) setArtifact(a);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => {
      abort.abort();
      token.current++;
      worker.current?.terminate();
      if (
        current.current &&
        ["searching", "deploying"].includes(current.current.status)
      ) {
        try {
          persist({
            ...current.current,
            status: "interrupted",
            message:
              "Presentation closed before completion; last reported outcome retained.",
          });
        } catch {
          /* Existing audit is preserved if storage is full. */
        }
      }
    };
  }, []);
  const start = async () => {
    if (!artifact || preparing || current.current?.status === "searching")
      return;
    setPreparing(true);
    setError("");
    worker.current?.terminate();
    const serial = ++token.current;
    try {
      const manifest: Manifest = {
        version: VERSION,
        startCheck: START_CHECK,
        createdAt: new Date().toISOString(),
        artifactHash: artifact.hash,
        budget: DEMO_BUDGET,
        challenges: [REHEARSAL],
        mode: "learned",
      };
      validateManifest(manifest, artifact);
      const next: DemoRun = {
        id: await hash(manifest),
        mode: "rehearsal",
        manifest,
        status: "searching",
      };
      if (serial !== token.current) return;
      persist(next);
      publish(next);
      const w = new Worker(new URL("../challenge/worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onerror = () => {
        if (serial === token.current)
          fail("Synthesis worker stopped unexpectedly.");
      };
      w.onmessage = (e) => {
        if (serial !== token.current) return;
        if (e.data.type === "error") {
          fail(e.data.message);
          return;
        }
        const state = e.data.state as RaceState;
        try {
          publish(
            {
              ...current.current!,
              state,
              status:
                state.status === "searching"
                  ? "searching"
                  : state.status === "solved"
                    ? "deploying"
                    : "complete",
            },
            state.status !== "searching" ||
              performance.now() - lastSave.current > 2000,
          );
        } catch {
          fail(
            "Could not save the synthesis audit. Export this run before continuing.",
          );
        }
        if (state.status !== "searching") {
          w.terminate();
          worker.current = null;
        }
      };
      // Single baseline: strong hand-designed DSL with frozen trained guidance.
      // There is no saved controller or initial population in this request.
      w.postMessage({ artifact, manifest, index: 0, arm: "fixed" });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  };
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    token.current++;
    if (current.current)
      try {
        publish(
          {
            ...current.current,
            status: "interrupted",
            message: "Stopped by presenter; last reported outcome retained.",
          },
          true,
        );
      } catch {
        fail("Could not save the stopped run.");
      }
  };
  const finish = (status: Truck["status"]) => {
    if (status === "driving" || current.current?.status !== "deploying") return;
    try {
      publish(
        { ...current.current, status: "complete", deployment: status },
        true,
      );
    } catch {
      fail("Could not save deployment result.");
    }
  };
  return { artifact, error, run, preparing, start, stop, finish };
}
