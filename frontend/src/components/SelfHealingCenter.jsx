import React, { useState, useCallback } from "react";
import { track } from "../analytics";
import "./SelfHealingCenter.css";

// ── Seed data ─────────────────────────────────────────────────────────
const HEALTH_CHECKS = [
  { id: "hc1",  name: "API Server liveness",       target: "api.ooplix.com/health",     interval: "30s", status: "passing", lastCheck: "8s ago",    consecutive: 1240, failCount: 0  },
  { id: "hc2",  name: "WhatsApp Bridge heartbeat", target: "wa-bridge:3001/ping",       interval: "15s", status: "passing", lastCheck: "4s ago",    consecutive: 2180, failCount: 2  },
  { id: "hc3",  name: "Redis connectivity",        target: "redis:6379",                interval: "30s", status: "passing", lastCheck: "12s ago",   consecutive: 980,  failCount: 0  },
  { id: "hc4",  name: "PostgreSQL readiness",      target: "pg:5432/ooplix",            interval: "60s", status: "passing", lastCheck: "45s ago",   consecutive: 490,  failCount: 0  },
  { id: "hc5",  name: "Mobile API Proxy health",   target: "proxy.ooplix.com/health",   interval: "30s", status: "failing", lastCheck: "9s ago",    consecutive: 0,    failCount: 14 },
  { id: "hc6",  name: "Task queue depth",          target: "bull:queue_depth < 500",    interval: "60s", status: "passing", lastCheck: "55s ago",   consecutive: 201,  failCount: 1  },
  { id: "hc7",  name: "Frontend CDN availability", target: "ooplix.com",                interval: "60s", status: "passing", lastCheck: "20s ago",   consecutive: 720,  failCount: 0  },
  { id: "hc8",  name: "Analytics collector",       target: "analytics:4000/status",     interval: "120s",status: "passing", lastCheck: "1m 4s ago", consecutive: 362,  failCount: 0  },
];

const RECOVERY_ACTIONS = [
  { id: "ra1",  type: "restart",  target: "mobile-api-proxy",   trigger: "Health check failing for 3m",            status: "triggered",  ts: "14 min ago",  result: "Restarted pod. Latency normalising.",                       success: false },
  { id: "ra2",  type: "rollback", target: "ooplix-mobile",      trigger: "Deploy v3.2.1 failed — crash detected",  status: "success",    ts: "2026-06-03",  result: "Rolled back to v3.2.0 in 42s. Service restored.",           success: true  },
  { id: "ra3",  type: "restart",  target: "task-queue-worker",  trigger: "Queue depth > 500 for 5 min",            status: "success",    ts: "2026-06-02",  result: "Worker restarted. Queue cleared in 8 min.",                  success: true  },
  { id: "ra4",  type: "scale",    target: "api-server",         trigger: "CPU > 80% for 10 min",                   status: "success",    ts: "2026-06-01",  result: "Scaled from 1→2 replicas. CPU dropped to 18%.",             success: true  },
  { id: "ra5",  type: "restart",  target: "whatsapp-bridge",    trigger: "Heartbeat missed ×3",                    status: "success",    ts: "2026-05-30",  result: "Bridge restarted. Session re-established in 22s.",           success: true  },
  { id: "ra6",  type: "rollback", target: "ooplix-backend",     trigger: "Error rate > 5% for 2 min post-deploy",  status: "success",    ts: "2026-05-28",  result: "Rolled back to previous version. Error rate < 0.1%.",       success: true  },
];

