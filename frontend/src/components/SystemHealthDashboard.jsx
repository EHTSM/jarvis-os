import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getLiveStatus, getOAuthProviderStatus, getReadinessReport } from '../phase21Api';
import { getSecretHealth, getSecurityStatus, getSecurityScore } from '../phase22Api';
import { getSystemMetrics, listAlerts, listSLOs } from '../phase25Api';
import { getObserverStatus } from '../phase26Api';
import { getHealStatus } from '../phase19Api';
import { cycleStats, memoryStats } from '../phase18Api';
import { getRuntimeStatus } from '../runtimeApi';
import './SystemHealthDashboard.css';

// ── Service catalogue ─────────────────────────────────────────────────────────
const SERVICES = [
  { id: 'backend',     label: 'Backend API',        icon: '◎', group: 'Core' },
  { id: 'runtime',     label: 'AI Runtime',          icon: '⚡', group: 'Core' },
  { id: 'electron',    label: 'Electron Shell',       icon: '◈', group: 'Core' },
  { id: 'memory',      label: 'Memory Engine',        icon: '🧠', group: 'AI' },
  { id: 'observer',    label: 'Observer',             icon: '◉', group: 'AI' },
  { id: 'healing',     label: 'Self-Healing',         icon: '✦', group: 'AI' },
  { id: 'providers',   label: 'AI Providers',         icon: '◈', group: 'AI' },
  { id: 'security',    label: 'Security',             icon: '🔒', group: 'Infra' },
  { id: 'secrets',     label: 'Secrets Vault',        icon: '🔑', group: 'Infra' },
  { id: 'deployments', label: 'Deployments',          icon: '◈', group: 'Infra' },
  { id: 'slos',        label: 'SLOs',                 icon: '◉', group: 'Reliability' },
  { id: 'crm',         label: 'CRM / Messaging',      icon: '👤', group: 'Product' },
  { id: 'executive',   label: 'Executive Brain',      icon: '🎯', group: 'Product' },
];

const GROUP_ORDER = ['Core', 'AI', 'Infra', 'Reliability', 'Product'];

function statusChip(s) {
  if (s === 'ok')      return { label: 'OK',      cls: 'shd-ok'   };
  if (s === 'warn')    return { label: 'WARN',     cls: 'shd-warn' };
  if (s === 'crit')    return { label: 'CRIT',     cls: 'shd-crit' };
  return                      { label: 'UNKNOWN',  cls: 'shd-dim'  };
}

function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const ms   = Date.now() - new Date(isoStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 5)    return 'just now';
  if (secs < 60)   return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

