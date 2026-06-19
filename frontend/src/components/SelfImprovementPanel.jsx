import React, { useState, useEffect, useCallback } from "react";
import "./SelfImprovementPanel.css";

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
    if (!ms) return "—";
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

function confColor(c) {
    if (c >= 85) return "#10b981";
    if (c >= 65) return "#f59e0b";
    return "#ef4444";
}

function priColor(p) {
    const m = { high: "#ef4444", medium: "#f59e0b", low: "#6b7280" };
    return m[p] || "#6b7280";
}

const PATTERN_COLORS = {
    recurring_smell:         "#a78bfa",
    recurring_rca:           "#ef4444",
    recurring_failure_phase: "#f59e0b",
    high_success_run_type:   "#10b981",
    low_success_run_type:    "#ef4444",
    high_rollback_file:      "#fb923c",
    prolific_lesson_source:  "#60a5fa",
};

const ACTION_LABELS = {
    create_rule:      "Create Rule",
    promote_fix:      "Promote Fix",
    promote_strategy: "Promote Strategy",
    retire_strategy:  "Retire",
    add_caution:      "Add Caution",
    add_gate:         "Add Gate",
    increase_weight:  "Increase Weight",
};

// ── Score gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ value, label, color }) {
    const pct    = Math.min(100, Math.max(0, value));
    const radius = 28;
    const circ   = 2 * Math.PI * radius;
    const dash   = (pct / 100) * circ;

    return (
        <div className="sip-gauge">
            <svg width={70} height={70} viewBox="0 0 70 70">
                <circle cx={35} cy={35} r={radius} fill="none" stroke="#1f2937" strokeWidth={6} />
                <circle cx={35} cy={35} r={radius} fill="none" stroke={color} strokeWidth={6}
                    strokeDasharray={`${dash} ${circ - dash}`}
                    strokeDashoffset={circ * 0.25}
                    strokeLinecap="round" />
                <text x={35} y={39} textAnchor="middle" fill={color} fontSize={13} fontWeight={700}>
                    {value}
                </text>
            </svg>
            <div className="sip-gauge-label">{label}</div>
        </div>
    );
}

// ── Pattern card ─────────────────────────────────────────────────────────────

function PatternCard({ pattern, onPromote }) {
    const color = PATTERN_COLORS[pattern.type] || "#6b7280";
    return (
        <div className="sip-pattern-card">
            <div className="sip-pattern-head">
                <span className="sip-pattern-type" style={{ color, borderColor: `${color}40`, background: `${color}10` }}>
                    {pattern.type.replace(/_/g, " ")}
                </span>
                <span className="sip-pattern-conf" style={{ color: confColor(pattern.confidence) }}>
                    {pattern.confidence}%
                </span>
                <span className="sip-pattern-evidence">{pattern.evidence}×</span>
                {pattern.action && (
                    <span className="sip-action-badge">{ACTION_LABELS[pattern.action] || pattern.action}</span>
                )}
            </div>
            <div className="sip-pattern-text">{pattern.pattern}</div>
            <div className="sip-pattern-suggestion">{pattern.suggestion}</div>
            <div className="sip-pattern-source">Source: {pattern.source}</div>
        </div>
    );
}

// ── Evolution view ────────────────────────────────────────────────────────────

