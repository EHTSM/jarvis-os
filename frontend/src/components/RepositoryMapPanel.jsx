import React, { useState, useEffect, useRef, useCallback } from "react";
import "./RepositoryMapPanel.css";

// ── helpers ───────────────────────────────────────────────────────────────────

const API = async (method, path, body) => {
    const r = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return r.json();
};

function badge(status) {
    const map = {
        completed: "#10b981", in_progress: "#60a5fa", pending: "#f59e0b",
        failed: "#ef4444", cancelled: "#6b7280",
    };
    return { background: `${map[status] || "#6b7280"}20`, borderColor: map[status] || "#6b7280", color: map[status] || "#6b7280" };
}

function typeIcon(type) {
    const m = {
        routes: "R", services: "S", middleware: "M", models: "D", utils: "U",
        frontend: "F", tests: "T", config: "C", auth: "A", agents: "G", data: "Δ", docs: "📄", other: "·",
    };
    return m[type] || "·";
}

function formatMs(ms) {
    if (!ms) return "0ms";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

// ── SVG Graph ────────────────────────────────────────────────────────────────

const GRAPH_W = 900;
const GRAPH_H = 600;

function layoutNodes(nodes) {
    if (!nodes.length) return {};
    // Group by type, arrange in columns
    const types = [...new Set(nodes.map(n => n.type))];
    const cols   = {};
    types.forEach((t, i) => {
        const group = nodes.filter(n => n.type === t);
        cols[t] = { x: 80 + i * (GRAPH_W / Math.max(types.length, 1)), nodes: group };
    });

    const positions = {};
    for (const [, col] of Object.entries(cols)) {
        col.nodes.forEach((n, j) => {
            const rowHeight = Math.max(20, GRAPH_H / Math.max(col.nodes.length, 1));
            positions[n.id] = {
                x: col.x + (Math.random() - 0.5) * 40,
                y: 40 + j * rowHeight + (Math.random() - 0.5) * 15,
            };
        });
    }
    return positions;
}

function SVGGraph({ nodes, edges, positions, selectedId, highlightIds, onNodeClick, heatMode }) {
    const visibleNodes = nodes.slice(0, 120);
    const nodeSet      = new Set(visibleNodes.map(n => n.id));
    const visEdges     = edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target) && e.type !== 'circular').slice(0, 200);
    const cycleEdges   = edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target) && e.type === 'circular').slice(0, 40);

    return (
        <g>
            {/* Regular edges */}
            {visEdges.map(e => {
                const s = positions[e.source];
                const t = positions[e.target];
                if (!s || !t) return null;
                const isHighlit = highlightIds?.has(e.source) || highlightIds?.has(e.target);
                return (
                    <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        stroke={isHighlit ? "#60a5fa" : "#1f2937"}
                        strokeWidth={isHighlit ? 1.5 : 0.7}
                        strokeOpacity={isHighlit ? 0.8 : 0.4}
                        markerEnd="url(#arrow)"
                    />
                );
            })}
            {/* Circular dep edges (red) */}
            {cycleEdges.map(e => {
                const s = positions[e.source];
                const t = positions[e.target];
                if (!s || !t) return null;
                return (
                    <line key={e.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        stroke="#ef4444" strokeWidth={1.2} strokeOpacity={0.7}
                        strokeDasharray="3 2"
                    />
                );
            })}
            {/* Nodes */}
            {visibleNodes.map(n => {
                const p = positions[n.id];
                if (!p) return null;
                const isSelected  = n.id === selectedId;
                const isHighlit   = highlightIds?.has(n.id);
                const isFaded     = highlightIds && !isHighlit && !isSelected;

                let fillColor = n.color;
                if (heatMode === 'commits') {
                    const intensity = Math.min(1, n.commits / 30);
                    fillColor = `rgba(239,68,68,${0.2 + intensity * 0.8})`;
                } else if (heatMode === 'risk') {
                    const intensity = n.riskScore / 100;
                    fillColor = `rgba(245,158,11,${0.2 + intensity * 0.8})`;
                } else if (heatMode === 'smells') {
                    const intensity = Math.min(1, n.smellCount / 10);
                    fillColor = `rgba(139,92,246,${0.2 + intensity * 0.8})`;
                }

                return (
                    <g key={n.id} onClick={() => onNodeClick(n)}
                        style={{ cursor: "pointer", opacity: isFaded ? 0.25 : 1 }}>
                        <circle
                            cx={p.x} cy={p.y} r={n.size}
                            fill={fillColor}
                            stroke={isSelected ? "#fff" : isHighlit ? "#60a5fa" : n.color}
                            strokeWidth={isSelected ? 2.5 : isHighlit ? 1.5 : 0.8}
                        />
                        {n.inCycle && (
                            <circle cx={p.x} cy={p.y} r={n.size + 3}
                                fill="none" stroke="#ef4444" strokeWidth={1} strokeDasharray="2 2" />
                        )}
                        {n.isHot && (
                            <circle cx={p.x} cy={p.y} r={n.size + 2}
                                fill="none" stroke="#f59e0b" strokeWidth={0.8} strokeOpacity={0.6} />
                        )}
                        {(isSelected || isHighlit || n.size >= 10) && (
                            <text x={p.x} y={p.y + n.size + 9}
                                textAnchor="middle" fontSize={8}
                                fill={isSelected ? "#e5e7eb" : "#6b7280"}
                                style={{ pointerEvents: "none", userSelect: "none" }}>
                                {n.name.length > 18 ? n.name.slice(0, 16) + "…" : n.name}
                            </text>
                        )}
                    </g>
                );
            })}
        </g>
    );
}

