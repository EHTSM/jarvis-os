import React, { useState, useEffect, useCallback, useRef } from "react";
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
    running:    "#22c55e",
    paused:     "#f59e0b",
    recovering: "#a78bfa",
    failed:     "#ef4444",
    stopped:    "#6b7280",
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
    const color = STATUS_COLOR[status] || "#6b7280";
    return (
        <span className="aad-pill" style={{ background: color + "22", color, borderColor: color + "55" }}>
            <span className="aad-pill-dot" style={{ background: color }} />
            {status}
        </span>
    );
}

function HealthBar({ health }) {
    const color = health >= 70 ? "#22c55e" : health >= 40 ? "#f59e0b" : "#ef4444";
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
        return <MetricCell label="Missions" value={agent.missionsCreated} color="#22c55e" />;
    if (role === "reviewer" || role === "documentation")
        return <MetricCell label="Lessons" value={agent.lessonsRegistered} color="#22c55e" />;
    if (role === "verifier")
        return <MetricCell label="Verifies" value={agent.verificationsRun} color="#3b82f6" />;
    return null;
}

function AgentCard({ agent, onPause, onResume, onTick, onEnable, onDisable, pausing, resuming, ticking, enabling, disabling }) {
    const role  = agent.role;
    const color = STATUS_COLOR[agent.status] || "#6b7280";
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
                    {disabled && <span style={{ fontSize: 10, color: "#6b7280", border: "1px solid #6b728055", borderRadius: 4, padding: "1px 5px" }}>disabled</span>}
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
                <MetricCell label="Success"   value={agent.successRate != null ? `${agent.successRate}%` : "—"} color={agent.successRate >= 80 ? "#22c55e" : agent.successRate >= 50 ? "#f59e0b" : "#ef4444"} />
                <MetricCell label="Recovery"  value={agent.recoveryCount} color={agent.recoveryCount > 0 ? "#f59e0b" : undefined} />
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
    pending:   "#f59e0b",
    claimed:   "#3b82f6",
    accepted:  "#8b5cf6",
    running:   "#22c55e",
    completed: "#22c55e",
    failed:    "#ef4444",
    rejected:  "#ef4444",
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
                <span className="aad-collab-stat-val" style={{ color: "#22c55e" }}>{stats.completedPlans ?? 0}</span>
                <span className="aad-collab-stat-lbl">Completed</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val">{stats.handoffsTotal ?? 0}</span>
                <span className="aad-collab-stat-lbl">Handoffs</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "#22c55e" }}>{stats.handoffsCompleted ?? 0}</span>
                <span className="aad-collab-stat-lbl">Done</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "#f59e0b" }}>{stats.handoffsRetried ?? 0}</span>
                <span className="aad-collab-stat-lbl">Retried</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "#a78bfa" }}>{stats.parallelGroupsExecuted ?? 0}</span>
                <span className="aad-collab-stat-lbl">Parallel</span>
            </div>
            <div className="aad-collab-stat">
                <span className="aad-collab-stat-val" style={{ color: "#ef4444" }}>{stats.recoveryMissionsCreated ?? 0}</span>
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
        <div className="aad-collab-card" style={{ borderLeft: collab.status === "active" ? "3px solid #3b82f6" : collab.status === "waiting_approval" ? "3px solid #f59e0b" : "3px solid #22c55e" }}>
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
                <div style={{ fontSize: 11, color: "#f59e0b" }}>⏳ {collab.pendingHandoffs} pending handoff(s)</div>
            )}

            {/* Approval gate */}
            {collab.status === "waiting_approval" && (
                <div style={{ fontSize: 11, padding: "5px 8px", background: "#f59e0b11", borderRadius: 4, color: "#f59e0b" }}>
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
                            <span className="aad-handoff-status" style={{ background: "#f59e0b22", color: "#f59e0b" }}>{h.status}</span>
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
                    ? <span className="aad-sup-state" style={{ color: "#22c55e" }}>● Running</span>
                    : <span className="aad-sup-state" style={{ color: "#6b7280" }}>○ Stopped</span>
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
            if (r?.ok) await load();
        } catch {}
        setBusyMap(m => { const n = { ...m }; delete n[agentId]; return n; });
    };

    const handlePause   = id => _action(id, "pausing",   `/agents/runtime/supervisor/${id}/pause`);
    const handleResume  = id => _action(id, "resuming",  `/agents/runtime/supervisor/${id}/resume`);
    const handleTick    = id => _action(id, "ticking",   `/agents/runtime/supervisor/${id}/tick`);
    const handleEnable  = id => _action(id, "enabling",  `/agents/runtime/registry/${id}/enable`);
    const handleDisable = id => _action(id, "disabling", `/agents/runtime/registry/${id}/disable`);

    const handleStart  = async () => { setLoading(true); await _fetch("/agents/runtime/supervisor/start", { method: "POST" }); await load(); };
    const handleStop   = async () => { setLoading(true); await _fetch("/agents/runtime/supervisor/stop",  { method: "POST" }); await load(); };

    if (loading && !status) return (
        <div className="aad-root"><div className="aad-loading">Connecting to Agent Runtime…</div></div>
    );

    const agents = status?.agents || [];

    return (
        <div className="aad-root">
            {/* Header */}
            <div className="aad-header">
                <div className="aad-header-title">Autonomous Agent Runtime</div>
                <div className="aad-header-sub">Phase I4+I5+I6 — 10 Specialized Agents · Multi-Agent Collaboration</div>
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

            {/* Footer */}
            <div className="aad-footer">
                Auto-refreshes every 10s · Observer → Reasoning → Mission → Collaboration → Execution → Verification → Learning → Repeat
            </div>
        </div>
    );
}
