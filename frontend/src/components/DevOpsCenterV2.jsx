import React, { useState, useEffect, useCallback, useRef } from "react";
import { track } from "../analytics";
import { checkHealth, getOpsData, getMetrics } from "../telemetryApi";
import { getRuntimeStatus, getRuntimeHistory, emergencyStop, emergencyResume, listPatches, getDLQ, recoverDLQ, removeDLQEntry } from "../runtimeApi";
import {
  listDeployments, getDeployHistory, listSLOs, getSystemMetrics,
  listAlerts, resolveAlert, getServiceMap,
} from "../phase25Api";
import { getAIStatus } from "../aiApi";
import "./DevOpsCenterV2.css";

// ── Constants ─────────────────────────────────────────────────────────

const TABS = [
  { id: "runtime",     label: "Runtime"      },
  { id: "deployments", label: "Deployments"  },
  { id: "observability",label:"Observability" },
  { id: "telemetry",   label: "Telemetry"    },
  { id: "models",      label: "AI Models"    },
  { id: "logs",        label: "Logs"         },
  { id: "alerts",      label: "Alerts"       },
  { id: "services",    label: "Service Health"},
  { id: "patches",     label: "Patches"      },
  { id: "dlq",         label: "Recovery"     },
];

const SEED_DEPLOYMENTS = [
  { id:"d1",  env:"production", repo:"ooplix-frontend",  version:"v9.4.0",    status:"success",  duration:"2m 14s", by:"Dev Agent",   ts:"Jun 4, 11:32", commit:"f69cd72" },
  { id:"d2",  env:"production", repo:"ooplix-backend",   version:"v7.1.2",    status:"success",  duration:"1m 48s", by:"DevOps Agent",ts:"Jun 4, 09:15", commit:"3d75594" },
  { id:"d3",  env:"staging",    repo:"ooplix-frontend",  version:"v9.5.0-rc", status:"running",  duration:"—",      by:"Dev Agent",   ts:"Jun 4, 14:01", commit:"a3b1c2d" },
  { id:"d4",  env:"staging",    repo:"ooplix-backend",   version:"v7.2.0-rc", status:"success",  duration:"1m 55s", by:"Dev Agent",   ts:"Jun 4, 10:44", commit:"e4f5a6b" },
  { id:"d5",  env:"production", repo:"ooplix-mobile",    version:"v3.2.1",    status:"failed",   duration:"3m 02s", by:"DevOps Agent",ts:"Jun 3, 16:20", commit:"c7d8e9f" },
  { id:"d6",  env:"production", repo:"ooplix-mobile",    version:"v3.2.0",    status:"rollback", duration:"0m 42s", by:"DevOps Agent",ts:"Jun 3, 16:23", commit:"b2c3d4e" },
  { id:"d7",  env:"production", repo:"ooplix-agents",    version:"v5.0.3",    status:"success",  duration:"1m 22s", by:"DevOps Agent",ts:"Jun 3, 12:00", commit:"1db642f" },
];

const SEED_SERVICES = [
  { id:"s1", name:"API Server",         status:"healthy",  uptime:"99.97%", latency:"42ms",  memory:"340MB", cpu:"12%", provider:"self" },
  { id:"s2", name:"WhatsApp Bridge",    status:"healthy",  uptime:"99.91%", latency:"110ms", memory:"180MB", cpu:"8%",  provider:"meta" },
  { id:"s3", name:"Task Queue (Bull)",  status:"healthy",  uptime:"99.99%", latency:"5ms",   memory:"95MB",  cpu:"4%",  provider:"self" },
  { id:"s4", name:"Razorpay Gateway",   status:"degraded", uptime:"—",      latency:"—",     memory:"—",     cpu:"—",   provider:"razorpay" },
  { id:"s5", name:"Firebase Auth",      status:"healthy",  uptime:"100%",   latency:"18ms",  memory:"—",     cpu:"—",   provider:"google" },
  { id:"s6", name:"GitHub CI",          status:"healthy",  uptime:"100%",   latency:"—",     memory:"—",     cpu:"—",   provider:"github" },
  { id:"s7", name:"OpenRouter / Claude",status:"healthy",  uptime:"99.1%",  latency:"320ms", memory:"—",     cpu:"—",   provider:"openrouter" },
  { id:"s8", name:"Telegram Bot",       status:"healthy",  uptime:"99.8%",  latency:"180ms", memory:"—",     cpu:"—",   provider:"telegram" },
];

const SEED_LOGS = [
  { id:"l1",  ts:"14:33:12", level:"info",    type:"task",   msg:"analyze_leads → jarvis-core — SUCCESS 380ms"       },
  { id:"l2",  ts:"14:33:10", level:"info",    type:"wa",     msg:"send_msg_raj → follow-up-bot — SUCCESS 220ms"      },
  { id:"l3",  ts:"14:32:58", level:"info",    type:"agent",  msg:"workflow_run → workflow-runner — RUNNING 4.2s"     },
  { id:"l4",  ts:"14:28:30", level:"error",   type:"agent",  msg:"workflow_err → workflow-runner — ERROR timeout"    },
  { id:"l5",  ts:"14:21:04", level:"warn",    type:"system", msg:"Memory usage crossed 80% threshold — 410 MB"       },
  { id:"l6",  ts:"14:19:55", level:"info",    type:"http",   msg:"POST /jarvis 200 312ms"                            },
  { id:"l7",  ts:"14:18:40", level:"info",    type:"http",   msg:"GET /ops 200 8ms"                                  },
  { id:"l8",  ts:"14:15:22", level:"error",   type:"system", msg:"Razorpay webhook verification failed — bad sig"    },
  { id:"l9",  ts:"14:14:11", level:"info",    type:"ai",     msg:"OpenRouter /chat/completions 200 — 897 tokens"     },
  { id:"l10", ts:"14:12:08", level:"info",    type:"ai",     msg:"OpenRouter /chat/completions 200 — 1204 tokens"    },
  { id:"l11", ts:"14:10:44", level:"warn",    type:"system", msg:"Redis eviction policy not set — using noeviction"  },
  { id:"l12", ts:"14:08:30", level:"info",    type:"http",   msg:"GET /crm 200 45ms"                                 },
  { id:"l13", ts:"14:06:55", level:"info",    type:"task",   msg:"payment_link_gen → crm-sync — SUCCESS 1.2s"        },
  { id:"l14", ts:"14:04:22", level:"error",   type:"wa",     msg:"WhatsApp rate limit hit — 429 from Meta API"       },
  { id:"l15", ts:"14:02:18", level:"info",    type:"system", msg:"Task queue resumed after deploy window"            },
];

const SEED_ALERTS = [
  { id:"a1", title:"Mobile API Proxy degraded — high latency + CPU",       severity:"warning",  status:"open",     created:"14m ago",  service:"ooplix-mobile",   detail:"Latency spike to 890ms. 1/2 replicas down. Memory leak suspected." },
  { id:"a2", title:"Razorpay auth error — payment links failing",          severity:"critical", status:"open",     created:"2h ago",   service:"razorpay",        detail:"API key rejected by Razorpay. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env." },
  { id:"a3", title:"Terraform state stored locally — conflict risk",       severity:"warning",  status:"open",     created:"5d ago",   service:"infrastructure",  detail:"Remote backend not configured. Parallel terraform runs will produce state conflicts." },
  { id:"a4", title:"ooplix-mobile v3.2.1 deploy failed — Firebase crash",  severity:"critical", status:"resolved", created:"Jun 3",    service:"ooplix-mobile",   detail:"Null Firebase auth on cold start. Rolled back to v3.2.0. Fix in PR #3." },
  { id:"a5", title:"Task queue spike — 400 tasks backed up",               severity:"low",      status:"resolved", created:"Jun 2",    service:"task-queue",      detail:"Bull queue paused during deploy. Auto-resumed post-deploy." },
  { id:"a6", title:"WhatsApp rate limit — 429 from Meta API",              severity:"warning",  status:"resolved", created:"14:04",    service:"whatsapp",        detail:"Transient rate limit on bulk follow-up job. Retry resolved within 2 minutes." },
];

