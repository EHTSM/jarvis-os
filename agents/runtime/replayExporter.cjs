"use strict";
/**
 * Phase 459 — Advanced Replay Export System
 *
 * Export execution sessions, recovery chains, operational summaries,
 * and deployment diagnostics as: markdown | json | compressed snapshot.
 *
 * Reads from: executionReplayEngine, engineeringSession, runtimeForensics,
 * operationalAnalytics. Does NOT write to any of them.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const replay    = _tryRequire("./executionReplayEngine.cjs");
const session   = _tryRequire("./engineeringSession.cjs");
const forensics = _tryRequire("./runtimeForensics.cjs");
const analytics = _tryRequire("./operationalAnalytics.cjs");
const timeline  = _tryRequire("./timelineIntelligence.cjs");

// ── Markdown helpers ──────────────────────────────────────────────────────────
function _hr()       { return "\n---\n"; }
function _h1(s)      { return `\n# ${s}\n`; }
function _h2(s)      { return `\n## ${s}\n`; }
function _h3(s)      { return `\n### ${s}\n`; }
function _field(k,v) { return `- **${k}:** ${v}`; }
function _ts(ms)     { return ms ? new Date(ms).toISOString() : "unknown"; }
function _pct(n)     { return n != null ? `${n}%` : "n/a"; }

// ── Session export ────────────────────────────────────────────────────────────

/**
 * Export a session as markdown.
 * @param {string} sessionId
 * @returns {string|null}
 */
function exportSessionMarkdown(sessionId) {
    if (!session) return null;
    const s = session.summary(sessionId);
    if (!s) return null;

    const lines = [
        _h1(`Engineering Session: ${s.goal.slice(0, 80)}`),
        _field("ID", s.id),
        _field("State", s.state),
        _field("Created", _ts(s.createdAt)),
        _field("Updated", _ts(s.updatedAt)),
        _field("Confidence", `${s.executionConfidence ?? 100}/100`),
        _field("Degradation", s.degradationState || "healthy"),
        _field("Workflows run", s.workflowCount),
        _field("Failed recoveries", s.failedRecoveries),
    ];

    if (s.runtimeState) {
        lines.push(_h2("Runtime State"));
        lines.push(_field("PM2", s.runtimeState.pm2Status || "unknown"));
        lines.push(_field("API reachable", s.runtimeState.apiReachable ? "yes" : "no"));
        lines.push(_field("Heap MB", s.runtimeState.heapMb ?? "unknown"));
    }

    if (s.workflows?.length) {
        lines.push(_h2("Workflows"));
        for (const w of s.workflows.slice(0, 20)) {
            lines.push(`- \`${w.chainName}\` — ${w.successRate ?? "?"}% success, ${w.durationMs ?? "?"}ms`);
        }
    }

    if (timeline && s.timeline?.length) {
        const analysis = timeline.analyze(s.timeline);
        lines.push(_h2("Timeline Intelligence"));
        lines.push(timeline.summarize(s.timeline, s));
        if (analysis.causalChains?.length) {
            lines.push(_h3("Causal Chains"));
            for (const c of analysis.causalChains.slice(0, 10)) {
                const dur = c.durationMs ? `${Math.round(c.durationMs/1000)}s` : "incomplete";
                lines.push(`- \`${c.chainName}\`: ${c.completed ? "completed" : "incomplete"} (${dur})`);
            }
        }
    }

    if (s.recentTimeline?.length) {
        lines.push(_h2("Recent Events"));
        for (const ev of s.recentTimeline.slice(0, 15)) {
            lines.push(`- [${_ts(ev.ts)}] ${ev.type}${ev.chainName ? ` (${ev.chainName})` : ""}`);
        }
    }

    return lines.join("\n");
}

/**
 * Export a session as JSON snapshot.
 * @param {string} sessionId
 * @returns {string|null}
 */
function exportSessionJson(sessionId) {
    if (!session) return null;
    const s = session.summary(sessionId);
    if (!s) return null;
    return JSON.stringify({ exportedAt: new Date().toISOString(), session: s }, null, 2);
}

// ── Replay export ─────────────────────────────────────────────────────────────

/**
 * Export a replay record as markdown.
 * @param {string} replayId
 * @returns {string|null}
 */
function exportReplayMarkdown(replayId) {
    if (!replay) return null;
    const r = replay.get(replayId);
    if (!r) return null;

    const lines = [
        _h1(`Replay: ${r.goal.slice(0, 80)}`),
        _field("ID", r.id),
        _field("Chain", r.chainName),
        _field("Recorded", _ts(r.recordedAt)),
        _field("Steps", r.steps?.length ?? 0),
        _h2("Steps"),
    ];
    for (const [i, step] of (r.steps || []).entries()) {
        lines.push(_h3(`${i + 1}. ${step.label || step.cmd?.slice(0, 60)}`));
        lines.push(`\`\`\`bash\n${step.cmd}\n\`\`\``);
        if (step.approvalLevel) lines.push(_field("Approval", step.approvalLevel));
        if (step.failBehavior)  lines.push(_field("On failure", step.failBehavior));
    }

    if (r.meta && Object.keys(r.meta).length) {
        lines.push(_h2("Metadata"));
        for (const [k, v] of Object.entries(r.meta)) lines.push(_field(k, JSON.stringify(v)));
    }
    return lines.join("\n");
}

