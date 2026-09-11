import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
const SmellsPanel       = lazy(() => import("./SmellsPanel"));
const DecisionsPanel    = lazy(() => import("./DecisionsPanel"));
const TechDebtDashboard = lazy(() => import("./TechDebtDashboard"));
const BundlePreviewPanel = lazy(() => import("./BundlePreviewPanel"));
const ComposerPanel         = lazy(() => import("./ComposerPanel"));
const AutonomousAgentPanel  = lazy(() => import("./AutonomousAgentPanel"));
const RepositoryMapPanel      = lazy(() => import("./RepositoryMapPanel"));
const EngineeringMemoryPanel  = lazy(() => import("./EngineeringMemoryPanel"));
const SelfImprovementPanel      = lazy(() => import("./SelfImprovementPanel"));
const AutonomousPlatformPanel   = lazy(() => import("./AutonomousPlatformPanel"));
import { _fetch } from "../_client";
import "./AutonomousAgentDashboard.css";

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dur(secs) {
    if (!secs && secs !== 0) return "—";
    if (secs < 60)   return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
}

function _ago(iso) {
    if (!iso) return "never";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 5)  return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

const STATUS_COLOR = {
    running:    "var(--success)",
    paused:     "var(--warning)",
    recovering: "#a78bfa",
    failed:     "var(--danger)",
    stopped:    "var(--text-dim)",
    starting:   "#3b82f6",
};

const ROLE_LABEL = {
    planner:       "Planner",
    reviewer:      "Reviewer",
    verifier:      "Verifier",
    developer:     "Developer",
    tester:        "Tester",
    security:      "Security",
    documentation: "Documentation",
    crm:           "CRM",
    marketing:     "Marketing",
    executive:     "Executive",
};
const ROLE_ICON = {
    planner:       "◈",
    reviewer:      "✎",
    verifier:      "✔",
    developer:     "⌨",
    tester:        "⚗",
    security:      "⛨",
    documentation: "📋",
    crm:           "👥",
    marketing:     "📣",
    executive:     "★",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ status }) {
    const color = STATUS_COLOR[status] || "var(--text-dim)";
    return (
        <span className="aad-pill" style={{ background: color + "22", color, borderColor: color + "55" }}>
            <span className="aad-pill-dot" style={{ background: color }} />
            {status}
        </span>
    );
}

function HealthBar({ health }) {
    const color = health >= 70 ? "var(--success)" : health >= 40 ? "var(--warning)" : "var(--danger)";
    return (
        <div className="aad-healthbar">
            <div className="aad-healthbar-fill" style={{ width: `${health}%`, background: color }} />
            <span className="aad-healthbar-label" style={{ color }}>{health}%</span>
        </div>
    );
}

function MetricCell({ label, value, color }) {
    return (
        <div className="aad-metric">
            <div className="aad-metric-val" style={{ color: color || "var(--text)" }}>{value ?? "—"}</div>
            <div className="aad-metric-lbl">{label}</div>
        </div>
    );
}

