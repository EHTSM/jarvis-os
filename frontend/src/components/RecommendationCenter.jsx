/**
 * RecommendationCenter — B8
 * Recommendation & Approval Layer
 * Tabs: Recommended Fixes · Recommended Deploys · Pending Approvals · Decision History · Automation Candidates · Readiness
 */
import React, { useState, useEffect, useCallback } from "react";
import { BASE_URL } from "../_client";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";
import { clickableProps } from "../hooks/useClickableProps";

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

const TIER_COLOR  = { auto: "var(--success)", review: "var(--warning)", block: "var(--danger)" };
const RISK_COLOR  = { low: "var(--success)", moderate: "var(--warning)", high: "#f0a028", critical: "var(--danger)" };
const DEC_COLOR   = { approve: "var(--success)", reject: "var(--danger)", defer: "var(--warning)" };
const LEVEL_COLOR = { fully_autonomous: "var(--success)", mostly_autonomous: "#44a2ff", supervised: "var(--warning)", manual: "var(--danger)" };

function tc(t)  { return TIER_COLOR[t]  || "var(--text-dim)"; }
function rc(r)  { return RISK_COLOR[r]  || "var(--text-dim)"; }
function dc(d)  { return DEC_COLOR[d]   || "var(--text-dim)"; }
function lc(l)  { return LEVEL_COLOR[l] || "var(--text-dim)"; }

// ── micro components ──────────────────────────────────────────────────

function Chip({ label, color }) {
  const c = color || "var(--text-dim)";
  return <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
    color: c, background: c + "18", border: `1px solid ${c}30`, whiteSpace: "nowrap" }}>{label}</span>;
}

function Skel({ w = "100%", h = 12 }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 3,
    background: "rgba(255,255,255,0.06)", animation: "rc-pulse 1.4s ease-in-out infinite" }} />;
}

function Section({ title, children, count, action }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-dim)" }}>{title}</span>
        {count != null && <span style={{ fontSize: 9, color: "var(--text-dim)", background: "rgba(255,255,255,0.07)", padding: "0 5px", borderRadius: 3 }}>{count}</span>}
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
    <div style={{ textAlign: "center", padding: "32px 20px", color: "var(--text-dim)" }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 10 }}>{sub}</div>}
    </div>
  );
}

function RefBtn({ onClick, loading }) {
  return <button onClick={onClick} disabled={loading}
    style={{ fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, cursor: "pointer", color: "var(--text-dim)" }}>
    {loading ? "…" : "⟳"}
  </button>;
}

function EvidenceBar({ score, label }) {
  const col = score >= 75 ? "var(--success)" : score >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 56, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 9, color: col, fontWeight: 700 }}>{score}%</span>
      {label && <span style={{ fontSize: 8, color: "var(--text-dim)" }}>{label}</span>}
    </div>
  );
}

function ScoreGauge({ score, level, size = 88 }) {
  const col  = lc(level);
  const r    = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - score / 100);
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={8}
        strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1)" }} />
      <text x={size/2} y={size/2 + 1} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 17, fontWeight: 700, fill: col }}>{score}</text>
      <text x={size/2} y={size/2 + 14} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 8, fill: "var(--text-dim)" }}>/ 100</text>
    </svg>
  );
}

function SignalBar({ name, score, weight, rawValue, detail }) {
  const col = score >= 80 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "var(--text)", flex: 1 }}>{name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{score}%</span>
        <span style={{ fontSize: 8, color: "var(--text-dim)" }}>w={Math.round(weight * 100)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: col, borderRadius: 2, transition: "width 0.5s ease" }} />
      </div>
      {rawValue && <div style={{ fontSize: 8, color: col, marginTop: 2 }}>{rawValue}</div>}
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

// ── Approval buttons ──────────────────────────────────────────────────

