import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Beaker,
  Check,
  ChevronRight,
  FlaskConical,
  Play,
  Square,
} from "lucide-react";
import {
  comparison,
  curves,
  discoveryCost,
  mean,
  median,
  summarize,
} from "./metrics";
import { makeTasks } from "./tasks";
import {
  ARMS,
  BASE,
  DEFAULT,
  LABELS,
  type Arm,
  type Proposal,
  type Result,
} from "./types";
import "./library.css";
type Summary = ReturnType<typeof summarize>;
type Benchmark = {
  completed: number;
  seeds: number[];
  rows: {
    seed: number;
    arms: Summary[];
    comparison: ReturnType<typeof comparison>;
    macros: string[];
    discoveryMs: number;
    elapsedMs: number;
  }[];
};
type Surrogate = {
  trainingSeeds: number[];
  testSeeds: number[];
  records: number;
  groups: number;
  rows: {
    seed: number;
    round: number;
    oracle: number;
    model: number;
    compression: number;
    random: number;
  }[];
  regret: { model: number; compression: number; random: number };
  note: string;
};
const COLORS: Record<Arm, string> = {
  "fixed-uniform": "#9aa5b4",
  "fixed-prior": "#7862c6",
  "library-uniform": "#74aaa4",
  "library-prior": "#286da9",
};
const number = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Math.round(n).toLocaleString();
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} pp`;
const duration = (ms: number) =>
  ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(1)} s`;
