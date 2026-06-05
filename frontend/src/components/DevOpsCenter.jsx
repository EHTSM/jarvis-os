import React, { useState, useEffect, useCallback } from "react";
import { track } from "../analytics";
import { listDeployments, getDeployHistory, listSLOs, getSystemMetrics, listAlerts, resolveAlert } from "../phase25Api";
import "./DevOpsCenter.css";

// ── Seed data ─────────────────────────────────────────────────────────
const DEPLOYMENTS = [
  { id: "dep1",  env: "production",  repo: "ooplix-frontend",  version: "v9.4.0",  status: "success",  duration: "2m 14s", by: "Dev Agent",  ts: "2026-06-04 11:32", commit: "f69cd72" },
  { id: "dep2",  env: "production",  repo: "ooplix-backend",   version: "v7.1.2",  status: "success",  duration: "1m 48s", by: "DevOps Agent",ts: "2026-06-04 09:15", commit: "3d75594" },
  { id: "dep3",  env: "staging",     repo: "ooplix-frontend",  version: "v9.5.0-rc",status: "running",  duration: "—",      by: "Dev Agent",  ts: "2026-06-04 14:01", commit: "a3b1c2d" },
  { id: "dep4",  env: "staging",     repo: "ooplix-backend",   version: "v7.2.0-rc",status: "success",  duration: "1m 55s", by: "Dev Agent",  ts: "2026-06-04 10:44", commit: "e4f5a6b" },
  { id: "dep5",  env: "production",  repo: "ooplix-mobile",    version: "v3.2.1",  status: "failed",   duration: "3m 02s", by: "DevOps Agent",ts: "2026-06-03 16:20", commit: "c7d8e9f" },
  { id: "dep6",  env: "production",  repo: "ooplix-mobile",    version: "v3.2.0",  status: "rollback", duration: "0m 42s", by: "DevOps Agent",ts: "2026-06-03 16:23", commit: "b2c3d4e" },
  { id: "dep7",  env: "production",  repo: "ooplix-agents",    version: "v5.0.3",  status: "success",  duration: "1m 22s", by: "DevOps Agent",ts: "2026-06-03 12:00", commit: "1db642f" },
];

const SERVICES = [
  { id: "svc1", name: "API Server",          env: "production", status: "healthy",  uptime: "99.97%", latency: "42ms",  replicas: "2/2",  memory: "340MB", cpu: "12%",  lastCheck: "30s ago" },
  { id: "svc2", name: "WhatsApp Bridge",     env: "production", status: "healthy",  uptime: "99.91%", latency: "110ms", replicas: "1/1",  memory: "180MB", cpu: "8%",   lastCheck: "30s ago" },
  { id: "svc3", name: "Task Queue (Bull)",   env: "production", status: "healthy",  uptime: "99.99%", latency: "5ms",   replicas: "1/1",  memory: "95MB",  cpu: "4%",   lastCheck: "30s ago" },
  { id: "svc4", name: "Redis Cache",         env: "production", status: "healthy",  uptime: "100%",   latency: "1ms",   replicas: "1/1",  memory: "210MB", cpu: "2%",   lastCheck: "30s ago" },
  { id: "svc5", name: "Frontend CDN",        env: "production", status: "healthy",  uptime: "100%",   latency: "18ms",  replicas: "3/3",  memory: "—",     cpu: "—",    lastCheck: "30s ago" },
  { id: "svc6", name: "Mobile API Proxy",    env: "production", status: "degraded", uptime: "97.3%",  latency: "890ms", replicas: "1/2",  memory: "520MB", cpu: "78%",  lastCheck: "30s ago" },
  { id: "svc7", name: "Webhook Receiver",    env: "staging",    status: "healthy",  uptime: "99.8%",  latency: "55ms",  replicas: "1/1",  memory: "120MB", cpu: "6%",   lastCheck: "30s ago" },
  { id: "svc8", name: "Analytics Collector", env: "production", status: "healthy",  uptime: "99.95%", latency: "22ms",  replicas: "1/1",  memory: "88MB",  cpu: "3%",   lastCheck: "30s ago" },
];

