/**
 * EngineeringIntelligencePane — J4 Engineering Intelligence Workspace
 *
 * Derives engineering intelligence from existing data:
 *   - Repository Health Score
 *   - Code Hotspots
 *   - Recent Failures
 *   - Regression Trends
 *   - Mission Risk Score
 *   - Commit Risk Score
 *   - Dependency Risk
 *   - Execution Insights
 *   - Suggested Next Mission
 *   - Historical Replay
 *   - Failure Heatmap
 *   - AI Engineering Timeline
 *
 * Reads from: /engineering/intelligence (60s cache, pure derivation)
 * No new backends, no new runtimes, no new observers.
 */
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { BASE_URL } from '../_client';
import './EngineeringIntelligencePane.css';

// ── API ────────────────────────────────────────────────────────────────

async function _get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function _post(path, body = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ── Utilities ──────────────────────────────────────────────────────────

function _ago(iso) {
  if (!iso) return '—';
  try {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return '—'; }
}

function _dur(ms) {
  if (!ms) return '—';
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// ── Shared micro-components ────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function GradeRing({ score = 0, grade = 'B', size = 64 }) {
  const col = score >= 80 ? '#52d68a' : score >= 60 ? '#f0b429' : '#f55b5b';
  const r   = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="eip-grade-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={col} strokeWidth={4}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
        />
      </svg>
      <div className="eip-grade-ring__inner" style={{ color: col }}>
        <span className="eip-grade-ring__grade">{grade}</span>
        <span className="eip-grade-ring__score">{score}</span>
      </div>
    </div>
  );
}

function ScoreBar({ score = 0, label, size = 'md' }) {
  const col = score >= 80 ? '#52d68a' : score >= 50 ? '#f0b429' : '#f55b5b';
  return (
    <div className={`eip-score-bar eip-score-bar--${size}`}>
      {label && <span className="eip-score-bar__label">{label}</span>}
      <div className="eip-score-bar__track">
        <div className="eip-score-bar__fill" style={{ width: `${score}%`, background: col }} />
      </div>
      <span className="eip-score-bar__val" style={{ color: col }}>{score}</span>
    </div>
  );
}

function RiskBadge({ level }) {
  return (
    <span className={`eip-risk-badge eip-risk-badge--${level}`}>
      {level === 'high' ? '▲' : level === 'medium' ? '◆' : '●'} {level}
    </span>
  );
}

function TrendArrow({ trend }) {
  if (trend === 'improving') return <span className="eip-trend eip-trend--up">↑ improving</span>;
  if (trend === 'degrading') return <span className="eip-trend eip-trend--down">↓ degrading</span>;
  return <span className="eip-trend eip-trend--flat">→ stable</span>;
}

function Skeleton({ w = '100%', h = 12 }) {
  return <span className="eip-skel" style={{ width: w, height: h }} />;
}

function SectionHeader({ title, count, icon }) {
  return (
    <div className="eip-section-header">
      {icon && <span className="eip-section-header__icon">{icon}</span>}
      <span className="eip-section-header__title">{title}</span>
      {count != null && <span className="eip-section-header__count">{count}</span>}
    </div>
  );
}

function Empty({ icon = '◌', title, sub }) {
  return (
    <div className="eip-empty">
      <span className="eip-empty__icon">{icon}</span>
      <span className="eip-empty__title">{title}</span>
      {sub && <span className="eip-empty__sub">{sub}</span>}
    </div>
  );
}

// ── Tab: Overview ──────────────────────────────────────────────────────

