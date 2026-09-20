import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Eye,
  Grid2X2,
  Pause,
  Play,
  RotateCcw,
  Route,
  Shuffle,
} from "lucide-react";
import { simulate } from "../engine/simulator";
import { makeWorld } from "../engine/world";
import type { Family, Point, Program, World } from "../engine/types";

export const FAMILY_LABELS: Record<Family, string> = {
  warehouse: "Warehouse",
  terrain: "Open terrain",
  maze: "Narrow passages",
};
const iso = (x: number, y: number) => ({
  x: 410 + (x - y) * 28,
  y: 70 + (x + y) * 14,
});
const polygon = (points: Point[]) =>
  points.map((p) => `${p.x},${p.y}`).join(" ");
const tile = (x: number, y: number) => [
  iso(x, y),
  iso(x + 1, y),
  iso(x + 1, y + 1),
  iso(x, y + 1),
];

function Block({
  x,
  y,
  height = 25,
  family,
}: {
  x: number;
  y: number;
  height?: number;
  family: Family;
}) {
  const points = tile(x + 0.06, y + 0.06);
  const top = points.map((p) => ({ x: p.x, y: p.y - height }));
  const field = family === "terrain";
  return (
    <g>
      <polygon
        points={polygon([points[3], points[2], top[2], top[3]])}
        fill={field ? "#b4c4bc" : "#c6ccdf"}
        stroke={field ? "#aebdb4" : "#c2c8db"}
        strokeWidth="0.6"
      />
      <polygon
        points={polygon([points[1], points[2], top[2], top[1]])}
        fill={field ? "#c9d5cf" : "#dce0ed"}
        stroke={field ? "#bac9c0" : "#c9d0e2"}
        strokeWidth="0.6"
      />
      <polygon
        points={polygon(top)}
        fill={field ? "#e1e9e3" : "#f0f1f8"}
        stroke={field ? "#c5d2c9" : "#d0d6e7"}
        strokeWidth="0.8"
      />
      <path
        d={`M ${top[0].x + 2} ${top[0].y + 5} L ${top[1].x - 6} ${top[1].y + 1}`}
        stroke="white"
        strokeOpacity=".8"
      />
    </g>
  );
}

