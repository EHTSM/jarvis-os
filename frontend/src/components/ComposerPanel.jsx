import React, { useState, useEffect, useCallback, useRef } from 'react';
import { _fetch } from '../_client';
import './ComposerPanel.css';

async function api(method, path, body) {
    return _fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
}

// ── Status meta ───────────────────────────────────────────────────────────────
const STATUS_META = {
    composing:        { color: '#f59e0b', label: 'Composing'        },
    pending_approval: { color: '#60a5fa', label: 'Pending Approval' },
    auto_approved:    { color: '#34d399', label: 'Auto-Approved'    },
    approved:         { color: '#10b981', label: 'Approved'         },
    rejected:         { color: '#f87171', label: 'Rejected'         },
    executing:        { color: '#a78bfa', label: 'Executing'        },
    failed:           { color: '#ef4444', label: 'Failed'           },
    cancelled:        { color: '#6b7280', label: 'Cancelled'        },
};

const RISK_META = {
    low:    { color: '#10b981' },
    medium: { color: '#f59e0b' },
    high:   { color: '#ef4444' },
};

function StatusBadge({ status }) {
    const m = STATUS_META[status] || { color: '#6b7280', label: status || '?' };
    return <span className="cp-badge" style={{ color: m.color, borderColor: m.color }}>{m.label}</span>;
}

function ConfBar({ score }) {
    const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
    return (
        <div className="cp-confbar">
            <div className="cp-confbar__fill" style={{ width: `${score}%`, background: color }} />
            <span className="cp-confbar__label" style={{ color }}>{score}%</span>
        </div>
    );
}

// ── Goal examples ─────────────────────────────────────────────────────────────
const EXAMPLES = [
    "Fix login performance",
    "Remove dead code",
    "Improve auth security",
    "Reduce bundle size",
    "Add input validation",
    "Improve logging",
    "Fix flaky tests",
    "Refactor CRM module",
    "Improve deployment pipeline",
    "Optimize API endpoints",
];

