import React, { useState, useEffect, useCallback } from "react";
import "./RevenueOS.css";

const BASE = process.env.REACT_APP_API_URL || "";
const api  = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { credentials: "include", ...opts }).then(r => r.json());
const post  = (path, body) => api(path, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const TABS = [
  { id: "executive",    label: "Executive",     icon: "◎" },
  { id: "dashboard",   label: "Revenue",        icon: "◉" },
  { id: "lifecycle",   label: "Subscriptions",  icon: "⬡" },
  { id: "upgrade",     label: "Upgrade AI",     icon: "✦" },
  { id: "success",     label: "Customer Success", icon: "◇" },
  { id: "churn",       label: "Churn",          icon: "◈" },
  { id: "forecast",    label: "Forecasting",    icon: "⬢" },
  { id: "affiliates",  label: "Affiliates",     icon: "◎" },
  { id: "finance",     label: "Finance",        icon: "⊞" },
  { id: "benchmark",   label: "Benchmark",      icon: "✓" },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function useRevenue(path, deps = []) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { api(path).then(r => r.ok !== false && setData(r)); }, [path]);
  useEffect(() => { load(); }, [...deps, load]);
  return [data, load];
}

function useToast() {
  const [msg, setMsg] = useState("");
  const toast = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const Toast = msg ? <span className="ro-toast">{msg}</span> : null;
  return [toast, Toast];
}

function StatCard({ label, value, sub, accent, prefix }) {
  return (
    <div className="ro-stat-card" style={accent ? { borderTop: `2px solid ${accent}` } : {}}>
      <div className="ro-stat-val" style={accent ? { color: accent } : {}}>{prefix || ""}{value ?? "—"}</div>
      <div className="ro-stat-lbl">{label}</div>
      {sub && <div className="ro-stat-sub">{sub}</div>}
    </div>
  );
}

function Chip({ children, color }) {
  return <span className={`ro-chip${color ? ` ro-chip-${color}` : ""}`}>{children}</span>;
}

