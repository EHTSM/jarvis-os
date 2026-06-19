/**
 * PerformanceAudit — measure startup, memory, CPU, AI latency, repo indexing.
 * Reads from /metrics/perf-audit (new) + measures client-side timing.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./PerformanceAudit.css";

const BASE = process.env.REACT_APP_API_URL || "";

const SEV_COLOR = {
  high:   "var(--danger, #f55b5b)",
  medium: "var(--warning, #f0b429)",
  info:   "var(--accent2, #4ecdc4)",
  ok:     "var(--success, #52d68a)",
};

function RecBar({ label, value, unit, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="pa-bar">
      <div className="pa-bar__meta">
        <span className="pa-bar__label">{label}</span>
        <span className="pa-bar__value" style={{ color }}>{value}{unit}</span>
      </div>
      <div className="pa-bar__track">
        <div className="pa-bar__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Rec({ item }) {
  return (
    <div className="pa-rec" style={{ "--sev-color": SEV_COLOR[item.severity] || "var(--text-faint)" }}>
      <div className="pa-rec__dot" />
      <div className="pa-rec__body">
        <span className="pa-rec__area">{item.area}</span>
        <span className="pa-rec__text">{item.text}</span>
      </div>
    </div>
  );
}

export default function PerformanceAudit({ cwd }) {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [clientMs, setClientMs] = useState(null); // page load time

  const run = useCallback(async () => {
    setLoading(true);
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}/metrics/perf-audit`, { credentials: "include" });
      const d = await r.json();
      setData(d);
    } catch (e) {
      setData({ error: e.message });
    }
    setClientMs(Math.round(performance.now() - t0));
    setLoading(false);
  }, []);

  // Measure AI latency
  const [aiLatency, setAiLatency] = useState(null);
  const pingAI = useCallback(async () => {
    const t0 = performance.now();
    try {
      await fetch(`${BASE}/coding/context`, { credentials: "include" });
      setAiLatency(Math.round(performance.now() - t0));
    } catch { setAiLatency(-1); }
  }, []);

  // Measure repo index time
  const [indexMs, setIndexMs] = useState(null);
  const benchIndex = useCallback(async () => {
    if (!cwd || !window.electronAPI?.shellExec) { setIndexMs(-1); return; }
    const t0 = performance.now();
    try {
      await window.electronAPI.shellExec({ command: "find . -name '*.js' -o -name '*.ts' | head -200", cwd });
      setIndexMs(Math.round(performance.now() - t0));
    } catch { setIndexMs(-1); }
  }, [cwd]);

  useEffect(() => {
    run();
    pingAI();
    benchIndex();
  }, []); // eslint-disable-line

  const proc = data?.process || {};
  const api  = data?.api     || {};
  const recs = data?.recommendations || [];
  const score = data?.score ?? null;

  const aiColor   = aiLatency == null ? "var(--text-faint)" : aiLatency < 200 ? "var(--success)" : aiLatency < 500 ? "var(--warning)" : "var(--danger)";
  const memColor  = proc.heapUsedMB > 300 ? "var(--danger)" : proc.heapUsedMB > 150 ? "var(--warning)" : "var(--success)";
  const apiColor  = api.avgLatencyMs > 500 ? "var(--danger)" : api.avgLatencyMs > 200 ? "var(--warning)" : "var(--success)";

  return (
    <div className="pa-root">
      <div className="pa-header">
        <div className="pa-header__left">
          <span className="pa-title">Performance Audit</span>
          {score != null && (
            <span className="pa-score" style={{ color: score >= 80 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--danger)" }}>
              {score}/100
            </span>
          )}
        </div>
        <button className="pa-run-btn" onClick={run} disabled={loading}>
          {loading ? "Running…" : "▶ Run audit"}
        </button>
      </div>

      {data?.error && <div className="pa-error">{data.error}</div>}

      {/* Client-side measurements */}
      <div className="pa-section">
        <div className="pa-section-label">Client measurements</div>
        <RecBar label="API round-trip"  value={clientMs ?? "—"}       unit="ms" max={1000} color={clientMs > 500 ? "var(--danger)" : "var(--success)"} />
        <RecBar label="AI context ping" value={aiLatency ?? "—"}      unit="ms" max={1000} color={aiColor} />
        <RecBar label="Repo index scan" value={indexMs === -1 ? "N/A" : indexMs ?? "—"} unit={indexMs === -1 ? "" : "ms"} max={500} color="var(--accent2)" />
      </div>

      {/* Server-side measurements */}
      {proc.heapUsedMB != null && (
        <div className="pa-section">
          <div className="pa-section-label">Server process</div>
          <RecBar label="Heap used"   value={proc.heapUsedMB} unit="MB" max={512} color={memColor} />
          <RecBar label="RSS memory"  value={proc.rssMB}      unit="MB" max={1024} color="var(--accent2)" />
          <RecBar label="Uptime"      value={Math.round((proc.uptimeMs || 0) / 60000)} unit="min" max={1440} color="var(--text-faint)" />
        </div>
      )}

      {api.avgLatencyMs != null && (
        <div className="pa-section">
          <div className="pa-section-label">API performance</div>
          <RecBar label="Avg latency"  value={api.avgLatencyMs}       unit="ms"   max={1000} color={apiColor} />
          <RecBar label="P95 latency"  value={api.p95LatencyMs}       unit="ms"   max={2000} color="var(--accent)" />
          <RecBar label="Req/min"      value={api.requestsPerMinute?.toFixed(1)} unit="" max={100} color="var(--text-faint)" />
          <RecBar label="Error rate"   value={((api.errorRate || 0) * 100).toFixed(1)} unit="%" max={20} color={api.errorRate > 0.05 ? "var(--danger)" : "var(--success)"} />
        </div>
      )}

      {/* Recommendations */}
      {recs.length > 0 && (
        <div className="pa-section">
          <div className="pa-section-label">Recommendations</div>
          {recs.map((r, i) => <Rec key={i} item={r} />)}
        </div>
      )}
    </div>
  );
}
