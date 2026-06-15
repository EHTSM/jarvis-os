/**
 * ReliabilityCenter — B10
 * Production Reliability: Execution Success · Accuracy · Scorecard · Trends · Trust · Health Report
 */
import React, { useState, useEffect, useCallback } from "react";
import { BASE_URL } from "../_client";
import PageHeader from "./PageHeader";
import WorkflowNav from "./WorkflowNav";
import ContextSidebar from "./ContextSidebar";
import WorkflowStagePanel from "./WorkflowStagePanel";

async function _get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ── palette ──────────────────────────────────────────────────────────

const H_COLOR = { Healthy: "#52d68a", Good: "#44a2ff", Fair: "#f0b429", "Needs Attention": "#f55b5b" };
const T_COLOR = { high: "#52d68a", medium: "#44a2ff", low: "#f0b429", critical: "#f55b5b" };
const L_COLOR = { high_autonomy: "#52d68a", growing_autonomy: "#44a2ff", supervised: "#f0b429", manual: "#f55b5b", unknown: "#8994b0" };
const A_COLOR = { critical: "#f55b5b", warn: "#f0b429", info: "#44a2ff" };

function scoreColor(v) {
  if (v == null) return "#8994b0";
  return v >= 80 ? "#52d68a" : v >= 60 ? "#44a2ff" : v >= 40 ? "#f0b429" : "#f55b5b";
}

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

function SkeletonBlock() {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {[100, 80, 90, 70, 85].map((w, i) => <Skel key={i} w={w + "%"} h={14} />)}
  </div>;
}

function StatCard({ label, value, color, sub, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: "1 1 80px", background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "10px 12px",
      textAlign: "center", cursor: onClick ? "pointer" : "default",
      transition: "border-color 0.15s" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#e6edf3" }}>{value ?? "—"}</div>
      <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2, lineHeight: 1.3 }}>{label}</div>
      {sub != null && <div style={{ fontSize: 9, color: color || "#8994b0", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children, count, accent }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {accent && <div style={{ width: 3, height: 14, borderRadius: 2, background: accent, flexShrink: 0 }} />}
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

function RateBar({ label, value, color, note }) {
  const col = color || scoreColor(value);
  const pct = value != null ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#c8cdd8" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{value != null ? `${value}%` : "—"}</span>
      </div>
      <div style={{ height: 5, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.5s ease" }} />
      </div>
      {note && <div style={{ fontSize: 8, color: "#8994b0", marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function BigGauge({ score, label, color, size = 112 }) {
  const col  = color || scoreColor(score);
  const r    = size / 2 - 9;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - (score ?? 0) / 100);
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={9} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={9}
        strokeDasharray={circ} strokeDashoffset={fill} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1)" }} />
      <text x={size/2} y={size/2+1} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 19, fontWeight: 700, fill: score != null ? col : "#8994b0" }}>
        {score != null ? score : "—"}
      </text>
      <text x={size/2} y={size/2+15} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 8, fill: "#8994b0" }}>{label}</text>
    </svg>
  );
}

function RefBtn({ onClick, loading }) {
  return <button onClick={onClick} disabled={loading}
    style={{ fontSize: 9, padding: "2px 8px", background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, cursor: "pointer", color: "#8994b0" }}>
    {loading ? "…" : "⟳"}
  </button>;
}

function useData(path) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await _get(path)); }
    catch (e) { setData({ error: e.message }); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

function _ago(ts) {
  if (!ts) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  } catch { return "—"; }
}

function DataNote({ msg }) {
  if (!msg) return null;
  return <div style={{ margin: "12px 0", padding: "8px 12px", background: "rgba(68,162,255,0.06)", border: "1px solid rgba(68,162,255,0.18)", borderRadius: 5, fontSize: 10, color: "#8994b0" }}>
    ℹ {msg}
  </div>;
}

// ── B10.1 Execution Success ───────────────────────────────────────────

