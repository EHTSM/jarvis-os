import React, { useState, useEffect } from "react";
import { track } from "../analytics";
import "./ExecutiveReports.css";

// ── Pull from existing localStorage data ──────────────────────────────
function _loadStats() {
  const contacts = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_contacts") || "[]"); } catch { return []; }
  })();
  const billing = (() => {
    try { return JSON.parse(localStorage.getItem("jarvis_billing") || "null"); } catch { return null; }
  })();
  return { contacts, billing };
}

// ── Seed report data ──────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENT_MONTH = new Date().getMonth();

function _seedMonthly() {
  return MONTHS.slice(0, CURRENT_MONTH + 1).map((m, i) => ({
    month:      m,
    revenue:    Math.round(2499 + Math.random() * 5000 + i * 400),
    leads:      Math.round(18 + Math.random() * 12 + i * 2),
    conversions:Math.round(3 + Math.random() * 4 + i * 0.5),
    churn:      Math.round(Math.random() * 2),
    activity:   Math.round(40 + Math.random() * 30 + i * 3),
  }));
}

const MONTHLY = _seedMonthly();
const LATEST  = MONTHLY[MONTHLY.length - 1] || { revenue: 0, leads: 0, conversions: 0, churn: 0, activity: 0 };
const PREV    = MONTHLY[MONTHLY.length - 2] || LATEST;

function delta(curr, prev) {
  if (!prev) return null;
  const d = Math.round(((curr - prev) / (prev || 1)) * 100);
  return d;
}

function DeltaBadge({ curr, prev, invert = false }) {
  const d = delta(curr, prev);
  if (d === null) return null;
  const positive = invert ? d < 0 : d > 0;
  const color = d === 0 ? "var(--text-faint)" : positive ? "var(--success)" : "var(--danger)";
  return <span className="er-delta" style={{ color }}>{d > 0 ? "+" : ""}{d}% vs prev</span>;
}

