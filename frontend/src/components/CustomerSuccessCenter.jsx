"use strict";
// V6 Phase 7: Customer Success Center — the /customer-org/* backend
// (POST-Ω Sprint P11: journey/health/success/support/automation engines)
// was fully built with zero frontend consumers until this component.
import React, { useState, useEffect, useCallback } from "react";
import * as co from "../customerOrgApi";

function Kpi({ value, label, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#e8ecf5", fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim, #8994b0)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "health",   label: "Customer Health" },
  { id: "tickets",  label: "Support Tickets" },
];

export default function CustomerSuccessCenter() {
  const [tab, setTab] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  // Phase A.11.7 — `null` means "we do not know" (the fetch failed or has not
  // run), `[]` means "the backend genuinely returned zero records". Before this
  // both collapsed to `[]`, so a failed fetch rendered the same confident
  // "No health records yet." / "No support tickets yet." copy as a genuinely
  // empty account. Measured live by aborting ONLY these two requests at the
  // transport layer while /customer-org/dashboard still succeeded: the Health
  // and Tickets tabs each claimed zero records at the same moment the Overview
  // tab beside them displayed "147 OPEN TICKETS" and "27 AT RISK" from the real
  // backend — which really holds 20 health records and 20 tickets. Same unknown-
  // vs-real-zero distinction A.11.5 used for TeamWorkspace's tiles and A.11.6
  // for ReportsV2's KPI cards. Both /customer-org/health and
  // /customer-org/support/tickets are `{ok:true}` routes (backend/routes/
  // customerOrg.js's `ok()` helper), so `ok === false` is the correct
  // discriminator here — not `success`.
  const [health, setHealth] = useState(null);
  const [tickets, setTickets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      co.getDashboard().catch(e => ({ ok: false, error: e.message })),
      co.listHealthRecords({ limit: 20 }).catch(e => ({ ok: false, error: e.message })),
      co.listTickets({ limit: 20 }).catch(e => ({ ok: false, error: e.message })),
    ]).then(([d, h, t]) => {
      setDashboard(d?.ok !== false ? d : null);
      setHealth(h?.ok !== false ? (h.records || []) : null);
      setTickets(t?.ok !== false ? (t.tickets || []) : null);
      setError(d?.ok === false ? (d.error || "Failed to load customer success dashboard") : null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resolve = async (id) => {
    setBusy(id);
    try { await co.resolveTicket(id, { resolution: "Resolved via Customer Success Center" }); refresh(); }
    finally { setBusy(null); }
  };

  if (loading && !dashboard) return <div style={{ padding: 24, color: "var(--text-dim, #8994b0)" }}>Loading customer success dashboard…</div>;
  if (error && !dashboard) return (
    <div style={{ padding: 24 }}>
      <div style={{ color: "var(--danger)", marginBottom: 8 }}>⚠ {error}</div>
      <button onClick={refresh}>Retry</button>
    </div>
  );

  const s = dashboard?.summary || {};

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      {/* Phase A.11.7 — page header aligned to the measured app-wide baseline.
          Every other in-scope surface (Support Center's .sc-title, Connectors'
          .csw-title, Referral Engine's .ref-title, Marketplace's .mc-title,
          Partner Program's .pp-title) plus the A.11.1–A.11.6 reference set
          (.oac-/.tw-/.ws-/.bd-/.analytics-/.rv2-page-title) all measure
          22px / 800 / -0.3px / var(--text) with a 13.5px var(--text-dim)
          subtitle. This one measured 18px / 700 / normal and had no subtitle
          at all — the sole outlier of the surfaces surveyed in this phase.
          Values copied from the existing baseline; nothing redesigned. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px", color: "var(--text)" }}>Customer Success</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--text-dim)" }}>
            Customer health, churn risk, expansion opportunities, and support tickets.
          </p>
        </div>
        <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ fontWeight: tab === t.id ? 700 : 400, opacity: tab === t.id ? 1 : 0.6 }}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 24 }}>
            <Kpi value={s.totalCustomers ?? "—"} label="Total Customers" color="var(--accent)" />
            <Kpi value={s.avgHealthScore ?? "—"} label="Avg Health Score" color="var(--success)" />
            <Kpi value={s.atRiskCount ?? "—"} label="At Risk" color="var(--warning)" />
            <Kpi value={s.churnRiskCount ?? "—"} label="Churn Risk" color="var(--danger)" />
            <Kpi value={s.expansionOpportunities ?? "—"} label="Expansion Opps" color="var(--accent2)" />
            <Kpi value={s.supportTicketsOpen ?? "—"} label="Open Tickets" color="var(--info)" />
          </div>

          {dashboard?.founderTimeSaved && (
            <div style={{ marginBottom: 24, fontSize: 12, color: "var(--text-dim, #8994b0)" }}>
              {dashboard.founderTimeSaved.totalHours ?? 0}h saved via automation + support ({dashboard.founderTimeSaved.bySource?.automations ?? 0}min automations, {dashboard.founderTimeSaved.bySource?.support ?? 0}min support)
            </div>
          )}

          {dashboard?.customerHealth?.topAtRisk?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim, #8994b0)", marginBottom: 8 }}>
                Top At-Risk Customers
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dashboard.customerHealth.topAtRisk.map(r => (
                  <div key={r.customerId} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12 }}>
                    <span style={{ fontFamily: "monospace" }}>{r.customerId}</span>
                    <span style={{ color: r.risk === "critical" ? "var(--danger)" : "var(--warning)" }}>{r.overall} · {r.risk}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "health" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {health === null ? (
            <div style={{ fontSize: 12, color: "var(--warning)" }}>⚠ Couldn't load health records — the request failed. Use Refresh to retry.</div>
          ) : health.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>No health records yet.</div>
          ) : health.map(h => (
            <div key={h.customerId} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12 }}>
              <span style={{ fontFamily: "monospace" }}>{h.customerId}</span>
              <span>{h.grade} · {h.overall}</span>
              <span style={{ color: h.risk === "critical" ? "var(--danger)" : h.risk === "high" ? "var(--warning)" : "var(--success)" }}>{h.risk}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "tickets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tickets === null ? (
            <div style={{ fontSize: 12, color: "var(--warning)" }}>⚠ Couldn't load support tickets — the request failed. Use Refresh to retry.</div>
          ) : tickets.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>No support tickets yet.</div>
          ) : tickets.map(t => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12 }}>
              <span>{t.subject || t.issue || t.id}</span>
              <span style={{ color: t.status === "resolved" ? "var(--success)" : "var(--warning)" }}>{t.status}</span>
              {t.status !== "resolved" && (
                <button disabled={busy === t.id} onClick={() => resolve(t.id)}>{busy === t.id ? "…" : "Resolve"}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
