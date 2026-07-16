import React, { useState, useCallback, useEffect } from "react";
import { track } from "../analytics";
import { listActions, getAgentFailures } from "../phase18Api";
import { getOAuthProviderStatus, listOAuthConnections } from "../phase21Api";
import "./ExecutionConnectorCenter.css";

// Static display metadata only (icon/color/label) — connection state, scopes,
// and history/failures all come from the live backend below. No fake counts.
const CONNECTOR_META = {
  google:     { icon: "📧", name: "Google",     type: "Email/Drive" },
  github:     { icon: "🐙", name: "GitHub",     type: "Code" },
  slack:      { icon: "💬", name: "Slack",      type: "Comms" },
  notion:     { icon: "📝", name: "Notion",     type: "Docs" },
  microsoft:  { icon: "🪟", name: "Microsoft",  type: "Productivity" },
  linkedin:   { icon: "💼", name: "LinkedIn",   type: "Social" },
};

const iconOf = id => CONNECTOR_META[id]?.icon || "🔌";
const nameOf = id => CONNECTOR_META[id]?.name || id;

export default function ExecutionConnectorCenter({ onNavigate }) {
  const [providers,   setProviders]   = useState({});
  const [connections, setConnections] = useState([]);
  const [tab,         setTab]         = useState("connectors");
  const [history,     setHistory]     = useState([]);
  const [failures,    setFailures]    = useState([]);
  const [apiError,    setApiError]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const TABS = ["connectors", "permissions", "history", "failures"];

  useEffect(() => {
    let cancelled = false;
    track.event("execution_connector_center_viewed");
    Promise.all([
      getOAuthProviderStatus(),
      listOAuthConnections(),
      listActions({ limit: 30 }),
      getAgentFailures({ limit: 20 }),
    ]).then(([statusRes, connRes, actionsRes, failuresRes]) => {
      if (cancelled) return;
      setProviders(statusRes?.providers || {});
      setConnections(connRes?.connections || []);
      setHistory(actionsRes?.actions || []);
      setFailures(failuresRes?.failures || []);
    }).catch(err => { if (!cancelled) setApiError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const connectedIds = new Set(connections.map(c => c.provider));
  const providerIds = Object.keys(providers);
  const connectedCount = providerIds.filter(id => connectedIds.has(id)).length;

  return (
    <div className="ecc">
      {apiError && <div className="ac-api-banner ac-api-banner--error">⚠ Live connector data unavailable ({apiError})</div>}
      <div className="ecc-header">
        <div>
          <h1 className="ecc-title">Execution Connector Center</h1>
          <p className="ecc-subtitle">Connected services, granted OAuth scopes, and real execution history.</p>
        </div>
      </div>

      <div className="ecc-stats">
        <div className="ecc-stat"><span className="ecc-stat-val" style={{ color: "#00dc82" }}>{connectedCount}</span><span className="ecc-stat-lbl">Connected</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val">{providerIds.length}</span><span className="ecc-stat-lbl">Available</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val" style={{ color: "var(--warning)" }}>{history.length}</span><span className="ecc-stat-lbl">Recent actions</span></div>
        <div className="ecc-stat"><span className="ecc-stat-val" style={{ color: "#ff6464" }}>{failures.length}</span><span className="ecc-stat-lbl">Failures</span></div>
      </div>

      <div className="ecc-tabs">
        {TABS.map(t => (
          <button key={t} className={`ecc-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      {loading ? (
        <div className="ecc-empty">Loading…</div>
      ) : (
        <>
          {tab === "connectors" && (
            <div className="ecc-connector-grid">
              {providerIds.map(id => {
                const on = connectedIds.has(id);
                const p = providers[id];
                return (
                  <div key={id} className="ecc-connector-card">
                    <div className="ecc-connector-head">
                      <div className="ecc-connector-icon" style={{ background: on ? "#00dc8222" : "var(--surface-raised)" }}>{iconOf(id)}</div>
                      <div>
                        <div className="ecc-connector-name">{nameOf(id)}</div>
                        <div className="ecc-connector-type">{p.configured ? "Configured" : "Not configured on server"}</div>
                      </div>
                    </div>
                    <div className="ecc-connector-status">
                      <div className="ecc-status-dot" style={{ background: on ? "#00dc82" : "var(--text-faint)" }} />
                      <span style={{ color: on ? "#00dc82" : "var(--text-faint)" }}>{on ? "Connected" : "Disconnected"}</span>
                    </div>
                    <div className="ecc-connector-actions">{(p.scopes || []).length} scopes available</div>
                    <div className="ecc-connector-footer">
                      <span className="ecc-connector-runs">{p.clientId === "set" ? "credentials set" : "credentials missing"}</span>
                      <button className="ecc-connect-btn" onClick={() => onNavigate?.("integrations")}>
                        Manage in Integrations →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "permissions" && (
            <table className="ecc-table">
              <thead>
                <tr><th>Connector</th><th>Granted scopes</th></tr>
              </thead>
              <tbody>
                {providerIds.map(id => (
                  <tr key={id}>
                    <td>{iconOf(id)} {nameOf(id)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                      {(providers[id].scopes || []).length ? providers[id].scopes.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === "history" && (
            history.length === 0 ? <div className="ecc-empty">No recent actions.</div> : (
              <table className="ecc-table">
                <thead>
                  <tr><th>Time</th><th>Action</th><th>Status</th><th>Detail</th></tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.actionId || i}>
                      <td style={{ color: "var(--text-faint)" }}>{h.startedAt ? new Date(h.startedAt).toLocaleTimeString() : "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{(h.input || "").slice(0, 60) || h.type || "action"}</td>
                      <td><span className={`ecc-badge ecc-badge-${h.status || "unknown"}`}>{h.status || "unknown"}</span></td>
                      <td style={{ fontSize: 12 }}>{h.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === "failures" && (
            failures.length === 0 ? <div className="ecc-empty">No recent failures.</div> : (
              <table className="ecc-table">
                <thead>
                  <tr><th>Time</th><th>Agent/Action</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {failures.map((f, i) => {
                    const ts = f.completedAt || f.startedAt;
                    return (
                      <tr key={f.id || i}>
                        <td style={{ color: "var(--text-faint)" }}>{ts ? new Date(ts).toLocaleTimeString() : "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{f.agentId || "—"}</td>
                        <td style={{ color: "#ff6464", fontSize: 12 }}>{f.error || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
        </>
      )}
    </div>
  );
}
