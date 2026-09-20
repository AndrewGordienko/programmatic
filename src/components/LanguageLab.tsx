import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Braces,
  Check,
  ChevronDown,
  CircleHelp,
  FlaskConical,
  GitBranch,
  Layers,
  LoaderCircle,
  Play,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { LanguageResult } from "../engine/language";

export default function LanguageLab({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [result, setResult] = useState<LanguageResult | null>(null);
  const [running, setRunning] = useState(false),
    [reference, setReference] = useState(true);
  const [seed, setSeed] = useState("42"),
    [showDetails, setShowDetails] = useState(false),
    [showTrials, setShowTrials] = useState(false);
  const worker = useRef<Worker | null>(null);
  const hasStarted = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/language-reference.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((r) => {
        if (!hasStarted.current) setResult(r);
      })
      .catch(() => {});
    return () => {
      abort.abort();
      worker.current?.terminate();
    };
  }, []);
  const start = () => {
    if (!/^\d{1,6}$/.test(seed)) {
      notify("Use a seed between 0 and 999999.");
      return;
    }
    hasStarted.current = true;
    worker.current?.terminate();
    setReference(false);
    setRunning(true);
    setResult(null);
    const w = new Worker(
      new URL("../engine/language-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "progress") {
        setResult(e.data.result);
        if (e.data.result.completed) {
          setRunning(false);
          w.terminate();
          notify("DSL discovery complete. Held-out comparisons are ready.");
        }
      } else if (e.data.type === "error") {
        setRunning(false);
        notify(e.data.message);
        w.terminate();
      }
    };
    w.onerror = () => {
      setRunning(false);
      notify(
        "The grammar search stopped unexpectedly. Start a new run to retry.",
      );
      w.terminate();
    };
    w.postMessage({ seed: Number(seed) });
  };
  const exportResult = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `argos-language-seed-${result.seed}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fixed = result?.trials.filter((t) => t.fixed.solved).length ?? 0,
    evolved = result?.trials.filter((t) => t.evolved.solved).length ?? 0;
  const count = result?.trials.length ?? 0;
  const fixedCalls =
    result?.trials.reduce((sum, t) => sum + t.fixed.evaluations, 0) ?? 0;
  const macroUsage =
    result?.trials.filter((t) => t.evolved.macroCalls > 0).length ?? 0;
  return (
    <section className="language-lab">
      <div className="experiment-toolbar">
        <div className="experiment-name">
          <h2>Discovering the building blocks</h2>
          <span className={`run-status ${running ? "is-running" : ""}`}>
            <span />
            {reference
              ? "Reference run"
              : running
                ? "Search running"
                : result?.completed
                  ? "Completed"
                  : "Stopped"}
          </span>
        </div>
        <div className="experiment-actions">
          <label className="seed-input">
            Seed
            <input
              aria-label="DSL experiment seed"
              inputMode="numeric"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              disabled={running}
            />
          </label>
          <button
            className="primary-button run-button"
            onClick={() => {
              if (running) {
                worker.current?.terminate();
                setRunning(false);
                notify(
                  "DSL experiment stopped. Partial results remain visible.",
                );
              } else start();
            }}
          >
            {running ? (
              <Square size={12} fill="currentColor" />
            ) : (
              <Play size={13} fill="currentColor" />
            )}
            {running ? "Stop discovery" : "Run discovery"}
          </button>
        </div>
      </div>
      <div className="language-question">
        <div className="language-question-copy">
          <span className="eyebrow">THE QUESTION BEHIND THE RESEARCH</span>
          <h2>
            What if the language
            <br />
            could learn, too?
          </h2>
          <p>
            A useful primitive can turn a difficult search into a short one.
            <br className="desktop-break" /> This experiment asks which building
            blocks are worth inventing.
          </p>
          <button
            className="text-button"
            onClick={() => setShowDetails(!showDetails)}
          >
            <CircleHelp size={14} />
            {showDetails
              ? "Hide experiment design"
              : "Read the experiment design"}
            <ChevronDown size={13} className={showDetails ? "rotate" : ""} />
          </button>
        </div>
        <div className="grammar-art" aria-hidden="true">
          <div className="art-label">PRIMITIVES</div>
          <div className="grammar-atoms">
            <span>max</span>
            <span>−</span>
            <span>0</span>
            <span>x</span>
          </div>
          <div className="grammar-connectors">
            <svg viewBox="0 0 220 46">
              <path
                d="M 20 0 C 20 32, 110 10, 110 45 M 80 0 C 80 25, 110 18, 110 45 M 140 0 C 140 25, 110 18, 110 45 M 200 0 C 200 32, 110 10, 110 45"
                stroke="#b9c5ed"
                fill="none"
                strokeWidth="1"
              />
            </svg>
          </div>
          <div className="grammar-macro">
            <Sparkles size={16} />
            <span>new abstraction</span>
            <Braces size={17} />
          </div>
          <span className="art-label bottom">
            DISCOVER · COMPOSE · EVALUATE
          </span>
        </div>
      </div>
      {showDetails && (
        <div className="experiment-design">
          <h3>A small, falsifiable experiment in grammar induction.</h3>
          <div className="design-columns">
            <article>
              <strong>What is supplied</strong>
              <p>
                Scalar inputs x and y; constants −1, 0, 1, 2; six arithmetic
                operators; genetic search; six induction tasks, three
                development tasks, and three held-out tasks. Targets are fitness
                oracles, never supplied as program syntax.
              </p>
            </article>
            <article>
              <strong>What is discovered</strong>
              <p>
                Programs first. Then reusable, parameterized subexpressions
                mined from successful solutions. Each proposed macro changes the
                available grammar. Only the best measured development-task
                improvement is accepted each round.
              </p>
            </article>
            <article>
              <strong>What is measured</strong>
              <p>
                Two outer rounds. Nine final paired trials across three
                optimizer seeds per held-out task. Both languages get 669
                candidate evaluations per trial, the same examples, and the same
                program bounds. Discovery overhead is reported separately.
              </p>
            </article>
          </div>
          <div className="design-caveat">
            This is compositional macro discovery in an existing scalar
            language. It does not invent new types, control flow, or perceptual
            primitives. Equal candidate counts do not imply equal runtime.
            Sixty-five validation inputs test behavior; they are not a formal
            equivalence proof. Three task families are too small for a general
            research claim.
          </div>
        </div>
      )}
      <div className="dsl-metrics metrics-grid">
        <article className="metric-card">
          <div className="metric-title">
            Language growth
            <Blocks size={16} />
          </div>
          <div className="metric-value">
            6<span>→</span>
            {6 + (result?.macros.length ?? 0)}
            <span>operators</span>
          </div>
          <div className="metric-caption">
            <span className="small-purple-dot" />
            {result?.macros.length ?? 0} abstraction
            {result?.macros.length === 1 ? "" : "s"} accepted
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-title">
            Held-out solves
            <FlaskConical size={16} />
          </div>
          <div className="paired-metric">
            <span>
              {count ? fixed : "—"}
              <small>fixed</small>
            </span>
            <ArrowRight size={17} />
            <span>
              {count ? evolved : "—"}
              <small>evolved</small>
            </span>
            <i>/ {count || 9}</i>
          </div>
          <div className="metric-caption">
            {count
              ? "Paired seeds · same inner-search budget"
              : "Measured after the language is frozen"}
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-title">
            Discovery overhead
            <GitBranch size={16} />
          </div>
          <div className="metric-value">
            {result
              ? `${(result.discoveryEvaluations / 1000).toFixed(1)}k`
              : "—"}
            <span>evaluations</span>
          </div>
          <div className="metric-caption">
            Mining runs + all proposal evaluations
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-title">
            Comparison budget
            <Layers size={16} />
          </div>
          <div className="metric-value">
            {count ? `${(fixedCalls / 1000).toFixed(1)}k` : "—"}
            <span>per language</span>
          </div>
          <div className="metric-caption">
            CPU time also depends on program size
          </div>
        </article>
      </div>
      <div className="dsl-progress">
        <div>
          <span className={running ? "status-dot pulse" : "status-dot gray"} />
          <span>
            {result?.phase ??
              (running
                ? "Initializing the grammar search…"
                : "Ready for a new experiment")}
          </span>
          <span>{result ? `${Math.round(result.progress)}%` : "0%"}</span>
        </div>
        <div className="dsl-progress-track">
          <span style={{ width: `${result?.progress ?? 0}%` }} />
        </div>
      </div>
      <div className="language-grid">
        <section className="panel language-grammar">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <span className="icon-square purple">
                <Blocks size={18} />
              </span>
              <div>
                <h2>The evolving language</h2>
                <p>Every new primitive has an inspectable definition.</p>
              </div>
            </div>
            <span className="node-badge">SCALAR → SCALAR</span>
          </div>
          <div className="base-grammar">
            <div className="micro-label">HAND-SUPPLIED BASE LANGUAGE</div>
            <div className="operator-list">
              {["add", "subtract", "multiply", "min", "max", "negate"].map(
                (op) => (
                  <span key={op}>{op}</span>
                ),
              )}
            </div>
            <p>
              Inputs: x, y <span>·</span> Constants: −1, 0, 1, 2
            </p>
          </div>
          <div className="macro-list">
            <div className="micro-label">LEARNED ABSTRACTIONS</div>
            {result?.macros.length ? (
              result.macros.map((macro, i) => (
                <article className="macro-card" key={macro.name}>
                  <div>
                    <span className="macro-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="accepted-badge">
                      <Check size={11} />
                      Accepted
                    </span>
                    <span>
                      {macro.arity} argument{macro.arity > 1 ? "s" : ""}
                    </span>
                  </div>
                  <code>{macro.definition}</code>
                  <p>
                    Observed in {macro.support} induction task
                    {macro.support > 1 ? "s" : ""} · {macro.size} nodes before
                    abstraction
                  </p>
                </article>
              ))
            ) : (
              <div className="no-macros">
                <Braces size={27} />
                <p>
                  {running
                    ? "Searching for useful compositions…"
                    : "No abstractions accepted in this run."}
                </p>
              </div>
            )}
          </div>
          <div className="grammar-footer">
            <span>
              <GitBranch size={13} />A macro expands back to its original
              expression.
            </span>
          </div>
        </section>
        <section className="panel comparison-panel">
          <div className="panel-heading">
            <div className="heading-with-icon">
              <span className="icon-square">
                <FlaskConical size={18} />
              </span>
              <div>
                <h2>Did a better language help?</h2>
                <p>Fresh searches on tasks excluded from grammar selection.</p>
              </div>
            </div>
          </div>
          <div className="comparison-key">
            <span>
              <i />
              Fixed language
            </span>
            <span>
              <i />
              Evolved language
            </span>
          </div>
          <div className="comparison-rows">
            {["absolute-gap", "positive-sum", "bounded-sum"].map(
              (task, index) => {
                const trials =
                  result?.trials.filter((t) => t.task === task) ?? [];
                const a = trials.filter((t) => t.fixed.solved).length,
                  b = trials.filter((t) => t.evolved.solved).length;
                return (
                  <div className="comparison-row" key={task}>
                    <div>
                      <h3>
                        {
                          [
                            "Magnitude of a difference",
                            "Positive part of a sum",
                            "Bounded sum",
                          ][index]
                        }
                      </h3>
                      <span>{trials.length}/3 seeds evaluated</span>
                    </div>
                    <div className="comparison-bar fixed">
                      <span style={{ width: `${(a / 3) * 100}%` }} />
                      <strong>{trials.length ? `${a}/3` : "—"}</strong>
                    </div>
                    <div className="comparison-bar evolved">
                      <span style={{ width: `${(b / 3) * 100}%` }} />
                      <strong>{trials.length ? `${b}/3` : "—"}</strong>
                    </div>
                  </div>
                );
              },
            )}
          </div>
          <div className="comparison-verdict">
            {result?.completed ? (
              <>
                <span className="icon-square purple">
                  <Sparkles size={16} />
                </span>
                <p>
                  <strong>
                    {evolved > fixed
                      ? `+${evolved - fixed} solved trial${evolved - fixed > 1 ? "s" : ""} with the evolved DSL.`
                      : evolved === fixed
                        ? "No improvement in solved trials this run."
                        : "The evolved DSL solved fewer trials this run."}
                  </strong>
                  {macroUsage} of {count} final programs use a learned
                  primitive. One seed suite is evidence to inspect, not a
                  general conclusion.
                </p>
              </>
            ) : (
              <>
                <LoaderCircle size={16} className={running ? "spin" : ""} />
                <p>Final evaluation begins after the language is frozen.</p>
              </>
            )}
          </div>
        </section>
      </div>
      <section className="panel proposals-panel">
        <div className="population-heading">
          <div>
            <h2>The proposals that shaped the language</h2>
            <p>
              Shorter definitions are a hypothesis. Better search is the
              acceptance test.
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={!result}
            onClick={exportResult}
          >
            <ArrowDownToLine size={14} />
            Export experiment
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PROPOSED DEFINITION</th>
                <th>DEVELOPMENT SCORE</th>
                <th>OUTCOME</th>
                <th>SUPPORT</th>
              </tr>
            </thead>
            <tbody>
              {result?.proposals.map((proposal, i) => (
                <tr key={i}>
                  <td title={proposal.reason}>
                    <code>{proposal.macro.definition}</code>
                  </td>
                  <td className="mono">
                    {proposal.before.toFixed(3)}{" "}
                    <span className="muted">→</span> {proposal.after.toFixed(3)}
                  </td>
                  <td>
                    <span
                      className={
                        proposal.accepted ? "accepted-badge" : "rejected-badge"
                      }
                    >
                      {proposal.accepted ? (
                        <Check size={11} />
                      ) : (
                        <X size={11} />
                      )}
                      {proposal.accepted ? "Accepted" : "Not selected"}
                    </span>
                  </td>
                  <td>
                    {proposal.macro.support} task
                    {proposal.macro.support > 1 ? "s" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result?.proposals.length && (
            <div className="pending-proposals">
              Candidate abstractions appear here after the first induction pass.
            </div>
          )}
        </div>
        <div className="proposal-score-note">
          Development score = 2 × solved + 1 / (1 + validation MAE) − 0.001 ×
          syntax nodes, averaged over 6 trials. Every proposal gets the same
          budget. Hover a definition for the selection reason.
        </div>
      </section>
      <section className="trial-details">
        <button onClick={() => setShowTrials(!showTrials)}>
          <Braces size={15} />
          {showTrials ? "Hide" : "Inspect"} final programs and exact errors
          <ChevronDown size={15} className={showTrials ? "rotate" : ""} />
        </button>
        {showTrials && (
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>TASK / SEED</th>
                  <th>FIXED DSL PROGRAM</th>
                  <th>EVOLVED DSL PROGRAM</th>
                  <th>VALIDATION MAE</th>
                </tr>
              </thead>
              <tbody>
                {result?.trials.map((t) => (
                  <tr key={t.seed}>
                    <td>
                      <span>
                        {t.label}
                        <small>seed {t.seed}</small>
                      </span>
                    </td>
                    <td>
                      <code>{t.fixed.expression}</code>
                    </td>
                    <td>
                      <code>{t.evolved.expression}</code>
                    </td>
                    <td className="mono">
                      {t.fixed.validationError.toFixed(4)} →{" "}
                      {t.evolved.validationError.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="research-note">
        <span className="note-icon">
          <Layers size={19} />
        </span>
        <p>
          <strong>Two different search problems.</strong> The Policy search tab
          evolves programs inside a fixed DSL. This tab tests changes to the DSL
          itself. Navigation is one application; language discovery is the
          research question.
        </p>
        <button onClick={() => setShowDetails(true)}>
          What this tests
          <ArrowUpRight size={15} />
        </button>
      </div>
    </section>
  );
}