// ── Timeline ──────────────────────────────────────────────────────────────────
function Timeline({ events }) {
    if (!events?.length) return null;
    return (
        <div className="cp-timeline">
            {events.map((e, i) => (
                <div key={i} className="cp-timeline__event">
                    <div className="cp-timeline__dot" />
                    <div className="cp-timeline__body">
                        <span className="cp-timeline__stage">{e.stage}</span>
                        {e.detail && <span className="cp-timeline__detail">{e.detail}</span>}
                        <span className="cp-timeline__ts">{e.ts ? new Date(e.ts).toLocaleTimeString() : ''}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Pipeline status poller ────────────────────────────────────────────────────
function PipelineTracker({ pipelineId }) {
    const [run, setRun] = useState(null);
    useEffect(() => {
        if (!pipelineId) return;
        let active = true;
        const poll = async () => {
            try {
                const r = await api('GET', `/pipeline/${pipelineId}`);
                if (r?.run) {
                    setRun(r.run);
                    if (['completed', 'failed', 'cancelled'].includes(r.run.status)) return;
                }
            } catch {}
            if (active) setTimeout(poll, 2500);
        };
        poll();
        return () => { active = false; };
    }, [pipelineId]);
    if (!run) return null;
    const color = run.status === 'completed' ? '#10b981' : run.status === 'failed' ? '#ef4444' : '#f59e0b';
    return (
        <div className="cp-pipeline" style={{ borderColor: color }}>
            <span className="cp-pipeline__label">I7 Pipeline</span>
            <span style={{ color, fontWeight: 700 }}>{run.status}</span>
            <span className="cp-pipeline__id">{pipelineId.slice(0, 10)}</span>
        </div>
    );
}

// ── Bundle files list ─────────────────────────────────────────────────────────
function BundleFiles({ files }) {
    if (!files?.length) return null;
    const ROLE_COLOR = { primary: '#f59e0b', affected: '#60a5fa', test: '#10b981', docs: '#a78bfa', changelog: '#6b7280' };
    return (
        <div className="cp-bundle-files">
            {files.map((f, i) => (
                <div key={i} className="cp-bundle-file">
                    <span className={`cp-bundle-file__dot ${f.valid ? 'cp-dot--ok' : 'cp-dot--err'}`} />
                    <span className="cp-bundle-file__path">{f.path}</span>
                    <span className="cp-bundle-file__role" style={{ color: ROLE_COLOR[f.role] || '#4b5563' }}>{f.role}</span>
                    <span className="cp-bundle-file__conf">{Math.round((f.confidence || 0) * 100)}%</span>
                </div>
            ))}
        </div>
    );
}

// ── Plan detail view ──────────────────────────────────────────────────────────
function PlanDetail({ plan, onApprove, onReject, onExecute, onCancel, onBack, busy }) {
    const [rejectReason, setRejectReason] = useState('');
    const [showReject, setShowReject]     = useState(false);

    if (!plan) return null;

    const canApprove  = ['pending_approval', 'auto_approved', 'rejected'].includes(plan.status);
    const canReject   = ['pending_approval', 'auto_approved'].includes(plan.status);
    const canExecute  = ['approved', 'auto_approved'].includes(plan.status);
    const canCancel   = !['executed', 'failed', 'cancelled', 'composing'].includes(plan.status);

    return (
        <div className="cp-detail">
            <div className="cp-detail__head">
                <button className="cp-back-btn" onClick={onBack}>← Back</button>
                <div className="cp-detail__goal">{plan.goal}</div>
                <StatusBadge status={plan.status} />
            </div>

            {/* Key metrics */}
            <div className="cp-metrics-row">
                <div className="cp-metric">
                    <span className="cp-metric__val">{plan.confidence?.score || '—'}%</span>
                    <span className="cp-metric__key">Confidence</span>
                </div>
                <div className="cp-metric">
                    <span className="cp-metric__val" style={{ color: RISK_META[plan.risk?.riskLevel]?.color }}>
                        {plan.risk?.riskLevel || '—'}
                    </span>
                    <span className="cp-metric__key">Risk</span>
                </div>
                <div className="cp-metric">
                    <span className="cp-metric__val">{plan.bundle?.metrics?.filesTouched || 0}</span>
                    <span className="cp-metric__key">Files</span>
                </div>
                <div className="cp-metric">
                    <span className="cp-metric__val">{plan.estimatedDuration || '—'}</span>
                    <span className="cp-metric__key">Est. Time</span>
                </div>
                <div className="cp-metric">
                    <span className="cp-metric__val">{plan.classification?.category || '—'}</span>
                    <span className="cp-metric__key">Category</span>
                </div>
            </div>

            {plan.confidence?.score && <ConfBar score={plan.confidence.score} />}

            {/* AI plan summary */}
            {plan.aiPlan && (
                <div className="cp-section">
                    <div className="cp-section__label">Plan Summary</div>
                    <div className="cp-section__text">{plan.aiPlan.summary}</div>
                    {plan.aiPlan.strategy && (
                        <div className="cp-section__sub">{plan.aiPlan.strategy}</div>
                    )}
                </div>
            )}

            {/* Pipeline stages */}
            {plan.aiPlan?.pipelineStages?.length > 0 && (
                <div className="cp-section">
                    <div className="cp-section__label">Pipeline Stages</div>
                    <div className="cp-stages">
                        {plan.aiPlan.pipelineStages.map((s, i) => (
                            <span key={i} className="cp-stage">{s}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Success criteria */}
            {plan.aiPlan?.successCriteria?.length > 0 && (
                <div className="cp-section">
                    <div className="cp-section__label">Success Criteria</div>
                    <ul className="cp-list">
                        {plan.aiPlan.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                </div>
            )}

            {/* Key risks */}
            {plan.aiPlan?.keyRisks?.length > 0 && (
                <div className="cp-section">
                    <div className="cp-section__label">Key Risks</div>
                    <ul className="cp-list cp-list--risk">
                        {plan.aiPlan.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                </div>
            )}

            {/* Affected files */}
            {plan.bundle?.files?.length > 0 && (
                <div className="cp-section">
                    <div className="cp-section__label">
                        Affected Files ({plan.bundle.files.length})
                        {plan.bundle.metrics && (
                            <span className="cp-section__meta">
                                {plan.bundle.metrics.patchesValid} valid · {plan.bundle.metrics.patchesInvalid || 0} invalid · {plan.bundle.metrics.depConfidence}% dep conf
                            </span>
                        )}
                    </div>
                    <BundleFiles files={plan.bundle.files} />
                </div>
            )}

            {/* Apply order */}
            {plan.bundle?.applyOrder?.length > 0 && (
                <div className="cp-section">
                    <div className="cp-section__label">Apply Order</div>
                    <div className="cp-apply-order">
                        {plan.bundle.applyOrder.map((p, i) => (
                            <span key={p}>
                                {i > 0 && <span className="cp-arrow">→</span>}
                                <span className="cp-apply-file">{p.split('/').pop()}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Mission link */}
            {plan.missionId && (
                <div className="cp-section">
                    <div className="cp-section__label">Mission</div>
                    <span className="cp-mission-id">{plan.missionId}</span>
                </div>
            )}

            {/* Rollback indicator */}
            {plan.aiPlan?.rollbackAvailable && (
                <div className="cp-rollback-note">↩ Rollback bundle available</div>
            )}

            {/* Pipeline tracker */}
            {plan.pipelineId && <PipelineTracker pipelineId={plan.pipelineId} />}

            {/* Bundle result */}
            {plan.bundleResult && (
                <div className="cp-bundle-result">
                    <div className="cp-bundle-result__head">
                        ✓ Applied {plan.bundleResult.applied?.length || 0} file(s)
                    </div>
                    {plan.bundleResult.changelog && (
                        <div className="cp-bundle-result__log">{plan.bundleResult.changelog}</div>
                    )}
                </div>
            )}

            {/* Error */}
            {plan.error && (
                <div className="cp-error">{plan.error}</div>
            )}

            {/* Timeline */}
            <div className="cp-section">
                <div className="cp-section__label">Execution Timeline</div>
                <Timeline events={plan.timeline} />
            </div>

            {/* Actions */}
            <div className="cp-actions">
                {canApprove && (
                    <button className="cp-btn cp-btn--approve" disabled={busy} onClick={onApprove}>
                        {busy === 'approve' ? '…' : '✓ Approve'}
                    </button>
                )}
                {canExecute && (
                    <button className="cp-btn cp-btn--execute" disabled={busy} onClick={onExecute}>
                        {busy === 'execute' ? '⟳ Executing…' : '⚡ Execute Plan'}
                    </button>
                )}
                {canReject && !showReject && (
                    <button className="cp-btn cp-btn--reject" disabled={!!busy} onClick={() => setShowReject(true)}>
                        ✕ Reject
                    </button>
                )}
                {showReject && (
                    <div className="cp-reject-row">
                        <input
                            className="cp-reject-input"
                            placeholder="Rejection reason (optional)"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                        />
                        <button className="cp-btn cp-btn--reject" onClick={() => { onReject(rejectReason); setShowReject(false); }}>Confirm Reject</button>
                        <button className="cp-btn cp-btn--cancel-sm" onClick={() => setShowReject(false)}>Cancel</button>
                    </div>
                )}
                {canCancel && (
                    <button className="cp-btn cp-btn--cancel" disabled={!!busy} onClick={onCancel}>
                        ✕ Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

// ── Plan list item ────────────────────────────────────────────────────────────
function PlanItem({ plan, active, onSelect }) {
    return (
        <div className={`cp-item ${active ? 'cp-item--active' : ''}`} onClick={() => onSelect(plan.planId)}>
            <div className="cp-item__head">
                <StatusBadge status={plan.status} />
                <span className="cp-item__goal">{plan.goal?.slice(0, 60)}</span>
            </div>
            <div className="cp-item__meta">
                <span>{plan.category || 'general'}</span>
                {plan.confidence && <><span>·</span><span>{plan.confidence}% conf</span></>}
                {plan.riskLevel  && <><span>·</span><span style={{ color: RISK_META[plan.riskLevel]?.color }}>{plan.riskLevel}</span></>}
                {plan.filesAffected > 0 && <><span>·</span><span>{plan.filesAffected} files</span></>}
                <span className="cp-item__ts">{plan.createdAt ? new Date(plan.createdAt).toLocaleTimeString() : ''}</span>
            </div>
        </div>
    );
}

// ── Benchmark report ─────────────────────────────────────────────────────────
function BenchmarkReport({ report, onClose }) {
    if (!report) return null;
    return (
        <div className="cp-bench">
            <div className="cp-bench__head">
                <span className="cp-bench__title">Benchmark Report</span>
                <button className="cp-back-btn" onClick={onClose}>← Back</button>
            </div>
            <div className="cp-bench__kpis">
                {[
                    { l: 'Passed',        v: `${report.passed}/${report.total}`, c: '#10b981' },
                    { l: 'Pass Rate',     v: `${report.passRate}%`,              c: '#10b981' },
                    { l: 'Avg Conf',      v: `${report.avgConfidence}%`,         c: '#f59e0b' },
                    { l: 'Avg Latency',   v: `${report.avgElapsedMs}ms`,         c: '#60a5fa' },
                    { l: 'Replace Cursor',v: `${report.replaceCursorScore}/100`, c: '#f59e0b' },
                    { l: 'Build Ooplix', v: `${report.buildOoplixScore}/100`,    c: '#10b981' },
                ].map(({ l, v, c }) => (
                    <div key={l} className="cp-bench__kpi">
                        <div className="cp-bench__kpi-val" style={{ color: c }}>{v}</div>
                        <div className="cp-bench__kpi-label">{l}</div>
                    </div>
                ))}
            </div>
            <div className="cp-bench__scenarios">
                {(report.scenarios || []).map((s, i) => (
                    <div key={i} className={`cp-bench__row ${s.ok ? 'cp-bench__row--ok' : 'cp-bench__row--fail'}`}>
                        <span className="cp-bench__num">#{i + 1}</span>
                        <span className={`cp-bench__indicator ${s.ok ? 'cp-dot--ok' : 'cp-dot--err'}`} />
                        <span className="cp-bench__scenario">{s.scenario}</span>
                        <span className="cp-bench__cat">{s.category || '—'}</span>
                        {s.confidence ? <span className="cp-bench__conf">{s.confidence}%</span> : <span />}
                        <span className="cp-bench__ms">{s.elapsed}ms</span>
                        {s.error && <span className="cp-bench__err">{s.error.slice(0, 40)}</span>}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Stats panel ───────────────────────────────────────────────────────────────
function StatsPanel({ stats }) {
    if (!stats) return <div className="cp-empty">No stats yet.</div>;
    return (
        <div className="cp-stats-grid">
            {[
                { l: 'Total Plans',      v: stats.total,               c: '#d1d5db' },
                { l: 'Executed',         v: stats.executed || 0,       c: '#10b981' },
                { l: 'Success Rate',     v: `${stats.successRate || 0}%`, c: '#10b981' },
                { l: 'Avg Confidence',   v: `${stats.avgConfidence || 0}%`, c: '#f59e0b' },
                { l: 'Avg Files/Plan',   v: stats.avgFilesPerPlan || 0, c: '#60a5fa' },
                { l: 'Cancelled',        v: stats.cancelled || 0,      c: '#6b7280' },
                { l: 'Replace Cursor',   v: `${stats.replaceCursorScore || 0}/100`, c: '#f59e0b' },
                { l: 'Build Ooplix',     v: `${stats.buildOoplixScore || 0}/100`,   c: '#10b981' },
            ].map(({ l, v, c }) => (
                <div key={l} className="cp-stats-tile">
                    <div className="cp-stats-tile__val" style={{ color: c }}>{v}</div>
                    <div className="cp-stats-tile__label">{l}</div>
                </div>
            ))}
        </div>
    );
}

// ── Main ComposerPanel ────────────────────────────────────────────────────────
export default function ComposerPanel({ cwd }) {
    const [view,      setView]      = useState('compose'); // compose | plans | stats | bench
    const [goal,      setGoal]      = useState('');
    const [composing, setComposing] = useState(false);
    const [plans,     setPlans]     = useState([]);
    const [stats,     setStats]     = useState(null);
    const [selected,  setSelected]  = useState(null);  // plan object
    const [busy,      setBusy]      = useState(null);   // 'approve'|'execute'|...
    const [error,     setError]     = useState(null);
    const [bench,     setBench]     = useState(null);
    const [benching,  setBenching]  = useState(false);
    const goalRef = useRef(null);

    const loadPlans = useCallback(async () => {
        try {
            const r = await api('GET', '/composer?limit=20');
            if (r?.ok) setPlans(r.plans || []);
        } catch {}
    }, []);

    const loadStats = useCallback(async () => {
        try {
            const r = await api('GET', '/composer/stats');
            if (r?.ok) setStats(r.stats);
        } catch {}
    }, []);

    useEffect(() => { loadPlans(); loadStats(); }, [loadPlans, loadStats]);

    const compose = useCallback(async () => {
        if (!goal.trim()) return;
        setComposing(true);
        setError(null);
        try {
            const r = await api('POST', '/composer/create', { goal, cwd });
            if (r?.ok) {
                setSelected(r.plan);
                setView('detail');
                loadPlans();
                loadStats();
            } else setError(r?.error || 'Compose failed');
        } catch (e) { setError(e.message); }
        finally { setComposing(false); }
    }, [goal, cwd, loadPlans, loadStats]);

    const loadDetail = useCallback(async (planId) => {
        try {
            const r = await api('GET', `/composer/${planId}`);
            if (r?.ok) { setSelected(r.plan); setView('detail'); }
        } catch {}
    }, []);

    const doApprove = useCallback(async () => {
        if (!selected) return;
        setBusy('approve');
        try {
            const r = await api('POST', `/composer/${selected.planId}/approve`);
            if (r?.ok) { setSelected(r.plan); loadPlans(); }
            else setError(r?.error);
        } catch (e) { setError(e.message); }
        finally { setBusy(null); }
    }, [selected, loadPlans]);

    const doReject = useCallback(async (reason) => {
        if (!selected) return;
        try {
            const r = await api('POST', `/composer/${selected.planId}/reject`, { reason });
            if (r?.ok) { setSelected(r.plan); loadPlans(); }
        } catch {}
    }, [selected, loadPlans]);

    const doExecute = useCallback(async () => {
        if (!selected) return;
        setBusy('execute');
        setError(null);
        try {
            const r = await api('POST', `/composer/${selected.planId}/execute`);
            if (r?.ok) {
                setSelected(r.plan);
                loadPlans();
                loadStats();
            } else setError(r?.error || 'Execution failed');
        } catch (e) { setError(e.message); }
        finally { setBusy(null); }
    }, [selected, loadPlans, loadStats]);

    const doCancel = useCallback(async () => {
        if (!selected || !window.confirm('Cancel this plan?')) return;
        try {
            const r = await api('POST', `/composer/${selected.planId}/cancel`);
            if (r?.ok) { setSelected(r.plan); loadPlans(); }
        } catch {}
    }, [selected, loadPlans]);

    const runBenchmark = useCallback(async () => {
        setBenching(true);
        try {
            const r = await api('POST', '/composer/benchmark', { cwd });
            if (r?.ok) { setBench(r.report); setView('bench'); }
            else setError(r?.error);
        } catch (e) { setError(e.message); }
        finally { setBenching(false); }
    }, [cwd]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="cp-root">
            {/* Header */}
            <div className="cp-header">
                <span className="cp-header__title">AI Composer</span>
                <div className="cp-header__tabs">
                    {[['compose','Compose'],['plans','Plans'],['stats','Stats'],['bench','Benchmark']].map(([v,l]) => (
                        <button
                            key={v}
                            className={`cp-hdr-tab ${view === v || (v === 'bench' && view === 'bench') ? 'cp-hdr-tab--active' : ''}`}
                            onClick={() => {
                                if (v === 'bench' && !bench) { runBenchmark(); } else setView(v);
                            }}
                        >
                            {v === 'bench' && benching ? '⟳ Running…' : l}
                        </button>
                    ))}
                </div>
            </div>

            {/* Detail view */}
            {view === 'detail' && selected && (
                <PlanDetail
                    plan={selected}
                    busy={busy}
                    onBack={() => { setView('plans'); loadPlans(); }}
                    onApprove={doApprove}
                    onReject={doReject}
                    onExecute={doExecute}
                    onCancel={doCancel}
                />
            )}

            {/* Benchmark */}
            {view === 'bench' && bench && (
                <BenchmarkReport report={bench} onClose={() => setView('compose')} />
            )}

            {/* Compose */}
            {view === 'compose' && (
                <div className="cp-compose">
                    <div className="cp-tagline">
                        One natural-language goal → Full engineering execution plan
                    </div>
                    <div className="cp-flow">
                        {['Repo Analysis','Smell Scan','Decision Engine','Bundle Plan','Confidence','Approval','Execute','Learn'].map((s, i, arr) => (
                            <React.Fragment key={s}>
                                <span className="cp-flow__step">{s}</span>
                                {i < arr.length - 1 && <span className="cp-flow__arrow">→</span>}
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="cp-examples-row">
                        <span className="cp-examples-label">Try:</span>
                        {EXAMPLES.slice(0, 5).map(ex => (
                            <button key={ex} className="cp-example-btn" onClick={() => setGoal(ex)}>
                                {ex}
                            </button>
                        ))}
                    </div>

                    <div className="cp-input-row">
                        <textarea
                            ref={goalRef}
                            className="cp-goal-input"
                            placeholder="Describe your engineering goal…  (⌘↵ to compose)"
                            value={goal}
                            rows={3}
                            onChange={e => setGoal(e.target.value)}
                            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') compose(); }}
                        />
                        <button
                            className="cp-compose-btn"
                            disabled={!goal.trim() || composing}
                            onClick={compose}
                        >
                            {composing ? '⟳ Composing…' : '⚡ Compose Plan'}
                        </button>
                    </div>

                    {error && <div className="cp-error">{error}</div>}

                    {/* Recent plans */}
                    {plans.length > 0 && (
                        <div className="cp-recent">
                            <div className="cp-recent__label">Recent Plans</div>
                            {plans.slice(0, 5).map(p => (
                                <PlanItem key={p.planId} plan={p} active={false} onSelect={loadDetail} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Plans list */}
            {view === 'plans' && (
                <div className="cp-plans-list">
                    {plans.length === 0 && <div className="cp-empty">No plans yet. Use Compose to create your first plan.</div>}
                    {plans.map(p => (
                        <PlanItem key={p.planId} plan={p} active={selected?.planId === p.planId} onSelect={loadDetail} />
                    ))}
                </div>
            )}

            {/* Stats */}
            {view === 'stats' && <StatsPanel stats={stats} />}
        </div>
    );
}