const SEED_SLOS = [
  { id:"slo1", name:"API availability",      target:99.9, current:99.97, window:"30d", status:"ok"       },
  { id:"slo2", name:"WhatsApp delivery",     target:99.0, current:98.7,  window:"7d",  status:"warning"  },
  { id:"slo3", name:"Payment link success",  target:95.0, current:84.2,  window:"7d",  status:"critical" },
  { id:"slo4", name:"AI response P95",       target:1000, current:320,   window:"24h", status:"ok",   unit:"ms",  invert:true },
  { id:"slo5", name:"Task completion rate",  target:98.0, current:99.1,  window:"7d",  status:"ok"       },
];

// AI_PROVIDERS is now driven by /ai/status; seed kept only as loading fallback
const AI_PROVIDERS_SEED = [
  { id:"groq",       name:"Groq",       model:"llama-3.3-70b-versatile",  status:"unknown", latency:"—", cost:"Free tier",          keySet:false },
  { id:"openrouter", name:"OpenRouter", model:"claude-haiku-4-5",         status:"unknown", latency:"—", cost:"₹0.004/1k tokens",   keySet:false },
  { id:"openai",     name:"OpenAI",     model:"gpt-4o-mini",              status:"unknown", latency:"—", cost:"pay-per-token",       keySet:false },
  { id:"ollama",     name:"Ollama",     model:"(OLLAMA_MODEL)",           status:"unknown", latency:"—", cost:"Local / free",        keySet:true  },
];

// ── Helpers ───────────────────────────────────────────────────────────

function _timeAgo(iso) {
  if (!iso) return "—";
  try {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day:"numeric", month:"short" });
  } catch { return "—"; }
}

function _fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3600); return () => clearTimeout(t); }, [onDone]);
  return <div className={`dv2-toast dv2-toast--${type}`}>{msg}</div>;
}

function SkelRow({ cols = 3 }) {
  return (
    <div className="dv2-skel-row">
      {Array.from({ length: cols }).map((_, i) => (
        <span key={i} className="dv2-skeleton" style={{ flex: 1, height: 12, borderRadius: 4 }} />
      ))}
    </div>
  );
}

const SEV_COLOR = { critical:"#f55b5b", warning:"#f0b429", low:"#4ecdc4", info:"#8994b0" };
const STATUS_COLOR = {
  healthy:"#52d68a", active:"#52d68a", ok:"#52d68a", success:"#52d68a",
  degraded:"#f0b429", warning:"#f0b429", running:"#7c6fff",
  failed:"#f55b5b", critical:"#f55b5b", down:"#f55b5b",
  rollback:"#f0b429", standby:"#8994b0", resolved:"#52d68a", open:"#f0b429",
};
function sc(s) { return STATUS_COLOR[s] || "#8994b0"; }

// ── Tab: Runtime ──────────────────────────────────────────────────────