function TabOverview({ data, onNavigate }) {
  const rh  = data.repositoryHealth  || {};
  const mr  = data.missionRisk       || {};
  const cr  = data.commitRisk        || {};
  const ei  = data.executionInsights || {};

  return (
    <div className="eip-overview">
      {/* Health score cards */}
      <div className="eip-overview__scores">
        <div className="eip-score-card">
          <GradeRing score={rh.score || 0} grade={rh.grade || '?'} size={72} />
          <div className="eip-score-card__body">
            <div className="eip-score-card__title">Repository Health</div>
            <TrendArrow trend={rh.trend} />
            <div className="eip-score-card__breakdown">
              <ScoreBar score={rh.breakdown?.missionCompletion || 0}   label="Missions"  size="xs" />
              <ScoreBar score={rh.breakdown?.healingSuccessRate || 0}   label="Healing"   size="xs" />
              <ScoreBar score={rh.breakdown?.execVerificationRate || 0} label="Exec"      size="xs" />
              <ScoreBar score={rh.breakdown?.dlqPressure || 0}          label="DLQ"       size="xs" />
            </div>
          </div>
        </div>

        <div className="eip-score-card">
          <GradeRing
            score={100 - (mr.score || 0)}
            grade={mr.level === 'high' ? 'D' : mr.level === 'medium' ? 'C' : 'A'}
            size={72}
          />
          <div className="eip-score-card__body">
            <div className="eip-score-card__title">Mission Risk</div>
            <RiskBadge level={mr.level || 'low'} />
            <div className="eip-score-card__stats">
              <span>{mr.activeMissions || 0} active</span>
              <span>{mr.failedMissions || 0} failed</span>
              <span>{mr.subtaskCompletionRate || 0}% subtasks</span>
            </div>
          </div>
        </div>

        <div className="eip-score-card">
          <GradeRing
            score={100 - (cr.score || 0)}
            grade={cr.level === 'high' ? 'D' : cr.level === 'medium' ? 'C' : 'A'}
            size={72}
          />
          <div className="eip-score-card__body">
            <div className="eip-score-card__title">Commit Risk</div>
            <RiskBadge level={cr.level || 'low'} />
            <div className="eip-score-card__stats">
              <span>{cr.rollbackRate || 0}% rollback</span>
              <span>{cr.totalCommits || 0} commits</span>
              <span>{cr.commitsPerDay || 0}/day</span>
            </div>
          </div>
        </div>

        <div className="eip-score-card">
          <GradeRing score={ei.successRate || 0} grade={ei.successRate >= 80 ? 'A' : ei.successRate >= 60 ? 'B' : 'C'} size={72} />
          <div className="eip-score-card__body">
            <div className="eip-score-card__title">Execution Health</div>
            <div className="eip-score-card__stats">
              <span>{ei.total || 0} total</span>
              <span>{ei.ok || 0} ok</span>
              <span>{ei.verificationRate || 0}% verified</span>
            </div>
            <div className="eip-score-card__stats">
              <span>avg {_dur(ei.avgDurationMs)}</span>
              <span>p95 {_dur(ei.p95DurationMs)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Suggested missions */}
      {(data.suggestedNextMission || []).length > 0 && (
        <div className="eip-suggest-block">
          <SectionHeader title="Suggested Next Missions" icon="⬡" count={data.suggestedNextMission.length} />
          <div className="eip-suggest-list">
            {data.suggestedNextMission.map((s, i) => (
              <div key={i} className="eip-suggest-item">
                <div className="eip-suggest-item__source">
                  <span className={`eip-suggest-source eip-suggest-source--${s.source}`}>{s.source}</span>
                  <span className="eip-suggest-item__conf">{s.confidence}% confident</span>
                </div>
                <div className="eip-suggest-item__obj">{s.objective}</div>
                {s.reason && <div className="eip-suggest-item__reason">{s.reason?.slice(0, 120)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick navigation tiles */}
      <div className="eip-nav-tiles">
        {[
          { id: 'hotspots',  icon: '🔥', label: 'Code Hotspots',       count: (data.codeHotspots || []).length },
          { id: 'failures',  icon: '✕',  label: 'Recent Failures',      count: (data.recentFailures || []).length },
          { id: 'trends',    icon: '📈', label: 'Regression Trends',    count: (data.regressionTrends || []).length },
          { id: 'deps',      icon: '⚙',  label: 'Dependency Risk',      count: (data.dependencyRisk || []).length },
          { id: 'heatmap',   icon: '◉',  label: 'Failure Heatmap' },
          { id: 'timeline',  icon: '⟐',  label: 'AI Timeline',          count: (data.aiTimeline || []).length },
          { id: 'replay',    icon: '↺',  label: 'Historical Replay',    count: (data.historicalReplay || []).length },
          { id: 'exec',      icon: '▶',  label: 'Execution Insights' },
        ].map(t => (
          <button key={t.id} className="eip-nav-tile" onClick={() => onNavigate(t.id)}>
            <span className="eip-nav-tile__icon">{t.icon}</span>
            <span className="eip-nav-tile__label">{t.label}</span>
            {t.count != null && <span className="eip-nav-tile__count">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Code Hotspots ────────────────────────────────────────────────

function TabHotspots({ data }) {
  const spots = data.codeHotspots || [];
  if (!spots.length) return <Empty icon="🔥" title="No hotspot data yet" sub="Make commits linked to missions to see code hotspots" />;

  const maxScore = Math.max(...spots.map(s => s.hotScore), 1);
  return (
    <div className="eip-hotspots">
      {spots.map((s, i) => (
        <div key={s.file} className="eip-hotspot-row">
          <span className="eip-hotspot-rank">#{i + 1}</span>
          <div className="eip-hotspot-body">
            <div className="eip-hotspot-file" title={s.file}>
              {s.file.length > 50 ? '…' + s.file.slice(-47) : s.file}
            </div>
            <div className="eip-hotspot-bar-wrap">
              <div
                className="eip-hotspot-bar"
                style={{ width: `${(s.hotScore / maxScore) * 100}%`, background: i < 3 ? '#f55b5b' : i < 6 ? '#f0b429' : '#7c6fff' }}
              />
            </div>
          </div>
          <div className="eip-hotspot-meta">
            <span className="eip-hotspot-stat" title="Mission commits touching this file">⎇ {s.commitCount}</span>
            {s.failureCount > 0 && <span className="eip-hotspot-stat eip-hotspot-stat--warn" title="Failure references">✕ {s.failureCount}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Recent Failures ──────────────────────────────────────────────

function TabFailures({ data }) {
  const fails = data.recentFailures || [];
  if (!fails.length) return <Empty icon="✓" title="No recent failures" sub="Execution and mission failures will appear here" />;

  const typeIcon = { execution: '▶', mission: '◎', error: '✕' };
  const typeColor = { execution: '#7c6fff', mission: '#f0b429', error: '#f55b5b' };

  return (
    <div className="eip-failures">
      {fails.map((f, i) => (
        <div key={f.id || i} className={`eip-failure-row eip-failure-row--${f.type}`}>
          <div className="eip-failure-row__header">
            <span className="eip-failure-icon" style={{ color: typeColor[f.type] }}>
              {typeIcon[f.type] || '✕'}
            </span>
            <span className="eip-failure-label">{f.label}</span>
            <span className="eip-failure-ts">{_ago(f.ts)}</span>
          </div>
          <div className="eip-failure-row__meta">
            <span className="eip-failure-type">{f.type}</span>
            {f.reason && <span className="eip-failure-reason">{f.reason}</span>}
            {f.duration && <span className="eip-failure-dur">{_dur(f.duration)}</span>}
            {f.count    && <span className="eip-failure-count">×{f.count}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Regression Trends ────────────────────────────────────────────

function TabTrends({ data }) {
  const trends = data.regressionTrends || [];
  if (!trends.length) return <Empty icon="📈" title="No trend data yet" sub="Trends build up over time from missions and executions" />;

  const maxErrors    = Math.max(...trends.map(t => t.errors || 0), 1);
  const maxMissions  = Math.max(...trends.map(t => t.missions || 0), 1);

  return (
    <div className="eip-trends">
      <div className="eip-trends__legend">
        <span className="eip-legend-dot" style={{ background: '#f55b5b' }} /> Errors
        <span className="eip-legend-dot" style={{ background: '#7c6fff' }} /> Missions
        <span className="eip-legend-dot" style={{ background: '#f0b429' }} /> Failures
      </div>
      <div className="eip-trends__chart">
        {trends.map((b, i) => (
          <div key={b.date || i} className="eip-trend-col">
            <div className="eip-trend-bars">
              <div
                className="eip-trend-bar eip-trend-bar--err"
                style={{ height: `${Math.round((b.errors || 0) / maxErrors * 100)}%` }}
                title={`Errors: ${b.errors || 0}`}
              />
              <div
                className="eip-trend-bar eip-trend-bar--msn"
                style={{ height: `${Math.round((b.missions || 0) / maxMissions * 100)}%` }}
                title={`Missions: ${b.missions || 0}`}
              />
              {(b.failures || 0) > 0 && (
                <div
                  className="eip-trend-bar eip-trend-bar--fail"
                  style={{ height: `${Math.round((b.failures || 0) / maxMissions * 100)}%` }}
                  title={`Failures: ${b.failures || 0}`}
                />
              )}
            </div>
            <div className="eip-trend-label">{(b.date || '').slice(5)}</div>
          </div>
        ))}
      </div>
      {/* Numeric table */}
      <div className="eip-trends__table">
        <div className="eip-trends__row eip-trends__row--header">
          <span>Date</span><span>Errors</span><span>Missions</span><span>Deploys</span>
        </div>
        {trends.slice(-7).map((b, i) => (
          <div key={i} className="eip-trends__row">
            <span>{b.date || '—'}</span>
            <span style={{ color: (b.errors || 0) > 0 ? '#f55b5b' : '#52d68a' }}>{b.errors || 0}</span>
            <span>{b.missions || 0}</span>
            <span>{b.deployments || b.deploys || 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Dependency Risk ──────────────────────────────────────────────

function TabDependencies({ data }) {
  const deps = data.dependencyRisk || [];
  if (!deps.length) return <Empty icon="⚙" title="No dependency risk data" sub="Dependency pressure is derived from dead-letter queue failures" />;

  return (
    <div className="eip-deps">
      <div className="eip-deps__header">
        <span>Dependency</span><span>DLQ Failures</span><span>Heal Fails</span><span>Risk</span>
      </div>
      {deps.map((d, i) => (
        <div key={d.dependency || i} className={`eip-dep-row eip-dep-row--${d.riskLevel}`}>
          <div className="eip-dep-name">{d.dependency}</div>
          <div className="eip-dep-count">{d.failureCount}</div>
          <div className="eip-dep-count">{d.healingFails || 0}</div>
          <RiskBadge level={d.riskLevel} />
        </div>
      ))}
    </div>
  );
}

// ── Tab: Failure Heatmap ──────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const TabHeatmap = memo(function TabHeatmap({ data }) {
  const hm      = data.failureHeatmap || {};
  const cells   = hm.cells || [];
  const maxVal  = hm.maxCount || 1;

  const grid = {};
  for (const c of cells) {
    grid[`${c.day}:${c.hour}`] = c;
  }

  if (!cells.length) return <Empty icon="◉" title="No failure heatmap data" sub="Heatmap builds from execution failures and healing failures over time" />;

  return (
    <div className="eip-heatmap">
      <div className="eip-heatmap__legend">
        <span className="eip-hm-legend-label">Failure frequency by day &amp; hour</span>
        <div className="eip-hm-scale">
          {[0, 25, 50, 75, 100].map(pct => (
            <span key={pct} className="eip-hm-scale-dot" style={{ background: `rgba(245,91,91,${pct / 100})` }} />
          ))}
          <span className="eip-hm-scale-text">more failures →</span>
        </div>
      </div>
      <div className="eip-heatmap__grid">
        <div className="eip-hm-row eip-hm-row--header">
          <div className="eip-hm-day-label" />
          {HOURS.map(h => (
            <div key={h} className="eip-hm-hour-label">{h % 4 === 0 ? `${h}h` : ''}</div>
          ))}
        </div>
        {DAYS.map((day, di) => (
          <div key={di} className="eip-hm-row">
            <div className="eip-hm-day-label">{day}</div>
            {HOURS.map(h => {
              const c   = grid[`${di}:${h}`];
              const pct = c ? (c.count / maxVal) : 0;
              return (
                <div
                  key={h}
                  className="eip-hm-cell"
                  style={{ background: `rgba(245,91,91,${Math.min(1, pct * 1.2)})` }}
                  title={c ? `${day} ${h}:00 — ${c.count} failures` : ''}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

// ── Tab: AI Engineering Timeline ──────────────────────────────────────

function TabTimeline({ data }) {
  const events = data.aiTimeline || [];
  if (!events.length) return <Empty icon="⟐" title="No timeline events" sub="Timeline builds from missions, commits, executions, and healing" />;

  const typeIcon  = { mission: '◎', commit: '⎇', exec_failure: '▶', failure: '✕', healing: '♥' };
  const typeColor = {
    mission: '#7c6fff', commit: '#52d68a',
    exec_failure: '#f55b5b', failure: '#f55b5b', healing: '#f0b429',
  };

  return (
    <div className="eip-timeline">
      {events.map((e, i) => (
        <div key={i} className="eip-tl-row">
          <div className="eip-tl-track">
            <div className="eip-tl-line-top" style={{ opacity: i === 0 ? 0 : 1 }} />
            <div className="eip-tl-dot" style={{ background: typeColor[e.type] || '#8994b0' }}>
              {typeIcon[e.type] || '·'}
            </div>
            <div className="eip-tl-line-bot" style={{ opacity: i === events.length - 1 ? 0 : 1 }} />
          </div>
          <div className="eip-tl-body">
            <div className="eip-tl-header">
              <span className="eip-tl-action" style={{ color: typeColor[e.type] }}>
                {e.action?.replace(/_/g, ' ')}
              </span>
              {e.hash && <span className="eip-tl-hash">#{e.hash}</span>}
              <span className="eip-tl-ts">{_ago(e.ts)}</span>
            </div>
            <div className="eip-tl-label">{e.label || '—'}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Historical Replay ────────────────────────────────────────────

function TabReplay({ data }) {
  const replays = data.historicalReplay || [];
  const [selected, setSelected] = useState(0);

  if (!replays.length) return <Empty icon="↺" title="No completed missions to replay" sub="Historical replay appears for completed and failed missions" />;

  const m = replays[selected];

  return (
    <div className="eip-replay">
      {/* Mission selector */}
      <div className="eip-replay__selector">
        {replays.map((r, i) => (
          <button
            key={r.missionId}
            className={`eip-replay__btn${selected === i ? ' eip-replay__btn--active' : ''}`}
            onClick={() => setSelected(i)}
          >
            <span className={`eip-replay-status eip-replay-status--${r.status}`}>{r.status === 'completed' ? '✓' : '✕'}</span>
            <span className="eip-replay-obj">{r.objective?.slice(0, 35)}…</span>
          </button>
        ))}
      </div>

      {/* Mission replay detail */}
      <div className="eip-replay__detail">
        <div className="eip-replay__title">
          <span className={`eip-replay-status-badge eip-replay-status-badge--${m.status}`}>{m.status}</span>
          {m.objective}
        </div>
        {m.duration && (
          <div className="eip-replay__duration">Duration: {_dur(m.duration)}</div>
        )}

        {/* Subtask chain */}
        {m.subtasks?.length > 0 && (
          <div className="eip-replay__section">
            <div className="eip-replay__section-label">Subtask Chain</div>
            {m.subtasks.map((st, i) => (
              <div key={st.id || i} className={`eip-replay-subtask eip-replay-subtask--${st.status}`}>
                <span className="eip-replay-subtask__num">{i + 1}</span>
                <span className="eip-replay-subtask__desc">{st.desc}</span>
                <span className={`eip-replay-subtask__status eip-replay-subtask__status--${st.status}`}>{st.status}</span>
                {st.agent && <span className="eip-replay-subtask__agent">{st.agent}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Failures */}
        {m.failures?.length > 0 && (
          <div className="eip-replay__section">
            <div className="eip-replay__section-label">Failures Encountered</div>
            {m.failures.map((f, i) => (
              <div key={i} className="eip-replay-failure">
                <span className="eip-replay-failure__phase">{f.phase}</span>
                <span className="eip-replay-failure__desc">{f.desc}</span>
                <span className={`eip-replay-failure__resolved${f.resolved ? ' resolved' : ''}`}>
                  {f.resolved ? '✓ resolved' : '✕ unresolved'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Commits */}
        {m.commits?.length > 0 && (
          <div className="eip-replay__section">
            <div className="eip-replay__section-label">Commits</div>
            {m.commits.map((c, i) => (
              <div key={i} className="eip-replay-commit">
                <span className="eip-replay-commit__hash">#{c.hash}</span>
                <span className="eip-replay-commit__msg">{c.message}</span>
                {c.final && <span className="eip-replay-commit__final">final</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Execution Insights ───────────────────────────────────────────

function TabExecution({ data }) {
  const ei = data.executionInsights || {};
  const caps = ei.topCapabilities || [];

  return (
    <div className="eip-exec">
      <div className="eip-exec__stats">
        <div className="eip-exec-stat"><span className="eip-exec-stat__val">{ei.total || 0}</span><span className="eip-exec-stat__label">Total</span></div>
        <div className="eip-exec-stat"><span className="eip-exec-stat__val" style={{ color: '#52d68a' }}>{ei.ok || 0}</span><span className="eip-exec-stat__label">OK</span></div>
        <div className="eip-exec-stat"><span className="eip-exec-stat__val" style={{ color: '#f55b5b' }}>{ei.failed || 0}</span><span className="eip-exec-stat__label">Failed</span></div>
        <div className="eip-exec-stat"><span className="eip-exec-stat__val" style={{ color: '#7c6fff' }}>{ei.successRate || 0}%</span><span className="eip-exec-stat__label">Success Rate</span></div>
        <div className="eip-exec-stat"><span className="eip-exec-stat__val">{_dur(ei.avgDurationMs)}</span><span className="eip-exec-stat__label">Avg Dur</span></div>
        <div className="eip-exec-stat"><span className="eip-exec-stat__val">{_dur(ei.p95DurationMs)}</span><span className="eip-exec-stat__label">p95 Dur</span></div>
        <div className="eip-exec-stat"><span className="eip-exec-stat__val">{ei.verificationRate || 0}%</span><span className="eip-exec-stat__label">Verified</span></div>
      </div>

      <SectionHeader title="Capability Leaderboard" icon="▶" count={caps.length} />
      <div className="eip-exec__table">
        <div className="eip-exec__row eip-exec__row--header">
          <span>Capability</span><span>Calls</span><span>Failures</span><span>Fail %</span>
        </div>
        {caps.map((c, i) => (
          <div key={c.capability || i} className="eip-exec__row">
            <span className="eip-exec-cap">{c.capability}</span>
            <span>{c.count}</span>
            <span style={{ color: c.failures > 0 ? '#f55b5b' : '#52d68a' }}>{c.failures}</span>
            <span style={{ color: c.failRate >= 30 ? '#f55b5b' : c.failRate >= 10 ? '#f0b429' : '#52d68a' }}>{c.failRate}%</span>
          </div>
        ))}
        {!caps.length && <div className="eip-empty eip-empty--sm">No capability data</div>}
      </div>
    </div>
  );
}

// ── Main EngineeringIntelligencePane ─────────────────────────────────

// ── Tab: Graph Reasoning ──────────────────────────────────────────────
function TabGraphReasoning() {
  const [rData, setRData] = useState(null);
  const [rLoading, setRLoading] = useState(true);

  useEffect(() => {
    _get('/graph/reasoning').then(r => { if (r.ok) setRData(r); }).catch(() => {}).finally(() => setRLoading(false));
  }, []);

  if (rLoading) return <div className="eip-empty">Loading graph reasoning…</div>;
  if (!rData)   return <div className="eip-empty">Graph reasoning unavailable</div>;

  const blocked = rData.blockedMissions?.blockedMissions || [];
  const critical = rData.criticalDependencies?.criticalDependencies || [];
  const spofs    = rData.singlePointsOfFailure?.singlePointsOfFailure || [];
  const gaps     = rData.knowledgeGaps?.knowledgeGaps || [];
  const dups     = rData.duplicateWork?.duplicateWork || [];

  return (
    <div className="eip-exec">
      <div className="eip-section-title" style={{ marginBottom: 8 }}>Critical Dependencies ({critical.length})</div>
      {critical.length === 0 ? <div className="eip-empty eip-empty--sm">None detected</div> : (
        <table className="eip-exec__table"><tbody>
          {critical.map(d => (
            <tr key={d.key}>
              <td><span className="eip-badge" style={{ background: d.risk === 'critical' ? '#ef4444' : '#f59e0b' }}>{d.risk}</span></td>
              <td><code>{d.type}:{d.id}</code></td>
              <td style={{ color: 'var(--text-dim)' }}>{d.explanation}</td>
            </tr>
          ))}
        </tbody></table>
      )}

      <div className="eip-section-title" style={{ margin: '12px 0 8px' }}>Single Points of Failure ({spofs.length})</div>
      {spofs.length === 0 ? <div className="eip-empty eip-empty--sm">None detected</div> : (
        <table className="eip-exec__table"><tbody>
          {spofs.map(s => (
            <tr key={s.type + s.id}>
              <td><span className="eip-badge" style={{ background: '#ef4444' }}>SPOF</span></td>
              <td><code>{s.type}:{s.id}</code></td>
              <td style={{ color: 'var(--text-dim)' }}>{s.explanation}</td>
            </tr>
          ))}
        </tbody></table>
      )}

      <div className="eip-section-title" style={{ margin: '12px 0 8px' }}>Blocked Missions ({blocked.length})</div>
      {blocked.length === 0 ? <div className="eip-empty eip-empty--sm">No blocked missions</div> : (
        <table className="eip-exec__table"><tbody>
          {blocked.map(b => (
            <tr key={b.missionId}>
              <td><span className="eip-badge" style={{ background: '#f59e0b' }}>blocked</span></td>
              <td style={{ maxWidth: 200 }}>{b.objective}</td>
              <td style={{ color: 'var(--text-dim)' }}>{(b.blockers || []).join(', ')}</td>
            </tr>
          ))}
        </tbody></table>
      )}

      <div className="eip-section-title" style={{ margin: '12px 0 8px' }}>Knowledge Gaps ({gaps.length})</div>
      {gaps.length === 0 ? <div className="eip-empty eip-empty--sm">No gaps detected</div> : (
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {gaps.map(g => <li key={g.missionId} style={{ color: 'var(--text-dim)', marginBottom: 4 }}>{g.objective} <em>({g.ageDays}d old)</em></li>)}
        </ul>
      )}

      {dups.length > 0 && (
        <>
          <div className="eip-section-title" style={{ margin: '12px 0 8px' }}>Duplicate Work ({dups.length})</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {dups.map((d, i) => <li key={i} style={{ color: 'var(--text-dim)', marginBottom: 4 }}>{d.missionA.objective?.slice(0,50)} ↔ {d.missionB.objective?.slice(0,50)} <em>({Math.round(d.similarity*100)}%)</em></li>)}
          </ul>
        </>
      )}
    </div>
  );
}

const TABS = [
  { id: 'overview',  label: '⬡ Overview' },
  { id: 'hotspots',  label: '🔥 Hotspots' },
  { id: 'failures',  label: '✕ Failures' },
  { id: 'trends',    label: '📈 Trends' },
  { id: 'deps',      label: '⚙ Deps' },
  { id: 'heatmap',   label: '◉ Heatmap' },
  { id: 'timeline',  label: '⟐ Timeline' },
  { id: 'replay',    label: '↺ Replay' },
  { id: 'exec',      label: '▶ Exec' },
  { id: 'reasoning', label: '◈ Reasoning' },
];

export default function EngineeringIntelligencePane({ className = '' }) {
  const [tab,      setTab]     = useState('overview');
  const [data,     setData]    = useState(null);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async (invalidate = false) => {
    setLoading(true);
    try {
      if (invalidate) {
        await _post('/engineering/intelligence/invalidate');
      }
      const r = await _get('/engineering/intelligence');
      if (r.ok) {
        setData(r);
        setLastFetch(new Date());
        setError(null);
      } else {
        setError(r.error || 'Unknown error');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 90s — backend caches for 60s, so this always has fresh data
    pollRef.current = setInterval(() => load(), 90_000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const renderTab = () => {
    if (!data) return null;
    switch (tab) {
      case 'overview':  return <TabOverview  data={data} onNavigate={setTab} />;
      case 'hotspots':  return <TabHotspots  data={data} />;
      case 'failures':  return <TabFailures  data={data} />;
      case 'trends':    return <TabTrends    data={data} />;
      case 'deps':      return <TabDependencies data={data} />;
      case 'heatmap':   return <TabHeatmap   data={data} />;
      case 'timeline':  return <TabTimeline  data={data} />;
      case 'replay':    return <TabReplay    data={data} />;
      case 'exec':      return <TabExecution data={data} />;
      case 'reasoning': return <TabGraphReasoning />;
      default:          return null;
    }
  };

  return (
    <div className={`eip ${className}`}>
      {/* Header */}
      <div className="eip-header">
        <div className="eip-header__left">
          <span className="eip-header__title">Engineering Intelligence</span>
          {lastFetch && (
            <span className="eip-header__fresh">computed {_ago(lastFetch)}</span>
          )}
        </div>
        <div className="eip-header__right">
          <button
            className="eip-header__btn"
            onClick={() => load(true)}
            disabled={loading}
            title="Refresh and invalidate cache"
          >
            {loading ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="eip-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`eip-tab${tab === t.id ? ' eip-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="eip-body">
        {loading && !data && (
          <div className="eip-loading">
            <div className="eip-loading__grid">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} w="100%" h={80} />)}
            </div>
          </div>
        )}
        {error && !data && (
          <div className="eip-error">
            <span>⚠</span>
            <span>{error}</span>
            <button className="eip-header__btn" onClick={() => load()}>Retry</button>
          </div>
        )}
        {data && renderTab()}
      </div>

      {/* Status bar */}
      {data?.computed_at && (
        <div className="eip-statusbar">
          <span>Data as of {new Date(data.computed_at).toLocaleTimeString()}</span>
          {data.repositoryHealth?.grade && (
            <span className="eip-statusbar__grade">
              Health: {data.repositoryHealth.grade} ({data.repositoryHealth.score})
            </span>
          )}
          <span className="eip-statusbar__sep">•</span>
          <span>J4 Engineering Intelligence</span>
        </div>
      )}
    </div>
  );
}
