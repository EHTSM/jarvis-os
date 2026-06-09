"use strict";
/**
 * Phase 521 — Operator Experience Polish
 *
 * Execution readability, workflow organization, replay clarity,
 * dashboard calmness, deployment visibility.
 *
 * Provides: formatted output helpers, calm alert rendering,
 * organized workflow grouping, execution step formatting.
 *
 * All pure functions — no state, no persistence.
 */

// ── Alert formatting ──────────────────────────────────────────────────────────

const ALERT_PRIORITY = { critical: 0, high: 1, degraded: 2, attention: 3, warn: 4, info: 5 };

function _alertLevel(alert) {
    const lower = (alert || "").toLowerCase();
    if (lower.includes("critical") || lower.includes("blocked")) return "critical";
    if (lower.includes("high") || lower.includes("failed"))      return "high";
    if (lower.includes("degraded"))                              return "degraded";
    if (lower.includes("waiting") || lower.includes("approval")) return "attention";
    if (lower.includes("warn"))                                  return "warn";
    return "info";
}

/**
 * Sort and deduplicate alerts by priority. Returns calm, actionable list.
 */
function formatAlerts(alerts = []) {
    return [...new Set(alerts)]
        .map(a => ({ message: a, level: _alertLevel(a) }))
        .sort((a, b) => (ALERT_PRIORITY[a.level] || 5) - (ALERT_PRIORITY[b.level] || 5))
        .slice(0, 8); // max 8 alerts displayed
}

// ── Dashboard calmness ────────────────────────────────────────────────────────

/**
 * Produce a calm, organized dashboard view from raw dashboard data.
 * Groups information by urgency — only surfacing what needs attention.
 */
function calmDashboard(rawDashboard) {
    if (!rawDashboard) return { available: false };

    const alerts = formatAlerts(rawDashboard.alerts || []);
    const needsAction = alerts.filter(a => ["critical", "high", "attention"].includes(a.level));
    const informational = alerts.filter(a => ["degraded", "warn", "info"].includes(a.level));

    // Condense sessions: only show what matters
    const sessions = rawDashboard.sessions || {};
    const sessionFocus = {
        active:  sessions.active  || 0,
        blocked: sessions.blocked || 0,
        alert:   (sessions.blocked || 0) > 0 ? `${sessions.blocked} blocked` : null,
        topActive: (sessions.activeSessions || []).slice(0, 3).map(s => ({
            id:    s.id,
            goal:  (s.goal || "").slice(0, 50),
            state: s.state,
        })),
    };

    // Deployment focus
    const deps = rawDashboard.deployments || {};
    const deployFocus = {
        awaitingApproval: deps.awaitingApproval || 0,
        failed:           deps.failed           || 0,
        running:          deps.running          || 0,
        needsAction:      (deps.awaitingApproval || 0) > 0 || (deps.failed || 0) > 0,
    };

    return {
        health:         rawDashboard.health || "unknown",
        needsAction,
        informational,
        sessions:       sessionFocus,
        deployments:    deployFocus,
        pressure:       rawDashboard.pressure || {},
        mode:           (rawDashboard.mode || {}).name || "unknown",
        workspace:      (rawDashboard.workspace || {}).active || "default",
        heapMb:         (rawDashboard.memory || {}).heapMb || 0,
        ts:             rawDashboard.ts,
        calm:           needsAction.length === 0,
    };
}

// ── Workflow grouping ─────────────────────────────────────────────────────────

/**
 * Organize workflows into categories for operator display.
 */
function groupWorkflows(workflows = []) {
    const groups = {};
    for (const wf of workflows) {
        const cat = wf.category || "uncategorized";
        if (!groups[cat]) groups[cat] = { category: cat, workflows: [] };
        groups[cat].workflows.push({
            id:      wf.id,
            name:    wf.name,
            goal:    wf.goal,
            builtin: wf.builtin,
            tags:    wf.tags,
        });
    }
    // Sort groups: recovery first, then deployment, then rest alphabetically
    const ORDER = { recovery: 0, deployment: 1, maintenance: 2, setup: 3, custom: 4 };
    return Object.values(groups)
        .sort((a, b) => (ORDER[a.category] ?? 99) - (ORDER[b.category] ?? 99) || a.category.localeCompare(b.category));
}

// ── Replay clarity ────────────────────────────────────────────────────────────

/**
 * Format a replay step list for readable display.
 * Condenses output, highlights failures, marks skipped steps.
 */
function formatReplaySteps(steps = []) {
    return steps.map(s => {
        const icon = s.status === "passed" ? "✓" : s.status === "failed" ? "✗" : s.status === "skipped" ? "–" : "○";
        const dur  = s.durationMs ? `(${Math.round(s.durationMs / 1000)}s)` : "";
        return {
            icon,
            label:    s.label,
            status:   s.status,
            duration: dur,
            display:  `${icon} ${s.label} ${dur}`.trim(),
            hasOutput: !!s.output,
            hasError:  !!s.error,
            error:     s.error ? s.error.slice(0, 200) : null,
        };
    });
}

// ── Execution step formatting ─────────────────────────────────────────────────

/**
 * Format execution step for clear operator display.
 * Shows approval level visually.
 */
function formatStep(step) {
    const levelIcon = { SAFE: "🟢", CAUTION: "🟡", CRITICAL: "🔴" };
    return {
        ...step,
        approvalIcon: levelIcon[step.approvalLevel] || "⚪",
        display:      `[${step.approvalLevel}] ${step.label || step.cmd}`,
    };
}

/**
 * Format a deployment pipeline run for operator visibility.
 */
function formatDeploymentRun(run) {
    if (!run) return null;
    const stateIcon = {
        pending: "⏳", running: "🔄", passed: "✅",
        failed: "❌", "rolled-back": "↩", "awaiting-approval": "⏸",
    };
    return {
        id:       run.id,
        pipeline: run.pipeline,
        state:    run.state,
        icon:     stateIcon[run.state] || "○",
        stages:   (run.stages || []).map(s => ({
            name:   s.name,
            state:  s.state,
            icon:   stateIcon[s.state] || "○",
        })),
        rollback: run.rollbackTriggered,
        dryRun:   run.dryRun,
        display:  `${stateIcon[run.state] || "○"} ${run.pipeline} — ${run.state}`,
    };
}

module.exports = { formatAlerts, calmDashboard, groupWorkflows, formatReplaySteps, formatStep, formatDeploymentRun };
