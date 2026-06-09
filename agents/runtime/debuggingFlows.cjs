"use strict";
/**
 * Phase 437 — Real Debugging Flows
 *
 * Concrete debugging chains for: frontend, backend, runtime failure,
 * adapter issue tracing, dependency issue recovery.
 *
 * Each flow: guided recovery suggestions, validation checkpoints, replay support.
 * Extends deploymentRecoveryFlows pattern — same chain shape.
 */

const DEBUG_FLOWS = {
    "debug-frontend": {
        goal:     "Diagnose and recover from frontend failure",
        steps: [
            { cmd: "cd frontend && npm run build 2>&1 | tail -30",      label: "Run frontend build to capture errors",     approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "cd frontend && npx tsc --noEmit 2>&1 | head -40",   label: "Type-check frontend source",              approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "ls -la frontend/node_modules/.bin/vite 2>/dev/null", label: "Verify vite binary present",             approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "cd frontend && npm ls --depth=0 2>&1 | head -20",   label: "Check frontend dependency tree",          approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "ls -la frontend/dist/ 2>/dev/null || echo 'no dist'", label: "Check build output exists",            approvalLevel: "SAFE",    failBehavior: "continue",
              probes: { files: ["frontend/dist/index.html"] } },
        ],
        suggestions: ["run-chain:recover-frontend-runtime", "run-chain:clean-install"],
        maxRetries: 0,
    },

    "debug-backend": {
        goal:     "Diagnose and recover from backend failure",
        steps: [
            { cmd: "pm2 list",                                            label: "Check pm2 process status",               approvalLevel: "SAFE",    failBehavior: "continue",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "pm2 logs jarvis-backend --lines 30 --nostream 2>/dev/null || echo 'no logs'", label: "Tail backend logs", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "node -e \"require('./backend/server.cjs') && process.exit(0)\" 2>&1 | head -10", label: "Smoke-test backend require", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "curl -sf http://localhost:3001/api/health 2>/dev/null || echo 'api-unreachable'", label: "Check API health endpoint", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
            { cmd: "lsof -i :3001 2>/dev/null | head -5",               label: "Check port 3001 binding",                approvalLevel: "SAFE",    failBehavior: "continue" },
        ],
        suggestions: ["run-chain:recover-backend", "run-chain:health-check"],
        maxRetries: 0,
    },

    "debug-runtime-failure": {
        goal:     "Diagnose runtime failure — memory, process, event bus",
        steps: [
            { cmd: "node -e \"const m=process.memoryUsage(); console.log('heap:', Math.round(m.heapUsed/1e6)+'MB rss:'+Math.round(m.rss/1e6)+'MB')\"", label: "Check Node process memory", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "pm2 describe jarvis-backend 2>/dev/null | grep -E 'status|memory|cpu|restart'", label: "pm2 describe backend", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "ls -la data/crashes/ 2>/dev/null && echo 'crashes found' || echo 'no crashes'", label: "Check crash forensics", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "df -h . | tail -1",                                   label: "Check disk space",                       approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "curl -sf http://localhost:3001/runtime/status 2>/dev/null | head -c 300", label: "Runtime status endpoint", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
        ],
        suggestions: ["run-chain:health-check", "run-chain:recover-backend"],
        maxRetries: 0,
    },

    "debug-adapter-issue": {
        goal:     "Trace adapter connectivity and state problems",
        steps: [
            { cmd: "curl -sf http://localhost:3001/runtime/tools/state 2>/dev/null | head -c 500", label: "Check adapter states via API", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "curl -sf http://localhost:3001/runtime/adapters/healing 2>/dev/null | head -c 300", label: "Check adapter healing state", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "lsof -i :3001 -i :5173 2>/dev/null | head -10",      label: "Check active port bindings",              approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "ps aux | grep -E 'node|pm2' | grep -v grep | head -10", label: "List node/pm2 processes",             approvalLevel: "SAFE",    failBehavior: "continue" },
        ],
        suggestions: ["run-chain:health-check", "adapter-heal-all"],
        maxRetries: 0,
    },

    "debug-dependency-issue": {
        goal:     "Diagnose dependency mismatches and missing modules",
        steps: [
            { cmd: "node --version && npm --version",                     label: "Node/npm version check",                  approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "npm ls --depth=0 2>&1 | grep -E 'MISSING|invalid|ERR'", label: "Check for missing root deps",          approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "cd frontend && npm ls --depth=0 2>&1 | grep -E 'MISSING|invalid|ERR'", label: "Check frontend dep issues", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "cat package.json | node -e \"const d=require('/dev/stdin'); console.log('deps:', Object.keys(d.dependencies||{}).length, 'devDeps:', Object.keys(d.devDependencies||{}).length)\"", label: "Count declared dependencies", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "ls node_modules/.bin | wc -l",                       label: "Count installed binaries",                approvalLevel: "SAFE",    failBehavior: "continue" },
        ],
        suggestions: ["run-chain:clean-install", "run-chain:dependency-mismatch-repair"],
        maxRetries: 0,
    },
};

function getFlow(name) {
    const f = DEBUG_FLOWS[name];
    return f ? { name, ...f } : null;
}

function listFlows() {
    return Object.entries(DEBUG_FLOWS).map(([name, f]) => ({
        name,
        goal:        f.goal,
        stepCount:   f.steps.length,
        suggestions: f.suggestions,
    }));
}

/**
 * Pick the best debugging flow for a problem description.
 * @param {string} problemText
 * @returns {{ flowName, flow }}
 */
function planDebug(problemText) {
    const lower = (problemText || "").toLowerCase();
    if (/frontend|react|vite|build|bundle|css|jsx|tsx/i.test(lower))         return { flowName: "debug-frontend",         flow: getFlow("debug-frontend") };
    if (/backend|server|api|express|port.?3001|pm2/i.test(lower))            return { flowName: "debug-backend",          flow: getFlow("debug-backend") };
    if (/memory|heap|crash|oom|event.?bus|runtime/i.test(lower))             return { flowName: "debug-runtime-failure",  flow: getFlow("debug-runtime-failure") };
    if (/adapter|vscode|terminal|browser|connect/i.test(lower))              return { flowName: "debug-adapter-issue",    flow: getFlow("debug-adapter-issue") };
    if (/depend|module.?not.?found|npm|node.?module|package/i.test(lower))   return { flowName: "debug-dependency-issue", flow: getFlow("debug-dependency-issue") };
    return { flowName: "debug-backend", flow: getFlow("debug-backend") };
}

module.exports = { getFlow, listFlows, planDebug, DEBUG_FLOWS };