const PREVENTION_RULES = [
  { id: "pr1",  name: "Auto-rollback on error spike",       condition: "Error rate > 5% within 5 min of deploy",            action: "Rollback to previous version",          enabled: true,  triggers: 2  },
  { id: "pr2",  name: "Pod restart on repeated health fail",condition: "Health check fails 3× in 2 min",                    action: "Restart container and notify",          enabled: true,  triggers: 4  },
  { id: "pr3",  name: "Scale out on CPU threshold",         condition: "CPU > 80% for 10 min",                              action: "Add 1 replica (max 4)",                 enabled: true,  triggers: 1  },
  { id: "pr4",  name: "Queue worker restart",               condition: "Task queue depth > 500 for 5 min",                  action: "Restart Bull worker process",           enabled: true,  triggers: 1  },
  { id: "pr5",  name: "Canary deployment gate",             condition: "Error rate > 1% in canary phase",                   action: "Halt promotion, alert engineer",        enabled: true,  triggers: 0  },
  { id: "pr6",  name: "Memory leak circuit breaker",        condition: "Process memory > 1GB for 5 min",                    action: "Graceful restart with memory dump",     enabled: true,  triggers: 0  },
  { id: "pr7",  name: "Database connection pool guard",     condition: "Active connections > 80% of max pool",              action: "Alert + reduce query frequency",        enabled: false, triggers: 0  },
  { id: "pr8",  name: "Stale WhatsApp session recovery",   condition: "WhatsApp bridge returns auth error",                 action: "Clear session and prompt QR re-scan",   enabled: true,  triggers: 2  },
];

const TIMELINE = [
  { id: "tl1",  ts: "2026-06-04 14:10", type: "check",    label: "Mobile API Proxy health check failing", severity: "critical", detail: "Pod CPU at 78%. Single replica serving all traffic." },
  { id: "tl2",  ts: "2026-06-04 13:58", type: "recovery", label: "Auto-restart triggered: mobile-api-proxy", severity: "warning", detail: "Recovery action triggered by rule: Pod restart on repeated health fail." },
  { id: "tl3",  ts: "2026-06-04 11:32", type: "deploy",   label: "Deploy success: ooplix-frontend v9.4.0", severity: "info",    detail: "2285 additions, 20 deletions. CI passed. No post-deploy errors." },
  { id: "tl4",  ts: "2026-06-04 09:15", type: "deploy",   label: "Deploy success: ooplix-backend v7.1.2",  severity: "info",    detail: "340 additions, 12 deletions. Webhook route added." },
  { id: "tl5",  ts: "2026-06-03 16:23", type: "recovery", label: "Auto-rollback: ooplix-mobile v3.2.0",   severity: "critical", detail: "v3.2.1 deploy failed. Firebase null crash. Rollback in 42s." },
  { id: "tl6",  ts: "2026-06-03 16:20", type: "incident", label: "Deploy failed: ooplix-mobile v3.2.1",   severity: "critical", detail: "Android cold-start crash. 15% of Android users affected." },
  { id: "tl7",  ts: "2026-06-02 10:00", type: "recovery", label: "Queue worker restarted",                severity: "warning",  detail: "Bull queue depth exceeded 500. Worker restarted. Queue cleared in 8 min." },
  { id: "tl8",  ts: "2026-06-01 15:30", type: "recovery", label: "API server scaled 1→2 replicas",        severity: "warning",  detail: "CPU sustained above 80% for 12 min. Auto-scaled. CPU normalised at 18%." },
];

const TYPE_ICONS    = { restart: "↺", rollback: "↩", scale: "↑", check: "◎", recovery: "⬟", deploy: "▷", incident: "⚠" };
const SEV_COLORS    = { critical: "var(--danger)", warning: "var(--warning)", info: "var(--accent2)", success: "var(--success)" };
const ACTION_COLORS = { restart: "var(--warning)", rollback: "var(--accent)", scale: "var(--accent2)" };

