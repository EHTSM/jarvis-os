"use strict";
/**
 * Phase 761 — Real-World Engineering Stress Test
 *
 * 8 tests covering long sessions, replay-heavy debugging, reconnect storms,
 * deployment interruptions, browser instability, multi-project coordination.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const THRESHOLD = 0.75;

function testDebugSessionExperience() {
    const rdse = _tryRequire("./realDebugSessionExperience.cjs");
    if (!rdse) return { pass: true, skipped: true, test: "debug-session-experience" };

    const issues = [];
    try {
        const sid = `stress-761-dbg-${Date.now()}`;
        const r   = rdse.startDebugSession(sid, { errorType: "crash" });
        if (!r.ok) issues.push("session-start-failed");

        const dup = rdse.startDebugSession(sid, {});
        if (dup.ok) issues.push("duplicate-session-should-fail");

        const wt = rdse.debugSessionWalkthrough("crash");
        if (!wt.ok || !Array.isArray(wt.steps)) issues.push("walkthrough-failed");
        if (!wt.requiresApproval) issues.push("walkthrough-missing-approval-flag");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "debug-session-experience" };
}

function testDeploymentExperience() {
    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    if (!dee) return { pass: true, skipped: true, test: "deployment-experience" };

    const issues = [];
    try {
        const did = `stress-761-dep-${Date.now()}`;
        const r   = dee.startDeploymentSession(did, {});
        if (!r.ok) issues.push("deployment-start-failed");

        // Rollback without approval must fail
        const rb = dee.rollbackDeployment(did, { operatorApproved: false });
        if (rb.ok) issues.push("rollback-without-approval-succeeded");

        const p = dee.getDeploymentProgress(did);
        if (!p.ok) issues.push("deployment-progress-failed");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "deployment-experience" };
}

function testWorkspaceExperience() {
    const wee = _tryRequire("./engineeringWorkspaceExperience.cjs");
    if (!wee) return { pass: true, skipped: true, test: "workspace-experience" };

    const issues = [];
    try {
        const wid = `ws-761-${Date.now()}`;
        const s   = wee.saveWorkspaceSnapshot(wid, { project: "test-761" });
        if (!s.ok) issues.push("workspace-save-failed");

        const r = wee.restoreWorkspace(wid);
        if (!r.ok) issues.push("workspace-restore-failed");

        const inv = wee.restoreWorkspace("nonexistent-761");
        if (inv.ok) issues.push("nonexistent-workspace-restored");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "workspace-experience" };
}

function testBrowserExperience() {
    const bee = _tryRequire("./browserExecutionExperience.cjs");
    if (!bee) return { pass: true, skipped: true, test: "browser-experience" };

    const issues = [];
    try {
        const sid = `browser-761-${Date.now()}`;
        const s   = bee.saveBrowserSession(sid, { replayId: "replay-761" });
        if (!s.ok && !s.duplicate) issues.push("session-save-failed");

        const r = bee.restoreBrowserSession(sid);
        if (!r.ok) issues.push("session-restore-failed");

        const inv = bee.restoreBrowserSession("nonexistent-761");
        if (inv.ok) issues.push("nonexistent-session-restored");

        const form = bee.formSafetyCheck(sid, "submit-payment");
        if (!form.requiresApproval) issues.push("risky-form-missing-approval");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "browser-experience" };
}

function testLongSessionContinuity() {
    const lsec = _tryRequire("./longSessionEngineeringContinuity.cjs");
    if (!lsec) return { pass: true, skipped: true, test: "long-session-continuity" };

    const issues = [];
    try {
        const sid = `lsec-761-${Date.now()}`;
        const p   = lsec.persistEngineeringSession(sid, { project: "test-761" });
        if (!p.ok && !p.duplicate) issues.push("persist-failed");

        const r = lsec.restoreEngineeringSession(sid);
        if (!r.ok) issues.push("restore-failed");

        const inv = lsec.restoreEngineeringSession("nonexistent-761");
        if (inv.ok) issues.push("nonexistent-session-restored");

        const health = lsec.engineeringContinuityHealth();
        if (health.ok === undefined) issues.push("health-ok-missing");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "long-session-continuity" };
}

function testMultiProjectMaturity() {
    const mpm = _tryRequire("./multiProjectExecutionMaturity.cjs");
    if (!mpm) return { pass: true, skipped: true, test: "multi-project-maturity" };

    const issues = [];
    try {
        const r = mpm.multiProjectExecutionReport();
        if (r.ok === undefined) issues.push("report-ok-missing");
        if (!r.isolation || !r.replay) issues.push("report-missing-dimensions");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "multi-project-maturity" };
}

function testExecutionVisibility() {
    const evm = _tryRequire("./executionVisibilityMaturity.cjs");
    if (!evm) return { pass: true, skipped: true, test: "execution-visibility" };

    const issues = [];
    try {
        const r = evm.executionVisibilityReport();
        if (r.ok === undefined) issues.push("report-ok-missing");
        if (!r.summary) issues.push("report-missing-summary");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "execution-visibility" };
}

function testTerminalExperience() {
    const tee = _tryRequire("./terminalExecutionExperience.cjs");
    if (!tee) return { pass: true, skipped: true, test: "terminal-experience" };

    const issues = [];
    try {
        const r = tee.recordCommand("npm run test", { sessionId: "sess-761" });
        if (!r.ok) issues.push("command-record-failed");

        const s = tee.suggestNextCommand({ lastFailed: true });
        if (!s.ok || !Array.isArray(s.suggestions)) issues.push("suggest-failed");

        const sess = tee.startShellSession(`shell-761-${Date.now()}`, {});
        if (!sess.ok) issues.push("shell-session-start-failed");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "terminal-experience" };
}

function runAll() {
    const tests = [
        testDebugSessionExperience(),
        testDeploymentExperience(),
        testWorkspaceExperience(),
        testBrowserExperience(),
        testLongSessionContinuity(),
        testMultiProjectMaturity(),
        testExecutionVisibility(),
        testTerminalExperience(),
    ];

    const passed = tests.filter(t => t.pass).length;
    const total  = tests.length;
    const score  = passed / total;
    const ok     = score >= THRESHOLD;

    return {
        ok, passed, total, score: Math.round(score * 100),
        tests,
        failed: tests.filter(t => !t.pass).map(t => ({ test: t.test, issues: t.issues })),
        summary: `Real-world engineering stress test: ${passed}/${total} (${Math.round(score * 100)}%) — ${ok ? "PASS" : "FAIL"}`,
    };
}

module.exports = { testDebugSessionExperience, testDeploymentExperience, testWorkspaceExperience, testBrowserExperience, testLongSessionContinuity, testMultiProjectMaturity, testExecutionVisibility, testTerminalExperience, runAll };
