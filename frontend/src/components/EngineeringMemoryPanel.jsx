import React, { useState, useEffect, useCallback } from "react";
import "./EngineeringMemoryPanel.css";

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

function scoreColor(score) {
    if (score >= 0.6) return "#10b981";
    if (score >= 0.3) return "#f59e0b";
    return "#6b7280";
}

function riskColor(score) {
    if (score >= 70) return "#ef4444";
    if (score >= 40) return "#f59e0b";
    return "#10b981";
}

const SOURCE_COLORS = {
    lesson:          "#60a5fa",
    rule:            "#10b981",
    rca:             "#a78bfa",
    mission:         "#f59e0b",
    raw_lesson:      "#6b7280",
    failure_lesson:  "#ef4444",
    success_lesson:  "#10b981",
    reusable_rule:   "#34d399",
    rca_playbook:    "#c084fc",
    rule_match:      "#10b981",
    mission_failure: "#ef4444",
    approved_decision: "#f59e0b",
    patch:           "#fb923c",
    pipeline:        "#94a3b8",
    acp6_bundle:     "#818cf8",
};

const TYPE_ICONS = {
    lesson:     "📚", rule: "⚖", rca: "🔍", mission: "🎯",
    patch:      "🔧", pipeline: "⚙", rca_playbook: "📋",
    rule_match: "✓", mission_failure: "✗", success_lesson: "✓",
    failure_lesson: "✗", reusable_rule: "♻", approved_decision: "✅",
};

// ── Stats row ─────────────────────────────────────────────────────────────────

function StatsRow({ stats }) {
    if (!stats) return null;
    const src = stats.memorySources || {};
    const eng = stats.engineHealth  || {};
    const grw = stats.growth        || {};

    return (
        <div className="emp-stats-row">
            {[
                { k: "Lessons",     v: src.lessons,          c: "#60a5fa" },
                { k: "Rules",       v: src.rules,            c: "#10b981" },
                { k: "RCAs",        v: src.rcas,             c: "#a78bfa" },
                { k: "Failures ✓",  v: src.failuresAnalysed, c: "#6b7280" },
                { k: "Missions",    v: src.missions,         c: "#f59e0b" },
                { k: "Patches",     v: src.patches,          c: "#fb923c" },
                { k: "Pipelines",   v: src.pipelineRuns,     c: "#94a3b8" },
                { k: "Knowledge",   v: grw.totalKnowledgeItems, c: "#e5e7eb" },
                { k: "This Week",   v: grw.lessonsThisWeek,  c: "#34d399" },
                { k: "Open Recs",   v: eng.openRecommendations, c: "#f59e0b" },
                { k: "Active RCAs", v: eng.activeRCAs,       c: "#ef4444" },
                { k: "Playbooks",   v: eng.playbooks,        c: "#c084fc" },
            ].map(t => (
                <div key={t.k} className="emp-stat">
                    <div className="emp-stat-val" style={{ color: t.c }}>{t.v ?? 0}</div>
                    <div className="emp-stat-key">{t.k}</div>
                </div>
            ))}
        </div>
    );
}

// ── Timeline view ─────────────────────────────────────────────────────────────

function TimelineView() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        API("GET", "/memory/timeline?limit=80")
            .then(r => setData(r))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="emp-loading">Loading timeline…</div>;
    if (!data?.events?.length) return <div className="emp-empty">No events found</div>;

    const TYPE_COLOR = {
        lesson: "#60a5fa", patch: "#fb923c", pipeline: "#94a3b8",
        mission: "#f59e0b", rca: "#a78bfa",
    };

    return (
        <div className="emp-timeline">
            {data.events.map((e, i) => (
                <div key={i} className="emp-tl-row">
                    <div className="emp-tl-dot" style={{ background: TYPE_COLOR[e.type] || "#374151" }} />
                    <div className="emp-tl-body">
                        <span className="emp-tl-type" style={{ color: TYPE_COLOR[e.type] || "#6b7280" }}>
                            {TYPE_ICONS[e.type] || "·"} {e.type}
                        </span>
                        <span className="emp-tl-title">{e.title}</span>
                        {e.status && <span className={`emp-tl-badge emp-tl-badge--${e.status}`}>{e.status}</span>}
                        {e.severity && <span className="emp-tl-badge">{e.severity}</span>}
                        {e.confidence && <span className="emp-tl-conf">{e.confidence}%</span>}
                    </div>
                    <div className="emp-tl-ts">{timeAgo(e.timestamp)}</div>
                </div>
            ))}
        </div>
    );
}