// ── Node Detail Sidebar ───────────────────────────────────────────────────────

function NodeDetail({ nodeId, onClose }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!nodeId) return;
        setLoading(true);
        API("GET", `/repo-viz/node/${nodeId}`)
            .then(d => setDetail(d))
            .catch(() => setDetail({ error: "Failed to load" }))
            .finally(() => setLoading(false));
    }, [nodeId]);

    if (!nodeId) return null;

    return (
        <div className="rmp-sidebar">
            <div className="rmp-sidebar-head">
                <span className="rmp-sidebar-title">Node Detail</span>
                <button className="rmp-close-btn" onClick={onClose}>✕</button>
            </div>
            {loading ? (
                <div className="rmp-loading">Loading…</div>
            ) : detail?.error ? (
                <div className="rmp-err">{detail.error}</div>
            ) : (
                <div className="rmp-sidebar-body">
                    {/* File info */}
                    <div className="rmp-detail-section">
                        <div className="rmp-detail-section-label">File</div>
                        <div className="rmp-detail-path">{detail?.node?.path}</div>
                        <div className="rmp-detail-meta-row">
                            <span className="rmp-tag" style={{ background: `${detail?.node?.color}20`, color: detail?.node?.color, borderColor: detail?.node?.color }}>
                                {typeIcon(detail?.node?.type)} {detail?.node?.type}
                            </span>
                            {detail?.node?.inCycle && <span className="rmp-tag rmp-tag--danger">⚠ circular</span>}
                            {detail?.node?.isHot && <span className="rmp-tag rmp-tag--warn">🔥 hot</span>}
                        </div>
                    </div>

                    {/* Metrics */}
                    <div className="rmp-detail-section">
                        <div className="rmp-detail-section-label">Metrics</div>
                        <div className="rmp-kpis-grid">
                            {[
                                { k: "Commits",    v: detail?.node?.commits },
                                { k: "Imports",    v: detail?.node?.depCount },
                                { k: "Dependents", v: detail?.node?.reverseDeps?.length },
                                { k: "Smells",     v: detail?.node?.smellCount },
                                { k: "Decisions",  v: detail?.node?.decisionCount },
                                { k: "Risk",       v: `${detail?.node?.riskScore}%` },
                            ].map(m => (
                                <div key={m.k} className="rmp-kpi">
                                    <div className="rmp-kpi-val">{m.v ?? 0}</div>
                                    <div className="rmp-kpi-key">{m.k}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Callers / Callees */}
                    {detail?.callers?.length > 0 && (
                        <div className="rmp-detail-section">
                            <div className="rmp-detail-section-label">Imported By ({detail.callers.length})</div>
                            {detail.callers.slice(0, 5).map(c => (
                                <div key={c.id} className="rmp-dep-row">
                                    <span style={{ color: c.color }}>{typeIcon(c.type)}</span>
                                    <span className="rmp-dep-path">{c.path}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {detail?.callees?.length > 0 && (
                        <div className="rmp-detail-section">
                            <div className="rmp-detail-section-label">Imports ({detail.callees.length})</div>
                            {detail.callees.slice(0, 5).map(c => (
                                <div key={c.id} className="rmp-dep-row">
                                    <span style={{ color: c.color }}>{typeIcon(c.type)}</span>
                                    <span className="rmp-dep-path">{c.path}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Smells */}
                    {detail?.node?.smells?.length > 0 && (
                        <div className="rmp-detail-section">
                            <div className="rmp-detail-section-label">Engineering Smells</div>
                            {detail.node.smells.slice(0, 5).map((s, i) => (
                                <div key={i} className="rmp-smell-row">
                                    <span className="rmp-smell-type">{s.type}</span>
                                    <span className="rmp-smell-sev">{s.severity}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Decisions */}
                    {detail?.node?.decisions?.length > 0 && (
                        <div className="rmp-detail-section">
                            <div className="rmp-detail-section-label">Open Decisions</div>
                            {detail.node.decisions.slice(0, 3).map((d, i) => (
                                <div key={i} className="rmp-decision-row">
                                    <span className="rmp-decision-title">{d.title}</span>
                                    <span className="rmp-decision-pri">{d.priority}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Impact */}
                    {detail?.impact?.totalAffected > 0 && (
                        <div className="rmp-detail-section">
                            <div className="rmp-detail-section-label">Impact</div>
                            <div className="rmp-impact-row">
                                <span className="rmp-impact-num">{detail.impact.totalAffected}</span>
                                <span className="rmp-impact-label">files affected if changed</span>
                            </div>
                            <div className="rmp-impact-risk">Risk: {detail.impact.riskEstimate}%</div>
                        </div>
                    )}

                    {/* Related Missions */}
                    {detail?.relatedMissions?.length > 0 && (
                        <div className="rmp-detail-section">
                            <div className="rmp-detail-section-label">Related Missions</div>
                            {detail.relatedMissions.slice(0, 2).map(m => (
                                <div key={m.planId || m.id} className="rmp-mission-row">
                                    <span className="rmp-mission-id">{(m.planId || m.id)?.slice(-8)}</span>
                                    <span className="rmp-mission-status">{m.status}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Benchmark view ─────────────────────────────────────────────────────────────

function BenchmarkView({ onBack }) {
    const [result, setResult] = useState(null);
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        try {
            const r = await API("POST", "/repo-viz/benchmark", {});
            setResult(r.benchmark);
        } catch { setResult({ error: "Benchmark failed" }); }
        setRunning(false);
    };

    return (
        <div className="rmp-bench">
            <div className="rmp-bench-head">
                <button className="rmp-back-btn" onClick={onBack}>← Back</button>
                <span className="rmp-bench-title">ACP-9 Benchmark</span>
                <button className="rmp-run-btn" onClick={run} disabled={running}>
                    {running ? "Running…" : "Run 10 Scenarios"}
                </button>
            </div>
            {result && !result.error && (
                <>
                    <div className="rmp-bench-kpis">
                        {[
                            { k: "Passed",     v: `${result.passed}/${result.total}`, c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Pass Rate",  v: `${result.passRate}%`,              c: result.passRate >= 90 ? "#10b981" : "#f59e0b" },
                            { k: "Total Time", v: formatMs(result.totalMs),           c: "#60a5fa" },
                            { k: "Files",      v: result.stats?.totalFiles || 0,      c: "#d1d5db" },
                            { k: "Smells",     v: result.stats?.totalSmells || 0,     c: "#a78bfa" },
                            { k: "Health",     v: `${result.stats?.healthScore || 0}%`, c: "#10b981" },
                        ].map(kpi => (
                            <div key={kpi.k} className="rmp-bench-kpi">
                                <div className="rmp-bench-kpi-val" style={{ color: kpi.c }}>{kpi.v}</div>
                                <div className="rmp-bench-kpi-label">{kpi.k}</div>
                            </div>
                        ))}
                    </div>
                    <div className="rmp-bench-rows">
                        {(result.scenarios || []).map((s, i) => (
                            <div key={i} className={`rmp-bench-row rmp-bench-row--${s.ok ? "ok" : "fail"}`}>
                                <span className="rmp-bench-num">{i + 1}.</span>
                                <span className="rmp-bench-dot" style={{ background: s.ok ? "#10b981" : "#ef4444" }} />
                                <span className="rmp-bench-goal">{s.name}</span>
                                <span className="rmp-bench-val">{s.value}</span>
                                <span className="rmp-bench-ms">{formatMs(s.elapsedMs)}</span>
                                {s.error && <span className="rmp-bench-err">{s.error}</span>}
                            </div>
                        ))}
                    </div>
                </>
            )}
            {result?.error && <div className="rmp-err" style={{ margin: 16 }}>{result.error}</div>}
            {!result && !running && (
                <div className="rmp-empty">Click "Run 10 Scenarios" to validate ACP-9 components</div>
            )}
        </div>
    );
}

// ── Statistics view ───────────────────────────────────────────────────────────

function StatsView({ stats }) {
    if (!stats) return <div className="rmp-empty">Build the map first</div>;
    if (!stats.cached) return <div className="rmp-empty">No cached map — click Build Map</div>;

    const tiles = [
        { k: "Total Files",     v: stats.totalFiles,       c: "#d1d5db" },
        { k: "Code Files",      v: stats.codeFiles,        c: "#60a5fa" },
        { k: "Import Edges",    v: stats.totalEdges,       c: "#60a5fa" },
        { k: "Circular Deps",   v: stats.circularDeps,     c: stats.circularDeps > 0 ? "#ef4444" : "#10b981" },
        { k: "Hotspot Files",   v: stats.hotspots,         c: "#f59e0b" },
        { k: "Total Smells",    v: stats.totalSmells,      c: "#a78bfa" },
        { k: "Decisions",       v: stats.totalDecisions,   c: "#f59e0b" },
        { k: "Critical Files",  v: stats.criticalPathCount, c: "#ef4444" },
        { k: "Health Score",    v: `${stats.healthScore || 0}%`, c: "#10b981" },
    ];

    return (
        <div className="rmp-stats">
            <div className="rmp-stats-grid">
                {tiles.map(t => (
                    <div key={t.k} className="rmp-stats-tile">
                        <div className="rmp-stats-val" style={{ color: t.c }}>{t.v ?? 0}</div>
                        <div className="rmp-stats-label">{t.k}</div>
                    </div>
                ))}
            </div>

            {stats.typeBreakdown && (
                <div className="rmp-stats-section">
                    <div className="rmp-stats-section-label">Module Breakdown</div>
                    {Object.entries(stats.typeBreakdown).map(([type, count]) => (
                        <div key={type} className="rmp-type-row">
                            <span className="rmp-type-name">{type}</span>
                            <div className="rmp-type-bar-wrap">
                                <div className="rmp-type-bar"
                                    style={{ width: `${Math.min(100, count / (stats.totalFiles || 1) * 100 * 5)}%` }} />
                            </div>
                            <span className="rmp-type-count">{count}</span>
                        </div>
                    ))}
                </div>
            )}

            {stats.mostHotFile && (
                <div className="rmp-stats-section">
                    <div className="rmp-stats-section-label">Most Modified</div>
                    <div className="rmp-hot-row">
                        <span className="rmp-hot-file">{stats.mostHotFile}</span>
                        <span className="rmp-hot-commits">{stats.mostHotCommits} commits</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Hotspots view ─────────────────────────────────────────────────────────────

function HotspotsView({ data }) {
    if (!data) return <div className="rmp-empty">Build map to see hotspots</div>;
    const { hotspots = [], hotFiles = [], cycles = [] } = data;

    return (
        <div className="rmp-hotspots">
            <div className="rmp-hs-section-label">Top Hot Files (git + smell + risk)</div>
            {hotspots.slice(0, 15).map((h, i) => (
                <div key={h.id} className="rmp-hs-row">
                    <span className="rmp-hs-rank">{i + 1}</span>
                    <span className="rmp-hs-dot" style={{ background: h.color }} />
                    <span className="rmp-hs-path">{h.path}</span>
                    <span className="rmp-hs-score" style={{ color: h.hotScore > 50 ? "#ef4444" : "#f59e0b" }}>
                        {Math.round(h.hotScore)}
                    </span>
                    <span className="rmp-hs-commits">{h.commits}c</span>
                    {h.smellCount > 0 && <span className="rmp-hs-smells">{h.smellCount}s</span>}
                    {h.inCycle && <span className="rmp-hs-cycle">⚠</span>}
                </div>
            ))}

            {cycles.length > 0 && (
                <>
                    <div className="rmp-hs-section-label" style={{ marginTop: 12 }}>Circular Dependencies ({cycles.length})</div>
                    {cycles.slice(0, 5).map((cycle, i) => (
                        <div key={i} className="rmp-cycle-row">
                            <span className="rmp-cycle-tag">Cycle {i + 1}</span>
                            <span className="rmp-cycle-files">{cycle.join(" → ")}</span>
                        </div>
                    ))}
                </>
            )}

            {hotFiles.length > 0 && (
                <>
                    <div className="rmp-hs-section-label" style={{ marginTop: 12 }}>Most Committed (90 days)</div>
                    {hotFiles.slice(0, 10).map((h, i) => (
                        <div key={i} className="rmp-hs-row">
                            <span className="rmp-hs-rank">{i + 1}</span>
                            <span className="rmp-hs-path">{h.file}</span>
                            <span className="rmp-hs-commits" style={{ color: "#f59e0b" }}>{h.commits}</span>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const VIEWS = ["graph", "stats", "hotspots", "critical", "benchmark"];

export default function RepositoryMapPanel() {
    const [view,        setView]      = useState("graph");
    const [graphMode,   setGraphMode] = useState("dependency"); // dependency | module | impact | ownership
    const [heatMode,    setHeatMode]  = useState("none");       // none | commits | risk | smells
    const [mapData,     setMapData]   = useState(null);
    const [modGraph,    setModGraph]  = useState(null);
    const [depGraph,    setDepGraph]  = useState(null);
    const [hotspots,    setHotspots]  = useState(null);
    const [critPaths,   setCritPaths] = useState(null);
    const [stats,       setStats]     = useState(null);
    const [building,    setBuilding]  = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [highlightIds, setHighlightIds] = useState(null);
    const [aiQuery,     setAiQuery]   = useState("");
    const [aiLoading,   setAiLoading] = useState(false);
    const [aiResult,    setAiResult]  = useState(null);
    const [search,      setSearch]    = useState("");
    const [positions,   setPositions] = useState({});
    const [transform,   setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const [dragging,    setDragging]  = useState(false);
    const [dragStart,   setDragStart] = useState(null);
    const svgRef = useRef();

    // Initial stats load
    useEffect(() => {
        API("GET", "/repo-viz/stats").then(r => r.stats?.cached && setStats(r.stats));
    }, []);

    const buildMap = useCallback(async () => {
        setBuilding(true);
        setAiResult(null);
        setHighlightIds(null);
        try {
            const r = await API("POST", "/repo-viz/map", {});
            if (r.ok) {
                setMapData(r.map);
                setPositions(layoutNodes(r.map.nodes));
                // pre-fetch graphs
                const [mg, dg, hs, cp, st] = await Promise.all([
                    API("GET", "/repo-viz/module-graph"),
                    API("GET", "/repo-viz/dep-graph?maxNodes=80"),
                    API("GET", "/repo-viz/hotspots"),
                    API("GET", "/repo-viz/critical-paths"),
                    API("GET", "/repo-viz/stats"),
                ]);
                setModGraph(mg);
                setDepGraph(dg);
                setHotspots(hs);
                setCritPaths(cp);
                setStats(st.stats);
            }
        } catch {}
        setBuilding(false);
    }, []);

    // Zoom handlers
    const onWheel = useCallback(e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setTransform(t => ({ ...t, scale: Math.max(0.2, Math.min(4, t.scale * delta)) }));
    }, []);

    const onMouseDown = e => {
        if (e.button !== 0) return;
        setDragging(true);
        setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    };
    const onMouseMove = e => {
        if (!dragging || !dragStart) return;
        setTransform(t => ({ ...t, x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }));
    };
    const onMouseUp = () => { setDragging(false); setDragStart(null); };

    const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

    // AI Navigation
    const runAiNav = async () => {
        if (!aiQuery.trim()) return;
        setAiLoading(true);
        try {
            const r = await API("POST", "/repo-viz/ai-nav", { query: aiQuery });
            setAiResult(r);
            if (r.nodes?.length) setHighlightIds(new Set(r.nodes.map(n => n.id)));
        } catch {}
        setAiLoading(false);
    };

    const clearHighlight = () => { setHighlightIds(null); setAiResult(null); setAiQuery(""); };

    // Search
    const filteredNodes = search
        ? (activeNodes().filter(n => n.path.toLowerCase().includes(search.toLowerCase())))
        : activeNodes();

    function activeNodes() {
        if (graphMode === "module") return modGraph?.nodes || [];
        if (graphMode === "dependency") return depGraph?.nodes || mapData?.nodes || [];
        return mapData?.nodes || [];
    }
    function activeEdges() {
        if (graphMode === "module") return modGraph?.edges || [];
        if (graphMode === "dependency") return depGraph?.edges || mapData?.edges || [];
        return mapData?.edges || [];
    }

    const graphNodes = search ? filteredNodes : activeNodes();
    const graphEdges = search ? activeEdges().filter(e =>
        filteredNodes.some(n => n.id === e.source) || filteredNodes.some(n => n.id === e.target)
    ) : activeEdges();

    return (
        <div className="rmp-root">
            {/* Header */}
            <div className="rmp-header">
                <span className="rmp-header-title">
                    <span className="rmp-header-icon">◈</span> REPOSITORY MAP
                    {mapData && <span className="rmp-built-at">Built {new Date(mapData.builtAt).toLocaleTimeString()}</span>}
                </span>
                <div className="rmp-header-tabs">
                    {VIEWS.map(v => (
                        <button key={v} className={`rmp-hdr-tab ${view === v ? "rmp-hdr-tab--active" : ""}`}
                            onClick={() => setView(v)}>
                            {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                    ))}
                </div>
                <button className="rmp-build-btn" onClick={buildMap} disabled={building}>
                    {building ? "Building…" : "Build Map"}
                </button>
            </div>

            {/* Graph view */}
            {view === "graph" && (
                <div className="rmp-graph-root">
                    {/* Toolbar */}
                    <div className="rmp-toolbar">
                        <div className="rmp-toolbar-left">
                            <span className="rmp-toolbar-label">Mode:</span>
                            {["dependency", "module", "ownership"].map(m => (
                                <button key={m} className={`rmp-tool-btn ${graphMode === m ? "rmp-tool-btn--active" : ""}`}
                                    onClick={() => setGraphMode(m)}>
                                    {m}
                                </button>
                            ))}
                            <span className="rmp-toolbar-sep" />
                            <span className="rmp-toolbar-label">Heat:</span>
                            {["none", "commits", "risk", "smells"].map(h => (
                                <button key={h} className={`rmp-tool-btn ${heatMode === h ? "rmp-tool-btn--active" : ""}`}
                                    onClick={() => setHeatMode(h)}>
                                    {h}
                                </button>
                            ))}
                        </div>
                        <div className="rmp-toolbar-right">
                            <input className="rmp-search"
                                placeholder="Search files…"
                                value={search}
                                onChange={e => setSearch(e.target.value)} />
                            <button className="rmp-tool-btn" onClick={resetView}>Reset</button>
                            <span className="rmp-zoom-label">{Math.round(transform.scale * 100)}%</span>
                        </div>
                    </div>

                    {/* AI Navigation */}
                    <div className="rmp-ai-bar">
                        <span className="rmp-ai-label">AI Nav:</span>
                        <input className="rmp-ai-input"
                            placeholder="Show me authentication… deployment… auth middleware…"
                            value={aiQuery}
                            onChange={e => setAiQuery(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && runAiNav()} />
                        <button className="rmp-ai-btn" onClick={runAiNav} disabled={aiLoading || !mapData}>
                            {aiLoading ? "…" : "Navigate"}
                        </button>
                        {aiResult && (
                            <span className="rmp-ai-result">
                                {aiResult.nodes?.length} files · {aiResult.explanation?.slice(0, 60)}
                            </span>
                        )}
                        {highlightIds && (
                            <button className="rmp-clear-btn" onClick={clearHighlight}>Clear</button>
                        )}
                    </div>

                    {/* Main graph area */}
                    <div className="rmp-graph-area">
                        {!mapData && !building && (
                            <div className="rmp-graph-empty">
                                <div className="rmp-graph-empty-icon">◈</div>
                                <div className="rmp-graph-empty-text">Click "Build Map" to scan the repository</div>
                                <div className="rmp-graph-empty-sub">
                                    Reuses: ACP-6 deps · Q1 KG · Q2 Reasoning · ACP-3 Smells · ACP-4 Decisions
                                </div>
                                <button className="rmp-build-btn-big" onClick={buildMap}>Build Repository Map</button>
                            </div>
                        )}
                        {building && (
                            <div className="rmp-graph-empty">
                                <div className="rmp-spinner" />
                                <div className="rmp-graph-empty-text">Scanning repository…</div>
                                <div className="rmp-graph-empty-sub">Walking files · Building dep graph · Fetching git history · Overlaying smells</div>
                            </div>
                        )}
                        {mapData && !building && (
                            <svg
                                ref={svgRef}
                                className="rmp-svg"
                                onWheel={onWheel}
                                onMouseDown={onMouseDown}
                                onMouseMove={onMouseMove}
                                onMouseUp={onMouseUp}
                                onMouseLeave={onMouseUp}
                                style={{ cursor: dragging ? "grabbing" : "grab" }}>
                                <defs>
                                    <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                                        <path d="M0,0 L0,6 L6,3 z" fill="#374151" />
                                    </marker>
                                </defs>
                                <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
                                    <SVGGraph
                                        nodes={graphNodes}
                                        edges={graphEdges}
                                        positions={positions}
                                        selectedId={selectedNode?.id}
                                        highlightIds={highlightIds}
                                        heatMode={heatMode}
                                        onNodeClick={n => setSelectedNode(n)}
                                    />
                                </g>
                            </svg>
                        )}
                    </div>

                    {/* Status bar */}
                    {mapData && (
                        <div className="rmp-status-bar">
                            <span>{graphNodes.length} nodes · {graphEdges.length} edges</span>
                            {mapData.stats.circularDeps > 0 && (
                                <span className="rmp-status-danger">⚠ {mapData.stats.circularDeps} circular</span>
                            )}
                            <span>{mapData.stats.hotspots} hotspots</span>
                            <span>{mapData.stats.totalSmells} smells</span>
                            {highlightIds && <span className="rmp-status-highlight">{highlightIds.size} highlighted</span>}
                            <span className="rmp-status-hint">Scroll to zoom · Drag to pan · Click node for detail</span>
                        </div>
                    )}

                    {/* Legend */}
                    {mapData && (
                        <div className="rmp-legend">
                            {[
                                { c: "#60a5fa", l: "Routes" }, { c: "#10b981", l: "Services" },
                                { c: "#f59e0b", l: "Middleware" }, { c: "#a78bfa", l: "Models" },
                                { c: "#ec4899", l: "Frontend" }, { c: "#ef4444", l: "Auth" },
                                { c: "#ef4444", l: "Circular", dashed: true }, { c: "#f59e0b", l: "Hot", ring: true },
                            ].map(item => (
                                <div key={item.l} className="rmp-legend-item">
                                    <svg width={12} height={12}>
                                        <circle cx={6} cy={6} r={5}
                                            fill={item.dashed ? "none" : `${item.c}40`}
                                            stroke={item.c}
                                            strokeWidth={item.dashed ? 1 : 1.5}
                                            strokeDasharray={item.dashed ? "2 1" : "none"}
                                        />
                                    </svg>
                                    <span className="rmp-legend-label">{item.l}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {view === "stats" && (
                <div className="rmp-content">
                    <StatsView stats={stats} />
                </div>
            )}

            {view === "hotspots" && (
                <div className="rmp-content">
                    <HotspotsView data={hotspots} />
                </div>
            )}

            {view === "critical" && (
                <div className="rmp-content rmp-critical">
                    {!critPaths ? (
                        <div className="rmp-empty">Build map to see critical paths</div>
                    ) : (
                        <>
                            <div className="rmp-crit-label">Critical Files (most imported)</div>
                            {(critPaths.criticalFiles || []).map(f => (
                                <div key={f.id} className={`rmp-crit-row ${f.isCritical ? "rmp-crit-row--critical" : ""}`}>
                                    <span className="rmp-crit-dot" style={{ background: f.color }} />
                                    <span className="rmp-crit-path">{f.path}</span>
                                    <span className="rmp-crit-dep">{f.dependents} dep</span>
                                    <span className="rmp-crit-risk" style={{ color: f.riskScore > 50 ? "#ef4444" : "#f59e0b" }}>
                                        {f.riskScore}%
                                    </span>
                                    {f.isCritical && <span className="rmp-crit-tag">CRITICAL</span>}
                                </div>
                            ))}
                            {critPaths.singlePointsOfFailure?.length > 0 && (
                                <>
                                    <div className="rmp-crit-label" style={{ marginTop: 12 }}>Single Points of Failure</div>
                                    {critPaths.singlePointsOfFailure.map((s, i) => (
                                        <div key={i} className="rmp-crit-row rmp-crit-row--spof">
                                            <span className="rmp-crit-path">{typeof s === 'string' ? s : JSON.stringify(s)}</span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </>
                    )}
                </div>
            )}

            {view === "benchmark" && <BenchmarkView onBack={() => setView("graph")} />}

            {/* Node detail sidebar */}
            {selectedNode && view === "graph" && (
                <NodeDetail nodeId={selectedNode.id} onClose={() => setSelectedNode(null)} />
            )}
        </div>
    );
}
