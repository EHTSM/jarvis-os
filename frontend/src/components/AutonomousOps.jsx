import React, { useState, useEffect, useCallback, useRef } from 'react';
import './AutonomousOps.css';

const BACKEND = 'http://localhost:5050';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BACKEND}${path}`, { credentials: 'include', ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function usePolled(path, ms = 8000) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    try { setData(await apiFetch(path)); setError(null); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [path]);

  useEffect(() => { run(); const id = setInterval(run, ms); return () => clearInterval(id); }, [run, ms]);
  return { data, error, loading, refresh: run };
}

// ── Health Score ring ──────────────────────────────────────────────────
function HealthRing({ score = 0, label = 'Health' }) {
  const r = 40, cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="ao-ring">
      <svg viewBox="0 0 100 100" className="ao-ring__svg">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth="8" />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="18" fontWeight="700" dominantBaseline="middle">
          {score}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill="#6b7280" fontSize="9">
          {label}
        </text>
      </svg>
    </div>
  );
}

// ── Continuous Health Scoring ──────────────────────────────────────────
function HealthScoring() {
  const { data, error, loading, refresh } = usePolled('/runtime/health/score', 10000);

  const overall   = data?.overall ?? data?.score ?? 0;
  const breakdown = data?.breakdown || {};
  const alerts    = data?.alerts || [];

  if (loading) return <div className="ao-empty">Computing health score…</div>;
  if (error)   return <div className="ao-error">Health scoring unavailable: {error}</div>;

  return (
    <div className="ao-health">
      <div className="ao-health__rings">
        <HealthRing score={overall} label="Overall" />
        {Object.entries(breakdown).map(([k, v]) => (
          <HealthRing key={k} score={v} label={k} />
        ))}
      </div>
      {alerts.length > 0 && (
        <div className="ao-alerts">
          {alerts.map((a, i) => (
            <div key={i} className={`ao-alert ao-alert--${a.severity || 'warn'}`}>
              <span className="ao-alert__icon">{a.severity === 'critical' ? '🔴' : a.severity === 'error' ? '🟠' : '🟡'}</span>
              <span className="ao-alert__msg">{a.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ao-toolbar">
        <button className="ao-btn" onClick={refresh}>↻ Refresh</button>
      </div>
    </div>
  );
}

// ── Failing service detector ───────────────────────────────────────────
function FailingServices() {
  const { data, error, loading, refresh } = usePolled('/runtime/health/services', 8000);
  const services = Array.isArray(data) ? data : (data?.services || []);
  const failing  = services.filter(s => s.status !== 'ok' && s.status !== 'healthy' && s.status !== 'up');

  if (loading) return <div className="ao-empty">Scanning services…</div>;
  if (error)   return <div className="ao-error">Service scan unavailable: {error}</div>;

  return (
    <div className="ao-services">
      <div className="ao-toolbar">
        <span className="ao-count">{services.length} services · {failing.length} failing</span>
        <button className="ao-btn" onClick={refresh}>↻</button>
      </div>
      {!failing.length ? (
        <div className="ao-ok">All services healthy.</div>
      ) : failing.map((s, i) => (
        <div key={i} className="ao-service-row ao-service-row--fail">
          <span className="ao-service-dot ao-service-dot--fail" />
          <div className="ao-service-info">
            <span className="ao-service-name">{s.name || s.service}</span>
            <span className="ao-service-status">{s.status}</span>
            {s.error && <span className="ao-service-error">{s.error}</span>}
          </div>
          {s.url && (
            <button className="ao-btn ao-btn--sm" onClick={async () => {
              try {
                await apiFetch(`/runtime/health/restart`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ service: s.name }),
                });
                refresh();
              } catch {}
            }}>Restart</button>
          )}
        </div>
      ))}
      {services.filter(s => s.status === 'ok' || s.status === 'healthy' || s.status === 'up').map((s, i) => (
        <div key={i} className="ao-service-row">
          <span className="ao-service-dot ao-service-dot--ok" />
          <span className="ao-service-name">{s.name || s.service}</span>
          <span className="ao-service-latency">{s.latency != null ? `${s.latency}ms` : ''}</span>
        </div>
      ))}
    </div>
  );
}

// ── Risky commit detector ──────────────────────────────────────────────
function RiskyCommits() {
  const { data, error, loading, refresh } = usePolled('/jarvis/commit-risk', 30000);
  const commits = Array.isArray(data) ? data : (data?.commits || []);

  if (loading) return <div className="ao-empty">Analyzing recent commits…</div>;
  if (error)   return <div className="ao-error">Commit risk analysis unavailable: {error}</div>;
  if (!commits.length) return <div className="ao-ok">No risky commits detected.</div>;

  return (
    <div className="ao-commits">
      <div className="ao-toolbar">
        <span className="ao-count">{commits.length} commits analyzed</span>
        <button className="ao-btn" onClick={refresh}>↻</button>
      </div>
      {commits.map((c, i) => {
        const risk = c.risk || c.score || 0;
        const cls  = risk >= 70 ? 'high' : risk >= 40 ? 'medium' : 'low';
        return (
          <div key={i} className={`ao-commit-row ao-commit-row--${cls}`}>
            <div className="ao-commit-row__header">
              <span className="ao-commit-hash">{c.hash?.slice(0, 7)}</span>
              <span className="ao-commit-subject">{c.subject}</span>
              <span className={`ao-risk-badge ao-risk-badge--${cls}`}>{risk}% risk</span>
            </div>
            {c.reasons?.map((r, j) => (
              <div key={j} className="ao-commit-reason">• {r}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Deployment failure prediction ──────────────────────────────────────
function DeploymentPrediction() {
  const { data, error, loading, refresh } = usePolled('/jarvis/deploy-predict', 30000);
  const prediction = data?.prediction || data;

  if (loading) return <div className="ao-empty">Running deployment analysis…</div>;
  if (error)   return <div className="ao-error">Deployment prediction unavailable: {error}</div>;
  if (!prediction) return <div className="ao-empty">No prediction data.</div>;

  const risk = prediction.failureRisk ?? prediction.risk ?? 0;
  const color = risk >= 70 ? '#ef4444' : risk >= 40 ? '#f59e0b' : '#10b981';

  return (
    <div className="ao-deploy">
      <div className="ao-deploy__risk" style={{ borderColor: color }}>
        <div className="ao-deploy__risk-label">Deployment Failure Risk</div>
        <div className="ao-deploy__risk-value" style={{ color }}>{risk}%</div>
        {prediction.confidence != null && (
          <div className="ao-deploy__confidence">Confidence: {prediction.confidence}%</div>
        )}
      </div>
      {prediction.factors?.map((f, i) => (
        <div key={i} className="ao-factor">
          <span className={`ao-factor__impact ao-factor__impact--${f.impact === 'high' ? 'red' : f.impact === 'medium' ? 'yellow' : 'green'}`}>
            {f.impact}
          </span>
          <span className="ao-factor__name">{f.name || f.description}</span>
        </div>
      ))}
      {prediction.recommendation && (
        <div className="ao-recommendation">
          <span className="ao-recommendation__icon">💡</span>
          {prediction.recommendation}
        </div>
      )}
      <button className="ao-btn" style={{ marginTop: 8 }} onClick={refresh}>↻ Re-analyze</button>
    </div>
  );
}

// ── Rollback suggestions ───────────────────────────────────────────────
function RollbackSuggestions() {
  const { data, error, loading } = usePolled('/jarvis/rollback-suggest', 30000);
  const suggestions = Array.isArray(data) ? data : (data?.suggestions || []);
  const [applying, setApplying] = useState(null);

  const applyRollback = useCallback(async (s) => {
    setApplying(s.id || s.hash);
    try {
      await apiFetch('/jarvis/rollback-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: s.hash, reason: s.reason }),
      });
    } catch {}
    setApplying(null);
  }, []);

  if (loading) return <div className="ao-empty">Analyzing rollback targets…</div>;
  if (error)   return <div className="ao-error">Rollback analysis unavailable: {error}</div>;
  if (!suggestions.length) return <div className="ao-ok">No rollback recommendations right now.</div>;

  return (
    <div className="ao-rollbacks">
      {suggestions.map((s, i) => (
        <div key={i} className="ao-rollback-row">
          <div className="ao-rollback-row__info">
            <span className="ao-commit-hash">{s.hash?.slice(0, 7)}</span>
            <span className="ao-rollback-label">{s.label || s.subject}</span>
            <span className="ao-rollback-reason">{s.reason}</span>
          </div>
          <button
            className="ao-btn ao-btn--yellow"
            onClick={() => applyRollback(s)}
            disabled={applying === (s.id || s.hash)}
          >
            {applying === (s.id || s.hash) ? '…' : 'Rollback'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Optimization suggestions ───────────────────────────────────────────
function OptimizationSuggestions() {
  const { data, error, loading, refresh } = usePolled('/jarvis/optimize-suggest', 60000);
  const suggestions = Array.isArray(data) ? data : (data?.suggestions || []);
  const [dismissed, setDismissed] = useState(new Set());

  if (loading) return <div className="ao-empty">Scanning for optimizations…</div>;
  if (error)   return <div className="ao-error">Optimization scan unavailable: {error}</div>;

  const visible = suggestions.filter(s => !dismissed.has(s.id));

  return (
    <div className="ao-optimizations">
      <div className="ao-toolbar">
        <span className="ao-count">{visible.length} suggestions</span>
        <button className="ao-btn" onClick={refresh}>↻</button>
      </div>
      {!visible.length ? (
        <div className="ao-ok">Nothing to optimize right now.</div>
      ) : visible.map((s, i) => (
        <div key={i} className="ao-opt-card">
          <div className="ao-opt-card__header">
            <span className={`ao-impact-badge ao-impact-badge--${s.impact || 'medium'}`}>{s.impact || 'medium'}</span>
            <span className="ao-opt-card__title">{s.title || s.description}</span>
            <button className="ao-dismiss" onClick={() => setDismissed(d => new Set([...d, s.id]))}>✕</button>
          </div>
          {s.detail && <p className="ao-opt-card__detail">{s.detail}</p>}
          {s.action && (
            <button className="ao-btn ao-btn--sm ao-btn--green" onClick={async () => {
              try {
                await apiFetch('/jarvis/optimize-apply', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: s.id }),
                });
                setDismissed(d => new Set([...d, s.id]));
              } catch {}
            }}>
              {s.action}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Proactive AI fixes ─────────────────────────────────────────────────
function ProactiveFixes() {
  const { data, error, loading, refresh } = usePolled('/jarvis/proactive-fixes', 20000);
  const fixes = Array.isArray(data) ? data : (data?.fixes || []);
  const [applying, setApplying] = useState(null);
  const [applied,  setApplied]  = useState(new Set());

  const apply = useCallback(async (fix) => {
    const key = fix.id || fix.title;
    setApplying(key);
    try {
      await apiFetch('/jarvis/apply-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fix),
      });
      setApplied(a => new Set([...a, key]));
    } catch {}
    setApplying(null);
  }, []);

  if (loading) return <div className="ao-empty">Scanning for issues…</div>;
  if (error)   return <div className="ao-error">Proactive scanning unavailable: {error}</div>;

  const visible = fixes.filter(f => !applied.has(f.id || f.title));

  return (
    <div className="ao-fixes">
      <div className="ao-toolbar">
        <span className="ao-count">{visible.length} proactive fixes available</span>
        <button className="ao-btn" onClick={refresh}>↻</button>
      </div>
      {!visible.length ? (
        <div className="ao-ok">No issues detected. System is healthy.</div>
      ) : visible.map((f, i) => (
        <div key={i} className={`ao-fix-card ao-fix-card--${f.severity || 'info'}`}>
          <div className="ao-fix-card__header">
            <span className={`ao-sev-badge ao-sev-badge--${f.severity || 'info'}`}>{f.severity || 'info'}</span>
            <span className="ao-fix-card__title">{f.title}</span>
          </div>
          {f.description && <p className="ao-fix-card__desc">{f.description}</p>}
          {f.file && <div className="ao-fix-card__file">{f.file}{f.line ? `:${f.line}` : ''}</div>}
          <div className="ao-fix-card__actions">
            <button
              className="ao-btn ao-btn--sm ao-btn--green"
              onClick={() => apply(f)}
              disabled={applying === (f.id || f.title)}
            >
              {applying === (f.id || f.title) ? 'Applying…' : 'Apply Fix'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'health',   label: 'Health Score' },
  { id: 'services', label: 'Services' },
  { id: 'fixes',    label: 'AI Fixes' },
  { id: 'commits',  label: 'Risky Commits' },
  { id: 'deploy',   label: 'Deploy Predict' },
  { id: 'rollback', label: 'Rollbacks' },
  { id: 'optimize', label: 'Optimize' },
];

export default function AutonomousOps({ className = '' }) {
  const [tab, setTab] = useState('health');

  return (
    <div className={`autonomous-ops ${className}`}>
      <div className="ao-header">
        <span className="ao-header__title">Autonomous Operations</span>
        <span className="ao-header__badge">AI-Native</span>
      </div>
      <div className="ao-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`ao-tab${tab === t.id ? ' ao-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ao-body">
        {tab === 'health'   && <HealthScoring />}
        {tab === 'services' && <FailingServices />}
        {tab === 'fixes'    && <ProactiveFixes />}
        {tab === 'commits'  && <RiskyCommits />}
        {tab === 'deploy'   && <DeploymentPrediction />}
        {tab === 'rollback' && <RollbackSuggestions />}
        {tab === 'optimize' && <OptimizationSuggestions />}
      </div>
    </div>
  );
}
