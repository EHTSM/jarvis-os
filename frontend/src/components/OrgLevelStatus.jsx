import React, { useState, useEffect, useCallback } from "react";
import { _fetch } from "../_client";

// V6-V10 Production Realization: executiveOrg/enterpriseOrg/ecosystemOrg/
// civilizationOrg/autonomousOrg (backend/routes/{executive,enterprise,
// ecosystem,civilization,autonomous}Org.js — real, self-ticking backend
// infrastructure confirmed this session) had zero frontend surface. One
// reusable component instead of 5 near-identical dashboards, parameterized
// by level config — each level's real /*/status and /*/summary routes have
// slightly different shapes, so this renders generically off whatever
// fields are actually present rather than assuming a fixed schema.

const LEVELS = {
  ako:  { label: "Knowledge Org (L4)", statusPath: "/ako/status", summaryPath: "/ako/summary", accent: "#9d6cff" },
  eos:  { label: "Executive OS",     statusPath: "/eos/status",  summaryPath: "/eos/summary",  accent: "#6c63ff" },
  ent:  { label: "Enterprise OS",    statusPath: "/ent/status",  summaryPath: "/ent/summary",  accent: "#00d4ff" },
  eco:  { label: "Ecosystem OS",     statusPath: "/eco/status",  summaryPath: "/eco/summary",  accent: "#52d68a" },
  civ:  { label: "Civilization OS",  statusPath: "/civ/status",  summaryPath: "/civ/summary",  accent: "#f0b429" },
  auto: { label: "Autonomous OS",    statusPath: "/auto/status", summaryPath: "/auto/summary", accent: "#da552f" },
};

function KeyValueGrid({ obj }) {
  if (!obj || typeof obj !== "object") return null;
  // "ok" is a response-envelope field some routes (autonomousOrg) mix into
  // the payload via {ok:true, ...data} — not real domain data, filtered out.
  const entries = Object.entries(obj).filter(([k, v]) => k !== "ok" && (v === null || typeof v !== "object"));
  if (!entries.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ background: "#14141c", border: "1px solid #24242e", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, color: "#8888aa", textTransform: "uppercase" }}>{k}</div>
          <div style={{ fontSize: 16, color: "#e0e0e0", fontWeight: 600 }}>{String(v ?? "—")}</div>
        </div>
      ))}
    </div>
  );
}

function AgentTable({ agents }) {
  if (!Array.isArray(agents) || !agents.length) return <p style={{ color: "#8888aa" }}>No agents reported.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#8888aa", borderBottom: "1px solid #24242e" }}>
            <th style={{ padding: "6px 8px" }}>Label</th>
            <th style={{ padding: "6px 8px" }}>Role</th>
            <th style={{ padding: "6px 8px" }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(a => (
            <tr key={a.id} style={{ borderBottom: "1px solid #1e1e26" }}>
              <td style={{ padding: "6px 8px", color: "#e0e0e0" }}>{a.label || a.id}</td>
              <td style={{ padding: "6px 8px", color: "#8888aa" }}>{a.role || "—"}</td>
              <td style={{ padding: "6px 8px" }}>
                <span style={{
                  color: a.status === "running" ? "#52d68a" : a.status === "not_registered" ? "#8888aa" : "#f0b429",
                  fontSize: 12, fontWeight: 600,
                }}>
                  {a.status || "unknown"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OrgLevelStatus({ level }) {
  const cfg = LEVELS[level];
  const [summary, setSummary] = useState(null);
  const [agents,  setAgents]  = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!cfg) return;
    setLoading(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([
        _fetch(cfg.summaryPath).catch(() => null),
        _fetch(cfg.statusPath).catch(() => null),
      ]);
      // Most levels' /status returns the agent array directly; autonomousOrg
      // (Level 10) wraps it as {agents:[...]} via a shared ok() response
      // helper — normalize both shapes rather than assume one.
      setSummary(s);
      setAgents(Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : null);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => { reload(); }, [reload]);

  if (!cfg) return <p style={{ color: "#f55b5b" }}>Unknown org level: {level}</p>;

  return (
    <div style={{ padding: 20, color: "#e0e0e0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: cfg.accent }}>{cfg.label}</h2>
          <p style={{ margin: "4px 0 0", color: "#8888aa", fontSize: 13 }}>
            Read-only status view — real data from {cfg.summaryPath} / {cfg.statusPath}
          </p>
        </div>
        <button onClick={reload} disabled={loading} style={{
          background: "#1a1a24", border: "1px solid #24242e", borderRadius: 6,
          color: "#e0e0e0", padding: "6px 14px", cursor: loading ? "default" : "pointer",
        }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ background: "rgba(245,91,91,0.12)", border: "1px solid rgba(245,91,91,0.35)", borderRadius: 6, padding: "10px 14px", marginBottom: 16, color: "#f55b5b" }}>
          {error}
        </div>
      )}

      {loading && !summary && !agents && <p style={{ color: "#8888aa" }}>Loading…</p>}

      {summary && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, color: "#8888aa", textTransform: "uppercase", marginBottom: 8 }}>Summary</h3>
          <KeyValueGrid obj={summary} />
        </div>
      )}

      <div>
        <h3 style={{ fontSize: 13, color: "#8888aa", textTransform: "uppercase", marginBottom: 8 }}>
          Domain Agents{Array.isArray(agents) ? ` (${agents.length})` : ""}
        </h3>
        <AgentTable agents={agents} />
      </div>
    </div>
  );
}