// ── Similarity Explorer ────────────────────────────────────────────────────────

function SimilarityExplorer() {
    const [query,   setQuery]   = useState("");
    const [mode,    setMode]    = useState("problems"); // problems | patches | strategies
    const [result,  setResult]  = useState(null);
    const [loading, setLoading] = useState(false);

    const search = async () => {
        if (!query.trim()) return;
        setLoading(true);
        try {
            let r;
            if (mode === "problems")   r = await API("POST", "/memory/similar-problems",   { description: query, limit: 10 });
            if (mode === "patches")    r = await API("POST", "/memory/similar-patches",    { targetFile: query, reasonHint: query, limit: 10 });
            if (mode === "strategies") r = await API("POST", "/memory/successful-strategies", { goal: query, limit: 10 });
            setResult(r);
        } catch {}
        setLoading(false);
    };

    const resultItems = result?.results || [];

    return (
        <div className="emp-sim">
            <div className="emp-sim-toolbar">
                <div className="emp-mode-tabs">
                    {["problems", "patches", "strategies"].map(m => (
                        <button key={m} className={`emp-mode-tab ${mode === m ? "emp-mode-tab--active" : ""}`}
                            onClick={() => setMode(m)}>
                            {m === "problems" ? "Similar Problems" : m === "patches" ? "Similar Patches" : "Strategies"}
                        </button>
                    ))}
                </div>
                <div className="emp-sim-search-row">
                    <input className="emp-sim-input"
                        placeholder={mode === "problems" ? "Describe the problem…" : mode === "patches" ? "File path or reason…" : "Describe the goal…"}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && search()} />
                    <button className="emp-search-btn" onClick={search} disabled={loading || !query.trim()}>
                        {loading ? "…" : "Search Memory"}
                    </button>
                </div>
            </div>
            <div className="emp-sim-results">
                {resultItems.length === 0 && !loading && (
                    <div className="emp-empty">Enter a query to search engineering memory</div>
                )}
                {resultItems.map((item, i) => (
                    <div key={i} className="emp-result-card">
                        <div className="emp-result-head">
                            <span className="emp-result-icon">{TYPE_ICONS[item.type] || "·"}</span>
                            <span className="emp-result-type" style={{ color: SOURCE_COLORS[item.type] || "#6b7280" }}>
                                {item.type}
                            </span>
                            <div className="emp-score-bar">
                                <div className="emp-score-fill" style={{ width: `${Math.round(item.score * 100)}%`, background: scoreColor(item.score) }} />
                            </div>
                            <span className="emp-score-val" style={{ color: scoreColor(item.score) }}>
                                {Math.round(item.score * 100)}%
                            </span>
                        </div>
                        <div className="emp-result-body">
                            {(item.title || item.objective || item.filePath) && (
                                <div className="emp-result-title">{item.title || item.objective || item.filePath}</div>
                            )}
                            {(item.rootCause || item.likelyRootCause || item.description) && (
                                <div className="emp-result-detail">{item.rootCause || item.likelyRootCause || item.description}</div>
                            )}
                            {(item.fix || item.solution) && (
                                <div className="emp-result-fix">
                                    <span className="emp-fix-label">Fix:</span> {item.fix || item.solution}
                                </div>
                            )}
                            {item.recommendation && (
                                <div className="emp-result-rec">
                                    <span className="emp-fix-label">Rec:</span> {item.recommendation}
                                </div>
                            )}
                            <div className="emp-result-meta">
                                {item.confidence && <span>conf: {item.confidence}%</span>}
                                {item.frequency  && <span>{item.frequency} occurrences</span>}
                                {item.autoApply  && <span className="emp-auto-tag">auto-apply</span>}
                                {item.canAutoFix && <span className="emp-auto-tag">auto-fix</span>}
                                {item.status     && <span>{item.status}</span>}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Predictions view ──────────────────────────────────────────────────────────

function PredictionsView() {
    const [goal,    setGoal]    = useState("");
    const [files,   setFiles]   = useState("");
    const [risk,    setRisk]    = useState(null);
    const [soln,    setSoln]    = useState(null);
    const [compare, setCompare] = useState(null);
    const [loading, setLoading] = useState(false);

    const predict = async () => {
        if (!goal.trim()) return;
        setLoading(true);
        const fileList = files.split(",").map(f => f.trim()).filter(Boolean);
        try {
            const [riskR, solnR, cmpR] = await Promise.all([
                API("POST", "/memory/predict-risk",     { goal, files: fileList }),
                API("POST", "/memory/predict-solution", { goal }),
                API("POST", "/memory/compare-history",  { goal, metrics: {} }),
            ]);
            setRisk(riskR);
            setSoln(solnR);
            setCompare(cmpR);
        } catch {}
        setLoading(false);
    };

    return (
        <div className="emp-pred">
            <div className="emp-pred-input-row">
                <input className="emp-pred-input" placeholder="Engineering goal or task description…"
                    value={goal} onChange={e => setGoal(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && predict()} />
                <button className="emp-search-btn" onClick={predict} disabled={loading || !goal.trim()}>
                    {loading ? "…" : "Predict"}
                </button>
            </div>
            <input className="emp-pred-files" placeholder="Files involved (comma-separated, optional)…"
                value={files} onChange={e => setFiles(e.target.value)} />

            {risk && (
                <div className="emp-pred-section">
                    <div className="emp-pred-label">Failure Risk Assessment</div>
                    <div className="emp-risk-summary">
                        <div className="emp-risk-score" style={{ color: riskColor(risk.riskScore) }}>
                            {risk.riskScore}%
                        </div>
                        <div className="emp-risk-details">
                            <div className="emp-risk-level" style={{ color: riskColor(risk.riskScore) }}>
                                {risk.riskLevel?.toUpperCase()} RISK
                            </div>
                            <div className="emp-risk-rec">{risk.recommendation}</div>
                        </div>
                    </div>
                    <div className="emp-prob-grid">
                        {[
                            { k: "Build",    v: risk.buildProbability },
                            { k: "Test",     v: risk.testProbability },
                            { k: "Rollback", v: risk.rollbackProbability },
                            { k: "Repair",   v: risk.repairProbability },
                        ].map(p => (
                            <div key={p.k} className="emp-prob-tile">
                                <div className="emp-prob-val" style={{ color: p.k === "Rollback" || p.k === "Repair" ? riskColor(p.v) : "#10b981" }}>
                                    {Math.round(p.v)}%
                                </div>
                                <div className="emp-prob-key">{p.k}</div>
                            </div>
                        ))}
                    </div>
                    {risk.signals?.length > 0 && (
                        <div className="emp-signals">
                            <div className="emp-signals-label">Risk signals:</div>
                            {risk.signals.map((s, i) => (
                                <div key={i} className="emp-signal-row">
                                    <span className="emp-signal-name">{s.signal}</span>
                                    <div className="emp-signal-bar-wrap">
                                        <div className="emp-signal-bar" style={{ width: `${Math.min(100, s.weight)}%` }} />
                                    </div>
                                    <span className="emp-signal-weight">+{Math.round(s.weight)}%</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {soln && (
                <div className="emp-pred-section">
                    <div className="emp-pred-label">Predicted Best Solution</div>
                    {soln.bestSolution ? (
                        <div className="emp-solution-card">
                            <div className="emp-solution-conf" style={{ color: scoreColor(soln.bestSolution.confidence / 100) }}>
                                {soln.bestSolution.confidence}% confidence
                            </div>
                            <div className="emp-solution-text">{soln.bestSolution.solution}</div>
                            <div className="emp-solution-meta">
                                <span>Source: {soln.bestSolution.source}</span>
                                {soln.bestSolution.autoApply && <span className="emp-auto-tag">auto-apply</span>}
                            </div>
                            {soln.alternatives?.length > 0 && (
                                <div className="emp-alts-label">Alternatives:</div>
                            )}
                            {soln.alternatives?.map((a, i) => (
                                <div key={i} className="emp-alt-row">
                                    <span className="emp-alt-conf">{a.confidence}%</span>
                                    <span className="emp-alt-text">{a.solution?.slice(0, 80)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="emp-empty">No solution found in memory — this may be a novel problem</div>
                    )}
                </div>
            )}

            {compare && (
                <div className="emp-pred-section">
                    <div className="emp-pred-label">Historical Comparison</div>
                    <div className="emp-compare-row">
                        <div className="emp-compare-kpi">
                            <div className="emp-compare-val" style={{ color: compare.historicalSuccessRate >= 70 ? "#10b981" : "#f59e0b" }}>
                                {compare.historicalSuccessRate ?? "—"}%
                            </div>
                            <div className="emp-compare-key">Historical Success</div>
                        </div>
                        <div className="emp-compare-kpi">
                            <div className="emp-compare-val">{compare.historicalSuccesses}</div>
                            <div className="emp-compare-key">Successes</div>
                        </div>
                        <div className="emp-compare-kpi">
                            <div className="emp-compare-val" style={{ color: compare.historicalFailures > 0 ? "#ef4444" : "#6b7280" }}>
                                {compare.historicalFailures}
                            </div>
                            <div className="emp-compare-key">Failures</div>
                        </div>
                        <div className="emp-compare-kpi">
                            <div className="emp-compare-val">{compare.learningContext?.totalLessons}</div>
                            <div className="emp-compare-key">Total Lessons</div>
                        </div>
                    </div>
                </div>
            )}

            {!risk && !loading && (
                <div className="emp-empty" style={{ marginTop: 30 }}>
                    Enter a goal to get failure risk prediction, best solution, and historical comparison
                </div>
            )}
        </div>
    );
}

// ── Knowledge Growth Chart ─────────────────────────────────────────────────────

function KnowledgeGrowthView() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        API("GET", "/memory/growth").then(r => setData(r)).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="emp-loading">Loading…</div>;
    if (!data?.series?.length) return <div className="emp-empty">No growth data yet</div>;

    const max = Math.max(...data.series.map(s => s.lessons + s.patches + s.missions + s.rules), 1);

    return (
        <div className="emp-growth">
            <div className="emp-growth-title">Knowledge Growth by Week</div>
            <div className="emp-growth-total">Total: {data.total} knowledge items</div>
            <div className="emp-growth-chart">
                {data.series.map((s, i) => {
                    const total = s.lessons + s.patches + s.missions + s.rules;
                    return (
                        <div key={i} className="emp-growth-col">
                            <div className="emp-growth-bars">
                                <div className="emp-growth-bar emp-growth-bar--lessons"
                                    style={{ height: `${(s.lessons / max) * 100}%` }} title={`Lessons: ${s.lessons}`} />
                                <div className="emp-growth-bar emp-growth-bar--patches"
                                    style={{ height: `${(s.patches / max) * 100}%` }} title={`Patches: ${s.patches}`} />
                                <div className="emp-growth-bar emp-growth-bar--missions"
                                    style={{ height: `${(s.missions / max) * 100}%` }} title={`Missions: ${s.missions}`} />
                                <div className="emp-growth-bar emp-growth-bar--rules"
                                    style={{ height: `${(s.rules / max) * 100}%` }} title={`Rules: ${s.rules}`} />
                            </div>
                            <div className="emp-growth-total-label">{total}</div>
                            <div className="emp-growth-week">{s.week}</div>
                        </div>
                    );
                })}
            </div>
            <div className="emp-growth-legend">
                {[["#60a5fa","Lessons"],["#fb923c","Patches"],["#f59e0b","Missions"],["#10b981","Rules"]].map(([c,l]) => (
                    <div key={l} className="emp-growth-leg-item">
                        <div className="emp-growth-leg-dot" style={{ background: c }} />
                        <span>{l}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Lessons view ─────────────────────────────────────────────────────────────

function LessonsView() {
    const [data,    setData]    = useState(null);
    const [filter,  setFilter]  = useState("all");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        API("POST", "/memory/recall", { query: "engineering lesson", limit: 40, sources: ["lessons"] })
            .then(r => setData(r)).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="emp-loading">Loading lessons…</div>;

    const items = (data?.results || []).filter(r =>
        filter === "all" || r.item?.type === filter
    );

    const LESSON_TYPES = ["all","success","failure","engineering_rule","engineering_playbook"];

    return (
        <div className="emp-lessons">
            <div className="emp-filter-row">
                {LESSON_TYPES.map(t => (
                    <button key={t}
                        className={`emp-filter-btn ${filter === t ? "emp-filter-btn--active" : ""}`}
                        onClick={() => setFilter(t)}>
                        {t === "all" ? "All" : t.replace("_"," ")}
                    </button>
                ))}
            </div>
            <div className="emp-lessons-list">
                {items.slice(0, 30).map((r, i) => {
                    const l = r.item;
                    return (
                        <div key={i} className={`emp-lesson-row emp-lesson-row--${l.type}`}>
                            <span className="emp-lesson-icon">
                                {l.type === "success" ? "✓" : l.type === "failure" ? "✗" : l.type === "engineering_playbook" ? "📋" : "⚖"}
                            </span>
                            <div className="emp-lesson-body">
                                <div className="emp-lesson-title">{l.title}</div>
                                {l.detail && <div className="emp-lesson-detail">{l.detail?.slice(0, 100)}</div>}
                                {l.recommendation && <div className="emp-lesson-rec">→ {l.recommendation?.slice(0, 80)}</div>}
                            </div>
                            <div className="emp-lesson-meta">
                                <span className={`emp-lesson-type emp-lesson-type--${l.type}`}>{l.type}</span>
                                <span className="emp-lesson-age">{timeAgo(l.createdAt)}</span>
                            </div>
                        </div>
                    );
                })}
                {items.length === 0 && <div className="emp-empty">No lessons match the filter</div>}
            </div>
        </div>
    );
}

// ── Benchmark view ─────────────────────────────────────────────────────────────

function BenchmarkView() {
    const [result,  setResult]  = useState(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        try {
            const r = await API("POST", "/memory/benchmark", {});
            setResult(r.benchmark);
        } catch { setResult({ error: "Benchmark failed" }); }
        setRunning(false);
    };

    return (
        <div className="emp-bench">
            <div className="emp-bench-head">
                <span className="emp-bench-title">ACP-10 Memory Benchmark — 10 Scenarios</span>
                <button className="emp-run-btn" onClick={run} disabled={running}>
                    {running ? "Running…" : "Run Benchmark"}
                </button>
            </div>
            {result?.error && <div className="emp-err">{result.error}</div>}
            {result && !result.error && (
                <>
                    <div className="emp-bench-kpis">
                        {[
                            { k: "Passed",     v: `${result.passed}/${result.total}`, c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Pass Rate",  v: `${result.passRate}%`,              c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Total Time", v: formatMs(result.totalMs),           c: "#60a5fa" },
                            { k: "Knowledge",  v: result.stats?.growth?.totalKnowledgeItems || 0, c: "#d1d5db" },
                            { k: "Lessons",    v: result.stats?.memorySources?.lessons || 0,      c: "#60a5fa" },
                            { k: "Failures ✓", v: result.stats?.memorySources?.failuresAnalysed || 0, c: "#a78bfa" },
                        ].map(kpi => (
                            <div key={kpi.k} className="emp-bench-kpi">
                                <div className="emp-bench-kpi-val" style={{ color: kpi.c }}>{kpi.v}</div>
                                <div className="emp-bench-kpi-label">{kpi.k}</div>
                            </div>
                        ))}
                    </div>
                    <div className="emp-bench-rows">
                        {(result.scenarios || []).map((s, i) => (
                            <div key={i} className={`emp-bench-row emp-bench-row--${s.ok ? "ok" : "fail"}`}>
                                <span className="emp-bench-num">{i + 1}.</span>
                                <span className="emp-bench-dot" style={{ background: s.ok ? "#10b981" : "#ef4444" }} />
                                <span className="emp-bench-goal">{s.name}</span>
                                <span className="emp-bench-val">{s.value}</span>
                                <span className="emp-bench-ms">{formatMs(s.elapsedMs)}</span>
                                {s.error && <span className="emp-bench-err">{s.error}</span>}
                            </div>
                        ))}
                    </div>
                </>
            )}
            {!result && !running && (
                <div className="emp-empty" style={{ marginTop: 30 }}>Click "Run Benchmark" to validate all 10 memory scenarios</div>
            )}
        </div>
    );
}

// ── Evolve panel ──────────────────────────────────────────────────────────────

function EvolveView() {
    const [result,  setResult]  = useState(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        try { setResult(await API("POST", "/memory/evolve", {})); }
        catch { setResult({ error: "Evolution failed" }); }
        setRunning(false);
    };

    return (
        <div className="emp-evolve">
            <div className="emp-evolve-head">
                <div className="emp-evolve-title">Engineering Knowledge Evolution</div>
                <div className="emp-evolve-desc">
                    Triggers: Continuous Learning full analysis → RCA run → Engineering Rule backfill → Unified Intelligence synthesis
                </div>
                <button className="emp-run-btn" onClick={run} disabled={running} style={{ marginTop: 12 }}>
                    {running ? "Evolving…" : "Evolve Knowledge Now"}
                </button>
            </div>
            {result?.error && <div className="emp-err">{result.error}</div>}
            {result && !result.error && (
                <div className="emp-evolve-results">
                    {Object.entries(result).filter(([k]) => k !== 'evolvedAt').map(([key, val]) => (
                        <div key={key} className={`emp-evolve-row emp-evolve-row--${val.ok ? "ok" : "fail"}`}>
                            <span className="emp-evolve-dot" style={{ background: val.ok ? "#10b981" : "#ef4444" }} />
                            <span className="emp-evolve-key">{key}</span>
                            {val.ok ? (
                                <span className="emp-evolve-detail">
                                    {val.lessons !== undefined && `${val.lessons} lessons`}
                                    {val.analyses !== undefined && ` ${val.analyses} analyses`}
                                    {val.playbooks !== undefined && ` ${val.playbooks} playbooks`}
                                    {val.recommendations !== undefined && ` ${val.recommendations} recs`}
                                    {val.result !== undefined && ` ruleId: ${val.result?.ruleId || "none"}`}
                                </span>
                            ) : (
                                <span className="emp-evolve-err">{val.error}</span>
                            )}
                        </div>
                    ))}
                    <div className="emp-evolve-ts">Evolved at: {result.evolvedAt}</div>
                </div>
            )}
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const VIEWS = ["timeline", "lessons", "similarity", "predictions", "growth", "evolve", "benchmark"];

const VIEW_LABELS = {
    timeline: "Timeline", lessons: "Lessons", similarity: "Similarity",
    predictions: "Predictions", growth: "Growth", evolve: "Evolve", benchmark: "Benchmark",
};

export default function EngineeringMemoryPanel() {
    const [view,  setView]  = useState("timeline");
    const [stats, setStats] = useState(null);

    useEffect(() => {
        API("GET", "/memory/stats").then(r => r.stats && setStats(r.stats));
    }, []);

    return (
        <div className="emp-root">
            <div className="emp-header">
                <span className="emp-header-title">
                    <span className="emp-header-icon">◉</span> ENGINEERING MEMORY
                </span>
                <div className="emp-header-tabs">
                    {VIEWS.map(v => (
                        <button key={v} className={`emp-hdr-tab ${view === v ? "emp-hdr-tab--active" : ""}`}
                            onClick={() => setView(v)}>
                            {VIEW_LABELS[v]}
                        </button>
                    ))}
                </div>
            </div>

            <StatsRow stats={stats} />

            <div className="emp-content">
                {view === "timeline"    && <TimelineView />}
                {view === "lessons"     && <LessonsView />}
                {view === "similarity"  && <SimilarityExplorer />}
                {view === "predictions" && <PredictionsView />}
                {view === "growth"      && <KnowledgeGrowthView />}
                {view === "evolve"      && <EvolveView />}
                {view === "benchmark"   && <BenchmarkView />}
            </div>
        </div>
    );
}