const INFRA = [
  { id: "inf1", name: "AWS us-east-1",       type: "cloud",    status: "healthy",  cost: "₹18,400/mo", resources: "EC2 t3.medium ×2, RDS t3.small, S3, CloudFront, Route53" },
  { id: "inf2", name: "Redis (ElastiCache)",  type: "cache",    status: "healthy",  cost: "₹2,100/mo",  resources: "cache.t3.micro ×1, single-AZ"                              },
  { id: "inf3", name: "PostgreSQL (RDS)",     type: "database", status: "healthy",  cost: "₹3,800/mo",  resources: "db.t3.small, 20GB GP2 SSD, automated backups"               },
  { id: "inf4", name: "GitHub Actions CI",   type: "ci",       status: "healthy",  cost: "₹0/mo",      resources: "Free tier — 2000 min/month"                                },
  { id: "inf5", name: "Cloudflare DNS/CDN",  type: "cdn",      status: "healthy",  cost: "₹0/mo",      resources: "Free tier — full CDN + DDoS protection"                    },
  { id: "inf6", name: "Terraform State",     type: "infra",    status: "warning",  cost: "—",           resources: "Local .tfstate — remote backend not configured"            },
];

const INCIDENTS = [
  { id: "inc1", title: "Mobile API Proxy degraded — high CPU + latency spike",        severity: "warning", status: "active",   started: "14 min ago",  affected: "ooplix-mobile users",        cause: "Memory leak in proxy — replica down, traffic concentrated on 1 pod" },
  { id: "inc2", title: "ooplix-mobile v3.2.1 deploy failed — Firebase init crash",   severity: "critical",status: "resolved", started: "2026-06-03",  affected: "Android 12+ users (15%)",    cause: "Null Firebase auth on cold start. Rolled back to v3.2.0. Fix in PR #3." },
  { id: "inc3", title: "Terraform state stored locally — team conflict risk",         severity: "warning", status: "active",   started: "2026-06-01",  affected: "Infrastructure team",        cause: "Remote state backend not configured. Parallel terraform runs will conflict." },
  { id: "inc4", title: "Task queue spike — 400 tasks backed up during deploy",        severity: "low",     status: "resolved", started: "2026-06-02",  affected: "Automation workflows",       cause: "Bull queue paused during deploy window. Auto-resumed post-deploy." },
];

const STATUS_COLORS = { healthy: "var(--success)", degraded: "var(--warning)", down: "var(--danger)", warning: "var(--warning)", critical: "var(--danger)", success: "var(--success)", running: "var(--accent2)", failed: "var(--danger)", rollback: "var(--warning)", active: "var(--danger)", resolved: "var(--success)", low: "var(--accent2)" };

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || "var(--text-faint)";
  return <span className="doc-badge" style={{ color: c, borderColor: c + "33" }}>{status}</span>;
}

function EnvBadge({ env }) {
  const c = env === "production" ? "var(--danger)" : env === "staging" ? "var(--warning)" : "var(--accent2)";
  return <span className="doc-badge" style={{ color: c, borderColor: c + "33" }}>{env}</span>;
}