// ── Parallel fetch — normalise everything into ServiceInfo objects ─────────────
async function fetchAllHealth() {
  const [
    liveStatus,
    oauthStatus,
    readiness,
    secretHealth,
    securityStatus,
    securityScore,
    systemMetrics,
    alerts,
    slos,
    observerStatus,
    healStatus,
    cycles,
    memory,
    runtimeStatus,
  ] = await Promise.allSettled([
    getLiveStatus(),
    getOAuthProviderStatus(),
    getReadinessReport(),
    getSecretHealth(),
    getSecurityStatus(),
    getSecurityScore(),
    getSystemMetrics(),
    listAlerts({ limit: 20 }),
    listSLOs(),
    getObserverStatus(),
    getHealStatus(),
    cycleStats(),
    memoryStats(),
    getRuntimeStatus(),
  ]);

  const val = r => r.status === 'fulfilled' ? r.value : null;

  const live      = val(liveStatus);
  const oauth     = val(oauthStatus);
  const ready     = val(readiness);
  const secH      = val(secretHealth);
  const secS      = val(securityStatus);
  const secScore  = val(securityScore);
  const metrics   = val(systemMetrics);
  const alertList = val(alerts);
  const sloList   = val(slos);
  const obs       = val(observerStatus);
  const heal      = val(healStatus);
  const cyc       = val(cycles);
  const mem       = val(memory);
  const rt        = val(runtimeStatus);

  // Active alerts count
  const activeAlerts = Array.isArray(alertList)
    ? alertList.filter(a => !a.resolvedAt && !a.acknowledged).length
    : (alertList?.alerts?.filter(a => !a.resolvedAt && !a.acknowledged).length ?? 0);

  // SLO breach count
  const sloArray  = Array.isArray(sloList) ? sloList : (sloList?.slos ?? []);
  const sloBreach = sloArray.filter(s => s.status === 'breached' || s.health === 'crit').length;

  // Runtime health
  const rtStatus  = rt?.status ?? rt?.health ?? (rt?.running ? 'ok' : null);
  const rtJobs    = rt?.activeJobs ?? rt?.queueSize ?? rt?.pending ?? null;

  // Memory
  const memNodes  = mem?.total ?? mem?.count ?? mem?.nodes ?? null;
  const memStatus = mem ? 'ok' : 'unknown';

  // Security score → status
  const scoreVal  = typeof secScore === 'number' ? secScore : (secScore?.score ?? null);
  const secOk     = scoreVal == null ? 'unknown' : scoreVal >= 80 ? 'ok' : scoreVal >= 60 ? 'warn' : 'crit';

  // Observer
  const obsActive = obs?.active ?? obs?.running ?? false;
  const obsLast   = obs?.lastRun ?? obs?.lastCheck ?? obs?.updatedAt;

  // Healing
  const healOk    = heal?.healthy ?? (heal?.status === 'ok' || heal?.active != null);
  const healActive = heal?.active ?? heal?.running ?? 0;

  // Cycles (exec brain)
  const cycActive  = cyc?.active ?? cyc?.running ?? 0;
  const cycTotal   = cyc?.total ?? 0;
  const cycFailed  = cyc?.failed ?? 0;

  // Readiness
  const readyOk   = ready?.ready ?? ready?.status === 'ready';
  const readyPct  = ready?.score ?? ready?.percent ?? null;

  // Live mode / backend
  const liveOk    = live?.status === 'live' || live?.enabled || live?.healthy || live != null;
  const liveLatency = live?.latencyMs ?? live?.responseTime ?? metrics?.latency ?? metrics?.p50 ?? null;

  // Providers
  const providerList = Array.isArray(oauth) ? oauth : (oauth?.providers ?? oauth?.connections ?? []);
  const provOk       = providerList.filter(p => p.status === 'connected' || p.connected).length;
  const provTotal    = providerList.length;

  // Secrets
  const secHStatus = secH?.healthy ? 'ok' : secH == null ? 'unknown' : secH?.issues > 0 ? 'warn' : 'ok';
  const secHCount  = secH?.total ?? secH?.count ?? null;

  return {
    backend: {
      status: liveOk ? 'ok' : 'warn',
      latency: liveLatency,
      lastEvent: live?.updatedAt ?? live?.checkedAt ?? null,
      uptime: readyPct,
      activeJobs: null,
      warnings: activeAlerts > 0 ? `${activeAlerts} active alert${activeAlerts !== 1 ? 's' : ''}` : null,
      meta: readyOk ? 'Readiness: ✓' : 'Readiness: ✗',
    },
    runtime: {
      status: rtStatus === 'ok' || rtStatus === 'running' || rtStatus === 'active' ? 'ok'
             : rtStatus == null ? 'unknown' : 'warn',
      latency: null,
      lastEvent: rt?.lastActivity ?? rt?.lastRun,
      uptime: null,
      activeJobs: rtJobs,
      warnings: null,
      meta: rt ? `Queue: ${rt.queueSize ?? rt.pending ?? 0}` : 'No data',
    },
    electron: {
      status: typeof window !== 'undefined' && window.electronAPI ? 'ok' : 'warn',
      latency: null,
      lastEvent: null,
      uptime: null,
      activeJobs: null,
      warnings: null,
      meta: typeof window !== 'undefined' && window.electronAPI ? 'IPC: connected' : 'IPC: web mode',
    },
    memory: {
      status: memStatus,
      latency: null,
      lastEvent: mem?.lastUpdated ?? mem?.updatedAt,
      uptime: null,
      activeJobs: null,
      warnings: null,
      meta: memNodes != null ? `${memNodes} nodes stored` : 'Memory system',
    },
    observer: {
      status: obs == null ? 'unknown' : obsActive ? 'ok' : 'warn',
      latency: null,
      lastEvent: obsLast,
      uptime: null,
      activeJobs: obs?.pending ?? null,
      warnings: obs?.warnings ?? null,
      meta: obsActive ? 'Running' : 'Idle',
    },
    healing: {
      status: heal == null ? 'unknown' : healOk ? 'ok' : 'warn',
      latency: null,
      lastEvent: heal?.lastRun ?? heal?.updatedAt,
      uptime: null,
      activeJobs: healActive || null,
      warnings: null,
      meta: `${healActive} active task${healActive !== 1 ? 's' : ''}`,
    },
    providers: {
      status: provTotal === 0 ? 'unknown' : provOk === provTotal ? 'ok' : provOk > 0 ? 'warn' : 'crit',
      latency: null,
      lastEvent: null,
      uptime: null,
      activeJobs: null,
      warnings: provOk < provTotal ? `${provTotal - provOk} provider${provTotal - provOk !== 1 ? 's' : ''} disconnected` : null,
      meta: `${provOk}/${provTotal} connected`,
    },
    security: {
      status: secOk,
      latency: null,
      lastEvent: secS?.lastScan ?? secS?.updatedAt,
      uptime: null,
      activeJobs: null,
      warnings: secS?.criticalCount > 0 ? `${secS.criticalCount} critical finding${secS.criticalCount !== 1 ? 's' : ''}` : null,
      meta: scoreVal != null ? `Score: ${scoreVal}/100` : 'Security status',
    },
    secrets: {
      status: secHStatus,
      latency: null,
      lastEvent: secH?.checkedAt ?? secH?.updatedAt,
      uptime: null,
      activeJobs: null,
      warnings: secH?.issues > 0 ? `${secH.issues} issue${secH.issues !== 1 ? 's' : ''}` : null,
      meta: secHCount != null ? `${secHCount} secrets managed` : 'Vault status',
    },
    deployments: {
      status: activeAlerts > 3 ? 'warn' : 'ok',
      latency: null,
      lastEvent: null,
      uptime: null,
      activeJobs: null,
      warnings: null,
      meta: 'Deployment pipeline',
    },
    slos: {
      status: sloBreach === 0 ? 'ok' : sloBreach <= 2 ? 'warn' : 'crit',
      latency: null,
      lastEvent: null,
      uptime: null,
      activeJobs: null,
      warnings: sloBreach > 0 ? `${sloBreach} SLO breach${sloBreach !== 1 ? 'es' : ''}` : null,
      meta: `${sloArray.length} SLO${sloArray.length !== 1 ? 's' : ''} tracked`,
    },
    crm: {
      status: 'ok',
      latency: null,
      lastEvent: null,
      uptime: null,
      activeJobs: null,
      warnings: null,
      meta: 'CRM + WhatsApp + Telegram',
    },
    executive: {
      status: cycFailed > 0 ? 'warn' : cycActive > 0 ? 'ok' : 'ok',
      latency: null,
      lastEvent: cyc?.lastRun ?? cyc?.updatedAt,
      uptime: null,
      activeJobs: cycActive || null,
      warnings: cycFailed > 0 ? `${cycFailed} failed cycle${cycFailed !== 1 ? 's' : ''}` : null,
      meta: `${cycActive} active / ${cycTotal} total cycles`,
    },
  };
}

