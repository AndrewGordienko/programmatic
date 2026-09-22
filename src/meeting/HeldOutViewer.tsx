import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import OffroadViewport from "../offroad/OffroadViewport";
import { makeTerrain } from "../offroad/terrain";
import { SIMULATOR_VERSION } from "../offroad/simulator";
import type { Program, TerrainKind, Truck } from "../offroad/types";

type Result = { kind: TerrainKind; count: number; success: number; seeds: number[] };
type Reference = {
  simulatorVersion: string;
  arms: {
    neural: boolean;
    evolveDSL: boolean;
    runs: { seed: number; program: Program; results: Result[] }[];
  }[];
};

export default function HeldOutViewer() {
  const [reference, setReference] = useState<Reference | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<TerrainKind>("woodland");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [replay, setReplay] = useState(0);
  const [frame, setFrame] = useState<Truck | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/offroad-benchmark.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error("Recorded terrain benchmark unavailable.");
        return r.json();
      })
      .then((data: Reference) => {
        const run = data.arms
          .find((a) => a.neural && a.evolveDSL)
          ?.runs.find((r) => r.seed === 42);
        if (
          data.simulatorVersion !== SIMULATOR_VERSION ||
          !run ||
          run.results.length !== 3 ||
          run.results.some((r) => r.seeds.length !== 12)
        )
          throw Error("Recorded terrain benchmark is inconsistent.");
        setReference(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, []);
  const run = reference?.arms
    .find((a) => a.neural && a.evolveDSL)
    ?.runs.find((r) => r.seed === 42);
  const result = run?.results.find((r) => r.kind === kind);
  const seed = result?.seeds[index];
  const terrain = useMemo(
    () => (seed === undefined ? null : makeTerrain(seed, kind)),
    [seed, kind],
  );
  const change = (next: TerrainKind, nextIndex: number) => {
    setKind(next);
    setIndex(nextIndex);
    setFrame(null);
    setPlaying(true);
    setStarted(true);
    setReplay((n) => n + 1);
  };
  return (
    <section className="meeting-heldout" id="heldout" aria-label="Held-out terrain replay">
      <span className="meeting-eyebrow">04 / FROZEN CONTROLLER ON HELD-OUT TERRAIN</span>
      <h2>Switch terrain. Watch the same controller.</h2>
      <p>These 36 layouts were withheld from training and language selection. Each replay uses the recorded seed-42 controller unchanged. Choose any layout; failures are shown too.</p>
      {error && <p className="meeting-viewer-error" role="alert">{error}</p>}
      {!run && !error && <p>Loading recorded controller…</p>}
      {run && terrain && result && (
        <>
          <div className="meeting-terrain-tabs" role="group" aria-label="Terrain families">
            {run.results.map((r) => (
              <button
                key={r.kind}
                type="button"
                aria-pressed={kind === r.kind}
                onClick={() => change(r.kind, 0)}
              >
                <b>{r.kind}</b>
                <span>{Math.round(r.success * r.count)}/{r.count} reached</span>
              </button>
            ))}
          </div>
          <div className="meeting-replay-bar">
            <div>
              <label htmlFor="meeting-layout">Held-out layout</label>
              <select
                id="meeting-layout"
                value={index}
                onChange={(e) => change(kind, Number(e.target.value))}
              >
                {result.seeds.map((s, i) => (
                  <option key={s} value={i}>{"#" + String(i + 1).padStart(2, "0") + " · seed " + s}</option>
                ))}
              </select>
            </div>
            <div className="meeting-replay-actions">
              <span>Test status: <b>{frame?.status && frame.status !== "driving" ? frame.status : playing ? "driving" : started ? "paused" : "ready"}</b></span>
              <button type="button" onClick={() => { setPlaying((v) => !v); setStarted(true); }}>
                {playing ? <Pause size={15} /> : <Play size={15} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button type="button" onClick={() => { setFrame(null); setPlaying(true); setStarted(true); setReplay((n) => n + 1); }}>
                <RotateCcw size={15} /> Replay
              </button>
            </div>
          </div>
          <div className="meeting-world">
            <OffroadViewport
              key={kind + "-" + seed + "-" + replay}
              program={run.program}
              terrain={terrain}
              playing={playing}
              speed={3}
              camera="chase"
              sensors={false}
              reset={replay}
              obstacle={0}
              manual={false}
              onFrame={setFrame}
            />
            <span className="meeting-world-label">{kind.toUpperCase() + " · LAYOUT " + String(index + 1).padStart(2, "0") + " · 3× PLAYBACK"}</span>
          </div>
          <p className="meeting-heldout-note">The seed-42 reference reaches 26/36 test layouts: woodland 9/12, quarry 11/12, ridge 6/12. This demonstrates control on held-out terrain with an engineered DSL; it is separate from the scalar language-learning result.</p>
        </>
      )}
    </section>
  );
}
