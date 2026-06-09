"use strict";
/**
 * Phase 423 — Deployment Recovery Flows
 *
 * Rollback-safe, approval-gated, replayable deployment recovery chains.
 * Extends executionChainPlanner with deployment-specific recovery flows.
 *
 * Flows:
 *   "deployment-rollback"       — revert last deploy, restore previous build
 *   "stale-env-recovery"        — clear stale processes, restart from clean state
 *   "dependency-mismatch-repair"— reinstall deps, verify lockfile integrity
 *   "build-verification-recovery"— rebuild from scratch, verify output
 *   "deployment-validation-chain"— end-to-end post-deploy verification
 */

const logger = require("../../backend/utils/logger");

const DEPLOY_FLOWS = {
    "deployment-rollback": {
        goal:     "Rollback failed deployment to previous stable state",
        steps: [
            { cmd: "git log --oneline -5",        label: "Inspect recent commits",         approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "pm2 stop jarvis-backend",     label: "Stop backend before rollback",    approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "git stash",                    label: "Stash uncommitted changes",       approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "git checkout HEAD~1 -- .",     label: "Revert to previous HEAD",         approvalLevel: "CRITICAL",failBehavior: "abort" },
            { cmd: "npm install --prefer-offline", label: "Reinstall deps for reverted code",approvalLevel: "CAUTION", failBehavior: "abort" },
            { cmd: "pm2 restart jarvis-backend",  label: "Restart backend",                 approvalLevel: "CAUTION", failBehavior: "abort",
              probes: { pm2Processes: ["jarvis-backend"], httpEndpoints: ["http://localhost:3001/api/health"] } },
        ],
        maxRetries: 1,
    },
    "stale-env-recovery": {
        goal:     "Clear stale environment and restart from clean state",
        steps: [
            { cmd: "pm2 list",                    label: "List pm2 processes",              approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "pm2 delete all",              label: "Delete all pm2 processes",        approvalLevel: "CRITICAL",failBehavior: "abort" },
            { cmd: "lsof -ti :3001 | xargs kill -9 2>/dev/null || true", label: "Kill port 3001 conflicts", approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "lsof -ti :5173 | xargs kill -9 2>/dev/null || true", label: "Kill port 5173 conflicts", approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "pm2 start ecosystem.config.cjs", label: "Start backend via pm2",        approvalLevel: "CAUTION", failBehavior: "abort",
              probes: { pm2Processes: ["jarvis-backend"] } },
        ],
        maxRetries: 1,
    },
    "dependency-mismatch-repair": {
        goal:     "Fix dependency mismatch — reinstall and verify lockfile",
        steps: [
            { cmd: "node --version && npm --version", label: "Verify Node/npm versions",    approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "npm ci --prefer-offline",         label: "Clean install from lockfile", approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "npm ls --depth=0 2>&1 | head -30", label: "Check top-level deps",       approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "cd frontend && npm ci --prefer-offline && cd ..", label: "Frontend clean install", approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "node -e \"require('./backend/server.cjs') && process.exit(0)\" 2>&1 | head -5", label: "Smoke-test backend require", approvalLevel: "SAFE", failBehavior: "continue" },
        ],
        maxRetries: 2,
    },
    "build-verification-recovery": {
        goal:     "Rebuild from scratch and verify build output",
        steps: [
            { cmd: "cd frontend && rm -rf dist",      label: "Clear stale build output",    approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "cd frontend && npm run build 2>&1 | tail -20", label: "Rebuild frontend", approvalLevel: "CAUTION", failBehavior: "abort" },
            { cmd: "ls -la frontend/dist/",           label: "Verify dist output exists",   approvalLevel: "SAFE",    failBehavior: "abort",
              probes: { files: ["frontend/dist/index.html"] } },
            { cmd: "wc -c frontend/dist/assets/*.js 2>/dev/null | tail -1", label: "Check JS bundle size", approvalLevel: "SAFE", failBehavior: "continue" },
        ],
        maxRetries: 1,
    },
    "deployment-validation-chain": {
        goal:     "End-to-end post-deploy health verification",
        steps: [
            { cmd: "pm2 list",                    label: "Check pm2 process status",        approvalLevel: "SAFE",    failBehavior: "continue",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "curl -sf http://localhost:3001/api/health | head -c 200", label: "API health check", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
            { cmd: "ls -la frontend/dist/index.html 2>/dev/null", label: "Frontend dist present", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { files: ["frontend/dist/index.html"] } },
            { cmd: "git log --oneline -1",        label: "Confirm deployed commit",         approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "df -h . | tail -1",           label: "Check disk space",                approvalLevel: "SAFE",    failBehavior: "continue" },
        ],
        maxRetries: 0,
    },
};

/**
 * Get a deployment recovery flow by name.
 * Returns a chain object compatible with executionChainPlanner templates.
 */
function getFlow(flowName) {
    const flow = DEPLOY_FLOWS[flowName];
    if (!flow) return null;
    return { name: flowName, ...flow };
}

/** List all available deployment recovery flows. */
function listFlows() {
    return Object.entries(DEPLOY_FLOWS).map(([name, f]) => ({
        name,
        goal:      f.goal,
        stepCount: f.steps.length,
        maxRetries: f.maxRetries,
        requiresCriticalApproval: f.steps.some(s => s.approvalLevel === "CRITICAL"),
    }));
}

/**
 * Plan a deployment recovery given a description of the problem.
 * @param {string} problemText
 * @returns {{ flowName: string, flow: object } | null}
 */
function planRecovery(problemText) {
    const lower = (problemText || "").toLowerCase();
    if (/rollback|revert|previous.?version/.test(lower)) return { flowName: "deployment-rollback",         flow: getFlow("deployment-rollback") };
    if (/stale|zombie|port.?conflict|restart.?clean/.test(lower)) return { flowName: "stale-env-recovery",   flow: getFlow("stale-env-recovery") };
    if (/depend|mismatch|lockfile|node.?module/.test(lower))       return { flowName: "dependency-mismatch-repair", flow: getFlow("dependency-mismatch-repair") };
    if (/build|compile|dist|bundle/.test(lower))                   return { flowName: "build-verification-recovery", flow: getFlow("build-verification-recovery") };
    if (/valid|verif|health|post.?deploy/.test(lower))             return { flowName: "deployment-validation-chain",  flow: getFlow("deployment-validation-chain") };
    // Default: validation chain is the safest first step
    return { flowName: "deployment-validation-chain", flow: getFlow("deployment-validation-chain") };
}

module.exports = { getFlow, listFlows, planRecovery, DEPLOY_FLOWS };
