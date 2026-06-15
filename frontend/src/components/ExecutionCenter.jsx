/**
 * ExecutionCenter — B9
 * Approval & Execution Layer
 * Tabs: Unified Queue · Execute · Analytics · Calibration · Ranked Candidates · Readiness
 */
import React, { useState, useEffect, useCallback } from "react";
import { BASE_URL } from "../_client";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";

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

const TIER_C  = { auto: "#52d68a", review: "#f0b429", block: "#f55b5b" };
const RISK_C  = { low: "#52d68a", moderate: "#f0b429", high: "#f0a028", critical: "#f55b5b" };
const OUT_C   = { applied: "#52d68a", verified: "#52d68a", deployed: "#44a2ff", planned: "#7c6fff",
                  rolled_back: "#f55b5b", failed: "#f55b5b", pending: "#f0b429" };
const LVLC    = { execution_ready: "#52d68a", mostly_ready: "#44a2ff", supervised: "#f0b429", manual: "#f55b5b" };

function tc(t) { return TIER_C[t]  || "#8994b0"; }
function rc(r) { return RISK_C[r]  || "#8994b0"; }
function oc(o) { return OUT_C[o]   || "#8994b0"; }
function lc(l) { return LVLC[l]    || "#8994b0"; }

const TYPE_ICON  = { patch_apply: "⬡", patch_deploy: "⇪", incident_fix: "⚡" };
const TYPE_COLOR = { patch_apply: "#44a2ff", patch_deploy: "#52d68a", incident_fix: "#f0b429" };

// ── micro components ──────────────────────────────────────────────────

function Chip({ label, color }) {
  const c = color || "#8994b0";
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
    color: c, background: c + "18", border: `1px solid ${c}30`, whiteSpace: "nowrap" }}>{label}</span>;
}

function Skel({ w = "100%", h = 12 }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 3,
    background: "rgba(255,255,255,0.06)", animation: "ec-pulse 1.4s ease-in-out infinite" }} />;
}

function Section({ title, children, count }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8994b0" }}>{title}</span>
        {count != null && <span style={{ fontSize: 9, color: "#8994b0", background: "rgba(255,255,255,0.07)", padding: "0 5px", borderRadius: 3 }}>{count}</span>}
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
    <div style={{ textAlign: "center", padding: "32px 20px", color: "#8994b0" }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#c8cdd8", marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 10 }}>{sub}</div>}
    </div>
  );
}

function RefBtn({ onClick, loading }) {
  return <button onClick={onClick} disabled={loading}
    style={{ fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, cursor: "pointer", color: "#8994b0" }}>
    {loading ? "…" : "⟳"}
  </button>;
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ flex: "1 1 72px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "9px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || "#e6edf3" }}>{value ?? "—"}</div>
      <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{label}</div>
      {sub != null && <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ScoreGauge({ score, level, size = 100 }) {
  const col = lc(level);
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - score / 100);
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={8}
        strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)" }} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 18, fontWeight: 700, fill: col }}>{score}</text>
      <text x={size/2} y={size/2+14} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 8, fill: "#8994b0" }}>/ 100</text>
    </svg>
  );
}

function SignalBar({ name, score, weight, rawValue }) {
  const col = score >= 80 ? "#52d68a" : score >= 60 ? "#f0b429" : "#f55b5b";
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{score}%</span>
        <span style={{ fontSize: 8, color: "#8994b0" }}>w={Math.round(weight * 100)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: col, borderRadius: 2, transition: "width 0.5s ease" }} />
      </div>
      {rawValue && <div style={{ fontSize: 8, color: col, marginTop: 2 }}>{rawValue}</div>}
    </div>
  );
}

function RateBar({ label, value, color, total }) {
  const pct = total > 0 && value != null ? Math.round((value / total) * 100) : (value ?? 0);
  const col = color || "#44a2ff";
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#c8cdd8" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function _ago(ts) {
  if (!ts) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return "—"; }
}

