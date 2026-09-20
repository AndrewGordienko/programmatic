import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Braces,
  FlaskConical,
  GitBranch,
  ScanLine,
} from "lucide-react";
import Modal from "./Modal";

export default function Methodology({ close }: { close: () => void }) {
  const stages = [
    {
      icon: Braces,
      title: "01 / Build a corpus",
      body: "Solve 500 scalar tasks from input/output examples using a base arithmetic language. Only successfully synthesized programs enter the corpus; hidden target programs never supply syntax to search or abstraction mining.",
    },
    {
      icon: FlaskConical,
      title: "02 / Propose language edits",
      body: "Extract repeated parameterized computations, measure actual corpus compression, and propose additions, joint additions or deletions. Train a task-conditioned neural operator prior for each language using successful and synthetic programs.",
    },
    {
      icon: GitBranch,
      title: "03 / Race candidate languages",
      body: "Use short synthesis races to shortlist edits, then larger multi-seed development races and a fresh confirmation split. The objective rewards solving tasks with fewer evaluations, penalizes definition size, and requires a positive uncertainty bound before accepting an edit.",
    },
    {
      icon: ScanLine,
      title: "04 / Freeze and falsify",
      body: "Freeze the DSL and both priors. Evaluate four paired search configurations on 200 unseen tasks, including nested and longer structures absent from training. Report capped search effort, failures, 20 meta-seeds, discovery cost, observed total cost and projected amortization.",
    },
  ];
  return (
    <Modal
      title="Two levels of programmatic search"
      subtitle="Search for programs. Then search for a better language."
      close={close}
      wide
    >
      <div className="methodology-body">
        <div className="method-intro">
          <span className="eyebrow">INSPIRED BY ARGOS RESEARCH</span>
          <h3>
            Programs learn behavior.
            <br />
            Languages shape the search.
          </h3>
          <p>
            The main experiment asks whether learning a library and search prior
            reduces synthesis cost on future tasks. The truck, road and grid
            experiments remain control baselines with engineered languages.
          </p>
        </div>
        <div className="method-stages">
          {stages.map((s) => (
            <article key={s.title}>
              <span className="method-icon">
                <s.icon size={20} />
              </span>
              <div>
                <h4>{s.title}</h4>
                <p>{s.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="scope-note">
          <BrainCircuit size={21} />
          <div>
            <strong>A research interpretation, with measured limits</strong>
            <p>
              The scalar algebra, task distribution and neural architecture are
              engineered. The prior predicts operator frequencies, not arbitrary
              semantic programs. Macros can all be rejected. A projected cost
              crossover is not observed savings or an equal-total-compute
              advantage. No result here establishes new type invention,
              high-dimensional perception, control transfer or reproduction of
              Argos’s undisclosed algorithm.
            </p>
          </div>
        </div>
        <div className="source-link">
          <div>
            <strong>Programmatic AI</strong>
            <span>
              Hadi Alsibassi & Hassan Ismail · Argos Research · August 2026
            </span>
          </div>
          <a href="/argos-paper.pdf" target="_blank" rel="noreferrer">
            Read the paper
            <ArrowUpRight size={17} />
          </a>
        </div>
      </div>
      <div className="modal-footer">
        <span className="muted">
          Independent implementation · not an official Argos product
        </span>
        <button className="primary-button" onClick={close}>
          Back to the lab
          <ArrowRight size={15} />
        </button>
      </div>
    </Modal>
  );
}
