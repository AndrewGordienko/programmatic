import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Download,
  LockKeyhole,
  Mountain,
  Play,
  Scissors,
  Square,
} from "lucide-react";
import OffroadViewport from "../offroad/OffroadViewport";
import { activeGenes, programLines, runOp } from "../offroad/program";
import { makeTerrain } from "../offroad/terrain";
import { INPUTS, type Truck, type Value } from "../offroad/types";
import {
  freshSpecs,
  validateArtifact,
  validateManifest,
  VERSION,
  START_CHECK,
  type FrozenArtifact,
  type Manifest,
  type RaceState,
} from "./protocol";
import "./challenge.css";

type Arm = "fixed" | "learned";
type Entry = {
  fixed?: RaceState;
  learned?: RaceState;
  deployment: Partial<Record<Arm, Truck["status"]>>;
};
type Session = {
  id: string;
  manifest: Manifest;
  rows: Entry[];
  status: "running" | "complete" | "interrupted" | "error";
  message?: string;
};
const STORE = "argos-unseen-terrain-v1";
const number = (v: number) => v.toLocaleString();
const arms: Arm[] = ["fixed", "learned"];
async function sha(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function readSessions(): Session[] {
  try {
    const saved: Session[] = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(saved)
      ? saved
          .filter(
            (s) =>
              s.manifest?.version === VERSION &&
              s.rows?.length === s.manifest.challenges.length,
          )
          .map((s) =>
            s.status === "running"
              ? {
                  ...s,
                  status: "interrupted",
                  message:
                    "Page closed before completion; retained last reported counts.",
                }
              : s,
          )
      : [];
  } catch {
    return [];
  }
}
function download(data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "unseen-terrain-audit.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Lane({
  arm,
  state,
  terrain,
  active,
  frame,
  onFrame,
  macrosRemoved,
}: {
  arm: Arm;
  state?: RaceState;
  terrain: ReturnType<typeof makeTerrain>;
  active: boolean;
  frame?: Truck;
  onFrame: (s: Truck) => void;
  macrosRemoved: boolean;
}) {
  const program = state?.solution?.program ?? null;
  const immobile = state?.status === "infeasible";
  const values = useMemo(() => {
    if (!program || !frame?.scans) return [];
    const all: Value[] = [...frame.scans.vectors, ...frame.scans.scalars];
    return activeGenes(program).map((i) => {
      const g = program.genes[i],
        value = runOp(
          g.op,
          g.refs.map((r) => all[r]),
          g.value,
          program.macros,
        );
      all[INPUTS + i] = value;
      return {
        op: g.op,
        value:
          typeof value === "number"
            ? value.toFixed(3)
            : `[${Math.min(...value).toFixed(2)} … ${Math.max(...value).toFixed(2)}]`,
        macro: program.macros.some((m) => m.name === g.op),
      };
    });
  }, [program, frame]);
  const deployed = program && frame && frame.time > 0;
  const status = immobile
    ? "Infeasible start · search not run"
    : state?.status === "solved"
      ? deployed
        ? frame.status === "arrived"
          ? "Destination reached"
          : frame.status === "driving"
            ? "Executing synthesized program"
            : `Deployment ended: ${frame.status}`
        : "Solution found · deploying"
      : state?.status === "exhausted"
        ? "Budget exhausted"
        : "Searching for a controller";
  return (
    <article className={`challenge-lane ${arm}`}>
      <header>
        <div>
          <span className="challenge-kicker">
            {arm === "fixed" ? "CONTROL" : "LANGUAGE INTERVENTION"}
          </span>
          <h2>
            {arm === "fixed"
              ? "Fixed DSL"
              : macrosRemoved
                ? "Learned primitives removed"
                : "Learned DSL"}
          </h2>
        </div>
        <span className={`challenge-status ${state?.status ?? ""}`}>
          {immobile
            ? "INFEASIBLE START"
            : state?.status === "solved"
              ? "SOLUTION FOUND"
              : state?.status === "exhausted"
                ? "NO SOLUTION"
                : "SYNTHESIZING"}
        </span>
      </header>
      <div className="challenge-counters">
        <div>
          <strong>{number(state?.evaluations ?? 0)}</strong>
          <span>/ {number(state?.budget ?? 0)} evaluations</span>
        </div>
        <div>
          <strong>{state?.best?.fitness.toFixed(1) ?? "—"}</strong>
          <span>best fitness</span>
        </div>
        <div>
          <strong>{state?.solution?.nodes ?? state?.best?.nodes ?? "—"}</strong>
          <span>active nodes</span>
        </div>
        <div>
          <strong>{((state?.elapsedMs ?? 0) / 1000).toFixed(1)}s</strong>
          <span>search wall time</span>
        </div>
      </div>
      <div className="challenge-progress">
        <i
          style={{
            width: `${(100 * (state?.evaluations ?? 0)) / (state?.budget ?? 1)}%`,
          }}
        />
      </div>
      <div className="challenge-world">
        <OffroadViewport
          program={program}
          terrain={terrain}
          playing={active && !!program}
          speed={1}
          camera={program ? "chase" : "overhead"}
          sensors={!!program}
          reset={program ? 1 : 0}
          obstacle={0}
          manual={false}
          onFrame={onFrame}
        />
        <div className="challenge-world-label">
          <Mountain size={14} />
          {terrain.kind} · {terrain.seed}
        </div>
        {!program && (
          <div className="challenge-wait">
            <span
              className={
                immobile || state?.status === "exhausted"
                  ? ""
                  : "challenge-pulse"
              }
            />
            <strong>
              {immobile
                ? "Truck cannot leave this start"
                : state?.status === "exhausted"
                  ? "No controller found within budget"
                  : "Truck awaiting a program"}
            </strong>
            <small>
              {immobile
                ? "Terrain retained as an unsuccessful outcome. No replacement seed is sampled."
                : state?.status === "exhausted"
                  ? "Best failed candidate is not deployed."
                  : "Every candidate executes in this terrain simulation."}
            </small>
          </div>
        )}
        <div className="challenge-world-footer">
          <span>{status}</span>
          {deployed && (
            <b>
              {Math.hypot(
                terrain.goal.x - frame.x,
                terrain.goal.z - frame.z,
              ).toFixed(0)}{" "}
              m to goal · {frame.speed.toFixed(1)} m/s
            </b>
          )}
        </div>
      </div>
      <div className="challenge-program">
        <div className="challenge-program-title">
          <span>
            {immobile
              ? "WHY NO PROGRAM CAN WORK HERE"
              : program
                ? "ACTUAL SYNTHESIZED PROGRAM"
                : "PROGRAM PENDING"}
          </span>
          <small>
            {program
              ? `${program.id} · no policy checkpoint`
              : "No controller is supplied to search"}
          </small>
        </div>
        {immobile && state.diagnosis ? (
          <div className="challenge-start-diagnosis">
            <p>{state.diagnosis.explanation}</p>
            <p>
              <b>{state.diagnosis.pitchDegrees.toFixed(1)}° uphill</b> · maximum
              drive <b>{state.diagnosis.maximumDrive.toFixed(2)} m/s²</b> ·
              opposing gravity{" "}
              <b>{state.diagnosis.opposingGravity.toFixed(2)} m/s²</b>
            </p>
            <small>
              This diagnoses a task/model mismatch, not a language-learning
              failure. Other terrains can still be unsolvable even if this check
              passes.
            </small>
          </div>
        ) : program ? (
          <pre>
            {programLines(program).map((line, i) => (
              <code
                key={i}
                className={
                  program.macros.some((m) => line.includes(m.name + "("))
                    ? "learned-code"
                    : ""
                }
              >
                {line}
                {"\n"}
              </code>
            ))}
          </pre>
        ) : (
          <p>
            Fresh typed program evolution, using the frozen prior. Deployment
            starts automatically at the first successful candidate.
          </p>
        )}
        {!!values.length && (
          <div className="challenge-values">
            {values.map((v, i) => (
              <span key={i} className={v.macro ? "macro-executed" : ""}>
                <b>{v.op}</b> {v.value}
              </span>
            ))}
            <small>
              Values at the last control step. Highlighted calls use learned
              primitives.
            </small>
          </div>
        )}
      </div>
    </article>
  );
}
export default function ChallengeLab({ active }: { active: boolean }) {
  const [artifact, setArtifact] = useState<FrozenArtifact | null>(null),
    [error, setError] = useState(""),
    [preparing, setPreparing] = useState(false);
  const [sessions, setSessions] = useState<Session[]>(readSessions),
    history = useRef(sessions);
  const [session, setSession] = useState<Session | null>(null),
    current = useRef<Session | null>(null);
  const [index, setIndex] = useState(0),
    indexRef = useRef(0),
    [budget, setBudget] = useState(50_000);
  const [frames, setFrames] = useState<Partial<Record<Arm, Truck>>>({});
  const workers = useRef<Worker[]>([]),
    token = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    lastSave = useRef(0);
  const stopWorkers = () => {
    workers.current.forEach((w) => w.terminate());
    workers.current = [];
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch("/offroad-frozen.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error("Frozen training artifact unavailable");
        return r.json();
      })
      .then(async (a: FrozenArtifact) => {
        validateArtifact(a);
        if ((await sha(a.payload)) !== a.hash)
          throw Error("Frozen artifact checksum mismatch");
        if (!controller.signal.aborted) setArtifact(a);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e.message));
      });
    return () => {
      controller.abort();
      token.current++;
      stopWorkers();
    };
  }, []);
  const publish = (next: Session, persist = false) => {
    current.current = next;
    setSession(next);
    if (persist) {
      const all = [...history.current.filter((s) => s.id !== next.id), next];
      // Retain failures and interruptions. Never prune unfavorable results.
      localStorage.setItem(STORE, JSON.stringify(all));
      history.current = all;
      setSessions(all);
      lastSave.current = performance.now();
    }
  };
  const fail = (message: string) => {
    stopWorkers();
    token.current++;
    setError(message);
    if (current.current) {
      const next = { ...current.current, status: "error" as const, message };
      try {
        publish(next, true);
      } catch {
        publish(next);
      }
    }
  };
  const beginChallenge = (run: Session, i: number) => {
    stopWorkers();
    indexRef.current = i;
    setIndex(i);
    setFrames({});
    const runToken = ++token.current;
    for (const arm of arms) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      workers.current.push(w);
      w.onerror = () => {
        if (token.current === runToken)
          fail(`${arm} search worker stopped unexpectedly`);
      };
      w.onmessage = (e) => {
        if (token.current !== runToken) return;
        if (e.data.type === "error") {
          fail(e.data.message);
          return;
        }
        const state = e.data.state as RaceState,
          live = current.current!;
        const rows = live.rows.map((row, j) =>
          j === i ? { ...row, [arm]: state } : row,
        );
        try {
          publish(
            { ...live, rows },
            state.status !== "searching" ||
              performance.now() - lastSave.current > 2000,
          );
        } catch {
          fail(
            "Could not save audit history. Export this run before continuing.",
          );
        }
        if (state.status !== "searching") w.terminate();
      };
      w.postMessage({ artifact, manifest: run.manifest, index: i, arm });
    }
  };
  const start = async (count: number, ablation = false) => {
    if (!artifact || preparing || current.current?.status === "running") return;
    setPreparing(true);
    setError("");
    try {
      const previous = current.current;
      const used = new Set(
        history.current.flatMap((s) =>
          s.manifest.challenges.map((c) => c.seed),
        ),
      );
      const manifest: Manifest = {
        version: VERSION,
        ...(ablation
          ? previous!.manifest.startCheck
            ? { startCheck: previous!.manifest.startCheck }
            : {}
          : { startCheck: START_CHECK }),
        createdAt: new Date().toISOString(),
        artifactHash: artifact.hash,
        budget: ablation ? previous!.manifest.budget : budget,
        challenges: ablation
          ? structuredClone(previous!.manifest.challenges)
          : freshSpecs(
              count,
              used,
              () => crypto.getRandomValues(new Uint32Array(1))[0],
            ),
        mode: ablation ? "remove-macros" : "learned",
        ...(ablation ? { ablationOf: previous!.id } : {}),
      };
      validateManifest(manifest, artifact);
      const run: Session = {
        id: await sha(manifest),
        manifest,
        rows: manifest.challenges.map(() => ({ deployment: {} })),
        status: "running",
      };
      // The complete seed list and budgets are durably sealed BEFORE worker creation.
      publish(run, true);
      beginChallenge(run, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  };
  const onFrame = (arm: Arm, s: Truck) => {
    setFrames((prev) => ({ ...prev, [arm]: s }));
    const live = current.current,
      i = indexRef.current;
    if (
      !live ||
      live.status !== "running" ||
      !live.rows[i][arm]?.solution ||
      s.time === 0 ||
      live.rows[i].deployment[arm] === s.status
    )
      return;
    try {
      publish(
        {
          ...live,
          rows: live.rows.map((r, j) =>
            j === i
              ? { ...r, deployment: { ...r.deployment, [arm]: s.status } }
              : r,
          ),
        },
        s.status !== "driving",
      );
    } catch {
      fail("Could not persist deployment result");
    }
  };
  useEffect(() => {
    if (!session || session.status !== "running") return;
    const row = session.rows[index];
    const finished = arms.every(
      (arm) =>
        row[arm] &&
        row[arm]!.status !== "searching" &&
        (row[arm]!.status !== "solved" ||
          (row.deployment[arm] && row.deployment[arm] !== "driving")),
    );
    if (!finished) return;
    if (index === session.rows.length - 1) {
      try {
        publish({ ...session, status: "complete" }, true);
      } catch {
        fail("Could not persist completed run");
      }
      return;
    }
    timer.current = setTimeout(() => {
      const live = current.current;
      if (live?.status === "running") beginChallenge(live, index + 1);
    }, 1400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [session, index]);
  const terrain = useMemo(
    () =>
      session
        ? makeTerrain(
            session.manifest.challenges[index].seed,
            session.manifest.challenges[index].kind,
          )
        : null,
    [session?.id, index],
  );
  const row = session?.rows[index],
    running = session?.status === "running";
  const previous = !!session && !running && session.manifest.mode === "learned";
  const completed = sessions
    .filter(
      (s) =>
        s.manifest.mode === "learned" &&
        s.manifest.artifactHash === artifact?.hash,
    )
    .flatMap((s) => s.rows)
    .filter(
      (r) =>
        r.fixed &&
        r.learned &&
        r.fixed.status !== "searching" &&
        r.learned.status !== "searching",
    );
  const infeasibleCount = completed.filter(
    (r) =>
      r.fixed?.status === "infeasible" && r.learned?.status === "infeasible",
  ).length;
  const countSolved = (arm: Arm) =>
    completed.filter((r) => r[arm]?.status === "solved").length;
  return (
    <section className="challenge-lab">
      <div className="challenge-heading">
        <div>
          <span className="challenge-kicker">
            FROZEN LANGUAGE → FRESH SEARCH → LIVE DEPLOYMENT
          </span>
          <h1>
            Unseen terrain challenge<span>.</span>
          </h1>
          <p>Can a learned language find a working program sooner?</p>
        </div>
        <div className="challenge-freeze">
          <LockKeyhole size={18} />
          <div>
            <b>
              {artifact ? "DSL + prior frozen" : "Verifying training artifact"}
            </b>
            <small>
              {artifact
                ? `SHA-256 ${artifact.hash.slice(0, 16)}…`
                : "No challenge seeds generated yet"}
            </small>
          </div>
        </div>
      </div>
      <div className="challenge-controls">
        <button
          className="challenge-primary"
          disabled={!artifact || running || preparing}
          onClick={() => start(1)}
        >
          <Play size={16} />
          {preparing ? "Sealing challenge…" : "Generate unseen challenge"}
          <ArrowUpRight size={16} />
        </button>
        <button
          disabled={!artifact || running || preparing}
          onClick={() => start(10)}
        >
          Run 10 sealed challenges
        </button>
        <label>
          Budget per side
          <select
            value={budget}
            disabled={!!running || preparing}
            onChange={(e) => setBudget(Number(e.target.value))}
          >
            <option value={2000}>2,000 · quick check</option>
            <option value={10000}>10,000</option>
            <option value={50000}>50,000</option>
          </select>
        </label>
        {running && (
          <button
            onClick={() => {
              stopWorkers();
              token.current++;
              try {
                publish(
                  {
                    ...current.current!,
                    status: "interrupted",
                    message: "Stopped by user; last reported counts retained.",
                  },
                  true,
                );
              } catch {
                fail("Storage full");
              }
            }}
          >
            <Square size={14} />
            Stop & retain result
          </button>
        )}
        <button
          className="challenge-export"
          disabled={!sessions.length}
          onClick={() =>
            download({
              artifact,
              sessions: history.current,
              current: current.current,
            })
          }
        >
          <Download size={15} />
          Export audit
        </button>
      </div>
      {error && (
        <div className="challenge-error" role="alert">
          {error}
        </div>
      )}
      {artifact && (
        <div className="challenge-disclosure">
          <b>
            {artifact.payload.macros.length
              ? `${artifact.payload.macros.length} accepted terrain primitives`
              : "0 accepted terrain primitives · language advantage not demonstrated"}
          </b>
          <span>
            {artifact.payload.macros.length
              ? "Learned primitives extend the base grammar. Both searches use identical frozen neural weights; legal choices are renormalized for each grammar."
              : "The learned library is empty. With the same seed and frozen prior, the two searches should tie. Scalar abstractions have not been transferred to this domain."}
          </span>
        </div>
      )}
      {session && (
        <div className="challenge-seal">
          <span>
            CHALLENGE {String(index + 1).padStart(2, "0")} /{" "}
            {String(session.rows.length).padStart(2, "0")}
          </span>
          <span>
            {session.manifest.mode === "remove-macros"
              ? "ABLATION · REPEATED TERRAIN"
              : "UNSEEN BEFORE SYNTHESIS"}
          </span>
          <span>Training access: none</span>
          <span>Prior updates: disabled</span>
          <span>{number(session.manifest.budget)} evals each</span>
          <span>
            Search seed {session.manifest.challenges[index].searchSeed}
          </span>
          <small>Sealed {session.id.slice(0, 12)}</small>
        </div>
      )}
      {terrain && row ? (
        <div className="challenge-lanes">
          {arms.map((arm) => (
            <Lane
              key={`${session!.id}-${index}-${arm}`}
              arm={arm}
              state={
                row[arm] ?? {
                  evaluations: 0,
                  budget: session!.manifest.budget,
                  status: "searching",
                  best: null,
                  solution: null,
                  computeMs: 0,
                  elapsedMs: 0,
                  generation: 0,
                }
              }
              terrain={terrain}
              active={
                active &&
                session!.status !== "interrupted" &&
                session!.status !== "error"
              }
              frame={frames[arm]}
              onFrame={(s) => onFrame(arm, s)}
              macrosRemoved={session!.manifest.mode === "remove-macros"}
            />
          ))}
        </div>
      ) : (
        <div className="challenge-empty">
          <div className="challenge-contours" />
          <Mountain size={40} strokeWidth={1} />
          <h2>The trucks are waiting for code.</h2>
          <p>
            Generate a new terrain after the training artifact is frozen.
            <br />
            Two independent workers search from scratch. The first successful
            program drives immediately.
          </p>
          <div>
            <span>01 · Seal the terrain</span>
            <span>02 · Race synthesis</span>
            <span>03 · Deploy the program</span>
          </div>
        </div>
      )}
      <div className="challenge-ablation">
        <div>
          <h3>Remove learned primitives</h3>
          <p>
            Repeat the sealed terrains, random seeds and evaluation budget. Keep
            the frozen neural weights.
          </p>
          {!artifact?.payload.macros.length && (
            <small>
              Currently a no-op: the artifact contains no learned primitives. A
              tie cannot establish a causal language benefit.
            </small>
          )}
        </div>
        <button
          disabled={!previous || preparing}
          onClick={() => start(session!.rows.length, true)}
        >
          <Scissors size={16} />
          Remove primitives & rerun
        </button>
      </div>
      {session && (
        <div className="challenge-results">
          <div>
            <h3>Sealed challenge ledger</h3>
            <span>{session.status} · every generated seed retained</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Challenge</th>
                <th>Terrain seed</th>
                <th>Fixed DSL</th>
                <th>
                  {session.manifest.mode === "remove-macros"
                    ? "Primitives removed"
                    : "Learned DSL"}
                </th>
                <th>Deployment · fixed / learned</th>
              </tr>
            </thead>
            <tbody>
              {session.rows.map((r, i) => (
                <tr key={i} className={i === index ? "current-row" : ""}>
                  <td>
                    {String(i + 1).padStart(2, "0")} ·{" "}
                    {session.manifest.challenges[i].kind}
                  </td>
                  <td>{session.manifest.challenges[i].seed}</td>
                  {arms.map((a) => (
                    <td key={a}>
                      {r[a]
                        ? `${number(r[a]!.evaluations)} · ${r[a]!.status}`
                        : "sealed · queued"}
                    </td>
                  ))}
                  <td>
                    {r.deployment.fixed ?? "—"} / {r.deployment.learned ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="challenge-evidence">
        <div>
          <span>LOCAL SEALED EVIDENCE</span>
          <h3>{completed.length} completed paired outcomes</h3>
          <p>
            {infeasibleCount} immobile starts detected. {sessions.length}{" "}
            attempts retained, including interruptions and ablations. Only
            completed, non-ablation pairs with this artifact enter the counts.
            Infeasible starts remain in the denominator.
          </p>
        </div>
        <div>
          <strong>
            {countSolved("fixed")} / {completed.length}
          </strong>
          <span>fixed DSL solved</span>
        </div>
        <div>
          <strong>
            {countSolved("learned")} / {completed.length}
          </strong>
          <span>learned DSL solved</span>
        </div>
        <div>
          <strong>
            {artifact
              ? number(
                  artifact.payload.trainingEvaluations +
                    artifact.payload.discoveryEvaluations,
                )
              : "—"}
          </strong>
          <span>training + discovery evaluations</span>
        </div>
      </div>
      <details className="challenge-protocol">
        <summary>What this race measures</summary>
        <p>
          New manifests record an immobile-start check. It proves only one
          failure mode in this forward-only model: when maximum drive is weaker
          than uphill gravity at rest, the truck cannot move or change heading
          under any controller. Such seeds remain in the ledger as unsuccessful
          outcomes with zero synthesis evaluations; they are never replaced. The
          check costs are exported separately. Historical runs retain their
          original protocol and evaluation counts.
        </p>
        <p>
          The terrain seeds are sampled with browser cryptographic randomness
          from a reserved range after the artifact checksum is verified. The
          full batch is saved before any searches begin. Failed, unattempted and
          interrupted trials remain in the audit. Seeds are unique in this
          browser’s history; this is a local audit trail, not a tamper-proof
          external registry.
        </p>
        <p>
          Both sides receive the same engineered observations, task, search
          algorithm, optimizer seed, frozen prior weights and
          candidate-evaluation cap. Grammar masks can change sampling
          probabilities. One evaluation is one controller rollout on the
          challenge terrain; it is not an equal FLOP or CPU-time guarantee. Each
          lane reports real elapsed time, including contention between workers.
        </p>
        <p>
          Search can query the new terrain for fitness. “Training access: none”
          means no updates to the frozen DSL or prior, not a zero-shot
          controller. Deployment uses the same deterministic simulator and
          generated program, not an independent generalization test. The visible
          terrains use existing woodland/quarry/ridge generators with new
          layouts; compositional terrain transfer has not been established. The
          truck model is approximate, with no real vehicle calibration.
        </p>
        <p>
          The library-learning laboratory remains the scientific benchmark. This
          local race cannot establish a 200-task, 20-meta-seed advantage or
          amortization result by itself. No break-even is claimed while the
          learned library has no demonstrated benefit.
        </p>
      </details>
    </section>
  );
}