function TabExecSuccess() {
  const { data, loading, reload } = useData("/runtime/reliability/exec-success");

  if (loading) return <SkeletonBlock />;
  if (!data || data.error) return <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data?.error || "Failed to load"}</div>;

  const { patches: pm, healing: hs, agents: am, execLog: el, decisions: dec } = data;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><RefBtn onClick={reload} loading={loading} /></div>

      {/* Patch layer */}
      <Section title="Patch execution" accent="#44a2ff">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Total patches"  value={pm.total}      />
          <StatCard label="Applied"        value={pm.applied}    color="#52d68a" sub={`${pm.applyRate}%`} />
          <StatCard label="Rolled back"    value={pm.rolled}     color="#f55b5b" sub={`${pm.rollbackRate}%`} />
          <StatCard label="Pending"        value={pm.pending}    color="#f0b429" />
          <StatCard label="Patch success"  value={pm.successRate != null ? `${pm.successRate}%` : "—"} color={scoreColor(pm.successRate)} />
        </div>
        <RateBar label="Apply rate"     value={pm.applyRate}    color="#52d68a" />
        <RateBar label="Rollback rate"  value={pm.rollbackRate} color="#f55b5b" />
      </Section>

      {/* Heal layer */}
      <Section title="Healing engine" accent="#52d68a">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Total heals"   value={hs.total}   />
          <StatCard label="Success"       value={hs.success} color="#52d68a" sub={`${hs.rate}%`} />
          <StatCard label="Failed"        value={hs.fail}    color="#f55b5b" />
        </div>
        <RateBar label="Healing success rate" value={hs.rate} color={scoreColor(hs.rate)} />
      </Section>

      {/* Deploy / auto-fix */}
      <Section title="Deploys & auto-fix" accent="#7c6fff">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Deployments"   value={pm.deployCount}  color="#7c6fff" />
          <StatCard label="Auto-fixes"    value={pm.autoFixed}    color="#52d68a" />
        </div>
      </Section>

      {/* Agent layer */}
      <Section title="Agent runs & cycles" accent="#f0b429">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Agent runs"      value={am.total}        />
          <StatCard label="Run success"     value={am.success}      color="#52d68a" sub={`${am.rate}%`} />
          <StatCard label="Run failed"      value={am.failed}       color="#f55b5b" />
          <StatCard label="Cycles"          value={am.cycleTotal}   />
          <StatCard label="Cycle success"   value={am.cycleOk}      color="#52d68a" sub={`${am.cycleRate}%`} />
        </div>
        <RateBar label="Agent run success rate"  value={am.rate}      color={scoreColor(am.rate)} />
        <RateBar label="Cycle success rate"      value={am.cycleRate} color={scoreColor(am.cycleRate)} />
        {am.rate === 0 && <div style={{ padding: "8px 14px", fontSize: 9, color: "#8994b0" }}>Agent runs are failing due to missing CRM capability handlers — this is a known platform gap, not a Track-B issue.</div>}
      </Section>

      {/* B9 exec log layer */}
      <Section title="B9 execution log" accent="#8994b0">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Executions"  value={el.total} />
          <StatCard label="Success"     value={el.success} color="#52d68a" sub={el.successRate != null ? `${el.successRate}%` : undefined} />
          <StatCard label="Rolled back" value={el.rolled}  color="#f0a028" />
          <StatCard label="Failed"      value={el.failed}  color="#f55b5b" />
          <StatCard label="Decisions"   value={dec.total}  />
        </div>
        {el.total === 0 && <DataNote msg="Execution log populates as you use the Execution Center → Execute tab to approve and run items." />}
      </Section>

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right" }}>Updated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── B10.2 Accuracy Dashboard ──────────────────────────────────────────

