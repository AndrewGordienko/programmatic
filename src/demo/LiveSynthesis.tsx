import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  Eye,
  Flag,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import OffroadViewport from "../offroad/OffroadViewport";
import { programLines } from "../offroad/program";
import { makeTerrain } from "../offroad/terrain";
import type { Truck } from "../offroad/types";
import { DEMO_BUDGET, REHEARSAL, useSynthesis } from "./useSynthesis";
const num = (n: number) => n.toLocaleString();
function exportRun(data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "presentation-synthesis.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function LiveSynthesis({ active }: { active: boolean }) {
  const { artifact, error, run, preparing, start, stop, finish } =
    useSynthesis();
  const terrain = useMemo(
    () => makeTerrain(REHEARSAL.seed, REHEARSAL.kind),
    [],
  );
  const [frame, setFrame] = useState<Truck | null>(null),
    [camera, setCamera] = useState<"chase" | "overhead">("chase"),
    [playing, setPlaying] = useState(true),
    [replay, setReplay] = useState(0);
  const state = run?.state,
    program = state?.solution?.program ?? null,
    searching = run?.status === "searching",
    arrived = !!program && frame?.status === "arrived";
  const interrupted = run?.status === "interrupted" || run?.status === "error";
  const launch = () => {
    setFrame(null);
    setPlaying(true);
    setCamera("chase");
    setReplay(0);
    void start();
  };
  const title = error
    ? "Search stopped"
    : state?.status === "infeasible"
      ? "This start is infeasible"
      : state?.status === "exhausted"
        ? "No solution within budget"
        : interrupted
          ? "Run stopped"
          : searching
            ? "Synthesizing a controller"
            : arrived
              ? "Destination reached"
              : program
                ? "Executing the generated program"
                : "The truck is waiting for code";
  return (
    <div className="presentation-live">
      <div className="presentation-live-actions">
        <div>
          <span className="presentation-label">
            LIVE MECHANISM DEMONSTRATION
          </span>
          <h1>
            A program found.
            <br className="mobile-break" /> A truck in motion.
          </h1>
          <p>
            Quarry rehearsal · previously tested terrain · fresh synthesis every
            run
          </p>
        </div>
        <div className="presentation-run-buttons">
          {searching ? (
            <button className="demo-button secondary" onClick={stop}>
              <Square size={15} />
              Stop search
            </button>
          ) : (
            <button
              className="demo-button"
              disabled={!artifact || preparing || run?.status === "deploying"}
              onClick={launch}
            >
              {preparing ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              Synthesize controller
            </button>
          )}
        </div>
      </div>
      <div className="presentation-live-grid">
        <div className="presentation-world-column">
          <div className="presentation-metrics">
            <div>
              <span>Evaluations</span>
              <strong>
                {num(state?.evaluations ?? 0)}
                <small> / {num(DEMO_BUDGET)}</small>
              </strong>
            </div>
            <div>
              <span>Best fitness</span>
              <strong>{state?.best?.fitness.toFixed(1) ?? "—"}</strong>
            </div>
            <div>
              <span>Destination</span>
              <strong className={arrived ? "is-arrived" : ""}>
                {arrived ? "Reached" : program ? "En route" : "Waiting"}
              </strong>
            </div>
            <div>
              <span>Program nodes</span>
              <strong>
                {state?.solution?.nodes ?? state?.best?.nodes ?? "—"}
              </strong>
            </div>
          </div>
          <div
            className="presentation-world"
            aria-label="Live controller synthesis and deployment"
          >
            <OffroadViewport
              key={run?.id ?? "waiting"}
              program={program}
              terrain={terrain}
              playing={active && playing && !!program && !interrupted}
              speed={1}
              camera={program ? camera : "overhead"}
              sensors={!!program}
              reset={Number(!!program) + replay}
              obstacle={0}
              manual={false}
              onFrame={(s) => {
                setFrame(s);
                finish(s.status);
              }}
            />
            <div className="presentation-world-badge">
              <span />
              LIVE SIMULATION <b>QUARRY · {REHEARSAL.seed}</b>
            </div>
            {!program && (
              <div className="presentation-wait">
                <div
                  className={`presentation-radar ${searching ? "is-searching" : ""}`}
                >
                  <span />
                  <span />
                  <span />
                </div>
                <strong>{title}</strong>
                <p>
                  {error ||
                    state?.diagnosis?.explanation ||
                    (interrupted
                      ? "Last reported results are retained."
                      : state?.status === "exhausted"
                        ? "No failed candidate is deployed."
                        : "Search evaluates executable programs in this world.")}
                </p>
                {searching && (
                  <div className="presentation-search-line">
                    <i
                      style={{
                        width: `${(100 * (state?.evaluations ?? 0)) / DEMO_BUDGET}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {program && (
              <>
                <div
                  className={`presentation-drive-status ${arrived ? "arrived" : ""}`}
                >
                  {arrived ? <Flag size={17} /> : <span className="live-dot" />}
                  <b>{title}</b>
                  {frame && (
                    <span>
                      {Math.max(
                        0,
                        Math.hypot(
                          terrain.goal.x - frame.x,
                          terrain.goal.z - frame.z,
                        ) - 4,
                      ).toFixed(0)}{" "}
                      m remaining
                    </span>
                  )}
                </div>
                <div className="presentation-camera-tools">
                  <button
                    aria-label={
                      camera === "chase"
                        ? "Switch to overview"
                        : "Switch to chase camera"
                    }
                    onClick={() =>
                      setCamera(camera === "chase" ? "overhead" : "chase")
                    }
                  >
                    <Eye size={15} />
                    {camera === "chase" ? "Overview" : "Chase"}
                  </button>
                  {!arrived ? (
                    <button onClick={() => setPlaying(!playing)}>
                      {playing ? <Pause size={14} /> : <Play size={14} />}{" "}
                      {playing ? "Pause drive" : "Resume drive"}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setReplay(replay + 1);
                        setPlaying(true);
                        setFrame(null);
                      }}
                    >
                      <RotateCcw size={14} />
                      Replay drive
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="presentation-world-caption">
            <span>
              Typed evolutionary search · frozen neural prior ·{" "}
              {program
                ? "actual generated controller"
                : "empty starting population"}
            </span>
            <span>
              {state
                ? `${(state.elapsedMs / 1000).toFixed(1)}s search time`
                : "Runs locally on this computer"}
            </span>
          </div>
        </div>
        <aside className="presentation-code">
          <div className="presentation-code-heading">
            <span className="presentation-label">
              EXECUTABLE SYMBOLIC CONTROLLER
            </span>
            <span
              className={`presentation-code-state ${program ? "ready" : ""}`}
            >
              {program ? (
                <>
                  <Check size={12} />
                  SYNTHESIZED
                </>
              ) : (
                <>AWAITING SEARCH</>
              )}
            </span>
          </div>
          <h2>
            {program
              ? "This exact program drives."
              : "The controller starts empty."}
          </h2>
          <p>
            {program
              ? "The simulator executes the graph returned by this search."
              : "Only the language and search prior are supplied. The controller is discovered when you press Synthesize."}
          </p>
          {program ? (
            <pre aria-label="Actual synthesized controller">
              {programLines(program).map((line, i) => (
                <div key={i}>
                  <span className="code-line-number">{i + 1}</span>
                  <code>{line}</code>
                </div>
              ))}
            </pre>
          ) : (
            <div className="presentation-code-placeholder" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <i>waiting for a successful program</i>
            </div>
          )}
          <div className="presentation-program-proof">
            <div>
              <span>Source</span>
              <b>
                {program
                  ? `Current run · ${program.id}`
                  : "No saved controller"}
              </b>
            </div>
            <div>
              <span>Policy</span>
              <b>
                {program ? "Generated symbolic graph" : "Not yet synthesized"}
              </b>
            </div>
            <div>
              <span>DSL</span>
              <b>Hand-designed base language</b>
            </div>
          </div>
          <div className="presentation-code-bottom">
            <p>
              This course demonstrates the mechanism. The held-out language
              result is in the research brief.
            </p>
            {run && (
              <button onClick={() => exportRun({ artifact, run })}>
                <Download size={13} />
                Export this run
              </button>
            )}
            <a href="#challenge">
              Open sealed unseen challenge <ArrowUpRight size={13} />
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
