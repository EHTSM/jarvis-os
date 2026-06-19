/**
 * WorkspaceHealth — single dashboard showing:
 *  LSP status, Git status, AI usage, Pipeline, Deployment, Memory, Performance.
 * Reads from existing endpoints — no new runtime.
 */
import React, { useState, useEffect, useCallback } from "react";
import "./WorkspaceHealth.css";

const BASE = process.env.REACT_APP_API_URL || "";
const get  = (path) => fetch(`${BASE}${path}`, { credentials: "include" }).then(r => r.json()).catch(() => null);

function HealthGauge({ value = 0, label, color }) {
  const pct = Math.min(100, Math.max(0, value));
  const cls = pct >= 80 ? "ok" : pct >= 50 ? "warn" : "bad";
  return (
    <div className="wh-gauge">
      <div className="wh-gauge__bar">
        <div className="wh-gauge__fill" style={{ width: `${pct}%`, background: color || `var(--wh-${cls})` }} />
      </div>
      <div className="wh-gauge__meta">
        <span className="wh-gauge__label">{label}</span>
        <span className={`wh-gauge__pct wh-gauge__pct--${cls}`}>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

function StatusDot({ ok, unknown }) {
  const cls = unknown ? "unknown" : ok ? "ok" : "bad";
  return <span className={`wh-dot wh-dot--${cls}`} />;
}

function Section({ title, icon, children, score }) {
  const scoreClass = score >= 80 ? "ok" : score >= 50 ? "warn" : score != null ? "bad" : "";
  return (
    <div className="wh-section">
      <div className="wh-section__header">
        <span className="wh-section__icon">{icon}</span>
        <span className="wh-section__title">{title}</span>
        {score != null && <span className={`wh-section__score wh-score--${scoreClass}`}>{Math.round(score)}</span>}
      </div>
      <div className="wh-section__body">{children}</div>
    </div>
  );
}

function KV({ label, value, mono }) {
  return (
    <div className="wh-kv">
      <span className="wh-kv__label">{label}</span>
      <span className={`wh-kv__value${mono ? " wh-kv__value--mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

export default function WorkspaceHealth({ cwd, filePath }) {
  const [data,     setData]     = useState({});
  const [loading,  setLoading]  = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    const [obs, pipeline, mem, coding, billing] = await Promise.all([
      get("/observability"),
      get("/pipeline-runs?limit=1"),
      get("/engineering/memory?limit=1"),
      get("/coding/context"),
      get("/billing/status"),
    ]);

    // Git status via shell
    let gitStatus = null;
    if (window.electronAPI?.shellExec && cwd) {
      const r = await window.electronAPI.shellExec({ command: "git status --short && git log --oneline -1", cwd }).catch(() => null);
      gitStatus = r?.stdout || r?.output || null;
    }

    setData({ obs, pipeline, mem, coding, billing, gitStatus });
    setLastFetch(Date.now());
    setLoading(false);
  }, [cwd]);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(fetch_, 30000);
    return () => clearInterval(id);
  }, [fetch_]);

  const obs      = data.obs || {};
  const pipeline = Array.isArray(data.pipeline?.runs) ? data.pipeline.runs[0] : null;
  const coding   = data.coding || {};
  const billing  = data.billing || {};

  // Compute sub-scores
  const memScore  = Math.min(100, (obs.uptimeSeconds > 0 ? 90 : 50));
  const aiScore   = (coding.activeMission || coding.recentPatch) ? 92 : 75;
  const gitScore  = data.gitStatus !== null ? 85 : 50;
  const pipeScore = pipeline?.status === "success" ? 100 : pipeline?.status === "running" ? 70 : pipeline?.status === "failed" ? 20 : 60;
  const lspScore  = filePath ? 85 : 60;
  const overall   = Math.round((memScore + aiScore + gitScore + pipeScore + lspScore) / 5);

  return (
    <div className="wh-root">
      <div className="wh-top-bar">
        <div className="wh-overall">
          <span className="wh-overall__score" style={{ color: overall >= 80 ? "var(--success)" : overall >= 50 ? "var(--warning)" : "var(--danger)" }}>
            {overall}
          </span>
          <div>
            <div className="wh-overall__label">Workspace Health</div>
            <div className="wh-overall__sub">{lastFetch ? new Date(lastFetch).toLocaleTimeString() : "Loading…"}</div>
          </div>
        </div>
        <button className="wh-refresh" onClick={fetch_} disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      <HealthGauge value={overall} label="Overall" />

      <div className="wh-grid">

        <Section title="LSP" icon="TS" score={lspScore}>
          <KV label="Active file" value={filePath ? filePath.split("/").pop() : "None"} />
          <KV label="Status" value={filePath ? "Active" : "No file open"} />
          <KV label="Diagnostics" value={obs.diagnostics ?? 0} />
        </Section>

        <Section title="Git" icon="⬡" score={gitScore}>
          <KV label="CWD" value={cwd ? cwd.split("/").pop() : "None"} mono />
          <KV label="Status" value={data.gitStatus ? data.gitStatus.split("\n")[0] || "Clean" : "Unknown"} mono />
        </Section>

        <Section title="AI" icon="◈" score={aiScore}>
          <KV label="Active mission" value={coding.activeMission?.title || "None"} />
          <KV label="Recent patch" value={coding.recentPatch ? "Yes" : "None"} />
          <KV label="Code smells" value={coding.smells?.length ?? 0} />
          <KV label="Branch" value={coding.branch || "unknown"} mono />
        </Section>

        <Section title="Pipeline" icon="⚙" score={pipeScore}>
          <KV label="Last run" value={pipeline?.id || "None"} />
          <KV label="Status" value={pipeline?.status || "unknown"} />
          <KV label="Trigger" value={pipeline?.trigger || "—"} />
        </Section>

        <Section title="Memory" icon="◉" score={memScore}>
          <KV label="Uptime" value={obs.uptimeSeconds ? `${Math.floor(obs.uptimeSeconds / 60)}m` : "—"} />
          <KV label="Req/min" value={obs.requestsPerMinute?.toFixed(1) ?? "—"} />
          <KV label="Avg latency" value={obs.avgLatencyMs ? `${obs.avgLatencyMs}ms` : "—"} />
          <KV label="Error rate" value={obs.errorRate != null ? `${(obs.errorRate * 100).toFixed(1)}%` : "—"} />
        </Section>

        <Section title="Subscription" icon="★" score={billing.status === "active" || billing.status === "trialing" ? 90 : 40}>
          <KV label="Plan"   value={billing.plan || "trial"} />
          <KV label="Status" value={billing.status || "unknown"} />
          <KV label="Days left" value={billing.daysLeft ?? "∞"} />
        </Section>

      </div>
    </div>
  );
}