// ── Service card ──────────────────────────────────────────────────────────────
function ServiceCard({ svc, info, onNavigate }) {
  const chip = statusChip(info?.status ?? 'unknown');
  const TAB_MAP = {
    backend: 'devops', runtime: 'execution', electron: 'devops',
    memory: 'memory', observer: 'jarvisbrain', healing: 'selfhealing',
    providers: 'settings', security: 'devops', secrets: 'devops',
    deployments: 'devops', slos: 'reliability', crm: 'clients', executive: 'executivedash',
  };

  return (
    <div
      className={`shd-card shd-card--${info?.status ?? 'unknown'}`}
      onClick={() => onNavigate?.(TAB_MAP[svc.id] ?? 'devops')}
      title={`Navigate to ${svc.label}`}
    >
      <div className="shd-card-head">
        <span className="shd-svc-icon">{svc.icon}</span>
        <span className="shd-svc-label">{svc.label}</span>
        <span className={`shd-status-chip ${chip.cls}`}>{chip.label}</span>
      </div>

      <div className="shd-card-body">
        <div className="shd-row">
          <span className="shd-dim">Latency</span>
          <span>{info?.latency != null ? `${info.latency}ms` : '—'}</span>
        </div>
        <div className="shd-row">
          <span className="shd-dim">Last event</span>
          <span>{timeAgo(info?.lastEvent)}</span>
        </div>
        {info?.uptime != null && (
          <div className="shd-row">
            <span className="shd-dim">Uptime</span>
            <span>{info.uptime}%</span>
          </div>
        )}
        {info?.activeJobs != null && (
          <div className="shd-row">
            <span className="shd-dim">Active jobs</span>
            <span className="shd-accent">{info.activeJobs}</span>
          </div>
        )}
        {info?.meta && (
          <div className="shd-meta">{info.meta}</div>
        )}
        {info?.warnings && (
          <div className="shd-warning">⚠ {info.warnings}</div>
        )}
      </div>
    </div>
  );
}