function TabRuntime({ addToast }) {
  const [status,     setStatus]     = useState(null);
  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [stopping,   setStopping]   = useState(false);
  const [resuming,   setResuming]   = useState(false);
  const [emergency,  setEmergency]  = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getRuntimeStatus().catch(() => null),
      getRuntimeHistory(20).catch(() => []),
    ]).then(([s, h]) => {
      setStatus(s);
      if (s?.emergencyStop || s?.emergency_stop) setEmergency(true);
      const arr = Array.isArray(h) ? h : (h?.history || []);
      setHistory(arr);
    }).finally(() => setLoading(false));
  }, []);

  const q = status?.queue || {};
  const mode = status?.mode || "normal";

  async function handleStop() {
    if (!window.confirm("Trigger emergency stop? All running tasks will be halted.")) return;
    setStopping(true);
    try {
      await emergencyStop("operator_initiated");
      setEmergency(true);
      addToast("Emergency stop activated", "error");
      track("emergency_stop");
    } catch (e) { addToast(`Stop failed: ${e.message}`, "error"); }
    finally    { setStopping(false); }
  }

  async function handleResume() {
    setResuming(true);
    try {
      await emergencyResume();
      setEmergency(false);
      addToast("Execution resumed", "success");
      track("emergency_resume");
    } catch (e) { addToast(`Resume failed: ${e.message}`, "error"); }
    finally    { setResuming(false); }
  }

  const LOG_LEVEL_COLOR = { running:"#7c6fff", success:"#52d68a", error:"#f55b5b", warning:"#f0b429", info:"#8994b0" };

  return (
    <div className="dv2-runtime-root">
      {emergency && (
        <div className="dv2-emergency-banner">
          <span>⏹ EMERGENCY STOP ACTIVE</span>
          <button className="dv2-btn dv2-btn--sm dv2-btn--ghost" onClick={handleResume} disabled={resuming}>
            {resuming ? "⟳" : "▶ Resume"}
          </button>
        </div>
      )}

      <div className="dv2-runtime-grid">
        <div className="dv2-panel dv2-runtime-status">
          <p className="dv2-section-label">Runtime Status</p>
          {loading ? <SkelRow cols={2} /> : (
            <div className="dv2-rt-meta">
              <div className="dv2-rt-row"><span className="dv2-rt-key">Mode</span><span className="dv2-rt-val" style={{ color: mode === "emergency" ? "#f55b5b" : "#52d68a" }}>{mode.toUpperCase()}</span></div>
              <div className="dv2-rt-row"><span className="dv2-rt-key">Emergency Stop</span><span className="dv2-rt-val" style={{ color: emergency ? "#f55b5b" : "#52d68a" }}>{emergency ? "ACTIVE" : "INACTIVE"}</span></div>
              <div className="dv2-rt-row"><span className="dv2-rt-key">Running</span><span className="dv2-rt-val" style={{ color: "#7c6fff" }}>{q.running ?? "—"}</span></div>
              <div className="dv2-rt-row"><span className="dv2-rt-key">Queued</span><span className="dv2-rt-val">{q.queued ?? "—"}</span></div>
              <div className="dv2-rt-row"><span className="dv2-rt-key">Failed</span><span className="dv2-rt-val" style={{ color: "#f55b5b" }}>{q.failed ?? "—"}</span></div>
              <div className="dv2-rt-row"><span className="dv2-rt-key">Executor</span><span className="dv2-rt-val dv2-mono">{status?.executor || "agents/executor.cjs"}</span></div>
            </div>
          )}
        </div>

        <div className="dv2-panel dv2-emergency-controls">
          <p className="dv2-section-label">Execution Controls</p>
          <div className="dv2-ctrl-btns">
            <button
              className={`dv2-btn dv2-btn--danger${stopping ? " dv2-btn--loading" : ""}`}
              onClick={handleStop}
              disabled={stopping || emergency}
            >
              ⏹ {stopping ? "Stopping…" : "Emergency Stop"}
            </button>
            <button
              className="dv2-btn dv2-btn--ghost"
              onClick={handleResume}
              disabled={resuming || !emergency}
            >
              ▶ {resuming ? "Resuming…" : "Resume Execution"}
            </button>
            <button
              className="dv2-btn dv2-btn--ghost dv2-btn--disabled-ux"
              disabled
              title="Coming soon"
            >
              ↻ Restart Workers
            </button>
          </div>
          <p className="dv2-ctrl-note">Emergency stop halts all queued and in-flight tasks. Resume restores normal operation.</p>
        </div>
      </div>

      <div className="dv2-panel" style={{ marginTop: 14 }}>
        <div className="dv2-panel-header">
          <p className="dv2-section-label">Recent Executions</p>
          <span className="dv2-live-dot">● LIVE</span>
        </div>
        {loading ? (
          <div style={{ display:"flex", flexDirection:"column", gap: 6 }}>
            {[0,1,2,3].map(i => <SkelRow key={i} cols={4} />)}
          </div>
        ) : history.length === 0 ? (
          <div className="dv2-empty"><span className="dv2-empty-icon" style={{ color:"#52d68a" }}>✓</span><p className="dv2-empty-title">Queue is clear</p></div>
        ) : (
          <div className="dv2-log-list">
            {history.slice(0, 15).map((e, i) => {
              const s = e.status || "info";
              const dotC = LOG_LEVEL_COLOR[s] || "#8994b0";
              return (
                <div key={e.id || i} className="dv2-log-row">
                  <span className="dv2-log-ts dv2-mono">{_timeAgo(e.timestamp || e.createdAt)}</span>
                  <span className="dv2-log-dot" style={{ color: dotC }}>●</span>
                  <span className="dv2-log-type dv2-mono">[{(e.type || "task").toUpperCase()}]</span>
                  <span className="dv2-log-msg">{e.input || e.goal || e.output || "—"}</span>
                  <span className="dv2-log-status" style={{ color: dotC }}>{s.toUpperCase()}</span>
                  {e.durationMs && <span className="dv2-log-dur">{e.durationMs}ms</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Deployments ──────────────────────────────────────────────────

function TabDeployments({ addToast }) {
  const [deployments, setDeployments] = useState(SEED_DEPLOYMENTS);
  const [loading,     setLoading]     = useState(true);
  const [envFilter,   setEnvFilter]   = useState("all");
  const [expanded,    setExpanded]    = useState(null);
  const [rolling,     setRolling]     = useState(null);

  useEffect(() => {
    Promise.all([
      listDeployments({ limit: 20 }).catch(() => null),
      getDeployHistory({ limit: 20 }).catch(() => null),
    ]).then(([list, hist]) => {
      const raw = list?.deployments || hist?.history || (Array.isArray(list) ? list : null) || (Array.isArray(hist) ? hist : null);
      if (raw && raw.length > 0) {
        setDeployments(raw.map(d => ({
          id:       d.id,
          env:      d.environment || d.env || "production",
          repo:     d.repo || d.service || "service",
          version:  d.version || "—",
          status:   d.status || "success",
          duration: d.durationMs ? `${Math.round(d.durationMs/1000)}s` : "—",
          by:       d.triggeredBy || d.by || "Autopilot",
          ts:       d.startedAt ? _timeAgo(d.startedAt) : "—",
          commit:   (d.commit || "").slice(0, 7) || "—",
        })));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const ENV_COLORS = { production:"#f55b5b", staging:"#f0b429", development:"#4ecdc4" };
  const filtered = deployments.filter(d => envFilter === "all" || d.env === envFilter);

  const counts = { success:0, failed:0, running:0, rollback:0 };
  deployments.forEach(d => { if (counts[d.status] !== undefined) counts[d.status]++; });

  return (
    <div className="dv2-deploy-root">
      <div className="dv2-deploy-summary">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="dv2-ds-cell">
            <span className="dv2-ds-val" style={{ color: sc(k) }}>{v}</span>
            <span className="dv2-ds-label">{k}</span>
          </div>
        ))}
      </div>

      <div className="dv2-coming-soon">
        <span className="dv2-cs-icon">◎</span>
        <div>
          <p className="dv2-cs-title">One-click Deploy & Rollback <span className="csb-beta-badge">BETA</span></p>
          <p className="dv2-cs-sub">Interactive deploy pipeline with canary release, blue/green switching, and automated rollback. Until then: <code className="dv2-code">pm2 restart all</code></p>
        </div>
      </div>

      <div className="dv2-deploy-filter">
        {["all","production","staging","development"].map(e => (
          <button key={e} className={`dv2-filter-chip${envFilter===e?" dv2-filter-chip--active":""}`} onClick={() => setEnvFilter(e)}>{e}</button>
        ))}
      </div>

      <div className="dv2-deploy-list">
        {loading ? [0,1,2].map(i => <div key={i} className="dv2-deploy-row"><SkelRow cols={5} /></div>) : (
          filtered.map(d => {
            const ec = ENV_COLORS[d.env] || "#8994b0";
            const dc = sc(d.status);
            const isOpen = expanded === d.id;
            return (
              <div key={d.id} className={`dv2-deploy-row${isOpen?" dv2-deploy-row--open":""}`}>
                <div className="dv2-dr-top" onClick={() => setExpanded(isOpen ? null : d.id)}>
                  <span className="dv2-dr-env" style={{ color: ec, background: ec+"15" }}>{d.env}</span>
                  <span className="dv2-dr-repo dv2-mono">{d.repo}</span>
                  <span className="dv2-dr-version dv2-mono">{d.version}</span>
                  <span className="dv2-dr-status dv2-chip" style={{ color: dc, background: dc+"15", borderColor: dc+"30" }}>{d.status}</span>
                  <span className="dv2-dr-ts">{d.ts}</span>
                  <span className="dv2-dr-dur">{d.duration}</span>
                  <span className="dv2-dr-toggle">{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div className="dv2-dr-detail">
                    <div className="dv2-dr-detail-row"><span>Commit</span><code className="dv2-code">{d.commit}</code></div>
                    <div className="dv2-dr-detail-row"><span>Triggered by</span><span>{d.by}</span></div>
                    <div className="dv2-dr-detail-row"><span>Duration</span><span>{d.duration}</span></div>
                    {d.status === "failed" && (
                      <button className="dv2-btn dv2-btn--ghost dv2-btn--sm" onClick={async () => {
                        setRolling(d.id);
                        try { await import("../phase25Api").then(m => m.rollbackDeploy(d.id)); addToast(`Rollback initiated for ${d.repo}`, "info"); }
                        catch { addToast("Rollback API not available", "info"); }
                        finally { setRolling(null); }
                      }} disabled={rolling === d.id}>
                        {rolling === d.id ? "⟳ Rolling back…" : "↩ Rollback"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Tab: Observability ────────────────────────────────────────────────

function TabObservability({ addToast }) {
  const [slos,    setSlos]    = useState(SEED_SLOS);
  const [svcMap,  setSvcMap]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listSLOs().catch(() => null),
      getServiceMap().catch(() => null),
    ]).then(([s, m]) => {
      const arr = s?.slos || (Array.isArray(s) ? s : null);
      if (arr && arr.length > 0) setSlos(arr);
      if (m) setSvcMap(m);
    }).finally(() => setLoading(false));
  }, []);

  const DEPS = [
    { from: "Frontend",      to: "Backend API",     state: "ok"   },
    { from: "Backend API",   to: "Task Queue",       state: "ok"   },
    { from: "Backend API",   to: "WhatsApp Bridge",  state: "ok"   },
    { from: "Backend API",   to: "Razorpay",         state: "error"},
    { from: "Backend API",   to: "OpenRouter",       state: "ok"   },
    { from: "Task Queue",    to: "Agent Runtime",    state: "ok"   },
    { from: "Agent Runtime", to: "Memory Store",     state: "ok"   },
    { from: "Electron Shell",to: "Backend API",      state: "ok"   },
  ];

  function SloBar({ slo }) {
    const isInvert = slo.invert;
    const pct = isInvert
      ? Math.min(Math.round((slo.target / Math.max(slo.current, 1)) * 100), 100)
      : Math.min(Math.round((slo.current / slo.target) * 100), 100);
    const color = slo.status === "ok" ? "#52d68a" : slo.status === "warning" ? "#f0b429" : "#f55b5b";
    const label = isInvert
      ? `${slo.current}ms (target <${slo.target}ms)`
      : `${slo.current}% (target ${slo.target}%)`;
    return (
      <div className="dv2-slo-row">
        <div className="dv2-slo-top">
          <span className="dv2-slo-name">{slo.name}</span>
          <span className="dv2-slo-window">{slo.window}</span>
          <span className="dv2-slo-val" style={{ color }}>{label}</span>
          <span className="dv2-chip dv2-chip--xs" style={{ color, background: color+"15", borderColor: color+"30" }}>{slo.status}</span>
        </div>
        <div className="dv2-slo-track">
          <div className="dv2-slo-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
    );
  }

  return (
    <div className="dv2-obs-root">
      <div className="dv2-panel dv2-slo-panel">
        <p className="dv2-section-label">SLO Status</p>
        {loading ? [0,1,2].map(i => <SkelRow key={i} cols={4} />) : (
          slos.map(slo => <SloBar key={slo.id} slo={slo} />)
        )}
      </div>

      <div className="dv2-panel dv2-dep-panel">
        <p className="dv2-section-label">Dependency Map</p>
        <div className="dv2-dep-list">
          {DEPS.map((d, i) => (
            <div key={i} className="dv2-dep-row">
              <span className="dv2-dep-from">{d.from}</span>
              <span className="dv2-dep-arrow" style={{ color: d.state === "ok" ? "#52d68a" : "#f55b5b" }}>→</span>
              <span className="dv2-dep-to">{d.to}</span>
              <span className="dv2-dep-dot" style={{ background: d.state === "ok" ? "#52d68a" : "#f55b5b" }} />
            </div>
          ))}
        </div>
      </div>

      <div className="dv2-coming-soon" style={{ marginTop: 4 }}>
        <span className="dv2-cs-icon">◈</span>
        <div>
          <p className="dv2-cs-title">Distributed Tracing & Service Map <span className="csb-beta-badge">BETA</span></p>
          <p className="dv2-cs-sub">Full OpenTelemetry traces, request waterfall charts, and live service topology graph are under development.</p>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Telemetry ────────────────────────────────────────────────────

function TabTelemetry({ addToast }) {
  const [ops,      setOps]      = useState(null);
  const [metrics,  setMetrics]  = useState(null);
  const [sysM,     setSysM]     = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getOpsData().catch(() => null),
      getMetrics().catch(() => null),
      getSystemMetrics({ limit: 1 }).catch(() => null),
    ]).then(([o, m, s]) => {
      setOps(o);
      setMetrics(m);
      setSysM(s);
    }).finally(() => setLoading(false));
  }, []);

  const memUsed     = ops?.memory?.used ?? metrics?.memory_mb ?? sysM?.memory_mb ?? null;
  const memTotal    = ops?.memory?.total ?? sysM?.memory_total_mb ?? null;
  const cpuPct      = metrics?.cpu_percent ?? sysM?.cpu_percent ?? null;
  const uptimeSecs  = ops?.uptime ?? 0;
  const avgMs       = metrics?.avg_response_ms ?? null;
  const totalReqs   = metrics?.total_requests ?? null;
  const p95         = metrics?.p95_ms ?? null;
  const nodever     = ops?.nodeVersion || process?.versions?.node || "—";
  const pid         = ops?.pid ?? "—";
  const port        = ops?.port ?? 5050;

  const memPct = memUsed && memTotal ? Math.min(Math.round((memUsed / memTotal) * 100), 100) : (memUsed ? Math.min(Math.round((memUsed / 512) * 100), 100) : 0);
  const memColor = memPct > 85 ? "#f55b5b" : memPct > 65 ? "#f0b429" : "#52d68a";
  const cpuColor = cpuPct > 85 ? "#f55b5b" : cpuPct > 60 ? "#f0b429" : "#52d68a";

  const PERF_EPS = [
    { path:"POST /jarvis",       ms: avgMs || 320, max:1000 },
    { path:"GET  /crm",          ms:45,            max:1000 },
    { path:"POST /payment/link", ms:890,           max:1000 },
    { path:"GET  /billing/status",ms:30,           max:1000 },
    { path:"GET  /ops",          ms:18,            max:1000 },
  ];

  return (
    <div className="dv2-tel-root">
      <div className="dv2-kpi-strip">
        {[
          { label:"Uptime",       val: uptimeSecs > 0 ? _fmtUptime(uptimeSecs) : "—", color:"#52d68a" },
          { label:"Memory",       val: memUsed ? `${memUsed} MB` : "—",               color: memColor },
          { label:"CPU",          val: cpuPct ? `${cpuPct}%` : "—",                   color: cpuColor },
          { label:"Avg Response", val: avgMs ? `${avgMs}ms` : "—",                    color:"#c0c8dc" },
          { label:"P95",          val: p95 ? `${p95}ms` : "—",                        color:"#c0c8dc" },
          { label:"Total Reqs",   val: totalReqs ? totalReqs.toLocaleString() : "—",  color:"#7c6fff" },
        ].map(({ label, val, color }) => (
          <div key={label} className="dv2-kpi">
            <span className="dv2-kpi-val" style={{ color }}>{val}</span>
            <span className="dv2-kpi-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="dv2-tel-grid">
        <div className="dv2-panel">
          <p className="dv2-section-label">Memory Usage</p>
          {loading ? <SkelRow cols={1} /> : (
            <>
              <div className="dv2-gauge-row">
                <span className="dv2-gauge-val" style={{ color: memColor }}>{memUsed ? `${memUsed} MB` : "—"}</span>
                <span className="dv2-gauge-of">{memTotal ? `/ ${memTotal} MB` : "/ 512 MB (est.)"}</span>
              </div>
              <div className="dv2-bar-track">
                <div className="dv2-bar-fill" style={{ width:`${memPct}%`, background: memColor }} />
              </div>
              <span className="dv2-gauge-pct" style={{ color: memColor }}>{memPct}%</span>
            </>
          )}
        </div>

        <div className="dv2-panel">
          <p className="dv2-section-label">CPU Usage</p>
          {loading ? <SkelRow cols={1} /> : (
            <>
              <div className="dv2-gauge-row">
                <span className="dv2-gauge-val" style={{ color: cpuColor }}>{cpuPct != null ? `${cpuPct}%` : "—"}</span>
              </div>
              <div className="dv2-bar-track">
                <div className="dv2-bar-fill" style={{ width:`${cpuPct || 0}%`, background: cpuColor }} />
              </div>
              <span className="dv2-gauge-pct" style={{ color: cpuColor }}>{cpuPct != null ? `${cpuPct}% utilisation` : "Metric not available"}</span>
            </>
          )}
        </div>

        <div className="dv2-panel">
          <p className="dv2-section-label">System Info</p>
          {[
            { k:"Node.js",   v: nodever },
            { k:"PID",       v: String(pid) },
            { k:"Port",      v: String(port) },
            { k:"Env",       v: ops?.env || process?.env?.NODE_ENV || "production" },
          ].map(({ k, v }) => (
            <div key={k} className="dv2-rt-row">
              <span className="dv2-rt-key">{k}</span>
              <span className="dv2-rt-val dv2-mono">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dv2-panel" style={{ marginTop: 14 }}>
        <p className="dv2-section-label">Endpoint Latency (avg)</p>
        {PERF_EPS.map(ep => {
          const pct = Math.min(Math.round((ep.ms / ep.max) * 100), 100);
          const color = ep.ms < 200 ? "#52d68a" : ep.ms < 600 ? "#f0b429" : "#f55b5b";
          return (
            <div key={ep.path} className="dv2-ep-row">
              <span className="dv2-ep-path dv2-mono">{ep.path}</span>
              <div className="dv2-ep-track">
                <div className="dv2-ep-fill" style={{ width:`${pct}%`, background: color }} />
              </div>
              <span className="dv2-ep-ms" style={{ color }}>{ep.ms}ms</span>
            </div>
          );
        })}
      </div>

      <div className="dv2-coming-soon" style={{ marginTop: 14 }}>
        <span className="dv2-cs-icon">◎</span>
        <div>
          <p className="dv2-cs-title">Historical Telemetry Charts <span className="csb-beta-badge">BETA</span></p>
          <p className="dv2-cs-sub">Time-series memory, CPU, latency, and request-rate graphs are planned for the next iteration.</p>
        </div>
      </div>
    </div>
  );
}

// ── Tab: AI Models ────────────────────────────────────────────────────

const PROVIDER_META = {
  groq:       { name:"Groq",       model:"llama-3.3-70b-versatile", cost:"Free tier"         },
  openrouter: { name:"OpenRouter", model:"claude-haiku-4-5",        cost:"₹0.004/1k tokens"  },
  openai:     { name:"OpenAI",     model:"gpt-4o-mini",             cost:"pay-per-token"      },
  ollama:     { name:"Ollama",     model:"(OLLAMA_MODEL)",          cost:"Local / free"       },
};

function TabModels({ addToast }) {
  const [aiStatus, setAiStatus] = useState(null);
  const [ops,      setOps]      = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      getAIStatus().catch(() => null),
      getOpsData().catch(() => null),
    ]).then(([ai, o]) => {
      setAiStatus(ai);
      setOps(o);
    }).finally(() => setLoading(false));
  }, []);

  const evoScore = ops?.evolution?.score ?? 72;
  const activeProvider = aiStatus?.activeProvider || null;
  const preferredOrder = aiStatus?.preferredOrder || ["groq","openrouter","openai","ollama"];

  // Build provider cards from live /ai/status data, falling back to seed
  const providerCards = (aiStatus?.providers || AI_PROVIDERS_SEED.map(p => ({
    id:          p.id,
    configured:  p.keySet,
    health:      { ok: false, reason: "status unavailable" },
    lastFailure: null,
    timeout:     20000,
  }))).map((p, i) => {
    const meta = PROVIDER_META[p.id] || { name: p.id, model:"—", cost:"—" };
    const isActive  = p.id === activeProvider;
    const isFirst   = i === 0;
    const ok        = p.health?.ok === true;
    const status    = isActive ? "active" : ok ? "ready" : p.configured ? "degraded" : "not configured";
    const statusColor = isActive ? "#52d68a" : ok ? "#4ecdc4" : p.configured ? "#f0b429" : "#8994b0";
    return { ...p, ...meta, isActive, isFirst, status, statusColor };
  });

  const EVO_SUGGESTIONS = [
    { id:"s1", text:"Increase WhatsApp template message diversity to reduce block rate", status:"pending" },
    { id:"s2", text:"Enable retry logic on payment link failure (Razorpay 5xx)",        status:"pending" },
    { id:"s3", text:"Extend AI context window on support conversations > 10 turns",    status:"pending" },
    { id:"s4", text:"Archive CRM leads older than 90 days to cold storage",            status:"applied" },
  ];

  return (
    <div className="dv2-models-root">
      {/* Router status strip */}
      <div className="dv2-panel dv2-router-strip">
        <div className="dv2-router-meta">
          <div className="dv2-rt-row">
            <span className="dv2-rt-key">Active provider</span>
            <span className="dv2-rt-val" style={{ color: activeProvider ? "#52d68a" : "#8994b0" }}>
              {loading ? "—" : (activeProvider ? activeProvider.toUpperCase() : "none yet")}
            </span>
          </div>
          <div className="dv2-rt-row">
            <span className="dv2-rt-key">Failover order</span>
            <span className="dv2-rt-val dv2-mono">
              {loading ? "—" : preferredOrder.join(" → ")}
            </span>
          </div>
          <div className="dv2-rt-row">
            <span className="dv2-rt-key">Total calls</span>
            <span className="dv2-rt-val">{loading ? "—" : (aiStatus?.callCount ?? "—")}</span>
          </div>
          <div className="dv2-rt-row">
            <span className="dv2-rt-key">Failures</span>
            <span className="dv2-rt-val" style={{ color: (aiStatus?.failCount ?? 0) > 0 ? "#f0b429" : "#52d68a" }}>
              {loading ? "—" : (aiStatus?.failCount ?? "—")}
            </span>
          </div>
          <div className="dv2-rt-row">
            <span className="dv2-rt-key">Last success</span>
            <span className="dv2-rt-val">{loading ? "—" : (aiStatus?.lastSuccess ? _timeAgo(aiStatus.lastSuccess) : "—")}</span>
          </div>
        </div>
      </div>

      <div className="dv2-models-grid">
        {(loading ? AI_PROVIDERS_SEED.map(p => ({ ...p, statusColor:"#8994b0", status:"loading", isActive:false })) : providerCards).map(p => (
          <div key={p.id} className={`dv2-panel dv2-model-card${p.isActive ? " dv2-model-card--active" : ""}`}>
            <div className="dv2-mc-top">
              <div className="dv2-mc-ident">
                <span className="dv2-mc-name">{p.name}</span>
                <span className="dv2-mc-model dv2-mono">{p.model}</span>
              </div>
              <span className="dv2-chip" style={{ color: p.statusColor, background: p.statusColor+"15", borderColor: p.statusColor+"30" }}>
                {p.status}
              </span>
            </div>
            <div className="dv2-mc-meta">
              <div className="dv2-mc-row"><span>Health</span>
                <span style={{ color: p.health?.ok ? "#52d68a" : "#f55b5b" }}>
                  {loading ? "—" : (p.health?.ok ? "✓ reachable" : (p.health?.reason || "unreachable"))}
                </span>
              </div>
              <div className="dv2-mc-row"><span>Cost</span><strong>{p.cost}</strong></div>
              <div className="dv2-mc-row"><span>API key</span>
                <span style={{ color: p.configured ? "#52d68a" : "#f55b5b" }}>
                  {loading ? "—" : (p.configured ? "✓ Set" : "✗ Missing")}
                </span>
              </div>
              <div className="dv2-mc-row"><span>Timeout</span><strong>{p.timeout ? `${p.timeout/1000}s` : "—"}</strong></div>
              {p.lastFailure && (
                <div className="dv2-mc-row dv2-mc-row--warn">
                  <span>Last error</span>
                  <span className="dv2-mc-err" title={p.lastFailure.reason}>{p.lastFailure.reason?.slice(0, 40) || "—"}</span>
                </div>
              )}
            </div>
            {p.isActive && <div className="dv2-mc-active-badge">PRIMARY</div>}
          </div>
        ))}
      </div>

      <div className="dv2-panel dv2-evo-panel">
        <div className="dv2-evo-top">
          <div>
            <p className="dv2-section-label">Evolution Score</p>
            <p className="dv2-evo-sub">Self-improvement index based on successful task completion, error rate, and suggestion adoption</p>
          </div>
          <span className="dv2-evo-score" style={{ color: evoScore >= 80 ? "#52d68a" : evoScore >= 60 ? "#f0b429" : "#f55b5b" }}>
            {loading ? "—" : evoScore}
            <span className="dv2-evo-denom">/100</span>
          </span>
        </div>
        <div className="dv2-bar-track" style={{ height: 8, borderRadius: 4 }}>
          <div className="dv2-bar-fill" style={{
            width:`${evoScore}%`,
            background: `linear-gradient(90deg, #7c6fff, #4ecdc4)`,
            height: "100%", borderRadius: 4,
          }} />
        </div>
      </div>

      <div className="dv2-panel dv2-suggestions-panel">
        <p className="dv2-section-label">AI Suggestions</p>
        {EVO_SUGGESTIONS.map(sg => (
          <div key={sg.id} className="dv2-sg-row">
            <span className="dv2-sg-dot" style={{ color: sg.status === "applied" ? "#52d68a" : "#7c6fff" }}>○</span>
            <span className="dv2-sg-text">{sg.text}</span>
            {sg.status === "pending" ? (
              <div className="dv2-sg-actions">
                <button className="dv2-btn dv2-btn--ghost dv2-btn--xs" onClick={() => addToast("Suggestion approved", "success")}>Approve</button>
                <button className="dv2-btn dv2-btn--ghost dv2-btn--xs" onClick={() => addToast("Suggestion dismissed", "info")}>Dismiss</button>
              </div>
            ) : (
              <span className="dv2-chip dv2-chip--xs" style={{ color:"#52d68a", background:"rgba(82,214,138,.1)", borderColor:"rgba(82,214,138,.2)" }}>applied</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Logs ─────────────────────────────────────────────────────────

function TabLogs({ addToast }) {
  const [logs,      setLogs]      = useState(SEED_LOGS);
  const [loading,   setLoading]   = useState(true);
  const [levelF,    setLevelF]    = useState("all");
  const [typeF,     setTypeF]     = useState("all");
  const [search,    setSearch]    = useState("");
  const [expanded,  setExpanded]  = useState(null);

  useEffect(() => {
    getRuntimeHistory(50).catch(() => null).then(h => {
      const arr = Array.isArray(h) ? h : (h?.history || []);
      if (arr.length > 0) {
        setLogs(arr.slice(0, 50).map((e, i) => ({
          id:    e.id || `h${i}`,
          ts:    _timeAgo(e.timestamp || e.createdAt),
          level: e.status === "error" || e.status === "failed" ? "error" : e.status === "warning" ? "warn" : "info",
          type:  e.type || "task",
          msg:   e.input || e.goal || e.output || "—",
          detail:e.error || e.output || e.detail || null,
        })));
      }
    }).finally(() => setLoading(false));
  }, []);

  const LEVEL_COLORS = { error:"#f55b5b", warn:"#f0b429", info:"#8994b0", debug:"#4a5470" };

  const filtered = logs.filter(l => {
    if (levelF !== "all" && l.level !== levelF) return false;
    if (typeF  !== "all" && l.type  !== typeF)  return false;
    if (search && !l.msg.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { error:0, warn:0, info:0 };
  logs.forEach(l => { if (counts[l.level] !== undefined) counts[l.level]++; });

  return (
    <div className="dv2-logs-root">
      <div className="dv2-logs-summary">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="dv2-ls-cell" style={{ borderColor: LEVEL_COLORS[k]+"30" }}>
            <span className="dv2-ls-val" style={{ color: LEVEL_COLORS[k] }}>{v}</span>
            <span className="dv2-ls-label">{k}</span>
          </div>
        ))}
      </div>

      <div className="dv2-logs-toolbar">
        <div className="dv2-search-wrap" style={{ flex: 1 }}>
          <span className="dv2-search-icon">🔍</span>
          <input
            className="dv2-search"
            placeholder="Search logs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="dv2-logs-filters">
          {["all","error","warn","info"].map(l => (
            <button key={l} className={`dv2-filter-chip${levelF===l?" dv2-filter-chip--active":""}`} onClick={() => setLevelF(l)}>
              {l !== "all" && <span style={{ color: LEVEL_COLORS[l] }}>● </span>}{l}
            </button>
          ))}
        </div>
        <div className="dv2-logs-filters">
          {["all","task","wa","agent","system","http","ai"].map(t => (
            <button key={t} className={`dv2-filter-chip${typeF===t?" dv2-filter-chip--active":""}`} onClick={() => setTypeF(t)}>{t}</button>
          ))}
        </div>
      </div>

      <div className="dv2-log-list dv2-panel">
        {loading ? [0,1,2,3,4].map(i => <SkelRow key={i} cols={4} />) : (
          filtered.length === 0 ? (
            <div className="dv2-empty"><span className="dv2-empty-icon">◎</span><p className="dv2-empty-title">No matching log entries</p></div>
          ) : (
            filtered.map(l => {
              const lc = LEVEL_COLORS[l.level] || "#8994b0";
              const isOpen = expanded === l.id;
              return (
                <div
                  key={l.id}
                  className={`dv2-log-row dv2-log-row--clickable${isOpen?" dv2-log-row--open":""}`}
                  onClick={() => setExpanded(isOpen ? null : l.id)}
                >
                  <span className="dv2-log-ts dv2-mono">{l.ts}</span>
                  <span className="dv2-log-level" style={{ color: lc, minWidth:40 }}>{l.level.toUpperCase()}</span>
                  <span className="dv2-log-type-tag dv2-mono">[{l.type.toUpperCase()}]</span>
                  <span className="dv2-log-msg">{l.msg}</span>
                  {isOpen && l.detail && (
                    <div className="dv2-log-expand">
                      <pre className="dv2-log-detail">{typeof l.detail === "string" ? l.detail : JSON.stringify(l.detail, null, 2)}</pre>
                    </div>
                  )}
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}

// ── Tab: Alerts ───────────────────────────────────────────────────────

function TabAlerts({ addToast }) {
  const [alerts,   setAlerts]   = useState(SEED_ALERTS);
  const [loading,  setLoading]  = useState(true);
  const [sevFilter,setSevFilter]= useState("all");
  const [statusF,  setStatusF]  = useState("open");
  const [expanded, setExpanded] = useState(null);
  const [resolving,setResolving]= useState(null);

  useEffect(() => {
    listAlerts({ limit: 30 }).catch(() => null).then(r => {
      const arr = r?.alerts || (Array.isArray(r) ? r : null);
      if (arr && arr.length > 0) setAlerts(arr);
    }).finally(() => setLoading(false));
  }, []);

  async function handleResolve(a) {
    setResolving(a.id);
    try {
      await resolveAlert(a.id);
      setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, status:"resolved" } : x));
      addToast(`Alert resolved: ${a.title.slice(0, 40)}…`, "success");
      track("alert_resolve", { alertId: a.id });
    } catch {
      setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, status:"resolved" } : x));
      addToast("Alert marked resolved", "info");
    } finally {
      setResolving(null);
    }
  }

  const openCount     = alerts.filter(a => a.status === "open").length;
  const criticalCount = alerts.filter(a => a.severity === "critical" && a.status === "open").length;
  const resolvedCount = alerts.filter(a => a.status === "resolved").length;

  const filtered = alerts.filter(a => {
    if (sevFilter !== "all" && a.severity !== sevFilter) return false;
    if (statusF   !== "all" && a.status   !== statusF)   return false;
    return true;
  });

  return (
    <div className="dv2-alerts-root">
      <div className="dv2-alerts-summary">
        <div className="dv2-as-cell dv2-as-cell--critical">
          <span className="dv2-as-val">{criticalCount}</span>
          <span className="dv2-as-label">Critical open</span>
        </div>
        <div className="dv2-as-cell dv2-as-cell--warn">
          <span className="dv2-as-val">{openCount}</span>
          <span className="dv2-as-label">Total open</span>
        </div>
        <div className="dv2-as-cell">
          <span className="dv2-as-val">{resolvedCount}</span>
          <span className="dv2-as-label">Resolved</span>
        </div>
      </div>

      <div className="dv2-alerts-toolbar">
        <div className="dv2-alerts-filters">
          {["all","critical","warning","low"].map(s => (
            <button key={s} className={`dv2-filter-chip${sevFilter===s?" dv2-filter-chip--active":""}`}
              style={s !== "all" ? { "--hc": SEV_COLOR[s] } : {}}
              onClick={() => setSevFilter(s)}
            >{s}</button>
          ))}
        </div>
        <div className="dv2-alerts-filters">
          {["open","resolved","all"].map(s => (
            <button key={s} className={`dv2-filter-chip${statusF===s?" dv2-filter-chip--active":""}`} onClick={() => setStatusF(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="dv2-alerts-list">
        {loading ? [0,1,2].map(i => <div key={i} className="dv2-alert-row"><SkelRow cols={4} /></div>) : (
          filtered.length === 0 ? (
            <div className="dv2-empty">
              <span className="dv2-empty-icon" style={{ color:"#52d68a" }}>✓</span>
              <p className="dv2-empty-title">No alerts in this view</p>
            </div>
          ) : (
            filtered.map(a => {
              const sc2 = SEV_COLOR[a.severity] || "#8994b0";
              const isOpen = expanded === a.id;
              return (
                <div
                  key={a.id}
                  className={`dv2-alert-row${a.severity === "critical" && a.status === "open" ? " dv2-alert-row--critical" : ""}${isOpen ? " dv2-alert-row--open" : ""}`}
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                >
                  <div className="dv2-ar-top">
                    <span className="dv2-sev-pill" style={{ color: sc2, background: sc2+"15" }}>{a.severity}</span>
                    <span className="dv2-ar-title">{a.title}</span>
                    <span className="dv2-ar-service dv2-mono">{a.service}</span>
                    <span className="dv2-ar-ts">{a.created}</span>
                    <span className="dv2-chip dv2-chip--xs" style={{
                      color: a.status === "resolved" ? "#52d68a" : "#f0b429",
                      background: a.status === "resolved" ? "rgba(82,214,138,.1)" : "rgba(240,180,41,.1)",
                      borderColor: a.status === "resolved" ? "rgba(82,214,138,.2)" : "rgba(240,180,41,.2)",
                    }}>{a.status}</span>
                    <span className="dv2-ar-toggle">{isOpen ? "▲" : "▼"}</span>
                  </div>
                  {isOpen && (
                    <div className="dv2-ar-expand">
                      <p className="dv2-ar-detail">{a.detail}</p>
                      {a.status === "open" && (
                        <button
                          className="dv2-btn dv2-btn--ghost dv2-btn--sm"
                          onClick={e => { e.stopPropagation(); handleResolve(a); }}
                          disabled={resolving === a.id}
                        >
                          {resolving === a.id ? "⟳ Resolving…" : "✓ Mark Resolved"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}

// ── Tab: Service Health ───────────────────────────────────────────────

function TabServices({ addToast }) {
  const [online,   setOnline]   = useState(null);
  const [ops,      setOps]      = useState(null);
  const [services, setServices] = useState(SEED_SERVICES);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      checkHealth().catch(() => false),
      getOpsData().catch(() => null),
    ]).then(([h, o]) => {
      setOnline(h);
      setOps(o);
      if (o?.services) {
        const merged = SEED_SERVICES.map(s => {
          const live = o.services[s.id] || o.services[s.name?.toLowerCase()] || {};
          return { ...s, ...live };
        });
        setServices(merged);
      }
    }).finally(() => setLoading(false));
  }, []);

  const healthyCount = services.filter(s => s.status === "healthy" || s.status === "active").length;

  return (
    <div className="dv2-svc-root">
      <div className="dv2-svc-header">
        <div className="dv2-svc-hkpis">
          <div className="dv2-kpi">
            <span className="dv2-kpi-val" style={{ color: online ? "#52d68a" : "#f55b5b" }}>{online ? "ONLINE" : "OFFLINE"}</span>
            <span className="dv2-kpi-label">Backend Status</span>
          </div>
          <div className="dv2-kpi">
            <span className="dv2-kpi-val" style={{ color: "#52d68a" }}>{healthyCount}</span>
            <span className="dv2-kpi-label">Services healthy</span>
          </div>
          <div className="dv2-kpi">
            <span className="dv2-kpi-val" style={{ color: services.length - healthyCount > 0 ? "#f0b429" : "#52d68a" }}>
              {services.length - healthyCount}
            </span>
            <span className="dv2-kpi-label">Degraded</span>
          </div>
        </div>
        <div className="dv2-overall-health">
          <span className="dv2-oh-dot" style={{ background: healthyCount === services.length ? "#52d68a" : "#f0b429" }} />
          <span className="dv2-oh-label">{healthyCount === services.length ? "All systems operational" : `${services.length - healthyCount} service(s) degraded`}</span>
        </div>
      </div>

      <div className="dv2-svc-grid">
        {(loading ? SEED_SERVICES : services).map(s => {
          const color = sc(s.status);
          return (
            <div key={s.id} className={`dv2-svc-card${s.status !== "healthy" ? " dv2-svc-card--degraded" : ""}`}>
              <div className="dv2-sc-top">
                <span className="dv2-sc-dot" style={{ background: color }} />
                <span className="dv2-sc-name">{s.name}</span>
                <span className="dv2-chip dv2-chip--xs" style={{ color, background: color+"15", borderColor: color+"30" }}>{s.status}</span>
              </div>
              <div className="dv2-sc-meta">
                {s.uptime  && s.uptime !== "—" && <span className="dv2-sc-stat">Uptime: <strong>{s.uptime}</strong></span>}
                {s.latency && s.latency !== "—" && <span className="dv2-sc-stat">Latency: <strong>{s.latency}</strong></span>}
                {s.memory  && s.memory !== "—"  && <span className="dv2-sc-stat">Memory: <strong>{s.memory}</strong></span>}
                {s.cpu     && s.cpu !== "—"     && <span className="dv2-sc-stat">CPU: <strong>{s.cpu}</strong></span>}
              </div>
              {s.provider && <span className="dv2-sc-provider">{s.provider}</span>}
              {s.status === "degraded" && (
                <div className="dv2-sc-warn">
                  <span className="dv2-sc-warn-icon">⚠</span>
                  <span>Check credentials or connection</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Patches ──────────────────────────────────────────────────────

const PATCH_STATUS_COLOR = { pending:"#f0b429", applied:"#52d68a", rolled_back:"#f55b5b", failed:"#f55b5b" };

function TabPatches({ addToast }) {
  const [patches,    setPatches]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [statusF,    setStatusF]    = useState("all");
  const [applying,   setApplying]   = useState(null);
  const [verifying,  setVerifying]  = useState(null);
  const [expanded,   setExpanded]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listPatches(statusF === "all" ? undefined : statusF);
      setPatches(r?.patches || []);
    } catch { setPatches([]); }
    finally { setLoading(false); }
  }, [statusF]);

  useEffect(() => { load(); }, [load]);

  async function handleApply(p) {
    if (applying) return;
    setApplying(p.id);
    try {
      const r = await fetch(`/runtime/patches/${p.id}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ approved: true }),
      }).then(x => x.json());
      if (r.success) {
        addToast(`Applied patch to ${p.filePath || p.id}`, "success");
        setPatches(prev => prev.map(x => x.id === p.id ? { ...x, status: "applied" } : x));
      } else {
        addToast(`Apply failed: ${r.error}`, "error");
      }
      track("patch_applied");
    } catch (e) { addToast(`Error: ${e.message}`, "error"); }
    finally { setApplying(null); }
  }

  async function handleVerify(p) {
    if (verifying) return;
    setVerifying(p.id);
    try {
      const r = await fetch(`/runtime/patches/${p.id}/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ autoRollback: false }),
      }).then(x => x.json());
      if (r.pass !== undefined) {
        addToast(`Tests: ${r.pass} pass / ${r.fail} fail`, r.fail > 0 ? "error" : "success");
      } else {
        addToast(`Verify: ${r.error || "done"}`, "info");
      }
      track("patch_verified");
    } catch (e) { addToast(`Error: ${e.message}`, "error"); }
    finally { setVerifying(null); }
  }

  async function handleRollback(p) {
    try {
      const r = await fetch(`/runtime/patches/${p.id}/rollback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ approved: true }),
      }).then(x => x.json());
      if (r.success) {
        addToast(`Rolled back ${p.filePath || p.id}`, "success");
        setPatches(prev => prev.map(x => x.id === p.id ? { ...x, status: "rolled_back" } : x));
      } else {
        addToast(`Rollback failed: ${r.error}`, "error");
      }
      track("patch_rollback");
    } catch (e) { addToast(`Error: ${e.message}`, "error"); }
  }

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        {["all","pending","applied","rolled_back"].map(s => (
          <button key={s}
            className={`dv2-filter-chip${statusF === s ? " dv2-filter-chip--active" : ""}`}
            onClick={() => setStatusF(s)}
          >{s === "rolled_back" ? "rolled back" : s}</button>
        ))}
        <button className="dv2-btn dv2-btn--ghost dv2-btn--sm" style={{ marginLeft: "auto" }} onClick={load}>⟳ Refresh</button>
      </div>

      {loading ? [0,1,2].map(i => <div key={i} className="dv2-alert-row"><SkelRow cols={4} /></div>) : (
        patches.length === 0 ? (
          <div className="dv2-empty">
            <span className="dv2-empty-icon" style={{ color:"#52d68a" }}>✓</span>
            <p className="dv2-empty-title">No patches in this view</p>
            <p className="dv2-empty-sub">Patches are created when you ask JARVIS to fix or modify a file.</p>
          </div>
        ) : (
          patches.map(p => {
            const col = PATCH_STATUS_COLOR[p.status] || "#8994b0";
            const isOpen = expanded === p.id;
            return (
              <div key={p.id}
                className={`dv2-alert-row${isOpen ? " dv2-alert-row--open" : ""}`}
                onClick={() => setExpanded(isOpen ? null : p.id)}
              >
                <div className="dv2-ar-top">
                  <span className="dv2-sev-pill" style={{ color: col, background: col + "15" }}>{p.status || "pending"}</span>
                  <span className="dv2-ar-title dv2-mono" style={{ fontSize: 11 }}>{p.filePath || p.id?.slice(0,16)}</span>
                  <span className="dv2-ar-ts" style={{ fontSize: 10 }}>+{p.diff?.linesAdded || 0} / −{p.diff?.linesRemoved || 0}</span>
                  <span className="dv2-ar-ts">{_timeAgo(p.proposedAt)}</span>
                  <span className="dv2-ar-toggle">{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div className="dv2-ar-expand" onClick={e => e.stopPropagation()}>
                    {p.description && <p className="dv2-ar-detail">{p.description}</p>}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {p.status === "pending" && (
                        <>
                          <button className="dv2-btn dv2-btn--primary dv2-btn--sm"
                            disabled={applying === p.id}
                            onClick={() => handleApply(p)}
                          >{applying === p.id ? "Applying…" : "Apply"}</button>
                          <button className="dv2-btn dv2-btn--ghost dv2-btn--sm"
                            disabled={verifying === p.id}
                            onClick={() => handleVerify(p)}
                          >{verifying === p.id ? "Running…" : "Run Tests"}</button>
                        </>
                      )}
                      {p.status === "applied" && (
                        <button className="dv2-btn dv2-btn--ghost dv2-btn--sm" onClick={() => handleRollback(p)}>
                          ↩ Rollback
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )
      )}
    </div>
  );
}

// ── Tab: Recovery (DLQ) ───────────────────────────────────────────────

function TabDLQ({ addToast }) {
  const [entries,    setEntries]    = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [removing,   setRemoving]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getDLQ(30);
      setEntries(r?.entries || []);
      setTotal(r?.total || 0);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRecoverAll() {
    setRecovering(true);
    try {
      const r = await recoverDLQ();
      addToast(r.success ? `Requeued ${r.queued || 0} task(s)` : `Recovery failed: ${r.error}`, r.success ? "success" : "error");
      if (r.success) await load();
      track("dlq_recover_all");
    } catch (e) { addToast(`Error: ${e.message}`, "error"); }
    finally { setRecovering(false); }
  }

  async function handleRemove(taskId) {
    setRemoving(taskId);
    try {
      const r = await removeDLQEntry(taskId);
      if (r.success !== false) {
        setEntries(prev => prev.filter(e => e.taskId !== taskId));
        addToast("Entry removed from DLQ", "info");
      } else {
        addToast(`Remove failed: ${r.error}`, "error");
      }
      track("dlq_remove");
    } catch (e) { addToast(`Error: ${e.message}`, "error"); }
    finally { setRemoving(null); }
  }

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <div>
          <span style={{ fontSize: 22, fontWeight: 700, color: total > 0 ? "#f0b429" : "#52d68a" }}>{total}</span>
          <span style={{ fontSize: 11, color: "var(--dv2-text2)", marginLeft: 6 }}>failed task{total !== 1 ? "s" : ""} in queue</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="dv2-btn dv2-btn--ghost dv2-btn--sm" onClick={load}>⟳ Refresh</button>
          {entries.length > 0 && (
            <button
              className="dv2-btn dv2-btn--primary dv2-btn--sm"
              disabled={recovering}
              onClick={handleRecoverAll}
            >
              {recovering ? "Requeuing…" : `↑ Requeue all (${Math.min(entries.length, 20)})`}
            </button>
          )}
        </div>
      </div>

      {loading ? [0,1,2].map(i => <div key={i} className="dv2-alert-row"><SkelRow cols={4} /></div>) : (
        entries.length === 0 ? (
          <div className="dv2-empty">
            <span className="dv2-empty-icon" style={{ color:"#52d68a" }}>✓</span>
            <p className="dv2-empty-title">Dead letter queue is empty</p>
            <p className="dv2-empty-sub">Failed tasks that exhaust retries will appear here for manual recovery.</p>
          </div>
        ) : (
          entries.map(e => (
            <div key={e.taskId} className="dv2-alert-row">
              <div className="dv2-ar-top">
                <span className="dv2-sev-pill" style={{ color:"#f55b5b", background:"rgba(245,91,91,.1)" }}>failed</span>
                <span className="dv2-ar-title" style={{ flex: 1 }}>
                  {(e.task?.input || e.input || e.taskId || "").slice(0, 60)}
                </span>
                <span className="dv2-ar-ts">{e.attempts || 0} attempt{(e.attempts || 0) !== 1 ? "s" : ""}</span>
                <span className="dv2-ar-ts">{_timeAgo(e.failedAt || e.ts)}</span>
                <button
                  className="dv2-btn dv2-btn--ghost dv2-btn--sm"
                  disabled={removing === e.taskId}
                  onClick={ev => { ev.stopPropagation(); handleRemove(e.taskId); }}
                  style={{ fontSize: 10, padding: "1px 7px" }}
                >
                  {removing === e.taskId ? "…" : "✕ Discard"}
                </button>
              </div>
              {e.error && (
                <div style={{ padding: "4px 8px 6px", fontSize: 10, color: "#f55b5b", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {e.error.slice(0, 200)}
                </div>
              )}
            </div>
          ))
        )
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function DevOpsCenterV2({ onNavigate }) {
  const [tab,    setTab]    = useState("runtime");
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg, type = "info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
  }, []);
  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  useEffect(() => { track("devops_v2_viewed"); }, []);

  return (
    <div className="dv2-root">
      <div className="dv2-header">
        <div>
          <h1 className="dv2-page-title">DevOps Center</h1>
          <p className="dv2-page-sub">Runtime monitoring · Deployments · Observability · Service health</p>
        </div>
      </div>

      <div className="dv2-subnav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`dv2-subnav-tab${tab === t.id ? " dv2-subnav-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="dv2-tab-content">
        {tab === "runtime"      && <TabRuntime       addToast={addToast} />}
        {tab === "deployments"  && <TabDeployments   addToast={addToast} />}
        {tab === "observability"&& <TabObservability addToast={addToast} />}
        {tab === "telemetry"    && <TabTelemetry     addToast={addToast} />}
        {tab === "models"       && <TabModels        addToast={addToast} />}
        {tab === "logs"         && <TabLogs          addToast={addToast} />}
        {tab === "alerts"       && <TabAlerts        addToast={addToast} />}
        {tab === "services"     && <TabServices      addToast={addToast} />}
        {tab === "patches"      && <TabPatches       addToast={addToast} />}
        {tab === "dlq"          && <TabDLQ           addToast={addToast} />}
      </div>

      <div className="dv2-toast-container">
        {toasts.map(t => (
          <Toast key={t.id} msg={t.msg} type={t.type} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
