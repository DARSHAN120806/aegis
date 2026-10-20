import { useRef, useState } from "react";
import { Play, Pause, RotateCcw, SkipForward } from "lucide-react";
import { login, request } from "./api";
import { scenarios } from "./simulation";
import { Surface } from "./components";
export default function DemoCenter({
  refresh,
  onMessage,
}: {
  refresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [scenario, setScenario] = useState(9),
    [cursor, setCursor] = useState(0),
    [running, setRunning] = useState(false),
    [busy, setBusy] = useState(false),
    [speed, setSpeed] = useState(1),
    [results, setResults] = useState<string[]>([]);
  const stop = useRef(true),
    position = useRef(0),
    lock = useRef(false);
  async function reset() {
    stop.current = true;
    setRunning(false);
    if (lock.current) return;
    setBusy(true);
    try {
      await login("admin");
      await request("/api/demo/reset", { method: "POST" });
      position.current = 0;
      setCursor(0);
      setResults([]);
      await refresh();
      onMessage("Demo reset. All generated records removed.");
    } catch (e) {
      onMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function step() {
    if (lock.current || position.current >= scenarios[scenario].steps.length)
      return false;
    lock.current = true;
    setBusy(true);
    const i = position.current,
      entry = scenarios[scenario].steps[i];
    try {
      await login(entry.persona);
      let wasDenied = false;
      try {
        await entry.run();
      } catch (e) {
        if (
          entry.denied &&
          e instanceof Error &&
          "status" in e &&
          (e.status === 403 || e.status === 401)
        ) {
          wasDenied = true;
        } else {
          throw e;
        }
      }
      if (entry.denied && !wasDenied)
        throw new Error("Security scenario failed: action was not blocked");
      setResults((old) => [
        ...old,
        `${entry.label}: ${wasDenied ? "blocked as expected" : "completed"}`,
      ]);
      position.current = i + 1;
      setCursor(i + 1);
      await login("admin");
      await refresh();
      return true;
    } catch (e) {
      stop.current = true;
      setRunning(false);
      onMessage(String(e));
      await login("admin");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function play() {
    if (!stop.current || lock.current) return;
    stop.current = false;
    setRunning(true);
    while (
      !stop.current &&
      position.current < scenarios[scenario].steps.length
    ) {
      if (!(await step())) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 / speed));
    }
    stop.current = true;
    setRunning(false);
  }
  return (
    <Surface
      title="Jury Demo Center"
      aside={<span className="mode-label">SIMULATED</span>}
    >
      <div className="demo-layout">
        <div>
          <label htmlFor="scenario">Scenario</label>
          <select
            id="scenario"
            value={scenario}
            disabled={busy || running || cursor > 0}
            onChange={(e) => setScenario(Number(e.target.value))}
          >
            {scenarios.map((s, i) => (
              <option value={i} key={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          {scenarios[scenario].note && (
            <p className="notice">{scenarios[scenario].note}</p>
          )}
          <div className="demo-controls">
            <button
              className="primary"
              onClick={play}
              disabled={
                busy || running || cursor === scenarios[scenario].steps.length
              }
            >
              <Play size={16} />
              Run journey
            </button>
            <button
              onClick={() => {
                stop.current = true;
                setRunning(false);
              }}
              disabled={!running}
            >
              <Pause size={16} />
              Pause
            </button>
            <button
              onClick={step}
              disabled={
                running || busy || cursor === scenarios[scenario].steps.length
              }
            >
              <SkipForward size={16} />
              Step
            </button>
            <button onClick={reset} disabled={busy || running}>
              <RotateCcw size={16} />
              Reset
            </button>
          </div>
          <label htmlFor="speed">Playback speed</label>
          <select
            id="speed"
            value={speed}
            disabled={running}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
          <p className="progress-copy">
            {cursor} / {scenarios[scenario].steps.length} steps completed
          </p>
          <progress
            max={scenarios[scenario].steps.length}
            value={cursor}
            aria-label="Journey progress"
          />
        </div>
        <ol className="journey-steps">
          {scenarios[scenario].steps.map((step, i) => (
            <li
              key={i}
              className={
                i < cursor ? "complete" : i === cursor ? "current" : ""
              }
            >
              <span>{i < cursor ? "✓" : i + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{results[i] || step.persona}</small>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Surface>
  );
}
