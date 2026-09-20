import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Flag,
  FlaskConical,
  GitBranch,
  LoaderCircle,
  Mountain,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Settings2,
  Shuffle,
  TrafficCone,
} from "lucide-react";
import Modal from "../components/Modal";
import Chart from "../components/Chart";
import OffroadViewport from "./OffroadViewport";
import { activeGenes, programLines, validate } from "./program";
import { initialState } from "./simulator";
import { makeTerrain } from "./terrain";
import {
  CONFIG,
  VECTOR_INPUTS,
  type Config,
  type Evaluation,
  type Snapshot,
  type TerrainKind,
  type Truck,
} from "./types";
import "./offroad.css";
const LABELS: Record<TerrainKind, string> = {
  woodland: "Woodland",
  quarry: "Rock quarry",
  ridge: "Rolling ridges",
};
const END = {
  driving: "Driving",
  arrived: "Destination reached",
  collision: "Rock / tree collision",
  rollover: "Stability limit exceeded",
  grounded: "Ground clearance exhausted",
  boundary: "Left the test area",
  timeout: "Time limit reached",
};
function save(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function valid(s: unknown): s is Snapshot {
  try {
    const p = s as Snapshot;
    return (
      !!p?.history?.length &&
      validate(p.best.program) &&
      !!p.checkpoints?.length
    );
  } catch {
    return false;
  }
}
type Benchmark = {
  seeds: number[];
  config: Config;
  arms: {
    name: string;
    neural: boolean;
    evolveDSL: boolean;
    runs: {
      seed: number;
      arrivals: number;
      count: number;
      collisions: number;
      instabilities: number;
      trainingRollouts: number;
      discoveryRollouts: number;
      seconds: number;
      macros: number;
      blindObstacleSensors: {
        arrivals: number;
        collisions: number;
        count: number;
      };
    }[];
  }[];
};
export default function OffroadLab({
  active,
  notify,
}: {
  active: boolean;
  notify: (text: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [status, setStatus] = useState("reference"),
    [config, setConfig] = useState(CONFIG),
    [draft, setDraft] = useState(CONFIG),
    [settings, setSettings] = useState(false),
    [loadError, setLoadError] = useState(false);
  const [kind, setKind] = useState<TerrainKind>("woodland"),
    [seed, setSeed] = useState(42000),
    [playing, setPlaying] = useState(true),
    [speed, setSpeed] = useState(1),
    [camera, setCamera] = useState<"chase" | "overhead" | "onboard">("chase"),
    [sensors, setSensors] = useState(false),
    [reset, setReset] = useState(0),
    [obstacle, setObstacle] = useState(0),
    [manual, setManual] = useState(false),
    [checkpoint, setCheckpoint] = useState(-1);
  const [results, setResults] = useState<Evaluation[] | null>(null),
    [testing, setTesting] = useState(false),
    [contract, setContract] = useState(false),
    [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const terrain = useMemo(() => makeTerrain(seed, kind), [seed, kind]);
  const [frame, setFrame] = useState<Truck>(() => initialState(terrain));
  const worker = useRef<Worker | null>(null),
    testWorker = useRef<Worker | null>(null),
    latest = useRef<Snapshot | null>(null),
    started = useRef(false);
  const candidate =
    snapshot &&
    (checkpoint < 0
      ? snapshot.best
      : (snapshot.checkpoints[checkpoint]?.candidate ?? snapshot.best));
  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "progress") {
        setSnapshot(e.data.snapshot);
        latest.current = e.data.snapshot;
      } else if (e.data.type === "complete") {
        setStatus("complete");
        notify("Off-road search complete. Test the program on unseen terrain.");
        try {
          localStorage.setItem(
            "argos-offroad-v1",
            JSON.stringify(latest.current),
          );
        } catch {
          notify("Export the experiment to save it; local storage is full.");
        }
      } else if (e.data.type === "error") {
        setStatus("error");
        notify(e.data.message);
      }
    };
    w.onerror = () => {
      setStatus("error");
      notify(
        "Off-road search stopped unexpectedly. Start a fresh run to retry.",
      );
    };
    const controller = new AbortController();
    let loaded = false;
    try {
      const saved = JSON.parse(
        localStorage.getItem("argos-offroad-v1") ?? "null",
      );
      if (valid(saved)) {
        setSnapshot(saved);
        latest.current = saved;
        setConfig(saved.config);
        setSeed(saved.config.seed * 1000);
        setStatus("saved");
        loaded = true;
      }
    } catch {
      /* Ignore stale cache. */
    }
    if (!loaded)
      fetch("/offroad-reference.json", { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw Error("Missing reference");
          return r.json();
        })
        .then((s) => {
          if (!started.current) {
            if (valid(s)) {
              setSnapshot(s);
              latest.current = s;
              setConfig(s.config);
              setSeed(s.config.seed * 1000);
            } else setLoadError(true);
          }
        })
        .catch((e) => {
          if (e.name !== "AbortError") setLoadError(true);
        });
    fetch("/offroad-benchmark.json", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (b?.arms?.length) setBenchmark(b);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      w.terminate();
      testWorker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    setFrame(initialState(terrain));
  }, [terrain]);
  const begin = (c = config) => {
    started.current = true;
    setConfig(c);
    setCheckpoint(-1);
    setStatus("running");
    setResults(null);
    setManual(false);
    setPlaying(true);
    setReset((r) => r + 1);
    testWorker.current?.terminate();
    setTesting(false);
    worker.current?.postMessage({ type: "start", config: c });
  };
  const train = () => {
    if (status === "running") {
      worker.current?.postMessage({ type: "pause" });
      setStatus("paused");
    } else if (status === "paused") {
      worker.current?.postMessage({ type: "resume" });
      setStatus("running");
    } else begin();
  };
  const evaluate = () => {
    if (!candidate) return;
    setTesting(true);
    setResults(null);
    testWorker.current?.terminate();
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    testWorker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "evaluation") {
        setResults(e.data.results);
        setTesting(false);
        w.terminate();
      } else if (e.data.type === "error") {
        notify(e.data.message);
        setTesting(false);
        w.terminate();
      }
    };
    w.onerror = () => {
      setTesting(false);
      notify("Terrain evaluation failed. Please retry.");
      w.terminate();
    };
    w.postMessage({ type: "evaluate", program: candidate.program });
  };
  const selectCheckpoint = (index: number) => {
    setCheckpoint(index);
    setResults(null);
    testWorker.current?.terminate();
    setTesting(false);
    setReset((v) => v + 1);
    setPlaying(true);
  };
  const remaining = Math.hypot(
      terrain.goal.x - frame.x,
      terrain.goal.z - frame.z,
    ),
    progress = Math.max(
      0,
      Math.min(
        100,
        (1 - (remaining - 4) / (terrain.initialDistance - 4)) * 100,
      ),
    );
  const inTraining =
    !!snapshot &&
    Array.from({ length: snapshot.config.worlds }, (_, i) => ({
      seed: snapshot.config.seed * 1000 + i * 113,
      kind: (["woodland", "quarry", "ridge"] as const)[i % 3],
    })).some((t) => t.seed === seed && t.kind === kind);
  const used = candidate
    ? new Set(
        activeGenes(candidate.program).flatMap((i) =>
          candidate.program.genes[i].refs.filter(
            (r) => r < VECTOR_INPUTS.length,
          ),
        ),
      )
    : new Set<number>();
  return (
    <section className="off-lab">
      <div className="experiment-toolbar">
        <div className="experiment-name">
          <h2>Off-road autonomy</h2>
          <span
            className={`run-status ${status === "running" ? "is-running" : ""}`}
          >
            <span />
            {status === "running"
              ? "Evolving on terrain"
              : status === "paused"
                ? "Training paused"
                : status === "complete"
                  ? "Training complete"
                  : status === "saved"
                    ? "Saved experiment"
                    : status === "error"
                      ? "Search error"
                      : "Trained reference"}
          </span>
        </div>
        <div className="experiment-actions">
          <button
            className="secondary-button"
            onClick={() => {
              setDraft(config);
              setSettings(true);
            }}
            disabled={status === "running"}
          >
            <Settings2 size={15} />
            Configure
          </button>
          <button className="primary-button" onClick={train}>
            {status === "running" ? <Pause size={14} /> : <Play size={14} />}{" "}
            {status === "running"
              ? "Pause training"
              : status === "paused"
                ? "Resume training"
                : "Train off-road policy"}
          </button>
        </div>
      </div>
      {!snapshot || !candidate ? (
        <div className="loading-state">
          <Mountain size={35} />
          <h2>
            {loadError
              ? "Ready to evolve an off-road controller."
              : "Loading terrain and trained program…"}
          </h2>
          <button className="primary-button" onClick={() => begin()}>
            Start training
          </button>
        </div>
      ) : (
        <>
          <div className="off-intro">
            <span className="off-domain">
              <Mountain size={15} /> UNEVEN TERRAIN / DESTINATION NAVIGATION
            </span>
            <p>Choose a route. Read the ground. Reach the flag.</p>
            <span className="off-model">
              Generic 4×4 · simplified terrain dynamics
            </span>
          </div>
          <div className="off-metrics">
            <article>
              <span>LIVE SPEED</span>
              <strong>
                {(frame.speed * 3.6).toFixed(0)}
                <small>km/h</small>
              </strong>
            </article>
            <article>
              <span>DESTINATION</span>
              <strong>
                {remaining.toFixed(0)}
                <small>meters away</small>
              </strong>
            </article>
            <article>
              <span>TRAINING ARRIVALS</span>
              <strong>
                {Math.round(snapshot.best.success * snapshot.config.worlds)}
                <small>/ {snapshot.config.worlds} terrains</small>
              </strong>
            </article>
            <article>
              <span>TRAINING COLLISIONS</span>
              <strong>
                {snapshot.best.collisions}
                <small>/ {snapshot.config.worlds} terrains</small>
              </strong>
            </article>
            <article>
              <span>GENERATION</span>
              <strong>
                {snapshot.generation}
                <small>/ {snapshot.config.generations}</small>
              </strong>
            </article>
          </div>
          <div className="off-workspace">
            <section className="panel off-scene">
              <div className="off-scene-heading">
                <div>
                  <span className="icon-square">
                    <Mountain size={20} />
                  </span>
                  <div>
                    <h2>Find your own way</h2>
                    <p>
                      {LABELS[kind]} · {inTraining ? "training" : "unseen"}{" "}
                      terrain · seed {seed}
                    </p>
                  </div>
                </div>
                <span
                  className={`off-status ${frame.status !== "driving" && frame.status !== "arrived" ? "bad" : ""}`}
                >
                  {manual ? "MANUAL" : END[frame.status].toUpperCase()}
                </span>
              </div>
              <div className="off-tools">
                <select
                  aria-label="Off-road terrain"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as TerrainKind);
                    setPlaying(true);
                  }}
                >
                  {Object.entries(LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  aria-label="Generate unseen terrain"
                  onClick={() => {
                    setSeed((s) =>
                      s < 1_500_000_000 ? 1_500_000_042 : s + 97,
                    );
                    setPlaying(true);
                  }}
                >
                  <Shuffle size={15} />
                </button>
                <div className="off-cameras">
                  {(["chase", "overhead", "onboard"] as const).map((c) => (
                    <button
                      key={c}
                      className={camera === c ? "active" : ""}
                      onClick={() => setCamera(c)}
                    >
                      {c === "chase"
                        ? "Chase"
                        : c === "overhead"
                          ? "Map"
                          : "Onboard"}
                    </button>
                  ))}
                </div>
                <button
                  className={`icon-button ${sensors ? "enabled" : ""}`}
                  aria-label="Show terrain sensors"
                  aria-pressed={sensors}
                  onClick={() => setSensors(!sensors)}
                >
                  <Radar size={17} />
                </button>
              </div>
              <div className="off-canvas">
                {active && (
                  <OffroadViewport
                    program={candidate.program}
                    terrain={terrain}
                    playing={playing}
                    speed={speed}
                    camera={camera}
                    sensors={sensors}
                    reset={reset}
                    obstacle={obstacle}
                    manual={manual}
                    onFrame={setFrame}
                  />
                )}
                <div className="off-terrain-label">
                  <span>{LABELS[kind].toUpperCase()}</span>
                  <small>100 × 100 M · {terrain.rocks.length} OBSTACLES</small>
                </div>
                <div className="off-compass">
                  <Flag size={15} />
                  {remaining.toFixed(0)} m
                </div>
                <div className="off-instruments">
                  <div>
                    <span>PITCH</span>
                    <strong>
                      {((frame.pitch * 180) / Math.PI).toFixed(1)}°
                    </strong>
                  </div>
                  <div>
                    <span>ROLL</span>
                    <strong>
                      {((frame.roll * 180) / Math.PI).toFixed(1)}°
                    </strong>
                  </div>
                  <div>
                    <span>GRIP</span>
                    <strong>{frame.grip.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>CLEARANCE</span>
                    <strong>
                      {(frame.clearance * 100).toFixed(0)}
                      <small> cm</small>
                    </strong>
                  </div>
                </div>
                {manual && (
                  <div className="off-manual">
                    W / ↑ throttle · S / ↓ brake · A D / ← → steer
                  </div>
                )}
                {frame.status !== "driving" && (
                  <div className="off-ended">
                    <span>
                      {frame.status === "arrived" ? (
                        <Flag size={25} />
                      ) : (
                        <TrafficCone size={25} />
                      )}
                    </span>
                    <h3>{END[frame.status]}</h3>
                    <p>
                      {progress.toFixed(0)}% progress · {frame.time.toFixed(1)}s
                      · {frame.distance.toFixed(0)}m driven
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setReset((v) => v + 1);
                        setPlaying(true);
                      }}
                    >
                      <RotateCcw size={14} />
                      Replay terrain
                    </button>
                  </div>
                )}
              </div>
              <div className="off-playback">
                <button
                  className="playback-play"
                  aria-label={
                    playing
                      ? "Pause off-road simulation"
                      : "Play off-road simulation"
                  }
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Reset off-road simulation"
                  onClick={() => {
                    setReset((v) => v + 1);
                    setPlaying(true);
                  }}
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  className="speed-button"
                  onClick={() => setSpeed(speed === 4 ? 0.5 : speed * 2)}
                >
                  {speed}×
                </button>
                <span>{frame.time.toFixed(1)} / 42s</span>
                <button
                  className="off-drop"
                  disabled={frame.status !== "driving"}
                  onClick={() => setObstacle((v) => v + 1)}
                >
                  <TrafficCone size={14} />
                  Drop rock
                </button>
                <button
                  onClick={() => {
                    setManual(!manual);
                    setPlaying(true);
                  }}
                >
                  {manual ? "Return to AI" : "Take control"}
                </button>
              </div>
              <div className="off-scene-foot">
                <span className="status-dot" />
                Frozen program executing live · replay does not retrain it
              </div>
            </section>
            <section className="panel off-policy">
              <div className="off-policy-heading">
                <div>
                  <h2>The evolved controller</h2>
                  <p>
                    {candidate.nodes} active operations ·{" "}
                    {candidate.expandedNodes} expanded
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Export off-road program"
                  onClick={() =>
                    save(
                      `offroad-${candidate.program.id}.json`,
                      candidate.program,
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                </button>
              </div>
              <label className="off-inspect">
                Inspect generation
                <select
                  aria-label="Inspect off-road generation"
                  value={checkpoint}
                  onChange={(e) => selectCheckpoint(Number(e.target.value))}
                >
                  <option value={-1}>
                    Latest winner · generation {snapshot.generation}
                  </option>
                  {snapshot.checkpoints.map((c, i) => (
                    <option key={i} value={i}>
                      Generation {c.generation} ·{" "}
                      {c.candidate.fitness.toFixed(1)} fitness
                    </option>
                  ))}
                </select>
              </label>
              <div className="off-actuators">
                <div>
                  <span>STEERING</span>
                  <strong>{(frame.controls.steering * 100).toFixed(0)}%</strong>
                  <i>
                    <b
                      style={{ left: `${50 + frame.controls.steering * 45}%` }}
                    />
                  </i>
                </div>
                <div>
                  <span>
                    {frame.controls.acceleration < 0 ? "BRAKE" : "THROTTLE"}
                  </span>
                  <strong>
                    {Math.abs(frame.controls.acceleration * 100).toFixed(0)}%
                  </strong>
                  <i>
                    <b
                      className="off-throttle"
                      style={{
                        width: `${Math.abs(frame.controls.acceleration) * 100}%`,
                      }}
                    />
                  </i>
                </div>
              </div>
              <div className="off-code">
                <div>
                  {candidate.program.id}
                  <span>
                    {manual
                      ? "MANUAL OVERRIDE"
                      : frame.status === "driving" && playing
                        ? "EXECUTING"
                        : "PAUSED / TERMINAL"}
                  </span>
                </div>
                <pre>
                  {programLines(candidate.program).map((line, i) => (
                    <div key={i}>
                      <span>{i + 1}</span>
                      <code>{line}</code>
                    </div>
                  ))}
                </pre>
              </div>
              <div className="off-scans">
                <div className="off-scans-heading">
                  <strong>Local scan · 19 directions</strong>
                  <span>left ← → right</span>
                </div>
                {VECTOR_INPUTS.map((name, i) => (
                  <div
                    className={`off-scan-row ${used.has(i) ? "used" : ""}`}
                    key={name}
                  >
                    <span>
                      {name.replaceAll("_", " ")}
                      {used.has(i) && <Check size={10} />}
                    </span>
                    <div>
                      {Array.from({ length: 19 }, (_, j) => (
                        <i
                          key={j}
                          title={`${(frame.scans?.vectors[i][j] ?? 0).toFixed(3)}`}
                          style={{
                            opacity:
                              0.15 +
                              Math.min(
                                1,
                                Math.abs(frame.scans?.vectors[i][j] ?? 0),
                              ) *
                                0.85,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <p>
                  Checkmarks identify scan inputs referenced by the active
                  program.
                </p>
              </div>
              <button
                className="off-contract-button"
                onClick={() => setContract(!contract)}
              >
                {contract ? "Hide" : "Show"} observation and physics contract{" "}
                <ArrowRight size={13} />
              </button>
            </section>
          </div>
          {contract && (
            <div className="off-contract">
              <h3>What is supplied, what is learned</h3>
              <p>
                The simulator supplies a goal bearing, 19 angular scan samples
                for clearance, slope, roughness and traction, and vehicle state.
                No route, centreline, path planner or collision-avoidance
                controller is provided. The typed program combines scan vectors,
                chooses a direction with argmax, and produces normalized
                steering and signed acceleration. The angle-valued steering
                grammar is an explicit design choice. Sensing uses exact
                simulated geometry; this is not camera perception.
              </p>
              <p>
                Dynamics include a sampled height field, terrain contact probes,
                gravity along slopes, local traction limits, steering lag, drag,
                slip, rectangular rock collisions, clearance and stability
                termination. This is a quasi-static terrain approximation: no
                suspension dynamics, deformable soil, calibrated Ford model or
                deployment guarantees. The displayed generic pickup is inspired
                by the disclosed hardware, not a Raptor digital twin.
              </p>
            </div>
          )}
          <div className="off-lower">
            <Chart
              history={snapshot.history}
              total={snapshot.config.generations}
            />
            <section className="panel off-search">
              <div className="panel-heading">
                <span className="icon-square">
                  <GitBranch size={18} />
                </span>
                <div>
                  <h2>Search over programs and language</h2>
                  <p>Every score comes from actual terrain rollouts.</p>
                </div>
              </div>
              <div className="off-loop">
                <span>Scan</span>
                <ArrowRight size={13} />
                <span>Program</span>
                <ArrowRight size={13} />
                <span>Drive</span>
                <ArrowRight size={13} />
                <span>Evolve</span>
              </div>
              <dl>
                <div>
                  <dt>Program search</dt>
                  <dd>
                    {snapshot.config.neural
                      ? "Neural-guided + evolution"
                      : "Evolution only"}
                  </dd>
                </div>
                <div>
                  <dt>Parent selection</dt>
                  <dd>Per-terrain selection + elites</dd>
                </div>
                <div>
                  <dt>Population</dt>
                  <dd>{snapshot.config.population} typed graphs</dd>
                </div>
                <div>
                  <dt>Policy rollouts</dt>
                  <dd>{snapshot.rollouts.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>DSL discovery rollouts</dt>
                  <dd>{snapshot.discoveryRollouts.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>New DSL primitives</dt>
                  <dd>
                    {snapshot.macros.length} accepted /{" "}
                    {snapshot.inventions.length} tested
                  </dd>
                </div>
                <div>
                  <dt>Training compute</dt>
                  <dd>{(snapshot.elapsedMs / 1000).toFixed(1)} seconds</dd>
                </div>
              </dl>
              <div className="off-gain">
                {snapshot.initial.fitness.toFixed(1)}
                <ArrowRight size={17} />
                {snapshot.best.fitness.toFixed(1)}
                <small>fitness · first generation to winner</small>
              </div>
            </section>
          </div>
          <section className="panel off-transfer">
            <div className="population-heading">
              <div>
                <h2>Unseen terrain</h2>
                <p>
                  36 held-out layouts. The selected program is frozen for
                  evaluation.
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={testing || status === "running"}
                onClick={evaluate}
              >
                {testing ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <FlaskConical size={14} />
                )}{" "}
                {testing ? "Evaluating terrain…" : "Test 36 unseen terrains"}
              </button>
            </div>
            <div className="off-result-grid">
              {(["woodland", "quarry", "ridge"] as const).map((k, i) => {
                const r = results?.[i];
                return (
                  <article key={k}>
                    <h3>
                      <Mountain size={16} />
                      {LABELS[k]}
                    </h3>
                    <strong>
                      {r ? `${Math.round(r.success * 100)}%` : "—"}
                      <small>destinations reached</small>
                    </strong>
                    <div className="off-result-bar">
                      <i style={{ width: `${(r?.success ?? 0) * 100}%` }} />
                    </div>
                    <p>
                      {r
                        ? `${Math.round(r.success * r.count)}/${r.count} arrivals · ${r.collisions} collisions`
                        : "12 independent terrain seeds"}
                    </p>
                    {r && (
                      <>
                        <p>
                          {r.instabilities} stability / boundary failures ·{" "}
                          {r.timeouts} timeouts
                        </p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setKind(k);
                            setSeed(r.seeds[0]);
                            setReset((v) => v + 1);
                            setPlaying(true);
                          }}
                        >
                          Drive first test terrain <ArrowRight size={13} />
                        </button>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          {!!snapshot.inventions.length && (
            <section className="panel off-inventions">
              <div className="population-heading">
                <div>
                  <h2>Language discovery inside the terrain task</h2>
                  <p>
                    Each candidate abstraction is tested on three development
                    terrains across two fresh search seeds. Both winners must
                    use it.
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>PROPOSED ABSTRACTION</th>
                      <th>GENERATION</th>
                      <th>DEVELOPMENT FITNESS</th>
                      <th>USED</th>
                      <th>RESULT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.inventions.map((m, i) => (
                      <tr key={i}>
                        <td>
                          <code>{m.macro.definition}</code>
                        </td>
                        <td>{m.generation}</td>
                        <td>
                          {m.before.toFixed(1)} → {m.after.toFixed(1)}
                        </td>
                        <td>{m.used}/2 winners</td>
                        <td>
                          <span
                            className={
                              m.accepted ? "accepted-badge" : "rejected-badge"
                            }
                          >
                            {m.accepted ? "Accepted" : "Rejected"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="panel off-benchmark">
            <div className="population-heading">
              <div>
                <h2>Does evolving the DSL help?</h2>
                <p>
                  Independent reference comparison ·{" "}
                  {benchmark
                    ? `${benchmark.seeds.length} search seeds per arm`
                    : "benchmark results are being generated"}
                </p>
              </div>
              {benchmark && (
                <button
                  className="text-button"
                  onClick={() => save("offroad-benchmark.json", benchmark)}
                >
                  <ArrowDownToLine size={14} />
                  Export evidence
                </button>
              )}
            </div>
            {benchmark ? (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>SEARCH CONFIGURATION</th>
                        <th>HELD-OUT ARRIVALS</th>
                        <th>COLLISIONS</th>
                        <th>ARRIVALS / SENSORS OFF</th>
                        <th>POLICY ROLLOUTS</th>
                        <th>DSL OVERHEAD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmark.arms.map((a) => {
                        const total = (
                          field:
                            | "arrivals"
                            | "count"
                            | "collisions"
                            | "trainingRollouts"
                            | "discoveryRollouts",
                        ) => a.runs.reduce((n, r) => n + r[field], 0);
                        return (
                          <tr key={a.name}>
                            <td>{a.name}</td>
                            <td>
                              {total("arrivals")} / {total("count")}
                            </td>
                            <td>{total("collisions")}</td>
                            <td>
                              {a.runs.reduce(
                                (n, r) => n + r.blindObstacleSensors.arrivals,
                                0,
                              )}{" "}
                              / {total("count")}
                            </td>
                            <td>
                              {total("trainingRollouts").toLocaleString()}
                            </td>
                            <td>
                              +{total("discoveryRollouts").toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="off-benchmark-note">
                  No proposed DSL primitive was accepted in this reference
                  benchmark; enabling discovery produced no improvement.
                  “Sensors off” keeps obstacles physical but reports maximum
                  clearance to the policy. Arms receive the same main search
                  budget. DSL discovery spends additional rollouts, listed
                  separately; this is not an equal-total-compute advantage
                  claim. All arms face the same held-out terrain seeds. Small
                  benchmark, not a reproduction of Argos’s undisclosed
                  algorithm.
                </p>
              </>
            ) : (
              <p className="off-benchmark-note">
                Run <code>npm run offroad:benchmark</code> to generate the
                four-arm comparison, then reload. No benchmark scores are
                fabricated.
              </p>
            )}
          </section>
          <div className="off-footer">
            <p>
              <Mountain size={16} />
              Independent programmatic-AI experiment · terrain sensing and
              vehicle model are explicitly engineered.
            </p>
            <button
              className="text-button"
              onClick={() =>
                save(
                  `offroad-experiment-${snapshot.config.seed}.json`,
                  snapshot,
                )
              }
            >
              <ArrowDownToLine size={14} />
              Export experiment
            </button>
          </div>
        </>
      )}
      {settings && (
        <Modal
          title="Evolve an off-road controller"
          subtitle="Programs must navigate to the flag through actual terrain."
          close={() => setSettings(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSettings(false);
              setSeed(draft.seed * 1000);
              setKind("woodland");
              begin(draft);
            }}
          >
            <div className="off-settings">
              <label>
                Random seed
                <input
                  type="number"
                  aria-label="Off-road search seed"
                  min={0}
                  max={999999}
                  step={1}
                  required
                  value={draft.seed}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, seed: Number(e.target.value) }))
                  }
                />
              </label>
              <label>
                Population
                <select
                  value={draft.population}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      population: Number(e.target.value),
                    }))
                  }
                >
                  <option value={32}>32 · quick</option>
                  <option value={64}>64 · standard</option>
                  <option value={128}>128 · broad search</option>
                </select>
              </label>
              <label>
                Generations
                <select
                  value={draft.generations}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      generations: Number(e.target.value),
                    }))
                  }
                >
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                  <option value={120}>120</option>
                </select>
              </label>
              <label className="off-check">
                <input
                  type="checkbox"
                  checked={draft.neural}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, neural: e.target.checked }))
                  }
                />
                Neural guidance over partial typed graphs
              </label>
              <label className="off-check">
                <input
                  type="checkbox"
                  checked={draft.evolveDSL}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, evolveDSL: e.target.checked }))
                  }
                />
                Evolve and test new DSL primitives
              </label>
              <p>
                Training uses {draft.worlds} terrains. Separate development maps
                select abstractions; the 36 test terrains never enter search.
                Arrivals, collisions, stability, efficiency and progress
                determine fitness.
              </p>
            </div>
            <div className="modal-footer">
              <span className="muted">
                Runs on your machine in a Web Worker.
              </span>
              <button className="primary-button" type="submit">
                <Play size={14} />
                Start off-road training
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
