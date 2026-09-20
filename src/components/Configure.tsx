import { useState } from "react";
import { ArrowRight, BrainCircuit, Layers, RotateCcw } from "lucide-react";
import { DEFAULT_CONFIG, type Config } from "../engine/types";
import Modal from "./Modal";

export default function Configure({
  config,
  close,
  apply,
}: {
  config: Config;
  close: () => void;
  apply: (config: Config) => void;
}) {
  const [draft, setDraft] = useState(config);
  const [seed, setSeed] = useState(String(config.seed));
  const validSeed = /^\d{1,6}$/.test(seed);
  const change = (field: keyof Config, value: number | boolean) =>
    setDraft((d) => ({ ...d, [field]: value }));
  const range = (
    label: string,
    field: "population" | "generations" | "maxNodes" | "trainingWorlds",
    min: number,
    max: number,
    step: number,
    detail: string,
  ) => (
    <label className="config-range">
      <span>
        {label}
        <strong>{draft[field]}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft[field]}
        onChange={(e) => change(field, Number(e.target.value))}
      />
      <small>{detail}</small>
    </label>
  );
  return (
    <Modal
      title="Design your experiment"
      subtitle="A few constraints. A world of possible programs."
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (validSeed) apply({ ...draft, seed: Number(seed) });
        }}
      >
        <div className="config-body">
          <div className="config-section-label">SEARCH SPACE</div>
          {range(
            "Population size",
            "population",
            16,
            128,
            16,
            "Candidate programs evaluated in every generation.",
          )}
          {range(
            "Generations",
            "generations",
            10,
            100,
            10,
            "More iterations give the search more room to improve.",
          )}
          {range(
            "Program length bound",
            "maxNodes",
            4,
            24,
            2,
            "Maximum graph nodes. Only active nodes execute.",
          )}
          {range(
            "Training worlds",
            "trainingWorlds",
            4,
            24,
            4,
            "Independent layouts evaluated for every candidate.",
          )}
          <div className="config-input-row">
            <label>
              Random seed
              <input
                type="text"
                inputMode="numeric"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                aria-invalid={!validSeed}
                required
                pattern="[0-9]{1,6}"
              />
              <small>A number from 0 to 999999.</small>
            </label>
            <label>
              Mutation probability
              <select
                value={draft.mutationRate}
                onChange={(e) => change("mutationRate", Number(e.target.value))}
              >
                <option value={0.1}>10% · Conservative</option>
                <option value={0.2}>20% · Balanced</option>
                <option value={0.35}>35% · Exploratory</option>
                <option value={0.5}>50% · High variation</option>
              </select>
            </label>
          </div>
          <div className="config-section-label">LEARNING STRATEGY</div>
          <label className="toggle-option">
            <BrainCircuit size={20} />
            <span>
              <strong>Neural-guided proposals</strong>
              <small>
                A small network learns which DSL operators to sample.
              </small>
            </span>
            <input
              type="checkbox"
              checked={draft.neural}
              onChange={(e) => change("neural", e.target.checked)}
            />
            <i className="switch" />
          </label>
          <label className="toggle-option">
            <Layers size={20} />
            <span>
              <strong>Train across environments</strong>
              <small>Mix warehouse and terrain worlds during evaluation.</small>
            </span>
            <input
              type="checkbox"
              checked={draft.diverse}
              onChange={(e) => change("diverse", e.target.checked)}
            />
            <i className="switch" />
          </label>
          <p className="config-note">
            Narrow-passage worlds are always held out. Fitness includes a{" "}
            {draft.complexity}-point penalty per active node.
          </p>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setDraft(DEFAULT_CONFIG);
              setSeed(String(DEFAULT_CONFIG.seed));
            }}
          >
            <RotateCcw size={14} />
            Defaults
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={!validSeed}
          >
            Apply configuration
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