function _fmtMs(ms) {
    if (!ms && ms !== 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function _fmtKb(kb) {
    if (!kb && kb !== 0) return "—";
    if (kb < 1024) return `${kb}KB`;
    return `${(kb / 1024).toFixed(1)}MB`;
}

// Domain-specific metric for a role (missions created, lessons, verifies, etc.)
function DomainMetric({ agent }) {
    const role = agent.role;
    if (role === "planner" || role === "developer" || role === "security" ||
        role === "crm" || role === "marketing" || role === "executive" || role === "tester")
        return <MetricCell label="Missions" value={agent.missionsCreated} color="var(--success)" />;
    if (role === "reviewer" || role === "documentation")
        return <MetricCell label="Lessons" value={agent.lessonsRegistered} color="var(--success)" />;
    if (role === "verifier")
        return <MetricCell label="Verifies" value={agent.verificationsRun} color="#3b82f6" />;
    return null;
}

function AgentCard({ agent, onPause, onResume, onTick, onEnable, onDisable, pausing, resuming, ticking, enabling, disabling }) {
    const role  = agent.role;
    const color = STATUS_COLOR[agent.status] || "var(--text-dim)";
    const disabled = agent.enabled === false;

    return (
        <div className="aad-card" style={{ borderLeft: `3px solid ${color}`, opacity: disabled ? 0.6 : 1 }}>
            <div className="aad-card-header">
                <div className="aad-card-title">
                    <span className="aad-role-icon">{ROLE_ICON[role] || "◉"}</span>
                    <span className="aad-role-name">{agent.label || ROLE_LABEL[role] || role}</span>
                    <span className="aad-agent-id">{agent.id}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {disabled && <span style={{ fontSize: 10, color: "var(--text-dim)", border: "1px solid #6b728055", borderRadius: 4, padding: "1px 5px" }}>disabled</span>}
                    <StatusPill status={agent.status} />
                </div>
            </div>

            <HealthBar health={agent.health ?? 0} />

            {agent.description && (
                <div style={{ fontSize: 10, color: "var(--text-dim, #94a3b8)", lineHeight: 1.4 }}>{agent.description}</div>
            )}

            {agent.currentObjective && (
                <div className="aad-objective">
                    <span className="aad-objective-label">Objective:</span>
                    {agent.currentObjective}
                </div>
            )}

            {agent.lastDecision && (
                <div className="aad-decision">
                    <span className="aad-decision-label">Last decision:</span>
                    {agent.lastDecision}
                    {agent.lastDecisionAt && (
                        <span className="aad-decision-time">{_ago(agent.lastDecisionAt)}</span>
                    )}
                </div>
            )}

            {/* Primary metrics row */}
            <div className="aad-metrics-row">
                <MetricCell label="Uptime"    value={_dur(agent.uptime)} />
                <MetricCell label="Ticks"     value={agent.tickCount} />
                <MetricCell label="Success"   value={agent.successRate != null ? `${agent.successRate}%` : "—"} color={agent.successRate >= 80 ? "var(--success)" : agent.successRate >= 50 ? "var(--warning)" : "var(--danger)"} />
                <MetricCell label="Recovery"  value={agent.recoveryCount} color={agent.recoveryCount > 0 ? "var(--warning)" : undefined} />
            </div>

            {/* Secondary metrics row — resource + domain */}
            <div className="aad-metrics-row">
                <MetricCell label="CPU"       value={_fmtMs(agent.cpuMs)} />
                <MetricCell label="Mem"       value={_fmtKb(agent.memKb)} />
                <MetricCell label="Interval"  value={agent.intervalMs ? `${agent.intervalMs/1000}s` : "—"} />
                <DomainMetric agent={agent} />
            </div>

            {/* Next execution */}
            {agent.nextTickAt && (
                <div style={{ fontSize: 10, color: "var(--text-dim, #94a3b8)" }}>
                    Next tick: {_ago(agent.nextTickAt).startsWith("-") ? "now" : _ago(agent.nextTickAt)}
                    {" · "}Last: {_ago(agent.lastTickAt)}
                </div>
            )}

            {agent.recentErrors?.length > 0 && (
                <div className="aad-errors">
                    {agent.recentErrors.map((e, i) => (
                        <div key={i} className="aad-error-row">
                            <span className="aad-error-dot">✕</span>
                            <span className="aad-error-msg">{e.message?.slice(0, 80)}</span>
                            <span className="aad-error-ts">{_ago(e.ts)}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="aad-card-actions">
                {agent.status === "running" && (
                    <button className="aad-btn aad-btn--warn" onClick={() => onPause(agent.id)} disabled={pausing}>
                        {pausing ? "…" : "Pause"}
                    </button>
                )}
                {(agent.status === "paused" || agent.status === "stopped") && !disabled && (
                    <button className="aad-btn aad-btn--ok" onClick={() => onResume(agent.id)} disabled={resuming}>
                        {resuming ? "…" : "Resume"}
                    </button>
                )}
                <button className="aad-btn aad-btn--ghost" onClick={() => onTick(agent.id)} disabled={ticking || disabled}>
                    {ticking ? "…" : "Force Tick"}
                </button>
                {!disabled
                    ? <button className="aad-btn aad-btn--danger" onClick={() => onDisable(agent.id)} disabled={disabling} title="Disable agent">
                        {disabling ? "…" : "Disable"}
                    </button>
                    : <button className="aad-btn aad-btn--ok" onClick={() => onEnable(agent.id)} disabled={enabling} title="Enable agent">
                        {enabling ? "…" : "Enable"}
                    </button>
                }
            </div>
        </div>
    );
}

// ── I6: Collaboration panel sub-components ────────────────────────────────────

const HANDOFF_STATUS_COLOR = {
    pending:   "var(--warning)",
    claimed:   "#3b82f6",
    accepted:  "#8b5cf6",
    running:   "var(--success)",
    completed: "var(--success)",
    failed:    "var(--danger)",
    rejected:  "var(--danger)",
};

function CollabStatBar({ stats }) {
    if (!stats) return null;
    return (
        <div className="aad-collab-summary">
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "#3b82f6" }}>{stats.activePlans ?? 0}</span>
                <span className="aad-collab-stat-lbl">Active</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "var(--success)" }}>{stats.completedPlans ?? 0}</span>
                <span className="aad-collab-stat-lbl">Completed</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val">{stats.handoffsTotal ?? 0}</span>
                <span className="aad-collab-stat-lbl">Handoffs</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "var(--success)" }}>{stats.handoffsCompleted ?? 0}</span>
                <span className="aad-collab-stat-lbl">Done</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "var(--warning)" }}>{stats.handoffsRetried ?? 0}</span>
                <span className="aad-collab-stat-lbl">Retried</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "#a78bfa" }}>{stats.parallelGroupsExecuted ?? 0}</span>
                <span className="aad-collab-stat-lbl">Parallel</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "var(--danger)" }}>{stats.recoveryMissionsCreated ?? 0}</span>
                <span className="aad-collab-stat-lbl">Recoveries</span>
            </div>
        </div>
    );
}

function AgentChip({ agentId, stageStatus }) {
    const cls = stageStatus === "running" ? "active" : stageStatus === "completed" ? "done" : stageStatus === "failed" ? "failed" : "pending";
    return <span className={`aad-chain-agent ${cls}`}>{ROLE_ICON[agentId?.replace("agent_", "")] || "◉"} {ROLE_LABEL[agentId?.replace("agent_", "")] || agentId}</span>;
}