function Sparkline({ data, color = "var(--accent2)", height = 40 }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 120; const h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="er-sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function MiniBar({ value, max, color }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="er-mini-bar-track">
      <div className="er-mini-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function ExecutiveReports({ onNavigate }) {
  const [section,   setSection]   = useState("overview");
  const [period,    setPeriod]    = useState("monthly");

  useEffect(() => { track.event("executive_reports_viewed"); }, []);

  const totalRevenue    = MONTHLY.reduce((s, m) => s + m.revenue, 0);
  const totalLeads      = MONTHLY.reduce((s, m) => s + m.leads, 0);
  const totalConversions= MONTHLY.reduce((s, m) => s + m.conversions, 0);
  const convRate        = totalLeads ? Math.round((totalConversions / totalLeads) * 100) : 0;
  const totalChurn      = MONTHLY.reduce((s, m) => s + m.churn, 0);
  const retentionRate   = Math.max(0, 100 - Math.round((totalChurn / Math.max(totalConversions, 1)) * 100));

  const handleExport = () => {
    const rows = [
      ["Month", "Revenue (₹)", "Leads", "Conversions", "Churn", "Activity"],
      ...MONTHLY.map(m => [m.month, m.revenue, m.leads, m.conversions, m.churn, m.activity]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ooplix_report.csv"; a.click();
    URL.revokeObjectURL(url);
    track.event("report_exported", { section });
  };

  return (
    <div className="executive-reports page-enter">

      <div className="er-header">
        <div>
          <h1 className="er-title">Executive Reports</h1>
          <p className="er-subtitle">Revenue, leads, conversion, retention, and activity — export-ready.</p>
        </div>
        <button className="er-export-btn" onClick={handleExport}>↓ Export CSV</button>
      </div>

      <div className="ac-api-banner ac-api-banner--error">
        ⚠ No monthly revenue/leads/conversion ledger is tracked yet — the figures below are illustrative seed data, not real account activity.
      </div>

      {/* Summary KPIs */}
      <div className="er-kpi-grid">
        {[
          {
            label: "Revenue (YTD)",
            value: `₹${(totalRevenue/1000).toFixed(1)}K`,
            sparkData: MONTHLY.map(m => m.revenue),
            sparkColor: "var(--accent2)",
            curr: LATEST.revenue, prev: PREV.revenue,
          },
          {
            label: "Total leads",
            value: totalLeads,
            sparkData: MONTHLY.map(m => m.leads),
            sparkColor: "var(--accent)",
            curr: LATEST.leads, prev: PREV.leads,
          },
          {
            label: "Conversion rate",
            value: `${convRate}%`,
            sparkData: MONTHLY.map(m => m.conversions),
            sparkColor: "var(--warning)",
            curr: LATEST.conversions, prev: PREV.conversions,
          },
          {
            label: "Retention rate",
            value: `${retentionRate}%`,
            sparkData: MONTHLY.map((m, i) => Math.max(0, 100 - Math.round((m.churn / Math.max(MONTHLY.slice(0,i+1).reduce((s,x)=>s+x.conversions,0),1))*100))),
            sparkColor: "var(--success)",
            curr: retentionRate, prev: retentionRate + Math.round(Math.random()*4) - 2,
          },
        ].map(k => (
          <div key={k.label} className="er-kpi-card">
            <div className="er-kpi-top">
              <div>
                <span className="er-kpi-label">{k.label}</span>
                <span className="er-kpi-value">{k.value}</span>
                <DeltaBadge curr={k.curr} prev={k.prev} />
              </div>
              <Sparkline data={k.sparkData} color={k.sparkColor} />
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="er-tabs">
        {[
          { id: "overview",    label: "Overview"    },
          { id: "revenue",     label: "Revenue"     },
          { id: "leads",       label: "Leads"       },
          { id: "conversion",  label: "Conversion"  },
          { id: "retention",   label: "Retention"   },
          { id: "activity",    label: "Activity"    },
        ].map(t => (
          <button
            key={t.id}
            className={`er-tab${section === t.id ? " er-tab--active" : ""}`}
            onClick={() => setSection(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div className="er-content" key={section}>

        {/* Overview — all metrics in one table */}
        {section === "overview" && (
          <div className="er-overview">
            <div className="er-table-wrap">
              <table className="er-table">
                <thead>
                  <tr>
                    <th className="er-th">Month</th>
                    <th className="er-th er-th--revenue">Revenue</th>
                    <th className="er-th">Leads</th>
                    <th className="er-th">Conversions</th>
                    <th className="er-th">Conv %</th>
                    <th className="er-th er-th--danger">Churn</th>
                    <th className="er-th">Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {[...MONTHLY].reverse().map((m, i) => {
                    const cr = m.leads ? Math.round((m.conversions / m.leads) * 100) : 0;
                    const isLatest = i === 0;
                    return (
                      <tr key={m.month} className={`er-tr${isLatest ? " er-tr--latest" : ""}`}>
                        <td className="er-td er-td--month">{m.month}</td>
                        <td className="er-td er-td--revenue">₹{m.revenue.toLocaleString("en-IN")}</td>
                        <td className="er-td">{m.leads}</td>
                        <td className="er-td">{m.conversions}</td>
                        <td className="er-td er-td--rate">{cr}%</td>
                        <td className="er-td er-td--churn">{m.churn}</td>
                        <td className="er-td">{m.activity}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="er-tr er-tr--total">
                    <td className="er-td er-td--month">Total</td>
                    <td className="er-td er-td--revenue">₹{totalRevenue.toLocaleString("en-IN")}</td>
                    <td className="er-td">{totalLeads}</td>
                    <td className="er-td">{totalConversions}</td>
                    <td className="er-td er-td--rate">{convRate}%</td>
                    <td className="er-td er-td--churn">{totalChurn}</td>
                    <td className="er-td">{MONTHLY.reduce((s,m)=>s+m.activity,0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Revenue */}
        {section === "revenue" && (
          <div className="er-chart-section">
            <div className="er-chart-header">
              <span className="er-chart-title">Monthly revenue</span>
              <span className="er-chart-total">YTD: ₹{totalRevenue.toLocaleString("en-IN")}</span>
            </div>
            <div className="er-bar-chart">
              {MONTHLY.map(m => {
                const maxRev = Math.max(...MONTHLY.map(x => x.revenue));
                const pct = Math.round((m.revenue / maxRev) * 100);
                return (
                  <div key={m.month} className="er-bar-col">
                    <span className="er-bar-val">₹{(m.revenue/1000).toFixed(1)}K</span>
                    <div className="er-bar-track">
                      <div className="er-bar-fill er-bar-fill--revenue" style={{ height: `${pct}%` }} />
                    </div>
                    <span className="er-bar-label">{m.month}</span>
                  </div>
                );
              })}
            </div>
            <div className="er-metric-rows">
              {[
                { label: "Best month",   value: `${MONTHLY[MONTHLY.map(m=>m.revenue).indexOf(Math.max(...MONTHLY.map(m=>m.revenue)))].month} — ₹${Math.max(...MONTHLY.map(m=>m.revenue)).toLocaleString("en-IN")}` },
                { label: "Avg monthly",  value: `₹${Math.round(totalRevenue / MONTHLY.length).toLocaleString("en-IN")}` },
                { label: "MoM growth",   value: `${PREV.revenue ? (((LATEST.revenue - PREV.revenue) / PREV.revenue) * 100).toFixed(1) : "—"}%` },
                { label: "Projected ARR",value: `₹${(LATEST.revenue * 12).toLocaleString("en-IN")}` },
              ].map(r => (
                <div key={r.label} className="er-metric-row">
                  <span className="er-mr-label">{r.label}</span>
                  <span className="er-mr-value">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leads */}
        {section === "leads" && (
          <div className="er-chart-section">
            <div className="er-chart-header">
              <span className="er-chart-title">Monthly leads</span>
              <span className="er-chart-total">Total: {totalLeads}</span>
            </div>
            <div className="er-bar-chart">
              {MONTHLY.map(m => {
                const maxL = Math.max(...MONTHLY.map(x => x.leads));
                return (
                  <div key={m.month} className="er-bar-col">
                    <span className="er-bar-val">{m.leads}</span>
                    <div className="er-bar-track">
                      <div className="er-bar-fill er-bar-fill--leads" style={{ height: `${Math.round((m.leads/maxL)*100)}%` }} />
                    </div>
                    <span className="er-bar-label">{m.month}</span>
                  </div>
                );
              })}
            </div>
            <div className="er-metric-rows">
              {[
                { label: "Avg leads/month",  value: Math.round(totalLeads / MONTHLY.length)  },
                { label: "Best month leads", value: Math.max(...MONTHLY.map(m => m.leads))   },
                { label: "This month",       value: LATEST.leads                              },
                { label: "MoM change",       value: `${delta(LATEST.leads, PREV.leads) ?? 0}%`},
              ].map(r => (
                <div key={r.label} className="er-metric-row">
                  <span className="er-mr-label">{r.label}</span>
                  <span className="er-mr-value">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversion */}
        {section === "conversion" && (
          <div className="er-chart-section">
            <div className="er-chart-header">
              <span className="er-chart-title">Conversion rate by month</span>
              <span className="er-chart-total">Overall: {convRate}%</span>
            </div>
            <div className="er-conv-list">
              {MONTHLY.map(m => {
                const cr = m.leads ? Math.round((m.conversions / m.leads) * 100) : 0;
                return (
                  <div key={m.month} className="er-conv-row">
                    <span className="er-conv-month">{m.month}</span>
                    <MiniBar value={cr} max={100} color="var(--warning)" />
                    <span className="er-conv-rate">{cr}%</span>
                    <span className="er-conv-sub">{m.conversions}/{m.leads} leads</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Retention */}
        {section === "retention" && (
          <div className="er-chart-section">
            <div className="er-chart-header">
              <span className="er-chart-title">Retention & churn</span>
              <span className="er-chart-total">Retention: {retentionRate}%</span>
            </div>
            <div className="er-retention-cards">
              <div className="er-ret-card er-ret-card--good">
                <span className="er-ret-icon">✓</span>
                <span className="er-ret-label">Retention rate</span>
                <span className="er-ret-value">{retentionRate}%</span>
                <span className="er-ret-sub">Customers kept vs. acquired</span>
              </div>
              <div className="er-ret-card er-ret-card--churn">
                <span className="er-ret-icon">↑</span>
                <span className="er-ret-label">Total churn</span>
                <span className="er-ret-value">{totalChurn}</span>
                <span className="er-ret-sub">Cancellations YTD</span>
              </div>
            </div>
            <div className="er-churn-list">
              {MONTHLY.map(m => (
                <div key={m.month} className="er-churn-row">
                  <span className="er-churn-month">{m.month}</span>
                  <MiniBar value={m.churn} max={Math.max(...MONTHLY.map(x=>x.churn),1)} color="var(--danger)" />
                  <span className="er-churn-val" style={{ color: m.churn > 0 ? "var(--danger)" : "var(--success)" }}>
                    {m.churn > 0 ? `−${m.churn}` : "0"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity */}
        {section === "activity" && (
          <div className="er-chart-section">
            <div className="er-chart-header">
              <span className="er-chart-title">System activity by month</span>
              <span className="er-chart-total">Total: {MONTHLY.reduce((s,m)=>s+m.activity,0)} actions</span>
            </div>
            <div className="er-bar-chart">
              {MONTHLY.map(m => {
                const maxA = Math.max(...MONTHLY.map(x => x.activity));
                return (
                  <div key={m.month} className="er-bar-col">
                    <span className="er-bar-val">{m.activity}</span>
                    <div className="er-bar-track">
                      <div className="er-bar-fill er-bar-fill--activity" style={{ height: `${Math.round((m.activity/maxA)*100)}%` }} />
                    </div>
                    <span className="er-bar-label">{m.month}</span>
                  </div>
                );
              })}
            </div>
            <div className="er-metric-rows">
              {[
                { label: "Total actions",    value: MONTHLY.reduce((s,m)=>s+m.activity,0)                        },
                { label: "Avg/month",        value: Math.round(MONTHLY.reduce((s,m)=>s+m.activity,0)/MONTHLY.length) },
                { label: "This month",       value: LATEST.activity                                               },
                { label: "Peak month",       value: `${MONTHLY[MONTHLY.map(m=>m.activity).indexOf(Math.max(...MONTHLY.map(m=>m.activity)))].month} — ${Math.max(...MONTHLY.map(m=>m.activity))}` },
              ].map(r => (
                <div key={r.label} className="er-metric-row">
                  <span className="er-mr-label">{r.label}</span>
                  <span className="er-mr-value">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
