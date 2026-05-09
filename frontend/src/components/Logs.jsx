import React from "react";
import "./Logs.css";

function Bar({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="bar-count">{value}</span>
    </div>
  );
}

export default function Logs({ metrics }) {
  if (!metrics) {
    return (
      <div className="logs logs--empty">
        <div className="logs-empty-msg">Waiting for backend metrics…</div>
      </div>
    );
  }

  const { requests = 0, errors = 0, paymentLinks = 0, waSent = 0, byIntent = {}, byMode = {}, uptime = 0, crm } = metrics;

  const intentTotal = Object.values(byIntent).reduce((a, b) => a + b, 0);
  const modeTotal   = Object.values(byMode).reduce((a, b)   => a + b, 0);

  const intentColors = { payment: "#00e676", search: "#00d4ff", greeting: "#6c63ff", intelligence: "#ffab40", crm: "#ff4081", execution: "#ff9800" };
  const modeColors   = { sales: "#00e676", execution: "#00d4ff", intelligence: "#6c63ff" };

  const upStr = uptime ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` : "—";

  return (
    <div className="logs">
      {/* Key metrics row */}
      <div className="log-metrics">
        <div className="log-metric">
          <div className="log-metric-val">{requests}</div>
          <div className="log-metric-lbl">Requests</div>
        </div>
        <div className="log-metric log-metric--danger">
          <div className="log-metric-val">{errors}</div>
          <div className="log-metric-lbl">Errors</div>
        </div>
        <div className="log-metric log-metric--success">
          <div className="log-metric-val">{paymentLinks}</div>
          <div className="log-metric-lbl">Pay Links</div>
        </div>
        <div className="log-metric log-metric--accent">
          <div className="log-metric-val">{waSent}</div>
          <div className="log-metric-lbl">WA Sent</div>
        </div>
        <div className="log-metric">
          <div className="log-metric-val">{upStr}</div>
          <div className="log-metric-lbl">Uptime</div>
        </div>
      </div>

      <div className="log-sections">
        {/* Intent breakdown */}
        <div className="log-section">
          <h3 className="log-section-title">Intent Breakdown</h3>
          {Object.entries(byIntent).length === 0
            ? <p className="log-none">No data yet.</p>
            : Object.entries(byIntent)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Bar key={k} label={k} value={v} total={intentTotal} color={intentColors[k] || "#888"} />
                ))
          }
        </div>

        {/* Mode breakdown */}
        <div className="log-section">
          <h3 className="log-section-title">Mode Breakdown</h3>
          {Object.entries(byMode).length === 0
            ? <p className="log-none">No data yet.</p>
            : Object.entries(byMode)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Bar key={k} label={k} value={v} total={modeTotal} color={modeColors[k] || "#888"} />
                ))
          }
        </div>

        {/* CRM snapshot */}
        {crm && (
          <div className="log-section">
            <h3 className="log-section-title">CRM Snapshot</h3>
            {[
              { label: "Total",      value: crm.total      ?? 0, color: "#e0e0e0" },
              { label: "New",        value: crm.new        ?? 0, color: "#6c63ff" },
              { label: "Hot",        value: crm.hot        ?? 0, color: "#ffab40" },
              { label: "Paid",       value: crm.paid       ?? 0, color: "#00e676" },
              { label: "Onboarded",  value: crm.onboarded  ?? 0, color: "#00d4ff" }
            ].map(r => (
              <div key={r.label} className="crm-row">
                <span className="crm-dot" style={{ background: r.color }} />
                <span className="crm-label">{r.label}</span>
                <span className="crm-val">{r.value}</span>
              </div>
            ))}
            {crm.revenue != null && (
              <div className="crm-revenue">Revenue: ₹{crm.revenue}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