function save(name: string, data: unknown) {
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function Panel({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`ll-panel ${wide ? "ll-wide" : ""}`}>
      <header>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
function Curves({ r }: { r: Result }) {
  const series = curves(r),
    max = Math.max(
      0.1,
      Math.ceil(
        Math.max(...series.flatMap((s) => s.points.map((p) => p.y))) * 10,
      ) / 10,
    ),
    x = (n: number) => 55 + (n / r.config.finalBudget) * 650,
    y = (n: number) => 254 - (n / max) * 215;
  return (
    <>
      <svg
        className="ll-chart"
        viewBox="0 0 750 295"
        role="img"
        aria-label="Held-out solve rate against per-task program evaluations for four search configurations"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1="55"
              x2="705"
              y1={y(f * max)}
              y2={y(f * max)}
              className="ll-gridline"
            />
            <text x="43" y={y(f * max) + 4} textAnchor="end">
              {Math.round(f * max * 100)}%
            </text>
            <text x={x(f * r.config.finalBudget)} y="277" textAnchor="middle">
              {number(f * r.config.finalBudget)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline
            key={s.arm}
            points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
            fill="none"
            stroke={COLORS[s.arm]}
            strokeWidth="2.7"
            strokeDasharray={s.arm.startsWith("fixed") ? "5 4" : undefined}
          />
        ))}
        <text x="55" y="19">
          UNSEEN TASKS SOLVED
        </text>
        <text x="705" y="294" textAnchor="end">
          CANDIDATE EVALUATIONS PER TASK
        </text>
      </svg>
      <div className="ll-legend">
        {ARMS.map((a) => (
          <span key={a}>
            <i style={{ background: COLORS[a] }} />
            {LABELS[a]}
          </span>
        ))}
      </div>
      <p className="ll-footnote">
        Every arm has the same {number(r.config.finalBudget)}-evaluation cap.
        Failures remain in the denominator. These are genetic searches;
        “uniform” means uniform operator sampling.
      </p>
    </>
  );
}
function Amortization({ r, baseline }: { r: Result; baseline: Arm }) {
  const c = comparison(r, baseline),
    end = c.breakEven
      ? Math.max(r.config.testing, Math.ceil(c.breakEven * 1.3))
      : r.config.testing * 20;
  const max = Math.max(
      end * c.fixed.meanEffort,
      c.discovery + end * c.learned.meanEffort,
    ),
    x = (n: number) => 55 + (n / end) * 590,
    y = (n: number) => 227 - (n / max) * 185;
  return (
    <>
      <svg
        className="ll-chart"
        viewBox="0 0 700 275"
        role="img"
        aria-label="Projected cumulative candidate evaluations including discovery cost"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="55"
              x2="645"
              y1={y(f * max)}
              y2={y(f * max)}
              className="ll-gridline"
            />
            <text x="45" y={y(f * max) + 4} textAnchor="end">
              {((f * max) / 1e6).toFixed(1)}m
            </text>
            <text x={x(end * f)} y="250" textAnchor="middle">
              {number(end * f)}
            </text>
          </g>
        ))}
        <path
          d={`M55 ${y(0)} L645 ${y(end * c.fixed.meanEffort)}`}
          stroke="#9aa5b4"
          fill="none"
          strokeWidth="2.5"
        />
        <path
          d={`M55 ${y(c.discovery)} L645 ${y(c.discovery + end * c.learned.meanEffort)}`}
          stroke="#286da9"
          fill="none"
          strokeWidth="2.5"
        />
        {c.breakEven && (
          <g>
            <line
              x1={x(c.breakEven)}
              x2={x(c.breakEven)}
              y1="30"
              y2="227"
              stroke="#c0cbd5"
              strokeDasharray="4 4"
            />
            <text x={x(c.breakEven)} y="22" textAnchor="middle">
              Crossover ≈ {number(c.breakEven)} attempts
            </text>
          </g>
        )}
        <text x="645" y="272" textAnchor="end">
          FUTURE TASK ATTEMPTS · PROJECTION
        </text>
      </svg>
      <div className="ll-legend">
        <span>
          <i style={{ background: "#9aa5b4" }} />
          Baseline search
        </span>
        <span>
          <i style={{ background: "#286da9" }} />
          Learn first + downstream search
        </span>
      </div>
      <p className="ll-footnote">
        Projection uses mean capped effort, charging failures the limit. All
        discovery is charged to the learned arm; baseline preparation is omitted
        conservatively. Different program costs mean equal evaluation counts are
        not equal CPU time. Wall-time crossover:{" "}
        {c.wallBreakEven
          ? `${number(c.wallBreakEven)} attempts`
          : "not observed in measured per-task timings"}
        .
      </p>
    </>
  );
}
function Candidate({ p }: { p: Proposal }) {
  return (
    <div className="ll-candidate-detail">
      <div className="ll-inline">
        <strong>{p.label}</strong>
        <span className={`ll-tag ${p.accepted ? "good" : ""}`}>
          {p.accepted ? "Accepted" : p.stage}
        </span>
      </div>
      <p>{p.reason}</p>
      <dl>
        <div>
          <dt>Corpus nodes saved, net</dt>
          <dd>{number(p.compression)}</dd>
        </div>
        <div>
          <dt>Short-race utility change</dt>
          <dd>{p.screen === undefined ? "—" : signed(p.screen)}</dd>
        </div>
        <div>
          <dt>Full development change</dt>
          <dd>{p.development === undefined ? "—" : signed(p.development)}</dd>
        </div>
        <div>
          <dt>Confirmation lower bound</dt>
          <dd>{p.lowerBound === undefined ? "—" : signed(p.lowerBound)}</dd>
        </div>
      </dl>
      {p.seedScores && (
        <div className="ll-seed-bars">
          {p.seedScores.map((v, i) => (
            <div key={i}>
              <span>Inner seed {i + 1}</span>
              <div>
                <i
                  style={{
                    width: `${Math.max(2, Math.abs(v) * 350)}px`,
                    background: v > 0 ? "#4e978d" : "#b98665",
                  }}
                />
              </div>
              <b>{signed(v)}</b>
            </div>
          ))}
          <small>
            Paired utility changes across optimizer seeds; utility combines
            solves and search effort. These are not solve-rate changes.
          </small>
        </div>
      )}
      <pre>
        {p.macros.map((m) => m.definition).join("\n") || "Base language only"}
      </pre>
    </div>
  );
}

