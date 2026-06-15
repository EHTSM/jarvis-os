/**
 * GuardrailsDashboard — B7.5
 * High-risk files · Frequent rollbacks · Incident hotspots · Recovery map · Auto-Warning
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { BASE_URL } from "../_client";
import PageHeader from "./PageHeader";

async function _get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function _post(path, body = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ── colour helpers ────────────────────────────────────────────────────

const RISK_COLOR = {
  low: "#52d68a", moderate: "#f0b429", high: "#f0a028", critical: "#f55b5b", none: "#52d68a",
};
function rc(level) { return RISK_COLOR[level] || "#8994b0"; }

// ── micro components ──────────────────────────────────────────────────

function Chip({ label, color }) {
  const c = color || "#8994b0";
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
    color: c, background: c + "18", border: `1px solid ${c}30` }}>{label}</span>;
}

function Skel({ w = "100%", h = 12 }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 3,
    background: "rgba(255,255,255,0.06)", animation: "gd-pulse 1.4s ease-in-out infinite" }} />;
}

function Section({ title, children, count, action }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8994b0" }}>{title}</span>
        {count != null && <span style={{ fontSize: 9, color: "#8994b0", background: "rgba(255,255,255,0.07)", padding: "0 5px", borderRadius: 3 }}>{count}</span>}
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children, style }) {
  return <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.05)", ...style }}>{children}</div>;
}

function Empty({ icon = "◌", title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 20px", color: "#8994b0" }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#c8cdd8", marginBottom: 3 }}>{title}</div>
      {sub && <div style={{ fontSize: 10 }}>{sub}</div>}
    </div>
  );
}

function RollbackBar({ rate, size = 60 }) {
  const col = rate > 50 ? "#f55b5b" : rate > 25 ? "#f0b429" : "#52d68a";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: size, height: 5, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${Math.min(100, rate)}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: 9, color: col, fontWeight: 700 }}>{rate}%</span>
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ flex: "1 1 80px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#e6edf3" }}>{value ?? "—"}</div>
      <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{label}</div>
      {sub != null && <div style={{ fontSize: 9, color: "#8994b0", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function _ago(ts) {
  if (!ts) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

// ── Warning Overlay ───────────────────────────────────────────────────

export function PreActionWarning({ action, patchId, filePath, task, pipelineName, onProceed, onCancel }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _post("/runtime/guard/pre-action-warning", { action, patchId, filePath, task, pipelineName })
      .then(setData).catch(e => setData({ error: e.message })).finally(() => setLoading(false));
  }, [action, patchId, filePath, task, pipelineName]);

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#161b22", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 24, width: 380, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#8994b0" }}>Checking safety…</div>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>{[0,1,2].map(i=><Skel key={i}/>)}</div>
        </div>
      </div>
    );
  }

  if (data?.error || !data) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#161b22", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 24, width: 360 }}>
          <div style={{ fontSize: 12, color: "#f55b5b", marginBottom: 12 }}>Could not load safety check: {data?.error}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onProceed} style={{ flex: 1, padding: "6px 0", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, color: "#c8cdd8", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Proceed anyway</button>
            <button onClick={onCancel}  style={{ flex: 1, padding: "6px 0", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#8994b0", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // If no risk — auto-proceed (caller should still gate on this)
  if (!data.shouldWarn) {
    onProceed?.();
    return null;
  }

  const col = rc(data.riskLevel);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#161b22", border: `1px solid ${col}40`, borderRadius: 10, padding: 24, width: "min(480px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: col + "20", border: `2px solid ${col}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⚠</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: col }}>{data.riskLevel?.toUpperCase()} RISK — {action?.toUpperCase()}</div>
            <div style={{ fontSize: 10, color: "#8994b0", marginTop: 2 }}>Risk score: {data.riskScore}/100</div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#c8cdd8", marginBottom: 14, padding: "8px 12px", background: col + "0d", borderRadius: 5, borderLeft: `3px solid ${col}` }}>
          {data.summary}
        </div>

        {/* Warnings */}
        {data.warnings?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#8994b0", marginBottom: 6 }}>Warnings</div>
            {data.warnings.map((w, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                <span style={{ color: col, fontSize: 10, flexShrink: 0 }}>✗</span>
                <span style={{ fontSize: 10, color: "#c8cdd8" }}>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Evidence */}
        {data.evidence?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#8994b0", marginBottom: 6 }}>Evidence</div>
            {data.evidence.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
                <Chip label={e.weight} color={e.weight === "high" ? "#f55b5b" : "#f0b429"} />
                <span style={{ fontSize: 10, color: "#8994b0" }}>{e.detail}</span>
              </div>
            ))}
          </div>
        )}

        {/* Safer alternatives */}
        {data.alternatives?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#8994b0", marginBottom: 6 }}>Safer alternatives</div>
            {data.alternatives.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                <span style={{ color: "#52d68a", fontSize: 10 }}>→</span>
                <span style={{ fontSize: 10, color: "#c8cdd8" }}>{a}</span>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: "8px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#8994b0", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button onClick={onProceed}
            style={{ flex: 2, padding: "8px 0", background: col + "18", border: `1px solid ${col}40`, borderRadius: 5, color: col, fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
            Proceed with {action} (override)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pre-Deploy Guard Modal ────────────────────────────────────────────

export function PreDeployGuard({ pipelineName, filePaths, request, threshold = 70, onAllow, onBlock }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    _post("/runtime/guard/pre-deploy", { pipelineName, filePaths: filePaths || [], request, threshold })
      .then(setData).catch(e => setData({ error: e.message })).finally(() => setLoading(false));
  }, [pipelineName, filePaths, request, threshold]);

  useEffect(() => {
    // If loaded and not blocked, auto-allow
    if (data && !loading && !data.blocked && !data.error) {
      onAllow?.();
    }
  }, [data, loading, onAllow]);

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#161b22", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 24, width: 380, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#8994b0" }}>Running pre-deploy guard…</div>
        </div>
      </div>
    );
  }

  if (!data?.blocked) return null; // auto-allowed already

  const col = rc(data.riskLevel);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#161b22", border: `1px solid ${col}50`, borderRadius: 10, padding: 24, width: "min(480px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: col + "20", border: `2px solid ${col}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🚫</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: col }}>DEPLOY BLOCKED</div>
            <div style={{ fontSize: 10, color: "#8994b0" }}>Risk {data.riskScore}/{threshold} threshold — {data.riskLevel?.toUpperCase()}</div>
          </div>
        </div>

        {data.factors?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {data.factors.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
                <span style={{ fontSize: 10, color: col, fontWeight: 700, flexShrink: 0 }}>+{f.weight}</span>
                <span style={{ fontSize: 10, color: "#c8cdd8" }}>{f.detail}</span>
              </div>
            ))}
          </div>
        )}

        {data.warnings?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#8994b0", marginBottom: 5 }}>Prior rollback warnings</div>
            {data.warnings.map((w, i) => <div key={i} style={{ fontSize: 10, color: "#f0b429", marginBottom: 3 }}>⚠ {w}</div>)}
          </div>
        )}

        {data.alternatives?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#8994b0", marginBottom: 5 }}>Suggested safe path</div>
            {data.alternatives.map((a, i) => <div key={i} style={{ fontSize: 10, color: "#52d68a", marginBottom: 3 }}>→ {a}</div>)}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBlock}
            style={{ flex: 1, padding: "8px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#8994b0", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            Abort Deploy
          </button>
          <button onClick={onAllow}
            style={{ flex: 2, padding: "8px 0", background: col + "18", border: `1px solid ${col}40`, borderRadius: 5, color: col, fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
            Override — Deploy Anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Patch Safety Strip (inline, for PatchApprovalPanel) ──────────────

export function PatchSafetyStrip({ patchId, filePath }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patchId) { setLoading(false); return; }
    _get(`/runtime/guard/patch-safety/${patchId}`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [patchId]);

  if (loading) return <div style={{ padding: "4px 10px", fontSize: 9, color: "#8994b0" }}>Checking safety…</div>;
  if (!data)   return null;

  const col = rc(data.riskLevel);
  return (
    <div style={{ padding: "5px 10px", background: col + "0d", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#8994b0" }}>Safety:</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{data.safetyScore}/100</span>
        <Chip label={data.riskLevel?.toUpperCase()} color={col} />
      </div>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "#8994b0" }}>Confidence:</span>
        <span style={{ fontSize: 10, color: "#c8cdd8" }}>{data.confidenceScore}%</span>
      </div>
      {data.explanation?.length > 0 && (
        <div style={{ flex: 1, minWidth: 120 }}>
          <span style={{ fontSize: 9, color: col }}>
            {data.explanation[0]}
            {data.explanation.length > 1 ? ` (+${data.explanation.length - 1} more)` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Regression Warning Banner ─────────────────────────────────────────

export function RegressionBanner({ filePath, description, patchId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(true);

  useEffect(() => {
    if (!filePath && !description) { setLoading(false); return; }
    _post("/runtime/guard/regression-check", { filePath, description, patchId })
      .then(d => { setData(d); if (!d.hasRegressions) setOpen(false); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filePath, description, patchId]);

  if (loading || !data?.hasRegressions || !open) return null;

  const col = rc(data.severity);

  return (
    <div style={{ margin: "6px 0", padding: "8px 12px", background: col + "0d", border: `1px solid ${col}30`, borderRadius: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>⚠ Regression Risk</span>
        <span style={{ fontSize: 9, color: "#8994b0", flex: 1 }}>{data.summary}</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8994b0", fontSize: 11 }}>✕</button>
      </div>
      {data.regressionWarnings?.slice(0, 3).map((w, i) => (
        <div key={i} style={{ fontSize: 9, color: "#c8cdd8", marginBottom: 2 }}>
          <span style={{ color: col }}>→ </span>{w.recommendation || w.description} {w.matchScore ? `(${w.matchScore}% match)` : ""}
        </div>
      ))}
    </div>
  );
}

// ── Incident Prevention Banner ────────────────────────────────────────

export function IncidentPreventionBanner({ task, filePath }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [open,    setOpen]    = useState(true);

  useEffect(() => {
    if (!task && !filePath) { setLoading(false); return; }
    _post("/runtime/guard/incident-check", { task, filePath })
      .then(d => { setData(d); if (!d.shouldWarn) setOpen(false); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [task, filePath]);

  if (loading || !data?.shouldWarn || !open) return null;

  const col = rc(data.severity);

  return (
    <div style={{ margin: "6px 0", padding: "8px 12px", background: col + "0d", border: `1px solid ${col}30`, borderRadius: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>⚠ Prior Incident Match</span>
        <span style={{ fontSize: 9, color: "#8994b0", flex: 1 }}>{data.summary}</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8994b0", fontSize: 11 }}>✕</button>
      </div>
      {data.incidentMatches?.slice(0, 2).map((m, i) => (
        <div key={i} style={{ fontSize: 9, color: "#c8cdd8", marginBottom: 2 }}>
          <Chip label={m.type || "incident"} color={col} /> {m.context || "(no context)"} — {m.matchScore}% match
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────

const TABS = [
  { id: "overview",    label: "Overview"       },
  { id: "files",       label: "Risk Files"     },
  { id: "incidents",   label: "Incidents"      },
  { id: "recovery",    label: "Recovery Map"   },
  { id: "autocheck",   label: "Auto-Check"     },
];

export default function GuardrailsDashboard({ onNavigate }) {
  const [tab,     setTab]     = useState("overview");
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);

  // Auto-check state
  const [acTask,      setAcTask]      = useState("");
  const [acFile,      setAcFile]      = useState("");
  const [acPatchId,   setAcPatchId]   = useState("");
  const [acAction,    setAcAction]    = useState("apply");
  const [acResult,    setAcResult]    = useState(null);
  const [acLoading,   setAcLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await _get("/runtime/guard/dashboard")); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAutoCheck() {
    if (!acTask && !acFile) return;
    setAcLoading(true); setAcResult(null);
    try {
      const [warn, inc, reg] = await Promise.all([
        _post("/runtime/guard/pre-action-warning", { action: acAction, patchId: acPatchId, filePath: acFile, task: acTask }),
        _post("/runtime/guard/incident-check",     { task: acTask, filePath: acFile }),
        _post("/runtime/guard/regression-check",   { filePath: acFile, description: acTask, patchId: acPatchId }),
      ]);
      setAcResult({ warning: warn, incident: inc, regression: reg });
    } catch (e) { setAcResult({ error: e.message }); }
    finally { setAcLoading(false); }
  }

  const ps = data?.platformSummary || {};

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes gd-pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>
      <PageHeader
        icon="◻"
        title="Engineering Guardrails"
        subtitle="High-risk files · Rollback hotspots · Incident hotspots · Recovery map · Pre-action safety checks"
        actions={[{ label: "⟳ Refresh", onClick: load, disabled: loading }]}
        related={[
          { label: "Prediction", tab: "predict", icon: "◇" },
          { label: "Reliability", tab: "reliability", icon: "◈" },
          { label: "Recommendation", tab: "recommend", icon: "✦" },
          { label: "Self-Healing", tab: "selfhealing", icon: "✦" },
          { label: "Engineering", tab: "engineering", icon: "⬡" },
        ]}
        onNavigate={onNavigate}
      />
      <div style={{ padding: "16px 24px 0" }}>

        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer", background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? "#44a2ff" : "#8994b0", marginBottom: -1, whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 40px" }}>
        {loading && [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
        {err && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {err}</div>}

        {/* ── Overview ── */}
        {tab === "overview" && !loading && data && (
          <>
            {/* Platform stat cards */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
              <StatCard label="Total patches"    value={ps.totalPatches}     />
              <StatCard label="Applied"          value={ps.appliedPatches}   color="#52d68a" />
              <StatCard label="Rolled back"      value={ps.rolledBackPatches} color={ps.rolledBackPatches > 0 ? "#f55b5b" : "#52d68a"} />
              <StatCard label="Rollback rate"    value={ps.rollbackRate != null ? `${ps.rollbackRate}%` : "—"} color={ps.rollbackRate > 30 ? "#f55b5b" : "#52d68a"} />
              <StatCard label="Heal total"       value={ps.healTotal}        color="#44a2ff" />
              <StatCard label="Heal rate"        value={ps.healRate != null ? `${ps.healRate}%` : "—"} color={ps.healRate > 70 ? "#52d68a" : "#f0b429"} />
              <StatCard label="Total incidents"  value={ps.totalIncidents}   color={ps.totalIncidents > 5 ? "#f55b5b" : "#f0b429"} />
            </div>

            {/* Top high-risk files */}
            <Section title="High-risk files" count={data.highRiskFiles?.length}>
              {data.highRiskFiles?.length === 0
                ? <Empty icon="✓" title="No high-risk files" sub="All patched files have rollback rate ≤ 25%." />
                : data.highRiskFiles?.map((f, i) => (
                  <Row key={i}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file}</div>
                      <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{f.total} patches · {f.applied} applied · {f.rolledBack} rolled back</div>
                    </div>
                    <RollbackBar rate={f.rollbackRate} />
                  </Row>
                ))
              }
            </Section>

            {/* Top incident hotspots */}
            <Section title="Incident hotspots" count={data.incidentHotspots?.length}>
              {data.incidentHotspots?.length === 0
                ? <Empty icon="✓" title="No incident hotspots" />
                : data.incidentHotspots?.slice(0, 5).map((h, i) => (
                  <Row key={i}>
                    <Chip label={h.type} color={h.criticalCount > 0 ? "#f55b5b" : "#f0b429"} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#c8cdd8" }}>{h.type}</div>
                    </div>
                    <Chip label={`${h.count} total`} color="#8994b0" />
                    {h.open > 0 && <Chip label={`${h.open} open`} color="#f55b5b" />}
                  </Row>
                ))
              }
            </Section>
          </>
        )}

        {/* ── Risk Files ── */}
        {tab === "files" && !loading && data && (
          <>
            <Section title="Frequent rollbacks" count={data.frequentRollbacks?.length}>
              {data.frequentRollbacks?.length === 0
                ? <Empty icon="✓" title="No rollbacks recorded" sub="Apply patches to build rollback history." />
                : data.frequentRollbacks?.map((f, i) => (
                  <Row key={i}>
                    <span style={{ fontSize: 10, color: "#8994b0", width: 20, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file}</div>
                      <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{f.total} patches · {f.pending} pending</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <RollbackBar rate={f.rollbackRate} size={48} />
                      <Chip label={`${f.rolledBack} backs`} color="#f55b5b" />
                    </div>
                  </Row>
                ))
              }
            </Section>

            <Section title="All patched files (high-risk first)" count={data.highRiskFiles?.length}>
              {data.highRiskFiles?.length === 0
                ? <Empty icon="✓" title="No high-risk files" />
                : data.highRiskFiles?.map((f, i) => (
                  <Row key={i}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file}</div>
                      <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>applied:{f.applied} · rolled:{f.rolledBack} · pending:{f.pending}</div>
                    </div>
                    <RollbackBar rate={f.rollbackRate} />
                  </Row>
                ))
              }
            </Section>
          </>
        )}

        {/* ── Incidents ── */}
        {tab === "incidents" && !loading && data && (
          <>
            <Section title="Incident type breakdown" count={data.incidentHotspots?.length}>
              {data.incidentHotspots?.length === 0
                ? <Empty icon="✓" title="No incidents recorded" sub="Incidents detected and acknowledged by the engineering loop appear here." />
                : data.incidentHotspots?.map((h, i) => (
                  <Row key={i}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                        <Chip label={h.topSeverity} color={h.topSeverity === "critical" ? "#f55b5b" : "#f0b429"} />
                        <span style={{ fontSize: 11, color: "#c8cdd8", fontWeight: 600 }}>{h.type}</span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden", width: "100%" }}>
                        <div style={{ width: `${Math.min(100, (h.count / (data.incidentHotspots[0]?.count || 1)) * 100)}%`, height: "100%", background: h.criticalCount > 0 ? "#f55b5b" : "#f0b429", borderRadius: 2 }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <Chip label={`${h.count} total`} color="#8994b0" />
                      {h.open > 0 && <Chip label={`${h.open} open`} color="#f55b5b" />}
                    </div>
                  </Row>
                ))
              }
            </Section>

            {/* Learning patterns */}
            {data.patterns?.length > 0 && (
              <Section title="Repeated failure patterns" count={data.patterns?.length}>
                {data.patterns.map((p, i) => (
                  <Row key={i}>
                    <Chip label={`×${p.count}`} color="#f0b429" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, color: "#c8cdd8" }}>{p.type}</div>
                      {p.description && <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{p.description}</div>}
                    </div>
                    <Chip label={p.impact || "unknown impact"} color="#8994b0" />
                  </Row>
                ))}
              </Section>
            )}
          </>
        )}

        {/* ── Recovery Map ── */}
        {tab === "recovery" && !loading && data && (
          <>
            <Section title="Recovery dependency chains" count={data.recoveryMap?.length}>
              {data.recoveryMap?.length === 0
                ? <Empty icon="⧗" title="No recovery chains yet" sub="Run the engineering loop with healing enabled to build recovery maps." />
                : data.recoveryMap?.map((c, i) => (
                  <Row key={i}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#c8cdd8", marginBottom: 2 }}>{c.chainName}</div>
                      {c.description && <div style={{ fontSize: 9, color: "#8994b0" }}>{c.description}</div>}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <Chip label={`${c.confidence}% confidence`} color={c.confidence >= 70 ? "#52d68a" : "#f0b429"} />
                      <Chip label={`${c.steps} steps`} color="#8994b0" />
                    </div>
                  </Row>
                ))
              }
            </Section>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <StatCard label="Heal total"  value={ps.healTotal}  color="#44a2ff" />
              <StatCard label="Heal rate"   value={ps.healRate != null ? `${ps.healRate}%` : "—"} color={ps.healRate > 70 ? "#52d68a" : "#f0b429"} />
            </div>
          </>
        )}

        {/* ── Auto-Check ── */}
        {tab === "autocheck" && (
          <div>
            <div style={{ marginBottom: 20, padding: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#c8cdd8", marginBottom: 12 }}>Run a pre-action safety check</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {["apply", "deploy", "auto-fix"].map(a => (
                  <button key={a} onClick={() => setAcAction(a)}
                    style={{ padding: "4px 12px", fontSize: 10, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
                      background: acAction === a ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${acAction === a ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.09)"}`,
                      color: acAction === a ? "#44a2ff" : "#8994b0", fontWeight: acAction === a ? 700 : 400 }}>
                    {a}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea value={acTask} onChange={e => setAcTask(e.target.value)}
                  placeholder="Task / change description…"
                  rows={2} style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 12, fontFamily: "inherit", resize: "vertical" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={acFile} onChange={e => setAcFile(e.target.value)}
                    placeholder="File path (optional)"
                    style={{ flex: 2, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
                  <input value={acPatchId} onChange={e => setAcPatchId(e.target.value)}
                    placeholder="Patch ID (optional)"
                    style={{ flex: 1, padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "inherit" }} />
                  <button onClick={runAutoCheck} disabled={acLoading || (!acTask && !acFile)}
                    style={{ padding: "6px 16px", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
                    {acLoading ? "…" : "Check"}
                  </button>
                </div>
              </div>
            </div>

            {acResult?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 12 }}>Error: {acResult.error}</div>}

            {acResult && !acResult.error && (
              <>
                {/* Pre-action warning */}
                <Section title="Pre-action warning">
                  {(() => {
                    const w = acResult.warning;
                    const col = rc(w?.riskLevel);
                    return w?.shouldWarn ? (
                      <>
                        <Row style={{ background: col + "08" }}>
                          <Chip label={w.riskLevel?.toUpperCase()} color={col} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: "#c8cdd8", fontWeight: 600 }}>{w.summary}</div>
                            <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>Score: {w.riskScore}/100</div>
                          </div>
                        </Row>
                        {w.warnings?.map((ww, i) => (
                          <Row key={i}>
                            <span style={{ fontSize: 10, color: col }}>✗</span>
                            <span style={{ fontSize: 10, color: "#c8cdd8" }}>{ww}</span>
                          </Row>
                        ))}
                        {w.alternatives?.map((a, i) => (
                          <Row key={i} style={{ background: "rgba(82,214,138,0.04)" }}>
                            <span style={{ fontSize: 10, color: "#52d68a" }}>→</span>
                            <span style={{ fontSize: 10, color: "#c8cdd8" }}>{a}</span>
                          </Row>
                        ))}
                      </>
                    ) : (
                      <Row><span style={{ fontSize: 11, color: "#52d68a" }}>✓ {w?.summary || "Safe to proceed"}</span></Row>
                    );
                  })()}
                </Section>

                {/* Incident check */}
                <Section title="Incident pattern check">
                  {(() => {
                    const ic = acResult.incident;
                    return ic?.shouldWarn ? (
                      <>
                        <Row>
                          <Chip label={ic.severity} color={rc(ic.severity)} />
                          <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{ic.summary}</span>
                        </Row>
                        {ic.incidentMatches?.slice(0, 3).map((m, i) => (
                          <Row key={i}>
                            <Chip label={m.type || "incident"} color={rc(ic.severity)} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 9, color: "#c8cdd8" }}>{m.context || "(no context)"}</div>
                            </div>
                            <Chip label={`${m.matchScore}%`} color="#8994b0" />
                          </Row>
                        ))}
                      </>
                    ) : (
                      <Row><span style={{ fontSize: 11, color: "#52d68a" }}>✓ {ic?.summary || "No prior incidents detected"}</span></Row>
                    );
                  })()}
                </Section>

                {/* Regression check */}
                <Section title="Regression check">
                  {(() => {
                    const rg = acResult.regression;
                    return rg?.hasRegressions ? (
                      <>
                        <Row>
                          <Chip label={rg.severity} color={rc(rg.severity)} />
                          <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{rg.summary}</span>
                        </Row>
                        {rg.regressionWarnings?.slice(0, 3).map((w, i) => (
                          <Row key={i}>
                            <span style={{ fontSize: 10, color: rc(rg.severity) }}>⚠</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 9, color: "#c8cdd8" }}>{w.recommendation || w.description}</div>
                            </div>
                            {w.matchScore && <Chip label={`${w.matchScore}% match`} color="#f0b429" />}
                          </Row>
                        ))}
                      </>
                    ) : (
                      <Row><span style={{ fontSize: 11, color: "#52d68a" }}>✓ {rg?.summary || "No regression risks"}</span></Row>
                    );
                  })()}
                </Section>
              </>
            )}

            {!acResult && !acLoading && (
              <div style={{ textAlign: "center", padding: "36px 20px", color: "#8994b0" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>⧖</div>
                <div style={{ fontSize: 12, color: "#c8cdd8" }}>Enter task details to run a safety check</div>
                <div style={{ fontSize: 10, marginTop: 4 }}>Checks pre-action warnings · incident patterns · regression risks</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