function CollabChainCard({ collab }) {
    const order = collab.executionOrder || [];
    const groups = collab.parallelGroups || [];
    const current = collab.currentStage;

    return (
        <div className="aad-collab-card" style={{ borderLeft: collab.status === "active" ? "3px solid #3b82f6" : collab.status === "waiting_approval" ? "3px solid var(--warning)" : "3px solid var(--success)" }}>
            <div className="aad-collab-card-header">
                <div>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>Mission Collaboration</span>
                    <span className="aad-collab-mission-id"> · {collab.missionId}</span>
                </div>
                <StatusPill status={collab.status === "waiting_approval" ? "paused" : collab.status === "active" ? "running" : "stopped"} />
            </div>

            {/* Owner */}
            {collab.currentOwner && (
                <div style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)" }}>
                    Owner: <span style={{ color: "var(--text, #e2e8f0)", fontWeight: 600 }}>{ROLE_LABEL[collab.currentOwner?.replace("agent_", "")] || collab.currentOwner}</span>
                    {current && <span> · Stage: {current.stage}</span>}
                </div>
            )}

            {/* Sequential chain */}
            {order.length > 0 && (
                <div className="aad-chain">
                    {order.map((stage, i) => (
                        <React.Fragment key={stage.stage}>
                            <AgentChip agentId={stage.agentId} stageStatus={stage.status} />
                            {i < order.length - 1 && <span className="aad-chain-arrow">→</span>}
                        </React.Fragment>
                    ))}
                </div>
            )}

            {/* Parallel groups */}
            {groups.filter(g => g.agents?.length > 0).map(grp => (
                <div key={grp.groupId} className="aad-parallel-group">
                    <div className="aad-parallel-group-label">⇉ Parallel: {grp.description || grp.groupId}</div>
                    <div className="aad-parallel-agents">
                        {grp.agents.map(agentId => (
                            <AgentChip key={agentId} agentId={agentId} stageStatus={grp.status === "completed" ? "completed" : grp.status === "running" ? "running" : "pending"} />
                        ))}
                    </div>
                </div>
            ))}

            {/* Pending handoffs */}
            {collab.pendingHandoffs > 0 && (
                <div style={{ fontSize: 11, color: "var(--warning)" }}>⏳ {collab.pendingHandoffs} pending handoff(s)</div>
            )}

            {/* Approval gate */}
            {collab.status === "waiting_approval" && (
                <div style={{ fontSize: 11, padding: "5px 8px", background: "#f59e0b11", borderRadius: 4, color: "var(--warning)" }}>
                    ⚠ Waiting for approval gate
                </div>
            )}
        </div>
    );
}