export function WorldMap({
  world,
  position,
  trail = [],
  showGrid = true,
}: {
  world: World;
  position?: Point;
  trail?: Point[];
  showGrid?: boolean;
}) {
  const walls = new Set(world.walls);
  const start = iso(world.start.x + 0.5, world.start.y + 0.5),
    goal = iso(world.goal.x + 0.5, world.goal.y + 0.5);
  const robot = iso(
    (position ?? world.start).x + 0.5,
    (position ?? world.start).y + 0.5,
  );
  const order = Array.from({ length: world.size ** 2 }, (_, i) => ({
    x: i % world.size,
    y: Math.floor(i / world.size),
  })).sort((a, b) => a.x + a.y - b.x - b.y);
  const perimeter = [iso(0, 0), iso(12, 0), iso(12, 12), iso(0, 12)];
  return (
    <svg
      className="world-svg"
      viewBox="40 18 740 458"
      role="img"
      aria-label={`${FAMILY_LABELS[world.family]} simulation. Robot at ${position?.x ?? world.start.x}, ${position?.y ?? world.start.y}. Goal at ${world.goal.x}, ${world.goal.y}.`}
    >
      <defs>
        <radialGradient id="floorGlow">
          <stop stopColor="#dfe5fa" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f5f7fc" stopOpacity="0" />
        </radialGradient>
        <filter id="robotShadow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id="roverTop" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fafbff" />
          <stop offset="1" stopColor="#b8c7fa" />
        </linearGradient>
        <linearGradient id="roverBody">
          <stop stopColor="#5d76f4" />
          <stop offset="1" stopColor="#3346c5" />
        </linearGradient>
      </defs>
      <ellipse cx="410" cy="306" rx="343" ry="174" fill="url(#floorGlow)" />
      <polygon
        points={polygon([
          perimeter[3],
          perimeter[2],
          { x: perimeter[2].x, y: perimeter[2].y + 12 },
          { x: perimeter[3].x, y: perimeter[3].y + 12 },
        ])}
        fill="#d9deee"
      />
      <polygon
        points={polygon([
          perimeter[1],
          perimeter[2],
          { x: perimeter[2].x, y: perimeter[2].y + 12 },
          { x: perimeter[1].x, y: perimeter[1].y + 12 },
        ])}
        fill="#e6e9f3"
      />
      {order.map(({ x, y }) => (
        <polygon
          key={`floor-${x}-${y}`}
          points={polygon(tile(x, y))}
          fill={(x + y) % 2 === 0 ? "#f7f8fd" : "#f3f5fc"}
          stroke={showGrid ? "#e1e5f1" : "#f5f7fc"}
          strokeWidth="0.7"
        />
      ))}
      <ellipse
        cx={start.x}
        cy={start.y}
        rx="17"
        ry="8"
        fill="#dce5ff"
        stroke="#889ee9"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {trail.length > 1 && (
        <>
          <polyline
            points={polygon(trail.map((p) => iso(p.x + 0.5, p.y + 0.5)))}
            fill="none"
            stroke="#4966ef"
            strokeWidth="10"
            strokeOpacity=".09"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={polygon(trail.map((p) => iso(p.x + 0.5, p.y + 0.5)))}
            fill="none"
            stroke="#647bf1"
            strokeWidth="2.8"
            strokeOpacity=".85"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
      <g className="goal-marker">
        <ellipse
          cx={goal.x}
          cy={goal.y}
          rx="25"
          ry="13"
          fill="#30bd9d"
          opacity=".1"
        />
        <ellipse
          cx={goal.x}
          cy={goal.y}
          rx="17"
          ry="8.5"
          fill="#c4f0e5"
          stroke="#41b99c"
          strokeWidth="1.4"
        />
        <path
          d={`M ${goal.x} ${goal.y - 3} v -36`}
          stroke="#299c85"
          strokeWidth="2"
        />
        <path d={`M ${goal.x} ${goal.y - 39} l 19 7 -19 8 z`} fill="#35b697" />
        <circle cx={goal.x} cy={goal.y - 40} r="2.5" fill="#1e927d" />
      </g>
      {order
        .filter(({ x, y }) => walls.has(y * world.size + x))
        .map(({ x, y }) => (
          <Block
            key={`block-${x}-${y}`}
            x={x}
            y={y}
            height={
              world.family === "terrain" ? 15 + ((x * 7 + y * 3) % 22) : 26
            }
            family={world.family}
          />
        ))}
      <g
        className="rover"
        style={{ transform: `translate(${robot.x}px, ${robot.y}px)` }}
      >
        <ellipse
          cy="2"
          rx="21"
          ry="10"
          fill="#3d4f90"
          opacity=".22"
          filter="url(#robotShadow)"
        />
        <ellipse
          cx="-13"
          cy="-3"
          rx="5"
          ry="7"
          fill="#34416c"
          transform="rotate(-20 -13 -3)"
        />
        <ellipse
          cx="13"
          cy="-3"
          rx="5"
          ry="7"
          fill="#263357"
          transform="rotate(20 13 -3)"
        />
        <path
          d="M -17 -17 L 0 -25 L 17 -17 L 17 -6 Q 0 9 -17 -6 Z"
          fill="url(#roverBody)"
          stroke="#435bcd"
          strokeWidth=".7"
        />
        <path
          d="M -17 -17 L 0 -26 L 17 -17 L 0 -8 Z"
          fill="url(#roverTop)"
          stroke="#f5f7ff"
          strokeWidth=".8"
        />
        <path d="M -7 -19 L 0 -23 L 7 -19 L 0 -15 Z" fill="#7189ed" />
        <path d="M 4 -8 L 13 -12 L 13 -8 L 4 -4 Z" fill="#b4fbf5" />
        <path d="M -9 -29 v 9" stroke="#6175c1" strokeWidth="1.5" />
        <circle cx="-9" cy="-30" r="2" fill="#5265e0" />
      </g>
      <g
        fill="#9aa3ba"
        fontFamily="IBM Plex Mono, monospace"
        fontSize="8"
        letterSpacing="1"
      >
        <text x="413" y="451">
          X
        </text>
        <text x="57" y="252">
          Y
        </text>
        <text x="687" y="417">
          12 × 12 WORLD
        </text>
      </g>
    </svg>
  );
}

export default function Scene({
  program,
  family,
  setFamily,
  seed,
  setSeed,
}: {
  program: Program;
  family: Family;
  setFamily: (f: Family) => void;
  seed: number;
  setSeed: (s: number) => void;
}) {
  const world = useMemo(() => makeWorld(seed, family), [seed, family]);
  const episode = useMemo(
    () => simulate(program, world, true),
    [program, world],
  );
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(true),
    [speed, setSpeed] = useState(1);
  const [showPath, setShowPath] = useState(true),
    [showGrid, setShowGrid] = useState(true);
  useEffect(() => {
    setIndex(0);
  }, [episode]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => setIndex((i) => (i >= episode.frames.length - 1 ? 0 : i + 1)),
      index >= episode.frames.length - 1 ? 1900 : 340 / speed,
    );
    return () => clearTimeout(timer);
  }, [playing, episode, index, speed]);
  const frame = episode.frames[Math.min(index, episode.frames.length - 1)];
  return (
    <section className="panel simulation-panel">
      <div className="panel-heading">
        <div className="heading-with-icon">
          <span className="icon-square">
            <Grid2X2 size={17} />
          </span>
          <div>
            <h2>The simulation</h2>
            <p>A small world. A learned way through it.</p>
          </div>
        </div>
        <span className="live-label">
          <span className={playing ? "status-dot pulse" : "status-dot gray"} />
          {playing ? "LIVE PREVIEW" : "PAUSED"}
        </span>
      </div>
      <div className="scene-tabs">
        {(["warehouse", "terrain", "maze"] as Family[]).map((f) => (
          <button
            key={f}
            className={f === family ? "scene-tab active" : "scene-tab"}
            onClick={() => setFamily(f)}
          >
            {FAMILY_LABELS[f]}
            {f === "maze" && <span className="tiny-new">UNSEEN</span>}
          </button>
        ))}
        <button
          className="icon-button scene-shuffle"
          title="Generate a new evaluation world"
          aria-label="Generate a new world"
          onClick={() => setSeed(seed + 97)}
        >
          <Shuffle size={15} />
        </button>
      </div>
      <div className="scene-stage">
        <div className="scene-label">
          <span className="micro-label">NAVIGATION ENVIRONMENT</span>
          <span className="scene-sub-label">
            Procedural world <span>·</span> {String(seed).slice(-5)}
          </span>
        </div>
        <div className="scene-tools">
          <button
            className={`icon-button ${showPath ? "enabled" : ""}`}
            title="Toggle robot trail"
            aria-label="Toggle robot trail"
            aria-pressed={showPath}
            onClick={() => setShowPath(!showPath)}
          >
            <Route size={16} />
          </button>
          <button
            className={`icon-button ${showGrid ? "enabled" : ""}`}
            title="Toggle grid"
            aria-label="Toggle grid"
            aria-pressed={showGrid}
            onClick={() => setShowGrid(!showGrid)}
          >
            <Grid2X2 size={16} />
          </button>
        </div>
        <WorldMap
          world={world}
          position={frame}
          trail={showPath ? episode.frames.slice(0, index + 1) : []}
          showGrid={showGrid}
        />
        <div className="scene-legend">
          <span>
            <i className="legend-agent" />
            Agent
          </span>
          <span>
            <i className="legend-goal" />
            Goal
          </span>
          <span>
            <i className="legend-obstacle" />
            Obstacle
          </span>
        </div>
        <div className={`action-label ${frame.reached ? "reached" : ""}`}>
          {frame.reached ? <Check size={13} /> : <ArrowUpRight size={13} />}{" "}
          {frame.reached ? "Goal reached" : `action: ${frame.action}`}
        </div>
      </div>
      <div className="playback">
        <button
          className="playback-play"
          aria-label={playing ? "Pause simulation" : "Play simulation"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? (
            <Pause size={14} fill="currentColor" />
          ) : (
            <Play size={14} fill="currentColor" />
          )}
        </button>
        <button
          className="icon-button"
          title="Replay from start"
          aria-label="Replay simulation"
          onClick={() => {
            setIndex(0);
            setPlaying(true);
          }}
        >
          <RotateCcw size={15} />
        </button>
        <div className="playback-progress">
          <input
            type="range"
            aria-label="Simulation step"
            min={0}
            max={episode.frames.length - 1}
            value={index}
            onChange={(e) => {
              setIndex(Number(e.target.value));
              setPlaying(false);
            }}
            style={
              {
                "--progress": `${(index / Math.max(1, episode.frames.length - 1)) * 100}%`,
              } as React.CSSProperties
            }
          />
        </div>
        <span className="step-count">
          {String(index).padStart(2, "0")} <span>/ {episode.steps} steps</span>
        </span>
        <button
          className="speed-button"
          title="Change playback speed"
          onClick={() => setSpeed(speed === 4 ? 0.5 : speed * 2)}
        >
          {speed}×
        </button>
      </div>
      <div className="simulation-footnote">
        <Eye size={13} />
        <span>Evaluation world · excluded from training</span>
        <span>
          {episode.success ? "Goal reached" : "Step budget reached"} in{" "}
          {episode.steps} steps
        </span>
      </div>
    </section>
  );
}
