import { useState } from "react";
import { TrendingUp } from "lucide-react";
import type { Generation } from "../engine/types";

export default function Chart({
  history,
  total,
}: {
  history: Generation[];
  total: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const X = (i: number) => 40 + (i / Math.max(1, total - 1)) * 628;
  const Y = (n: number) => 192 - (Math.max(0, n) / 100) * 158;
  const path = (field: "best" | "mean") =>
    history.map((h, i) => `${i ? "L" : "M"} ${X(i)} ${Y(h[field])}`).join(" ");
  const shown = hover === null ? null : history[hover];
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div className="heading-with-icon">
          <span className="icon-square">
            <TrendingUp size={17} />
          </span>
          <div>
            <h2>Learning, generation by generation</h2>
            <p>Better behavior. Smaller programs.</p>
          </div>
        </div>
        <span className="chart-unit">FITNESS / 100</span>
      </div>
      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox="0 0 700 224"
          role="img"
          aria-label={`Fitness over ${history.length} generations. Best fitness ${history.at(-1)?.best.toFixed(1)} out of 100.`}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * 700;
            setHover(
              Math.max(
                0,
                Math.min(
                  history.length - 1,
                  Math.round(((x - 40) / 628) * (total - 1)),
                ),
              ),
            );
          }}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#6075e7" stopOpacity=".15" />
              <stop offset="1" stopColor="#6075e7" stopOpacity=".01" />
            </linearGradient>
          </defs>
          {[0, 25, 50, 75, 100].map((n) => (
            <g key={n}>
              <line
                x1="40"
                x2="668"
                y1={Y(n)}
                y2={Y(n)}
                stroke="#edf0f5"
                strokeDasharray={n === 0 ? undefined : "3 4"}
              />
              <text x="27" y={Y(n) + 3} textAnchor="end" className="chart-text">
                {n}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((n) => (
            <text
              key={n}
              x={X(n * (total - 1))}
              y="215"
              textAnchor="middle"
              className="chart-text"
            >
              {Math.max(1, Math.round(n * total))}
            </text>
          ))}
          {history.length > 0 && (
            <>
              <path
                d={`${path("best")} L ${X(history.length - 1)} 192 L 40 192 Z`}
                fill="url(#chartFill)"
              />
              <path
                d={path("mean")}
                stroke="#86b8ac"
                fill="none"
                strokeWidth="2"
                strokeDasharray="4 5"
              />
              <path
                d={path("best")}
                stroke="#586be3"
                fill="none"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
              <circle
                cx={X(history.length - 1)}
                cy={Y(history.at(-1)!.best)}
                r="4"
                fill="#586be3"
                stroke="white"
                strokeWidth="2"
              />
            </>
          )}
          {shown && hover !== null && (
            <>
              <line
                x1={X(hover)}
                x2={X(hover)}
                y1="24"
                y2="192"
                stroke="#bcc6e0"
                strokeDasharray="3 4"
              />
              <circle
                cx={X(hover)}
                cy={Y(shown.best)}
                r="4"
                fill="#586be3"
                stroke="white"
                strokeWidth="2"
              />
              <g
                transform={`translate(${Math.min(560, Math.max(42, X(hover) - 50))}, 0)`}
              >
                <rect width="108" height="25" rx="6" fill="#25315c" />
                <text
                  x="54"
                  y="16"
                  fill="white"
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="IBM Plex Mono"
                >
                  G{shown.generation} · {shown.best.toFixed(2)}
                </text>
              </g>
            </>
          )}
        </svg>
      </div>
      <div className="chart-footer">
        <div className="chart-legend">
          <span>
            <i />
            Best program
          </span>
          <span>
            <i />
            Population mean
          </span>
        </div>
        <span>Generation</span>
      </div>
    </section>
  );
}
