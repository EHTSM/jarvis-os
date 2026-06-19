import React, { useState, useEffect, useCallback, useRef } from 'react';
import { _fetch } from '../_client';
import './AutonomousAgentPanel.css';

async function api(method, path, body) {
    return _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
}

// ── Stage meta ────────────────────────────────────────────────────────────────
const STAGE_COLOR = {
    analyze:         '#60a5fa', plan:    '#a78bfa', patch:   '#f59e0b',
    apply:           '#f59e0b', build_test: '#10b981', commit: '#10b981',
    learn:           '#10b981', complete:   '#10b981', repair_start: '#ef4444',
    repair_exhausted:'#ef4444', fatal_error: '#ef4444', cancelled: '#6b7280',
    paused:          '#6b7280', pause_requested: '#6b7280', resumed: '#a78bfa',
};

const STATUS_META = {
    running:   { color: '#10b981', label: 'Running'   },
    paused:    { color: '#6b7280', label: 'Paused'    },
    completed: { color: '#10b981', label: 'Completed' },
    failed:    { color: '#ef4444', label: 'Failed'    },
    cancelled: { color: '#6b7280', label: 'Cancelled' },
};

function StatusBadge({ status }) {
    const m = STATUS_META[status] || { color: '#6b7280', label: status || '?' };
    return <span className="aap-badge" style={{ color: m.color, borderColor: m.color }}>{m.label}</span>;
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────
function Elapsed({ startedAt, completedAt }) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (completedAt) {
            setElapsed(new Date(completedAt) - new Date(startedAt));
            return;
        }
        const iv = setInterval(() => setElapsed(Date.now() - new Date(startedAt)), 1000);
        return () => clearInterval(iv);
    }, [startedAt, completedAt]);
    const s = Math.round(elapsed / 1000);
    return <span className="aap-elapsed">{s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`}</span>;
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function MissionTimeline({ events }) {
    if (!events?.length) return null;
    return (
        <div className="aap-timeline">
            {events.map((e, i) => {
                const color = STAGE_COLOR[e.stage] || '#4b5563';
                return (
                    <div key={i} className="aap-tl-event">
                        <div className="aap-tl-dot" style={{ background: color }} />
                        <div className="aap-tl-body">
                            <span className="aap-tl-stage" style={{ color }}>{e.stage}</span>
                            {e.detail && <span className="aap-tl-detail">{e.detail}</span>}
                            <span className="aap-tl-ts">{e.ts ? new Date(e.ts).toLocaleTimeString() : ''}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Repair log ────────────────────────────────────────────────────────────────
function RepairLog({ log }) {
    if (!log?.length) return null;
    return (
        <div className="aap-repair-log">
            <div className="aap-section-label">Repair Log</div>
            {log.map((r, i) => (
                <div key={i} className={`aap-repair-row ${r.ok ? 'aap-repair-row--ok' : 'aap-repair-row--fail'}`}>
                    <span className={`aap-repair-dot ${r.ok ? 'aap-dot--ok' : 'aap-dot--err'}`} />
                    <span className="aap-repair-attempt">Attempt {r.attempt}</span>
                    {r.pipelineId && <span className="aap-repair-pipe">{r.pipelineId.slice(0, 8)}</span>}
                    <span className="aap-repair-reason">{r.reason || (r.ok ? 'repaired' : '')}</span>
                    <span className="aap-repair-ts">{r.ts ? new Date(r.ts).toLocaleTimeString() : ''}</span>
                </div>
            ))}
        </div>
    );
}

// ── Mission detail ────────────────────────────────────────────────────────────
function MissionDetail({ mission, onPause, onResume, onCancel, onRetry, onBack, busy }) {
    if (!mission) return null;

    const canPause   = mission.status === 'running' && !mission.paused;
    const canResume  = mission.status === 'paused';
    const canCancel  = !['completed', 'failed', 'cancelled'].includes(mission.status);
    const canRetry   = ['failed', 'cancelled'].includes(mission.status);
    const isRunning  = mission.status === 'running';

    return (
        <div className="aap-detail">
            <div className="aap-detail-head">
                <button className="aap-back-btn" onClick={onBack}>← Back</button>
                <div className="aap-detail-goal">{mission.goal}</div>
                <StatusBadge status={mission.status} />
            </div>

            {/* Live metrics */}
            <div className="aap-metrics-row">
                <div className="aap-metric">
                    <div className="aap-metric__val aap-metric__val--stage">{mission.currentStage || '—'}</div>
                    <div className="aap-metric__key">Stage</div>
                </div>
                <div className="aap-metric">
                    <div className="aap-metric__val">{mission.repairAttempts}</div>
                    <div className="aap-metric__key">Repairs</div>
                </div>
                <div className="aap-metric">
                    <div className="aap-metric__val">{mission.pipelineCount || 0}</div>
                    <div className="aap-metric__key">Pipelines</div>
                </div>
                <div className="aap-metric">
                    <div className="aap-metric__val">{mission.confidence || '—'}%</div>
                    <div className="aap-metric__key">Confidence</div>
                </div>
                <div className="aap-metric">
                    <div className="aap-metric__val"><Elapsed startedAt={mission.startedAt} completedAt={mission.completedAt} /></div>
                    <div className="aap-metric__key">Elapsed</div>
                </div>
            </div>

            {/* Stage progress bar */}
            <StageProgress currentStage={mission.currentStage} status={mission.status} />

            {/* Error */}
            {mission.error && <div className="aap-error">{mission.error}</div>}

            {/* Repair log */}
            <RepairLog log={mission.repairLog} />

            {/* Full timeline */}
            <div className="aap-section">
                <div className="aap-section-label">Execution Timeline</div>
                <MissionTimeline events={mission.timeline} />
            </div>

            {/* Pipeline ids */}
            {mission.pipelineIds?.length > 0 && (
                <div className="aap-section">
                    <div className="aap-section-label">Pipeline Runs</div>
                    <div className="aap-pipeline-ids">
                        {mission.pipelineIds.map(id => (
                            <span key={id} className="aap-pipeline-id">{id.slice(0, 10)}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="aap-actions">
                {canPause && (
                    <button className="aap-btn aap-btn--pause" disabled={!!busy} onClick={onPause}>
                        ⏸ Pause
                    </button>
                )}
                {canResume && (
                    <button className="aap-btn aap-btn--resume" disabled={!!busy} onClick={onResume}>
                        {busy === 'resume' ? '⟳ Resuming…' : '▶ Resume'}
                    </button>
                )}
                {canRetry && (
                    <button className="aap-btn aap-btn--retry" disabled={!!busy} onClick={onRetry}>
                        {busy === 'retry' ? '⟳ Retrying…' : '↩ Retry'}
                    </button>
                )}
                {canCancel && (
                    <button className="aap-btn aap-btn--cancel" disabled={!!busy} onClick={onCancel}>
                        ✕ Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

// ── Stage progress bar ────────────────────────────────────────────────────────
const ORDERED_STAGES = ['analyze','plan','patch','apply','build_test','commit','learn','complete'];

function StageProgress({ currentStage, status }) {
    const idx = ORDERED_STAGES.indexOf(currentStage);
    return (
        <div className="aap-stage-progress">
            {ORDERED_STAGES.map((s, i) => {
                const done    = status === 'completed' || i < idx;
                const active  = s === currentStage && status === 'running';
                const failed  = status === 'failed' && s === currentStage;
                return (
                    <div key={s} className={`aap-stage-step ${done ? 'aap-step--done' : ''} ${active ? 'aap-step--active' : ''} ${failed ? 'aap-step--fail' : ''}`}>
                        <div className="aap-step-dot" />
                        <div className="aap-step-label">{s.replace('_', ' ')}</div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Mission list item ─────────────────────────────────────────────────────────
function MissionItem({ mission, active, onSelect }) {
    return (
        <div className={`aap-item ${active ? 'aap-item--active' : ''}`} onClick={() => onSelect(mission.agentMissionId)}>
            <div className="aap-item-head">
                <StatusBadge status={mission.status} />
                <span className="aap-item-goal">{mission.goal?.slice(0, 60)}</span>
                {mission.status === 'running' && <span className="aap-pulse" />}
            </div>
            <div className="aap-item-meta">
                <span className="aap-item-stage">{mission.currentStage}</span>
                {mission.repairAttempts > 0 && <span className="aap-item-repairs">⚙ {mission.repairAttempts} repair{mission.repairAttempts > 1 ? 's' : ''}</span>}
                <span className="aap-item-conf">{mission.confidence || 0}% conf</span>
                {mission.startedAt && <Elapsed startedAt={mission.startedAt} completedAt={mission.completedAt} />}
            </div>
        </div>
    );
}

// ── Stats panel ───────────────────────────────────────────────────────────────
function StatsPanel({ stats }) {
    if (!stats) return <div className="aap-empty">No stats yet.</div>;
    return (
        <div className="aap-stats-grid">
            {[
                { l: 'Total Missions',    v: stats.total,               c: '#d1d5db' },
                { l: 'Completed',         v: stats.completed,           c: '#10b981' },
                { l: 'Success Rate',      v: `${stats.successRate || 0}%`,     c: '#10b981' },
                { l: 'Autonomy %',        v: `${stats.autonomyPct || 0}%`,     c: '#60a5fa' },
                { l: 'Repair Success',    v: `${stats.repairSuccessRate || 0}%`,c: '#f59e0b' },
                { l: 'Avg Repairs/Run',   v: stats.avgRepairsPerMission || 0,  c: '#f59e0b' },
                { l: 'Avg Duration',      v: stats.avgDurationMs > 0 ? `${Math.round(stats.avgDurationMs/1000)}s` : '—', c: '#60a5fa' },
                { l: 'Replace Cursor',    v: `${stats.replaceCursorScore || 0}/100`, c: '#f59e0b' },
                { l: 'Build Ooplix',      v: `${stats.buildOoplixScore || 0}/100`,   c: '#10b981' },
            ].map(({ l, v, c }) => (
                <div key={l} className="aap-stats-tile">
                    <div className="aap-stats-val" style={{ color: c }}>{v}</div>
                    <div className="aap-stats-label">{l}</div>
                </div>
            ))}
        </div>
    );
}

// ── Benchmark report ──────────────────────────────────────────────────────────
function BenchmarkReport({ report, onClose }) {
    if (!report) return null;
    return (
        <div className="aap-bench">
            <div className="aap-bench-head">
                <span className="aap-bench-title">ACP-8 Benchmark — 10 Autonomous Scenarios</span>
                <button className="aap-back-btn" onClick={onClose}>← Back</button>
            </div>
            <div className="aap-bench-kpis">
                {[
                    { l: 'Passed',         v: `${report.passed}/${report.total}`, c: '#10b981' },
                    { l: 'Pass Rate',      v: `${report.passRate}%`,              c: '#10b981' },
                    { l: 'Autonomy %',     v: `${report.autonomyPct}%`,           c: '#60a5fa' },
                    { l: 'Repair Success', v: `${report.repairSuccessRate}%`,     c: '#f59e0b' },
                    { l: 'Avg Repairs',    v: report.avgRepairs,                  c: '#f59e0b' },
                    { l: 'Avg Duration',   v: `${Math.round(report.avgDurationMs / 1000)}s`, c: '#60a5fa' },
                    { l: 'Avg Confidence', v: `${report.avgConfidence}%`,         c: '#d1d5db' },
                    { l: 'Replace Cursor', v: `${report.replaceCursorScore}/100`, c: '#f59e0b' },
                    { l: 'Build Ooplix',   v: `${report.buildOoplixScore}/100`,   c: '#10b981' },
                ].map(({ l, v, c }) => (
                    <div key={l} className="aap-bench-kpi">
                        <div className="aap-bench-kpi-val" style={{ color: c }}>{v}</div>
                        <div className="aap-bench-kpi-label">{l}</div>
                    </div>
                ))}
            </div>
            <div className="aap-bench-rows">
                {(report.scenarios || []).map((s, i) => (
                    <div key={i} className={`aap-bench-row ${s.ok ? 'aap-bench-row--ok' : 'aap-bench-row--fail'}`}>
                        <span className="aap-bench-num">#{i + 1}</span>
                        <span className={`aap-bench-dot ${s.ok ? 'aap-dot--ok' : 'aap-dot--err'}`} />
                        <span className="aap-bench-goal">{s.goal}</span>
                        <span className="aap-bench-status">{s.status}</span>
                        <span className="aap-bench-repairs">{s.repairAttempts || 0} repairs</span>
                        {s.confidence ? <span className="aap-bench-conf">{s.confidence}%</span> : null}
                        <span className="aap-bench-ms">{Math.round(s.elapsedMs / 1000)}s</span>
                        {s.error && <span className="aap-bench-err">{s.error?.slice(0, 40)}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AutonomousAgentPanel({ cwd }) {
    const [view,      setView]      = useState('missions'); // missions | detail | stats | bench
    const [missions,  setMissions]  = useState([]);
    const [selected,  setSelected]  = useState(null);
    const [stats,     setStats]     = useState(null);
    const [bench,     setBench]     = useState(null);
    const [busy,      setBusy]      = useState(null);
    const [error,     setError]     = useState(null);
    const [benching,  setBenching]  = useState(false);
    const [composerPlanId, setComposerPlanId] = useState('');
    const [launching, setLaunching] = useState(false);
    const pollRef  = useRef(null);

    const loadMissions = useCallback(async () => {
        try {
            const r = await api('GET', '/autonomous?limit=20');
            if (r?.ok) setMissions(r.missions || []);
        } catch {}
    }, []);

    const loadStats = useCallback(async () => {
        try {
            const r = await api('GET', '/autonomous/stats');
            if (r?.ok) setStats(r.stats);
        } catch {}
    }, []);

    const loadDetail = useCallback(async (id) => {
        try {
            const r = await api('GET', `/autonomous/${id}`);
            if (r?.ok) { setSelected(r.mission); setView('detail'); }
        } catch {}
    }, []);

    // Poll running missions every 3s
    useEffect(() => {
        loadMissions(); loadStats();
        pollRef.current = setInterval(() => {
            loadMissions();
            if (selected?.status === 'running') loadDetail(selected.agentMissionId);
        }, 3000);
        return () => clearInterval(pollRef.current);
    }, [loadMissions, loadStats, loadDetail, selected?.agentMissionId, selected?.status]);

    const launchMission = useCallback(async () => {
        if (!composerPlanId.trim()) return;
        setLaunching(true);
        setError(null);
        try {
            const r = await api('POST', '/autonomous/start', { planId: composerPlanId });
            if (r?.ok) {
                setSelected(r.mission);
                setView('detail');
                setComposerPlanId('');
                loadMissions(); loadStats();
            } else setError(r?.error || 'Launch failed');
        } catch (e) { setError(e.message); }
        finally { setLaunching(false); }
    }, [composerPlanId, loadMissions, loadStats]);

    const doPause = useCallback(async () => {
        if (!selected) return;
        try {
            const r = await api('POST', `/autonomous/${selected.agentMissionId}/pause`);
            if (r?.ok) setSelected(r.mission);
        } catch {}
    }, [selected]);

    const doResume = useCallback(async () => {
        if (!selected) return;
        setBusy('resume');
        try {
            const r = await api('POST', `/autonomous/${selected.agentMissionId}/resume`);
            if (r?.ok) { setSelected(r.mission); loadMissions(); }
        } catch (e) { setError(e.message); }
        finally { setBusy(null); }
    }, [selected, loadMissions]);

    const doCancel = useCallback(async () => {
        if (!selected || !window.confirm('Cancel this mission? Latest bundle will be rolled back.')) return;
        try {
            const r = await api('POST', `/autonomous/${selected.agentMissionId}/cancel`);
            if (r?.ok) { setSelected(r.mission); loadMissions(); }
        } catch {}
    }, [selected, loadMissions]);

    const doRetry = useCallback(async () => {
        if (!selected) return;
        setBusy('retry');
        setError(null);
        try {
            const r = await api('POST', `/autonomous/${selected.agentMissionId}/retry`);
            if (r?.ok) { setSelected(r.mission); loadMissions(); loadStats(); }
            else setError(r?.error);
        } catch (e) { setError(e.message); }
        finally { setBusy(null); }
    }, [selected, loadMissions, loadStats]);

    const runBenchmark = useCallback(async () => {
        setBenching(true);
        setError(null);
        try {
            const r = await api('POST', '/autonomous/benchmark', { cwd });
            if (r?.ok) { setBench(r.report); setView('bench'); loadStats(); }
            else setError(r?.error);
        } catch (e) { setError(e.message); }
        finally { setBenching(false); }
    }, [cwd, loadStats]);

    const runningCount = missions.filter(m => m.status === 'running').length;

    return (
        <div className="aap-root">
            {/* Header */}
            <div className="aap-header">
                <span className="aap-header-title">
                    Autonomous Agent
                    {runningCount > 0 && <span className="aap-running-badge">{runningCount} running</span>}
                </span>
                <div className="aap-header-tabs">
                    {[['missions','Missions'],['stats','Stats'],['bench','Benchmark']].map(([v,l]) => (
                        <button
                            key={v}
                            className={`aap-hdr-tab ${view === v || (v === 'bench' && view === 'bench') ? 'aap-hdr-tab--active' : ''}`}
                            onClick={() => {
                                if (v === 'bench' && !bench) { runBenchmark(); } else setView(v);
                            }}
                        >
                            {v === 'bench' && benching ? '⟳ Running…' : l}
                        </button>
                    ))}
                </div>
            </div>

            {/* Detail */}
            {view === 'detail' && selected && (
                <MissionDetail
                    mission={selected}
                    busy={busy}
                    onBack={() => { setView('missions'); loadMissions(); }}
                    onPause={doPause}
                    onResume={doResume}
                    onCancel={doCancel}
                    onRetry={doRetry}
                />
            )}

            {/* Benchmark */}
            {view === 'bench' && bench && (
                <BenchmarkReport report={bench} onClose={() => setView('missions')} />
            )}

            {/* Missions list */}
            {view === 'missions' && (
                <div className="aap-missions-view">
                    {/* Launch from composer plan */}
                    <div className="aap-launch-row">
                        <div className="aap-launch-label">Launch from Composer Plan ID:</div>
                        <div className="aap-launch-input-row">
                            <input
                                className="aap-plan-id-input"
                                placeholder="comp_… (from Composer tab)"
                                value={composerPlanId}
                                onChange={e => setComposerPlanId(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') launchMission(); }}
                            />
                            <button
                                className="aap-launch-btn"
                                disabled={!composerPlanId.trim() || launching}
                                onClick={launchMission}
                            >
                                {launching ? '⟳ Launching…' : '⚡ Launch Mission'}
                            </button>
                        </div>
                        {error && <div className="aap-error">{error}</div>}
                    </div>

                    <div className="aap-list-scroll">
                        {missions.length === 0 && (
                            <div className="aap-empty">
                                No missions yet. Create a Composer plan and launch it here.
                            </div>
                        )}
                        {missions.map(m => (
                            <MissionItem
                                key={m.agentMissionId}
                                mission={m}
                                active={selected?.agentMissionId === m.agentMissionId}
                                onSelect={loadDetail}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Stats */}
            {view === 'stats' && <StatsPanel stats={stats} />}
        </div>
    );
}
