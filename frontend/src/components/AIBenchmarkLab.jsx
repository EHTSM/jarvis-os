import React, { useState, useEffect, useCallback } from "react";
import "./AIBenchmarkLab.css";

const BASE = process.env.REACT_APP_API_URL || "";

const DIM_LABELS = { speed: "Speed", quality: "Quality", cost: "Cost", reliability: "Reliability" };
const DIM_COLORS = { speed: "#4ade80", quality: "#7c6fff", cost: "#06b6d4", reliability: "#f59e0b" };

function MedalBadge({ rank }) {
  const medals = ["🥇","🥈","🥉"];
  return <span className="abl-medal">{medals[rank] || `#${rank+1}`}</span>;
}

function LeaderEntry({ entry, rank, dim }) {
  const color  = DIM_COLORS[dim] || "#7c6fff";
  const value  = dim === "speed"       ? `${Math.round(entry.avgLatency || 0)}ms`
               : dim === "quality"     ? `${Math.round(entry.avgQuality || 0)}/100`
               : dim === "cost"        ? `$${((entry.avgCost || 0) * 1000).toFixed(4)}/1K`
               :                        `${Math.round((entry.reliability || 0) * 100)}%`;
  const score  = Math.max(0, Math.min(100, (entry.score || 0) * 100));

  return (
    <div className="abl-entry">
      <MedalBadge rank={rank} />
      <span className="abl-entry-provider">{entry.providerId}</span>
      <div className="abl-entry-bar-wrap">
        <div className="abl-entry-bar" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="abl-entry-val" style={{ color }}>{value}</span>
      <span className="abl-entry-runs">{entry.runs} runs</span>
    </div>
  );
}

function MatrixCell({ data }) {
  if (!data) return <td className="abl-matrix-cell abl-matrix-cell--empty">—</td>;
  const scoreColor = data.qualityScore >= 80 ? "#4ade80" : data.qualityScore >= 50 ? "#f59e0b" : "#f87171";
  return (
    <td className={`abl-matrix-cell${data.success ? "" : " abl-matrix-cell--fail"}`}>
      <span style={{ color: scoreColor }}>{data.qualityScore || 0}</span>
      <span className="abl-matrix-lat">{data.latencyMs}ms</span>
      <span className="abl-matrix-cost">${(data.costUsd || 0).toFixed(5)}</span>
    </td>
  );
}

const DIMS = ["quality","speed","cost","reliability"];

export default function AIBenchmarkLab() {
  const [dim, setDim]          = useState("quality");
  const [board, setBoard]      = useState({});
  const [matrix, setMatrix]    = useState([]);
  const [running, setRunning]  = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [error, setError]      = useState(null);
  const [tab, setTab]          = useState("leaderboard");

  const load = useCallback(async () => {
    try {
      const [bR, mR] = await Promise.all([
        fetch(`${BASE}/ai-ecosystem/benchmark`,        { credentials: "include" }).then(r => r.json()),
        fetch(`${BASE}/ai-ecosystem/benchmark/matrix`, { credentials: "include" }).then(r => r.json()),
      ]);
      if (bR.leaderboard) setBoard(bR.leaderboard);
      if (mR.matrix)      setMatrix(mR.matrix);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runBench = async () => {
    setRunning(true); setError(null); setRunResult(null);
    try {
      const r = await fetch(`${BASE}/ai-ecosystem/benchmark/run`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      setRunResult(d);
      await load();
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  };

  const tasks = ["chat","code","reasoning"];

  return (
    <div className="abl-root">
      <div className="abl-header">
        <span className="abl-title">AI Benchmark Lab</span>
        <button className="abl-run-btn" onClick={runBench} disabled={running}>
          {running ? "⏳ Running…" : "▶ Run Suite"}
        </button>
        <button className="abl-refresh-btn" onClick={load}>↻</button>
      </div>

      <div className="abl-tabs">
        {[{ id: "leaderboard", label: "Leaderboard" }, { id: "matrix", label: "Matrix" }].map(t => (
          <button key={t.id} className={`abl-tab${tab === t.id ? " abl-tab--active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="abl-error">{error}</div>}

      {runResult && (
        <div className="abl-run-result">
          ✓ {runResult.count} benchmark runs completed
        </div>
      )}

      {tab === "leaderboard" && (
        <div className="abl-panel">
          <div className="abl-dim-tabs">
            {DIMS.map(d => (
              <button key={d} className={`abl-dim-tab${dim === d ? " abl-dim-tab--active" : ""}`}
                style={dim === d ? { color: DIM_COLORS[d], borderColor: DIM_COLORS[d] } : {}}
                onClick={() => setDim(d)}>
                {DIM_LABELS[d]}
              </button>
            ))}
          </div>

          <div className="abl-leaderboard">
            {(board[dim] || []).length === 0 && (
              <div className="abl-empty">No benchmark data yet. Run the suite above.</div>
            )}
            {(board[dim] || []).map((e, i) => (
              <LeaderEntry key={e.providerId} entry={e} rank={i} dim={dim} />
            ))}
          </div>
        </div>
      )}

      {tab === "matrix" && (
        <div className="abl-panel">
          <div className="abl-matrix-wrap">
            <table className="abl-matrix">
              <thead>
                <tr>
                  <th className="abl-matrix-th abl-matrix-th--provider">Provider</th>
                  {tasks.map(t => <th key={t} className="abl-matrix-th">{t}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.length === 0 && (
                  <tr><td colSpan={tasks.length + 1} className="abl-matrix-cell abl-matrix-cell--empty">Run benchmark to see results.</td></tr>
                )}
                {matrix.map(row => (
                  <tr key={row.providerId}>
                    <td className="abl-matrix-provider">{row.providerId}</td>
                    {tasks.map(t => <MatrixCell key={t} data={row[t]} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="abl-matrix-legend">
            <span>Score / Latency / Cost per run</span>
          </div>
        </div>
      )}
    </div>
  );
}
