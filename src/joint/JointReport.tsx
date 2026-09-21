import { useEffect, useState } from "react";
import "../demo/demo.css";
import "./report.css";
type Row = {
  arm: string;
  trials: number;
  solved: number;
  auc: number;
  effort: number;
  expansions: number;
  wallMs: number;
  curve: { budget: number; solved: number }[];
  groups: Record<string, { solved: number; trials: number }>;
};
type Suite = {
  rows: Row[];
  costs: { evaluations: number; expansions: number };
  runs: {
    seed: number;
    bootstrap: number;
    corpus: number;
    selected: { macros: { definition: string }[] };
    confirmation: {
      accepted: boolean;
      mean: number;
      lowerHeuristicBound: number;
    };
  }[];
};
type Report = { iid: Suite; filtered: Suite; limitations: string[] };
const names: Record<string, string> = {
  "fixed-uniform": "Fixed DSL · uniform",
  "fixed-joint": "Fixed DSL · joint policy",
  "candidate-uniform": "Candidate DSL · uniform",
  "candidate-joint": "Candidate DSL · joint policy",
};
const colors = ["#a4ada2", "#657ba5", "#c09564", "#426846"];
export default function JointReport() {
  const [report, setReport] = useState<Report>(),
    [error, setError] = useState(""),
    [filtered, setFiltered] = useState(false);
  useEffect(() => {
    document.title = 'Programmatic AI — Joint language pilot';
    fetch("/joint-report.json")
      .then((r) => {
        if (!r.ok) throw new Error("Pilot report has not been generated yet.");
        return r.json();
      })
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, []);
  const suite = report?.[filtered ? "filtered" : "iid"];
  return (
    <div className="demo-root joint-report">
      <header className="demo-header">
        <a className="demo-brand" href="#demo">
          <b>programmatic</b>
          <i>/</i>
          <small>scalar experiment</small>
        </a>
        <a href="#research">Research appendix ↗</a>
      </header>
      <main className="demo-stage">
        <div className="demo-screen-intro">
          <span className="presentation-label">
            JOINT LANGUAGE SEARCH · THREE-SEED PILOT
          </span>
          <h1>
            A new algorithm.
            <br />
            <em>An unresolved result.</em>
          </h1>
          <p>
            Task + partial program + operator behavior → search policy.
            <br />
            Population of languages → prospective value ranking → fresh
            synthesis races.
          </p>
        </div>
        <div className="joint-selector">
          <button aria-pressed={!filtered} onClick={() => setFiltered(false)}>
            Original task distribution
          </button>
          <button aria-pressed={filtered} onClick={() => setFiltered(true)}>
            Historical functions excluded
          </button>
          <a href="/joint-report.json" download>
            Export measurements ↓
          </a>
        </div>
        {error && <p role="alert">{error}</p>}
        {!suite && !error && <p>Loading recorded pilot…</p>}
        {suite && (
          <>
            <p className="joint-verdict">
              <b>
                {suite.runs.filter((r) => r.confirmation.accepted).length}/
                {suite.runs.length} candidates passed confirmation.
              </b>{" "}
              Rejected candidates remain in the final comparison. None is
              promoted into the truck.
            </p>
            <section className="joint-chart">
              <h2>Unseen tasks solved vs search budget</h2>
              <p>
                Three inner seeds per task. Identical complete-program and
                partial-expansion caps.
              </p>
              <svg
                viewBox="0 0 1000 290"
                role="img"
                aria-label="Solve-rate curves: zero to 100 percent against zero to 1024 evaluations"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                  <g key={v}>
                    <line
                      x1="62"
                      x2="960"
                      y1={248 - v * 210}
                      y2={248 - v * 210}
                      stroke="#e0e6db"
                    />
                    <text x="48" y={252 - v * 210} textAnchor="end">
                      {Math.round(v * 100)}%
                    </text>
                  </g>
                ))}
                {[0, 256, 512, 768, 1024].map((v) => (
                  <text
                    key={v}
                    x={62 + (v / 1024) * 898}
                    y="274"
                    textAnchor="middle"
                  >
                    {v}
                  </text>
                ))}
                {suite.rows.map((r, i) => (
                  <path
                    key={r.arm}
                    d={r.curve
                      .map(
                        (p, j) =>
                          `${j ? "L" : "M"} ${62 + (p.budget / 1024) * 898} ${248 - p.solved * 210}`,
                      )
                      .join(" ")}
                    stroke={colors[i]}
                    strokeWidth="2.5"
                    fill="none"
                    strokeDasharray={i < 2 ? "5 4" : undefined}
                  />
                ))}
              </svg>
              <div className="joint-legend">
                {suite.rows.map((r, i) => (
                  <span key={r.arm}>
                    <i style={{ background: colors[i] }} />
                    {names[r.arm]}
                  </span>
                ))}
              </div>
            </section>
            <div className="joint-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Frozen arm</th>
                    <th>Solved</th>
                    <th>Solve AUC</th>
                    <th>Capped evaluations¹</th>
                    <th>Partial expansions</th>
                    <th>Search time²</th>
                  </tr>
                </thead>
                <tbody>
                  {suite.rows.map((r) => (
                    <tr key={r.arm}>
                      <th>{names[r.arm]}</th>
                      <td>
                        {r.solved} / {r.trials}
                      </td>
                      <td>{(100 * r.auc).toFixed(2)}%</td>
                      <td>{r.effort.toLocaleString()}</td>
                      <td>{r.expansions.toLocaleString()}</td>
                      <td>{(r.wallMs / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="joint-caption">
              ¹ Failed solves are charged their full evaluation cap. ²
              Descriptive timings; runners overlapped. Matched caps are not
              matched CPU cost.
            </p>
            <div className="joint-cost">
              <div>
                <span>Training + discovery</span>
                <strong>{suite.costs.evaluations.toLocaleString()}</strong>
                <small>complete-program evaluations</small>
              </div>
              <div>
                <span>Additional search work</span>
                <strong>{suite.costs.expansions.toLocaleString()}</strong>
                <small>partial-program expansions</small>
              </div>
              <div>
                <span>Amortization verdict</span>
                <strong>Not established</strong>
                <small>Requires a reliable downstream benefit</small>
              </div>
            </div>
            <h2>Every meta-seed, including failures</h2>
            <div className="joint-runs">
              {suite.runs.map((r) => (
                <article key={r.seed}>
                  <span className="presentation-label">META-SEED {r.seed}</span>
                  <h3>
                    {r.bootstrap} → {r.corpus} / 200 training tasks
                  </h3>
                  <p>
                    {r.selected.macros.length
                      ? "Development-selected candidate"
                      : "Base language retained"}
                  </p>
                  {r.selected.macros.map((m, i) => (
                    <pre key={i}>{m.definition}</pre>
                  ))}
                  <p>
                    Confirmation Δ AUC: {(r.confirmation.mean * 100).toFixed(2)}{" "}
                    pp
                    <br />
                    Lower heuristic bound:{" "}
                    {(r.confirmation.lowerHeuristicBound * 100).toFixed(2)} pp
                  </p>
                  <b>
                    {r.confirmation.accepted
                      ? "Passed confirmation heuristic"
                      : "No confirmed language improvement"}
                  </b>
                </article>
              ))}
            </div>
            <h2>Transfer to deeper structures</h2>
            <div className="joint-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Structure</th>
                    {suite.rows.map((r) => (
                      <th key={r.arm}>{names[r.arm]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(suite.rows[0].groups).map((g) => (
                    <tr key={g}>
                      <th>{g}</th>
                      {suite.rows.map((r) => (
                        <td key={r.arm}>
                          {r.groups[g].solved} / {r.groups[g].trials}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="demo-evidence-details">
              <summary>Protocol and limits</summary>
              <ul>
                {report?.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p>
                The fixed/joint arm removes every candidate macro while
                retaining exactly the same frozen weights. Empty libraries must
                produce a tie.
              </p>
            </details>
          </>
        )}
      </main>
    </div>
  );
}
