"use strict";
// V6 Phase 6 recovery: Founder Digital Twin console — the /twin/* and
// /fdios/* routes (POST-Ω Sprint P6, digitalTwinEngine.cjs +
// founderIdentityOS.cjs) were fully built with zero frontend consumers.
// Surfaces the highest-value real endpoints: dashboard, decision log,
// prediction stats, and the identity command center.
import React, { useState, useEffect, useCallback } from "react";
import * as twinApi from "../twinApi";

function Kpi({ value, label, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#e8ecf5", fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--text-dim, #8994b0)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

export default function FounderTwinConsole() {
  const [dashboard, setDashboard] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [predictStats, setPredictStats] = useState(null);
  const [commandCenter, setCommandCenter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      twinApi.getTwinDashboard().catch(e => ({ ok: false, error: e.message })),
      twinApi.getTwinDecisions(20).catch(e => ({ ok: false, error: e.message })),
      twinApi.getPredictStats().catch(e => ({ ok: false, error: e.message })),
      twinApi.getCommandCenter().catch(e => ({ ok: false, error: e.message })),
    ]).then(([d, dec, ps, cc]) => {
      if (d?.ok !== false) setDashboard(d);
      if (dec?.ok !== false) setDecisions(dec.decisions || []);
      if (ps?.ok !== false) setPredictStats(ps.stats || null);
      if (cc?.ok !== false) setCommandCenter(cc);
      setError(d?.ok === false ? (d.error || "Failed to load Digital Twin dashboard") : null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading && !dashboard) return <div style={{ padding: 24, color: "var(--text-dim, #8994b0)" }}>Loading Digital Twin console…</div>;
  if (error && !dashboard) return (
    <div style={{ padding: 24 }}>
      <div style={{ color: "#f55b5b", marginBottom: 8 }}>⚠ {error}</div>
      <button onClick={refresh}>Retry</button>
    </div>
  );

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Founder Digital Twin</h2>
        <button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 24 }}>
        <Kpi value={dashboard?.trustScore ?? 0} label="Trust Score" color="#7c6fff" />
        <Kpi value={`${dashboard?.accuracy ?? 0}%`} label="Accuracy" color="#52d68a" />
        <Kpi value={dashboard?.totalDecisions ?? "—"} label="Total Decisions" color="#4ecdc4" />
        <Kpi value={dashboard?.autoResolved ?? "—"} label="Auto-Resolved" color="#5dc8f5" />
        <Kpi value={dashboard?.founderRequired ?? "—"} label="Escalated" color="#f0b429" />
        <Kpi value={dashboard?.minutesSaved ?? "—"} label="Minutes Saved" color="#8994b0" />
      </div>

      {predictStats && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim, #8994b0)", marginBottom: 8 }}>
            Approval Prediction
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <Kpi value={predictStats.total ?? "—"} label="Predictions" />
            <Kpi value={predictStats.routed ?? "—"} label="Auto-Routed" color="#52d68a" />
            <Kpi value={`${predictStats.accuracy ?? 0}%`} label="Accuracy" color="#4ecdc4" />
            <Kpi value={predictStats.threshold ?? "—"} label="Confidence Threshold" color="#f0b429" />
          </div>
        </div>
      )}

      {commandCenter?.identity && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim, #8994b0)", marginBottom: 8 }}>
            Identity Snapshot
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>
            {commandCenter.identity.assetsCount ?? 0} assets · {commandCenter.identity.connectorsCount ?? 0} connectors tracked
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim, #8994b0)", marginBottom: 8 }}>
          Recent Decisions
        </div>
        {decisions.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-dim, #8994b0)" }}>No decisions recorded yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {decisions.slice().reverse().map(d => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 5, fontSize: 12 }}>
                <span style={{ fontFamily: "monospace", color: "#e8ecf5" }}>{d.command || d.id}</span>
                <span style={{ color: d.founderWouldLikely === "approve" ? "#52d68a" : "#f0b429" }}>{d.founderWouldLikely || d.actualOutcome || "pending"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
