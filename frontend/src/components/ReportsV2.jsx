import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getStats, getOpsData, getMetrics } from "../telemetryApi";
import { getLeadsV5 } from "../businessApi";
import JourneyBanner from "./JourneyBanner";
import EmptyState from "./EmptyState";
import "./ReportsV2.css";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _fmtINR(v) {
  if (!v) return "₹0";
  const n = Number(v);
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function _fmtUptime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ${h % 24}h`;
  if (h > 0)  return `${h}h`;
  return `${Math.floor(secs / 60)}m`;
}

function _uptimePct(secs) {
  if (!secs) return "—";
  const max7d = 7 * 24 * 3600;
  const pct   = Math.min(100, (secs / max7d) * 100);
  return `${pct.toFixed(1)}%`;
}

function _timeAgo(isoStr) {
  if (!isoStr) return "never";
  const ms   = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATUS_META = {
  new:          { label: "New",          color: "var(--accent, #7c6fff)" },
  hot:          { label: "Hot",          color: "var(--warning, #f0b429)" },
  contacted:    { label: "Contacted",    color: "var(--accent, #7c6fff)" },
  qualified:    { label: "Qualified",    color: "var(--accent2, #4ecdc4)" },
  disqualified: { label: "Disqualified", color: "var(--text-faint, #4a5470)" },
  // Real /business/leads status values (businessDataService.cjs's
  // LEAD_STATUSES) — added alongside the legacy crmService statuses below
  // when this chart's data source was pointed at /business/leads (A.10.7).
  converted:    { label: "Converted",    color: "var(--success, #52d68a)" },
  won:          { label: "Won",          color: "var(--success, #52d68a)" },
  paid:         { label: "Paid",         color: "var(--success, #52d68a)" },
  lost:         { label: "Lost",         color: "var(--text-faint, #4a5470)" },
  onboarded:    { label: "Onboarded",    color: "var(--success, #52d68a)" },
};

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ w, h }) {
  return (
    <div className="rv2-skeleton" style={{ width: w || "100%", height: h || 16, borderRadius: 6 }} />
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, accent, loading }) {
  return (
    <div className="rv2-kpi">
      <div className="rv2-kpi-top">
        <span className="rv2-kpi-icon" style={{ color: accent || "var(--accent)" }}>{icon}</span>
        <span className="rv2-kpi-label">{label}</span>
      </div>
      {loading ? <Skeleton w="55%" h={26} /> : (
        <div className="rv2-kpi-value" style={{ color: accent || "var(--text)" }}>{value ?? "—"}</div>
      )}
      {loading ? <Skeleton w="40%" h={12} /> : (
        sub && <div className="rv2-kpi-sub">{sub}</div>
      )}
    </div>
  );
}

// ── Pipeline Breakdown (CSS-only horizontal bars) ──────────────────────────────

function PipelineChart({ leads, loading }) {
  const bars = useMemo(() => {
    if (!leads?.length) return [];
    const grouped = leads.reduce((acc, l) => {
      const s = l.status || "new";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const raw = Object.entries(grouped).map(([status, count]) => ({
      status,
      count,
      ...(STATUS_META[status] || { label: status, color: "var(--text-faint)" }),
    })).sort((a, b) => b.count - a.count);
    const max = Math.max(...raw.map(b => b.count), 1);
    return raw.map(b => ({ ...b, pct: Math.round((b.count / max) * 100) }));
  }, [leads]);

  if (loading) return (
    <div className="rv2-chart-bars">
      {[80, 60, 45, 30].map((w, i) => (
        <div key={i} className="rv2-bar-row">
          <div className="rv2-skeleton" style={{ width: 72, height: 12, borderRadius: 4 }} />
          <div className="rv2-bar-track">
            <div className="rv2-skeleton" style={{ width: `${w}%`, height: "100%", borderRadius: 4 }} />
          </div>
          <div className="rv2-skeleton" style={{ width: 24, height: 12, borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );

  // Phase A.11.6: `leads === null` means the fetch genuinely failed, which is
  // NOT the same as a real account with no leads. Telling a founder whose data
  // just failed to load to "Add contacts" asserts something false about their
  // own account. A real, loaded, genuinely-empty account (leads === []) still
  // gets the original copy.
  if (!bars.length) return (
    <div className="rv2-empty-inline">
      <p>{leads === null
        ? "Pipeline data unavailable — couldn't load leads."
        : "No lead data yet. Add contacts to see pipeline distribution."}</p>
    </div>
  );

  const total = leads?.length || 0;

  return (
    <div className="rv2-chart-bars">
      {bars.map(b => (
        <div key={b.status} className="rv2-bar-row">
          <span className="rv2-bar-label">{b.label}</span>
          <div className="rv2-bar-track">
            <div className="rv2-bar-fill" style={{ width: `${b.pct}%`, background: b.color }} />
          </div>
          <span className="rv2-bar-count" style={{ color: b.color }}>{b.count}</span>
          <span className="rv2-bar-pct">{total ? Math.round((b.count / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Automation Summary Rows ────────────────────────────────────────────────────

const TIER_LABELS = {
  "10min":      "First message",
  "6hr":        "Same-day follow-up",
  "24hr":       "Next-day check-in",
  "3day":       "3-day closing",
  "onboarding": "Welcome message",
  "upsell":     "Upsell nudge",
};

function AutoSummary({ opsData, loading }) {
  const entries = Object.entries(opsData?.automation || {});

  if (loading) return (
    <div className="rv2-auto-rows">
      {[0, 1, 2].map(i => (
        <div key={i} className="rv2-auto-row">
          <Skeleton w="45%" h={13} />
          <Skeleton w="25%" h={13} />
        </div>
      ))}
    </div>
  );

  if (!entries.length) return (
    <div className="rv2-empty-inline">
      <p>Automation will appear once follow-ups have been sent.</p>
    </div>
  );

  const totalSent   = entries.reduce((s, [, d]) => s + (d.sent || 0), 0);
  const totalFailed = entries.reduce((s, [, d]) => s + (d.failed || 0), 0);

  return (
    <div>
      <div className="rv2-auto-summary-bar">
        <span className="rv2-auto-total">{totalSent.toLocaleString()} messages sent</span>
        {totalFailed > 0 && <span className="rv2-auto-failed">{totalFailed} failed</span>}
      </div>
      <div className="rv2-auto-rows">
        {entries.map(([key, data]) => {
          const { sent = 0, failed = 0, attempts = 0, lastRun } = data;
          const rate = attempts > 0 ? Math.round((sent / attempts) * 100) : null;
          return (
            <div key={key} className="rv2-auto-row">
              <div className="rv2-auto-row-left">
                <span className="rv2-auto-label">{TIER_LABELS[key] || key}</span>
                {lastRun && <span className="rv2-auto-last">Last: {_timeAgo(lastRun)}</span>}
              </div>
              <div className="rv2-auto-row-right">
                <span className="rv2-auto-sent">{sent} sent</span>
                {failed > 0 && <span className="rv2-auto-fail-ct">{failed} failed</span>}
                {rate !== null && (
                  <span className="rv2-auto-rate" style={{ color: rate >= 50 ? "var(--success)" : "var(--text-dim)" }}>
                    {rate}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── System Performance ─────────────────────────────────────────────────────────

function SystemPerf({ opsData, metrics, loading }) {
  const uptime     = opsData?.uptime?.seconds ?? 0;
  const memory     = opsData?.memory?.current?.heap_mb ?? null;
  const memWarn    = opsData?.memory?.warn ?? 512;
  const completed  = opsData?.queue?.counts?.completed ?? 0;
  const failed     = opsData?.queue?.counts?.failed ?? 0;
  const dlq        = opsData?.queue?.dlq ?? 0;
  const avgResp    = metrics?.avg_response_ms ?? null;

  // A.6 business-owner-journey finding: "Avg response" unconditionally said
  // "Backend unavailable" whenever avgResp was null — which, per the
  // Workflow Coverage Completion fix a few lines above (isOperator gate on
  // getMetrics()), is ALWAYS true for every non-operator founder account.
  // The backend is not unavailable; this metric is simply operator-only
  // data a founder account never fetches. Confirmed live: real signup,
  // non-operator account, Reports page showed "Backend unavailable" next
  // to a correctly-loading page with real lead/pipeline data everywhere
  // else on it. The sibling "Memory usage" row above already handles its
  // own null case honestly (empty sub-label, not a false claim) — matched
  // that existing pattern instead of inventing new copy.
  // Phase A.11.6: same operator-gated-/ops root cause as ServiceHealth below.
  // "Tasks completed" read `opsData?.queue?.counts?.completed ?? 0` and then
  // asserted the sub-label "All healthy" — so every founder was told, as fact,
  // that zero tasks had run and everything was healthy, from data the account
  // is never allowed to fetch (403). Uptime already degraded honestly to "—"
  // (via _fmtUptime(0)); this row now matches that existing behaviour instead
  // of asserting a queue state it cannot see.
  const queueKnown = opsData?.queue?.counts != null;
  const rows = [
    { label: "System uptime",    value: _fmtUptime(uptime),                     sub: uptime ? _uptimePct(uptime) + " of 7-day window" : "" },
    { label: "Tasks completed",  value: queueKnown ? completed.toLocaleString() : "—", sub: queueKnown ? (failed > 0 ? `${failed} failed · ${dlq} in DLQ` : "All healthy") : "" },
    { label: "Memory usage",     value: memory !== null ? `${memory} MB` : "—", sub: memory !== null ? (memory > memWarn ? "High" : "Normal") : "" },
    { label: "Avg response",     value: avgResp !== null ? `${avgResp}ms` : "—", sub: avgResp !== null ? (avgResp > 1000 ? "Slow" : "Normal") : "" },
  ];

  return (
    <div className="rv2-perf-rows">
      {rows.map(r => (
        <div key={r.label} className="rv2-perf-row">
          <span className="rv2-perf-label">{r.label}</span>
          <div className="rv2-perf-right">
            {loading ? <Skeleton w={60} h={13} /> : (
              <>
                <span className="rv2-perf-value">{r.value}</span>
                {r.sub && <span className="rv2-perf-sub">{r.sub}</span>}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Service Health Row ─────────────────────────────────────────────────────────

function ServiceHealth({ opsData, online, loading }) {
  // Phase A.11.6 finding: `opsData` comes from GET /ops, which is operatorOnly
  // server-side (backend/routes/ops.js line 74) — confirmed live, a real
  // founder account gets 403. So `svcs` is ALWAYS {} for every founder, and
  // these rows asserted "AI Engine: Not configured", "WhatsApp: Not set up",
  // "Payments: Not configured" as fact on every single load. Cross-checked
  // against the real, unauthenticated GET /health on this same running
  // backend: `{"ai":false,"telegram":true,"whatsapp":true,"payments":true}` —
  // so two of those three claims were not merely unknown, they were FALSE.
  // The page already uses the app-wide "—" unknown placeholder for exactly
  // this purpose (System Performance's Memory usage / Avg response rows right
  // above). `Runtime` is unaffected: `online` is real, live health-poll state
  // owned by App.jsx, not operator-gated telemetry, so it keeps its real value.
  const known = !!opsData;
  const svcs = opsData?.services || {};
  const rows = [
    { label: "AI Engine",  known, ok: !!(svcs.ai || svcs.groq), detail: known ? ((svcs.ai || svcs.groq) ? "Active" : "Not configured") : "—" },
    { label: "WhatsApp",   known, ok: !!svcs.whatsapp,          detail: known ? (svcs.whatsapp ? "Connected" : "Not set up") : "—" },
    { label: "Payments",   known, ok: !!svcs.payments,          detail: known ? (svcs.payments ? "Razorpay live" : "Not configured") : "—" },
    { label: "Runtime",    known: true, ok: online,             detail: online ? "Online" : "Reconnecting…" },
  ];

  return (
    <div className="rv2-health-rows">
      {loading
        ? [0,1,2,3].map(i => <div key={i} className="rv2-health-row"><Skeleton h={16} /></div>)
        : rows.map(r => (
          <div key={r.label} className="rv2-health-row">
            {/* Phase A.11.6: an unknown service renders the app's existing
                `dot--dim` neutral state (index.css: "Use with a color class:
                .dot--ok / .dot--warn / .dot--crit / .dot--dim"), not a warning
                colour that would assert a problem we cannot actually see. */}
            <span className={`rv2-health-dot dot--${!r.known ? "dim" : r.ok ? "ok" : "warn"}${r.known ? " dot--live" : ""}`} />
            <span className="rv2-health-label">{r.label}</span>
            <span className={`rv2-health-detail${r.known && !r.ok ? " rv2-health-detail--warn" : ""}`}>{r.detail}</span>
          </div>
        ))
      }
    </div>
  );
}

// ── Root Reports V2 ───────────────────────────────────────────────────────────

export default function ReportsV2({ online = false, onNavigate }) {
  const { user } = useAuth();
  const [stats,     setStats]     = useState(null);
  const [opsData,   setOpsData]   = useState(null);
  const [metrics,   setMetrics]   = useState(null);
  const [leads,     setLeads]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Workflow Coverage Completion finding: getStats/getOpsData/getMetrics
      // (-> /stats, /ops, /metrics) are operatorOnly server-side. Every
      // non-operator founder ALWAYS gets null back from all three (403,
      // swallowed) — which is exactly the signal this component's own
      // "all three null = real outage" heuristic below was built to
      // detect, so it fired a false "Couldn't load reports — Backend
      // unavailable" banner on every single load for every founder, sitting
      // directly above genuinely correct, successfully-loaded lead/revenue
      // data from the separate getLeads() call. Skipping the operator-only
      // calls entirely for non-operators (rather than letting them resolve
      // to null and be misread as an outage) fixes the false positive while
      // preserving the real check for an actual operator-session outage.
      //
      // Phase A.10.7 finding: getLeads() (-> /crm/leads) reads the OLD,
      // disconnected crmService.js store, filtered by userId — not orgId.
      // Live-confirmed on a real 5-lead account: /crm/leads returned []
      // (zero of those 40 leads.json records carry this account's userId),
      // while the Dashboard (CustomerDashboard.jsx -> /business/dashboard
      // -> businessDataService.getDashboard(orgId)) correctly showed "5
      // leads, 4 new" from the newer, org-scoped business-leads.json store
      // — via an A.6-documented merge fix already applied there but never
      // applied here. Every KPI card on this page (Total Leads, Revenue's
      // "N paying clients" sub-label, Close Rate) plus the entire Pipeline
      // Breakdown chart derive from this one `leads` array, so all of them
      // silently showed 0/empty for every non-operator founder with real
      // CRM activity. getLeadsV5() (-> /business/leads, already used
      // elsewhere in the app) reads the same org-scoped store the Dashboard
      // uses — same org-attach middleware, no new backend route, no schema
      // change.
      const isOperator = user?.role === "operator";
      const [st, ops, met, ledsResp] = await Promise.all([
        isOperator ? getStats()   : Promise.resolve(undefined),
        isOperator ? getOpsData() : Promise.resolve(undefined),
        isOperator ? getMetrics() : Promise.resolve(undefined),
        getLeadsV5({ limit: 1000 }),
      ]);
      setStats(st ?? null);
      setOpsData(ops ?? null);
      setMetrics(met ?? null);

      // Phase A.11.6 finding: getLeadsV5() does NOT throw on a failed fetch —
      // businessApi.js catches and returns `{ success: false, error, leads: [] }`.
      // The old check here (`Array.isArray(ledsResp?.leads)`) is satisfied by
      // that empty array, so a total failure of the ONE fetch every KPI card
      // and the Pipeline Breakdown chart depend on was indistinguishable from a
      // genuinely empty account: refresh()'s catch never ran, setError(null)
      // was called, and the page asserted "TOTAL LEADS 0 / CLOSE RATE 0% /
      // 0 leads tracked / No lead data yet. Add contacts to see pipeline
      // distribution." with no error banner at all. Proven live by aborting the
      // real request at the transport layer. The real backend
      // (backend/routes/business.js's `_ok` -> `{ success: true, ... }`)
      // genuinely sends `success`, so it is the correct discriminator here —
      // the same read-the-real-envelope rule A.11.5 applied to `/orgs/*`'s
      // `{ok:true}`. A real failure now sets the page's existing, already-built
      // error banner instead of silently claiming zero pipeline.
      const leadsFailed = ledsResp?.success === false || !Array.isArray(ledsResp?.leads);
      setLeads(leadsFailed ? null : ledsResp.leads);

      if (leadsFailed) {
        setError(ledsResp?.error || "Lead data could not be loaded.");
      } else if (isOperator && st == null && ops == null && met == null) {
        setError("Backend unavailable — reports data could not be loaded.");
      } else {
        setError(null);
      }
    } catch (e) {
      setError(e.message || "Failed to load reports data");
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Phase A.10.7 finding: this button sits on a page titled "Reports —
  // Executive summary" showing Total Leads/Revenue/Messages Sent/Close
  // Rate/Pipeline Breakdown, but clicking it downloaded
  // /runtime/export/analytics — a real, working endpoint, but for a
  // completely different domain (engineering workflow-chain/recovery
  // telemetry, e.g. "chain-0: 12 runs, 67% success") with zero mention of
  // leads/revenue/CRM anywhere in it. A founder exporting "their report"
  // got the wrong report. Its own error-path fallback (below, now the only
  // path) already builds a payload from real on-page state, but never ran
  // because the primary fetch always succeeded (200), and even the
  // fallback never included the `leads` array the KPI cards and Pipeline
  // Breakdown chart are actually built from. Exporting what's genuinely on
  // screen — no new backend route, no new data source.
  async function handleExport() {
    setExporting(true);
    try {
      // Phase A.11.6: if the leads fetch genuinely failed, `leads` is null.
      // Exporting `totalLeads: 0 / closeRate: "0%"` in that state would write a
      // false claim into a file a founder may hand to a stakeholder — the same
      // "wrong deliverable" risk class A.10.7 fixed on this button, in a
      // different form. `leadsAvailable` makes the unknown explicit in the file
      // itself rather than silently exporting zeros.
      const known = Array.isArray(leads);
      const items = known ? leads : [];
      const hot   = items.filter(l => l.status === "hot" || l.status === "qualified").length;
      const paid  = items.filter(l => l.status === "paid" || l.status === "converted" || l.paymentStatus === "paid").length;
      const rate  = items.length > 0 && paid > 0 ? `${Math.round((paid / items.length) * 100)}%` : "0%";
      const byStatus = items.reduce((acc, l) => { const s = l.status || "new"; acc[s] = (acc[s] || 0) + 1; return acc; }, {});
      const payload = {
        exportedAt:   new Date().toISOString(),
        leadsAvailable: known,
        summary: {
          totalLeads:   known ? items.length : null,
          hotLeads:     known ? hot : null,
          paidLeads:    known ? paid : null,
          closeRate:    known ? rate : null,
          messagesSent: opsData ? Object.values(opsData.automation || {}).reduce((s, d) => s + (d.sent || 0), 0) : null,
          revenue:      stats?.revenue ?? null,
        },
        pipelineBreakdown: known ? byStatus : null,
        leads:         known ? leads : null,
        opsAutomation: opsData?.automation ?? null,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ooplix-report-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const now       = new Date();
  const monthName = MONTH_LABELS[now.getMonth()];
  const yearStr   = now.getFullYear();

  const totalActions  = Object.values(opsData?.automation || {}).reduce((s, d) => s + (d.sent || 0), 0);

  // A.6 business-owner-journey finding: the 4 KPI cards below (Total
  // Leads, Revenue, Close Rate, and the "leads tracked" sub-label) all
  // read from `stats`, which is only ever populated for operator
  // accounts (see the isOperator gate on getStats() above) — every
  // non-operator founder always sees stats === null, so these cards
  // showed "0"/"₹0"/"0%" regardless of real lead activity. Confirmed
  // live: a real signup, one real lead added via Contacts, and these
  // cards still read zero while the Pipeline Breakdown panel below —
  // which already derives its numbers from the real `leads` array
  // instead of `stats` — correctly showed it. leadStats mirrors
  // crmService.js's own getStats(orgId) formula (same total/hot/paid/
  // revenue shape) computed client-side from the same `leads` array
  // PipelineChart already uses successfully — no new data source, just
  // consulting the array that was already being fetched and displayed
  // correctly one panel down.
  //
  // Phase A.10.7: `leads` now comes from /business/leads (see refresh()
  // above), whose real status vocabulary (businessDataService.cjs's
  // LEAD_STATUSES: new/contacted/qualified/disqualified/converted) never
  // contains "hot" or "paid" — the legacy crmService statuses this filter
  // was written against. Without this, hot/paid — and therefore Close
  // Rate, which divides by paid — would silently read 0 again under the
  // new data source. "qualified" is the real model's closest hot-lead
  // signal; "converted" is its closest won/paid signal.
  //
  // Phase A.11.6: `leads` is now null (not []) when the fetch genuinely failed,
  // so `known` distinguishes "we don't know" from "we know it's zero". A real,
  // successfully-loaded empty account still yields known === true and therefore
  // still renders a real `0` — the guard is conditional, not a blanket
  // suppression, which would be its own dishonesty (same anti-over-correction
  // rule A.11.5 applied to TeamWorkspace's summary tiles).
  const leadStats = useMemo(() => {
    const known = Array.isArray(leads);
    const items = known ? leads : [];
    const hot   = items.filter(l => l.status === "hot" || l.status === "qualified").length;
    const paid  = items.filter(l => l.status === "paid" || l.status === "converted" || l.paymentStatus === "paid").length;
    return { known, total: items.length, hot, paid };
  }, [leads]);

  const convRate      = !leadStats.known
    ? "—"
    : leadStats.total > 0 && leadStats.paid > 0
      ? `${Math.round((leadStats.paid / leadStats.total) * 100)}%`
      : "0%";

  return (
    <div className="rv2-root page-enter">
      <JourneyBanner currentTab="reports" onNavigate={onNavigate} />

      {/* Header */}
      <div className="rv2-header">
        <div className="rv2-header-left">
          <h1 className="rv2-page-title">Reports</h1>
          <p className="rv2-page-sub">Executive summary · {monthName} {yearStr}</p>
        </div>
        <div className="rv2-header-right">
          <button className="rv2-export-btn" onClick={handleExport} disabled={exporting || loading} title="Export report as JSON">
            {exporting ? "⟳ Exporting…" : "↓ Export"}
          </button>
          <button className="rv2-refresh-btn" onClick={refresh} title="Refresh data">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Distinct error state — a real backend outage, not "still loading" */}
      {error && (
        <div className="rv2-error-banner">
          <span className="rv2-error-icon">⚠</span>
          <div>
            <p className="rv2-error-title">Couldn't load reports</p>
            <p className="rv2-error-sub">{error}</p>
          </div>
          <button className="rv2-error-retry" onClick={refresh}>Retry</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="rv2-kpi-row">
        <KpiCard
          icon="◈"
          label="Total Leads"
          value={leadStats.known ? leadStats.total : "—"}
          sub={leadStats.known ? `${leadStats.hot} hot · ${leadStats.paid} paid` : "Lead data unavailable"}
          accent="var(--accent)"
          loading={loading}
        />
        <KpiCard
          icon="₹"
          label="Revenue"
          value={stats ? _fmtINR(stats.revenue) : "—"}
          sub={leadStats.known ? `${leadStats.paid} paying clients` : "Lead data unavailable"}
          accent="var(--success)"
          loading={loading}
        />
        <KpiCard
          icon="✉"
          label="Messages Sent"
          value={opsData ? totalActions.toLocaleString() : "—"}
          sub={opsData ? "automated follow-ups" : "Automation data unavailable"}
          accent="var(--accent2)"
          loading={loading}
        />
        <KpiCard
          icon="◎"
          label="Close Rate"
          value={convRate}
          sub={leadStats.known ? `${leadStats.total} leads tracked` : "Lead data unavailable"}
          accent={parseFloat(convRate) >= 20 ? "var(--success)" : "var(--warning)"}
          loading={loading}
        />
      </div>

      {/* Main content grid */}
      <div className="rv2-grid">

        <div className="rv2-grid-main">

          {/* Pipeline breakdown */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">Pipeline Breakdown</h2>
              <button className="rv2-panel-link" onClick={() => onNavigate?.("clients")}>
                Contacts →
              </button>
            </div>
            <PipelineChart leads={leads} loading={loading} />
          </section>

          {/* Automation summary */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">Automation Summary</h2>
              <button className="rv2-panel-link" onClick={() => onNavigate?.("activity")}>
                Activity →
              </button>
            </div>
            <AutoSummary opsData={opsData} loading={loading} />
          </section>

        </div>

        <div className="rv2-grid-side">

          {/* System performance */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">System Performance</h2>
            </div>
            <SystemPerf opsData={opsData} metrics={metrics} loading={loading} />
          </section>

          {/* Service health */}
          <section className="rv2-panel">
            <div className="rv2-panel-header">
              <h2 className="rv2-section-label">Service Health</h2>
              <button className="rv2-panel-link" onClick={() => onNavigate?.("devops")}>
                DevOps →
              </button>
            </div>
            <ServiceHealth opsData={opsData} online={online} loading={loading} />
          </section>

        </div>
      </div>

    </div>
  );
}