export default function DevOpsCenter({ onNavigate }) {
  const [section,     setSection]     = useState("deployments");
  const [envFilter,   setEnvFilter]   = useState("all");
  const [selected,    setSelected]    = useState(null);
  const [deployments, setDeployments] = useState(DEPLOYMENTS);
  const [slos,        setSlos]        = useState([]);
  const [alerts,      setAlerts]      = useState([]);
  const [metrics,     setMetrics]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [apiError,    setApiError]    = useState(null);

  useEffect(() => { track.event("devops_center_viewed"); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listDeployments({ limit: 20 }),
      getDeployHistory({ limit: 10 }),
      listSLOs(),
      listAlerts({ limit: 20 }),
      getSystemMetrics({ limit: 10 }),
    ]).then(([listRes, histRes, sloRes, alertsRes, metricsRes]) => {
        if (cancelled) return;
        const liveDeps = listRes?.deployments || histRes?.history;
        if (Array.isArray(liveDeps) && liveDeps.length > 0) {
          setDeployments(liveDeps.map(d => ({
            id:       d.id,
            env:      d.environment || d.env || "production",
            repo:     d.repo || d.service || "service",
            version:  d.version || "—",
            status:   d.status || "success",
            duration: d.durationMs ? `${Math.round(d.durationMs/1000)}s` : "—",
            by:       d.triggeredBy || d.by || "Autopilot",
            ts:       d.startedAt ? new Date(d.startedAt).toLocaleString() : "—",
            commit:   d.commit?.slice(0, 7) || "—",
          })));
        }
        const liveSlos = sloRes?.slos || sloRes?.data;
        if (Array.isArray(liveSlos)) setSlos(liveSlos);
        const liveAlerts = alertsRes?.alerts || alertsRes?.data;
        if (Array.isArray(liveAlerts)) setAlerts(liveAlerts);
        if (metricsRes) setMetrics(metricsRes);
      })
      .catch(err => { if (!cancelled) setApiError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleResolveAlert = useCallback((alertId) => {
    resolveAlert(alertId)
      .then(() => setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: "resolved" } : a)))
      .catch(() => {});
  }, []);

  const healthyServices  = SERVICES.filter(s => s.status === "healthy").length;
  const degradedServices = SERVICES.filter(s => s.status !== "healthy").length;
  const activeIncidents  = INCIDENTS.filter(i => i.status === "active").length;
  const activeAlerts     = alerts.filter(a => a.status !== "resolved").length;
  const successRate      = deployments.length ? Math.round((deployments.filter(d => d.status === "success").length / deployments.length) * 100) : 0;

  const filteredDeps = deployments.filter(d => envFilter === "all" || d.env === envFilter);
  const filteredSvcs = SERVICES.filter(s => envFilter === "all" || s.env === envFilter);

  return (
    <div className="devops-center page-enter">
      {loading && <div className="ac-api-banner ac-api-banner--loading">Loading live DevOps data…</div>}
      {apiError && !loading && <div className="ac-api-banner ac-api-banner--error">⚠ Live DevOps data unavailable — showing cached data ({apiError})</div>}
      <div className="doc-header">
        <div>
          <h1 className="doc-title">DevOps Runtime</h1>
          <p className="doc-subtitle">Deployments, services, infrastructure, and incidents — live runtime view.</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="doc-kpi-strip">
        {[
          { label: "Services healthy",   value: `${healthyServices}/${SERVICES.length}`, color: degradedServices > 0 ? "var(--warning)" : "var(--success)" },
          { label: "Active incidents",   value: activeIncidents,  color: activeIncidents > 0 ? "var(--danger)" : "var(--success)" },
          { label: "Deploy success rate",value: `${successRate}%`, color: successRate >= 90 ? "var(--success)" : "var(--warning)"  },
          { label: "Total deploys",      value: deployments.length, color: "var(--accent2)"                                         },
        ].map(k => (
          <div key={k.label} className="doc-kpi-tile">
            <span className="doc-kpi-val" style={{ color: k.color }}>{k.value}</span>
            <span className="doc-kpi-label">{k.label}</span>
          </div>
        ))}
      </div>

      {/* Active incident banner */}
      {activeIncidents > 0 && (
        <div className="doc-incident-banner">
          <span className="doc-inc-icon">⚠</span>
          <span className="doc-inc-text">{activeIncidents} active incident{activeIncidents > 1 ? "s" : ""} — see Incidents tab</span>
          <button className="doc-inc-btn" onClick={() => setSection("incidents")}>View →</button>
        </div>
      )}

      {/* Env filter */}
      <div className="doc-env-chips">
        {["all","production","staging"].map(e => (
          <button key={e} className={`doc-chip${envFilter===e?" doc-chip--active":""}`} onClick={() => setEnvFilter(e)}>{e}</button>
        ))}
      </div>

      {/* Tabs */}
      <div className="doc-tabs">
        {[
          { id: "deployments",   label: "Deployments"                          },
          { id: "services",      label: `Services${degradedServices > 0 ? ` (${degradedServices} ⚠)` : ""}` },
          { id: "infrastructure",label: "Infrastructure"                       },
          { id: "incidents",     label: `Incidents${activeIncidents > 0 ? ` (${activeIncidents})` : ""}` },
          { id: "slos",          label: `SLOs${slos.length > 0 ? ` (${slos.length})` : ""}` },
          { id: "alerts",        label: `Alerts${activeAlerts > 0 ? ` (${activeAlerts})` : ""}` },
        ].map(t => (
          <button key={t.id} className={`doc-tab${section===t.id?" doc-tab--active":""}`} onClick={()=>setSection(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="doc-content" key={section}>

        {/* Deployments */}
        {section === "deployments" && (
          <div className="doc-dep-list">
            {filteredDeps.map(d => (
              <div key={d.id} className={`doc-dep-row${selected===d.id?" doc-dep-row--sel":""}`} onClick={()=>setSelected(p=>p===d.id?null:d.id)}>
                <div className="doc-dep-left">
                  <StatusBadge status={d.status} />
                  <div className="doc-dep-info">
                    <span className="doc-dep-repo">{d.repo}</span>
                    <span className="doc-dep-meta">{d.version} · {d.commit} · {d.ts}</span>
                  </div>
                </div>
                <div className="doc-dep-right">
                  <EnvBadge env={d.env} />
                  <span className="doc-dep-dur">{d.duration}</span>
                  <span className="doc-dep-by">{d.by}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Services */}
        {section === "services" && (
          <div className="doc-svc-list">
            {filteredSvcs.map(s => (
              <div key={s.id} className="doc-svc-row">
                <div className="doc-svc-status-col">
                  <span className="doc-svc-dot" style={{ background: STATUS_COLORS[s.status] || "var(--text-faint)" }} />
                </div>
                <div className="doc-svc-info">
                  <span className="doc-svc-name">{s.name}</span>
                  <span className="doc-svc-env" style={{ color: s.env === "production" ? "var(--danger)" : "var(--warning)" }}>{s.env}</span>
                </div>
                <div className="doc-svc-metrics">
                  <span className="doc-svc-metric"><span className="doc-svc-mv">{s.uptime}</span> uptime</span>
                  <span className="doc-svc-metric"><span className="doc-svc-mv">{s.latency}</span> p50</span>
                  <span className="doc-svc-metric"><span className="doc-svc-mv">{s.memory}</span> mem</span>
                  <span className="doc-svc-metric"><span className="doc-svc-mv">{s.cpu}</span> cpu</span>
                  <span className="doc-svc-metric"><span className="doc-svc-mv">{s.replicas}</span> replicas</span>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        )}

        {/* Infrastructure */}
        {section === "infrastructure" && (
          <div className="doc-infra-list">
            {INFRA.map(i => (
              <div key={i.id} className="doc-infra-row">
                <div className="doc-infra-left">
                  <span className="doc-infra-dot" style={{ background: STATUS_COLORS[i.status] || "var(--text-faint)" }} />
                  <div className="doc-infra-info">
                    <span className="doc-infra-name">{i.name}</span>
                    <span className="doc-infra-resources">{i.resources}</span>
                  </div>
                </div>
                <div className="doc-infra-right">
                  <span className="doc-infra-type">{i.type}</span>
                  <span className="doc-infra-cost">{i.cost}</span>
                  <StatusBadge status={i.status} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Incidents */}
        {section === "incidents" && (
          <div className="doc-incident-list">
            {INCIDENTS.map(i => (
              <div key={i.id} className={`doc-inc-row doc-inc-row--${i.severity}`}>
                <div className="doc-inc-header">
                  <span className="doc-inc-sev-dot" style={{ background: STATUS_COLORS[i.severity] }} />
                  <span className="doc-inc-title">{i.title}</span>
                  <StatusBadge status={i.status} />
                </div>
                <div className="doc-inc-body">
                  <span className="doc-inc-detail"><strong>Started:</strong> {i.started}</span>
                  <span className="doc-inc-detail"><strong>Affected:</strong> {i.affected}</span>
                  <span className="doc-inc-detail"><strong>Cause:</strong> {i.cause}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SLOs */}
        {section === "slos" && (
          <div className="doc-svc-list">
            {slos.length === 0 ? (
              <div className="doc-empty-state">
                <span style={{ fontSize: 28 }}>◎</span>
                <p>No SLOs configured — backend returned no data.</p>
              </div>
            ) : slos.map((s, i) => {
              const pct = s.currentValue ?? s.value ?? 0;
              const target = s.target ?? s.threshold ?? 99;
              const ok = pct >= target;
              return (
                <div key={s.id || i} className="doc-svc-row">
                  <div className="doc-svc-status-col">
                    <span className="doc-svc-dot" style={{ background: ok ? "var(--success)" : "var(--danger)" }} />
                  </div>
                  <div className="doc-svc-info">
                    <span className="doc-svc-name">{s.name || s.metric}</span>
                    <span className="doc-svc-env">{s.service || s.source || "—"}</span>
                  </div>
                  <div className="doc-svc-metrics">
                    <span className="doc-svc-metric"><span className="doc-svc-mv" style={{ color: ok ? "var(--success)" : "var(--danger)" }}>{pct}%</span> actual</span>
                    <span className="doc-svc-metric"><span className="doc-svc-mv">{target}%</span> target</span>
                    {s.window && <span className="doc-svc-metric"><span className="doc-svc-mv">{s.window}</span> window</span>}
                  </div>
                  <StatusBadge status={ok ? "healthy" : "degraded"} />
                </div>
              );
            })}
          </div>
        )}

        {/* Alerts */}
        {section === "alerts" && (
          <div className="doc-incident-list">
            {alerts.length === 0 ? (
              <div className="doc-empty-state">
                <span style={{ fontSize: 28, color: "var(--success)" }}>✓</span>
                <p>No active alerts — system is clean.</p>
              </div>
            ) : alerts.map((a, i) => {
              const isActive = a.status !== "resolved";
              return (
                <div key={a.id || i} className={`doc-inc-row doc-inc-row--${a.severity || "warning"}`}>
                  <div className="doc-inc-header">
                    <span className="doc-inc-sev-dot" style={{ background: STATUS_COLORS[a.severity] || "var(--warning)" }} />
                    <span className="doc-inc-title">{a.name || a.message || "Alert"}</span>
                    <StatusBadge status={a.status || "active"} />
                    {isActive && (
                      <button
                        onClick={() => handleResolveAlert(a.id)}
                        style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11, fontWeight: 700, border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", background: "var(--surface-raised)", cursor: "pointer", color: "var(--success)", fontFamily: "inherit" }}
                      >Resolve</button>
                    )}
                  </div>
                  <div className="doc-inc-body">
                    {a.service && <span className="doc-inc-detail"><strong>Service:</strong> {a.service}</span>}
                    {a.condition && <span className="doc-inc-detail"><strong>Condition:</strong> {a.condition}</span>}
                    {a.firedAt && <span className="doc-inc-detail"><strong>Fired:</strong> {new Date(a.firedAt).toLocaleString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