function EvolutionView({ stats }) {
    const [running, setRunning] = useState(false);
    const [result,  setResult]  = useState(null);

    const evolve = async () => {
        setRunning(true);
        try { setResult(await API("POST", "/improvement/evolve", {})); }
        catch {}
        setRunning(false);
    };

    const cumStats = stats?.cumulativeStats || {};

    return (
        <div className="sip-evolve">
            <div className="sip-evolve-head">
                <div className="sip-evolve-title">Evolution Engine</div>
                <div className="sip-evolve-sub">
                    Analyze → Discover → Promote → Retire → Calibrate → Recommend → Measure
                </div>
                {stats?.lastRunAt && (
                    <div className="sip-evolve-last">Last cycle: {timeAgo(stats.lastRunAt)}</div>
                )}
                <button className="sip-run-btn" onClick={evolve} disabled={running}>
                    {running ? "Evolving…" : "Run Evolution Cycle"}
                </button>
            </div>

            <div className="sip-cum-stats">
                {[
                    { k: "Total Cycles",         v: cumStats.total || 0 },
                    { k: "Patterns Found",        v: cumStats.patternsFound || 0 },
                    { k: "Rules Promoted",        v: cumStats.rulesPromoted || 0 },
                    { k: "Rules Retired",         v: cumStats.rulesRetired || 0 },
                    { k: "Conf. Updates",         v: cumStats.confidenceUpdates || 0 },
                ].map(s => (
                    <div key={s.k} className="sip-cum-tile">
                        <div className="sip-cum-val">{s.v}</div>
                        <div className="sip-cum-key">{s.k}</div>
                    </div>
                ))}
            </div>

            {result && (
                <div className="sip-cycle-result">
                    <div className="sip-cycle-head">
                        <span className="sip-cycle-title">Cycle Result</span>
                        <span className="sip-cycle-duration">{formatMs(result.durationMs)}</span>
                    </div>
                    <div className="sip-cycle-kpis">
                        <div className="sip-cycle-kpi"><span style={{ color:"#a78bfa" }}>{result.patternsFound}</span><br/>Patterns</div>
                        <div className="sip-cycle-kpi"><span style={{ color:"#10b981" }}>{result.rulesPromoted}</span><br/>Promoted</div>
                        <div className="sip-cycle-kpi"><span style={{ color:"#f59e0b" }}>{result.rulesRetired}</span><br/>Retired</div>
                        <div className="sip-cycle-kpi"><span style={{ color:"#60a5fa" }}>{result.confidenceUpdates}</span><br/>Calibrated</div>
                    </div>
                    {Object.entries(result.stages || {}).map(([stage, data]) => (
                        <div key={stage} className={`sip-stage-row ${data?.error ? "sip-stage-row--err" : "sip-stage-row--ok"}`}>
                            <span className="sip-stage-dot" style={{ background: data?.error ? "#ef4444" : "#10b981" }} />
                            <span className="sip-stage-name">{stage}</span>
                            {data?.error
                                ? <span className="sip-stage-err">{data.error}</span>
                                : <span className="sip-stage-ok">✓</span>
                            }
                        </div>
                    ))}
                </div>
            )}

            {stats?.recentCycles?.length > 0 && (
                <div className="sip-recent-cycles">
                    <div className="sip-section-label">Recent Cycles</div>
                    {stats.recentCycles.map((c, i) => (
                        <div key={i} className="sip-recent-row">
                            <span className="sip-recent-ts">{timeAgo(c.runAt)}</span>
                            <span className="sip-recent-stat">{c.patternsFound}p</span>
                            <span className="sip-recent-stat" style={{ color: "#10b981" }}>{c.rulesPromoted}↑</span>
                            <span className="sip-recent-stat" style={{ color: "#f59e0b" }}>{c.rulesRetired}↓</span>
                            <span className="sip-recent-ms">{formatMs(c.durationMs)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Patterns view ─────────────────────────────────────────────────────────────

function PatternsView() {
    const [data,    setData]    = useState(null);
    const [candData,setCandData]= useState(null);
    const [loading, setLoading] = useState(true);
    const [promoting, setPromoting] = useState(false);
    const [promResult, setPromResult] = useState(null);

    useEffect(() => {
        Promise.all([
            API("GET", "/improvement/patterns"),
            API("GET", "/improvement/candidates"),
        ]).then(([p, c]) => { setData(p); setCandData(c); }).finally(() => setLoading(false));
    }, []);

    const promote = async () => {
        setPromoting(true);
        try { setPromResult(await API("POST", "/improvement/promote", {})); }
        catch {}
        setPromoting(false);
    };

    if (loading) return <div className="sip-loading">Discovering patterns…</div>;

    const patterns   = data?.patterns   || [];
    const candidates = candData?.candidates || [];

    return (
        <div className="sip-patterns">
            <div className="sip-patterns-head">
                <span className="sip-section-label">{patterns.length} Patterns Discovered</span>
                {candidates.length > 0 && (
                    <button className="sip-promote-btn" onClick={promote} disabled={promoting}>
                        {promoting ? "…" : `Promote ${candidates.length} candidates`}
                    </button>
                )}
            </div>

            {promResult && (
                <div className="sip-prom-result">
                    {promResult.promoted?.length > 0 && (
                        <span className="sip-prom-ok">✓ {promResult.promoted.length} rules promoted</span>
                    )}
                    {promResult.skipped?.length > 0 && (
                        <span className="sip-prom-skip">{promResult.skipped.length} skipped</span>
                    )}
                </div>
            )}

            {candidates.length > 0 && (
                <div className="sip-candidates">
                    <div className="sip-section-label">Rule Candidates ({candidates.length})</div>
                    {candidates.map((c, i) => (
                        <div key={i} className="sip-candidate-row">
                            <span className="sip-cand-dot" style={{ background: confColor(c.candidate.confidence) }} />
                            <span className="sip-cand-title">{c.candidate.title?.slice(0, 65)}</span>
                            <span className="sip-cand-conf" style={{ color: confColor(c.candidate.confidence) }}>
                                {c.candidate.confidence}%
                            </span>
                            {c.candidate.autoApply && <span className="sip-auto-tag">auto</span>}
                        </div>
                    ))}
                </div>
            )}

            <div className="sip-pattern-list">
                {patterns.map((p, i) => <PatternCard key={i} pattern={p} />)}
                {patterns.length === 0 && <div className="sip-empty">No patterns detected yet — run an evolution cycle first</div>}
            </div>
        </div>
    );
}

// ── Scores view ───────────────────────────────────────────────────────────────

function ScoresView() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        API("GET", "/improvement/measure").then(r => setData(r)).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="sip-loading">Loading scores…</div>;

    const scores = data?.scores || {};
    const gauges = [
        { key: "learningVelocity",     label: "Learning\nVelocity",     color: "#60a5fa",  value: Math.min(100, scores.learningVelocity) },
        { key: "repairSuccess",         label: "Repair\nSuccess",        color: "#10b981",  value: scores.repairSuccess },
        { key: "engineeringMaturity",   label: "Engineering\nMaturity",  color: "#a78bfa",  value: scores.engineeringMaturity },
        { key: "repositoryHealth",      label: "Repo\nHealth",           color: "#34d399",  value: scores.repositoryHealth },
        { key: "autonomousSuccess",     label: "Autonomous\nSuccess",    color: "#f59e0b",  value: scores.autonomousSuccess },
        { key: "predictionAccuracy",    label: "Prediction\nAccuracy",   color: "#fb923c",  value: scores.predictionAccuracy },
    ];

    return (
        <div className="sip-scores">
            <div className="sip-scores-title">Engineering Improvement Scores</div>
            <div className="sip-gauges-row">
                {gauges.map(g => <ScoreGauge key={g.key} value={g.value} label={g.label} color={g.color} />)}
            </div>
            <div className="sip-knowledge-tile">
                <span className="sip-knowledge-num" style={{ color: "#e5e7eb" }}>{scores.knowledgeGrowth}</span>
                <span className="sip-knowledge-label">Total Knowledge Items</span>
                <span className="sip-knowledge-sub">(lessons + rules + RCAs)</span>
            </div>
            {data?.evolutionLog?.lastRunAt && (
                <div className="sip-scores-meta">
                    Last evolution: {timeAgo(data.evolutionLog.lastRunAt)} ·
                    {data.evolutionLog.totalCycles} cycles ·
                    {data.evolutionLog.rulesPromoted} rules promoted
                </div>
            )}
        </div>
    );
}

// ── Architecture view ─────────────────────────────────────────────────────────

function ArchitectureView() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        API("GET", "/improvement/architecture").then(r => setData(r)).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="sip-loading">Loading recommendations…</div>;
    const recs = data?.recommendations || [];

    return (
        <div className="sip-arch">
            <div className="sip-section-label">{recs.length} Architecture Recommendations</div>
            {recs.length === 0 && <div className="sip-empty">No recommendations — build the repository map (ACP-9) first</div>}
            {recs.map((r, i) => (
                <div key={i} className={`sip-arch-card sip-arch-card--${r.priority}`}>
                    <div className="sip-arch-head">
                        <span className="sip-arch-priority" style={{ color: priColor(r.priority), borderColor: priColor(r.priority) }}>
                            {r.priority}
                        </span>
                        <span className="sip-arch-category">{r.category}</span>
                        <span className="sip-arch-effort">effort: {r.effort}</span>
                        <span className="sip-arch-roi">ROI: {r.roi}</span>
                    </div>
                    <div className="sip-arch-title">{r.title}</div>
                    <div className="sip-arch-rationale">{r.rationale}</div>
                    <div className="sip-arch-action">{r.action}</div>
                </div>
            ))}
        </div>
    );
}

// ── Confidence view ───────────────────────────────────────────────────────────

function ConfidenceView() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        API("GET", "/improvement/confidence").then(r => setData(r)).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="sip-loading">Calibrating…</div>;

    const updates = data?.updates || [];
    const weights = data?.currentWeights || {};

    return (
        <div className="sip-conf">
            <div className="sip-section-label">Confidence Calibration ({data?.totalSamples} samples)</div>
            <div className="sip-weights-section">
                <div className="sip-weights-label">Current Evidence Weights</div>
                {Object.entries(weights).map(([k, v]) => (
                    <div key={k} className="sip-weight-row">
                        <span className="sip-weight-key">{k}</span>
                        <div className="sip-weight-bar-wrap">
                            <div className="sip-weight-bar" style={{ width: `${Math.min(100, v * 2)}%` }} />
                        </div>
                        <span className="sip-weight-val">{v}</span>
                    </div>
                ))}
            </div>
            {updates.length > 0 && (
                <div className="sip-updates-section">
                    <div className="sip-weights-label">Calibration Recommendations</div>
                    {updates.map((u, i) => (
                        <div key={i} className={`sip-conf-update sip-conf-update--${u.action}`}>
                            <div className="sip-conf-update-head">
                                <span className="sip-conf-src">{u.evidenceSource}</span>
                                <span className="sip-conf-rate">{u.currentSuccessRate}% success</span>
                                <span className="sip-conf-action">{u.action}</span>
                                {u.suggestedWeight && <span className="sip-conf-suggested">→ {u.suggestedWeight}</span>}
                            </div>
                            <div className="sip-conf-rec">{u.recommendation}</div>
                        </div>
                    ))}
                </div>
            )}
            {updates.length === 0 && <div className="sip-empty">All evidence weights are well-calibrated</div>}
        </div>
    );
}

// ── Benchmark view ────────────────────────────────────────────────────────────

function BenchmarkView() {
    const [result,  setResult]  = useState(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        try { const r = await API("POST", "/improvement/benchmark", {}); setResult(r.benchmark); }
        catch { setResult({ error: "Benchmark failed" }); }
        setRunning(false);
    };

    return (
        <div className="sip-bench">
            <div className="sip-bench-head">
                <span className="sip-bench-title">ACP-11 Benchmark — 10 Evolution Scenarios</span>
                <button className="sip-run-btn" onClick={run} disabled={running}>
                    {running ? "Running…" : "Run Benchmark"}
                </button>
            </div>
            {result?.error && <div className="sip-err">{result.error}</div>}
            {result && !result.error && (
                <>
                    <div className="sip-bench-kpis">
                        {[
                            { k: "Passed",          v: `${result.passed}/${result.total}`,  c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Pass Rate",        v: `${result.passRate}%`,               c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Time",             v: formatMs(result.totalMs),            c: "#60a5fa" },
                            { k: "Patterns",         v: result.stats?.pendingPatterns || 0,  c: "#a78bfa" },
                            { k: "Knowledge Items",  v: result.stats?.improvementScores?.knowledgeGrowth || 0, c: "#d1d5db" },
                            { k: "Maturity",         v: `${result.stats?.improvementScores?.engineeringMaturity || 0}%`, c: "#10b981" },
                        ].map(kpi => (
                            <div key={kpi.k} className="sip-bench-kpi">
                                <div className="sip-bench-kpi-val" style={{ color: kpi.c }}>{kpi.v}</div>
                                <div className="sip-bench-kpi-label">{kpi.k}</div>
                            </div>
                        ))}
                    </div>
                    <div className="sip-bench-rows">
                        {(result.scenarios || []).map((s, i) => (
                            <div key={i} className={`sip-bench-row sip-bench-row--${s.ok ? "ok" : "fail"}`}>
                                <span className="sip-bench-num">{i + 1}.</span>
                                <span className="sip-bench-dot" style={{ background: s.ok ? "#10b981" : "#ef4444" }} />
                                <span className="sip-bench-goal">{s.name}</span>
                                <span className="sip-bench-val">{s.value}</span>
                                <span className="sip-bench-ms">{formatMs(s.elapsedMs)}</span>
                                {s.error && <span className="sip-bench-err">{s.error}</span>}
                            </div>
                        ))}
                    </div>
                </>
            )}
            {!result && !running && <div className="sip-empty" style={{ marginTop: 30 }}>Click "Run Benchmark" to validate all 10 evolution scenarios</div>}
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const VIEWS = ["evolution", "patterns", "scores", "architecture", "confidence", "benchmark"];
const VIEW_LABELS = {
    evolution: "Evolution", patterns: "Patterns", scores: "Scores",
    architecture: "Architecture", confidence: "Confidence", benchmark: "Benchmark",
};

export default function SelfImprovementPanel() {
    const [view,  setView]  = useState("evolution");
    const [stats, setStats] = useState(null);

    useEffect(() => {
        API("GET", "/improvement/stats").then(r => setStats(r));
    }, []);

    return (
        <div className="sip-root">
            <div className="sip-header">
                <span className="sip-header-title">
                    <span className="sip-header-icon">⟳</span> SELF-IMPROVEMENT ENGINE
                    {stats?.pendingPatterns > 0 && (
                        <span className="sip-badge-pending">{stats.pendingPatterns} patterns</span>
                    )}
                </span>
                <div className="sip-header-tabs">
                    {VIEWS.map(v => (
                        <button key={v} className={`sip-hdr-tab ${view === v ? "sip-hdr-tab--active" : ""}`}
                            onClick={() => setView(v)}>
                            {VIEW_LABELS[v]}
                        </button>
                    ))}
                </div>
            </div>

            <div className="sip-content">
                {view === "evolution"     && <EvolutionView stats={stats} />}
                {view === "patterns"      && <PatternsView />}
                {view === "scores"        && <ScoresView />}
                {view === "architecture"  && <ArchitectureView />}
                {view === "confidence"    && <ConfidenceView />}
                {view === "benchmark"     && <BenchmarkView />}
            </div>
        </div>
    );
}
