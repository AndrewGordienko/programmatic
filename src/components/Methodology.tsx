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
      title: "01 / Propose a program",
      body: "Build a typed, bounded graph over 19-direction scans of goal alignment, clearance, slope, roughness and traction. Vector operations combine observations; angle and scalar outputs command steering and acceleration. The truck receives no route or road centreline.",
    },
    {
      icon: FlaskConical,
      title: "02 / Let it act",
      body: "Execute each candidate on nine uneven terrains. Arrivals, progress and efficiency earn reward; collisions, stability failures, grounding and timeouts reduce it. Training and the 3D view use the same terrain-contact and vehicle dynamics.",
    },
    {
      icon: GitBranch,
      title: "03 / Search and improve",
      body: "Mutate connected expressions, recombine compatible graphs, and preserve parents that perform well on different terrain cases. A masked neural prior learns operator and operand choices from summaries of partial typed graphs. Mined DSL compositions are tested with fresh searches on separate development terrains.",
    },
    {
      icon: ScanLine,
      title: "04 / Test somewhere new",
      body: "Freeze the program and evaluate it on 36 unseen terrain layouts. The reference benchmark compares four search configurations across three seeds and also disables clearance sensing to measure its effect. DSL discovery costs are reported separately from the common main-search budget.",
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
            The off-road experiment searches for vehicle-control programs and
            tests whether reusable compositions improve the search language.
            Road, grid and scalar experiments remain available as simpler
            baselines.
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
              Terrain sensing, the initial type system and direction-selection
              primitive are engineered. The learned prior sees graph summaries;
              it is not a full semantic program-search model. DSL discovery
              mines compositions of existing operations and can reject every
              proposal. The vehicle uses approximate terrain contact, not
              calibrated suspension or soil dynamics. This does not establish
              camera perception, formal verification, real-world transfer or
              reproduction of Argos’s undisclosed algorithm.
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
