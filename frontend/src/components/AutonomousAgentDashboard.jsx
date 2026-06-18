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
                <div className="aad-header-sub">Phase I4+I5 — Autonomous Agent Runtime · 10 Specialized Agents</div>
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

            {/* Config strip */}
            {status?.config && (
                <div className="aad-config-strip">
                    <span>Agents: {status.agentCount} registered · {status.runningCount} running</span>
                    <span>Confidence threshold: {status.config.confidenceThreshold}%</span>
                    <span>Max recovery: {status.config.maxRecoveryAttempts} attempts</span>
                    {status.config.roleIntervals && Object.entries(status.config.roleIntervals).map(([role, ms]) => (
                        <span key={role}>{ROLE_LABEL[role] || role}: {ms / 1000}s</span>
                    ))}
                </div>
            )}

            {/* Agent cards */}
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

            {/* Footer: last poll time */}
            <div className="aad-footer">
                Auto-refreshes every 10s · Observer → Reasoning → Mission → Execution → Verification → Learning → Repeat
            </div>
        </div>
    );
}
