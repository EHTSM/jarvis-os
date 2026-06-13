/**
 * RecommendationCenter — B8
 * Recommendation & Approval Layer
 * Tabs: Recommended Fixes · Recommended Deploys · Pending Approvals · Decision History · Automation Candidates · Readiness
 */
import React, { useState, useEffect, useCallback } from "react";
import { BASE_URL } from "../_client";

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

const TIER_COLOR  = { auto: "#52d68a", review: "#f0b429", block: "#f55b5b" };
const RISK_COLOR  = { low: "#52d68a", moderate: "#f0b429", high: "#f0a028", critical: "#f55b5b" };
const DEC_COLOR   = { approve: "#52d68a", reject: "#f55b5b", defer: "#f0b429" };
const LEVEL_COLOR = { fully_autonomous: "#52d68a", mostly_autonomous: "#44a2ff", supervised: "#f0b429", manual: "#f55b5b" };

function tc(t)  { return TIER_COLOR[t]  || "#8994b0"; }
function rc(r)  { return RISK_COLOR[r]  || "#8994b0"; }
function dc(d)  { return DEC_COLOR[d]   || "#8994b0"; }
function lc(l)  { return LEVEL_COLOR[l] || "#8994b0"; }

// ── micro components ──────────────────────────────────────────────────

function Chip({ label, color }) {
  const c = color || "#8994b0";
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

function EvidenceBar({ score, label }) {
  const col = score >= 75 ? "#52d68a" : score >= 50 ? "#f0b429" : "#f55b5b";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 56, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 9, color: col, fontWeight: 700 }}>{score}%</span>
      {label && <span style={{ fontSize: 8, color: "#8994b0" }}>{label}</span>}
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
        style={{ fontSize: 8, fill: "#8994b0" }}>/ 100</text>
    </svg>
  );
}