// ── Execution result inline ───────────────────────────────────────────

function ExecResult({ result, onClose }) {
  if (!result) return null;
  const col = oc(result.outcome);
  return (
    <div style={{ margin: "12px 0", padding: 16, background: col + "0d", border: `1px solid ${col}30`, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Chip label={result.outcome?.toUpperCase()} color={col} />
        <span style={{ fontSize: 11, color: "#c8cdd8", flex: 1 }}>Exec ID: {result.execId?.slice(0, 16)}…</span>
        {onClose && <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#8994b0", fontSize: 14 }}>✕</button>}
      </div>
      {/* Timeline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(result.timeline || []).map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 9, color: "#8994b0", width: 56, flexShrink: 0 }}>{t.step}</span>
            <span style={{ fontSize: 9, color: t.ok === false ? "#f55b5b" : t.ok === true ? "#52d68a" : "#c8cdd8" }}>
              {t.detail || t.error || t.note || (t.ok === true ? "✓" : t.ok === false ? "✗" : "")}
              {t.pass != null ? ` (${t.pass}P ${t.fail}F)` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── B9.1 Unified Queue ────────────────────────────────────────────────

function TabUnifiedQueue({ onSelectForExec }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/exec/unified-queue")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const all   = data?.items || [];
  const items = filter === "all" ? all : all.filter(i => i.type === filter || i.tier === filter);

  const FILTERS = [
    { id: "all",          label: `All (${all.length})` },
    { id: "auto",         label: `Auto (${all.filter(i=>i.tier==="auto").length})` },
    { id: "patch_apply",  label: `Apply (${all.filter(i=>i.type==="patch_apply").length})` },
    { id: "patch_deploy", label: `Deploy (${all.filter(i=>i.type==="patch_deploy").length})` },
    { id: "incident_fix", label: `Incidents (${all.filter(i=>i.type==="incident_fix").length})` },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            style={{ padding: "3px 10px", fontSize: 10, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
              background: filter === f.id ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${filter === f.id ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.08)"}`,
              color: filter === f.id ? "#44a2ff" : "#8994b0" }}>
            {f.label}
          </button>
        ))}
        <RefBtn onClick={load} loading={loading} />
      </div>

      {/* Summary bar */}
      {data?.summary && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <StatCard label="Auto-tier"   value={data.summary.autoTier}   color="#52d68a" />
          <StatCard label="Review"      value={data.summary.reviewTier}  color="#f0b429" />
          <StatCard label="Blocked"     value={data.summary.blockTier}   color="#f55b5b" />
          <StatCard label="Patch apply" value={data.summary.patchApply}  color="#44a2ff" />
          <StatCard label="Deploy"      value={data.summary.patchDeploy} color="#52d68a" />
          <StatCard label="Incidents"   value={data.summary.incidentFix} color="#f0b429" />
        </div>
      )}

      {loading && [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}
      {!loading && items.length === 0 && <Empty icon="✓" title="Queue empty" sub="All items handled or no pending work." />}

      {items.map(item => (
        <div key={item.id} style={{ marginBottom: 8, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px",
            background: item.tier === "auto" ? "rgba(82,214,138,0.04)" : "rgba(255,255,255,0.01)" }}>
            <span style={{ fontSize: 14, color: TYPE_COLOR[item.type] || "#8994b0" }}>{TYPE_ICON[item.type] || "•"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 2, flexWrap: "wrap" }}>
                <Chip label={item.type?.replace(/_/g," ")} color={TYPE_COLOR[item.type]} />
                <Chip label={item.tierLabel || item.tier} color={tc(item.tier)} />
                {item.riskLevel && <Chip label={item.riskLevel} color={rc(item.riskLevel)} />}
                <span style={{ fontSize: 9, color: "#8994b0" }}>rank score {item.rankScore}</span>
              </div>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.filePath || item.incidentType || item.id?.slice(0,16)}
              </div>
              {item.reason && <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{item.reason.slice(0,80)}</div>}
              {item.explanation?.length > 0 && <div style={{ fontSize: 8, color: "#f0b429", marginTop: 1 }}>{item.explanation[0]}</div>}
              <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>
                {item.safetyScore != null ? `Safety ${item.safetyScore}/100 · Conf ${item.confidenceScore}%` : ""}
                {item.detectedAt ? ` · detected ${_ago(item.detectedAt)}` : ""}
                {item.proposedAt ? ` · proposed ${_ago(item.proposedAt)}` : ""}
              </div>
            </div>
            {item.tier !== "block" && (
              <button onClick={() => onSelectForExec?.(item)}
                style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
                  background: tc(item.tier) + "18", border: `1px solid ${tc(item.tier)}40`, color: tc(item.tier), whiteSpace: "nowrap" }}>
                {item.actionLabel || "Execute"}
              </button>
            )}
            {item.tier === "block" && <Chip label="BLOCKED" color="#f55b5b" />}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── B9.2 One-Click Execute ────────────────────────────────────────────

function TabExecute({ selectedItem, onClearSelected }) {
  const [id,       setId]       = useState(selectedItem?.id       || "");
  const [type,     setType]     = useState(selectedItem?.type     || "patch_apply");
  const [tier,     setTier]     = useState(selectedItem?.tier     || "review");
  const [skipVerify, setSkipVerify] = useState(false);
  const [running,  setRunning]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [history,  setHistory]  = useState([]);

  useEffect(() => {
    if (selectedItem) {
      setId(selectedItem.id || "");
      setType(selectedItem.type || "patch_apply");
      setTier(selectedItem.tier || "review");
      setResult(null);
    }
  }, [selectedItem]);

  async function execute() {
    if (!id.trim()) return;
    setRunning(true); setResult(null);
    try {
      const r = await _post(`/runtime/exec/execute/${encodeURIComponent(id)}`, {
        type, operatorId: "operator", predictedTier: tier, skipVerify,
      });
      setResult(r);
      setHistory(prev => [r, ...prev].slice(0, 10));
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setRunning(false);
    }
  }

  const TYPES = ["patch_apply", "patch_deploy", "incident_fix"];
  const TIERS = ["auto", "review", "block"];

  return (
    <div>
      {/* Form */}
      <div style={{ padding: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#c8cdd8", marginBottom: 12 }}>One-Click Execution</div>

        {selectedItem && (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(68,162,255,0.06)", border: "1px solid rgba(68,162,255,0.2)", borderRadius: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#44a2ff", fontWeight: 600 }}>From queue: {selectedItem.type?.replace(/_/g," ")}</span>
              <button onClick={onClearSelected} style={{ background: "none", border: "none", cursor: "pointer", color: "#8994b0", fontSize: 11 }}>✕</button>
            </div>
            <div style={{ fontSize: 9, fontFamily: "monospace", color: "#8994b0", marginTop: 2 }}>
              {selectedItem.filePath || selectedItem.incidentType || id}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={id} onChange={e => setId(e.target.value)}
            placeholder="Item ID — patch ID or incident ID"
            style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 5, color: "#e6edf3", fontSize: 11, fontFamily: "monospace" }} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: "#8994b0", marginBottom: 4 }}>Type</div>
              <div style={{ display: "flex", gap: 4 }}>
                {TYPES.map(t => (
                  <button key={t} onClick={() => setType(t)}
                    style={{ padding: "3px 8px", fontSize: 9, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
                      background: type === t ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${type === t ? "rgba(68,162,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                      color: type === t ? "#44a2ff" : "#8994b0" }}>
                    {t.replace(/_/g," ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#8994b0", marginBottom: 4 }}>Predicted tier</div>
              <div style={{ display: "flex", gap: 4 }}>
                {TIERS.map(t => (
                  <button key={t} onClick={() => setTier(t)}
                    style={{ padding: "3px 8px", fontSize: 9, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
                      background: tier === t ? tc(t) + "18" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${tier === t ? tc(t) + "40" : "rgba(255,255,255,0.08)"}`,
                      color: tier === t ? tc(t) : "#8994b0" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={skipVerify} onChange={e => setSkipVerify(e.target.checked)} />
            <span style={{ fontSize: 10, color: "#8994b0" }}>Skip verify step (apply only)</span>
          </label>

          <button onClick={execute} disabled={running || !id.trim()}
            style={{ padding: "9px 0", background: "rgba(68,162,255,0.15)", border: "1px solid rgba(68,162,255,0.3)", borderRadius: 5, color: "#44a2ff", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "inherit", opacity: running ? 0.6 : 1 }}>
            {running ? "Executing…" : `⚡ Execute — ${type?.replace(/_/g," ")}`}
          </button>
        </div>
      </div>

      {result?.error && <div style={{ fontSize: 11, color: "#f55b5b", marginBottom: 12, padding: "8px 12px", background: "rgba(245,91,91,0.06)", borderRadius: 5 }}>Error: {result.error}</div>}
      {result && !result.error && <ExecResult result={result} onClose={() => setResult(null)} />}

      {/* Execution history */}
      {history.length > 0 && (
        <Section title="Recent executions" count={history.length}>
          {history.map((h, i) => (
            <Row key={i} style={{ alignItems: "center" }}>
              <Chip label={h.outcome?.toUpperCase()} color={oc(h.outcome)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "#c8cdd8" }}>{h.type?.replace(/_/g," ")} — {h.itemId?.slice(0,16)}…</div>
                <div style={{ fontSize: 8, color: "#8994b0", marginTop: 1 }}>{_ago(h.generatedAt)} · {h.timeline?.length} steps</div>
              </div>
              <Chip label={`${h.timeline?.length ?? 0} steps`} color="#8994b0" />
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

// ── B9.3 Analytics ────────────────────────────────────────────────────

function TabAnalytics() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/exec/analytics")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const a = data?.analytics || {};
  const p = data?.platform  || {};
  const t = data?.trend7d   || {};

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, justifyContent: "flex-end" }}><RefBtn onClick={load} loading={loading} /></div>

      {loading && [0,1,2,3,4].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {data && !data.error && !loading && (
        <>
          {/* Stat cards */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <StatCard label="Total decisions"      value={a.total}              color="#c8cdd8" />
            <StatCard label="Approved"             value={a.approved}           color="#52d68a" />
            <StatCard label="Rejected"             value={a.rejected}           color="#f55b5b" />
            <StatCard label="Deferred"             value={a.deferred}           color="#f0b429" />
            <StatCard label="Exec total"           value={a.execTotal}          color="#44a2ff" />
            <StatCard label="Exec success"         value={a.execSuccess}        color="#52d68a" />
          </div>

          {/* Rate bars */}
          <Section title="Approval metrics">
            <div style={{ padding: "12px 14px" }}>
              <RateBar label="Approval rate"                 value={a.approvalRate}             color="#52d68a" />
              <RateBar label="Rejection rate"               value={a.rejectionRate}            color="#f55b5b" />
              <RateBar label="Rollback after approval"      value={a.rollbackAfterApprovalRate} color="#f0a028" />
              <RateBar label="Recommendation accuracy"      value={a.recommendationAccuracy}   color="#44a2ff" />
              <RateBar label="Execution success rate"       value={a.execSuccessRate}           color="#7c6fff" />
            </div>
          </Section>

          {/* 7d trend */}
          <Section title="Last 7 days">
            <Row>
              <StatCard label="Approved"  value={t.approved}  color="#52d68a" />
              <StatCard label="Succeeded" value={t.success}   color="#52d68a" />
              <StatCard label="Accuracy"  value={t.accuracy != null ? `${t.accuracy}%` : "—"} color={t.accuracy >= 70 ? "#52d68a" : "#f0b429"} />
            </Row>
          </Section>

          {/* Platform */}
          <Section title="Platform">
            <Row>
              <StatCard label="Total patches"  value={p.totalPatches}  />
              <StatCard label="Rollback rate"  value={p.rollbackRate != null ? `${p.rollbackRate}%` : "—"} color={p.rollbackRate > 30 ? "#f55b5b" : "#52d68a"} />
              <StatCard label="Heal total"     value={p.healTotal}     color="#44a2ff" />
              <StatCard label="Heal rate"      value={p.healRate != null ? `${p.healRate}%` : "—"} color={p.healRate > 70 ? "#52d68a" : "#f0b429"} />
            </Row>
          </Section>

          {a.total === 0 && (
            <div style={{ fontSize: 11, color: "#8994b0", textAlign: "center", padding: 20 }}>
              No decisions recorded yet. Approve/reject items through the Unified Queue or Recommendation Center.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── B9.4 Calibration ──────────────────────────────────────────────────

function TabCalibration() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/exec/confidence-calibration")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8994b0" }}>Compares predicted confidence tier to actual outcomes — calibrates the prediction model.</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {data && !data.error && !loading && (
        <>
          {/* Overall */}
          <div style={{ display: "flex", gap: 16, marginBottom: 20, padding: 16,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: data.overallAccuracy >= 70 ? "#52d68a" : "#f0b429" }}>
                {data.overallAccuracy ?? "—"}%
              </div>
              <div style={{ fontSize: 9, color: "#8994b0" }}>Overall accuracy</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#c8cdd8", marginBottom: 4 }}>
                {data.note || `Based on ${data.totalSamples} sample(s)`}
              </div>
              <div style={{ fontSize: 10, color: "#8994b0" }}>
                Drift: <span style={{ color: data.drift?.signal === "stable" ? "#52d68a" : "#f0b429" }}>{data.drift?.signal}</span>
                {" · "}{data.drift?.window} recent samples
              </div>
            </div>
          </div>

          {/* Per-tier breakdown */}
          <Section title="Per-tier accuracy">
            {(data.calibration || []).map(c => (
              <div key={c.tier} style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <Chip label={c.tier.toUpperCase()} color={tc(c.tier)} />
                  <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{c.samples} sample(s)</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: c.accuracy >= 70 ? "#52d68a" : c.accuracy >= 50 ? "#f0b429" : c.accuracy == null ? "#8994b0" : "#f55b5b" }}>
                    {c.accuracy ?? "—"}%
                  </span>
                </div>
                {c.samples > 0 && (
                  <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ width: `${c.accuracy ?? 0}%`, height: "100%", borderRadius: 2, background: tc(c.tier), transition: "width 0.5s ease" }} />
                  </div>
                )}
                {/* Outcome distribution */}
                {Object.keys(c.distribution || {}).length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {Object.entries(c.distribution).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 8, color: "#8994b0", background: "rgba(255,255,255,0.05)", padding: "1px 5px", borderRadius: 2 }}>
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                )}
                {c.samples === 0 && <div style={{ fontSize: 9, color: "#8994b0" }}>No samples yet for this tier</div>}
              </div>
            ))}
          </Section>

          {data.totalSamples === 0 && (
            <div style={{ fontSize: 11, color: "#8994b0", textAlign: "center", padding: 16 }}>
              Make decisions through the Execute tab with a predicted tier set — calibration builds over time.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── B9.5 Ranked Candidates ────────────────────────────────────────────

function TabRankedCandidates({ onSelectForExec }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/exec/ranked-candidates")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidates = data?.candidates || [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#8994b0" }}>Ranked by safety 35% + confidence 25% + historical success 25% + tier bonus 15%</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {/* Top pick callout */}
      {data?.topPick && (
        <div style={{ marginBottom: 16, padding: 14, background: "rgba(82,214,138,0.06)", border: "1px solid rgba(82,214,138,0.25)", borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#52d68a", marginBottom: 4 }}>★ TOP RECOMMENDATION</div>
          <div style={{ fontSize: 11, color: "#c8cdd8", marginBottom: 4, fontFamily: "monospace" }}>{data.topPick.filePath}</div>
          <div style={{ fontSize: 9, color: "#8994b0", marginBottom: 8 }}>{data.topPickReason}</div>
          <button onClick={() => onSelectForExec?.({ ...data.topPick, type: "patch_apply", actionLabel: "Apply Patch" })}
            style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
              background: "rgba(82,214,138,0.15)", border: "1px solid rgba(82,214,138,0.35)", color: "#52d68a" }}>
            Execute Top Pick
          </button>
        </div>
      )}

      {!loading && candidates.length === 0 && (
        <Empty icon="⧗" title="No pending patches to rank" sub="Propose patches through the Engineering Workspace to populate this list." />
      )}

      <Section title={`All candidates (${candidates.length})`} count={candidates.length}>
        {candidates.map((c, i) => (
          <Row key={c.id} style={{ alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#8994b0", width: 20, textAlign: "right", flexShrink: 0 }}>#{c.rank}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.filePath}</div>
              <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{c.reason?.slice(0, 70)}</div>
              <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                <Chip label={`Safety ${c.safetyScore}/100`} color={rc(c.riskLevel)} />
                <Chip label={`Conf ${c.confidenceScore}%`}  color="#44a2ff" />
                <Chip label={`Hist ${c.historicalRate}%`}   color={c.historicalRate >= 70 ? "#52d68a" : "#f0b429"} />
                <Chip label={c.tierLabel || c.tier}          color={tc(c.tier)} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: c.compositeScore >= 70 ? "#52d68a" : "#f0b429" }}>{c.compositeScore}</span>
              <span style={{ fontSize: 8, color: "#8994b0" }}>composite</span>
              <button onClick={() => onSelectForExec?.({ ...c, type: "patch_apply", actionLabel: "Apply Patch" })}
                style={{ padding: "3px 10px", fontSize: 9, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
                  background: "rgba(68,162,255,0.1)", border: "1px solid rgba(68,162,255,0.25)", color: "#44a2ff" }}>
                Execute
              </button>
            </div>
          </Row>
        ))}
      </Section>
    </div>
  );
}

// ── B9.6 Execution Readiness ──────────────────────────────────────────

function TabReadiness() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/exec/readiness-dashboard")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>{[0,1,2,3,4].map(i=><Skel key={i}/>)}</div>;
  if (!data || data.error) return <Empty title="Could not load readiness" sub={data?.error} />;

  const col = lc(data.level);
  const a   = data.analytics || {};
  const m   = data.meta      || {};

  return (
    <div>
      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 24, padding: "20px 0" }}>
        <ScoreGauge score={data.compositeScore} level={data.level} size={108} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 21, fontWeight: 800, color: col, marginBottom: 4 }}>{data.badge}</div>
          <div style={{ fontSize: 12, color: "#8994b0", marginBottom: 8 }}>
            {m.totalDecisions ?? 0} decisions · {m.totalExec ?? 0} executions · {m.totalPatches ?? 0} patches · {m.healTotal ?? 0} heals
          </div>
          {data.strengths?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {data.strengths.map((s, i) => <Chip key={i} label={`✓ ${s}`} color="#52d68a" />)}
            </div>
          )}
        </div>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {/* Signals */}
      <Section title="Signal breakdown (5 dimensions)">
        {(data.signals || []).map((s, i) => (
          <SignalBar key={i} name={s.name} score={s.score} weight={s.weight} rawValue={s.rawValue} />
        ))}
      </Section>

      {/* Gaps */}
      {data.gaps?.length > 0 && (
        <Section title="Gaps to improve" count={data.gaps.length}>
          {data.gaps.map((g, i) => (
            <Row key={i}>
              <span style={{ fontSize: 11, color: "#f55b5b" }}>✗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#c8cdd8", fontWeight: 600 }}>{g.signal}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{g.action}</div>
              </div>
              <Chip label={`${g.score}%`} color="#f55b5b" />
            </Row>
          ))}
        </Section>
      )}

      {/* Analytics summary */}
      <Section title="Approval analytics">
        <div style={{ padding: "12px 14px" }}>
          <RateBar label="Approval rate"            value={a.approvalRate}             color="#52d68a" />
          <RateBar label="Rejection rate"           value={a.rejectionRate}            color="#f55b5b" />
          <RateBar label="Rollback after approval"  value={a.rollbackAfterApprovalRate} color="#f0a028" />
          <RateBar label="Recommendation accuracy"  value={a.recommendationAccuracy}   color="#44a2ff" />
          <RateBar label="Execution success rate"   value={a.execSuccessRate}           color="#7c6fff" />
        </div>
      </Section>

      {/* Recent executions */}
      {data.recentExecutions?.length > 0 && (
        <Section title="Recent executions" count={data.recentExecutions.length}>
          {data.recentExecutions.map((e, i) => (
            <Row key={e.id || i} style={{ alignItems: "center" }}>
              <Chip label={e.outcome?.toUpperCase()} color={oc(e.outcome)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#c8cdd8" }}>{e.type?.replace(/_/g," ")} — {e.id?.slice(5,21)}</div>
              </div>
              <span style={{ fontSize: 9, color: "#8994b0" }}>{_ago(e.createdAt)}</span>
            </Row>
          ))}
        </Section>
      )}

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right", marginTop: 8 }}>Generated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "queue",       label: "Unified Queue"      },
  { id: "execute",     label: "Execute"            },
  { id: "analytics",   label: "Analytics"          },
  { id: "calibration", label: "Calibration"        },
  { id: "ranked",      label: "Ranked Candidates"  },
  { id: "readiness",   label: "Exec Readiness"     },
];

export default function ExecutionCenter({ onNavigate }) {
  const [tab,          setTab]          = useState("queue");
  const [selectedItem, setSelectedItem] = useState(null);

  function handleSelectForExec(item) {
    setSelectedItem(item);
    setTab("execute");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes ec-pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>
      <PageHeader
        icon="⚡"
        title="Execution Center"
        subtitle="Unified queue · One-click execute · Approval analytics · Confidence calibration · Ranked candidates"
        actions={[{ label: "Reliability →", onClick: () => onNavigate?.("reliability") }, { label: "Guardrails →", onClick: () => onNavigate?.("guardrails"), primary: true }]}
        related={[
          { label: "Planning", tab: "jarvisbrain", icon: "🗺️" },
          { label: "Recommendation", tab: "recommend", icon: "✦" },
          { label: "Reliability", tab: "reliability", icon: "◈" },
          { label: "Prediction", tab: "predict", icon: "◇" },
          { label: "Guardrails", tab: "guardrails", icon: "◻" },
          { label: "Executive", tab: "executivedash", icon: "◉" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="execution" onNavigate={onNavigate} />
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? "#44a2ff" : "#8994b0",
                marginBottom: -1, whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 40px" }}>
        {tab === "queue"       && <TabUnifiedQueue      onSelectForExec={handleSelectForExec} />}
        {tab === "execute"     && <TabExecute           selectedItem={selectedItem} onClearSelected={() => setSelectedItem(null)} />}
        {tab === "analytics"   && <TabAnalytics />}
        {tab === "calibration" && <TabCalibration />}
        {tab === "ranked"      && <TabRankedCandidates  onSelectForExec={handleSelectForExec} />}
        {tab === "readiness"   && <TabReadiness />}
      </div>
    </div>
  );
}
