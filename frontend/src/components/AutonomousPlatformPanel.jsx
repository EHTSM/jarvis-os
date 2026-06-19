import React, { useState, useEffect, useRef } from "react";
import "./AutonomousPlatformPanel.css";

// ── helpers ───────────────────────────────────────────────────────────────────

const API = async (method, path, body) => {
    const r = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return r.json();
};

function formatMs(ms) {
    if (!ms && ms !== 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso) {
    if (!iso) return "—";
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

const RISK_COLOR = { low: "#10b981", medium: "#f59e0b", high: "#ef4444", unknown: "#6b7280" };
const STATUS_COLOR = {
    completed: "#10b981", failed: "#ef4444", running: "#60a5fa",
    partial: "#f59e0b", SUCCESS: "#10b981", FAILED: "#ef4444",
};
const STAGE_COLOR = { ok: "#10b981", failed: "#ef4444", running: "#60a5fa", pending: "#374151" };
const CAT_ICON = {
    bugfix: "🐛", refactor: "♻", feature: "✦", quality: "✎", deployment: "⚡",
    testing: "⚗", performance: "⚡", security: "⛨", docs: "📄", general: "●",
};

// ── Goal input ────────────────────────────────────────────────────────────────

const SAMPLE_GOALS = [
    "Fix duplicate_literal smells across the codebase",
    "Improve the engineering confidence scoring accuracy",
    "Refactor authentication middleware for security hardening",
    "Fix the self-healing system escalation strategy bug",
    "Optimise the engineering pipeline gate execution speed",
];

function GoalInput({ onSubmit, running }) {
    const [goal, setGoal] = useState("");

    const submit = () => {
        if (!goal.trim() || running) return;
        onSubmit(goal.trim());
        setGoal("");
    };

    return (
        <div className="app-goal-input">
            <div className="app-goal-label">ONE GOAL</div>
            <div className="app-goal-row">
                <textarea
                    className="app-goal-textarea"
                    placeholder="Describe your engineering goal…"
                    value={goal}
                    rows={2}
                    onChange={e => setGoal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                />
                <button className="app-run-btn" onClick={submit} disabled={running || !goal.trim()}>
                    {running ? "Running…" : "Run"}
                </button>
            </div>
            <div className="app-samples">
                {SAMPLE_GOALS.map((s, i) => (
                    <button key={i} className="app-sample-btn" onClick={() => setGoal(s)} disabled={running}>
                        {s.slice(0, 48)}…
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Live execution panel ──────────────────────────────────────────────────────

function ExecutionPanel({ run }) {
    if (!run) return null;

    const statusColor = STATUS_COLOR[run.status] || "#6b7280";

    return (
        <div className="app-exec-panel">
            <div className="app-exec-header">
                <span className="app-exec-status" style={{ color: statusColor }}>
                    {run.status === "running" ? "⟳ Running" : run.status === "completed" ? "✓ Completed" : "✗ Failed"}
                </span>
                <span className="app-exec-duration">{formatMs(run.durationMs)}</span>
                <span className="app-exec-risk" style={{ color: RISK_COLOR[run.riskLevel] }}>
                    risk: {run.riskLevel || "?"}
                </span>
                <span className="app-exec-conf">
                    conf: {run.finalConfidence || run.initialConfidence || 0}%
                </span>
                {(run.repairs || 0) > 0 && (
                    <span className="app-exec-repairs">⟲ {run.repairs} repair{run.repairs > 1 ? "s" : ""}</span>
                )}
            </div>
            <div className="app-exec-goal">{run.goal}</div>

            {/* Timeline */}
            <div className="app-timeline">
                {(run.timeline || []).map((t, i) => (
                    <div key={i} className="app-tl-step">
                        <div className="app-tl-dot" style={{ background: STAGE_COLOR[t.status] || "#374151" }} />
                        <div className="app-tl-line" style={{ background: i < run.timeline.length - 1 ? "#1f2937" : "transparent" }} />
                        <div className="app-tl-body">
                            <span className="app-tl-stage">{t.stage}</span>
                            <span className="app-tl-status" style={{ color: STAGE_COLOR[t.status] || "#6b7280" }}>{t.status}</span>
                            {t.detail && <span className="app-tl-detail">{t.detail}</span>}
                            {t.error  && <span className="app-tl-err">{t.error}</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Executive report panel ────────────────────────────────────────────────────

function ExecReport({ report }) {
    if (!report) return null;

    const statusColor = STATUS_COLOR[report.status] || "#6b7280";

    return (
        <div className="app-report">
            <div className="app-report-header">
                <span className="app-report-status" style={{ color: statusColor }}>{report.status}</span>
                <span className="app-report-id">run/{report.runId?.slice(-8)}</span>
                <span className="app-report-ts">{timeAgo(report.generatedAt)}</span>
            </div>

            <div className="app-report-goal">{report.goal}</div>

            <div className="app-report-grid">
                {/* Execution */}
                <div className="app-report-section">
                    <div className="app-section-label">Execution</div>
                    <div className="app-kv-row"><span>Category</span><span>{report.execution?.category}</span></div>
                    <div className="app-kv-row"><span>Duration</span><span>{report.execution?.durationFormatted}</span></div>
                    {report.execution?.pipelineId && (
                        <div className="app-kv-row"><span>Pipeline</span><span className="mono">{report.execution.pipelineId.slice(-12)}</span></div>
                    )}
                    {report.execution?.commitHash && (
                        <div className="app-kv-row"><span>Commit</span><span className="mono">{report.execution.commitHash?.slice(0, 8)}</span></div>
                    )}
                </div>

                {/* Confidence */}
                <div className="app-report-section">
                    <div className="app-section-label">Confidence</div>
                    <div className="app-kv-row"><span>Initial</span><span>{report.confidence?.initial}%</span></div>
                    <div className="app-kv-row"><span>Final</span><span style={{ color: "#10b981" }}>{report.confidence?.final}%</span></div>
                    <div className="app-kv-row">
                        <span>Delta</span>
                        <span style={{ color: (report.confidence?.delta || 0) >= 0 ? "#10b981" : "#ef4444" }}>
                            {(report.confidence?.delta || 0) >= 0 ? "+" : ""}{report.confidence?.delta}%
                        </span>
                    </div>
                </div>

                {/* Risk & repairs */}
                <div className="app-report-section">
                    <div className="app-section-label">Risk</div>
                    <div className="app-kv-row">
                        <span>Level</span>
                        <span style={{ color: RISK_COLOR[report.risk?.level] }}>{report.risk?.level}</span>
                    </div>
                    <div className="app-kv-row"><span>Score</span><span>{report.risk?.score}</span></div>
                    <div className="app-kv-row"><span>Repairs</span><span>{report.risk?.repairs}</span></div>
                </div>

                {/* Quality */}
                <div className="app-report-section">
                    <div className="app-section-label">Quality</div>
                    <div className="app-kv-row"><span>Smells found</span><span>{report.quality?.smellsFound}</span></div>
                    <div className="app-kv-row"><span>Open decisions</span><span>{report.quality?.decisionsOpen}</span></div>
                    <div className="app-kv-row"><span>Active rules</span><span>{report.quality?.rulesActive}</span></div>
                </div>

                {/* Learning */}
                <div className="app-report-section">
                    <div className="app-section-label">Learning</div>
                    <div className="app-kv-row"><span>Lessons created</span><span style={{ color: "#10b981" }}>{report.learning?.lessonsCreated}</span></div>
                    <div className="app-kv-row"><span>Rules extracted</span><span>{report.learning?.rulesExtracted}</span></div>
                    <div className="app-kv-row"><span>KG indexed</span><span>{report.learning?.kgIndexed ? "✓" : "—"}</span></div>
                    <div className="app-kv-row"><span>Total knowledge</span><span>{report.learning?.totalKnowledge}</span></div>
                </div>

                {/* Improvement */}
                <div className="app-report-section">
                    <div className="app-section-label">Improvement</div>
                    <div className="app-kv-row"><span>Velocity</span><span>{report.improvement?.learningVelocity}/wk</span></div>
                    <div className="app-kv-row"><span>Maturity</span><span>{report.improvement?.engineeringMaturity}%</span></div>
                    <div className="app-kv-row"><span>Knowledge</span><span>{report.improvement?.knowledgeGrowth}</span></div>
                </div>
            </div>

            {/* Pipeline stages */}
            {report.pipeline?.stages?.length > 0 && (
                <div className="app-report-pipeline">
                    <div className="app-section-label">Pipeline Stages</div>
                    <div className="app-pipe-stages">
                        {report.pipeline.stages.map((s, i) => (
                            <div key={i} className="app-pipe-stage">
                                <span className="app-pipe-dot" style={{ background: STAGE_COLOR[s.status] || "#374151" }} />
                                <span className="app-pipe-name">{s.id}</span>
                                <span className="app-pipe-status" style={{ color: STAGE_COLOR[s.status] || "#6b7280" }}>{s.status}</span>
                                {s.durationMs && <span className="app-pipe-ms">{formatMs(s.durationMs)}</span>}
                            </div>
                        ))}
                    </div>
                    {report.pipeline.rollback && (
                        <div className="app-rollback-badge">⚠ Auto-rolled back</div>
                    )}
                </div>
            )}

            {/* Future recommendations */}
            {report.futureRecommendations?.length > 0 && (
                <div className="app-report-recs">
                    <div className="app-section-label">Future Recommendations</div>
                    {report.futureRecommendations.map((r, i) => (
                        <div key={i} className="app-rec-row">
                            <span className="app-rec-src">{r.source?.replace(/_/g, " ")}</span>
                            <span className="app-rec-text">{r.recommendation?.slice?.(0, 120) || String(r.recommendation)?.slice(0, 120)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Run history ───────────────────────────────────────────────────────────────

function RunHistory({ runs, stats, onSelect, selectedRunId }) {
    if (!runs?.length) return <div className="app-empty">No runs yet — submit a goal above</div>;

    return (
        <div className="app-history">
            <div className="app-history-stats">
                {[
                    { k: "Total", v: stats?.total || 0 },
                    { k: "Succeeded", v: stats?.succeeded || 0, c: "#10b981" },
                    { k: "Failed", v: stats?.failed || 0, c: "#ef4444" },
                    { k: "Repaired", v: stats?.repaired || 0, c: "#f59e0b" },
                    { k: "Avg Conf", v: `${stats?.avgConfidence || 0}%`, c: "#60a5fa" },
                    { k: "Total Repairs", v: stats?.totalRepairs || 0, c: "#a78bfa" },
                ].map(s => (
                    <div key={s.k} className="app-hist-stat">
                        <div className="app-hist-val" style={{ color: s.c || "#f1f5f9" }}>{s.v}</div>
                        <div className="app-hist-key">{s.k}</div>
                    </div>
                ))}
            </div>

            <div className="app-run-list">
                {runs.map(r => (
                    <div
                        key={r.runId}
                        className={`app-run-row ${selectedRunId === r.runId ? "app-run-row--selected" : ""}`}
                        onClick={() => onSelect(r)}
                    >
                        <span className="app-run-dot" style={{ background: STATUS_COLOR[r.status] || "#6b7280" }} />
                        <span className="app-run-cat">{CAT_ICON[r.classification?.category] || "●"}</span>
                        <span className="app-run-goal">{r.goal?.slice(0, 60)}</span>
                        <span className="app-run-status" style={{ color: STATUS_COLOR[r.status] || "#6b7280" }}>{r.status}</span>
                        <span className="app-run-conf">{r.finalConfidence || 0}%</span>
                        {(r.repairs || 0) > 0 && <span className="app-run-repairs">⟲{r.repairs}</span>}
                        <span className="app-run-dur">{formatMs(r.durationMs)}</span>
                        <span className="app-run-ts">{timeAgo(r.startedAt)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Benchmark view ────────────────────────────────────────────────────────────

function BenchmarkView() {
    const [result, setResult]   = useState(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        try { const r = await API("POST", "/platform/benchmark", {}); setResult(r.benchmark); }
        catch {}
        setRunning(false);
    };

    return (
        <div className="app-bench">
            <div className="app-bench-head">
                <span className="app-bench-title">ACP-12 Benchmark — 10 Engineering Goals</span>
                <button className="app-run-btn" onClick={run} disabled={running}>
                    {running ? "Running…" : "Run Benchmark"}
                </button>
            </div>

            {!result && !running && <div className="app-empty" style={{ marginTop: 24 }}>Run the benchmark to validate all 10 autonomous engineering scenarios</div>}

            {result && (
                <>
                    <div className="app-bench-kpis">
                        {[
                            { k: "Passed",     v: `${result.passed}/${result.total}`, c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Pass Rate",  v: `${result.passRate}%`,              c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Duration",   v: formatMs(result.totalMs),           c: "#60a5fa" },
                            { k: "Audit",      v: `${result.audit?.passRate}%`,       c: "#a78bfa" },
                        ].map(kpi => (
                            <div key={kpi.k} className="app-bench-kpi">
                                <div className="app-bench-kpi-val" style={{ color: kpi.c }}>{kpi.v}</div>
                                <div className="app-bench-kpi-lbl">{kpi.k}</div>
                            </div>
                        ))}
                    </div>

                    <div className="app-bench-scenarios">
                        {(result.scenarios || []).map((s, i) => (
                            <div key={i} className={`app-bench-row ${s.ok ? "" : "app-bench-row--fail"}`}>
                                <span className="app-bench-num">{i + 1}.</span>
                                <span className="app-bench-dot" style={{ background: s.ok ? "#10b981" : "#ef4444" }} />
                                <span className="app-bench-goal">{s.goal}</span>
                                {s.ok && (
                                    <span className="app-bench-meta">
                                        {s.category} · risk:{s.riskLevel} · conf:{s.confidence}%
                                    </span>
                                )}
                                {s.error && <span className="app-bench-err">{s.error}</span>}
                                <span className="app-bench-ms">{formatMs(s.elapsedMs)}</span>
                            </div>
                        ))}
                    </div>

                    {/* Architecture audit */}
                    <div className="app-audit">
                        <div className="app-audit-head">
                            Architecture Audit — {result.audit?.passed}/{result.audit?.total} checks passed ({result.audit?.passRate}%)
                        </div>
                        <div className="app-audit-grid">
                            {(result.audit?.checks || []).map((c, i) => (
                                <div key={i} className={`app-audit-row ${c.pass ? "" : "app-audit-row--fail"}`}>
                                    <span className="app-audit-dot" style={{ background: c.pass ? "#10b981" : "#ef4444" }} />
                                    <span className="app-audit-name">{c.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const VIEWS = ["dashboard", "history", "benchmark"];
const VIEW_LABELS = { dashboard: "Dashboard", history: "History", benchmark: "Benchmark" };

export default function AutonomousPlatformPanel() {
    const [view,         setView]         = useState("dashboard");
    const [running,      setRunning]      = useState(false);
    const [currentRun,   setCurrentRun]   = useState(null);
    const [selectedRun,  setSelectedRun]  = useState(null);
    const [histData,     setHistData]     = useState({ runs: [], stats: {} });
    const pollRef = useRef(null);

    const loadHistory = async () => {
        try { const r = await API("GET", "/platform/runs?limit=30"); if (r.ok) setHistData({ runs: r.runs, stats: r.stats }); }
        catch {}
    };

    useEffect(() => { loadHistory(); }, []);

    const handleSubmit = async (goal) => {
        setRunning(true);
        setCurrentRun({ goal, status: "running", timeline: [], startedAt: new Date().toISOString() });
        setView("dashboard");

        try {
            const r = await API("POST", "/platform/run", { goal });
            setCurrentRun(r);
            await loadHistory();
        } catch (e) {
            setCurrentRun(prev => ({ ...prev, status: "failed", error: e.message }));
        }
        setRunning(false);
    };

    const handleSelectRun = (run) => {
        setSelectedRun(run);
        setView("dashboard");
    };

    const displayRun  = selectedRun || currentRun;
    const displayReport = displayRun?.report || null;

    return (
        <div className="app-root">
            <div className="app-header">
                <span className="app-header-title">
                    <span className="app-header-icon">◈</span> AUTONOMOUS ENGINEERING PLATFORM
                </span>
                <div className="app-header-tabs">
                    {VIEWS.map(v => (
                        <button key={v}
                            className={`app-hdr-tab ${view === v ? "app-hdr-tab--active" : ""}`}
                            onClick={() => { setView(v); if (v === "history") loadHistory(); }}>
                            {VIEW_LABELS[v]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="app-content">
                {view === "dashboard" && (
                    <div className="app-dashboard">
                        <GoalInput onSubmit={handleSubmit} running={running} />

                        {displayRun && (
                            <div className="app-dashboard-cols">
                                <div className="app-dashboard-left">
                                    <ExecutionPanel run={displayRun} />
                                </div>
                                <div className="app-dashboard-right">
                                    {displayReport && <ExecReport report={displayReport} />}
                                </div>
                            </div>
                        )}

                        {!displayRun && (
                            <div className="app-dashboard-empty">
                                <div className="app-empty-icon">◈</div>
                                <div className="app-empty-title">Autonomous Engineering Platform</div>
                                <div className="app-empty-sub">
                                    Enter a goal above to trigger the full ACP pipeline:<br />
                                    Analyze → Context → Plan → Execute → Monitor → Repair → Learn → Report
                                </div>
                                {histData.stats?.total > 0 && (
                                    <div className="app-empty-meta">
                                        {histData.stats.total} runs · {histData.stats.succeeded} succeeded · {histData.stats.totalRepairs} total repairs
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {view === "history" && (
                    <div className="app-history-view">
                        <RunHistory
                            runs={histData.runs}
                            stats={histData.stats}
                            onSelect={handleSelectRun}
                            selectedRunId={selectedRun?.runId}
                        />
                        {selectedRun?.report && (
                            <div className="app-selected-report">
                                <div className="app-section-label" style={{ marginBottom: 10 }}>Selected Run Report</div>
                                <ExecReport report={selectedRun.report} />
                            </div>
                        )}
                    </div>
                )}

                {view === "benchmark" && <BenchmarkView />}
            </div>
        </div>
    );
}
