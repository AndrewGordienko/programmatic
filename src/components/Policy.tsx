import { useState } from "react";
import {
  Braces,
  Check,
  Copy,
  Download,
  GitBranch,
  Sparkles,
} from "lucide-react";
import {
  activeIndices,
  isBinary,
  isUnary,
  programLines,
} from "../engine/program";
import type { Candidate } from "../engine/types";

function highlight(line: string) {
  const parts = line.split(
    /(\b(?:def|return|for|in|lambda)\b|\b(?:score|policy|goal_progress|visit_count|same_direction|free_neighbors|legal_moves|max|min)\b|#.*|\b\d+(?:\.\d+)?\b)/g,
  );
  return parts.map((part, i) => (
    <span
      key={i}
      className={
        part.startsWith("#")
          ? "syntax-comment"
          : /^(def|return|for|in|lambda)$/.test(part)
            ? "syntax-keyword"
            : /^(score|policy|goal_progress|visit_count|same_direction|free_neighbors|legal_moves|max|min)$/.test(
                  part,
                )
              ? "syntax-function"
              : /^\d/.test(part)
                ? "syntax-number"
                : undefined
      }
    >
      {part}
    </span>
  ));
}

export default function Policy({
  candidate,
  exportPolicy,
  notify,
  neural,
}: {
  neural: boolean;
  candidate: Candidate;
  exportPolicy: () => void;
  notify: (text: string) => void;
}) {
  const [view, setView] = useState<"code" | "graph">("code");
  const { program, activeNodes } = candidate;
  const lines = [
    "# Evolved scoring expression.",
    "def score(move):",
    ...programLines(program),
    "",
    "# Supplied action-selection scaffold.",
    "def policy(observation):",
    "    moves = legal_moves(observation)",
    "    return max(moves, key=score)",
  ];
  const indices = activeIndices(program);
  return (
    <section className="panel policy-panel">
      <div className="panel-heading">
        <div className="heading-with-icon">
          <span className="icon-square purple">
            <Braces size={17} />
          </span>
          <div>
            <h2>The learned program</h2>
            <p>Intelligence you can actually read.</p>
          </div>
        </div>
        <span className="node-badge">{activeNodes} nodes</span>
      </div>
      <div className="code-toolbar">
        <div className="view-toggle">
          <button
            className={view === "code" ? "selected" : ""}
            onClick={() => setView("code")}
          >
            <Braces size={13} />
            Code
          </button>
          <button
            className={view === "graph" ? "selected" : ""}
            onClick={() => setView("graph")}
          >
            <GitBranch size={13} />
            Graph
          </button>
        </div>
        <span className="code-language">
          {view === "code" ? "POLICY DSL" : "ACTIVE GENES"}
        </span>
        <button
          className="icon-button"
          title="Copy policy code"
          aria-label="Copy policy code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(lines.join("\n"));
              notify("Policy code copied to clipboard.");
            } catch {
              notify("Clipboard unavailable. Use Export Python instead.");
            }
          }}
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="code-area">
        {view === "code" ? (
          <pre>
            {lines.map((line, i) => (
              <div className="code-line" key={i}>
                <span className="line-number">{i + 1}</span>
                <code>{highlight(line) || " "}</code>
              </div>
            ))}
          </pre>
        ) : (
          <div className="gene-graph">
            {indices.map((index, n) => {
              const g = program.genes[index];
              return (
                <div className="gene-row" key={index}>
                  <span className="gene-index">v{n}</span>
                  <div
                    className={`gene-box ${index === program.output ? "output-gene" : ""}`}
                  >
                    <GitBranch size={13} />
                    <strong>{g.op}</strong>
                    <span>
                      {isBinary(g.op)
                        ? `v${indices.indexOf(g.a)}, v${indices.indexOf(g.b)}`
                        : isUnary(g.op)
                          ? `v${indices.indexOf(g.a)}`
                          : g.op === "constant"
                            ? g.value
                            : "observation"}
                    </span>
                  </div>
                  {index === program.output && (
                    <span className="graph-output">→ score</span>
                  )}
                </div>
              );
            })}
            <p>
              {program.genes.length - activeNodes} inactive genes skipped at
              runtime.
            </p>
          </div>
        )}
      </div>
      <div className="policy-insight">
        <Sparkles size={16} />
        <div>
          <strong>The scoring rule is learned.</strong>
          <p>
            {neural
              ? "Neural guidance during search."
              : "Evolutionary search, no neural guide."}
            <br />
            Only this program at inference.
          </p>
        </div>
      </div>
      <div className="policy-footer">
        <span>
          <Check size={13} />
          Bounded execution
        </span>
        <button onClick={exportPolicy}>
          <Download size={14} />
          Export Python
        </button>
      </div>
    </section>
  );
}