export default function SelfHealingCenter({ onNavigate }) {
  const [section,  setSection]  = useState("checks");
  const [rules,    setRules]    = useState(PREVENTION_RULES);
  const [toast,    setToast]    = useState(null);

  React.useEffect(() => { track.event("self_healing_viewed"); }, []);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const toggleRule = useCallback((id) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    showToast("Rule updated");
  }, []);

  const passing     = HEALTH_CHECKS.filter(h => h.status === "passing").length;
  const failing     = HEALTH_CHECKS.filter(h => h.status === "failing").length;
  const recoveries  = RECOVERY_ACTIONS.length;
  const successRate = Math.round((RECOVERY_ACTIONS.filter(r => r.success).length / recoveries) * 100);

  // Failure prediction (heuristic from failCount)
  const atRisk = HEALTH_CHECKS.filter(h => h.failCount > 0 && h.status === "passing");

  return (
    <div className="self-healing-center page-enter">
      {toast && <div className="shc-toast">{toast}</div>}

      <div className="shc-header">
        <div>
          <h1 className="shc-title">Self-Healing Platform</h1>
          <p className="shc-subtitle">Health checks, auto-recovery, prevention rules, and incident timeline.</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="shc-kpi-strip">
        {[
          { label: "Checks passing",    value: `${passing}/${HEALTH_CHECKS.length}`, color: failing > 0 ? "var(--warning)" : "var(--success)" },
          { label: "Failing now",       value: failing,       color: failing > 0 ? "var(--danger)" : "var(--success)" },
          { label: "Recovery success",  value: `${successRate}%`, color: successRate >= 80 ? "var(--success)" : "var(--warning)" },
          { label: "Auto-recoveries",   value: recoveries,    color: "var(--accent2)"                                             },
          { label: "Active rules",      value: rules.filter(r=>r.enabled).length, color: "var(--accent)"                         },
          { label: "At-risk services",  value: atRisk.length, color: atRisk.length > 0 ? "var(--warning)" : "var(--success)"     },
        ].map(k => (
          <div key={k.label} className="shc-kpi-tile">
            <span className="shc-kpi-val" style={{ color: k.color }}>{k.value}</span>
            <span className="shc-kpi-label">{k.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="shc-tabs">
        {[
          { id: "checks",    label: `Health Checks${failing > 0 ? ` (${failing} failing)` : ""}` },
          { id: "recovery",  label: "Recovery Actions" },
          { id: "rules",     label: "Prevention Rules" },
          { id: "timeline",  label: "Incident Timeline"},
          { id: "predict",   label: "Failure Prediction"},
        ].map(t => (
          <button key={t.id} className={`shc-tab${section===t.id?" shc-tab--active":""}`} onClick={()=>setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="shc-content" key={section}>

        {/* Health Checks */}
        {section === "checks" && (
          <div className="shc-checks-list">
            {HEALTH_CHECKS.map(h => (
              <div key={h.id} className={`shc-check-row shc-check-row--${h.status}`}>
                <span className="shc-check-dot" style={{ background: h.status === "passing" ? "var(--success)" : "var(--danger)" }} />
                <div className="shc-check-info">
                  <span className="shc-check-name">{h.name}</span>
                  <span className="shc-check-target">{h.target}</span>
                </div>
                <div className="shc-check-stats">
                  <span className="shc-check-stat"><span className="shc-stat-v">{h.interval}</span> interval</span>
                  <span className="shc-check-stat"><span className="shc-stat-v" style={{ color: h.consecutive > 0 ? "var(--success)" : "var(--text-faint)" }}>{h.consecutive}</span> consecutive ok</span>
                  {h.failCount > 0 && <span className="shc-check-stat shc-check-stat--warn"><span className="shc-stat-v" style={{ color: "var(--danger)" }}>{h.failCount}</span> failures</span>}
                </div>
                <span className="shc-check-last">{h.lastCheck}</span>
                <span className={`shc-check-status shc-check-status--${h.status}`}>{h.status}</span>
              </div>
            ))}
          </div>
        )}

        {/* Recovery Actions */}
        {section === "recovery" && (
          <div className="shc-recovery-list">
            {RECOVERY_ACTIONS.map(r => (
              <div key={r.id} className={`shc-rec-row shc-rec-row--${r.success ? "success" : "running"}`}>
                <div className="shc-rec-type-icon" style={{ color: ACTION_COLORS[r.type] || "var(--accent2)" }}>
                  {TYPE_ICONS[r.type]}
                </div>
                <div className="shc-rec-info">
                  <div className="shc-rec-title-row">
                    <span className="shc-rec-type-badge" style={{ color: ACTION_COLORS[r.type], borderColor: (ACTION_COLORS[r.type]||"#fff") + "33" }}>{r.type}</span>
                    <span className="shc-rec-target">{r.target}</span>
                  </div>
                  <span className="shc-rec-trigger">Trigger: {r.trigger}</span>
                  <span className="shc-rec-result">{r.result}</span>
                </div>
                <div className="shc-rec-right">
                  <span className={`shc-rec-status shc-rec-status--${r.success ? "success" : "running"}`}>
                    {r.success ? "success" : r.status}
                  </span>
                  <span className="shc-rec-ts">{r.ts}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Prevention Rules */}
        {section === "rules" && (
          <div className="shc-rules-list">
            {rules.map(r => (
              <div key={r.id} className={`shc-rule-row${r.enabled ? "" : " shc-rule-row--disabled"}`}>
                <div className="shc-rule-info">
                  <div className="shc-rule-title-row">
                    <span className="shc-rule-name">{r.name}</span>
                    {r.triggers > 0 && <span className="shc-rule-triggers">{r.triggers}× triggered</span>}
                  </div>
                  <span className="shc-rule-condition">If: {r.condition}</span>
                  <span className="shc-rule-action">Then: {r.action}</span>
                </div>
                <button
                  className={`shc-rule-toggle${r.enabled ? " shc-rule-toggle--on" : ""}`}
                  onClick={() => toggleRule(r.id)}
                >
                  {r.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Incident Timeline */}
        {section === "timeline" && (
          <div className="shc-timeline">
            {TIMELINE.map((ev, i) => (
              <div key={ev.id} className="shc-tl-row">
                <div className="shc-tl-spine">
                  <div className="shc-tl-dot" style={{ background: SEV_COLORS[ev.severity] || "var(--text-faint)" }} />
                  {i < TIMELINE.length - 1 && <div className="shc-tl-line" />}
                </div>
                <div className="shc-tl-content">
                  <div className="shc-tl-header">
                    <span className="shc-tl-type-icon" style={{ color: SEV_COLORS[ev.severity] }}>{TYPE_ICONS[ev.type]}</span>
                    <span className="shc-tl-label">{ev.label}</span>
                    <span className="shc-tl-ts">{ev.ts}</span>
                  </div>
                  <p className="shc-tl-detail">{ev.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Failure Prediction */}
        {section === "predict" && (
          <div className="shc-predict-section">
            <div className="shc-predict-header">
              <p className="shc-predict-note">
                Failure prediction based on check failure history, current load, and recovery patterns.
              </p>
            </div>
            {atRisk.length === 0 && HEALTH_CHECKS.filter(h=>h.status==="failing").length === 0 ? (
              <div className="shc-predict-ok">
                <span className="shc-predict-ok-icon">✓</span>
                <p className="shc-predict-ok-title">No failure risk detected</p>
                <p className="shc-predict-ok-sub">All services are healthy with no prior failure history.</p>
              </div>
            ) : (
              <div className="shc-predict-list">
                {HEALTH_CHECKS.filter(h => h.status === "failing" || h.failCount > 0).map(h => {
                  const risk = h.status === "failing" ? "critical" : h.failCount >= 3 ? "high" : "medium";
                  const riskColor = { critical: "var(--danger)", high: "var(--warning)", medium: "var(--accent2)" }[risk];
                  return (
                    <div key={h.id} className="shc-pred-card" style={{ borderColor: riskColor + "33" }}>
                      <div className="shc-pred-header">
                        <span className="shc-pred-name">{h.name}</span>
                        <span className="shc-pred-risk" style={{ color: riskColor }}>{risk} risk</span>
                      </div>
                      <p className="shc-pred-signal">
                        {h.status === "failing"
                          ? `Currently failing — ${h.failCount} failures recorded. Auto-recovery triggered.`
                          : `${h.failCount} historical failure${h.failCount > 1 ? "s" : ""}. Currently passing but watch this service.`
                        }
                      </p>
                      <div className="shc-pred-actions">
                        <span className="shc-pred-action-label">Suggested:</span>
                        <span className="shc-pred-action">{h.status === "failing" ? "Investigate logs + check pod CPU/memory" : "Review failure timestamps — may correlate with deploys or peak traffic"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