// ── Analytics report ─────────────────────────────────────────────────────────

/**
 * Export an operational analytics report as markdown.
 * @param {{ windowMs?: number }} opts
 * @returns {string}
 */
function exportAnalyticsMarkdown({ windowMs } = {}) {
    const lines = [_h1("Operational Analytics Report")];
    lines.push(_field("Generated", new Date().toISOString()));
    if (windowMs) lines.push(_field("Window", `last ${Math.round(windowMs / 3_600_000)}h`));

    if (!analytics) { lines.push("\n> Analytics module unavailable.\n"); return lines.join("\n"); }

    const s = analytics.summary({ windowMs });
    lines.push(_field("Total events", s.totalEvents));

    lines.push(_h2("Workflows"));
    lines.push(_field("Total runs", s.workflows.total));
    lines.push(_field("Success rate", _pct(s.workflows.successRate)));
    lines.push(_field("Avg duration", s.workflows.avgDurationMs ? `${s.workflows.avgDurationMs}ms` : "n/a"));
    if (s.workflows.byChain?.length) {
        lines.push(_h3("By Chain"));
        for (const c of s.workflows.byChain) {
            lines.push(`- \`${c.chain}\`: ${c.runs} runs, ${_pct(c.successRate)} success, avg ${c.avgMs}ms`);
        }
    }

    lines.push(_h2("Recoveries"));
    lines.push(_field("Total attempts", s.recoveries.total));
    lines.push(_field("Recovery rate", _pct(s.recoveries.recoveryRate)));

    lines.push(_h2("Deployments"));
    lines.push(_field("Total", s.deployments.total));
    lines.push(_field("Success rate", _pct(s.deployments.successRate)));
    lines.push(_field("Rollbacks", s.deployments.rollbacks));

    lines.push(_h2("Adapter Reliability"));
    for (const a of (s.adapters.byAdapter || [])) {
        lines.push(`- \`${a.adapter}\`: ${_pct(a.reliability)} reliability (${a.events} events)`);
    }

    return lines.join("\n");
}

// ── Forensics export ──────────────────────────────────────────────────────────

/**
 * Export a forensics summary as markdown.
 * @param {string|null} sessionId
 * @returns {string}
 */
function exportForensicsMarkdown(sessionId = null) {
    const lines = [_h1("Runtime Forensics Report")];
    lines.push(_field("Generated", new Date().toISOString()));
    if (sessionId) lines.push(_field("Session", sessionId));

    if (!forensics) { lines.push("\n> Forensics module unavailable.\n"); return lines.join("\n"); }

    const summary = forensics.summarize(sessionId);
    lines.push(_field("Total entries", summary.total));
    lines.push(_field("Workflow failures", summary.workflowFailures));
    lines.push(_field("Adapter faults", summary.adapterFaults));
    lines.push(_field("Failed recoveries", summary.failedRecoveries));

    if (summary.recentEntries?.length) {
        lines.push(_h2("Recent Entries"));
        for (const e of summary.recentEntries.slice(0, 20)) {
            const ts = _ts(e.ts);
            lines.push(`- [${ts}] **${e.type}**${e.chainName ? ` \`${e.chainName}\`` : ""}${e.adapter ? ` adapter=\`${e.adapter}\`` : ""}${e.error ? `: ${String(e.error).slice(0, 80)}` : ""}`);
        }
    }

    return lines.join("\n");
}

// ── Compressed snapshot ───────────────────────────────────────────────────────

/**
 * Export a full runtime snapshot as a compressed JSON string.
 * Includes: session summary, analytics, forensics summary, runtime mode.
 */
function exportSnapshot(sessionId = null) {
    const snap = {
        exportedAt: new Date().toISOString(),
        session:    null,
        analytics:  null,
        forensics:  null,
        mode:       null,
    };

    if (sessionId && session) snap.session = session.summary(sessionId);
    if (analytics) snap.analytics = analytics.summary({ windowMs: 24 * 3_600_000 });
    if (forensics) snap.forensics = forensics.summarize(sessionId);

    try {
        const modes = require("./runtimeModes.cjs");
        snap.mode = modes.getActiveMode();
    } catch {}

    return JSON.stringify(snap, null, 2);
}

module.exports = {
    exportSessionMarkdown, exportSessionJson,
    exportReplayMarkdown,
    exportAnalyticsMarkdown,
    exportForensicsMarkdown,
    exportSnapshot,
};
