import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Braces,
  CarFront,
  Check,
  ChevronDown,
  CircleHelp,
  Flag,
  FlaskConical,
  Gauge,
  GitBranch,
  Hand,
  LoaderCircle,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Settings2,
  Shuffle,
  TrafficCone,
  X,
} from "lucide-react";
import Chart from "../components/Chart";
import Modal from "../components/Modal";
import DrivingViewport, { type CameraMode } from "./DrivingViewport";
import { driveProgramLines, validateDriveProgram } from "./program";
import { initialDriveState, MAX_STEER } from "./simulator";
import {
  DRIVE_CONFIG,
  type DriveEvaluation,
  type DriveSnapshot,
  type DriveState,
  type RoadKind,
} from "./types";
import { makeDrivingWorld } from "./world";
import "./driving.css";

const LABELS: Record<RoadKind, string> = {
  coastal: "Sweeping bends",
  switchbacks: "Tight switchbacks",
  obstacles: "Obstacle course",
};
const STATUS_LABELS = {
  driving: "Driving",
  finished: "Route complete",
  collision: "Collision",
  offroad: "Left the road",
  timeout: "Time limit",
};
function valid(value: unknown): value is DriveSnapshot {
  try {
    const s = value as DriveSnapshot;
    return Boolean(
      s.best &&
      validateDriveProgram(s.best.program) &&
      s.initial &&
      s.config &&
      s.history?.length &&
      s.checkpoints?.length,
    );
  } catch {
    return false;
  }
}
function exportJSON(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function DrivingLab({
  active,
  notify,
}: {
  active: boolean;
  notify: (text: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<DriveSnapshot | null>(null);
  const [config, setConfig] = useState(DRIVE_CONFIG),
    [draft, setDraft] = useState(DRIVE_CONFIG);
  const [status, setStatus] = useState<
    "reference" | "running" | "paused" | "complete" | "saved"
  >("reference");
  const [kind, setKind] = useState<RoadKind>("coastal"),
    [seed, setSeed] = useState(42000);
  const [playing, setPlaying] = useState(true),
    [speed, setSpeed] = useState(1),
    [camera, setCamera] = useState<CameraMode>("follow");
  const [sensors, setSensors] = useState(true),
    [manual, setManual] = useState(false),
    [reset, setReset] = useState(0),
    [obstacle, setObstacle] = useState(0);
  const [checkpoint, setCheckpoint] = useState(-1),
    [settings, setSettings] = useState(false),
    [contract, setContract] = useState(false);
  const [results, setResults] = useState<DriveEvaluation[] | null>(null),
    [testing, setTesting] = useState(false),
    [loadError, setLoadError] = useState(false);
  const worker = useRef<Worker | null>(null),
    evaluationWorker = useRef<Worker | null>(null),
    started = useRef(false),
    latest = useRef<DriveSnapshot | null>(null);
  const world = useMemo(() => makeDrivingWorld(seed, kind), [seed, kind]);
  const [frame, setFrame] = useState<DriveState>(() =>
    initialDriveState(world),
  );
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
        notify(
          "Driving search complete. The winning program is controlling the car.",
        );
        try {
          localStorage.setItem(
            "argos-driving-v2",
            JSON.stringify(latest.current),
          );
        } catch {
          notify(
            "Local storage is full. Export the driving experiment to keep it.",
          );
        }
      } else if (e.data.type === "error") {
        setStatus("paused");
        notify(e.data.message);
      }
    };
    w.onerror = () => {
      setStatus("paused");
      notify(
        "The driving search stopped unexpectedly. Restart the experiment to retry.",
      );
    };
    let saved = false;
    try {
      const prior = JSON.parse(
        localStorage.getItem("argos-driving-v2") ?? "null",
      );
      if (valid(prior)) {
        setSnapshot(prior);
        setConfig(prior.config);
        latest.current = prior;
        setStatus("saved");
        setSeed(prior.config.seed * 1000);
        saved = true;
      }
    } catch {
      /* A corrupt local cache must not prevent a fresh experiment. */
    }
    const controller = new AbortController();
    if (!saved)
      fetch("/driving-reference.json", { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error("No reference run");
          return r.json();
        })
        .then((data) => {
          if (valid(data) && !started.current) {
            setSnapshot(data);
            latest.current = data;
          } else if (!started.current) setLoadError(true);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setLoadError(true);
        });
    return () => {
      controller.abort();
      w.terminate();
      evaluationWorker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    setFrame(initialDriveState(world));
  }, [world]);
  const begin = (nextConfig = config) => {
    started.current = true;
    evaluationWorker.current?.terminate();
    setTesting(false);
    setResults(null);
    setCheckpoint(-1);
    setManual(false);
    setPlaying(true);
    setStatus("running");
    setReset((v) => v + 1);
    worker.current?.postMessage({ type: "start", config: nextConfig });
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
    if (!candidate || status === "running") return;
    evaluationWorker.current?.terminate();
    setTesting(true);
    setResults(null);
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    evaluationWorker.current = w;
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
      notify("Road evaluation failed. Try again.");
      w.terminate();
    };
    w.postMessage({ type: "evaluate", program: candidate.program });
  };
  const chooseCheckpoint = (index: number) => {
    setCheckpoint(index);
    setResults(null);
    evaluationWorker.current?.terminate();
    setTesting(false);
    setReset((v) => v + 1);
    setPlaying(true);
  };
  const liveSpeed = (frame.speed * 3.6).toFixed(0),
    progress = Math.max(
      0,
      Math.min(100, ((frame.progress - 3) / (world.length - 7)) * 100),
    );
  const inTraining =
    snapshot &&
    Array.from({ length: snapshot.config.worlds }, (_, i) => ({
      seed: snapshot.config.seed * 1000 + i * 113,
      kind: i % 4 === 3 ? "obstacles" : i % 4 === 2 ? "switchbacks" : "coastal",
    })).some((w) => w.seed === seed && w.kind === kind);
  return (
    <section className="driving-lab">
      <div className="experiment-toolbar">
        <div className="experiment-name">
          <h2>Learning to drive</h2>
          <span
            className={`run-status ${status === "running" ? "is-running" : ""}`}
          >
            <span />
            {status === "reference"
              ? "Trained reference"
              : status === "running"
                ? "Training in simulation"
                : status === "paused"
                  ? "Training paused"
                  : status === "saved"
                    ? "Saved driving run"
                    : "Training complete"}
          </span>
        </div>
        <div className="experiment-actions">
          <button
            className="secondary-button"
            disabled={status === "running"}
            onClick={() => {
              setDraft(config);
              setSettings(true);
            }}
          >
            <Settings2 size={15} />
            Configure
          </button>
          {status === "paused" && (
            <button className="secondary-button" onClick={() => begin()}>
              <RotateCcw size={14} />
              Restart
            </button>
          )}
          <button className="primary-button drive-train" onClick={train}>
            {status === "running" ? (
              <Pause size={14} />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
            {status === "running"
              ? "Pause training"
              : status === "paused"
                ? "Resume training"
                : "Train driving policy"}
          </button>
        </div>
      </div>
      {!candidate || !snapshot ? (
        <div className="loading-state">
          <CarFront size={35} />
          <h2>
            {loadError
              ? "Ready to train a driving controller."
              : "Preparing the driving simulator…"}
          </h2>
          <p>
            {loadError
              ? "Run training to evolve a new program locally."
              : "Loading the actual evolved policy and vehicle model."}
          </p>
          <button className="primary-button" onClick={() => begin()}>
            Start training
            <Play size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="drive-summary">
            <article>
              <span>
                <Gauge size={15} />
                Live speed
              </span>
              <div>
                {liveSpeed}
                <small>km/h</small>
                <i className="live-tick">LIVE</i>
              </div>
            </article>
            <article>
              <span>
                <Flag size={15} />
                Current route
              </span>
              <div>
                {progress.toFixed(0)}
                <small>% complete</small>
              </div>
              <div className="drive-mini-progress">
                <i style={{ width: `${progress}%` }} />
              </div>
            </article>
            <article>
              <span>
                <FlaskConical size={15} />
                Training roads finished
              </span>
              <div>
                {Math.round(snapshot.best.success * snapshot.config.worlds)}
                <small>/ {snapshot.config.worlds} roads</small>
              </div>
            </article>
            <article>
              <span>
                <GitBranch size={15} />
                Search generation
              </span>
              <div>
                {snapshot.generation}
                <small>/ {snapshot.config.generations}</small>
                <span className="summary-fitness">
                  {snapshot.best.fitness.toFixed(1)} fitness
                </span>
              </div>
            </article>
          </div>
          <div className="drive-workspace">
            <section className="panel drive-scene-panel">
              <div className="drive-scene-header">
                <div>
                  <span className="icon-square">
                    <CarFront size={19} />
                  </span>
                  <h2>
                    Autonomous driving simulator
                    <span>
                      Continuous vehicle dynamics · live policy execution
                    </span>
                  </h2>
                </div>
                <span
                  className={`drive-state ${frame.status === "collision" || frame.status === "offroad" ? "failed" : ""}`}
                >
                  <span className="status-dot" />
                  {manual
                    ? "MANUAL CONTROL"
                    : STATUS_LABELS[frame.status].toUpperCase()}
                </span>
              </div>
              <div className="drive-scene-toolbar">
                <select
                  aria-label="Driving environment"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as RoadKind);
                    setPlaying(true);
                  }}
                >
                  {Object.entries(LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  aria-label="Generate a new driving road"
                  title="Generate a new held-out road"
                  onClick={() => {
                    setSeed((s) =>
                      s < 1_500_000_000 ? 1_500_000_042 : s + 97,
                    );
                    setPlaying(true);
                  }}
                >
                  <Shuffle size={15} />
                </button>
                <span className="drive-toolbar-divider" />
                <div className="drive-camera-controls">
                  {(["follow", "driver", "overview"] as CameraMode[]).map(
                    (mode) => (
                      <button
                        key={mode}
                        className={camera === mode ? "active" : ""}
                        onClick={() => setCamera(mode)}
                      >
                        {mode === "follow"
                          ? "Chase"
                          : mode === "driver"
                            ? "Driver"
                            : "Overview"}
                      </button>
                    ),
                  )}
                </div>
                <button
                  className={`icon-button ${sensors ? "enabled" : ""}`}
                  aria-label="Toggle driving sensors"
                  aria-pressed={sensors}
                  title="Show range sensors and driven path"
                  onClick={() => setSensors(!sensors)}
                >
                  <Radar size={17} />
                </button>
              </div>
              <div className="drive-canvas-wrap">
                {active && (
                  <DrivingViewport
                    program={candidate.program}
                    world={world}
                    playing={playing}
                    speed={speed}
                    camera={camera}
                    sensors={sensors}
                    manual={manual}
                    reset={reset}
                    obstacle={obstacle}
                    onFrame={setFrame}
                  />
                )}
                <div className="drive-hud-title">
                  <span>{LABELS[kind].toUpperCase()}</span>
                  <small>
                    {inTraining ? "TRAINING ROAD" : "UNSEEN ROAD"} · SEED {seed}
                  </small>
                </div>
                <div className="drive-hud-speed">
                  <strong>{liveSpeed}</strong>
                  <span>KM/H</span>
                  <div>
                    <i
                      style={{
                        transform: `rotate(${(frame.steer / MAX_STEER) * 85}deg)`,
                      }}
                    />
                    <span>{((frame.steer * 180) / Math.PI).toFixed(1)}°</span>
                  </div>
                </div>
                <div className="drive-route-tag">
                  <Flag size={13} />
                  {Math.max(0, world.length - frame.progress).toFixed(0)} m to
                  finish
                </div>
                {manual && (
                  <div className="manual-instructions">
                    W / ↑ throttle <span>S / ↓ brake</span>
                    <span>A D / ← → steer</span>
                  </div>
                )}
                {(frame.status === "collision" ||
                  frame.status === "offroad" ||
                  frame.status === "timeout") && (
                  <div className="drive-ended">
                    <span className="end-icon">
                      <TrafficCone size={25} />
                    </span>
                    <h3>{STATUS_LABELS[frame.status]}</h3>
                    <p>
                      The controller completed {progress.toFixed(0)}% of this
                      road.
                    </p>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setReset((r) => r + 1);
                        setPlaying(true);
                      }}
                    >
                      <RotateCcw size={14} />
                      Try again
                    </button>
                  </div>
                )}
                {frame.status === "finished" && (
                  <div className="drive-finish-badge">
                    <Check size={16} />
                    Route complete · replaying shortly
                  </div>
                )}
              </div>
              <div className="drive-playback">
                <button
                  className="playback-play"
                  aria-label={
                    playing
                      ? "Pause driving simulation"
                      : "Play driving simulation"
                  }
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Restart driving simulation"
                  title="Restart this road"
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
                <span className="drive-clock">
                  {frame.time.toFixed(1)}s <span>/ 55s</span>
                </span>
                <button
                  className="drive-obstacle"
                  onClick={() => {
                    setObstacle((v) => v + 1);
                    notify("Obstacle placed 22 meters ahead of the car.");
                  }}
                  disabled={frame.status !== "driving"}
                >
                  <TrafficCone size={14} />
                  Drop obstacle
                </button>
                <button
                  className={`drive-manual ${manual ? "active" : ""}`}
                  onClick={() => {
                    setManual(!manual);
                    setReset((v) => v + 1);
                    setPlaying(true);
                  }}
                >
                  <Hand size={14} />
                  {manual ? "Return to AI" : "Take control"}
                </button>
              </div>
              <div className="drive-scene-footer">
                <span>
                  <span className="status-dot" />
                  {manual
                    ? "Keyboard controls the actuators"
                    : "Evolved program controls steering, throttle, and brake"}
                </span>
                <span>10 Hz policy · substepped dynamics</span>
              </div>
            </section>
            <section className="panel driving-policy">
              <div className="panel-heading">
                <div className="heading-with-icon">
                  <span className="icon-square purple">
                    <Braces size={18} />
                  </span>
                  <div>
                    <h2>The driving controller</h2>
                    <p>These outputs are driving the car.</p>
                  </div>
                </div>
                <span className="node-badge">
                  {candidate.nodes} active{" "}
                  {candidate.nodes === 1 ? "node" : "nodes"}
                </span>
              </div>
              <div className="drive-policy-picker">
                <label htmlFor="drive-policy">Inspect policy</label>
                <select
                  id="drive-policy"
                  value={checkpoint}
                  onChange={(e) => chooseCheckpoint(Number(e.target.value))}
                >
                  <option value={-1}>
                    Latest winner · generation {snapshot.generation}
                  </option>
                  {snapshot.checkpoints.map((c, i) => (
                    <option key={c.generation} value={i}>
                      Generation {c.generation} ·{" "}
                      {c.candidate.fitness.toFixed(1)} fitness
                    </option>
                  ))}
                </select>
              </div>
              <div className="drive-controls-readout">
                <div>
                  <span>STEERING</span>
                  <strong>
                    {(frame.controls.steering * 100).toFixed(0)}
                    <small>%</small>
                  </strong>
                  <div className="steer-bar">
                    <i
                      style={{ left: `${50 + frame.controls.steering * 46}%` }}
                    />
                  </div>
                </div>
                <div>
                  <span>THROTTLE</span>
                  <strong>
                    {(frame.controls.throttle * 100).toFixed(0)}
                    <small>%</small>
                  </strong>
                  <div className="actuator-bar">
                    <i style={{ width: `${frame.controls.throttle * 100}%` }} />
                  </div>
                </div>
                <div>
                  <span>BRAKE</span>
                  <strong>
                    {(frame.controls.brake * 100).toFixed(0)}
                    <small>%</small>
                  </strong>
                  <div className="actuator-bar braking">
                    <i style={{ width: `${frame.controls.brake * 100}%` }} />
                  </div>
                </div>
              </div>
              <div className="drive-code-heading">
                <span>{candidate.program.id} / DRIVE DSL</span>
                <span>{manual ? "MANUAL OVERRIDE" : "EXECUTING"}</span>
              </div>
              <div className="drive-code">
                <pre>
                  {driveProgramLines(candidate.program).map((line, i) => (
                    <div key={i}>
                      <span>{i + 1}</span>
                      <code
                        className={
                          line.includes("return") || line.includes("def ")
                            ? "code-keyword"
                            : ""
                        }
                      >
                        {line}
                      </code>
                    </div>
                  ))}
                </pre>
              </div>
              <div className="drive-observations">
                <div>
                  <span>Cross-track error</span>
                  <strong>{frame.lateral.toFixed(2)} m</strong>
                </div>
                <div>
                  <span>Lookahead heading error</span>
                  <strong>
                    {(((frame.sensors[1] ?? 0) * 0.6 * 180) / Math.PI).toFixed(
                      1,
                    )}
                    °
                  </strong>
                </div>
                <div>
                  <span>Forward obstacle range</span>
                  <strong>{((frame.sensors[6] ?? 1) * 35).toFixed(1)} m</strong>
                </div>
              </div>
              <div className="drive-policy-footer">
                <button onClick={() => setContract(!contract)}>
                  <CircleHelp size={13} />
                  Observation contract
                  <ChevronDown size={13} />
                </button>
                <button
                  onClick={() =>
                    exportJSON(`driving-policy-${candidate.program.id}.json`, {
                      program: candidate.program,
                      sensorContract:
                        "See observation contract in the UI and src/driving/simulator.ts",
                      dynamics: {
                        policyHz: 10,
                        wheelbase: 2.7,
                        maxSteeringRadians: 0.55,
                        vehicleWidth: 1.8,
                        vehicleLength: 4.2,
                      },
                    })
                  }
                >
                  <ArrowDownToLine size={13} />
                  Export
                </button>
              </div>
            </section>
          </div>
          {contract && (
            <div className="driving-contract">
              <h3>What the policy receives and controls</h3>
              <p>
                The program reads route-heading error, lookahead-heading error,
                cross-track displacement, vehicle speed, speed error, five
                obstacle-range rays, and previous steering. Route geometry and
                obstacle sensing are supplied by the simulator. The learned
                graph directly returns normalized steering and signed
                acceleration, split into throttle and brake. There is no hidden
                route-following controller or collision-avoidance override.
              </p>
              <p>
                Lookahead distance is 7 + 0.5 × speed meters; heading errors are
                divided by 0.6 radians, cross-track by half the road width,
                speed by 18 m/s, speed error by the 14 m/s target, and range by
                35 meters. Arithmetic is clipped to ±20. The kinematic bicycle
                model includes actuator rate limits, drag, braking, a grip-based
                yaw limit, vehicle-footprint collision tests, and road-departure
                termination. It is a simplified closed-course simulator with
                state-vector sensing.
              </p>
            </div>
          )}
          <div className="drive-lower-grid">
            <Chart
              history={snapshot.history}
              total={snapshot.config.generations}
            />
            <section className="panel drive-training-card">
              <div className="panel-heading">
                <div className="heading-with-icon">
                  <span className="icon-square">
                    <GitBranch size={18} />
                  </span>
                  <div>
                    <h2>Learning from actual driving</h2>
                    <p>Every fitness evaluation is a vehicle rollout.</p>
                  </div>
                </div>
              </div>
              <div className="driving-search-loop">
                <span>Observe</span>
                <ArrowRight size={13} />
                <span>Execute program</span>
                <ArrowRight size={13} />
                <span>Drive</span>
                <ArrowRight size={13} />
                <span>Evolve</span>
              </div>
              <div className="search-details">
                <span>
                  Search
                  <strong>
                    {snapshot.config.neural
                      ? "Neural-guided + evolutionary"
                      : "Evolutionary"}
                  </strong>
                </span>
                <span>
                  Population
                  <strong>{snapshot.config.population} controllers</strong>
                </span>
                <span>
                  Training set
                  <strong>
                    {snapshot.config.worlds} roads · 3 environment types
                  </strong>
                </span>
                <span>
                  Vehicle rollouts
                  <strong>{snapshot.evaluations.toLocaleString()}</strong>
                </span>
                <span>
                  DSL discovery
                  <strong>
                    {snapshot.config.evolveDSL
                      ? `${snapshot.inventions.length} proposals tested · ${snapshot.macros.length} accepted`
                      : "Disabled for this run"}
                  </strong>
                </span>
                <span>
                  Compute time
                  <strong>
                    {(snapshot.elapsedMs / 1000).toFixed(1)} seconds
                  </strong>
                </span>
              </div>
              <div className="drive-improvement">
                <strong>
                  {snapshot.initial.fitness.toFixed(1)}
                  <ArrowRight size={15} />
                  {snapshot.best.fitness.toFixed(1)}
                </strong>
                <span>fitness, first generation → current best</span>
              </div>
            </section>
          </div>
          <section className="panel driving-evaluation">
            <div className="population-heading">
              <div>
                <h2>Take the program to unfamiliar roads</h2>
                <p>
                  Freeze this controller and evaluate 24 new roads. Failures
                  stay visible.
                </p>
              </div>
              <button
                className="secondary-button"
                onClick={evaluate}
                disabled={testing || status === "running"}
              >
                {testing ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <FlaskConical size={14} />
                )}
                {testing ? "Testing 24 roads…" : "Test 24 unseen roads"}
              </button>
            </div>
            <div className="drive-evaluation-grid">
              {(["coastal", "switchbacks", "obstacles"] as RoadKind[]).map(
                (k, i) => {
                  const r = results?.[i];
                  return (
                    <article key={k}>
                      <div>
                        <span className="drive-eval-icon">
                          {i === 0 ? (
                            <CarFront size={18} />
                          ) : i === 1 ? (
                            <GitBranch size={18} />
                          ) : (
                            <TrafficCone size={18} />
                          )}
                        </span>
                        <h3>{LABELS[k]}</h3>
                      </div>
                      <strong>
                        {r ? `${Math.round(r.success * 100)}%` : "—"}
                        <small>roads completed</small>
                      </strong>
                      <div className="drive-eval-bar">
                        <span
                          style={{ width: `${(r?.success ?? 0) * 100}%` }}
                        />
                      </div>
                      <p>
                        {r
                          ? `${Math.round(r.success * r.count)}/${r.count} finished · ${r.collisions} collisions · ${r.departures} departures`
                          : "Eight held-out layouts and start conditions"}
                      </p>
                      {r && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setKind(k);
                            setSeed(r.seeds[0]);
                            setReset((v) => v + 1);
                            setPlaying(true);
                          }}
                        >
                          Drive the first test road
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                    </article>
                  );
                },
              )}
            </div>
          </section>
          {snapshot.inventions.length > 0 && (
            <section className="panel driving-inventions">
              <div className="population-heading">
                <div>
                  <h2>DSL proposals tested inside the driving simulator</h2>
                  <p>
                    Compositions mined from driving programs, then compared
                    using equal-budget vehicle searches on development roads.
                    Acceptance requires an improvement and actual use of the new
                    primitive.
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>PROPOSED PRIMITIVE</th>
                      <th>GENERATION</th>
                      <th>DEVELOPMENT FITNESS</th>
                      <th>RESULT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.inventions.map((m, i) => (
                      <tr key={i}>
                        <td>
                          <code>{m.definition}</code>
                        </td>
                        <td>{m.generation}</td>
                        <td>
                          {m.before.toFixed(2)} → {m.after.toFixed(2)}
                        </td>
                        <td>
                          <span
                            className={
                              m.accepted ? "accepted-badge" : "rejected-badge"
                            }
                          >
                            {m.accepted ? <Check size={11} /> : <X size={11} />}
                            {m.accepted
                              ? "Accepted"
                              : m.used === false
                                ? "Rejected · unused"
                                : "Rejected"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="driving-bottom">
            <p>
              <CarFront size={16} />
              The driving algorithm is live: change the road, select an earlier
              generation, or drop an obstacle to see how it responds.
            </p>
            <button
              className="text-button"
              onClick={() =>
                exportJSON(
                  `driving-experiment-seed-${snapshot.config.seed}.json`,
                  snapshot,
                )
              }
            >
              <ArrowDownToLine size={14} />
              Export full experiment
            </button>
          </div>
        </>
      )}
      {settings && (
        <Modal
          title="Train a driving program"
          subtitle="The search evaluates controllers inside the vehicle simulator."
          close={() => setSettings(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setConfig(draft);
              setSettings(false);
              setSeed(draft.seed * 1000);
              setKind("coastal");
              begin(draft);
            }}
          >
            <div className="drive-settings">
              <label>
                Random seed
                <input
                  type="number"
                  aria-label="Driving search seed"
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
                  <option value={32}>32 controllers · quick</option>
                  <option value={80}>80 controllers · standard</option>
                  <option value={128}>128 controllers · broader search</option>
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
                  <option value={25}>25 generations</option>
                  <option value={50}>50 generations</option>
                  <option value={100}>100 generations</option>
                </select>
              </label>
              <label className="drive-setting-check">
                <input
                  type="checkbox"
                  checked={draft.neural}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, neural: e.target.checked }))
                  }
                />
                <span>Neural guidance for program proposals</span>
              </label>
              <label className="drive-setting-check">
                <input
                  type="checkbox"
                  checked={draft.evolveDSL}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, evolveDSL: e.target.checked }))
                  }
                />
                <span>Test new DSL compositions during driving search</span>
              </label>
              <p>
                Each candidate drives {draft.worlds} roads. Steering and
                acceleration are evolved together. Speed, staying on the road,
                reaching the finish, and program size determine fitness.
              </p>
            </div>
            <div className="modal-footer">
              <span className="muted">
                No API keys or GPU training required.
              </span>
              <button className="primary-button" type="submit">
                <Play size={14} />
                Start driving search
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