export default function LibraryLab({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [r, setR] = useState<Result | null>(null),
    [benchmark, setBenchmark] = useState<Benchmark | null>(null),
    [surrogate, setSurrogate] = useState<Surrogate | null>(null);
  const [running, setRunning] = useState(false),
    [seed, setSeed] = useState("42"),
    [preset, setPreset] = useState("full"),
    [baseline, setBaseline] = useState<Arm>("fixed-prior"),
    [candidate, setCandidate] = useState(0),
    [reference, setReference] = useState(true),
    [loadError, setLoadError] = useState(false);
  const worker = useRef<Worker | null>(null),
    started = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/library-reference.json", { signal: abort.signal })
      .then((x) => {
        if (!x.ok) throw new Error();
        return x.json();
      })
      .then((x) => {
        if (!started.current && x.version === "library-search-v1") setR(x);
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoadError(true);
      });
    fetch("/library-benchmark.json", { signal: abort.signal })
      .then((x) => (x.ok ? x.json() : null))
      .then(setBenchmark)
      .catch(() => {});
    fetch("/library-surrogate.json", { signal: abort.signal })
      .then((x) => (x.ok ? x.json() : null))
      .then(setSurrogate)
      .catch(() => {});
    return () => {
      abort.abort();
      worker.current?.terminate();
    };
  }, []);
  const run = (ablate = false) => {
    if (!/^\d{1,6}$/.test(seed)) {
      notify("Use a seed between 0 and 999999.");
      return;
    }
    if (ablate && !r?.completed) return;
    started.current = true;
    worker.current?.terminate();
    setRunning(true);
    setReference(false);
    setCandidate(0);
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "error") {
        notify(e.data.message);
        setRunning(false);
        w.terminate();
        return;
      }
      setR(e.data.result);
      if (e.data.done) {
        setRunning(false);
        w.terminate();
        notify(
          ablate
            ? "Frozen-library ablations complete."
            : "Library experiment complete. All four test arms are available.",
        );
      }
    };
    w.onerror = () => {
      setRunning(false);
      notify(
        "Experiment worker stopped unexpectedly. Partial results remain available.",
      );
      w.terminate();
    };
    if (ablate) w.postMessage({ type: "ablations", result: r });
    else {
      setR(null);
      const config =
        preset === "full"
          ? { ...DEFAULT, seed: Number(seed) }
          : {
              ...DEFAULT,
              seed: Number(seed),
              training: 100,
              development: 24,
              confirmation: 16,
              testing: 60,
              wakeBudget: 768,
              finalBudget: 1024,
              developmentBudget: 512,
              confirmationBudget: 768,
              shortlist: 8,
            };
      w.postMessage({ type: "start", config });
    }
  };
  const c = r ? comparison(r, baseline) : null,
    complete = !!r?.completed,
    summary = r ? ARMS.map((a) => summarize(r.trials, a)) : [];
  const groupTasks = r ? makeTasks(r.config).testing : [];
  const rows = benchmark?.rows ?? [],
    robust = rows.map((row) => {
      const a = row.arms.find((a) => a.arm === baseline)!,
        b = row.arms.find((a) => a.arm === "library-prior")!;
      return {
        ...row,
        delta: b.rate - a.rate,
        saving: a.meanEffort - b.meanEffort,
      };
    });
  const wins = robust.filter((x) => x.delta > 0).length,
    ties = robust.filter((x) => x.delta === 0).length;
  const isolated = r ? comparison(r, "fixed-prior") : null;
  const isolatedWins = rows.filter(
    (row) =>
      row.arms.find((a) => a.arm === "library-prior")!.rate >
      row.arms.find((a) => a.arm === "fixed-prior")!.rate,
  ).length;
  const hasLibrary = !!r?.macros.length,
    demonstrated =
      complete &&
      hasLibrary &&
      !!isolated &&
      isolated.rateInterval[0] > 0 &&
      isolated.saving > 0;
  return (
    <div className="ll-lab">
      <div className="ll-toolbar">
        <div>
          <span className="ll-eyebrow">EXPERIMENT 01 / LEARNING TO SEARCH</span>
          <p>
            {reference
              ? "Recorded engine output"
              : running
                ? "Computing locally"
                : "Local experiment"}{" "}
            · {r ? `meta-seed ${r.config.seed}` : "no run loaded"}
          </p>
        </div>
        <div className="ll-actions">
          <label>
            Protocol
            <select
              aria-label="Library experiment protocol"
              value={preset}
              disabled={running}
              onChange={(e) => setPreset(e.target.value)}
            >
              <option value="full">Full · 800 tasks</option>
              <option value="quick">Pilot · 200 tasks</option>
            </select>
          </label>
          <label>
            Seed
            <input
              aria-label="Library meta-seed"
              value={seed}
              disabled={running}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
          <button
            className="primary-button"
            onClick={() => {
              if (running) {
                worker.current?.terminate();
                setRunning(false);
                notify(
                  "Search stopped. Partial results are not a completed benchmark.",
                );
              } else run();
            }}
          >
            {running ? <Square size={13} /> : <Play size={13} />}{" "}
            {running ? "Stop experiment" : "Run experiment"}
          </button>
          <button
            className="ll-icon"
            aria-label="Export library experiment"
            disabled={!r}
            onClick={() => save(`library-seed-${r!.config.seed}.json`, r)}
          >
            <ArrowDownToLine size={17} />
          </button>
        </div>
      </div>
      <div className="ll-intro">
        <div>
          <span className="ll-eyebrow">THE CLAIM, MADE TESTABLE</span>
          <h2>
            Learned DSL vs fixed DSL
            <br />
            on unseen tasks.
          </h2>
          <p>
            Does learning a language make future programs easier to find,
            <br className="ll-desktop" /> after paying for the search that
            discovered it?
          </p>
        </div>
        <div className={`ll-verdict ${demonstrated ? "positive" : ""}`}>
          <span className="ll-eyebrow">CURRENT RESEARCH VERDICT</span>
          <strong>
            {!complete
              ? "Evidence pending"
              : demonstrated
                ? "A measured benefit in this run"
                : "Useful-DSL benefit not demonstrated"}
          </strong>
          <p>
            {!complete
              ? "Freeze the language and complete the paired test before interpreting the result."
              : !hasLibrary
                ? "No proposed library survived confirmation. Any prior-only gain is not a language-learning gain."
                : c!.saving <= 0
                  ? "This language did not reduce average capped search effort against the selected baseline."
                  : "An accepted abstraction is not enough: uncertainty, robustness and total cost still matter."}
          </p>
        </div>
      </div>
      <div className="ll-comparison">
        <span>
          <FlaskConical size={15} /> Attribute the improvement
        </span>
        <select
          aria-label="Research comparison baseline"
          value={baseline}
          onChange={(e) => setBaseline(e.target.value as Arm)}
        >
          <option value="fixed-prior">
            Isolate language: fixed DSL + learned prior
          </option>
          <option value="fixed-uniform">
            Whole system: fixed DSL + uniform search
          </option>
        </select>
        <span>vs learned DSL + learned prior</span>
      </div>
      <div className="ll-metrics">
        <article>
          <span>HELD-OUT SOLVE RATE</span>
          <strong>
            {complete ? percent(c!.learned.rate) : "—"}{" "}
            <small>vs {complete ? percent(c!.fixed.rate) : "—"}</small>
          </strong>
          <p>
            {complete
              ? `${signed(c!.rateDelta)} · ${c!.learned.solves}/${c!.learned.count} paired trials`
              : "All test failures count"}
          </p>
        </article>
        <article>
          <span>MEDIAN EVALUATIONS / SOLVE</span>
          <strong>
            {complete ? number(c!.learned.medianSolved) : "—"}{" "}
            <small>vs {complete ? number(c!.fixed.medianSolved) : "—"}</small>
          </strong>
          <p>
            {complete
              ? `${c!.matchedSpeedup?.toFixed(2) ?? "—"}× on ${c!.matched} jointly solved trials`
              : "Matched-solve speedup reported separately"}
          </p>
        </article>
        <article>
          <span>TOTAL DISCOVERY COST</span>
          <strong>{r ? number(discoveryCost(r)) : "—"}</strong>
          <p>
            candidate evaluations ·{" "}
            {r ? duration(r.discoveryMs || r.elapsedMs) : "—"}
          </p>
        </article>
        <article>
          <span>PROJECTED BREAK-EVEN</span>
          <strong>
            {complete ? number(c!.breakEven) : "—"}{" "}
            <small>{complete && c!.breakEven ? "attempts" : ""}</small>
          </strong>
          <p>
            {complete && c!.breakEven
              ? "Extrapolated, not observed amortization"
              : "No positive crossover established"}
          </p>
        </article>
      </div>
      {running && (
        <div className="ll-progress" role="status">
          <span>{r?.phase ?? "Preparing experiment…"}</span>
          <b>{Math.round(r?.progress ?? 0)}%</b>
          <i style={{ width: `${r?.progress ?? 0}%` }} />
        </div>
      )}
      {!r ? (
        <div className="ll-empty">
          <Beaker size={28} />
          <h3>
            {loadError
              ? "No reference result is available yet."
              : "Loading recorded evidence…"}
          </h3>
          <p>Run the experiment to compute fresh results in this browser.</p>
        </div>
      ) : (
        <>
          <div className="ll-layout">
            <Panel
              title="Did the search space get easier?"
              subtitle={`${r.config.testing} frozen test tasks × ${r.config.replicates} paired search seeds · active experiment`}
              wide
            >
              <Curves r={r} />
              <div className="ll-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Search configuration</th>
                      <th>Solves</th>
                      <th>Mean capped effort</th>
                      <th>Median / solved</th>
                      <th>Test wall time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((s) => (
                      <tr key={s.arm}>
                        <td>
                          <i
                            className="ll-dot"
                            style={{ background: COLORS[s.arm] }}
                          />
                          {LABELS[s.arm]}
                        </td>
                        <td>
                          {s.solves}/{s.count}
                        </td>
                        <td>{number(s.meanEffort)}</td>
                        <td>{number(s.medianSolved)}</td>
                        <td>{duration(s.wallMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel
              title="What language did it invent?"
              subtitle="Every definition is executable. Names are assigned, not hand-labeled."
            >
              <div className="ll-base">
                <span>BASE · SCALAR → SCALAR</span>
                <code>
                  {BASE.map(
                    (op) => `${op}(${op === "neg" ? "a" : "a,b"})`,
                  ).join("  ")}
                </code>
              </div>
              {!r.macros.length ? (
                <div className="ll-empty compact">
                  <strong>No accepted definitions</strong>
                  <p>
                    Look at the rejected candidates below. No synthetic “relu”,
                    “abs” or “clamp” result is inserted into this panel.
                  </p>
                </div>
              ) : (
                r.macros.map((m) => {
                  const solved = r.trials.filter(
                      (t) => t.arm === "library-prior" && t.solution.solved,
                    ),
                    uses = (e: Result["corpus"][number]["tree"]): boolean =>
                      e.op === m.name || e.args.some(uses),
                    used = solved.filter((t) => uses(t.solution.tree));
                  const speedups = used.flatMap((t) => {
                    const base = r.trials.find(
                      (a) =>
                        a.arm === baseline &&
                        a.task === t.task &&
                        a.seed === t.seed &&
                        a.solution.solved,
                    );
                    return base
                      ? [base.solution.effort / t.solution.effort]
                      : [];
                  });
                  return (
                    <article className="ll-macro" key={m.name}>
                      <pre>{m.definition}</pre>
                      <div>
                        <span>{m.support} training tasks</span>
                        <span>
                          {solved.length
                            ? percent(used.length / solved.length)
                            : "—"}{" "}
                          of solved programs
                        </span>
                        <span>
                          {median(speedups)?.toFixed(2) ?? "—"}× paired speedup
                        </span>
                      </div>
                    </article>
                  );
                })
              )}
              <p className="ll-footnote">
                Usage-conditioned speedups are associations. Removal ablations
                test causal contribution. New definitions compose a fixed scalar
                algebra; this does not invent new types, perception or control
                flow.
              </p>
              <details>
                <summary>Learned operator probabilities</summary>
                {r.probabilities.map((p) => (
                  <div className="ll-prob" key={p.op}>
                    <code>{p.op}</code>
                    <div>
                      <i style={{ width: `${p.probability * 100}%` }} />
                    </div>
                    <span>{percent(p.probability)}</span>
                  </div>
                ))}
                <p className="ll-footnote">
                  Mean across training-task I/O. The neural prior predicts a
                  different distribution for each task.
                </p>
              </details>
            </Panel>
            <Panel
              title="Does discovery pay for itself?"
              subtitle="Both the up-front cost and the downstream failures count."
            >
              <Amortization r={r} baseline={baseline} />
              <div className="ll-costs">
                <span>
                  Measured baseline test cost
                  <strong>{number(c!.totalFixed)}</strong>
                </span>
                <span>
                  Discovery + learned test cost
                  <strong>{number(c!.totalLearned)}</strong>
                </span>
              </div>
              <p className="ll-footnote">
                These are observed costs for the evaluated batch. An
                extrapolated crossover does not establish an equal-total-compute
                solve-rate advantage.
              </p>
            </Panel>
            <Panel
              title="Language evolution"
              subtitle="The outer objective rewards successful synthesis with fewer evaluations."
              wide
            >
              <div className="ll-timeline">
                {r.rounds.map((round) => (
                  <article key={round.round}>
                    <span>ROUND {round.round}</span>
                    <strong>
                      {round.corpus}
                      <small>successful training tasks</small>
                    </strong>
                    <p>
                      {round.candidates} compressed patterns → {round.screened}{" "}
                      short races → {round.tested} full races
                    </p>
                    <b>{round.accepted ?? "No edit passed confirmation"}</b>
                    <small>
                      {6 + round.librarySize} operators after this round
                    </small>
                  </article>
                ))}
                {!r.rounds.length && (
                  <p>Round summaries appear after each confirmation stage.</p>
                )}
              </div>
              <div className="ll-nested">
                <div>
                  <h4>Candidate languages</h4>
                  <div className="ll-proposal-list">
                    {r.proposals.map((p, i) => (
                      <button
                        key={i}
                        className={candidate === i ? "selected" : ""}
                        onClick={() => setCandidate(i)}
                      >
                        <span>
                          R{p.round} · {p.label}
                        </span>
                        <b>
                          {p.accepted ? (
                            <Check size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </b>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  {r.proposals[candidate] ? (
                    <Candidate p={r.proposals[candidate]} />
                  ) : (
                    <p>No candidate has been proposed yet.</p>
                  )}
                </div>
              </div>
              <p className="ll-footnote">
                Final test results never reject or accept a primitive. “Full
                development” and fresh confirmation are still development data.
                Paired variance is grouped by task, not treated as independent
                seed samples.
              </p>
            </Panel>
            <Panel
              title="Robustness across meta-seeds"
              subtitle={`${benchmark?.completed ?? 0} / ${benchmark?.seeds.length ?? 20} predeclared runs available · independent of the active browser run`}
              wide
            >
              <div className="ll-robust">
                <span>
                  <b>{wins}</b> higher solve rate
                </span>
                <span>
                  <b>{ties}</b> tied
                </span>
                <span>
                  <b>{robust.length - wins - ties}</b> lower
                </span>
                <span>
                  <b>
                    {robust.length
                      ? signed(mean(robust.map((x) => x.delta)))
                      : "—"}
                  </b>{" "}
                  mean change
                </span>
              </div>
              <div className="ll-table-wrap ll-scroll-table">
                <table>
                  <thead>
                    <tr>
                      <th>Meta-seed</th>
                      <th>Accepted definitions</th>
                      <th>Solve-rate change</th>
                      <th>Mean effort saved</th>
                      <th>Discovery cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {robust.map((row) => (
                      <tr key={row.seed}>
                        <td>{row.seed}</td>
                        <td>{row.macros.length}</td>
                        <td>{signed(row.delta)}</td>
                        <td>{number(row.saving)}</td>
                        <td>{number(row.comparison.discovery)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ll-footnote">
                All runs use the same frozen task suite. Repeated seeds measure
                optimizer variability, not independent task distributions. No
                best-seed selection.{" "}
                <button
                  onClick={() => save("library-robustness.json", benchmark)}
                >
                  Export all seed summaries
                </button>
              </p>
            </Panel>
            <Panel
              title="Generalization beyond the training structures"
              subtitle="A group comparison, not attribution to individual training families."
            >
              <div className="ll-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Final task group</th>
                      <th>Baseline</th>
                      <th>Learned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      "Related compositions",
                      "Nested compositions",
                      "Longer expressions",
                    ].map((group) => {
                      const ids = new Set(
                          groupTasks
                            .filter((t) => t.group === group)
                            .map((t) => t.id),
                        ),
                        trials = r.trials.filter((t) => ids.has(t.task));
                      return (
                        <tr key={group}>
                          <td>
                            {group}
                            <small>{ids.size} unseen functions</small>
                          </td>
                          <td>{percent(summarize(trials, baseline).rate)}</td>
                          <td>
                            {percent(summarize(trials, "library-prior").rate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="ll-footnote">
                Training uses related scalar compositions. Nested and longer
                target structures are withheld until final testing. Independent
                correctness checks also expand the input range. This is Level 1:
                synthetic program synthesis. Control and domain transfer remain
                untested.
              </p>
            </Panel>
            <Panel
              title="Search diagnostics"
              subtitle="What changed about candidate generation?"
            >
              <div className="ll-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Diagnostic</th>
                      <th>Baseline</th>
                      <th>Learned</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Operator entropy (nats)</td>
                      <td>{c!.fixed.entropy.toFixed(2)}</td>
                      <td>{c!.learned.entropy.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Effective operator choices · exp(H)</td>
                      <td>{Math.exp(c!.fixed.entropy).toFixed(2)}</td>
                      <td>{Math.exp(c!.learned.entropy).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Within program bounds</td>
                      <td>{percent(c!.fixed.validRate)}</td>
                      <td>{percent(c!.learned.validRate)}</td>
                    </tr>
                    <tr>
                      <td>Duplicate proposals</td>
                      <td>{percent(c!.fixed.duplicateRate)}</td>
                      <td>{percent(c!.learned.duplicateRate)}</td>
                    </tr>
                    <tr>
                      <td>Proposals using macros</td>
                      <td>{percent(c!.fixed.macroProposalRate)}</td>
                      <td>{percent(c!.learned.macroProposalRate)}</td>
                    </tr>
                    <tr>
                      <td>Median solved size / depth</td>
                      <td>
                        {number(c!.fixed.medianSize)} /{" "}
                        {number(c!.fixed.medianDepth)}
                      </td>
                      <td>
                        {number(c!.learned.medianSize)} /{" "}
                        {number(c!.learned.medianDepth)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="ll-footnote">
                Effective operator choices is not the full search-tree branching
                factor. Duplicates still consume the reported budget. “Useful
                partial program” probabilities are not measured by this
                experiment.
              </p>
            </Panel>
            <Panel
              title="Ablate the explanation"
              subtitle="Freeze the outcome, then remove the pieces that might explain it."
            >
              <button
                className="primary-button"
                disabled={!complete || running}
                onClick={() => run(true)}
              >
                <FlaskConical size={14} />
                Run frozen-library ablations
              </button>
              <p className="ll-footnote">
                The four main arms already isolate prior learning and uniform
                operator probabilities. Additional interventions remove the
                most-used macro and shuffle definitions within equal-arity
                groups. The prior stays frozen. Costs are exported separately.
              </p>
              {r.ablations?.map((a) => (
                <div className="ll-ablation" key={a.label}>
                  <strong>{a.label}</strong>
                  <b>
                    {a.applicable
                      ? `${summarize(a.trials, "library-prior").solves}/${a.trials.length} solved`
                      : "Not applicable"}
                  </b>
                  <p>{a.reason}</p>
                </div>
              ))}
            </Panel>
            <Panel
              title="Can we amortize the outer search?"
              subtitle="A dataset for learning which DSL edits deserve expensive evaluation."
            >
              <p className="ll-copy">
                Each edit records its definition, compression, measured
                synthesis gain, uncertainty and decision. A value model should
                learn from earlier meta-runs, then rank edits in unseen runs.
              </p>
              {surrogate ? (
                <>
                  <div className="ll-costs">
                    <span>
                      Labeled finalist edits<strong>{surrogate.records}</strong>
                    </span>
                    <span>
                      Held-out ranking groups<strong>{surrogate.groups}</strong>
                    </span>
                  </div>
                  <div className="ll-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Selector</th>
                          <th>Mean utility regret ↓</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(["model", "compression", "random"] as const).map(
                          (k) => (
                            <tr key={k}>
                              <td>
                                {k === "model"
                                  ? "Learned linear value model"
                                  : k === "compression"
                                    ? "Compression ranking"
                                    : "Random selection (expectation)"}
                              </td>
                              <td>{surrogate.regret[k].toFixed(4)}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="ll-footnote">{surrogate.note}</p>
                </>
              ) : (
                <p className="ll-footnote">
                  The cross-meta-seed ranking probe is not available yet. Logged
                  data is not evidence of reduced outer-search cost.
                </p>
              )}
            </Panel>
            <Panel
              title="Research gates"
              subtitle="Positive evidence must survive more than a compelling animation."
              wide
            >
              <div className="ll-gates">
                {[
                  [
                    "Frozen library + frozen prior",
                    complete,
                    "Protocol gate: no test feedback enters learning.",
                  ],
                  [
                    "Higher held-out solve rate attributable to the DSL",
                    complete && hasLibrary && isolated!.rateInterval[0] > 0,
                    "Task-clustered interval must exclude zero against fixed DSL + prior.",
                  ],
                  [
                    "At least 2× faster on jointly solved tasks",
                    complete &&
                      hasLibrary &&
                      (isolated!.matchedSpeedup ?? 0) >= 2 &&
                      isolated!.matched >= 20,
                    "Compared with fixed DSL + prior. Also inspect coverage and capped effort.",
                  ],
                  [
                    "Benefit survives 20 meta-seeds",
                    rows.length >= 20 && isolatedWins / rows.length >= 0.8,
                    "At least 80% of seeds improve over fixed DSL + prior.",
                  ],
                  [
                    "Discovery pays off in the observed batch",
                    complete &&
                      c!.totalLearned < c!.totalFixed &&
                      c!.learned.rate >= c!.fixed.rate,
                    "Charges all discovery; extrapolated break-even is insufficient.",
                  ],
                  [
                    "Learned primitives are actually used",
                    complete && hasLibrary && c!.learned.macroUsage > 0,
                    "Presence in solved programs is necessary, not sufficient.",
                  ],
                  [
                    "Equal-total-compute advantage",
                    false,
                    "Not tested: four arms have equal downstream caps, not equal total compute.",
                  ],
                  [
                    "Language transfers to physical control",
                    false,
                    "The existing truck is an engineered-DSL baseline, not a transfer result.",
                  ],
                ].map(([title, pass, note]) => (
                  <article key={String(title)}>
                    <span className={pass ? "pass" : ""}>
                      {pass ? "PASS" : "NOT DEMONSTRATED"}
                    </span>
                    <div>
                      <strong>{title}</strong>
                      <p>{note}</p>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
          </div>
          <details className="ll-protocol">
            <summary>Protocol, costs, and exact test programs</summary>
            <p>
              {r.config.training} training + {r.config.development} development
              + {r.config.confirmation} confirmation + {r.config.testing} final
              tasks. Monomorphic scalar algebra, 31 syntax nodes, 96 expanded
              nodes. Neural prior: 25 I/O features → 16 hidden units → operator
              probabilities. A finite example check is not a correctness proof.
            </p>
            <dl>
              {Object.entries(r.budget).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{number(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="ll-table-wrap ll-scroll-table">
              <table>
                <thead>
                  <tr>
                    <th>Task / seed</th>
                    <th>Arm</th>
                    <th>Result / evaluations</th>
                    <th>Program</th>
                  </tr>
                </thead>
                <tbody>
                  {r.trials.map((t, i) => (
                    <tr key={i}>
                      <td>
                        {t.task} / {t.seed}
                      </td>
                      <td>{LABELS[t.arm]}</td>
                      <td>
                        {t.solution.solved ? "Solved" : "Failed"} ·{" "}
                        {t.solution.evaluations}
                      </td>
                      <td>
                        <code>{t.solution.expression}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <footer className="ll-footer">
        <span>
          INDEPENDENT RESEARCH · REFERENCE OUTPUTS, NOT ILLUSTRATIVE NUMBERS
        </span>
        <a
          href="https://github.com/AndrewGordienko/programmatic/blob/main/LIBRARY_RESEARCH.md"
          target="_blank"
          rel="noreferrer"
        >
          Read the protocol
          <ArrowUpRight size={13} />
        </a>
      </footer>
    </div>
  );
}