// ── Summary bar at top ────────────────────────────────────────────────────────
function SummaryBar({ health }) {
  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, crit: 0, unknown: 0 };
    Object.values(health).forEach(h => { c[h?.status ?? 'unknown'] = (c[h?.status ?? 'unknown'] ?? 0) + 1; });
    return c;
  }, [health]);

  const overall = counts.crit > 0 ? 'crit' : counts.warn > 0 ? 'warn' : 'ok';
  const chip = statusChip(overall);

  return (
    <div className="shd-summary-bar">
      <div className="shd-summary-status">
        <span className={`shd-summary-dot shd-dot--${overall}`} />
        <span className="shd-summary-label">System {chip.label}</span>
      </div>
      <div className="shd-summary-counts">
        {counts.ok     > 0 && <span className="shd-count shd-count--ok">{counts.ok} OK</span>}
        {counts.warn   > 0 && <span className="shd-count shd-count--warn">{counts.warn} WARN</span>}
        {counts.crit   > 0 && <span className="shd-count shd-count--crit">{counts.crit} CRIT</span>}
        {counts.unknown > 0 && <span className="shd-count shd-count--dim">{counts.unknown} UNKN</span>}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function SystemHealthDashboard({ onNavigate }) {
  const [health,      setHealth]      = useState({});
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [groupFilter, setGroupFilter] = useState('All');

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAllHealth()
      .then(h => { setHealth(h); setLoading(false); setLastRefresh(new Date()); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const groups   = ['All', ...GROUP_ORDER];
  const filtered = useMemo(() => {
    const list = SERVICES.filter(s => groupFilter === 'All' || s.group === groupFilter);
    return list;
  }, [groupFilter]);

  return (
    <div className="shd-root">
      {/* Header */}
      <div className="shd-header">
        <div className="shd-header-left">
          <span className="shd-title">System Health</span>
          {lastRefresh && (
            <span className="shd-ts">Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
        <div className="shd-header-right">
          {groups.map(g => (
            <button
              key={g}
              className={`shd-group-btn ${groupFilter === g ? 'shd-group-btn--active' : ''}`}
              onClick={() => setGroupFilter(g)}
            >
              {g}
            </button>
          ))}
          <button className="shd-refresh-btn" onClick={refresh} title="Refresh">↺</button>
        </div>
      </div>

      {/* Summary bar */}
      {!loading && Object.keys(health).length > 0 && (
        <SummaryBar health={health} />
      )}

      {/* Cards grid */}
      <div className="shd-grid">
        {loading && Object.keys(health).length === 0
          ? SERVICES.slice(0, 8).map(s => (
              <div key={s.id} className="shd-card shd-card--loading">
                <div className="sk-row sk-row--w75" style={{ marginBottom: 8 }} />
                <div className="sk-row sk-row--w50 sk-row--sm" style={{ marginBottom: 6 }} />
                <div className="sk-row sk-row--w33 sk-row--sm" />
              </div>
            ))
          : filtered.map(svc => (
              <ServiceCard
                key={svc.id}
                svc={svc}
                info={health[svc.id]}
                onNavigate={onNavigate}
              />
            ))
        }
      </div>
    </div>
  );
}