function TabAccuracy() {
  const { data, loading, reload } = useData("/runtime/reliability/accuracy");

  if (loading) return <SkeletonBlock />;
  if (!data || data.error) return <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data?.error}</div>;

  const metrics = [
    { label: "Healing accuracy",        value: data.healingAccuracy,        note: "Heal success / total heals",                color: scoreColor(data.healingAccuracy) },
    { label: "Prediction accuracy",     value: data.predictionAccuracy,     note: `${data.tierSamples} decision samples`,     color: scoreColor(data.predictionAccuracy) },
    { label: "Recommendation accuracy", value: data.recommendationAccuracy, note: `${data.recSamples} approved decisions`,    color: scoreColor(data.recommendationAccuracy) },
    { label: "Guardrail hit rate",      value: data.guardrailHitRate,       note: `${data.guardSamples} patches evaluated`,   color: scoreColor(data.guardrailHitRate) },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><RefBtn onClick={reload} loading={loading} /></div>

      {/* Gauge row */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", padding: "16px 0", marginBottom: 16, flexWrap: "wrap" }}>
        {metrics.map(m => (
          <div key={m.label} style={{ textAlign: "center" }}>
            <BigGauge score={m.value} label="" color={m.color} size={90} />
            <div style={{ fontSize: 9, color: "#8994b0", marginTop: 4, maxWidth: 80 }}>{m.label}</div>
            <div style={{ fontSize: 8, color: "#8994b0", marginTop: 1 }}>{m.note}</div>
          </div>
        ))}
      </div>

      <Section title="Accuracy breakdown" accent="#44a2ff">
        {metrics.map(m => (
          <RateBar key={m.label} label={m.label} value={m.value} color={m.color} note={m.note} />
        ))}
      </Section>

      <Section title="Learning engine" accent="#7c6fff">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Failure patterns known"  value={data.patternCount}   color="#44a2ff" />
          <StatCard label="Agent success rate"      value={`${data.agentSuccessRate}%`} color={scoreColor(data.agentSuccessRate)} />
          <StatCard label="Patterns ingested"       value={data.learningEngine?.totalIngested ?? 0} />
          <StatCard label="Unique patterns"         value={data.learningEngine?.uniquePatterns ?? 0} color="#7c6fff" />
        </div>
      </Section>

      {data.note && <DataNote msg={data.note} />}
      {data.tierSamples === 0 && (
        <DataNote msg="Prediction & recommendation accuracy will populate as operator decisions are made through the Execution Center. Healing accuracy is computed from 2,000 real heal events." />
      )}
      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right", marginTop: 8 }}>Updated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── B10.3 Autonomous Scorecard ────────────────────────────────────────

function ScorecardWindow({ label, data }) {
  if (!data) return null;
  const col = scoreColor(data.autonomyScore);
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div style={{ textAlign: "center", minWidth: 80 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: data.autonomyScore != null ? col : "#8994b0" }}>
            {data.autonomyScore ?? "—"}
          </div>
          <div style={{ fontSize: 8, color: "#8994b0" }}>Autonomy Score</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", marginBottom: 6 }}>{label}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {data.heals       > 0 && <Chip label={`${data.heals} heals (${data.healRate ?? 0}%)`}          color={scoreColor(data.healRate)} />}
            {data.patches     > 0 && <Chip label={`${data.patches} patches (${data.patchRate ?? 0}%)`}      color={scoreColor(data.patchRate)} />}
            {data.deploys     > 0 && <Chip label={`${data.deploys} deploys`}                               color="#52d68a" />}
            {data.recoveries  > 0 && <Chip label={`${data.recoveries} recoveries`}                         color="#44a2ff" />}
            {data.heals === 0 && data.patches === 0 && <span style={{ fontSize: 9, color: "#8994b0" }}>No activity in this window</span>}
          </div>
        </div>
      </div>
      {data.autonomyScore != null && (
        <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <div style={{ width: `${data.autonomyScore}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.6s ease" }} />
        </div>
      )}
    </div>
  );
}

function TabScorecard() {
  const { data, loading, reload } = useData("/runtime/reliability/scorecard");

  if (loading) return <SkeletonBlock />;
  if (!data || data.error) return <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data?.error}</div>;

  const lCol = L_COLOR[data.level] || "#8994b0";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><RefBtn onClick={reload} loading={loading} /></div>

      {/* Level banner */}
      <div style={{ padding: 20, marginBottom: 20, background: lCol + "08", border: `1px solid ${lCol}25`, borderRadius: 8,
        display: "flex", alignItems: "center", gap: 20 }}>
        <BigGauge score={data.lifetime?.autonomyScore} label="Lifetime" color={lCol} size={110} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: lCol, marginBottom: 4 }}>{data.levelLabel}</div>
          <div style={{ fontSize: 11, color: "#8994b0", marginBottom: 10 }}>
            Measured across {data.lifetime?.heals ?? 0} heal events and {data.lifetime?.patches ?? 0} patches
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Chip label={`Trust score ${data.trustMetrics?.trustScore ?? "—"}`} color={T_COLOR[data.trustMetrics?.trustScore >= 60 ? "high" : "low"]} />
            {data.trustMetrics?.chainOk > 0 && <Chip label={`${data.trustMetrics.chainOk} chains completed`} color="#52d68a" />}
          </div>
        </div>
      </div>

      <Section title="Autonomy windows" accent={lCol}>
        <ScorecardWindow label="Today"         data={data.daily}    />
        <ScorecardWindow label="This week"     data={data.weekly}   />
        <ScorecardWindow label="All time"      data={data.lifetime} />
      </Section>

      <Section title="Trust metrics" accent="#44a2ff">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Patch applied"     value={data.trustMetrics?.approved}    color="#52d68a" />
          <StatCard label="Patch rejected"    value={data.trustMetrics?.rejected}    color="#f55b5b" />
          <StatCard label="Bad approvals"     value={data.trustMetrics?.badApproval} color="#f0a028" />
          <StatCard label="Deploy success"    value={data.trustMetrics?.deployOk}    color="#7c6fff" />
          <StatCard label="Recoveries"        value={data.trustMetrics?.recoveries}  color="#44a2ff" />
          <StatCard label="Chain success"     value={data.trustMetrics?.chainOk}     color="#52d68a" />
        </div>
      </Section>

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right" }}>Updated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── B10.4 Reliability Trends ──────────────────────────────────────────

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0;
  return <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
    <div style={{ width: 60, height: 6, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: color, transition: "width 0.4s ease" }} />
    </div>
    <span style={{ fontSize: 9, color: "#8994b0", width: 28 }}>{value}</span>
  </div>;
}

function TabTrends() {
  const { data, loading, reload } = useData("/runtime/reliability/trends");

  if (loading) return <SkeletonBlock />;
  if (!data || data.error) return <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data?.error}</div>;

  const { trendByDay, deployEvents, summary } = data;
  const maxHeals = Math.max(...(trendByDay || []).map(d => d.heals), 1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><RefBtn onClick={reload} loading={loading} /></div>

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard label="MTTR (proxy)"          value={summary.mttrProxyLabel}        color="#44a2ff" />
        <StatCard label="Incidents / day"       value={`~${summary.avgIncidentsPerDay}`} color="#f0b429" />
        <StatCard label="Healing success"       value={`${summary.healSuccessRate}%`} color={scoreColor(summary.healSuccessRate)} />
        <StatCard label="Avg attempts / heal"   value={summary.avgAttempts}           color="#8994b0" />
        <StatCard label="Agent runs"            value={summary.agentRunTotal}         />
        <StatCard label="Agent fail rate"       value={`${summary.agentFailRate}%`}   color="#f55b5b" />
      </div>

      {/* Daily healing trend */}
      <Section title={`Daily healing trend (${trendByDay?.length ?? 0} days)`} accent="#52d68a">
        {(trendByDay || []).length === 0
          ? <div style={{ padding: 20, textAlign: "center", fontSize: 11, color: "#8994b0" }}>No daily data</div>
          : (trendByDay || []).map(d => (
            <div key={d.date} style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#c8cdd8", width: 86, flexShrink: 0 }}>{d.date}</span>
                <Chip label={`${d.successRate}% success`} color={scoreColor(d.successRate)} />
                <span style={{ fontSize: 9, color: "#8994b0" }}>{d.success} ok · {d.fail} fail</span>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <div title="success" style={{ flex: d.success, height: 6, background: "#52d68a", borderRadius: "2px 0 0 2px", opacity: 0.8 }} />
                <div title="fail"    style={{ flex: d.fail,    height: 6, background: "#f55b5b", borderRadius: "0 2px 2px 0", opacity: 0.8 }} />
              </div>
              {Object.keys(d.strategies || {}).length > 0 && (
                <div style={{ marginTop: 3, display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {Object.entries(d.strategies).map(([k, v]) => (
                    <span key={k} style={{ fontSize: 8, color: "#8994b0" }}>{k}: {v}</span>
                  ))}
                </div>
              )}
            </div>
          ))
        }
      </Section>

      {/* Deploy events */}
      <Section title={`Deploy events (${deployEvents?.length ?? 0})`} accent="#7c6fff">
        {(deployEvents || []).length === 0
          ? <div style={{ padding: "12px 14px", fontSize: 10, color: "#8994b0" }}>No deploy telemetry recorded.</div>
          : (deployEvents || []).map((e, i) => (
            <div key={i} style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: e.ok ? "#52d68a" : "#f55b5b" }}>{e.ok ? "✓" : "✗"}</span>
              <Chip label={e.phase} color={e.ok ? "#52d68a" : "#f55b5b"} />
              <span style={{ fontSize: 9, color: "#8994b0" }}>{e.ts ? new Date(e.ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</span>
              {e.elapsedMs != null && <span style={{ fontSize: 9, color: "#8994b0" }}>{e.elapsedMs}ms</span>}
            </div>
          ))
        }
      </Section>

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right" }}>Updated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── B10.5 Operator Trust Score ────────────────────────────────────────

function TrustMeter({ score, level }) {
  const col = T_COLOR[level] || "#8994b0";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: 20,
      background: col + "08", border: `1px solid ${col}25`, borderRadius: 8, marginBottom: 20 }}>
      <BigGauge score={score} label="Trust" color={col} size={110} />
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: col, marginBottom: 4 }}>
          {level ? level.charAt(0).toUpperCase() + level.slice(1) : "—"} Trust
        </div>
        <div style={{ fontSize: 11, color: "#8994b0" }}>Based on operator approval history and recovery outcomes</div>
      </div>
    </div>
  );
}

function TabTrustScore() {
  const { data, loading, reload } = useData("/runtime/reliability/trust-score");

  if (loading) return <SkeletonBlock />;
  if (!data || data.error) return <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data?.error}</div>;

  const ft = data.fromTrustLog   || {};
  const fd = data.fromDecisionLog || {};
  const ch = data.chainMetrics   || {};

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><RefBtn onClick={reload} loading={loading} /></div>

      <TrustMeter score={data.trustScore} level={data.trustLevel} />

      <Section title="From operational trust log (real data)" accent="#52d68a">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Patches applied"  value={ft.approved}         color="#52d68a" />
          <StatCard label="Patches rejected" value={ft.rejected}         color="#f55b5b" />
          <StatCard label="Good approvals"   value={ft.successApprovals} color="#52d68a"
            sub={ft.approvalQuality != null ? `${ft.approvalQuality}% quality` : undefined} />
          <StatCard label="Bad approvals"    value={ft.badApproval}      color="#f0a028"
            sub="rolled back" />
          <StatCard label="Deploys ok"       value={ft.deployOk}         color="#7c6fff" />
          <StatCard label="Recoveries"       value={ft.recoveries}       color="#44a2ff" />
        </div>
        {ft.approvalQuality != null && (
          <RateBar label="Approval quality" value={ft.approvalQuality} color={scoreColor(ft.approvalQuality)}
            note="% of applied patches that were NOT rolled back" />
        )}
      </Section>

      <Section title="From B9 decision log" accent="#f0b429">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", flexWrap: "wrap" }}>
          <StatCard label="Approved"  value={fd.approved} color="#52d68a" />
          <StatCard label="Rejected"  value={fd.rejected} color="#f55b5b" />
          <StatCard label="Good"      value={fd.good}     color="#52d68a"
            sub={fd.quality != null ? `${fd.quality}% quality` : undefined} />
          <StatCard label="Bad"       value={fd.bad}      color="#f0a028" />
        </div>
        {fd.approved === 0 && <DataNote msg="B9 decision log is empty. Decisions recorded in Execution Center will populate this panel." />}
      </Section>

      <Section title="Chain / workflow metrics" accent="#44a2ff">
        <div style={{ display: "flex", gap: 8, padding: "10px 12px" }}>
          <StatCard label="Chains completed"   value={ch.ok}   color="#52d68a" />
          <StatCard label="Chains interrupted" value={ch.fail} color="#f55b5b" />
          {(ch.ok + ch.fail) > 0 && (
            <StatCard label="Chain success rate"
              value={`${Math.round(ch.ok / (ch.ok + ch.fail) * 100)}%`}
              color={scoreColor(Math.round(ch.ok / (ch.ok + ch.fail) * 100))} />
          )}
        </div>
      </Section>

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right" }}>
        Based on {data.totalTrustEvents} trust events · Updated {_ago(data.generatedAt)}
      </div>
    </div>
  );
}

// ── B10.6 Health Report ───────────────────────────────────────────────

function AlertItem({ level, msg }) {
  const col = A_COLOR[level] || "#8994b0";
  return (
    <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)",
      display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 10, color: col, flexShrink: 0 }}>
        {level === "critical" ? "✗" : level === "warn" ? "⚠" : "ℹ"}
      </span>
      <span style={{ fontSize: 10, color: col === "#8994b0" ? "#c8cdd8" : col }}>{msg}</span>
    </div>
  );
}

function SignalRow({ name, score, weight }) {
  const col = scoreColor(score);
  return (
    <div style={{ padding: "7px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#c8cdd8", flex: 1 }}>{name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{score}%</span>
        <span style={{ fontSize: 8, color: "#8994b0" }}>w={Math.round(weight * 100)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", borderRadius: 2, background: col, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function TabHealthReport() {
  const { data, loading, reload } = useData("/runtime/reliability/health-report");

  if (loading) return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 12, color: "#8994b0" }}>Generating system health report…</div>
      <SkeletonBlock />
    </div>
  );
  if (!data || data.error) return <div style={{ fontSize: 11, color: "#f55b5b" }}>Error: {data?.error}</div>;

  const healthCol = H_COLOR[data.healthLabel] || "#8994b0";
  const trajCol = data.trajectory === "improving" ? "#52d68a" : data.trajectory === "declining" ? "#f55b5b" : "#8994b0";
  const trajIcon = data.trajectory === "improving" ? "↑" : data.trajectory === "declining" ? "↓" : "→";
  const sec = data.sections || {};

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#8994b0" }}>One-click system health snapshot across all Track-B systems</div>
        <button onClick={reload} disabled={loading}
          style={{ padding: "6px 16px", fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
            background: "rgba(68,162,255,0.12)", border: "1px solid rgba(68,162,255,0.3)", color: "#44a2ff" }}>
          {loading ? "Generating…" : "⟳ Regenerate"}
        </button>
      </div>

      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, padding: 20, marginBottom: 20,
        background: healthCol + "08", border: `1px solid ${healthCol}25`, borderRadius: 10 }}>
        <BigGauge score={data.overallHealth} label="Health" color={healthCol} size={116} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: healthCol, marginBottom: 4 }}>
            {data.healthLabel}
            <span style={{ fontSize: 14, color: trajCol, marginLeft: 8 }}>{trajIcon} {data.trajectory}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <Chip label={`MTTR ${data.mttr}`} color="#44a2ff" />
            <Chip label={`Incidents ${data.incidentFrequency}`} color="#f0b429" />
            <Chip label={`Autonomy ${data.autonomyScore ?? "—"}`} color="#7c6fff" />
          </div>
          {/* Strengths */}
          {(data.strengths || []).map((s, i) => (
            <div key={i} style={{ fontSize: 10, color: "#52d68a", marginBottom: 2 }}>✓ {s}</div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {(data.alerts || []).length > 0 && (
        <Section title="System alerts" count={data.alerts.length} accent="#f0b429">
          {data.alerts.map((a, i) => <AlertItem key={i} level={a.level} msg={a.msg} />)}
        </Section>
      )}

      {/* Signals */}
      <Section title="Health signals" accent="#44a2ff">
        {(data.signals || []).map((s, i) => <SignalRow key={i} name={s.name} score={s.score} weight={s.weight} />)}
      </Section>

      {/* Section cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { title: "Patches",  items: [["Total", sec.patches?.total], ["Applied", sec.patches?.applied], ["Rolled back", sec.patches?.rolled], ["Rollback %", `${sec.patches?.rollbackRate}%`]] },
          { title: "Healing",  items: [["Total", sec.healing?.total], ["Success", sec.healing?.success], ["Failed", sec.healing?.fail], ["Rate", `${sec.healing?.rate}%`]] },
          { title: "Agents",   items: [["Runs", sec.agents?.total], ["Success%", `${sec.agents?.successRate}%`], ["Cycles", sec.agents?.cycleTotal], ["Cycle%", `${sec.agents?.cycleRate}%`]] },
          { title: "Trust",    items: [["Score", sec.trust?.trustScore], ["Applied", sec.trust?.approved], ["Rejected", sec.trust?.rejected], ["Bad", sec.trust?.badApproval]] },
          { title: "Accuracy", items: [["Healing", `${sec.accuracy?.healAccuracy}%`], ["Prediction", sec.accuracy?.predictionAccuracy != null ? `${sec.accuracy.predictionAccuracy}%` : "—"], ["Guardrail", sec.accuracy?.guardrailRate != null ? `${sec.accuracy.guardrailRate}%` : "—"], ["Samples", sec.accuracy?.guardSamples]] },
          { title: "Exec Log", items: [["Executions", sec.execLog?.total], ["Decisions", sec.execLog?.decisions], ["Daily heals", sec.scorecard?.daily?.heals], ["Daily score", sec.scorecard?.daily?.autonomyScore ?? "—"]] },
        ].map(({ title, items }) => (
          <div key={title} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "7px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)",
              fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8994b0" }}>{title}</div>
            {items.map(([k, v]) => (
              <div key={k} style={{ padding: "5px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9, color: "#8994b0" }}>{k}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: "#c8cdd8" }}>{v ?? "—"}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 9, color: "#8994b0", textAlign: "right" }}>Report generated {_ago(data.generatedAt)}</div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "exec",      label: "Execution Success" },
  { id: "accuracy",  label: "Accuracy"          },
  { id: "scorecard", label: "Autonomy Scorecard" },
  { id: "trends",    label: "Reliability Trends" },
  { id: "trust",     label: "Operator Trust"     },
  { id: "report",    label: "Health Report"      },
];

export default function ReliabilityCenter({ onNavigate }) {
  const [tab, setTab] = useState("report");

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0d1117", color: "#c8cdd8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes rc-pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>
      <div style={{ flex: 1, minWidth: 0 }}>
      <PageHeader
        icon="◈"
        title="Production Reliability"
        subtitle="Execution success · Accuracy · Autonomous scorecard · Trends · Operator trust · System health"
        related={[
          { label: "Execution", tab: "execution", icon: "⚡" },
          { label: "Self-Healing", tab: "selfhealing", icon: "✦" },
          { label: "Prediction", tab: "predict", icon: "◇" },
          { label: "Guardrails", tab: "guardrails", icon: "◻" },
          { label: "Operations", tab: "operations", icon: "◉" },
        ]}
        onNavigate={onNavigate}
      />
      <WorkflowNav currentTab="reliability" onNavigate={onNavigate} />
      <WorkflowStagePanel currentTab="reliability" onNavigate={onNavigate} compact />
      <div style={{ padding: "16px 24px 0" }}>
        <div role="tablist" aria-label="Reliability tabs" style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(255,255,255,0.08)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                borderBottom: tab === t.id ? "2px solid #44a2ff" : "2px solid transparent",
                color: tab === t.id ? "#44a2ff" : "#8994b0",
                marginBottom: -1, whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {t.label}
              {t.id === "report" && <span style={{ marginLeft: 4, fontSize: 8, color: "#52d68a", fontWeight: 800 }}>●</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px 40px" }}>
        {tab === "exec"      && <TabExecSuccess />}
        {tab === "accuracy"  && <TabAccuracy />}
        {tab === "scorecard" && <TabScorecard />}
        {tab === "trends"    && <TabTrends />}
        {tab === "trust"     && <TabTrustScore />}
        {tab === "report"    && <TabHealthReport />}
      </div>
      </div>
      <ContextSidebar onNavigate={onNavigate} context="reliability" />
    </div>
  );
}
