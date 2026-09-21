import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Cpu,
  GitBranch,
  Layers,
  Mountain,
  ScanLine,
  Sparkles,
  Target,
} from "lucide-react";
import LiveSynthesis from "./LiveSynthesis";
import type { DemoEvidence } from "./evidence";
import "./demo.css";
const screens = [
  "The mechanism",
  "Live synthesis",
  "The bottleneck",
  "Next experiment",
];
const go = (step: number) => {
  window.location.hash = step === 0 ? "demo" : `demo/${step + 1}`;
};
function Mechanism() {
  return (
    <div className="demo-mechanism">
      <div className="demo-intro">
        <span className="presentation-label">
          01 / AN INDEPENDENT REPRODUCTION
        </span>
        <h1>
          I tried to reproduce
          <br />
          <em>Programmatic AI.</em>
        </h1>
        <p>
          A simplified version of the architecture:
          <br />
          search for executable programs that control a simulated vehicle.
        </p>
      </div>
      <div
        className="demo-mechanism-diagram"
        role="img"
        aria-label="Observations flow into program search, guided by a learned prior and an evolving DSL; search produces an executable symbolic controller that drives the simulator."
      >
        <div className="demo-search-inputs">
          <span>
            <Sparkles size={14} />
            Learned prior
          </span>
          <b>+</b>
          <span>
            <GitBranch size={14} />
            Evolving DSL
          </span>
          <ArrowDown size={20} />
        </div>
        <div className="demo-flow-row">
          <div className="demo-flow-node">
            <ScanLine />
            <span>01</span>
            <h3>Observations</h3>
            <p>Terrain scans + vehicle state</p>
          </div>
          <ArrowRight className="demo-flow-arrow" />
          <div className="demo-flow-node primary">
            <Cpu />
            <span>02</span>
            <h3>Program search</h3>
            <p>Propose · execute · evolve</p>
          </div>
          <ArrowRight className="demo-flow-arrow" />
          <div className="demo-flow-node">
            <Braces />
            <span>03</span>
            <h3>Symbolic controller</h3>
            <p>A small executable program</p>
          </div>
          <ArrowRight className="demo-flow-arrow" />
          <div className="demo-flow-node">
            <Mountain />
            <span>04</span>
            <h3>Simulator</h3>
            <p>The program drives the truck</p>
          </div>
        </div>
      </div>
      <div className="demo-two-findings">
        <div>
          <span className="demo-outcome-symbol">
            <Check size={20} />
          </span>
          <div>
            <span className="presentation-label">INNER SEARCH</span>
            <h2>Works in this simulator.</h2>
            <p>
              A strong hand-designed language makes controller synthesis
              tractable.
            </p>
          </div>
        </div>
        <div>
          <span className="demo-outcome-symbol open">
            <CircleDot size={20} />
          </span>
          <div>
            <span className="presentation-label">LANGUAGE SEARCH</span>
            <h2>Does not work yet.</h2>
            <p>
              The system has not learned abstractions that reliably improve
              future search.
            </p>
          </div>
        </div>
      </div>
      <p className="demo-scope">
        An independently built, restricted prototype. It does not reproduce
        Argos’s undisclosed implementation.
      </p>
    </div>
  );
}
function Findings({
  evidence,
  error,
}: {
  evidence: DemoEvidence | null;
  error: string;
}) {
  const e = evidence;
  return (
    <div className="demo-findings">
      <div className="demo-screen-intro">
        <span className="presentation-label">03 / THE RESULT THAT MATTERS</span>
        <h1>Where my reproduction breaks.</h1>
        <p>The controller can work. The language still comes from us.</p>
      </div>
      {error && (
        <p className="demo-data-error" role="alert">
          {error}
        </p>
      )}
      <div className="demo-finding-metrics">
        <article>
          <span className="presentation-label">HAND-DESIGNED DSL</span>
          <strong>
            {e ? e.reference.arrivals : "—"}
            <small> / {e ? e.reference.count : "—"}</small>
          </strong>
          <h2>Held-out terrains reached</h2>
          <p>
            Reference controller · optimizer seed {e?.reference.seed ?? "—"}
            <br />
            Substantial success, imperfect control.
          </p>
        </article>
        <article className="unresolved">
          <span className="presentation-label">LEARNED TERRAIN DSL</span>
          <strong>{e ? e.terrain.accepted : "—"}</strong>
          <h2>Accepted primitives</h2>
          <p>
            Language edits have not produced a demonstrated synthesis advantage.
          </p>
        </article>
        <article>
          <span className="presentation-label">NEURAL GUIDANCE</span>
          <strong className="demo-prior-result">
            {e ? e.terrain.guided : "—"}
            <small> vs </small>
            {e ? e.terrain.unguided : "—"}
          </strong>
          <h2>No advantage in this benchmark</h2>
          <p>
            Guided vs plain evolution · each / {e?.terrain.count ?? "—"}
            <br />
            Three optimizer seeds, shared test terrains.
          </p>
        </article>
      </div>
      <div className="demo-representation-note">
        <Layers size={18} />
        <p>
          I supplied <code>clearance</code>, <code>roughness</code>,{" "}
          <code>traction</code> and <code>argmax</code>. The outer learner only
          proposes small compositions of the operations I chose.
        </p>
      </div>
      <div className="demo-rejection-heading">
        <h2>Three rejected language edits</h2>
        <span>Recorded development decisions · no final-test selection</span>
      </div>
      <div className="demo-rejections">
        {e ? (
          e.rejections.map((r, i) => (
            <article key={i}>
              <div>
                <span>{r.domain}</span>
                <b>NOT ACCEPTED</b>
              </div>
              <pre>{r.definition}</pre>
              <p>{r.observation}</p>
              <footer>
                <span>{r.stage}</span>
                <p>{r.reason}</p>
              </footer>
            </article>
          ))
        ) : (
          <p className="demo-loading">Loading recorded candidate decisions…</p>
        )}
      </div>
      <div className="demo-scalar-strip">
        <div>
          <strong>
            {e?.scalar.acceptedRuns ?? "—"} / {e?.scalar.runs ?? "—"}
          </strong>
          <span>scalar meta-runs accepted a DSL edit</span>
        </div>
        <div>
          <strong>{e ? (e.scalar.discovery / 1e6).toFixed(1) : "—"}M</strong>
          <span>discovery evaluations</span>
        </div>
        <p>
          <b>{e?.scalar.developmentPositive ?? "—"}</b> positive development
          estimates <ChevronRight size={13} />
          <b>{e?.scalar.confirmationPositive ?? "—"}</b> positive confirmation
          means <ChevronRight size={13} />
          <b>{e?.scalar.clearedUncertainty ?? "—"}</b> cleared uncertainty
        </p>
      </div>
      <div className="demo-finding-conclusion">
        <span>THE UNRESOLVED STEP</span>
        <p>
          Learning a language that makes
          <br />
          <em>future programs easier to find.</em>
        </p>
      </div>
      <details className="demo-evidence-details">
        <summary>Evidence and limits</summary>
        <p>
          The terrain figures use{" "}
          {e?.simulatorVersion ?? "the current simulator"}. The{" "}
          {e?.reference.arrivals ?? "—"}/{e?.reference.count ?? "—"} controller
          result is separate from the live rehearsal. Scalar results use a
          different DSL and task distribution. Shared test tasks across seeds
          are optimizer replications, not independent domains. Positive means
          alone are inconclusive; the confirmation gate is an approximate
          heuristic. These results identify failures of this procedure, not
          impossibility of DSL learning.
        </p>
        <div>
          {e?.sources.map((s) => (
            <a key={s.path} href={s.path} target="_blank" rel="noreferrer">
              {s.path.slice(1)} <ArrowUpRight size={12} />
            </a>
          ))}
        </div>
      </details>
    </div>
  );
}
function NextExperiment() {
  return (
    <div className="demo-next">
      <div className="demo-screen-intro">
        <span className="presentation-label">
          04 / NEW SCALAR PILOT · BENEFIT UNPROVEN
        </span>
        <h1>
          Learn which language edits
          <br />
          <em>deserve an expensive search.</em>
        </h1>
        <p>
          Keep the objective: useful programs found with less future search.
          <br />
          Learn a cheaper way to evaluate the languages that could get us there.
        </p>
      </div>
      <div
        className="demo-outer-loop"
        role="img"
        aria-label="Task distribution produces candidate DSL edits. A cheap value model ranks them, selective expensive inner search measures future-search utility, and that evidence updates the DSL and value model."
      >
        <div className="demo-loop-start">
          <Layers size={20} />
          <div>
            <span>INPUT</span>
            <h3>Task distribution</h3>
          </div>
          <ArrowRight size={18} />
          <div>
            <span>PROPOSE</span>
            <h3>Population of candidate DSLs</h3>
          </div>
        </div>
        <div className="demo-loop-stages">
          <article className="value">
            <span>01 / PREDICT</span>
            <Sparkles size={27} />
            <h3>Cheap value model</h3>
            <p>Rank edits before paying for full synthesis.</p>
          </article>
          <ArrowRight className="demo-flow-arrow" />
          <article>
            <span>02 / MEASURE SELECTIVELY</span>
            <Cpu size={27} />
            <h3>Conditioned inner search</h3>
            <p>
              Condition on the task, partial program and available DSL. Run
              short synthesis races.
            </p>
          </article>
          <ArrowRight className="demo-flow-arrow" />
          <article>
            <span>03 / ASSIGN CREDIT</span>
            <Target size={27} />
            <h3>Future-search utility</h3>
            <p>Measure solves, evaluations and uncertainty on fresh tasks.</p>
          </article>
        </div>
        <div className="demo-feedback">
          <ArrowLeft size={17} />
          <span>
            Select languages · mutate / cross libraries · update the search
            policy + value model
          </span>
          <GitBranch size={17} />
        </div>
      </div>
      <div className="demo-next-bottom">
        <div>
          <span className="presentation-label">THE FALSIFIABLE TEST</span>
          <h2>
            Same quality of language edit.
            <br />
            Fewer inner-search evaluations.
          </h2>
          <p>
            Compare against compression, random selection and full evaluation.
            Charge for model training and confirmation.
          </p>
        </div>
        <div>
          <span className="presentation-label">BEYOND THIS PROTOTYPE</span>
          <h3>Search over more than macros.</h3>
          <p>
            Eventually: representations, types, control structure and perception
            primitives.
          </p>
          <small>
            The separate scalar pilot now implements joint conditional search,
            population evolution and prospective ranking. Reliable improvement
            and quality-preserving compute savings remain unproven.
            <br />
            <a href="#joint">Inspect the recorded pilot →</a>
          </small>
        </div>
      </div>
    </div>
  );
}
export default function DemoApp({ step }: { step: number }) {
  const [evidence, setEvidence] = useState<DemoEvidence | null>(null),
    [error, setError] = useState("");
  const visitedLive = useRef(false);
  if (step === 1) visitedLive.current = true;
  useEffect(() => {
    const abort = new AbortController();
    fetch("/demo-evidence.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error("Recorded evidence unavailable.");
        return r.json();
      })
      .then((e: DemoEvidence) => {
        if (e.version !== "presentation-evidence-v1")
          throw Error("Unsupported evidence version.");
        setEvidence(e);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    document.title = `Programmatic AI — ${screens[step]}`;
    const keyboard = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable ||
            /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)))
      )
        return;
      if (e.key === "ArrowRight" && step < 3) {
        e.preventDefault();
        go(step + 1);
      }
      if (e.key === "ArrowLeft" && step > 0) {
        e.preventDefault();
        go(step - 1);
      }
    };
    window.addEventListener("keydown", keyboard);
    window.scrollTo({ top: 0, behavior: "instant" });
    return () => window.removeEventListener("keydown", keyboard);
  }, [step]);
  return (
    <div className="demo-root">
      <header className="demo-header">
        <a className="demo-brand" href="#demo" aria-label="Presentation home">
          <span>
            <Braces size={22} />
          </span>
          <b>programmatic</b>
          <i>/</i>
          <small>field notes</small>
        </a>
        <nav aria-label="Presentation screens">
          {screens.map((name, i) => (
            <button
              key={name}
              aria-current={i === step ? "step" : undefined}
              onClick={() => go(i)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {name}
            </button>
          ))}
        </nav>
        <a className="demo-appendix" href="#research">
          Research appendix <ArrowUpRight size={13} />
        </a>
      </header>
      <main className="demo-stage">
        <section hidden={step !== 0} aria-label="The mechanism">
          <Mechanism />
        </section>
        {visitedLive.current && (
          <section hidden={step !== 1} aria-label="Live synthesis">
            <LiveSynthesis active={step === 1} />
          </section>
        )}
        <section hidden={step !== 2} aria-label="The bottleneck">
          <Findings evidence={evidence} error={error} />
        </section>
        <section hidden={step !== 3} aria-label="Next experiment">
          <NextExperiment />
        </section>
      </main>
      <footer className="demo-footer">
        <div>
          <span className="demo-page-number">
            {String(step + 1).padStart(2, "0")}
            <i> / 04</i>
          </span>
          <span className="demo-footer-note">
            ONE EXPERIMENT. ONE UNANSWERED QUESTION.
          </span>
        </div>
        <div>
          {step > 0 && (
            <button className="demo-back" onClick={() => go(step - 1)}>
              <ArrowLeft size={15} />
              Back
            </button>
          )}
          <button
            className="demo-next-screen"
            onClick={() => go(step < 3 ? step + 1 : 1)}
          >
            {
              [
                "See it synthesize",
                "Where it breaks",
                "What I would try next",
                "Return to live demo",
              ][step]
            }
            <ArrowRight size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}
