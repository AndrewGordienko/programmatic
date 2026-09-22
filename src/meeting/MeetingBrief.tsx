import { useEffect } from "react";
import { ArrowRight, ArrowUpRight, Braces, Check, CircleDot, GitBranch, Play } from "lucide-react";
import LiveSynthesis from "../demo/LiveSynthesis";
import HeldOutViewer from "./HeldOutViewer";
import "../demo/demo.css";
import "./meeting.css";

const source = "https://github.com/AndrewGordienko/programmatic/blob/main/";

export default function MeetingBrief() {
  useEffect(() => {
    const section = window.location.hash.slice(1);
    if (section === "live" || section === "heldout")
      document.getElementById(section)?.scrollIntoView();
  }, []);
  return (
    <div className="meeting-root">
      <header className="meeting-header">
        <a href="#brief" className="meeting-brand"><Braces size={21} /> programmatic <span>/ research brief</span></a>
        <nav aria-label="Research navigation">
          <a href="#brief">The finding</a>
          <a href="#live">Live controller</a>
          <a href="#heldout">Held-out terrain</a>
          <a href="#research">Research appendix <ArrowUpRight size={14} /></a>
        </nav>
      </header>
      <main>
        <section className="meeting-hero" id="brief">
          <span className="meeting-eyebrow">INDEPENDENT RESEARCH · SEPTEMBER 2026</span>
          <h1>Can a system <em>learn the language</em> that makes future programs easier to find?</h1>
          <p>Here “language” means the building blocks available to a program, not English text. We synthesize programs from examples, mine reusable functions, search over candidate languages, then test the winner on fresh tasks.</p>
          <div className="meeting-hero-actions">
            <a className="meeting-primary" href="#live"><Play size={16} /> See live synthesis <ArrowRight size={16} /></a>
            <a className="meeting-secondary" href={`${source}LATTICE_PROTOCOL.md`} target="_blank" rel="noreferrer">Read the frozen protocol <ArrowUpRight size={15} /></a>
          </div>
        </section>
        <section className="meeting-results" aria-label="Latest measured language result">
          <div className="meeting-section-title"><span>01 / LANGUAGE SEARCH</span><h2>Yes, within a restricted scalar language.</h2><p>Eight predeclared runs started with empty libraries. All eight accepted useful functions after fresh confirmation.</p></div>
          <div className="meeting-metrics">
            <article><span>HELD-OUT SOLVES · SAME GUIDED SEARCH</span><strong>3,072 <small>vs 2,055</small></strong><p>Learned language vs fixed base language, each out of 4,800 paired trials.</p></article>
            <article><span>SOLVE-RATE GAIN</span><strong>+21.2 <small>points</small></strong><p>Across eight meta-seeds; interval +18.2 to +24.1 points.</p></article>
            <article><span>MEASURED FINAL SEARCH CPU</span><strong>43.7 <small>vs 53.3 s</small></strong><p>Learned vs base, summed across final guided searches. Discovery cost is separate.</p></article>
          </div>
          <p className="meeting-source">Same frozen neural prior and search budget in both arms. Discovering the eight languages cost 634 process CPU seconds; median projected CPU payback is about 36,670 future searches per run. That payback has not been observed with this stronger solver. <a href={`${source}output/joint/lattice-evolution-v1/analysis.json`} target="_blank" rel="noreferrer">Inspect the eight-run analysis <ArrowUpRight size={13} /></a></p>
        </section>
        <section className="meeting-grid" aria-label="Interpretation and boundary">
          <article className="meeting-card"><Check size={22} /><span>WHAT WORKED</span><h3>The outer loop found reusable functions.</h3><p>Candidate languages were evaluated by whether they improved fresh program synthesis. The learner repeatedly recovered variants of magnitude, positive-part and clamp functions. Uniform search also improved, supporting a language effect beyond the frozen neural prior.</p></article>
          <article className="meeting-card"><GitBranch size={22} /><span>WHAT ADVANCED</span><h3>Searching for a useful language became cheaper.</h3><p>A learned selector used 2.68× less incremental discovery work than full population screening in a separate four-seed study, with 1,245 vs 1,200 final solves out of 2,400. Equal quality is not established, and its prior training investment remains unpaid. <a href={`${source}output/joint/selective-evolution-v1/analysis.json`} target="_blank" rel="noreferrer">Cost study ↗</a></p></article>
          <article className="meeting-card boundary"><CircleDot size={22} /><span>THE OPEN BOUNDARY</span><h3>General language invention is still open.</h3><p>These are small scalar expression libraries over fixed arithmetic primitives. Longer compositions improved; nested gain is uncertain. The off-road controller uses an engineered language, with no demonstrated transfer from scalar learning.</p></article>
        </section>
        <section className="meeting-how" aria-label="How the two searches work">
          <span className="meeting-eyebrow">02 / WHAT THE TWO LOOPS GENERATE</span>
          <h2>Two searches, two different claims.</h2>
          <p className="meeting-how-intro">The truck demonstration searches for a <b>program inside a supplied language</b>. The measured scalar experiment searches for a <b>language that improves later program searches</b>.</p>
          <div className="meeting-code-grid">
            <article>
              <div className="meeting-code-head"><span>WHEN YOU PRESS “SYNTHESIZE CONTROLLER”</span><b>Fixed language → new code</b></div>
              <pre>{[
                "language = hand-designed typed operations",
                "prior = frozen learned proposal model",
                "terrain = previously tested quarry course",
                "population = empty",
                "",
                "while evaluations < 5,000:",
                "  propose a typed controller graph",
                "    via prior / random / mutation / crossover",
                "  choose inputs, connections and constants",
                "  drive it in the simulator; score the result",
                "  keep stronger programs as parents",
                "  if it reaches the goal: return that graph",
                "",
                "execute the returned graph to steer the truck",
              ].join("\n")}</pre>
              <p>The screen shows the actual returned program. The click does not invent operators, types, sensors, or a new DSL.</p>
            </article>
            <article>
              <div className="meeting-code-head"><span>THE MEASURED LANGUAGE EXPERIMENT</span><b>New language → easier search?</b></div>
              <pre>{[
                "library = empty",
                "for each of 3 language generations:",
                "  synthesize programs on training functions",
                "  mine reusable expression fragments",
                "  propose 256 candidate whole languages",
                "  race them on fresh development tasks",
                "  keep the strongest candidates",
                "",
                "freeze the chosen language and prior",
                "confirm on 80 new functions",
                "compare learned vs base language on 200",
                "  new functions × 3 search seeds each",
              ].join("\n")}</pre>
              <p>Both final arms get the same task examples, frozen prior and search caps. The learned language adds bounded compositions of existing scalar operations.</p>
            </article>
          </div>
          <div className="meeting-answers">
            <p><b>Does the truck invent the language?</b> No. It generates the controller graph, including operation choices, connections and numeric constants, inside a fixed DSL.</p>
            <p><b>Did we address the hard search over DSLs?</b> Partly. We found useful scalar libraries across eight fresh runs and a promising cheaper way to select them. We have not shown open-ended DSL invention or transfer to the truck.</p>
            <p><b>What should the manager take away?</b> The restricted thesis now has a measured positive result. The general problem remains the search over representations, primitives and task families that matter to their work.</p>
          </div>
        </section>
        <section className="meeting-demo" id="live" aria-label="Live controller demonstration">
          <div><span className="meeting-eyebrow">03 / LIVE MECHANISM</span><h2>A generated program can drive the simulator.</h2><p>This quarry rehearsal is previously tested terrain. A fresh search creates the controller when you press the button. It illustrates program synthesis; the language-learning result above comes from separate scalar experiments.</p></div>
          <LiveSynthesis active />
        </section>
        <HeldOutViewer />
        <footer className="meeting-footer"><span>Independent prototype; not Argos code or a reproduction of an undisclosed implementation.</span><a href="#research">Open full workbench <ArrowUpRight size={14} /></a></footer>
      </main>
    </div>
  );
}
