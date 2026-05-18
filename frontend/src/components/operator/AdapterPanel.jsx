import React from "react";

// Agents from /runtime/status .agents[]
function AgentHealthRow({ agent }) {
  const { id, cbState, active, maxConcurrent, stats, lastActivity } = agent;
  const rate    = stats?.successRate ?? 1;
  const pct     = Math.round(rate * 100);
  
  const isHanging = lastActivity && (Date.now() - lastActivity) > 300000; // 5 minute silent hang
  
  const dotClass = active > 0 ? "running" : cbState === "open" ? "err" : cbState === "halfOpen" ? "warn" : "ok";
  const cbClass  = cbState === "open" ? "open" : cbState === "halfOpen" ? "half" : "closed";

  return (
    <div className="op-adapter-row">
      <div className={`op-adapter-dot ${dotClass}`} />
      <span className="op-adapter-name">{id}</span>
      <span className={`op-adapter-cb ${cbClass}`}>{cbState}</span>
      <span className="op-adapter-score">
        {active > 0
          ? <span style={{ color: isHanging ? "var(--op-red)" : "var(--op-amber)" }}>
              {active}/{maxConcurrent} {isHanging ? "☠ HANG" : "▶"}
            </span>
          : <span style={{ color: pct === 100 ? "var(--op-green)" : pct < 80 ? "var(--op-red)" : "var(--op-amber)" }}>{pct}%</span>
        }
      </span>
    </div>
  );
}

// Services from /ops .services{}
const SVC_LABELS = {
  ai: "AI", groq: "Groq", telegram: "Telegram",
  whatsapp: "WhatsApp", payments: "Payments"
};

function ServiceRow({ name, enabled }) {
  return (
    <div className="op-svc-item">
      <div className={`op-adapter-dot ${enabled ? "ok" : "off"}`} />
      <span className="op-svc-label">{SVC_LABELS[name] || name}</span>
      <span className={`op-svc-val ${enabled ? "on" : "off"}`} style={{ marginLeft: "auto" }}>
        {enabled ? "on" : "off"}
      </span>
    </div>
  );
}

export default function AdapterPanel({ rtStatus, services }) {
  const agents   = rtStatus?.agents ?? [];
  const svcKeys  = services ? Object.keys(services) : [];

  // Sort: running first, then alphabetical
  const sorted = [...agents].sort((a, b) => {
    if (a.active !== b.active) return b.active - a.active;
    return a.id.localeCompare(b.id);
  });

  return (
    <div className="op-panel" style={{ height: "100%" }}>
      <div className="op-panel-header">
        <span className="op-panel-title">Adapters</span>
        <span className="op-panel-meta">
          {agents.length > 0 && `${agents.length} agents`}
        </span>
      </div>
      <div className="op-panel-body">
        {!rtStatus && <div className="op-loading" />}

        {sorted.length === 0 && rtStatus && (
          <div className="op-log-empty" style={{ fontSize: 10 }}>No adapters registered</div>
        )}

        {sorted.map(a => <AgentHealthRow key={a.id} agent={a} />)}

        {svcKeys.length > 0 && (
          <>
            <div style={{
              fontSize: 9,
              color: "var(--op-text2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "6px 6px 3px",
              marginTop: 4,
              borderTop: "1px solid var(--op-border)"
            }}>
              Services
            </div>
            <div className="op-svc-grid">
              {svcKeys.map(k => (
                <ServiceRow key={k} name={k} enabled={services[k]} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