function CollaborationTab() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const [activeR, blockedR, stalledR, statsR] = await Promise.all([
                _fetch("/collab/active"),
                _fetch("/collab/blocked"),
                _fetch("/collab/stalled"),
                _fetch("/collab/stats"),
            ]);
            setData({
                collaborations: activeR?.collaborations || [],
                blocked:        blockedR?.blocked || [],
                stalled:        stalledR?.stalled || [],
                stats:          statsR?.stats || null,
            });
            setError(null);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        pollRef.current = setInterval(load, 15_000);
        return () => clearInterval(pollRef.current);
    }, [load]);

    if (loading && !data) return <div className="aad-loading">Loading collaboration data…</div>;
    if (error) return <div className="aad-error-banner">{error}</div>;

    const { collaborations = [], blocked = [], stalled = [], stats } = data || {};

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CollabStatBar stats={stats} />

            {/* Blocked chains */}
            {blocked.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="aad-collab-section-title">Blocked Chains ({blocked.length})</div>
                    {blocked.map(chain => (
                        <div key={chain.missionId} className="aad-alert-row danger">
                            <span className="aad-alert-icon">⛔</span>
                            <div className="aad-alert-body">
                                <div className="aad-alert-title">Mission {chain.missionId} — Stage "{chain.blockedStage?.stage}"</div>
                                <div className="aad-alert-meta">Owner: {ROLE_LABEL[chain.currentOwner?.replace("agent_","")]||chain.currentOwner} · Blocked since: {_ago(chain.blockedSince)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Stalled handoffs */}
            {stalled.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="aad-collab-section-title">Stalled Handoffs ({stalled.length})</div>
                    {stalled.map(h => (
                        <div key={h.handoffId} className="aad-alert-row warn">
                            <span className="aad-alert-icon">⏳</span>
                            <div className="aad-alert-body">
                                <div className="aad-alert-title">{h.fromAgent || "origin"} → {ROLE_LABEL[h.toAgent?.replace("agent_","")]||h.toAgent}</div>
                                <div className="aad-alert-meta">Mission: {h.missionId} · Pending {_ago(h.createdAt)} · Retries: {h.retries}/{h.maxRetries}</div>
                            </div>
                            <span className="aad-handoff-status" style={{ background: "#f59e0b22", color: "var(--warning)" }}>{h.status}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Active collaborations */}
            <div className="aad-collab-section-title">Active Collaborations ({collaborations.length})</div>
            {collaborations.length === 0 && (
                <div className="aad-empty">No active multi-agent collaborations. Create a plan via POST /collab/plans/:missionId</div>
            )}
            <div className="aad-cards">
                {collaborations.map(c => <CollabChainCard key={c.missionId} collab={c} />)}
            </div>
        </div>
    );
}

// ── I7: Pipeline Dashboard sub-components ─────────────────────────────────────

const STAGE_ICON = {
    repo_read:      "📂", repo_analysis: "🔍", patch_generate: "✏",
    patch_validate: "✓",  patch_apply:   "⚡", build_gate:    "🏗",
    test_gate:      "⚗",  review_gate:   "👁", commit_gate:   "🔏",
    observe:        "📊",  learn:         "🧠",
};

const STAGE_STATUS_COLOR = {
    completed: "var(--success)",
    running:   "#3b82f6",
    failed:    "var(--danger)",
    pending:   "var(--text-dim)",
};

function PipelineStageRow({ stage }) {
    const color = STAGE_STATUS_COLOR[stage.status] || "var(--text-dim)";
    return (
        <div className="aad-handoff-row" style={{ borderLeft: `2px solid ${color}`, gap: 8 }}>
            <span style={{ fontSize: 13 }}>{STAGE_ICON[stage.id] || "◉"}</span>
            <span style={{ flex: 1, fontWeight: stage.status === "running" ? 600 : 400 }}>{stage.label}</span>
            {stage.durationMs > 0 && <span style={{ fontSize: 10, color: "var(--text-dim, #94a3b8)" }}>{stage.durationMs}ms</span>}
            {stage.retries > 0 && <span style={{ fontSize: 10, color: "var(--warning)" }}>↺{stage.retries}</span>}
            {stage.gateResult && !stage.gateResult.ok && <span style={{ fontSize: 10, color: "var(--danger)" }}>BLOCKED</span>}
            <span className="aad-handoff-status" style={{ background: color + "22", color, borderColor: color + "55" }}>{stage.status}</span>
        </div>
    );
}

function PipelineCard({ pipeline }) {
    const [expanded, setExpanded] = useState(false);
    const statusColor = { completed: "var(--success)", running: "#3b82f6", failed: "var(--danger)", cancelled: "var(--text-dim)", pending: "var(--warning)" }[pipeline.status] || "var(--text-dim)";
    const progress = pipeline.stagesTotal > 0 ? Math.round(pipeline.stagesCompleted / pipeline.stagesTotal * 100) : 0;

    return (
        <div className="aad-collab-card" style={{ borderLeft: `3px solid ${statusColor}` }}>
            <div className="aad-collab-card-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pipeline.goal?.slice(0, 70)}
                    </div>
                    <div className="aad-collab-mission-id">{pipeline.pipelineId} · {pipeline.stagesCompleted}/{pipeline.stagesTotal} stages</div>
                </div>
                <span className="aad-handoff-status" style={{ background: statusColor + "22", color: statusColor }}>{pipeline.status}</span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: "var(--bg3, #27272a)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${progress}%`, background: statusColor, borderRadius: 2, transition: "width 0.4s ease" }} />
            </div>

            {/* Key metrics */}
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-dim, #94a3b8)", flexWrap: "wrap" }}>
                {pipeline.durationMs > 0 && <span>Duration: {Math.round(pipeline.durationMs / 1000)}s</span>}
                {pipeline.commitHash && <span style={{ color: "var(--success)" }}>Commit: {pipeline.commitHash}</span>}
                {pipeline.rollbackExecuted && <span style={{ color: "var(--warning)" }}>⎌ Rolled back</span>}
                {pipeline.failedStage && <span style={{ color: "var(--danger)" }}>Failed: {pipeline.failedStage}</span>}
                {pipeline.risk?.criticalDeps > 0 && <span style={{ color: "var(--warning)" }}>⚠ {pipeline.risk.criticalDeps} critical deps</span>}
                {pipeline.approvalStatus === "pending" && <span style={{ color: "#a78bfa" }}>⏳ Awaiting approval</span>}
            </div>

            {/* Stage list (collapsible) */}
            <button className="aad-btn aad-btn--ghost" style={{ fontSize: 11, padding: "3px 8px", alignSelf: "flex-start" }} onClick={() => setExpanded(e => !e)}>
                {expanded ? "▲ Hide stages" : "▼ Show stages"}
            </button>
            {expanded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                    {(pipeline.stages || []).map(s => <PipelineStageRow key={s.id} stage={s} />)}
                </div>
            )}
        </div>
    );
}

function PipelineTab() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [allPipes, setAll]    = useState([]);
    const [goal, setGoal]       = useState("");
    const [starting, setStarting] = useState(false);
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const [activeR, statsR, listR] = await Promise.all([
                _fetch("/pipeline/active"),
                _fetch("/pipeline/stats"),
                _fetch("/pipeline?limit=20"),
            ]);
            setData({ active: activeR?.pipelines || [], stats: statsR?.stats || null });
            setAll(listR?.pipelines || []);
            setError(null);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        pollRef.current = setInterval(load, 10_000);
        return () => clearInterval(pollRef.current);
    }, [load]);

    const handleStartPipeline = async () => {
        if (!goal.trim() || starting) return;
        setStarting(true);
        try {
            await _fetch("/pipeline/run", { method: "POST", body: JSON.stringify({ goal: goal.trim() }) });
            setGoal("");
            await load();
        } catch (e) { setError(e.message); }
        finally { setStarting(false); }
    };

    if (loading && !data) return <div className="aad-loading">Loading pipeline data…</div>;
    if (error) return <div className="aad-error-banner">{error}</div>;

    const { active = [], stats } = data || {};

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Start pipeline */}
            <div style={{ display: "flex", gap: 8 }}>
                <input
                    className="aad-input"
                    style={{ flex: 1 }}
                    placeholder="Describe an engineering goal to run through the pipeline…"
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleStartPipeline(); }}
                    disabled={starting}
                />
                <button className="aad-btn aad-btn--ok" onClick={handleStartPipeline} disabled={starting || !goal.trim()}>
                    {starting ? "Starting…" : "Start Pipeline"}
                </button>
            </div>

            {/* Stat bar */}
            {stats && (
                <div className="aad-collab-summary">
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#3b82f6" }}>{stats.active ?? 0}</span><span className="aad-collab-stat-lbl">Active</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--success)" }}>{stats.completed ?? 0}</span><span className="aad-collab-stat-lbl">Completed</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--danger)" }}>{stats.failed ?? 0}</span><span className="aad-collab-stat-lbl">Failed</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--warning)" }}>{stats.rollbacks ?? 0}</span><span className="aad-collab-stat-lbl">Rollbacks</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#a78bfa" }}>{stats.buildGateBlocked ?? 0}</span><span className="aad-collab-stat-lbl">Build⛔</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#a78bfa" }}>{stats.testGateBlocked ?? 0}</span><span className="aad-collab-stat-lbl">Test⛔</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--danger)" }}>{stats.recoveryMissionsCreated ?? 0}</span><span className="aad-collab-stat-lbl">Recoveries</span></div>
                </div>
            )}

            {active.length > 0 && (
                <div>
                    <div className="aad-collab-section-title">Running ({active.length})</div>
                    <div className="aad-cards" style={{ marginTop: 8 }}>
                        {active.map(p => <PipelineCard key={p.pipelineId} pipeline={p} />)}
                    </div>
                </div>
            )}

            <div className="aad-collab-section-title">Recent Pipelines ({allPipes.length})</div>
            {allPipes.length === 0 && (
                <div className="aad-empty">No pipelines yet. Enter a goal above to start one.</div>
            )}
            <div className="aad-cards">
                {allPipes.map(p => <PipelineCard key={p.pipelineId} pipeline={p} />)}
            </div>
        </div>
    );
}

