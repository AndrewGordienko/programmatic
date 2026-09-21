import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Box,
  BrainCircuit,
  Braces,
  Check,
  CarFront,
  Mountain,
  CircleHelp,
  Code2,
  Cpu,
  Download,
  FlaskConical,
  GitBranch,
  Layers,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import Scene from "./components/Scene";
import Chart from "./components/Chart";
import Policy from "./components/Policy";
import Configure from "./components/Configure";
import Methodology from "./components/Methodology";
import Transfer from "./components/Transfer";
import LanguageLab from "./components/LanguageLab";
import DrivingLab from "./driving/DrivingLab";
import OffroadLab from "./offroad/OffroadLab";
import LibraryLab from "./dsl/LibraryLab";
import ChallengeLab from "./challenge/ChallengeLab";
import { exportPython, programLines, validateProgram } from "./engine/program";
import {
  DEFAULT_CONFIG,
  type Config,
  type Family,
  type SavedRun,
  type Snapshot,
  type TransferResult,
} from "./engine/types";

type Status = "reference" | "running" | "paused" | "complete" | "loaded";
type Tab =
  | "challenge"
  | "research"
  | "offroad"
  | "driving"
  | "language"
  | "experiment"
  | "library"
  | "transfer";

function Logo() {
  return (
    <svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="20" cy="20" rx="17" ry="7" transform="rotate(-45 20 20)" />
        <ellipse cx="20" cy="20" rx="17" ry="7" transform="rotate(45 20 20)" />
        <circle cx="20" cy="20" r="4.5" />
      </g>
      <circle cx="31.5" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function validSnapshot(value: unknown): value is Snapshot {
  try {
    const s = value as Snapshot;
    return (
      s.generation > 0 &&
      Array.isArray(s.history) &&
      s.history.length === s.generation &&
      Boolean(s.config) &&
      Boolean(s.best) &&
      validateProgram(s.best.program) &&
      Array.isArray(s.leaders) &&
      s.leaders.every((c) => validateProgram(c.program)) &&
      Number.isFinite(s.best.fitness)
    );
  } catch {
    return false;
  }
}

function readLibrary(): SavedRun[] {
  try {
    const value = JSON.parse(localStorage.getItem("argos-library-v1") ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((r: SavedRun) => r.id && r.name && validSnapshot(r.snapshot))
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status>("reference");
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [tab, setTab] = useState<Tab>(() =>
    window.location.hash === "#challenge" ? "challenge" : "research",
  );
  const [family, setFamily] = useState<Family>("warehouse");
  const [sceneSeed, setSceneSeed] = useState(1_500_077_777);
  const [showConfig, setShowConfig] = useState(false),
    [showMethod, setShowMethod] = useState(false);
  const [toast, setToast] = useState("");
  const [library, setLibrary] = useState<SavedRun[]>(readLibrary);
  const [results, setResults] = useState<TransferResult[] | null>(null),
    [testing, setTesting] = useState(false);
  const [selectedRank, setSelectedRank] = useState(0);
  const [loadingError, setLoadingError] = useState(false);
  const worker = useRef<Worker | null>(null),
    transferWorker = useRef<Worker | null>(null);
  const notify = (text: string) => setToast(text);

  useEffect(() => {
    const w = new Worker(new URL("./engine/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "progress") setSnapshot(e.data.snapshot);
      else if (e.data.type === "complete") {
        setStatus("complete");
        setToast("Experiment complete. Your best program is ready to explore.");
      } else if (e.data.type === "error") {
        setStatus("paused");
        setToast(e.data.message);
      }
    };
    w.onerror = () => {
      setStatus("paused");
      setToast(
        "The search worker encountered an error. Reset the experiment to try again.",
      );
    };
    const controller = new AbortController();
    fetch("/reference-run.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Reference unavailable");
        return r.json();
      })
      .then((data) => {
        if (!validSnapshot(data)) throw new Error("Invalid reference");
        setSnapshot(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setLoadingError(true);
      });
    return () => {
      w.terminate();
      worker.current = null;
      transferWorker.current?.terminate();
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4200);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    try {
      localStorage.setItem("argos-library-v1", JSON.stringify(library));
    } catch {
      setToast("Browser storage is full. Export your experiment to keep it.");
    }
  }, [library]);

  const start = () => {
    transferWorker.current?.terminate();
    setTesting(false);
    setResults(null);
    setSelectedRank(0);
    setTab("experiment");
    setStatus("running");
    worker.current?.postMessage({ type: "start", config });
  };
  const action = () => {
    if (status === "running") {
      worker.current?.postMessage({ type: "pause" });
      setStatus("paused");
    } else if (status === "paused") {
      worker.current?.postMessage({ type: "resume" });
      setStatus("running");
    } else start();
  };
  const candidate = snapshot?.leaders[selectedRank] ?? snapshot?.best;
  const save = () => {
    if (!snapshot || !candidate) return;
    if (
      library.some(
        (r) =>
          (r.snapshot.leaders[r.selectedRank ?? 0] ?? r.snapshot.best).program
            .id === candidate.program.id &&
          r.snapshot.config.seed === snapshot.config.seed &&
          r.snapshot.generation === snapshot.generation &&
          JSON.stringify(
            (r.snapshot.leaders[r.selectedRank ?? 0] ?? r.snapshot.best).program
              .genes,
          ) === JSON.stringify(candidate.program.genes),
      )
    ) {
      notify("This program is already in your library.");
      return;
    }
    const run: SavedRun = {
      id: crypto.randomUUID(),
      name: `Navigation ${String(library.length + 1).padStart(3, "0")}`,
      createdAt: new Date().toISOString(),
      snapshot: structuredClone(snapshot),
      selectedRank,
    };
    setLibrary((l) => [run, ...l].slice(0, 30));
    notify(`${run.name} saved to your program library.`);
  };
  const exportPolicy = () => {
    if (candidate) {
      download(
        `argos-policy-${candidate.program.id}.py`,
        exportPython(candidate.program),
        "text/x-python",
      );
      notify("Standalone Python policy exported.");
    }
  };
  const runTransfer = () => {
    if (!candidate) return;
    transferWorker.current?.terminate();
    const w = new Worker(new URL("./engine/worker.ts", import.meta.url), {
      type: "module",
    });
    transferWorker.current = w;
    setTesting(true);
    setResults(null);
    w.onmessage = (e) => {
      if (e.data.type === "transfer") {
        setResults(e.data.results);
        setTesting(false);
        w.terminate();
      } else if (e.data.type === "error") {
        setTesting(false);
        notify(e.data.message);
        w.terminate();
      }
    };
    w.onerror = () => {
      setTesting(false);
      notify("Evaluation failed. Please try again.");
      w.terminate();
    };
    w.postMessage({
      type: "transfer",
      program: candidate.program,
      seed: 1_500_000_000,
    });
  };
  const loadRun = (run: SavedRun) => {
    worker.current?.postMessage({ type: "pause" });
    transferWorker.current?.terminate();
    setSnapshot(run.snapshot);
    setConfig(run.snapshot.config);
    setSelectedRank(run.selectedRank ?? 0);
    setStatus("loaded");
    setResults(null);
    setTesting(false);
    setTab("experiment");
    notify(`${run.name} loaded.`);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("research");
          }}
          aria-label="Argos Lab home"
        >
          <Logo />
          <span>
            argos<span className="brand-lab">/ lab</span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={!showMethod ? "nav-link active" : "nav-link"}
            onClick={() => setTab("research")}
          >
            Playground
          </button>
          <button className="nav-link" onClick={() => setShowMethod(true)}>
            How it works
            <ArrowUpRight size={13} />
          </button>
          <a
            className="nav-link"
            href="/argos-paper.pdf"
            target="_blank"
            rel="noreferrer"
          >
            Research paper
            <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="header-right">
          <a href="#demo" className="presentation-entry">
            Tuesday demo <ArrowUpRight size={13} />
          </a>
          <span className="local-compute">
            <span className="status-dot" />
            Local compute
          </span>
          <span className="header-divider" />
          <span className="prototype-pill">
            RESEARCH PREVIEW <span>0.1</span>
          </span>
        </div>
      </header>
      <main>
        {tab !== "research" && tab !== "challenge" && (
          <section className="hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <span className="eyebrow-line" />
                THE PROGRAMMATIC AI PLAYGROUND
              </div>
              <h1>
                Intelligence, written in code<span>.</span>
              </h1>
              <p>Evolve programs. Discover the language they’re built from.</p>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit orbit-three" />
              <span className="orbit-node one" />
              <span className="orbit-node two" />
              <span className="orbit-node three" />
              <Braces size={27} strokeWidth={1.3} />
            </div>
          </section>
        )}
        <div className="workspace-bar">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace">
            <button
              role="tab"
              aria-selected={tab === "research"}
              className={
                tab === "research" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("research")}
            >
              <BrainCircuit size={16} /> Language research
            </button>
            <button
              role="tab"
              aria-selected={tab === "challenge"}
              className={
                tab === "challenge" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("challenge")}
            >
              <Mountain size={16} />
              Unseen challenge
            </button>
            <button
              role="tab"
              aria-selected={tab === "offroad"}
              className={
                tab === "offroad" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("offroad")}
            >
              <Mountain size={16} />
              Control baseline
            </button>
            <button
              role="tab"
              aria-selected={tab === "driving"}
              className={
                tab === "driving" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("driving")}
            >
              <CarFront size={16} />
              Road baseline
            </button>
            <button
              role="tab"
              aria-selected={tab === "language"}
              className={
                tab === "language" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("language")}
            >
              <Braces size={16} />
              Macro baseline
            </button>
            <button
              role="tab"
              aria-selected={tab === "experiment"}
              className={
                tab === "experiment" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("experiment")}
            >
              <FlaskConical size={16} />
              Policy search
            </button>
            <button
              role="tab"
              aria-selected={tab === "library"}
              className={
                tab === "library" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("library")}
            >
              <Bookmark size={15} />
              Program library
              <span className="count-badge">{library.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === "transfer"}
              className={
                tab === "transfer" ? "workspace-tab active" : "workspace-tab"
              }
              onClick={() => setTab("transfer")}
            >
              <Layers size={16} />
              Transfer tests
            </button>
          </div>
          <div className="workspace-label">
            <span className="workspace-dot" /> PROGRAMS × LANGUAGES{" "}
            <span>/</span> RESEARCH LAB
          </div>
        </div>
        <div hidden={tab !== "research"}>
          <LibraryLab notify={notify} />
        </div>
        <div hidden={tab !== "challenge"}>
          <ChallengeLab active={tab === "challenge"} />
        </div>
        <div hidden={tab !== "offroad"}>
          <OffroadLab active={tab === "offroad"} notify={notify} />
        </div>
        <div hidden={tab !== "driving"}>
          <DrivingLab active={tab === "driving"} notify={notify} />
        </div>
        <div hidden={tab !== "language"}>
          <LanguageLab notify={notify} />
        </div>
        {tab !== "research" &&
        tab !== "challenge" &&
        tab !== "language" &&
        tab !== "driving" &&
        tab !== "offroad" &&
        (!snapshot || !candidate) ? (
          <div className="loading-state">
            {loadingError ? (
              <>
                <CircleHelp size={30} />
                <h2>The reference experiment couldn’t load.</h2>
                <p>You can still run a fresh experiment locally.</p>
                <button className="primary-button" onClick={start}>
                  Run experiment
                  <Play size={15} />
                </button>
              </>
            ) : (
              <>
                <LoaderCircle className="spin" size={25} />
                <p>Preparing your research workspace…</p>
              </>
            )}
          </div>
        ) : (
          <>
            {tab === "experiment" && snapshot && candidate && (
              <>
                <div className="experiment-toolbar">
                  <div className="experiment-name">
                    <h2>Learning to navigate</h2>
                    <span
                      className={`run-status ${status === "running" ? "is-running" : ""}`}
                    >
                      <span />
                      {status === "reference"
                        ? "Reference run"
                        : status === "running"
                          ? "Search running"
                          : status === "paused"
                            ? "Paused"
                            : status === "loaded"
                              ? "Saved run"
                              : "Completed"}
                    </span>
                    <button
                      className="icon-button info-button"
                      aria-label="About this experiment"
                      title="About this experiment"
                      onClick={() => setShowMethod(true)}
                    >
                      <CircleHelp size={15} />
                    </button>
                  </div>
                  <div className="experiment-actions">
                    <button
                      className="secondary-button"
                      disabled={status === "running"}
                      onClick={() => setShowConfig(true)}
                    >
                      <Settings2 size={15} />
                      Configure
                    </button>
                    {status === "paused" && (
                      <button
                        className="secondary-button icon-only"
                        aria-label="Restart experiment"
                        title="Restart with current configuration"
                        onClick={start}
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                    <button
                      className={`primary-button run-button ${status === "running" ? "running" : ""}`}
                      onClick={action}
                    >
                      {status === "running" ? (
                        <Pause size={14} fill="currentColor" />
                      ) : (
                        <Play size={14} fill="currentColor" />
                      )}
                      {status === "running"
                        ? "Pause search"
                        : status === "paused"
                          ? "Resume search"
                          : "Run experiment"}
                    </button>
                  </div>
                </div>
                <div className="metrics-grid">
                  <article className="metric-card">
                    <div className="metric-title">
                      Best fitness
                      <TrendingUp size={16} />
                    </div>
                    <div className="metric-value">
                      {snapshot.best.fitness.toFixed(1)}
                      <span>/ 100</span>
                    </div>
                    <div className="metric-caption">
                      <span className="positive">
                        ↗{" "}
                        {(
                          snapshot.best.fitness - snapshot.history[0].best
                        ).toFixed(1)}
                      </span>{" "}
                      since first generation
                    </div>
                    <svg
                      className="metric-sparkline"
                      viewBox="0 0 112 40"
                      aria-hidden="true"
                    >
                      <path
                        d={snapshot.history
                          .map(
                            (h, i) =>
                              `${i ? "L" : "M"} ${(i / Math.max(1, snapshot.history.length - 1)) * 108 + 2} ${35 - ((h.best - Math.min(...snapshot.history.map((v) => v.best))) / Math.max(1, snapshot.best.fitness - snapshot.history[0].best)) * 28}`,
                          )
                          .join(" ")}
                        fill="none"
                        stroke="#687bf0"
                        strokeWidth="1.7"
                      />
                    </svg>
                  </article>
                  <article className="metric-card">
                    <div className="metric-title">
                      Training success
                      <Target size={16} />
                    </div>
                    <div className="metric-value">
                      {(snapshot.best.success * 100).toFixed(0)}
                      <span className="percent-symbol">%</span>
                    </div>
                    <div className="metric-caption">
                      <span className="success-dot" />
                      {Math.round(
                        snapshot.best.success * snapshot.config.trainingWorlds,
                      )}{" "}
                      of {snapshot.config.trainingWorlds} worlds solved
                    </div>
                  </article>
                  <article className="metric-card">
                    <div className="metric-title">
                      Program complexity
                      <Braces size={16} />
                    </div>
                    <div className="metric-value">
                      {snapshot.best.activeNodes}
                      <span>active nodes</span>
                    </div>
                    <div className="metric-caption">
                      <span className="small-purple-dot" />
                      {snapshot.config.maxNodes}-node program budget
                    </div>
                  </article>
                  <article className="metric-card">
                    <div className="metric-title">
                      Generation
                      <GitBranch size={16} />
                    </div>
                    <div className="metric-value">
                      {String(snapshot.generation).padStart(2, "0")}
                      <span>/ {snapshot.config.generations}</span>
                    </div>
                    <div className="generation-track">
                      <span
                        style={{
                          width: `${(snapshot.generation / snapshot.config.generations) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="metric-caption">
                      {snapshot.evaluations.toLocaleString()} simulated episodes
                    </div>
                  </article>
                </div>
                <div className="lab-grid">
                  <Scene
                    program={candidate.program}
                    family={family}
                    setFamily={setFamily}
                    seed={sceneSeed}
                    setSeed={setSceneSeed}
                  />
                  <Policy
                    candidate={candidate}
                    exportPolicy={exportPolicy}
                    notify={notify}
                    neural={snapshot.config.neural}
                  />
                  <Chart
                    history={snapshot.history}
                    total={snapshot.config.generations}
                  />
                  <section className="panel search-panel">
                    <div className="panel-heading">
                      <div className="heading-with-icon">
                        <span className="icon-square">
                          <BrainCircuit size={17} />
                        </span>
                        <div>
                          <h2>Inside the search</h2>
                          <p>One loop. Progressively better programs.</p>
                        </div>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Learn about the search"
                        onClick={() => setShowMethod(true)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="search-loop">
                      {[
                        { Icon: Braces, label: "Propose" },
                        { Icon: Box, label: "Simulate" },
                        { Icon: Activity, label: "Score" },
                        { Icon: GitBranch, label: "Evolve" },
                      ].map(({ Icon, label }, i) => (
                        <div className="loop-part" key={label}>
                          <div
                            className={`loop-icon ${i === 3 ? "loop-highlight" : ""}`}
                          >
                            <Icon size={19} />
                          </div>
                          <span>{label}</span>
                          {i < 3 && (
                            <ArrowRight className="loop-arrow" size={13} />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="search-details">
                      <span>
                        Search method
                        <strong>
                          {snapshot.config.neural
                            ? "Neural + evolutionary"
                            : "Evolutionary only"}
                        </strong>
                      </span>
                      <span>
                        Population
                        <strong>{snapshot.config.population} programs</strong>
                      </span>
                      <span>
                        Training environments
                        <strong>
                          {snapshot.config.diverse
                            ? "Warehouse + terrain"
                            : "Warehouse"}
                        </strong>
                      </span>
                      <span>
                        Reproducible seed
                        <strong className="mono">{snapshot.config.seed}</strong>
                      </span>
                    </div>
                    <div className="search-bottom">
                      <Cpu size={14} />
                      <span>Runs entirely in your browser</span>
                      <span>
                        {(snapshot.elapsedMs / 1000).toFixed(1)}s compute
                      </span>
                    </div>
                  </section>
                </div>
                <section className="panel population-panel">
                  <div className="population-heading">
                    <div>
                      <h2>The candidate population</h2>
                      <p>Inspect the strongest programs in this generation.</p>
                    </div>
                    <div className="population-actions">
                      <button className="secondary-button" onClick={save}>
                        <Bookmark size={14} />
                        Save program
                      </button>
                      <button
                        className="icon-button"
                        title="Download experiment JSON"
                        aria-label="Download experiment JSON"
                        onClick={() => {
                          download(
                            `argos-experiment-seed-${snapshot.config.seed}.json`,
                            JSON.stringify(snapshot, null, 2),
                          );
                          notify("Experiment data exported.");
                        }}
                      >
                        <ArrowDownToLine size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>PROGRAM</th>
                          <th>ORIGIN</th>
                          <th>FITNESS</th>
                          <th>SUCCESS</th>
                          <th>ACTIVE NODES</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.leaders.map((c, rank) => (
                          <tr
                            key={`${rank}-${c.program.id}`}
                            className={
                              selectedRank === rank ? "selected-row" : ""
                            }
                          >
                            <td>
                              <span className="program-rank">
                                {String(rank + 1).padStart(2, "0")}
                              </span>
                              <Code2 size={14} />
                              <span className="mono">{c.program.id}</span>
                              {rank === 0 && (
                                <span className="best-label">BEST</span>
                              )}
                            </td>
                            <td>
                              <span
                                className={`origin-badge ${c.program.origin}`}
                              >
                                {c.program.origin === "neural" && (
                                  <Sparkles size={11} />
                                )}
                                {c.program.origin}
                              </span>
                            </td>
                            <td className="mono">{c.fitness.toFixed(2)}</td>
                            <td>{(c.success * 100).toFixed(0)}%</td>
                            <td>
                              {c.activeNodes}
                              <span className="muted">
                                {" "}
                                / {c.program.genes.length}
                              </span>
                            </td>
                            <td>
                              <button
                                className="inspect-button"
                                disabled={status === "running"}
                                onClick={() => {
                                  setSelectedRank(rank);
                                  setResults(null);
                                  transferWorker.current?.terminate();
                                  setTesting(false);
                                  notify(
                                    `Inspecting ${c.program.id} in the simulator and code view.`,
                                  );
                                }}
                              >
                                {selectedRank === rank ? "Viewing" : "Inspect"}
                                <ArrowUpRight size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <div className="research-note">
                  <span className="note-icon">
                    <BookOpen size={18} />
                  </span>
                  <p>
                    <strong>A different path to machine intelligence.</strong>{" "}
                    Inspired by Argos Research’s proposal for interpretable,
                    transferable AI. This is an independent, working prototype
                    of the search loop.
                  </p>
                  <button onClick={() => setShowMethod(true)}>
                    Explore the idea
                    <ArrowRight size={15} />
                  </button>
                </div>
              </>
            )}
            {tab === "transfer" && candidate && (
              <Transfer
                candidate={candidate}
                results={results}
                testing={testing}
                run={runTransfer}
                blocked={status === "running"}
              />
            )}
            {tab === "library" && candidate && (
              <section className="library-view">
                <div className="section-intro">
                  <div>
                    <span className="eyebrow">YOUR DISCOVERIES</span>
                    <h2>A collection of learned behaviors.</h2>
                    <p>
                      Saved locally in this browser. Export an experiment to
                      take it with you.
                    </p>
                  </div>
                  <button className="primary-button" onClick={save}>
                    <Plus size={16} />
                    Save current program
                  </button>
                </div>
                {library.length === 0 ? (
                  <div className="empty-library">
                    <div className="empty-library-icon">
                      <Bookmark size={29} />
                    </div>
                    <h3>Your next discovery belongs here.</h3>
                    <p>
                      Save a program from the experiment to compare it later,
                      <br />
                      replay its behavior, or export its code.
                    </p>
                    <button className="secondary-button" onClick={save}>
                      <Plus size={15} />
                      Save your first program
                    </button>
                  </div>
                ) : (
                  <div className="library-grid">
                    {library.map((run) => (
                      <article className="panel saved-card" key={run.id}>
                        <div className="saved-heading">
                          <span className="icon-square purple">
                            <Braces size={20} />
                          </span>
                          <button
                            className="icon-button"
                            title={`Remove ${run.name}`}
                            aria-label={`Remove ${run.name}`}
                            onClick={() => {
                              setLibrary((l) =>
                                l.filter((r) => r.id !== run.id),
                              );
                              notify(`${run.name} removed from the library.`);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <h3>{run.name}</h3>
                        <p>
                          Seed {run.snapshot.config.seed} · Generation{" "}
                          {run.snapshot.generation}
                        </p>
                        <pre>
                          {programLines(
                            (
                              run.snapshot.leaders[run.selectedRank ?? 0] ??
                              run.snapshot.best
                            ).program,
                          )
                            .slice(0, 5)
                            .map((l) => l.trim())
                            .join("\n")}
                        </pre>
                        <div className="saved-metrics">
                          <span>
                            Fitness
                            <strong>
                              {(
                                run.snapshot.leaders[run.selectedRank ?? 0] ??
                                run.snapshot.best
                              ).fitness.toFixed(1)}
                            </strong>
                          </span>
                          <span>
                            Success
                            <strong>
                              {(
                                (
                                  run.snapshot.leaders[run.selectedRank ?? 0] ??
                                  run.snapshot.best
                                ).success * 100
                              ).toFixed(0)}
                              %
                            </strong>
                          </span>
                          <span>
                            Nodes
                            <strong>
                              {
                                (
                                  run.snapshot.leaders[run.selectedRank ?? 0] ??
                                  run.snapshot.best
                                ).activeNodes
                              }
                            </strong>
                          </span>
                        </div>
                        <div className="saved-footer">
                          <button
                            className="text-button"
                            onClick={() =>
                              download(
                                `argos-${run.name.replaceAll(" ", "-").toLowerCase()}.json`,
                                JSON.stringify(run.snapshot, null, 2),
                              )
                            }
                          >
                            <Download size={14} />
                            Export
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => loadRun(run)}
                          >
                            Open program
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
        <footer className="site-footer">
          <div>
            <Logo />
            <span>Small programs. Open possibilities.</span>
          </div>
          <span>
            INDEPENDENT RESEARCH PROTOTYPE<span className="footer-dot">·</span>
            <button onClick={() => setShowMethod(true)}>
              About this lab
              <ArrowUpRight size={12} />
            </button>
          </span>
        </footer>
      </main>
      {showConfig && (
        <Configure
          config={config}
          close={() => setShowConfig(false)}
          apply={(next) => {
            setConfig(next);
            setShowConfig(false);
            notify(
              "Configuration saved. Start or restart an experiment to apply it.",
            );
          }}
        />
      )}
      {showMethod && <Methodology close={() => setShowMethod(false)} />}
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Check size={14} />
          </span>
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