function ApprovalButtons({ id, queueType, recommendation, onDecide, compact = false }) {
  const [deciding, setDeciding] = useState(false);
  const [done,     setDone]     = useState(null);
  const [decideErr, setDecideErr] = useState(null);

  async function decide(decision) {
    setDeciding(true);
    setDecideErr(null);
    try {
      await _post(`/runtime/approval-queue/${encodeURIComponent(id)}/decide`, { decision, queueType, recommendation });
      setDone(decision);
      onDecide?.(id, decision);
    } catch (e) {
      setDecideErr(`Decision failed: ${e.message}`);
    } finally {
      setDeciding(false);
    }
  }

  if (done) {
    return <Chip label={done.toUpperCase()} color={dc(done)} />;
  }

  const btnStyle = (col) => ({
    padding: compact ? "2px 10px" : "4px 14px",
    fontSize: 10, fontWeight: 600, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
    background: col + "18", border: `1px solid ${col}40`, color: col,
    opacity: deciding ? 0.5 : 1,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button onClick={() => decide("approve")} disabled={deciding} style={btnStyle("var(--success)")}>Approve</button>
        <button onClick={() => decide("defer")}   disabled={deciding} style={btnStyle("var(--warning)")}>Defer</button>
        <button onClick={() => decide("reject")}  disabled={deciding} style={btnStyle("var(--danger)")}>Reject</button>
      </div>
      {decideErr && <div role="alert" style={{ color: "var(--danger)", fontSize: 10, marginTop: 4 }}>{decideErr}</div>}
    </div>
  );
}

// ── B8.1 Recommended Fixes ────────────────────────────────────────────

function TabRecommendedFixes() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/recommend/all-incidents")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const incidents = data?.incidents || [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Top-3 ranked fixes per open incident, scored from KB + engineering memory + patch history</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "var(--danger)" }}>Error: {data.error}</div>}

      {!loading && incidents.length === 0 && (
        <Empty icon="✓" title="No open incidents" sub="All incidents resolved — or none detected yet." />
      )}

      {incidents.map((inc, i) => {
        const col    = rc(inc.severity === "critical" ? "critical" : inc.severity || "low");
        const isOpen = expanded === inc.incidentId;
        return (
          <div key={inc.incidentId} style={{ marginBottom: 12, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, overflow: "hidden" }}>
            {/* Incident header */}
            <div {...clickableProps(() => setExpanded(isOpen ? null : inc.incidentId))}
              style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", cursor: "pointer",
                background: isOpen ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)" }}>
              <Chip label={inc.severity?.toUpperCase() || "UNKNOWN"} color={col} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{inc.type || "Incident"}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{inc.context || "(no context)"}</div>
              </div>
              <Chip label={inc.tierLabel || inc.tier} color={tc(inc.tier)} />
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {/* Ranked fixes */}
            {isOpen && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                {inc.fixes?.length === 0
                  ? <Row><span style={{ fontSize: 11, color: "var(--text-dim)" }}>No ranked fixes available yet.</span></Row>
                  : inc.fixes?.map((f, fi) => (
                    <Row key={fi} style={{ alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", width: 18, flexShrink: 0 }}>#{fi + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{f.fix}</div>
                        {f.description && <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{f.description.slice(0, 100)}</div>}
                        <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                          <Chip label={f.source?.replace(/_/g, " ")} color="var(--text-dim)" />
                          {f.kind && <Chip label={f.kind} color="var(--accent)" />}
                        </div>
                      </div>
                      <EvidenceBar score={f.evidenceScore} label="evidence" />
                      <EvidenceBar score={f.confidence} label="conf" />
                    </Row>
                  ))
                }
                {/* Safest path callout */}
                {inc.topFix && (
                  <div style={{ padding: "8px 14px", background: "rgba(82,214,138,0.04)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "var(--success)", marginRight: 6 }}>SAFEST PATH →</span>
                    <span style={{ fontSize: 10, color: "var(--text)" }}>{inc.topFix.fix}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── B8.5 Recommended Deploys ──────────────────────────────────────────

function TabRecommendedDeploys() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [decided, setDecided] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/recommend/deploys")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deploys = data?.deploys || [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Applied patches ranked by safety score — approve to trigger deploy pipeline</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "var(--danger)" }}>Error: {data.error}</div>}

      {!loading && deploys.length === 0 && (
        <Empty icon="⇪" title="No applied patches" sub="Apply patches through the Engineering Workspace to see deploy recommendations." />
      )}

      <Section title={`Ready to deploy (${deploys.length})`} count={deploys.length}>
        {deploys.map((d, i) => (
          <Row key={d.id} style={{ alignItems: "center" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: rc(d.riskLevel), flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.filePath || "(unknown file)"}</div>
              <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>{d.reason?.slice(0, 80) || "—"} · applied {_ago(d.appliedAt)}</div>
              <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                <Chip label={`Safety ${d.safetyScore}/100`} color={rc(d.riskLevel)} />
                <Chip label={d.tierLabel || d.tier} color={tc(d.tier)} />
                {d.tierReason && <span style={{ fontSize: 8, color: "var(--text-dim)" }}>{d.tierReason}</span>}
              </div>
            </div>
            {decided[d.id]
              ? <Chip label={decided[d.id].toUpperCase()} color={dc(decided[d.id])} />
              : <ApprovalButtons id={d.id} queueType="deploy"
                  recommendation={`Deploy ${d.filePath} — safety ${d.safetyScore}/100`}
                  onDecide={(id, dec) => setDecided(p => ({ ...p, [id]: dec }))}
                  compact />
            }
          </Row>
        ))}
      </Section>
    </div>
  );
}

// ── B8.2 Pending Approvals ────────────────────────────────────────────

function TabPendingApprovals() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [decided, setDecided] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/approval-queue")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function onDecide(id, dec) { setDecided(p => ({ ...p, [id]: dec })); }

  const q = data || {};
  const TIER_BADGE = { auto: "Auto-apply ✓", review: "Review needed", block: "Blocked" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Approve / Reject / Defer — all decisions are logged and fed back into the learning system</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {/* Summary bar */}
      {q.summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total pending", value: q.summary.totalPending, color: "var(--text)" },
            { label: "Auto-apply",    value: q.summary.autoApplyCandidates, color: "var(--success)" },
            { label: "Review needed", value: q.summary.reviewNeeded, color: "var(--warning)" },
            { label: "Blocked",       value: q.summary.blocked, color: "var(--danger)" },
            { label: "Open incidents", value: q.summary.fixCount, color: "#f0a028" },
          ].map(s => (
            <div key={s.label} style={{ flex: "1 1 70px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value ?? "—"}</div>
              <div style={{ fontSize: 8, color: "var(--text-dim)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}

      {/* Pending patches */}
      <Section title="Pending patches" count={(q.pendingPatches || []).filter(p => !decided[p.id]).length}>
        {(q.pendingPatches || []).length === 0
          ? <Empty icon="✓" title="No pending patches" sub="Patches proposed by the engineering loop appear here." />
          : (q.pendingPatches || []).map(p => (
            <Row key={p.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.filePath}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>{p.reason?.slice(0, 80)} · proposed {_ago(p.proposedAt)}</div>
                <div style={{ marginTop: 4, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <Chip label={`Safety ${p.safetyScore}/100`} color={rc(p.riskLevel)} />
                  <Chip label={TIER_BADGE[p.tier] || p.tierLabel} color={tc(p.tier)} />
                  {p.explanation?.length > 0 && <span style={{ fontSize: 8, color: "var(--text-dim)" }}>{p.explanation[0]}</span>}
                </div>
              </div>
              {decided[p.id]
                ? <Chip label={decided[p.id].toUpperCase()} color={dc(decided[p.id])} />
                : p.tier !== "block"
                  ? <ApprovalButtons id={p.id} queueType="patch"
                      recommendation={`Patch ${p.filePath} — safety ${p.safetyScore}/100 — ${p.tierLabel}`}
                      onDecide={onDecide} compact />
                  : <Chip label="BLOCKED" color="var(--danger)" />
              }
            </Row>
          ))
        }
      </Section>

      {/* Pending incident fixes */}
      <Section title="Open incidents needing fix approval" count={(q.pendingFixes || []).length}>
        {(q.pendingFixes || []).length === 0
          ? <Empty icon="✓" title="No open incidents" />
          : (q.pendingFixes || []).map(inc => (
            <Row key={inc.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text)" }}>{inc.type || "Incident"}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>{inc.context?.slice(0, 80)} · {_ago(inc.detectedAt)}</div>
                <div style={{ marginTop: 4 }}>
                  <Chip label={inc.severity?.toUpperCase() || "UNKNOWN"} color={inc.severity === "critical" ? "var(--danger)" : "var(--warning)"} />
                </div>
              </div>
              {decided[inc.id]
                ? <Chip label={decided[inc.id].toUpperCase()} color={dc(decided[inc.id])} />
                : <ApprovalButtons id={inc.id} queueType="incident_fix"
                    recommendation={`Auto-fix incident ${inc.id} — ${inc.type}`}
                    onDecide={onDecide} compact />
              }
            </Row>
          ))
        }
      </Section>
    </div>
  );
}

// ── B8.4 Decision History ─────────────────────────────────────────────

function TabDecisionHistory() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [filterDec, setFilterDec] = useState("");
  const [filterType, setFilterType] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterDec)  qs.set("decision",  filterDec);
      if (filterType) qs.set("queueType", filterType);
      qs.set("limit", "50");
      setData(await _get(`/runtime/decisions?${qs}`));
    } catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, [filterDec, filterType]);

  useEffect(() => { load(); }, [load]);

  const entries = data?.entries || [];
  const stats   = data?.stats   || {};

  return (
    <div>
      {/* Stat bar */}
      {stats.total > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {[
            { label: "Total decisions", value: stats.total,       color: "var(--text)" },
            { label: "Approved",        value: stats.approved,    color: "var(--success)" },
            { label: "Rejected",        value: stats.rejected,    color: "var(--danger)" },
            { label: "Deferred",        value: stats.deferred,    color: "var(--warning)" },
            { label: "Success rate",    value: stats.successRate != null ? `${stats.successRate}%` : "—", color: stats.successRate >= 70 ? "var(--success)" : "var(--warning)" },
          ].map(s => (
            <div key={s.label} style={{ flex: "1 1 70px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value ?? "—"}</div>
              <div style={{ fontSize: 8, color: "var(--text-dim)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {["", "approve", "reject", "defer"].map(d => (
          <button key={d || "all"} onClick={() => setFilterDec(d)}
            style={{ padding: "3px 10px", fontSize: 10, borderRadius: 3, cursor: "pointer", fontFamily: "inherit",
              background: filterDec === d ? "rgba(68,162,255,0.15)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${filterDec === d ? "rgba(68,162,255,0.35)" : "rgba(255,255,255,0.08)"}`,
              color: filterDec === d ? "#44a2ff" : "var(--text-dim)" }}>
            {d || "All decisions"}
          </button>
        ))}
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "var(--danger)" }}>Error: {data.error}</div>}

      {!loading && entries.length === 0 && (
        <Empty icon="◎" title="No decisions recorded yet" sub="Use the Pending Approvals tab to approve/reject items — decisions are logged here." />
      )}

      <Section title={`Decision log (${entries.length})`} count={entries.length}>
        {entries.map((e, i) => (
          <Row key={e.id || i}>
            <Chip label={e.decision?.toUpperCase()} color={dc(e.decision)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: "var(--text)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.itemId?.slice(0, 16)}…
                </span>
                <Chip label={e.queueType || "unknown"} color="var(--text-dim)" />
              </div>
              {e.reason && <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{e.reason.slice(0, 100)}</div>}
              {e.recommendation && <div style={{ fontSize: 9, color: "var(--accent)" }}>{e.recommendation.slice(0, 100)}</div>}
              <div style={{ fontSize: 8, color: "var(--text-dim)", marginTop: 2 }}>{e.operatorId} · {_ago(e.createdAt)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <Chip label={e.outcome || "—"} color={e.outcome === "applied" ? "var(--success)" : e.outcome === "failed" ? "var(--danger)" : "var(--text-dim)"} />
              {e.actionSuccess === false && <Chip label="action failed" color="var(--danger)" />}
            </div>
          </Row>
        ))}
      </Section>
    </div>
  );
}

// ── B8.3 Automation Candidates ────────────────────────────────────────

function TabAutomationCandidates() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [decided, setDecided] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/recommend/automation-candidates")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidates = data?.candidates || [];

  return (
    <div>
      {/* Platform readiness */}
      {data && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, padding: 16,
          background: data.platformReady ? "rgba(82,214,138,0.05)" : "rgba(240,164,40,0.05)",
          border: `1px solid ${data.platformReady ? "rgba(82,214,138,0.2)" : "rgba(240,164,40,0.2)"}`,
          borderRadius: 8, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center", minWidth: 80 }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: data.platformReady ? "var(--success)" : "var(--warning)" }}>{data.platformScore ?? "—"}%</div>
            <div style={{ fontSize: 9, color: "var(--text-dim)" }}>platform score</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: data.platformReady ? "var(--success)" : "var(--warning)", marginBottom: 4 }}>
              {data.platformReady ? "Platform ready for automation" : "Platform not ready for full automation"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Rollback rate: <span style={{ color: data.rollbackRate > 30 ? "var(--danger)" : "var(--success)" }}>{data.rollbackRate}%</span></span>
              {data.healRate != null && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Heal rate: <span style={{ color: data.healRate > 70 ? "var(--success)" : "var(--warning)" }}>{data.healRate}%</span></span>}
            </div>
          </div>
          <RefBtn onClick={load} loading={loading} />
        </div>
      )}

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "var(--danger)" }}>Error: {data.error}</div>}

      {!loading && candidates.length === 0 && (
        <Empty icon="⧗" title="No auto-apply candidates" sub="Candidates appear when patches reach safety ≥ 80%, risk < 30%, confidence ≥ 70%." />
      )}

      {/* Auto patches */}
      {candidates.filter(c => c.type === "patch").length > 0 && (
        <Section title="Auto-apply candidates (patches)" count={candidates.filter(c => c.type === "patch").length}>
          {candidates.filter(c => c.type === "patch").map(c => (
            <Row key={c.id} style={{ alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.filePath}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>{c.reason?.slice(0, 80)} · {_ago(c.proposedAt)}</div>
                <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <Chip label={`Safety ${c.safetyScore}/100`} color="var(--success)" />
                  <Chip label={`Conf ${c.confidenceScore}%`} color="#44a2ff" />
                  <span style={{ fontSize: 8, color: "var(--text-dim)" }}>{c.tierReason}</span>
                </div>
              </div>
              {decided[c.id]
                ? <Chip label={decided[c.id].toUpperCase()} color={dc(decided[c.id])} />
                : <ApprovalButtons id={c.id} queueType="patch"
                    recommendation={`AUTO: Patch ${c.filePath} — safety ${c.safetyScore}/100`}
                    onDecide={(id, dec) => setDecided(p => ({ ...p, [id]: dec }))} compact />
              }
            </Row>
          ))}
        </Section>
      )}

      {/* Auto deploys */}
      {candidates.filter(c => c.type === "deploy").length > 0 && (
        <Section title="Auto-deploy candidates" count={candidates.filter(c => c.type === "deploy").length}>
          {candidates.filter(c => c.type === "deploy").map(c => (
            <Row key={c.id} style={{ alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.filePath}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 1 }}>Applied {_ago(c.appliedAt)}</div>
                <div style={{ marginTop: 3 }}>
                  <Chip label={`Safety ${c.safetyScore}/100`} color="var(--success)" />
                </div>
              </div>
              {decided[c.id]
                ? <Chip label={decided[c.id].toUpperCase()} color={dc(decided[c.id])} />
                : <ApprovalButtons id={c.id} queueType="deploy"
                    recommendation={`AUTO: Deploy ${c.filePath}`}
                    onDecide={(id, dec) => setDecided(p => ({ ...p, [id]: dec }))} compact />
              }
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

// ── B8.6 Autonomous Readiness Score ──────────────────────────────────

function TabAutonomousReadiness() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get("/runtime/recommend/autonomous-readiness")); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>{[0,1,2,3].map(i=><Skel key={i}/>)}</div>;
  if (!data || data.error) return <Empty title="Could not load readiness score" sub={data?.error} />;

  const col = lc(data.level);

  return (
    <div>
      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 24, padding: "20px 0" }}>
        <ScoreGauge score={data.compositeScore} level={data.level} size={110} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: col, marginBottom: 4 }}>{data.badge || data.level?.replace(/_/g, " ").toUpperCase()}</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>
            Based on {data.meta?.patchTotal ?? "—"} patches · {data.meta?.decisionTotal ?? "—"} decisions · {data.meta?.healTotal ?? "—"} healing events
          </div>
          {data.strengths?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {data.strengths.map((s, i) => <Chip key={i} label={`✓ ${s}`} color="var(--success)" />)}
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto" }}><RefBtn onClick={load} loading={loading} /></div>
      </div>

      {/* Signal breakdown */}
      <Section title="Signal breakdown (5 dimensions)">
        {(data.signals || []).map((s, i) => (
          <SignalBar key={i} name={s.name} score={s.score} weight={s.weight} rawValue={s.rawValue} detail={s.detail} />
        ))}
      </Section>

      {/* Blockers */}
      {data.blockers?.length > 0 && (
        <Section title="Blockers to higher autonomy" count={data.blockers.length}>
          {data.blockers.map((b, i) => (
            <Row key={i}>
              <span style={{ fontSize: 11, color: "var(--danger)" }}>✗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{b.signal}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>{b.recommendation}</div>
              </div>
              <Chip label={`${b.score}%`} color="var(--danger)" />
            </Row>
          ))}
        </Section>
      )}

      <div style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "right", marginTop: 8 }}>Generated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "fixes",      label: "Recommended Fixes"   },
  { id: "deploys",    label: "Recommended Deploys"  },
  { id: "approvals",  label: "Pending Approvals"    },
  { id: "history",    label: "Decision History"     },
  { id: "automation", label: "Automation Candidates" },
  { id: "readiness",  label: "Autonomous Readiness" },
];

export default function RecommendationCenter({ onNavigate }) {
  const [tab, setTab] = useState("approvals");

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "var(--text)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes rc-pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>
      <PageHeader
        icon="✦"
        title="Recommendation Center"
        subtitle="Ranked fixes · Deploy recommendations · Approval queue · Decision log · Automation candidates"
        related={[
          { label: "Prediction", tab: "predict", icon: "◇" },
          { label: "Guardrails", tab: "guardrails", icon: "◻" },
          { label: "Execution", tab: "execution", icon: "⚡" },
          { label: "Executive", tab: "executivedash", icon: "◉" },
          { label: "Intelligence", tab: "intel", icon: "◈" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="recommend" onNavigate={onNavigate} />
      <div style={{ padding: "16px 24px 0" }}>
        <div role="tablist" aria-label="Recommendation tabs" style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? "#44a2ff" : "var(--text-dim)",
                marginBottom: -1, whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 40px" }}>
        {tab === "fixes"      && <TabRecommendedFixes />}
        {tab === "deploys"    && <TabRecommendedDeploys />}
        {tab === "approvals"  && <TabPendingApprovals />}
        {tab === "history"    && <TabDecisionHistory />}
        {tab === "automation" && <TabAutomationCandidates />}
        {tab === "readiness"  && <TabAutonomousReadiness />}
      </div>
    </div>
  );
}