function SignalBar({ name, score, weight, rawValue, detail }) {
  const col = score >= 80 ? "#52d68a" : score >= 60 ? "#f0b429" : "#f55b5b";
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
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

  async function decide(decision) {
    setDeciding(true);
    try {
      await _post(`/runtime/approval-queue/${encodeURIComponent(id)}/decide`, { decision, queueType, recommendation });
      setDone(decision);
      onDecide?.(id, decision);
    } catch (e) {
      alert(`Decision failed: ${e.message}`);
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
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      <button onClick={() => decide("approve")} disabled={deciding} style={btnStyle("#52d68a")}>Approve</button>
      <button onClick={() => decide("defer")}   disabled={deciding} style={btnStyle("#f0b429")}>Defer</button>
      <button onClick={() => decide("reject")}  disabled={deciding} style={btnStyle("#f55b5b")}>Reject</button>
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
        <span style={{ fontSize: 11, color: "#8994b0" }}>Top-3 ranked fixes per open incident, scored from KB + engineering memory + patch history</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {!loading && incidents.length === 0 && (
        <Empty icon="✓" title="No open incidents" sub="All incidents resolved — or none detected yet." />
      )}

      {incidents.map((inc, i) => {
        const col    = rc(inc.severity === "critical" ? "critical" : inc.severity || "low");
        const isOpen = expanded === inc.incidentId;
        return (
          <div key={inc.incidentId} style={{ marginBottom: 12, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, overflow: "hidden" }}>
            {/* Incident header */}
            <div onClick={() => setExpanded(isOpen ? null : inc.incidentId)}
              style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", cursor: "pointer",
                background: isOpen ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)" }}>
              <Chip label={inc.severity?.toUpperCase() || "UNKNOWN"} color={col} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#c8cdd8" }}>{inc.type || "Incident"}</div>
                <div style={{ fontSize: 9, color: "#8994b0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{inc.context || "(no context)"}</div>
              </div>
              <Chip label={inc.tierLabel || inc.tier} color={tc(inc.tier)} />
              <span style={{ fontSize: 11, color: "#8994b0" }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {/* Ranked fixes */}
            {isOpen && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                {inc.fixes?.length === 0
                  ? <Row><span style={{ fontSize: 11, color: "#8994b0" }}>No ranked fixes available yet.</span></Row>
                  : inc.fixes?.map((f, fi) => (
                    <Row key={fi} style={{ alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#8994b0", width: 18, flexShrink: 0 }}>#{fi + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#c8cdd8", marginBottom: 2 }}>{f.fix}</div>
                        {f.description && <div style={{ fontSize: 9, color: "#8994b0" }}>{f.description.slice(0, 100)}</div>}
                        <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                          <Chip label={f.source?.replace(/_/g, " ")} color="#8994b0" />
                          {f.kind && <Chip label={f.kind} color="#7c6fff" />}
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
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#52d68a", marginRight: 6 }}>SAFEST PATH →</span>
                    <span style={{ fontSize: 10, color: "#c8cdd8" }}>{inc.topFix.fix}</span>
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
        <span style={{ fontSize: 11, color: "#8994b0" }}>Applied patches ranked by safety score — approve to trigger deploy pipeline</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {!loading && deploys.length === 0 && (
        <Empty icon="⇪" title="No applied patches" sub="Apply patches through the Engineering Workspace to see deploy recommendations." />
      )}

      <Section title={`Ready to deploy (${deploys.length})`} count={deploys.length}>
        {deploys.map((d, i) => (
          <Row key={d.id} style={{ alignItems: "center" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: rc(d.riskLevel), flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.filePath || "(unknown file)"}</div>
              <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{d.reason?.slice(0, 80) || "—"} · applied {_ago(d.appliedAt)}</div>
              <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                <Chip label={`Safety ${d.safetyScore}/100`} color={rc(d.riskLevel)} />
                <Chip label={d.tierLabel || d.tier} color={tc(d.tier)} />
                {d.tierReason && <span style={{ fontSize: 8, color: "#8994b0" }}>{d.tierReason}</span>}
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
        <span style={{ fontSize: 11, color: "#8994b0" }}>Approve / Reject / Defer — all decisions are logged and fed back into the learning system</span>
        <RefBtn onClick={load} loading={loading} />
      </div>

      {/* Summary bar */}
      {q.summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total pending", value: q.summary.totalPending, color: "#c8cdd8" },
            { label: "Auto-apply",    value: q.summary.autoApplyCandidates, color: "#52d68a" },
            { label: "Review needed", value: q.summary.reviewNeeded, color: "#f0b429" },
            { label: "Blocked",       value: q.summary.blocked, color: "#f55b5b" },
            { label: "Open incidents", value: q.summary.fixCount, color: "#f0a028" },
          ].map(s => (
            <div key={s.label} style={{ flex: "1 1 70px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value ?? "—"}</div>
              <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{s.label}</div>
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
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.filePath}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{p.reason?.slice(0, 80)} · proposed {_ago(p.proposedAt)}</div>
                <div style={{ marginTop: 4, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <Chip label={`Safety ${p.safetyScore}/100`} color={rc(p.riskLevel)} />
                  <Chip label={TIER_BADGE[p.tier] || p.tierLabel} color={tc(p.tier)} />
                  {p.explanation?.length > 0 && <span style={{ fontSize: 8, color: "#8994b0" }}>{p.explanation[0]}</span>}
                </div>
              </div>
              {decided[p.id]
                ? <Chip label={decided[p.id].toUpperCase()} color={dc(decided[p.id])} />
                : p.tier !== "block"
                  ? <ApprovalButtons id={p.id} queueType="patch"
                      recommendation={`Patch ${p.filePath} — safety ${p.safetyScore}/100 — ${p.tierLabel}`}
                      onDecide={onDecide} compact />
                  : <Chip label="BLOCKED" color="#f55b5b" />
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
                <div style={{ fontSize: 10, fontWeight: 600, color: "#c8cdd8" }}>{inc.type || "Incident"}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{inc.context?.slice(0, 80)} · {_ago(inc.detectedAt)}</div>
                <div style={{ marginTop: 4 }}>
                  <Chip label={inc.severity?.toUpperCase() || "UNKNOWN"} color={inc.severity === "critical" ? "#f55b5b" : "#f0b429"} />
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
            { label: "Total decisions", value: stats.total,       color: "#c8cdd8" },
            { label: "Approved",        value: stats.approved,    color: "#52d68a" },
            { label: "Rejected",        value: stats.rejected,    color: "#f55b5b" },
            { label: "Deferred",        value: stats.deferred,    color: "#f0b429" },
            { label: "Success rate",    value: stats.successRate != null ? `${stats.successRate}%` : "—", color: stats.successRate >= 70 ? "#52d68a" : "#f0b429" },
          ].map(s => (
            <div key={s.label} style={{ flex: "1 1 70px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value ?? "—"}</div>
              <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{s.label}</div>
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
              color: filterDec === d ? "#44a2ff" : "#8994b0" }}>
            {d || "All decisions"}
          </button>
        ))}
        <RefBtn onClick={load} loading={loading} />
      </div>

      {loading && [0,1,2,3].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {!loading && entries.length === 0 && (
        <Empty icon="◎" title="No decisions recorded yet" sub="Use the Pending Approvals tab to approve/reject items — decisions are logged here." />
      )}

      <Section title={`Decision log (${entries.length})`} count={entries.length}>
        {entries.map((e, i) => (
          <Row key={e.id || i}>
            <Chip label={e.decision?.toUpperCase()} color={dc(e.decision)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: "#c8cdd8", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.itemId?.slice(0, 16)}…
                </span>
                <Chip label={e.queueType || "unknown"} color="#8994b0" />
              </div>
              {e.reason && <div style={{ fontSize: 9, color: "#8994b0" }}>{e.reason.slice(0, 100)}</div>}
              {e.recommendation && <div style={{ fontSize: 9, color: "#7c6fff" }}>{e.recommendation.slice(0, 100)}</div>}
              <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{e.operatorId} · {_ago(e.createdAt)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <Chip label={e.outcome || "—"} color={e.outcome === "applied" ? "#52d68a" : e.outcome === "failed" ? "#f55b5b" : "#8994b0"} />
              {e.actionSuccess === false && <Chip label="action failed" color="#f55b5b" />}
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
            <div style={{ fontSize: 26, fontWeight: 800, color: data.platformReady ? "#52d68a" : "#f0b429" }}>{data.platformScore ?? "—"}%</div>
            <div style={{ fontSize: 9, color: "#8994b0" }}>platform score</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: data.platformReady ? "#52d68a" : "#f0b429", marginBottom: 4 }}>
              {data.platformReady ? "Platform ready for automation" : "Platform not ready for full automation"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 10, color: "#8994b0" }}>Rollback rate: <span style={{ color: data.rollbackRate > 30 ? "#f55b5b" : "#52d68a" }}>{data.rollbackRate}%</span></span>
              {data.healRate != null && <span style={{ fontSize: 10, color: "#8994b0" }}>Heal rate: <span style={{ color: data.healRate > 70 ? "#52d68a" : "#f0b429" }}>{data.healRate}%</span></span>}
            </div>
          </div>
          <RefBtn onClick={load} loading={loading} />
        </div>
      )}

      {loading && [0,1,2].map(i => <div key={i} style={{ marginBottom: 8 }}><Skel /></div>)}
      {data?.error && <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data.error}</div>}

      {!loading && candidates.length === 0 && (
        <Empty icon="⧗" title="No auto-apply candidates" sub="Candidates appear when patches reach safety ≥ 80%, risk < 30%, confidence ≥ 70%." />
      )}

      {/* Auto patches */}
      {candidates.filter(c => c.type === "patch").length > 0 && (
        <Section title="Auto-apply candidates (patches)" count={candidates.filter(c => c.type === "patch").length}>
          {candidates.filter(c => c.type === "patch").map(c => (
            <Row key={c.id} style={{ alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.filePath}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>{c.reason?.slice(0, 80)} · {_ago(c.proposedAt)}</div>
                <div style={{ marginTop: 3, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <Chip label={`Safety ${c.safetyScore}/100`} color="#52d68a" />
                  <Chip label={`Conf ${c.confidenceScore}%`} color="#44a2ff" />
                  <span style={{ fontSize: 8, color: "#8994b0" }}>{c.tierReason}</span>
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
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "#c8cdd8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.filePath}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 1 }}>Applied {_ago(c.appliedAt)}</div>
                <div style={{ marginTop: 3 }}>
                  <Chip label={`Safety ${c.safetyScore}/100`} color="#52d68a" />
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
          <div style={{ fontSize: 12, color: "#8994b0", marginBottom: 8 }}>
            Based on {data.meta?.patchTotal ?? "—"} patches · {data.meta?.decisionTotal ?? "—"} decisions · {data.meta?.healTotal ?? "—"} healing events
          </div>
          {data.strengths?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {data.strengths.map((s, i) => <Chip key={i} label={`✓ ${s}`} color="#52d68a" />)}
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
              <span style={{ fontSize: 11, color: "#f55b5b" }}>✗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#c8cdd8", fontWeight: 600 }}>{b.signal}</div>
                <div style={{ fontSize: 9, color: "#8994b0", marginTop: 2 }}>{b.recommendation}</div>
              </div>
              <Chip label={`${b.score}%`} color="#f55b5b" />
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
  { id: "fixes",      label: "Recommended Fixes"   },
  { id: "deploys",    label: "Recommended Deploys"  },
  { id: "approvals",  label: "Pending Approvals"    },
  { id: "history",    label: "Decision History"     },
  { id: "automation", label: "Automation Candidates" },
  { id: "readiness",  label: "Autonomous Readiness" },
];

export default function RecommendationCenter() {
  const [tab, setTab] = useState("approvals");

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes rc-pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>

      <div style={{ padding: "24px 24px 0" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#e6edf3" }}>Recommendation Center</h1>
        <p style={{ fontSize: 12, color: "#8994b0", margin: "0 0 20px" }}>
          Ranked fixes · Deploy recommendations · Approval queue · Decision log · Automation candidates · Autonomous readiness
        </p>
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
