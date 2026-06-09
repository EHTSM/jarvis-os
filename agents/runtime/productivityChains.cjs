"use strict";
/**
 * Phase 438 — Productivity Automation Chains
 *
 * Real operator automation chains:
 *   "morning-startup"        — start all services, verify health
 *   "project-recovery"       — recover broken dev environment
 *   "dependency-validation"  — verify all deps are installed and correct
 *   "multi-service-startup"  — start backend + frontend in order
 *   "dev-health-check"       — comprehensive development environment check
 *
 * All: bounded, replayable, operator-visible.
 */

const PRODUCTIVITY_CHAINS = {
    "morning-startup": {
        goal:     "Start development environment for the day",
        steps: [
            { cmd: "node --version && npm --version",                     label: "Verify Node/npm available",               approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "git status --short",                                  label: "Check git workspace state",               approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "df -h . | tail -1",                                   label: "Check disk space",                        approvalLevel: "SAFE",    failBehavior: "abort" },
            { cmd: "pm2 list",                                            label: "Check existing pm2 processes",            approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "pm2 start ecosystem.config.cjs 2>/dev/null || pm2 restart all", label: "Start/restart services via pm2", approvalLevel: "CAUTION", failBehavior: "continue",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "sleep 2 && curl -sf http://localhost:3001/api/health | head -c 100", label: "Verify API responding", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
        ],
        maxRetries: 1,
    },

    "project-recovery": {
        goal:     "Recover broken development environment",
        steps: [
            { cmd: "pm2 delete all 2>/dev/null || true",                  label: "Clear all pm2 processes",                 approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "lsof -ti :3001 :5173 | xargs kill -9 2>/dev/null || true", label: "Free conflicting ports",           approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "npm install --prefer-offline 2>&1 | tail -5",        label: "Reinstall root dependencies",             approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "cd frontend && npm install --prefer-offline 2>&1 | tail -5 && cd ..", label: "Reinstall frontend deps", approvalLevel: "CAUTION", failBehavior: "continue" },
            { cmd: "pm2 start ecosystem.config.cjs",                     label: "Start backend",                           approvalLevel: "CAUTION", failBehavior: "abort",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "sleep 2 && curl -sf http://localhost:3001/api/health", label: "Verify backend alive",                  approvalLevel: "SAFE",    failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
        ],
        maxRetries: 1,
    },

    "dependency-validation": {
        goal:     "Verify all project dependencies are correctly installed",
        steps: [
            { cmd: "npm ls --depth=0 2>&1 | head -30",                   label: "Root dependency tree",                    approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "cd frontend && npm ls --depth=0 2>&1 | head -30",    label: "Frontend dependency tree",                approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "npm audit --audit-level=critical 2>&1 | head -20",   label: "Security audit (critical only)",          approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "ls node_modules/.bin | wc -l && ls frontend/node_modules/.bin 2>/dev/null | wc -l", label: "Count installed binaries", approvalLevel: "SAFE", failBehavior: "continue" },
            { cmd: "node -e \"require('./backend/server.cjs') && process.exit(0)\" 2>&1 | head -5", label: "Backend require smoke test", approvalLevel: "SAFE", failBehavior: "continue" },
        ],
        maxRetries: 0,
    },

    "multi-service-startup": {
        goal:     "Start backend and frontend services in correct order",
        steps: [
            { cmd: "pm2 stop jarvis-backend 2>/dev/null || true",         label: "Stop backend if running",                 approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "pm2 start ecosystem.config.cjs",                     label: "Start backend via pm2",                   approvalLevel: "CAUTION", failBehavior: "abort",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "sleep 3 && curl -sf http://localhost:3001/api/health", label: "Wait for backend ready",                approvalLevel: "SAFE",    failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
            { cmd: "echo 'Backend ready. Start frontend dev server manually: cd frontend && npm run dev'", label: "Frontend startup instruction", approvalLevel: "SAFE", failBehavior: "continue" },
        ],
        maxRetries: 1,
    },

    "dev-health-check": {
        goal:     "Comprehensive development environment health check",
        steps: [
            { cmd: "git status --short && git log --oneline -3",         label: "Git workspace + recent commits",          approvalLevel: "SAFE",    failBehavior: "continue" },
            { cmd: "pm2 list",                                           label: "pm2 process overview",                    approvalLevel: "SAFE",    failBehavior: "continue",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "curl -sf http://localhost:3001/api/health 2>/dev/null && echo 'API:ok' || echo 'API:down'", label: "API reachability", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
            { cmd: "ls frontend/dist/index.html 2>/dev/null && echo 'build:ok' || echo 'build:missing'", label: "Frontend build present", approvalLevel: "SAFE", failBehavior: "continue",
              probes: { files: ["frontend/dist/index.html"] } },
            { cmd: "df -h . | tail -1 && node -e \"console.log('heap:',Math.round(process.memoryUsage().heapUsed/1e6)+'MB')\"", label: "Disk + memory", approvalLevel: "SAFE", failBehavior: "continue" },
        ],
        maxRetries: 0,
    },
};

function getChain(name) {
    const c = PRODUCTIVITY_CHAINS[name];
    return c ? { name, ...c } : null;
}

function listChains() {
    return Object.entries(PRODUCTIVITY_CHAINS).map(([name, c]) => ({
        name,
        goal:      c.goal,
        stepCount: c.steps.length,
        maxRetries: c.maxRetries,
    }));
}

/**
 * Suggest the best chain for a time-of-day or intent.
 * @param {string} intent
 */
function suggest(intent) {
    const lower = (intent || "").toLowerCase();
    if (/morning|start.*day|wake|boot/i.test(lower))           return getChain("morning-startup");
    if (/recover|broken|restart.*all|reset.*env/i.test(lower)) return getChain("project-recovery");
    if (/dep|package|module|install/i.test(lower))             return getChain("dependency-validation");
    if (/service|startup|launch/i.test(lower))                 return getChain("multi-service-startup");
    return getChain("dev-health-check");
}

module.exports = { getChain, listChains, suggest, PRODUCTIVITY_CHAINS };