function ScoreBar({ label, value, max = 100, accent }) {
  const pct = Math.min(100, Math.max(0, max > 0 ? (value / max * 100) : 0));
  const col = accent || (pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444");
  return (
    <div className="ro-score-row">
      <span className="ro-score-label">{label}</span>
      <div className="ro-score-track"><div className="ro-score-fill" style={{ width: `${pct}%`, background: col }} /></div>
      <span className="ro-score-val" style={{ color: col }}>{value}</span>
    </div>
  );
}

function fmt(n) { return typeof n === "number" ? `₹${n.toLocaleString("en-IN")}` : "—"; }
function fmtK(n) { return typeof n === "number" ? (n >= 1000 ? `₹${(n/1000).toFixed(1)}K` : `₹${n}`) : "—"; }
function pct(n)  { return typeof n === "number" ? `${n}%` : "—"; }

// ── MODULE 9: Executive Revenue Center ───────────────────────────────────────

function ExecutivePanel() {
  const [exec, reload] = useRevenue("/revenue/executive");
  if (!exec?.dashboard) return <div className="ro-loading">Loading…</div>;
  const d = exec.dashboard;

  const cards = [
    { label: "MRR",            value: fmtK(d.revenue?.mrr),           icon: "◎", color: "#7c6fff",  sub: `ARR ${fmtK(d.revenue?.arr)}` },
    { label: "Net Revenue",    value: fmtK(d.revenue?.netRevenue),     icon: "◉", color: "#22c55e",  sub: `Gross Margin ${d.revenue?.grossMarginPct}%` },
    { label: "Expansion MRR",  value: fmtK(d.revenue?.expansionMRR),  icon: "✦", color: "#4ecdc4",  sub: "upgrades" },
    { label: "30d Forecast",   value: fmtK(d.growth?.["30d_mrr"]),    icon: "⬡", color: "#f59e0b",  sub: "base scenario" },
    { label: "365d Forecast",  value: fmtK(d.growth?.["365d_mrr"]),   icon: "⬢", color: "#a78bfa",  sub: "base scenario" },
    { label: "Active Subs",    value: d.conversion?.paidCount,         icon: "◈", color: "#22c55e",  sub: `${d.conversion?.trialCount} trials` },
    { label: "Trial→Paid",     value: pct(d.conversion?.trialConversionRate), icon: "◇", color: "#f59e0b", sub: "conversion rate" },
    { label: "Churn Rate",     value: pct(d.retention?.churnRate),     icon: "⊞", color: d.retention?.churnRate > 5 ? "#ef4444" : "#22c55e", sub: `${d.retention?.atRiskCount} at-risk` },
    { label: "LTV",            value: fmtK(d.retention?.ltv),         icon: "✕", color: "#7c6fff",  sub: "avg per paid" },
    { label: "AI Costs",       value: fmtK(d.aiCosts?.monthly),        icon: "◎", color: "#ef4444",  sub: `${d.aiCosts?.pctOfRevenue}% of MRR` },
    { label: "Net Profit",     value: fmtK(d.profitability?.netProfit), icon: "◉", color: "#22c55e", sub: `${d.profitability?.netMarginPct}% margin` },
    { label: "Affiliates",     value: d.affiliates?.total,             icon: "◈", color: "#4ecdc4",  sub: `${d.affiliates?.conversions} conversions` },
  ];

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Executive Revenue Center — G4 Revenue OS</span>
        <button className="ro-btn-sm" onClick={reload}>Refresh</button>
      </div>
      <div className="ro-exec-grid">
        {cards.map(c => (
          <div key={c.label} className="ro-exec-card" style={{ borderTop: `2px solid ${c.color}` }}>
            <div className="ro-exec-icon" style={{ color: c.color }}>{c.icon}</div>
            <div className="ro-exec-val"  style={{ color: c.color }}>{c.value}</div>
            <div className="ro-exec-label">{c.label}</div>
            {c.sub && <div className="ro-exec-sub">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
        <div className="ro-card">
          <div className="ro-card-title">Profitability</div>
          <ScoreBar label="Gross Margin"  value={d.revenue?.grossMarginPct || 0}   accent="#22c55e" />
          <ScoreBar label="Net Margin"    value={d.profitability?.netMarginPct || 0} accent="#7c6fff" />
          <ScoreBar label="Trial Conversion" value={d.conversion?.trialConversionRate || 0} accent="#f59e0b" />
        </div>
        <div className="ro-card">
          <div className="ro-card-title">Growth Trajectory (base)</div>
          {[["30d", d.growth?.["30d_mrr"]], ["90d", d.growth?.["90d_mrr"]], ["365d", d.growth?.["365d_mrr"]]].map(([label, val]) => (
            <div key={label} className="ro-kv-row">
              <span className="ro-kv-key">{label} MRR</span>
              <span className="ro-kv-val" style={{ color: "#4ecdc4" }}>{fmtK(val)}</span>
            </div>
          ))}
        </div>
        <div className="ro-card">
          <div className="ro-card-title">Finance Summary</div>
          <div className="ro-kv-row"><span className="ro-kv-key">Invoices</span><span className="ro-kv-val">{d.finance?.invoicesIssued}</span></div>
          <div className="ro-kv-row"><span className="ro-kv-key">Credit Notes</span><span className="ro-kv-val">{d.finance?.creditNotes}</span></div>
          <div className="ro-kv-row"><span className="ro-kv-key">Tax Collected</span><span className="ro-kv-val">{fmtK(d.finance?.taxCollected)}</span></div>
          <div className="ro-kv-row"><span className="ro-kv-key">Aff. Commissions</span><span className="ro-kv-val">{fmtK(d.affiliates?.commissions)}</span></div>
        </div>
      </div>
    </div>
  );
}

// ── MODULE 1: Revenue Dashboard ───────────────────────────────────────────────

function RevenueDashboardPanel() {
  const [data, reload] = useRevenue("/revenue/dashboard");
  if (!data?.dashboard) return <div className="ro-loading">Loading…</div>;
  const d = data.dashboard;
  const plans = data.plans || {};

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Revenue Dashboard</span>
        <button className="ro-btn-sm" onClick={reload}>Refresh</button>
      </div>

      <div className="ro-stats-grid" style={{ marginBottom: 12 }}>
        <StatCard label="MRR"                 value={fmtK(d.mrr)}                  accent="#7c6fff" />
        <StatCard label="ARR"                 value={fmtK(d.arr)}                  accent="#22c55e" />
        <StatCard label="Active Subscriptions" value={d.activeSubscriptions}        accent="#4ecdc4" />
        <StatCard label="Trial Conversion"    value={pct(d.trialConversionRate)}   accent="#f59e0b" />
        <StatCard label="Expansion MRR"       value={fmtK(d.expansionMRR)}         accent="#a78bfa" />
        <StatCard label="Churn Rate"          value={pct(d.churnRate)}             accent={d.churnRate > 5 ? "#ef4444" : "#22c55e"} />
        <StatCard label="Avg LTV"             value={fmtK(d.ltv)}                  accent="#7c6fff" />
        <StatCard label="Total Accounts"      value={d.totalAccounts} />
      </div>

      <div className="ro-sub-title">Revenue by Plan</div>
      <div className="ro-list" style={{ marginBottom: 12 }}>
        {Object.entries(d.byPlan || {}).map(([plan, s]) => (
          <div key={plan} className="ro-row">
            <div style={{ flex: 1 }}>
              <div className="ro-row-name">{plans[plan]?.label || plan}</div>
              <div className="ro-row-meta">{s.count} accounts · {fmtK(s.mrr)} MRR</div>
            </div>
            <div className="ro-bar-wrap">
              <div className="ro-bar-fill" style={{ width: `${d.mrr > 0 ? Math.min(100, Math.round(s.mrr / d.mrr * 100)) : 0}%` }} />
            </div>
            <span className="ro-row-meta" style={{ width: 70, textAlign: "right" }}>{fmtK(s.mrr)}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="ro-card">
          <div className="ro-card-title">Revenue Health</div>
          <ScoreBar label="Gross Margin"     value={d.grossMargin || 75} accent="#22c55e" />
          <ScoreBar label="Trial Conversion" value={d.trialConversionRate || 0} accent="#f59e0b" />
          <ScoreBar label="Retention"        value={Math.max(0, 100 - (d.churnRate || 0))} accent="#7c6fff" />
        </div>
        <div className="ro-card">
          <div className="ro-card-title">Plan Mix</div>
          {Object.entries(data.plans || {}).map(([p, pl]) => (
            <div key={p} className="ro-kv-row">
              <span className="ro-kv-key">{pl.label}</span>
              <span className="ro-kv-val">{d.byPlan?.[p]?.count || 0} accounts</span>
              <span className="ro-kv-val" style={{ color: "#888" }}>{fmtK(pl.priceMonthly)}/mo</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MODULE 2: Subscription Lifecycle ─────────────────────────────────────────

function LifecyclePanel() {
  const [accountId, setAccountId] = useState("");
  const [sub,       setSub]       = useState(null);
  const [events,    reloadEvents] = useRevenue("/revenue/lifecycle/events?limit=20");
  const [form,      setForm]      = useState({ plan: "growth", reason: "" });
  const [toast,     Toast]        = useToast();

  const load = async () => {
    if (!accountId) return;
    const r = await api(`/revenue/subscriptions/${accountId}`);
    if (r.ok !== false) setSub(r.subscription);
  };

  const doUpgrade = async () => {
    if (!sub || !form.plan) return;
    const r = await post(`/revenue/subscriptions/${accountId}/upgrade`, { plan: form.plan });
    if (r.error) toast(`Error: ${r.error}`); else { toast(`Upgraded to ${form.plan}`); load(); reloadEvents(); }
  };
  const doPause  = async () => {
    const r = await post(`/revenue/subscriptions/${accountId}/pause`, { pauseUntil: form.pauseUntil });
    if (!r.error) { toast("Subscription paused"); load(); reloadEvents(); }
  };
  const doCancel = async () => {
    const r = await post(`/revenue/subscriptions/${accountId}/cancel`, { reason: form.reason });
    if (!r.error) { toast("Subscription cancelled"); load(); reloadEvents(); }
  };
  const doReactivate = async () => {
    const r = await post(`/revenue/subscriptions/${accountId}/reactivate`, { plan: form.plan });
    if (!r.error) { toast("Subscription reactivated"); load(); reloadEvents(); }
  };

  const PLAN_ORDER = ["free","starter","growth","team","enterprise"];
  const STATUS_COLOR = { active: "#22c55e", trialing: "#f59e0b", cancelled: "#ef4444", paused: "#888" };

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Subscription Lifecycle</span>
        {Toast}
      </div>

      <div className="ro-form">
        <div className="ro-form-title">Look Up Account</div>
        <div className="ro-form-row">
          <input className="ro-input" style={{ flex: 1 }} placeholder="Account ID" value={accountId} onChange={e => setAccountId(e.target.value)} />
          <button className="ro-btn" onClick={load}>Load</button>
        </div>
      </div>

      {sub && (
        <div className="ro-card" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className="ro-row-name">{sub.accountId}</span>
            <span style={{ color: STATUS_COLOR[sub.status] || "#888", fontWeight: 700 }}>{sub.status}</span>
            <Chip>{sub.plan}</Chip>
            <span className="ro-row-meta" style={{ marginLeft: "auto" }}>{fmtK(sub.mrr)}/mo · LTV {fmtK(sub.ltv)}</span>
          </div>
          <div className="ro-row-meta" style={{ marginBottom: 8 }}>
            Credits: {sub.credits?.balance} / {sub.credits?.plan_quota} quota
            {sub.trialEnd && ` · Trial ends ${sub.trialEnd?.slice(0,10)}`}
          </div>
          <div className="ro-form-row" style={{ marginBottom: 0 }}>
            <select className="ro-select" value={form.plan} onChange={e => setForm(f => ({...f, plan: e.target.value}))}>
              {PLAN_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="ro-btn-sm" style={{ color: "#22c55e" }} onClick={doUpgrade}>Upgrade/Downgrade</button>
            <button className="ro-btn-sm" style={{ color: "#f59e0b" }} onClick={doPause}>Pause</button>
            <button className="ro-btn-sm" style={{ color: "#7c6fff" }} onClick={doReactivate}>Reactivate</button>
            <button className="ro-btn-sm" style={{ color: "#ef4444" }} onClick={doCancel}>Cancel</button>
          </div>
        </div>
      )}

      <div className="ro-sub-title" style={{ marginTop: 14 }}>Recent Lifecycle Events</div>
      <div className="ro-list">
        {(events?.events || []).length === 0 && <div className="ro-empty">No lifecycle events yet. Upgrade, downgrade, pause, cancel, or reactivate subscriptions above.</div>}
        {(events?.events || []).map(e => (
          <div key={e.id} className="ro-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ro-row-name">{e.event} <span style={{ color: "#666" }}>{e.accountId}</span></div>
              <div className="ro-row-meta">
                {e.fromPlan && `${e.fromPlan} → `}{e.toPlan}
                {e.mrrDelta !== undefined && ` · MRR ${e.mrrDelta >= 0 ? "+" : ""}${fmtK(e.mrrDelta)}`}
                {e.reason && ` · ${e.reason}`}
              </div>
            </div>
            <Chip color={e.event === "upgrade" ? "green" : e.event === "cancellation" ? "red" : "gray"}>{e.event}</Chip>
            <span className="ro-row-meta">{e.occurredAt?.slice(0,10)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MODULE 3: Upgrade Intelligence ───────────────────────────────────────────

function UpgradeIntelligencePanel() {
  const [data, reload]    = useRevenue("/revenue/upgrade/signals");
  const [accountId, setAccountId] = useState("");
  const [result, setResult] = useState(null);
  const [sigForm, setSigForm] = useState({ accountId: "", signalId: "feature_gate_hit" });
  const [toast,   Toast]  = useToast();

  const detect = async () => {
    if (!accountId) return;
    const r = await api(`/revenue/upgrade/detect/${accountId}`);
    if (r.ok !== false) setResult(r.intelligence);
  };

  const recordSignal = async () => {
    if (!sigForm.accountId || !sigForm.signalId) return;
    await post("/revenue/upgrade/signal", { accountId: sigForm.accountId, signalId: sigForm.signalId });
    toast("Signal recorded");
    reload();
  };

  const SIGNAL_DEFS = data?.definitions || [];
  const allSignals  = data?.signals || [];

  const URGENCY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Upgrade Intelligence</span>
        {Toast}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="ro-form">
          <div className="ro-form-title">Detect Upgrade Moment</div>
          <div className="ro-form-row">
            <input className="ro-input" style={{ flex: 1 }} placeholder="Account ID" value={accountId} onChange={e => setAccountId(e.target.value)} />
            <button className="ro-btn" onClick={detect}>Detect</button>
          </div>
          {result && (
            <div style={{ marginTop: 10 }}>
              <div className="ro-kv-row"><span className="ro-kv-key">Current Plan</span><span className="ro-kv-val">{result.currentPlan}</span></div>
              <div className="ro-kv-row"><span className="ro-kv-key">Target Plan</span><span className="ro-kv-val" style={{ color: "#7c6fff" }}>{result.targetPlan}</span></div>
              <div className="ro-kv-row"><span className="ro-kv-key">Score</span><span className="ro-kv-val">{result.score}</span></div>
              <div className="ro-kv-row"><span className="ro-kv-key">Credit Usage</span><span className="ro-kv-val">{result.creditUsagePct}%</span></div>
              {result.shouldPrompt && result.prompt && (
                <div className="ro-prompt-box" style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>{result.prompt.headline}</div>
                  <div style={{ fontSize: 12, color: "#ccc", marginBottom: 8 }}>{result.prompt.body}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="ro-btn-sm" style={{ color: "#22c55e" }}>{result.prompt.cta}</button>
                    <Chip color={URGENCY_COLOR[result.prompt.urgency] ? "" : "gray"}>
                      <span style={{ color: URGENCY_COLOR[result.prompt.urgency] }}>{result.prompt.urgency} urgency</span>
                    </Chip>
                  </div>
                </div>
              )}
              {result.signals?.length > 0 && (
                <div className="ro-tag-row" style={{ marginTop: 8 }}>
                  {result.signals.map(s => <Chip key={s.id}>{s.label}</Chip>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ro-form">
          <div className="ro-form-title">Record Upgrade Signal</div>
          <div className="ro-form-row">
            <input className="ro-input" placeholder="Account ID" value={sigForm.accountId} onChange={e => setSigForm(f => ({...f, accountId: e.target.value}))} />
          </div>
          <select className="ro-select" style={{ width: "100%", marginTop: 8, marginBottom: 8 }} value={sigForm.signalId} onChange={e => setSigForm(f => ({...f, signalId: e.target.value}))}>
            {SIGNAL_DEFS.map(s => <option key={s.id} value={s.id}>{s.label} (weight: {s.weight})</option>)}
          </select>
          <button className="ro-btn" onClick={recordSignal}>Record Signal</button>
        </div>
      </div>

      <div className="ro-sub-title" style={{ marginTop: 14 }}>Upgrade Signal Definitions</div>
      <div className="ro-list">
        {SIGNAL_DEFS.map(s => (
          <div key={s.id} className="ro-row">
            <div style={{ flex: 1 }}>
              <div className="ro-row-name">{s.label}</div>
              <div className="ro-row-meta">Target: {s.plan} · Weight: {s.weight}</div>
            </div>
            <div className="ro-bar-wrap">
              <div className="ro-bar-fill" style={{ width: `${s.weight}%`, background: "#7c6fff" }} />
            </div>
          </div>
        ))}
      </div>

      <div className="ro-sub-title" style={{ marginTop: 12 }}>Recent Signals Logged ({allSignals.length})</div>
      <div className="ro-list">
        {allSignals.slice(0,10).map(s => (
          <div key={s.id} className="ro-row">
            <div className="ro-row-name" style={{ flex: 1 }}>{s.accountId}</div>
            <Chip>{s.signalId}</Chip>
            <span className="ro-row-meta">{s.recordedAt?.slice(0,10)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MODULE 4: Customer Success ────────────────────────────────────────────────

function CustomerSuccessPanel() {
  const [accountId, setAccountId] = useState("");
  const [health,    setHealth]    = useState(null);
  const [note,      setNote]      = useState("");
  const [remAcct,   setRemAcct]   = useState("");
  const [list,      setList]      = useState(null);
  const [toast,     Toast]        = useToast();

  const load = async () => {
    if (!accountId) return;
    const r = await api(`/revenue/success/health/${accountId}`);
    if (r.ok !== false) setHealth(r.health);
  };
  const loadList = async () => {
    const r = await api("/revenue/success/health");
    if (r.ok !== false) setList(r.accounts);
  };
  const addNote = async () => {
    if (!accountId || !note) return;
    const r = await post(`/revenue/success/health/${accountId}/note`, { note });
    if (r.ok !== false) { setHealth(r.health); setNote(""); toast("Note added"); }
  };
  const sendReminder = async () => {
    if (!remAcct) return;
    await post("/revenue/success/reminder", { accountId: remAcct, daysOut: 30 });
    toast("Renewal reminder sent");
  };

  const GRADE_COLOR = { A: "#22c55e", B: "#f59e0b", C: "#ef4444", D: "#ef4444" };

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Customer Success Automation</span>
        {Toast}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="ro-form">
          <div className="ro-form-title">Health Score Lookup</div>
          <div className="ro-form-row">
            <input className="ro-input" style={{ flex: 1 }} placeholder="Account ID" value={accountId} onChange={e => setAccountId(e.target.value)} />
            <button className="ro-btn" onClick={load}>Load</button>
          </div>

          {health && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 32, fontWeight: 900, color: GRADE_COLOR[health.grade] }}>{health.grade}</div>
                <div>
                  <div className="ro-row-name">{health.healthScore}/100</div>
                  <div className="ro-row-meta">{health.plan} · {health.status}</div>
                </div>
              </div>

              {Object.entries(health.breakdown || {}).map(([k, v]) => (
                <ScoreBar key={k} label={k.replace(/_/g, " ")} value={v} accent="#7c6fff" />
              ))}

              {health.activePlaybook && (
                <div className="ro-prompt-box" style={{ marginTop: 8 }}>
                  <div className="ro-card-title">Active Playbook: {health.activePlaybook.label}</div>
                  {health.activePlaybook.steps?.map((step, i) => (
                    <div key={i} className="ro-row-meta" style={{ padding: "2px 0" }}>
                      <span style={{ color: "#666", marginRight: 6 }}>{i + 1}.</span>{step}
                    </div>
                  ))}
                </div>
              )}

              {health.risks?.length > 0 && (
                <div className="ro-tag-row" style={{ marginTop: 8 }}>
                  {health.risks.map((r, i) => <Chip key={i} color="red">{r}</Chip>)}
                </div>
              )}

              <div className="ro-form-row" style={{ marginTop: 8 }}>
                <input className="ro-input" style={{ flex: 1 }} placeholder="Add CSM note…" value={note} onChange={e => setNote(e.target.value)} />
                <button className="ro-btn-sm" onClick={addNote}>Add Note</button>
              </div>

              {health.notes?.slice(-3).map((n, i) => (
                <div key={i} className="ro-row-meta" style={{ padding: "3px 0", borderBottom: "1px solid #1e1e28" }}>
                  {n.text} <span style={{ color: "#444" }}>— {n.addedAt?.slice(0,10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="ro-form" style={{ marginBottom: 10 }}>
            <div className="ro-form-title">Renewal Reminder</div>
            <div className="ro-form-row">
              <input className="ro-input" style={{ flex: 1 }} placeholder="Account ID" value={remAcct} onChange={e => setRemAcct(e.target.value)} />
              <button className="ro-btn" onClick={sendReminder}>Send 30-day Reminder</button>
            </div>
          </div>

          <div className="ro-card">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div className="ro-card-title">At-Risk Accounts</div>
              <button className="ro-btn-sm" onClick={loadList}>Load All</button>
            </div>
            <div className="ro-list" style={{ marginTop: 8 }}>
              {!list && <div className="ro-hint">Click "Load All" to see all customer health scores.</div>}
              {list?.slice(0,8).map(h => (
                <div key={h.accountId} className="ro-row" onClick={() => { setAccountId(h.accountId); setHealth(h); }} style={{ cursor: "pointer" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: GRADE_COLOR[h.grade], width: 24, flexShrink: 0 }}>{h.grade}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ro-row-name">{h.accountId}</div>
                    <div className="ro-row-meta">{h.plan} · Score {h.healthScore}</div>
                  </div>
                  <div className="ro-bar-wrap"><div className="ro-bar-fill" style={{ width: `${h.healthScore}%`, background: GRADE_COLOR[h.grade] }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MODULE 5: Churn Prevention ────────────────────────────────────────────────

function ChurnPanel() {
  const [risks, reloadRisks] = useRevenue("/revenue/churn/risks");
  const [surveys, reloadSurveys] = useRevenue("/revenue/churn/exit-surveys");
  const [view, setView]  = useState("risks");
  const [accountId, setAccountId] = useState("");
  const [risk, setRisk]  = useState(null);
  const [exitForm, setExitForm] = useState({ accountId: "", reason: "price", comment: "", npsScore: "", wouldReturn: true });
  const [toast, Toast]   = useToast();

  const detect = async () => {
    if (!accountId) return;
    const r = await api(`/revenue/churn/detect/${accountId}?signals=cancel_flow_visited`);
    if (r.ok !== false) setRisk(r.risk);
  };

  const sendWinBack = async (acct, tplId) => {
    await post("/revenue/churn/winback", { accountId: acct, templateId: tplId });
    toast("Win-back campaign sent");
    reloadRisks();
  };

  const submitSurvey = async () => {
    if (!exitForm.accountId) return;
    await post("/revenue/churn/exit-survey", { ...exitForm, npsScore: Number(exitForm.npsScore) || null });
    setExitForm({ accountId: "", reason: "price", comment: "", npsScore: "", wouldReturn: true });
    toast("Exit survey submitted");
    reloadSurveys();
    setView("surveys");
  };

  const LEVEL_COLOR = { critical: "#ef4444", high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  const riskList   = risks?.risks || [];
  const surveyList = surveys?.surveys || [];
  const templates  = risks?.templates || [];

  return (
    <div>
      <div className="ro-sub-tabs">
        {["risks","detect","exit","surveys"].map(v => (
          <button key={v} className={`ro-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "detect" ? "Detect Risk" : v === "exit" ? "Exit Survey" : v === "surveys" ? `Surveys (${surveyList.length})` : `At-Risk (${riskList.length})`}
          </button>
        ))}
        {Toast}
      </div>

      {view === "risks" && (
        <div>
          <div className="ro-sub-title">At-Risk Accounts</div>
          <div className="ro-list">
            {riskList.length === 0 && <div className="ro-empty">No churn risks detected. Use "Detect Risk" to analyze specific accounts.</div>}
            {riskList.map(r => (
              <div key={r.accountId} className="ro-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ro-row-name">{r.accountId}</div>
                  <div className="ro-row-meta">Score: {r.riskScore} · {r.signals?.length || 0} signals detected</div>
                  {r.winbackRecommendation && (
                    <div className="ro-row-meta" style={{ color: "#f59e0b" }}>Recommended: {r.winbackRecommendation.subject}</div>
                  )}
                </div>
                <Chip color={r.riskLevel === "critical" || r.riskLevel === "high" ? "red" : r.riskLevel === "medium" ? "yellow" : "green"}>{r.riskLevel}</Chip>
                {r.winbackRecommendation && (
                  <button className="ro-btn-sm" onClick={() => sendWinBack(r.accountId, r.winbackRecommendation?.id || "wbt_1")}>Win Back</button>
                )}
              </div>
            ))}
          </div>

          <div className="ro-sub-title" style={{ marginTop: 12 }}>Win-Back Templates</div>
          <div className="ro-list">
            {templates.map(t => (
              <div key={t.id} className="ro-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ro-row-name">{t.subject}</div>
                  <div className="ro-row-meta">via {t.type} · offer: {t.discount}</div>
                </div>
                <Chip>{t.type}</Chip>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "detect" && (
        <div>
          <div className="ro-form">
            <div className="ro-form-title">Detect Churn Risk</div>
            <div className="ro-form-row">
              <input className="ro-input" style={{ flex: 1 }} placeholder="Account ID" value={accountId} onChange={e => setAccountId(e.target.value)} />
              <button className="ro-btn" onClick={detect}>Detect</button>
            </div>
          </div>
          {risk && (
            <div className="ro-card" style={{ marginTop: 10, borderLeft: `3px solid ${LEVEL_COLOR[risk.riskLevel]}` }}>
              <div style={{ display: "flex", align: "center", gap: 8, marginBottom: 8 }}>
                <span className="ro-row-name">{risk.accountId}</span>
                <Chip color={risk.riskLevel === "high" || risk.riskLevel === "critical" ? "red" : "yellow"}>{risk.riskLevel}</Chip>
                <span className="ro-row-meta">Score: {risk.riskScore}</span>
              </div>
              {risk.signals?.map(s => <div key={s.id} className="ro-row-meta" style={{ padding: "2px 0" }}>⚠ {s.label} (score +{s.score})</div>)}
              {risk.winbackRecommendation && (
                <div style={{ marginTop: 8 }}>
                  <div className="ro-card-title">Recommended Action</div>
                  <div className="ro-row-name">{risk.winbackRecommendation.subject}</div>
                  <div className="ro-row-meta">{risk.winbackRecommendation.body}</div>
                  <button className="ro-btn-sm" style={{ marginTop: 6 }} onClick={() => sendWinBack(risk.accountId, risk.winbackRecommendation.id)}>Send Win-Back</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view === "exit" && (
        <div className="ro-form">
          <div className="ro-form-title">Exit Survey</div>
          <div className="ro-form-row">
            <input className="ro-input" placeholder="Account ID *" value={exitForm.accountId} onChange={e => setExitForm(f => ({...f, accountId: e.target.value}))} />
            <select className="ro-select" value={exitForm.reason} onChange={e => setExitForm(f => ({...f, reason: e.target.value}))}>
              {["price","missing_feature","switching_competitor","not_using","technical_issue","other"].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <input className="ro-input" style={{ width: "100%", marginBottom: 8 }} placeholder="NPS score (0-10)" type="number" min="0" max="10" value={exitForm.npsScore} onChange={e => setExitForm(f => ({...f, npsScore: e.target.value}))} />
          <textarea className="ro-textarea" placeholder="Comment (optional)" value={exitForm.comment} onChange={e => setExitForm(f => ({...f, comment: e.target.value}))} />
          <div className="ro-form-row" style={{ marginTop: 8 }}>
            <label className="ro-check-label">
              <input type="checkbox" checked={exitForm.wouldReturn} onChange={e => setExitForm(f => ({...f, wouldReturn: e.target.checked}))} />
              Would return
            </label>
            <button className="ro-btn" onClick={submitSurvey}>Submit</button>
          </div>
        </div>
      )}

      {view === "surveys" && (
        <div className="ro-list">
          {surveyList.length === 0 && <div className="ro-empty">No exit surveys yet.</div>}
          {surveyList.map(s => (
            <div key={s.id} className="ro-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ro-row-name">{s.accountId}</div>
                <div className="ro-row-meta">Reason: {s.reason} · NPS: {s.npsScore ?? "—"} · Would return: {s.wouldReturn ? "Yes" : "No"}</div>
                {s.comment && <div className="ro-row-meta" style={{ color: "#ccc" }}>"{s.comment}"</div>}
              </div>
              <span className="ro-row-meta">{s.submittedAt?.slice(0,10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MODULE 6: Revenue Forecasting ─────────────────────────────────────────────

function ForecastPanel() {
  const [sim, setSim]       = useState(null);
  const [saved, reloadSaved] = useRevenue("/revenue/forecasts");
  const [opts, setOpts]     = useState({ scenario: "base", marketingMultiplier: 1 });
  const [running, setRunning] = useState(false);
  const [toast, Toast]      = useToast();

  const simulate = async () => {
    setRunning(true);
    const r = await post("/revenue/forecast/simulate", opts);
    if (r.ok !== false) { setSim(r.simulation); reloadSaved(); toast("Simulation complete"); }
    setRunning(false);
  };

  const SCENARIO_COLOR = { conservative: "#888", base: "#7c6fff", optimistic: "#22c55e" };
  const savedList = saved?.forecasts || [];

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Revenue Forecasting</span>
        {Toast}
      </div>

      <div className="ro-form" style={{ marginBottom: 12 }}>
        <div className="ro-form-title">Run Scenario Simulation</div>
        <div className="ro-form-row">
          <select className="ro-select" value={opts.scenario} onChange={e => setOpts(o => ({...o, scenario: e.target.value}))}>
            {["conservative","base","optimistic"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="ro-check-label">Marketing ×<input type="number" className="ro-input" style={{ width: 50, flex: "none" }} value={opts.marketingMultiplier} min="1" max="5" onChange={e => setOpts(o => ({...o, marketingMultiplier: Number(e.target.value)}))} /></label>
          <button className="ro-btn" onClick={simulate} disabled={running}>{running ? "Running…" : "Simulate All 3 Scenarios"}</button>
        </div>
      </div>

      {sim && (
        <div>
          <div className="ro-sub-title">3-Scenario Comparison</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            {["conservative","base","optimistic"].map(sc => {
              const f = sim[sc];
              if (!f) return null;
              return (
                <div key={sc} className="ro-card" style={{ borderTop: `2px solid ${SCENARIO_COLOR[sc]}` }}>
                  <div className="ro-card-title" style={{ color: SCENARIO_COLOR[sc], textTransform: "capitalize" }}>{sc}</div>
                  <div className="ro-kv-row"><span className="ro-kv-key">30d MRR</span><span className="ro-kv-val" style={{ color: SCENARIO_COLOR[sc] }}>{fmtK(f.projections?.["30d"]?.mrr)}</span></div>
                  <div className="ro-kv-row"><span className="ro-kv-key">90d MRR</span><span className="ro-kv-val" style={{ color: SCENARIO_COLOR[sc] }}>{fmtK(f.projections?.["90d"]?.mrr)}</span></div>
                  <div className="ro-kv-row"><span className="ro-kv-key">365d MRR</span><span className="ro-kv-val" style={{ color: SCENARIO_COLOR[sc] }}>{fmtK(f.projections?.["365d"]?.mrr)}</span></div>
                  <div className="ro-kv-row"><span className="ro-kv-key">365d ARR</span><span className="ro-kv-val">{fmtK(f.projections?.["365d"]?.arr)}</span></div>
                  <div className="ro-kv-row"><span className="ro-kv-key">Growth Rate</span><span className="ro-kv-val">{pct((f.assumptions?.growthRate || 0) * 100)}/mo</span></div>
                  <div className="ro-kv-row"><span className="ro-kv-key">Churn Rate</span><span className="ro-kv-val">{pct((f.assumptions?.churnRate || 0) * 100)}/mo</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="ro-sub-title">Saved Forecasts ({savedList.length})</div>
      <div className="ro-list">
        {savedList.length === 0 && <div className="ro-empty">No forecasts yet. Run a simulation above.</div>}
        {savedList.slice(0,10).map(f => (
          <div key={f.id} className="ro-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ro-row-name">{f.scenario} scenario</div>
              <div className="ro-row-meta">
                Current: {fmtK(f.currentMRR)} → 30d: {fmtK(f.projections?.["30d"]?.mrr)} → 365d: {fmtK(f.projections?.["365d"]?.mrr)}
              </div>
            </div>
            <Chip color="gray">{f.scenario}</Chip>
            <span className="ro-row-meta">{f.createdAt?.slice(0,10)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MODULE 7: Affiliate & Partner Center ──────────────────────────────────────

function AffiliatePanel() {
  const [data, reload] = useRevenue("/revenue/affiliates");
  const [view, setView] = useState("list");
  const [form, setForm] = useState({ name: "", email: "", tier: "ambassador" });
  const [convForm, setConvForm] = useState({ affiliateId: "", accountId: "", plan: "growth" });
  const [toast, Toast] = useToast();

  const create = async () => {
    if (!form.name) return;
    await post("/revenue/affiliates", form);
    setForm({ name: "", email: "", tier: "ambassador" });
    toast("Affiliate created");
    reload();
    setView("list");
  };

  const recordConv = async () => {
    if (!convForm.affiliateId) return;
    const r = await post(`/revenue/affiliates/${convForm.affiliateId}/conversion`, { accountId: convForm.accountId, plan: convForm.plan });
    toast(`Commission recorded: ₹${r.commission?.commission || 0}`);
    reload();
  };

  const payout = async (id) => {
    const r = await post(`/revenue/affiliates/${id}/payout`, {});
    if (r.error) toast(`Error: ${r.error}`); else { toast(`Payout processed: ₹${r.amountPaid}`); reload(); }
  };

  const analytics = data?.analytics || {};
  const tiers     = data?.tiers     || {};
  const list      = data?.affiliates || [];

  const TIER_COLOR = { ambassador: "#888", partner: "#f59e0b", reseller: "#7c6fff", enterprise: "#22c55e" };

  return (
    <div>
      <div className="ro-sub-tabs">
        {["list","create","conversion"].map(v => (
          <button key={v} className={`ro-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "create" ? "+ New Partner" : v === "conversion" ? "Record Conversion" : `Partners (${list.length})`}
          </button>
        ))}
        {Toast}
      </div>

      <div className="ro-stats-grid" style={{ margin: "10px 0" }}>
        <StatCard label="Partners"         value={analytics.totalAffiliates}   accent="#7c6fff" />
        <StatCard label="Conversions"      value={analytics.totalConversions}  accent="#22c55e" />
        <StatCard label="Total Commissions" value={fmtK(analytics.totalCommissions)} accent="#f59e0b" />
        <StatCard label="Pending Payout"   value={fmtK(analytics.totalPendingPayout)} accent="#ef4444" />
        <StatCard label="Total Paid Out"   value={fmtK(analytics.totalPaidOut)} />
      </div>

      {view === "list" && (
        <div className="ro-list">
          {list.length === 0 && <div className="ro-empty">No affiliates yet. Create your first partner.</div>}
          {list.map(a => (
            <div key={a.id} className="ro-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ro-row-name">{a.name} <span style={{ color: "#555" }}>{a.email}</span></div>
                <div className="ro-row-meta">
                  Code: {a.code} · {a.conversions} conversions · {pct(a.commissionRate * 100)} commission
                  · Pending: {fmtK(a.pendingPayout)}
                </div>
              </div>
              <Chip color={TIER_COLOR[a.tier] ? "" : "gray"}><span style={{ color: TIER_COLOR[a.tier] }}>{a.tier}</span></Chip>
              {a.pendingPayout >= (tiers[a.tier]?.payoutThreshold || 0) && (
                <button className="ro-btn-sm" style={{ color: "#22c55e" }} onClick={() => payout(a.id)}>Process Payout</button>
              )}
            </div>
          ))}
          {Object.entries(tiers).length > 0 && (
            <div className="ro-card" style={{ marginTop: 10 }}>
              <div className="ro-card-title">Partner Tier Benefits</div>
              {Object.entries(tiers).map(([t, info]) => (
                <div key={t} className="ro-kv-row">
                  <span className="ro-kv-key" style={{ color: TIER_COLOR[t] }}>{info.label}</span>
                  <span className="ro-kv-val">{pct(info.commissionRate * 100)} commission</span>
                  <span className="ro-kv-val" style={{ color: "#888" }}>min {info.minReferrals} referrals</span>
                  <span className="ro-kv-val" style={{ color: "#888" }}>payout at {fmtK(info.payoutThreshold)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "create" && (
        <div className="ro-form">
          <div className="ro-form-title">New Partner / Affiliate</div>
          <div className="ro-form-row">
            <input className="ro-input" placeholder="Name *" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
            <input className="ro-input" placeholder="Email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
            <select className="ro-select" value={form.tier} onChange={e => setForm(f => ({...f, tier: e.target.value}))}>
              {Object.keys(tiers).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="ro-btn" onClick={create}>Create</button>
          </div>
        </div>
      )}

      {view === "conversion" && (
        <div className="ro-form">
          <div className="ro-form-title">Record Affiliate Conversion</div>
          <div className="ro-form-row">
            <select className="ro-select" style={{ flex: 1 }} value={convForm.affiliateId} onChange={e => setConvForm(f => ({...f, affiliateId: e.target.value}))}>
              <option value="">— Select partner —</option>
              {list.map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
            </select>
          </div>
          <div className="ro-form-row" style={{ marginTop: 8 }}>
            <input className="ro-input" placeholder="Referred Account ID" value={convForm.accountId} onChange={e => setConvForm(f => ({...f, accountId: e.target.value}))} />
            <select className="ro-select" value={convForm.plan} onChange={e => setConvForm(f => ({...f, plan: e.target.value}))}>
              {["starter","growth","team","enterprise"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="ro-btn" onClick={recordConv}>Record</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 8: Finance Center ──────────────────────────────────────────────────

function FinancePanel() {
  const [invoices, reloadInv] = useRevenue("/revenue/finance/invoices");
  const [cns,      reloadCN]  = useRevenue("/revenue/finance/credit-notes");
  const [report,   reloadRpt] = useRevenue("/revenue/finance/report");
  const [view, setView] = useState("invoices");
  const [invForm, setInvForm] = useState({ accountId: "", country: "IN", period: "Monthly" });
  const [refForm, setRefForm] = useState({ accountId: "", invoiceId: "", reason: "customer_request", amount: "" });
  const [toast, Toast] = useToast();

  const createInvoice = async () => {
    if (!invForm.accountId) return;
    await post("/revenue/finance/invoices", invForm);
    setInvForm({ accountId: "", country: "IN", period: "Monthly" });
    toast("Invoice generated");
    reloadInv();
  };

  const markPaid = async (id) => {
    await post(`/revenue/finance/invoices/${id}/pay`, {});
    toast("Invoice marked paid");
    reloadInv();
    reloadRpt();
  };

  const issueRefund = async () => {
    if (!refForm.accountId) return;
    await post("/revenue/finance/refund", { ...refForm, amount: Number(refForm.amount) || 0 });
    setRefForm({ accountId: "", invoiceId: "", reason: "customer_request", amount: "" });
    toast("Credit note issued");
    reloadCN();
    reloadRpt();
  };

  const rpt   = report?.report;
  const invList = invoices?.invoices || [];
  const cnList  = cns?.creditNotes  || [];
  const STATUS_COLOR = { issued: "#f59e0b", paid: "#22c55e", overdue: "#ef4444", cancelled: "#888" };

  return (
    <div>
      <div className="ro-sub-tabs">
        {["invoices","create-inv","credit-notes","refund","report"].map(v => (
          <button key={v} className={`ro-sub-tab${view === v ? " active" : ""}`} onClick={() => setView(v)}>
            {v === "invoices" ? `Invoices (${invList.length})` : v === "create-inv" ? "+ Invoice" : v === "credit-notes" ? `Credit Notes (${cnList.length})` : v === "refund" ? "Refund" : "Report"}
          </button>
        ))}
        {Toast}
      </div>

      {view === "invoices" && (
        <div className="ro-list">
          {invList.length === 0 && <div className="ro-empty">No invoices. Generate one using the "+ Invoice" tab.</div>}
          {invList.map(inv => (
            <div key={inv.id} className="ro-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ro-row-name">{inv.invoiceNumber} — {inv.accountId}</div>
                <div className="ro-row-meta">
                  {inv.plan} · Subtotal {fmtK(inv.subtotal)} + {inv.taxRate}% GST = {fmtK(inv.total)} · Due {inv.dueDate}
                </div>
              </div>
              <Chip color={inv.status === "paid" ? "green" : inv.status === "issued" ? "yellow" : "gray"}>{inv.status}</Chip>
              {inv.status === "issued" && <button className="ro-btn-sm" style={{ color: "#22c55e" }} onClick={() => markPaid(inv.id)}>Mark Paid</button>}
            </div>
          ))}
        </div>
      )}

      {view === "create-inv" && (
        <div className="ro-form">
          <div className="ro-form-title">Generate Invoice</div>
          <div className="ro-form-row">
            <input className="ro-input" placeholder="Account ID *" value={invForm.accountId} onChange={e => setInvForm(f => ({...f, accountId: e.target.value}))} />
            <select className="ro-select" value={invForm.country} onChange={e => setInvForm(f => ({...f, country: e.target.value}))}>
              {["IN","US","UK","EU"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="ro-select" value={invForm.period} onChange={e => setInvForm(f => ({...f, period: e.target.value}))}>
              {["Monthly","Annual","One-time"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="ro-btn" onClick={createInvoice}>Generate</button>
          </div>
          <div className="ro-hint" style={{ marginTop: 8 }}>Tax rates: IN 18% GST, UK 20% VAT, EU 21% VAT, US 0%</div>
        </div>
      )}

      {view === "credit-notes" && (
        <div className="ro-list">
          {cnList.length === 0 && <div className="ro-empty">No credit notes issued.</div>}
          {cnList.map(cn => (
            <div key={cn.id} className="ro-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ro-row-name">{cn.creditNoteNumber} — {cn.accountId}</div>
                <div className="ro-row-meta">Reason: {cn.reason} · Amount: {fmtK(cn.amount)} · {cn.issuedAt?.slice(0,10)}</div>
              </div>
              <Chip color="yellow">{cn.status}</Chip>
            </div>
          ))}
        </div>
      )}

      {view === "refund" && (
        <div className="ro-form">
          <div className="ro-form-title">Issue Refund / Credit Note</div>
          <div className="ro-form-row">
            <input className="ro-input" placeholder="Account ID *" value={refForm.accountId} onChange={e => setRefForm(f => ({...f, accountId: e.target.value}))} />
            <input className="ro-input" placeholder="Invoice ID (optional)" value={refForm.invoiceId} onChange={e => setRefForm(f => ({...f, invoiceId: e.target.value}))} />
            <select className="ro-select" value={refForm.reason} onChange={e => setRefForm(f => ({...f, reason: e.target.value}))}>
              {["customer_request","duplicate","service_failure","goodwill"].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="ro-form-row" style={{ marginTop: 8 }}>
            <input type="number" className="ro-input" placeholder="Refund amount (₹)" value={refForm.amount} onChange={e => setRefForm(f => ({...f, amount: e.target.value}))} />
            <button className="ro-btn" onClick={issueRefund}>Issue Credit Note</button>
          </div>
        </div>
      )}

      {view === "report" && rpt && (
        <div>
          <div className="ro-stats-grid" style={{ marginBottom: 12 }}>
            <StatCard label="MRR"          value={fmtK(rpt.mrr)}           accent="#7c6fff" />
            <StatCard label="Total Invoiced" value={fmtK(rpt.totalInvoiced)} accent="#22c55e" />
            <StatCard label="Total Paid"   value={fmtK(rpt.totalPaid)}     accent="#22c55e" />
            <StatCard label="Outstanding"  value={fmtK(rpt.totalOutstanding)} accent="#f59e0b" />
            <StatCard label="Refunds"      value={fmtK(rpt.totalRefunds)}  accent="#ef4444" />
            <StatCard label="Tax"          value={fmtK(rpt.totalTax)} />
            <StatCard label="Net Revenue"  value={fmtK(rpt.netRevenue)}    accent="#22c55e" />
            <StatCard label="Gross Profit" value={fmtK(rpt.grossProfit)}   accent="#a78bfa" />
          </div>
          <div className="ro-card">
            <div className="ro-card-title">Revenue Report — {rpt.period}</div>
            <div className="ro-kv-row"><span className="ro-kv-key">Invoices</span><span className="ro-kv-val">{rpt.invoiceCount}</span></div>
            <div className="ro-kv-row"><span className="ro-kv-key">Credit Notes</span><span className="ro-kv-val">{rpt.refundCount}</span></div>
            <div className="ro-kv-row"><span className="ro-kv-key">Affiliate Costs</span><span className="ro-kv-val" style={{ color: "#ef4444" }}>{fmtK(rpt.affiliateCosts)}</span></div>
            <div className="ro-kv-row"><span className="ro-kv-key">Generated At</span><span className="ro-kv-val">{rpt.generatedAt?.slice(0,19)?.replace("T"," ")}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODULE 10: Benchmark ──────────────────────────────────────────────────────

function BenchmarkPanel() {
  const [result,  setResult]  = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const r = await api("/revenue/benchmark");
    if (r.ok !== false) setResult(r);
    setRunning(false);
  };

  const READINESS_COLOR = { production_ready: "#22c55e", nearly_ready: "#f59e0b", needs_work: "#ef4444" };

  return (
    <div>
      <div className="ro-section-hdr">
        <span className="ro-section-title">Commercial Benchmark — G4 Revenue OS</span>
        <button className="ro-btn" onClick={run} disabled={running}>{running ? "Running…" : "Run Benchmark"}</button>
      </div>
      <p className="ro-hint">Validates all 10 G4 modules: Revenue Dashboard (MRR/ARR/LTV/churn), Subscription Lifecycle (trial→paid, upgrade, downgrade, pause, cancel, reactivate), Upgrade Intelligence (signal detection, context prompts), Customer Success Automation (health scores, playbooks, renewal reminders), Churn Prevention (risk detection, win-back campaigns, exit surveys), Revenue Forecasting (30/90/365-day, 3 scenarios), Affiliate & Partner Center (tiers, commissions, payouts), Finance Center (invoices, taxes, credit notes, refunds), Executive Revenue Center, Commercial Viability.</p>

      {result && (
        <>
          <div className="ro-stats-grid" style={{ marginBottom: 16 }}>
            <StatCard label="Score"      value={`${result.score}%`}           accent={READINESS_COLOR[result.revenueReadiness]} />
            <StatCard label="Passed"     value={`${result.passing}/${result.total}`} accent="#22c55e" />
            <StatCard label="Readiness"  value={result.revenueReadiness?.replace(/_/g," ")} accent={READINESS_COLOR[result.revenueReadiness]} />
            <StatCard label="Regression" value={result.regressionPass ? "PASS" : "FAIL"} accent={result.regressionPass ? "#22c55e" : "#ef4444"} />
          </div>
          <div className="ro-list">
            {(result.checks || []).map(c => (
              <div key={c.id} className={`ro-row${c.ok ? "" : " ro-row-fail"}`}>
                <span style={{ color: c.ok ? "#22c55e" : "#ef4444", fontWeight: 700, flexShrink: 0 }}>{c.ok ? "✓" : "✗"}</span>
                <span className="ro-row-name" style={{ flex: 1 }}>{c.label}</span>
                {c.error && <span className="ro-row-meta" style={{ color: "#ef4444" }}>{c.error}</span>}
                <Chip color={c.ok ? "green" : "red"}>{c.ok ? "pass" : "fail"}</Chip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function RevenueOS() {
  const [tab, setTab] = useState("executive");
  const panels = {
    executive:   <ExecutivePanel />,
    dashboard:   <RevenueDashboardPanel />,
    lifecycle:   <LifecyclePanel />,
    upgrade:     <UpgradeIntelligencePanel />,
    success:     <CustomerSuccessPanel />,
    churn:       <ChurnPanel />,
    forecast:    <ForecastPanel />,
    affiliates:  <AffiliatePanel />,
    finance:     <FinancePanel />,
    benchmark:   <BenchmarkPanel />,
  };
  return (
    <div className="ro-root">
      <div className="ro-header">
        <span className="ro-title">Growth OS — G4</span>
        <span className="ro-subtitle">Revenue Operating System · MRR/ARR · Subscriptions · Upgrade Intelligence · Customer Success · Churn · Forecasting · Affiliates · Finance</span>
      </div>
      <div className="ro-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`ro-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="ro-tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ro-content">{panels[tab]}</div>
    </div>
  );
}