// ── I8: Deployment Dashboard sub-components (I8-5) ────────────────────────────

const TARGET_COLOR = { development: "var(--success)", staging: "var(--warning)", production: "var(--danger)" };
const DEPLOY_STATUS_COLOR = { completed: "var(--success)", running: "#3b82f6", failed: "var(--danger)", cancelled: "var(--text-dim)", rolled_back: "var(--warning)", pending: "#94a3b8" };
const DEPLOY_STAGE_ICON = { pre_check: "🔍", deploy: "🚀", health_verify: "💚", service_check: "🔧", observe: "📊", learn: "🧠", rollback: "⎌" };

function DeploymentCard({ dep }) {
    const [expanded, setExpanded] = useState(false);
    const statusColor = DEPLOY_STATUS_COLOR[dep.status] || "var(--text-dim)";
    const targetColor = TARGET_COLOR[dep.target] || "#94a3b8";
    const progress    = dep.stagesTotal > 0 ? Math.round(dep.stagesCompleted / dep.stagesTotal * 100) : 0;
    const health      = dep.healthSnapshot?.score;

    return (
        <div className="aad-collab-card" style={{ borderLeft: `3px solid ${statusColor}` }}>
            <div className="aad-collab-card-header">
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {dep.goal?.slice(0, 70)}
                    </div>
                    <div className="aad-collab-mission-id">
                        {dep.deployId} · <span style={{ color: targetColor, fontWeight: 600 }}>{dep.target}</span>
                    </div>
                </div>
                <span className="aad-handoff-status" style={{ background: statusColor + "22", color: statusColor }}>{dep.status}</span>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: "var(--bg3, #27272a)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${progress}%`, background: statusColor, borderRadius: 2, transition: "width 0.4s ease" }} />
            </div>

            {/* Key metrics */}
            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-dim, #94a3b8)", flexWrap: "wrap" }}>
                {dep.durationMs > 0 && <span>Duration: {Math.round(dep.durationMs / 1000)}s</span>}
                {health !== null && health !== undefined && (
                    <span style={{ color: health >= 80 ? "var(--success)" : health >= 50 ? "var(--warning)" : "var(--danger)" }}>
                        Health: {health}%
                    </span>
                )}
                {dep.rollbackExecuted && <span style={{ color: "var(--warning)" }}>⎌ Rolled back: {dep.rollbackReason?.slice(0, 40)}</span>}
                {dep.failedStage && <span style={{ color: "var(--danger)" }}>Failed: {dep.failedStage}</span>}
                {dep.approvalStatus === "pending" && <span style={{ color: "#a78bfa" }}>⏳ Awaiting approval</span>}
                {dep.commitHash && <span style={{ color: "var(--success)" }}>Commit: {dep.commitHash.slice(0, 7)}</span>}
                {dep.recoveryMissionId && <span style={{ color: "#f87171" }}>Recovery mission created</span>}
            </div>

            <button className="aad-btn aad-btn--ghost" style={{ fontSize: 11, padding: "3px 8px", alignSelf: "flex-start" }} onClick={() => setExpanded(e => !e)}>
                {expanded ? "▲ Hide stages" : "▼ Show stages"}
            </button>
            {expanded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                    {(dep.stages || []).map(s => (
                        <div key={s.id} className="aad-handoff-row" style={{ borderLeft: `2px solid ${DEPLOY_STATUS_COLOR[s.status] || "var(--text-dim)"}`, gap: 8 }}>
                            <span style={{ fontSize: 13 }}>{DEPLOY_STAGE_ICON[s.id] || "◉"}</span>
                            <span style={{ flex: 1, fontWeight: s.status === "running" ? 600 : 400 }}>{s.label}</span>
                            {s.durationMs > 0 && <span style={{ fontSize: 10, color: "var(--text-dim, #94a3b8)" }}>{s.durationMs}ms</span>}
                            <span className="aad-handoff-status" style={{ background: (DEPLOY_STATUS_COLOR[s.status] || "var(--text-dim)") + "22", color: DEPLOY_STATUS_COLOR[s.status] || "var(--text-dim)" }}>{s.status}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function DeploymentTab() {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [allDeps, setAll]     = useState([]);
    const [targets, setTargets] = useState({});
    const [target, setTarget]   = useState("");
    const [goal, setGoal]       = useState("");
    const [starting, setStarting] = useState(false);
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const [activeR, statsR, listR, targR] = await Promise.all([
                _fetch("/deployment/active"),
                _fetch("/deployment/stats"),
                _fetch("/deployment?limit=20"),
                _fetch("/deployment/targets"),
            ]);
            setData({ active: activeR?.deployments || [], stats: statsR?.stats || null });
            setAll(listR?.deployments || []);
            setTargets(targR?.targets || {});
            setError(null);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        pollRef.current = setInterval(load, 12_000);
        return () => clearInterval(pollRef.current);
    }, [load]);

    useEffect(() => {
        const ids = Object.keys(targets);
        if (!target && ids.length > 0) setTarget(ids[0]);
    }, [targets, target]);

    const handleStartDeployment = async () => {
        if (!target || starting) return;
        setStarting(true);
        try {
            await _fetch("/deployment/run", { method: "POST", body: JSON.stringify({ target, goal: goal.trim() || undefined }) });
            setGoal("");
            await load();
        } catch (e) { setError(e.message); }
        finally { setStarting(false); }
    };

    if (loading && !data) return <div className="aad-loading">Loading deployment data…</div>;
    if (error) return <div className="aad-error-banner">{error}</div>;

    const { active = [], stats } = data || {};

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Start deployment */}
            {Object.keys(targets).length > 0 && (
                <div style={{ display: "flex", gap: 8 }}>
                    <select className="aad-input" value={target} onChange={e => setTarget(e.target.value)} disabled={starting}>
                        {Object.values(targets).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <input
                        className="aad-input"
                        style={{ flex: 1 }}
                        placeholder="Optional deployment goal/description…"
                        value={goal}
                        onChange={e => setGoal(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleStartDeployment(); }}
                        disabled={starting}
                    />
                    <button className="aad-btn aad-btn--ok" onClick={handleStartDeployment} disabled={starting || !target}>
                        {starting ? "Starting…" : "Deploy"}
                    </button>
                </div>
            )}

            {/* Deployment stat bar */}
            {stats && (
                <div className="aad-collab-summary">
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#3b82f6" }}>{stats.active ?? 0}</span><span className="aad-collab-stat-lbl">Active</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--success)" }}>{stats.completed ?? 0}</span><span className="aad-collab-stat-lbl">Completed</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--danger)" }}>{stats.failed ?? 0}</span><span className="aad-collab-stat-lbl">Failed</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "var(--warning)" }}>{stats.rolledBack ?? 0}</span><span className="aad-collab-stat-lbl">Rollbacks</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#a78bfa" }}>{stats.verificationFailed ?? 0}</span><span className="aad-collab-stat-lbl">Verify⛔</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#f87171" }}>{stats.recoveryMissionsCreated ?? 0}</span><span className="aad-collab-stat-lbl">Recoveries</span></div>
                    <div className="aad-collab-stat"><span className="aad-collab-stat-val" style={{ color: "#94a3b8" }}>{stats.avgVerifyMs ?? 0}ms</span><span className="aad-collab-stat-lbl">Avg Verify</span></div>
                </div>
            )}

            {/* Target profiles */}
            {Object.keys(targets).length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {Object.values(targets).map(t => (
                        <div key={t.id} style={{ padding: "4px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: (TARGET_COLOR[t.id] || "var(--text-dim)") + "22", color: TARGET_COLOR[t.id] || "var(--text-dim)", border: `1px solid ${(TARGET_COLOR[t.id] || "var(--text-dim)")}44` }}>
                            {t.label} · {t.requireApproval ? "Approval req" : "Auto"} · Health≥{t.healthThreshold}%
                        </div>
                    ))}
                </div>
            )}

            {active.length > 0 && (
                <div>
                    <div className="aad-collab-section-title">Active Deployments ({active.length})</div>
                    <div className="aad-cards" style={{ marginTop: 8 }}>
                        {active.map(d => <DeploymentCard key={d.deployId} dep={d} />)}
                    </div>
                </div>
            )}

            <div className="aad-collab-section-title">Deployment History ({allDeps.length})</div>
            {allDeps.length === 0 && (
                <div className="aad-empty">No deployments yet. Pick a target above to start one.</div>
            )}
            <div className="aad-cards">
                {allDeps.map(d => <DeploymentCard key={d.deployId} dep={d} />)}
            </div>
        </div>
    );
}

// ── Supervisor summary bar ────────────────────────────────────────────────────

function SupervisorBar({ status, onStart, onStop, loading }) {
    if (!status) return null;
    const uptime = status.supervisorUptime;
    const runningCount = status.runningCount;
    const total = status.agentCount;

    return (
        <div className="aad-supervisor-bar">
            <div className="aad-supervisor-left">
                <span className="aad-sup-title">Agent Runtime Supervisor</span>
                {status.started
                    ? <span className="aad-sup-state" style={{ color: "var(--success)" }}>● Running</span>
                    : <span className="aad-sup-state" style={{ color: "var(--text-dim)" }}>○ Stopped</span>
                }
                {status.started && (
                    <span className="aad-sup-meta">{runningCount}/{total} agents · uptime {_dur(uptime)}</span>
                )}
            </div>
            <div className="aad-supervisor-right">
                {!status.started
                    ? <button className="aad-btn aad-btn--ok" onClick={onStart} disabled={loading}>Start All</button>
                    : <button className="aad-btn aad-btn--danger" onClick={onStop}  disabled={loading}>Stop All</button>
                }
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AutonomousAgentDashboard() {
    const [status,   setStatus]   = useState(null);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState(null);
    const [busyMap,  setBusyMap]  = useState({}); // agentId → "pausing"|"resuming"|"ticking"
    const [activeTab, setActiveTab] = useState("agents");
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const r = await _fetch("/agents/runtime/supervisor");
            if (r?.ok) { setStatus(r); setError(null); }
            else        setError(r?.error || "Unknown error");
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        pollRef.current = setInterval(load, 10_000);
        return () => clearInterval(pollRef.current);
    }, [load]);

    const _action = async (agentId, busyKey, path, method = "POST") => {
        setBusyMap(m => ({ ...m, [agentId]: busyKey }));
        try {
            const r = await _fetch(path, { method });
            if (r?.ok) { setError(null); await load(); }
            else setError(r?.error || "Action failed");
        } catch (e) { setError(e.message || "Action failed"); }
        setBusyMap(m => { const n = { ...m }; delete n[agentId]; return n; });
    };

    const handlePause   = id => _action(id, "pausing",   `/agents/runtime/supervisor/${id}/pause`);
    const handleResume  = id => _action(id, "resuming",  `/agents/runtime/supervisor/${id}/resume`);
    const handleTick    = id => _action(id, "ticking",   `/agents/runtime/supervisor/${id}/tick`);
    const handleEnable  = id => _action(id, "enabling",  `/agents/runtime/registry/${id}/enable`);
    const handleDisable = id => _action(id, "disabling", `/agents/runtime/registry/${id}/disable`);

    const handleStart  = async () => {
        setLoading(true);
        try { await _fetch("/agents/runtime/supervisor/start", { method: "POST" }); setError(null); await load(); }
        catch (e) { setError(e.message || "Start failed"); setLoading(false); }
    };
    const handleStop   = async () => {
        setLoading(true);
        try { await _fetch("/agents/runtime/supervisor/stop", { method: "POST" }); setError(null); await load(); }
        catch (e) { setError(e.message || "Stop failed"); setLoading(false); }
    };

    if (loading && !status) return (
        <div className="aad-root"><div className="aad-loading">Connecting to Agent Runtime…</div></div>
    );

    const agents = status?.agents || [];

    return (
        <div className="aad-root">
            {/* Header */}
            <div className="aad-header">
                <div className="aad-header-title">Autonomous Agent Runtime</div>
                <div className="aad-header-sub">Phase I4–I8 — 10 Agents · Collaboration · Pipeline · Deployment & Production Ops</div>
                <button className="aad-btn aad-btn--ghost aad-refresh" onClick={load} disabled={loading}>
                    {loading ? "⟳" : "↻"} Refresh
                </button>
            </div>

            {error && <div className="aad-error-banner">{error}</div>}

            {/* Supervisor bar */}
            <SupervisorBar
                status={status}
                onStart={handleStart}
                onStop={handleStop}
                loading={loading}
            />

            {/* Tab navigation */}
            <div className="aad-tabs">
                <button className={`aad-tab ${activeTab === "agents" ? "active" : ""}`} onClick={() => setActiveTab("agents")}>
                    Agents {status ? `(${status.runningCount}/${status.agentCount})` : ""}
                </button>
                <button className={`aad-tab ${activeTab === "config" ? "active" : ""}`} onClick={() => setActiveTab("config")}>
                    Config
                </button>
                <button className={`aad-tab ${activeTab === "collaboration" ? "active" : ""}`} onClick={() => setActiveTab("collaboration")}>
                    Collaboration
                </button>
                <button className={`aad-tab ${activeTab === "pipeline" ? "active" : ""}`} onClick={() => setActiveTab("pipeline")}>
                    Pipeline (I7)
                </button>
                <button className={`aad-tab ${activeTab === "deployment" ? "active" : ""}`} onClick={() => setActiveTab("deployment")}>
                    Deploy (I8)
                </button>
                <button className={`aad-tab ${activeTab === "smells" ? "active" : ""}`} onClick={() => setActiveTab("smells")}>
                    Smells
                </button>
                <button className={`aad-tab ${activeTab === "decisions" ? "active" : ""}`} onClick={() => setActiveTab("decisions")}>
                    Decisions
                </button>
                <button className={`aad-tab ${activeTab === "debt" ? "active" : ""}`} onClick={() => setActiveTab("debt")}>
                    Debt
                </button>
                <button className={`aad-tab ${activeTab === "bundle" ? "active" : ""}`} onClick={() => setActiveTab("bundle")}>
                    Bundle
                </button>
                <button className={`aad-tab ${activeTab === "composer" ? "active" : ""}`} onClick={() => setActiveTab("composer")}>
                    Composer
                </button>
                <button className={`aad-tab ${activeTab === "autonomous" ? "active" : ""}`} onClick={() => setActiveTab("autonomous")}>
                    Autonomous
                </button>
                <button className={`aad-tab ${activeTab === "repository" ? "active" : ""}`} onClick={() => setActiveTab("repository")}>
                    Repository
                </button>
                <button className={`aad-tab ${activeTab === "memory" ? "active" : ""}`} onClick={() => setActiveTab("memory")}>
                    Memory
                </button>
                <button className={`aad-tab ${activeTab === "evolution" ? "active" : ""}`} onClick={() => setActiveTab("evolution")}>
                    Evolution
                </button>
                <button className={`aad-tab ${activeTab === "platform" ? "active" : ""}`} onClick={() => setActiveTab("platform")}>
                    Autonomous
                </button>
            </div>

            {/* Agents tab */}
            {activeTab === "agents" && (
                <div className="aad-cards">
                    {agents.length === 0 && (
                        <div className="aad-empty">No agents running. Click "Start All" to begin autonomous execution.</div>
                    )}
                    {agents.map(agent => (
                        <AgentCard
                            key={agent.id}
                            agent={agent}
                            onPause={handlePause}
                            onResume={handleResume}
                            onTick={handleTick}
                            onEnable={handleEnable}
                            onDisable={handleDisable}
                            pausing={busyMap[agent.id] === "pausing"}
                            resuming={busyMap[agent.id] === "resuming"}
                            ticking={busyMap[agent.id] === "ticking"}
                            enabling={busyMap[agent.id] === "enabling"}
                            disabling={busyMap[agent.id] === "disabling"}
                        />
                    ))}
                </div>
            )}

            {/* Config tab */}
            {activeTab === "config" && status?.config && (
                <div className="aad-config-strip" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>Confidence threshold: {status.config.confidenceThreshold}%</span>
                    <span style={{ fontWeight: 600 }}>Max recovery attempts: {status.config.maxRecoveryAttempts}</span>
                    <span style={{ fontWeight: 600, marginTop: 4 }}>Role intervals:</span>
                    {status.config.roleIntervals && Object.entries(status.config.roleIntervals).map(([role, ms]) => (
                        <span key={role}>{ROLE_ICON[role] || "◉"} {ROLE_LABEL[role] || role}: {ms / 1000}s</span>
                    ))}
                </div>
            )}

            {/* Collaboration tab (I6) */}
            {activeTab === "collaboration" && <CollaborationTab />}

            {/* Pipeline tab (I7) */}
            {activeTab === "pipeline" && <PipelineTab />}

            {/* Deployment tab (I8) */}
            {activeTab === "deployment" && <DeploymentTab />}

            {/* Smells tab (ACP-3) */}
            {activeTab === "smells" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <SmellsPanel cwd={null} />
                </Suspense>
            )}

            {/* Decisions tab (ACP-4) */}
            {activeTab === "decisions" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <DecisionsPanel cwd={null} />
                </Suspense>
            )}

            {/* Technical Debt Dashboard (ACP-4) */}
            {activeTab === "debt" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <TechDebtDashboard />
                </Suspense>
            )}

            {/* Bundle Edit (ACP-6) */}
            {activeTab === "bundle" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <BundlePreviewPanel cwd={null} />
                </Suspense>
            )}

            {/* AI Composer (ACP-7) */}
            {activeTab === "composer" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <ComposerPanel cwd={null} />
                </Suspense>
            )}

            {/* Autonomous Engineering Agent (ACP-8) */}
            {activeTab === "autonomous" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <AutonomousAgentPanel cwd={null} />
                </Suspense>
            )}

            {/* Repository Map (ACP-9) */}
            {activeTab === "repository" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <RepositoryMapPanel />
                </Suspense>
            )}

            {/* Engineering Memory (ACP-10) */}
            {activeTab === "memory" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <EngineeringMemoryPanel />
                </Suspense>
            )}

            {/* Self-Improvement (ACP-11) */}
            {activeTab === "evolution" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <SelfImprovementPanel />
                </Suspense>
            )}

            {/* Autonomous Engineering Platform (ACP-12) */}
            {activeTab === "platform" && (
                <Suspense fallback={<div style={{ padding: 16, color: "#4b5563" }}>Loading…</div>}>
                    <AutonomousPlatformPanel />
                </Suspense>
            )}

            {/* Footer */}
            <div className="aad-footer">
                Auto-refreshes every 10s · Observer → Reasoning → Mission → Collaboration → Execution → Verification → Learning → Repeat
            </div>
        </div>
    );
}
