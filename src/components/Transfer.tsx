import {
  ArrowRight,
  Check,
  FlaskConical,
  LoaderCircle,
  MoveUpRight,
  RotateCw,
} from "lucide-react";
import { useMemo } from "react";
import { FAMILY_LABELS, WorldMap } from "./Scene";
import { makeWorld } from "../engine/world";
import type { Candidate, Family, TransferResult } from "../engine/types";

export default function Transfer({
  candidate,
  results,
  testing,
  run,
  blocked,
}: {
  blocked: boolean;
  candidate: Candidate;
  results: TransferResult[] | null;
  testing: boolean;
  run: () => void;
}) {
  const worlds = useMemo(
    () =>
      (["warehouse", "terrain", "maze"] as Family[]).map((f, i) =>
        makeWorld(1_500_000_000 + i * 10000, f),
      ),
    [],
  );
  return (
    <div className="transfer-view">
      <div className="transfer-intro">
        <div>
          <span className="eyebrow">BEYOND THE TRAINING WORLD</span>
          <h2>Same program. Unfamiliar territory.</h2>
          <p>
            Freeze the policy. Change the world. See which behaviors carry over.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={run}
          disabled={testing || blocked}
        >
          {testing ? (
            <LoaderCircle className="spin" size={16} />
          ) : results ? (
            <RotateCw size={16} />
          ) : (
            <FlaskConical size={16} />
          )}
          {blocked
            ? "Pause policy search first"
            : testing
              ? "Evaluating 72 worlds…"
              : results
                ? "Run evaluation again"
                : "Run transfer evaluation"}
        </button>
      </div>
      <div className="transfer-baseline">
        <span className="icon-square">
          <Check size={17} />
        </span>
        <span>
          Training baseline
          <strong>{(candidate.success * 100).toFixed(0)}% success</strong>
        </span>
        <span>
          Frozen policy
          <strong>
            {candidate.program.id} · {candidate.activeNodes} active nodes
          </strong>
        </span>
        <p>72 held-out seeds · 24 per environment · no further learning</p>
      </div>
      <div className="transfer-grid">
        {worlds.map((world, i) => {
          const result = results?.[i];
          return (
            <section className="panel transfer-card" key={world.family}>
              <div className="transfer-preview">
                <WorldMap world={world} />
                <span className="transfer-type">
                  {i === 2 ? "NEW ENVIRONMENT" : "NEW LAYOUTS"}
                </span>
              </div>
              <div className="transfer-card-body">
                <h3>
                  {FAMILY_LABELS[world.family]}
                  <MoveUpRight size={18} />
                </h3>
                <p>
                  {i === 0
                    ? "Different shelf layouts and start positions."
                    : i === 1
                      ? "Irregular obstacles and open-space navigation."
                      : "Long barriers that require moving away from the goal."}
                </p>
                <div className="transfer-result">
                  <strong>
                    {result ? `${Math.round(result.success * 100)}%` : "—"}
                  </strong>
                  <span>
                    {result
                      ? `${Math.round(result.success * result.count)} / ${result.count} goals reached`
                      : "Ready to evaluate"}
                  </span>
                </div>
                <div className="result-bar">
                  <span style={{ width: `${(result?.success ?? 0) * 100}%` }} />
                </div>
                <div className="transfer-stats">
                  <span>
                    Mean reward
                    <strong>{result ? result.reward.toFixed(1) : "—"}</strong>
                  </span>
                  <span>
                    Mean steps
                    <strong>
                      {result ? result.meanSteps.toFixed(1) : "—"}
                    </strong>
                  </span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <div className="transfer-explainer">
        <span className="method-icon">
          <FlaskConical size={22} />
        </span>
        <div>
          <h3>Generalization is a question. This is an experiment.</h3>
          <p>
            A successful training run can still struggle with narrow passages.
            These results show exactly where the learned program works, and
            where the search needs to go further. These are simulated
            evaluations, not real-world robotics claims.
          </p>
        </div>
        <ArrowRight size={22} />
      </div>
    </div>
  );
}
