"use strict";
/**
 * Phase 357 + 386-390 — Execution Chain Planner
 *
 * Real operational chains for frontend recovery, backend recovery,
 * VS Code navigation, git operations, and deployment readiness.
 *
 * Rules:
 *   - Max depth: 8 steps per chain
 *   - Risky steps require approvalLevel = "caution" or "critical"
 *   - Every step has a failBehavior: "stop" | "continue" | "warn"
 *   - Steps with probes run post-execution verification automatically
 *   - Chains are interruptible at every step boundary
 */

// Step schema:
//   cmd:           string — shell command
//   label:         string — operator-facing description
//   approvalLevel: "safe" | "caution" | "critical"
//   failBehavior:  "stop" | "continue" | "warn"
//   canSkip:       bool — operator can skip this step
//   probes:        { pm2Processes?, httpEndpoints?, files? } — post-step verification
//   successHint:   string — what "success" looks like in output (regex string for UI)

const CHAIN_TEMPLATES = [

    // ── Phase 386: Frontend Recovery ─────────────────────────────────────────
    {
        name:  "recover-frontend-runtime",
        match: /recover.*(frontend|react|ui|browser)|frontend.*(broken|crash|fail|down)/i,
        steps: [
            {
                cmd:          "pm2 logs jarvis-backend --lines 50 --nostream 2>&1",
                label:        "Inspect recent backend logs",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "ls -la frontend/node_modules/.bin/react-scripts 2>/dev/null && echo 'OK' || echo 'MISSING'",
                label:        "Verify node_modules integrity",
                approvalLevel: "safe", failBehavior: "continue",
                successHint:  "OK",
            },
            {
                cmd:          "cd frontend && npm ls --depth=0 2>&1 | grep -E 'UNMET|ERR|missing' | head -10 || echo 'deps OK'",
                label:        "Detect dependency issues",
                approvalLevel: "safe", failBehavior: "continue",
                successHint:  "deps OK",
            },
            {
                cmd:          "cd frontend && npm run build 2>&1 | tail -20",
                label:        "Rebuild frontend bundle",
                approvalLevel: "caution", failBehavior: "stop",
                probes:       { files: ["frontend/build/index.html"] },
                successHint:  "Compiled successfully",
            },
            {
                cmd:          "pm2 restart jarvis-backend 2>&1",
                label:        "Restart backend runtime",
                approvalLevel: "caution", failBehavior: "stop",
                probes:       { pm2Processes: ["jarvis-backend"] },
            },
            {
                cmd:          "sleep 2 && curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health",
                label:        "Validate browser-reachable API",
                approvalLevel: "safe", failBehavior: "warn",
                probes:       { httpEndpoints: ["http://localhost:3001/api/health"] },
                successHint:  "200",
            },
            {
                cmd:          "pm2 status 2>&1 | grep -E 'jarvis|online|error'",
                label:        "Summarize runtime outcome",
                approvalLevel: "safe", failBehavior: "warn",
                successHint:  "online",
            },
        ],
    },

    // ── Phase 387: Backend Recovery ──────────────────────────────────────────
    {
        name:  "recover-backend",
        match: /recover.*(backend|server|api)|backend.*(down|crash|fail|restart)|restart.*backend|port.*conflict/i,
        steps: [
            {
                cmd:          "pm2 logs jarvis-backend --lines 50 --nostream 2>&1 | tail -30",
                label:        "Inspect crash logs",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "lsof -ti :3001 2>/dev/null | head -5 || echo 'port clear'",
                label:        "Check port 3001 conflicts",
                approvalLevel: "safe", failBehavior: "continue",
                successHint:  "port clear",
            },
            {
                cmd:          "lsof -ti :3001 | xargs kill -9 2>/dev/null; echo 'cleared'",
                label:        "Clear port conflict if present",
                approvalLevel: "caution", failBehavior: "continue", canSkip: true,
            },
            {
                cmd:          "ls -la node_modules/.bin/pm2 2>/dev/null && echo 'OK' || npm install --omit=dev 2>&1 | tail -5",
                label:        "Verify backend dependencies",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "pm2 restart jarvis-backend 2>&1",
                label:        "Restart backend process",
                approvalLevel: "caution", failBehavior: "stop",
                probes:       { pm2Processes: ["jarvis-backend"] },
            },
            {
                cmd:          "sleep 3 && curl -s http://localhost:3001/api/health 2>&1 | head -100",
                label:        "Validate API readiness",
                approvalLevel: "safe", failBehavior: "warn",
                probes:       { httpEndpoints: ["http://localhost:3001/api/health"] },
                successHint:  "status",
            },
            {
                cmd:          "pm2 status 2>&1",
                label:        "Confirm stable runtime state",
                approvalLevel: "safe", failBehavior: "warn",
                successHint:  "online",
            },
        ],
    },

    // ── Phase 388: VS Code Workflows ─────────────────────────────────────────
    {
        name:  "vscode-error-navigation",
        match: /vscode|vs.?code|open.*(file|error)|jump.*(error|fail)|navigate.*module/i,
        steps: [
            {
                cmd:          "cd frontend && npm run build 2>&1 | grep -E 'ERROR|error TS|Failed' | head -20",
                label:        "Locate build errors",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "grep -rn 'console.error\\|throw new\\|catch' frontend/src --include='*.js' --include='*.jsx' -l | head -10",
                label:        "Find error-throwing source files",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "code --list-extensions 2>/dev/null | head -20 || echo 'VS Code not in PATH'",
                label:        "Check VS Code available extensions",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "pm2 logs jarvis-backend --lines 30 --nostream 2>&1 | grep -E 'Error|WARN|FATAL' | head -15",
                label:        "Surface runtime-relevant errors",
                approvalLevel: "safe", failBehavior: "continue",
            },
        ],
    },

    // ── Phase 389: Git Operation Chains ──────────────────────────────────────
    {
        name:  "git-safe-update",
        match: /git.*(pull|sync|update|rebase)|safe.*pull|pull.*rebase/i,
        steps: [
            {
                cmd:          "git status --short 2>&1",
                label:        "Check working tree for uncommitted changes",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git stash list 2>&1 | head -5 || echo 'no stash'",
                label:        "Check existing stash entries",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git diff --stat HEAD 2>&1 | tail -5",
                label:        "Summarize uncommitted diff",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git fetch --dry-run 2>&1",
                label:        "Preview remote changes (dry-run fetch)",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git pull --rebase origin $(git rev-parse --abbrev-ref HEAD 2>/dev/null) 2>&1 | tail -10",
                label:        "Pull with rebase",
                approvalLevel: "caution", failBehavior: "stop",
            },
            {
                cmd:          "git log --oneline -5 2>&1",
                label:        "Confirm latest commits after pull",
                approvalLevel: "safe", failBehavior: "continue",
            },
        ],
    },
    {
        name:  "git-conflict-recovery",
        match: /git.*(conflict|merge.*fail)|conflict.*recover|rebase.*abort/i,
        steps: [
            {
                cmd:          "git status 2>&1",
                label:        "Inspect conflict state",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git diff --name-only --diff-filter=U 2>&1",
                label:        "List conflicted files",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git rebase --abort 2>&1 || git merge --abort 2>&1 || echo 'no active operation'",
                label:        "Abort conflicted rebase/merge",
                approvalLevel: "caution", failBehavior: "warn", canSkip: true,
            },
            {
                cmd:          "git status --short 2>&1",
                label:        "Verify clean state after abort",
                approvalLevel: "safe", failBehavior: "warn",
            },
        ],
    },

    // ── Phase 390: Deployment Readiness ──────────────────────────────────────
    {
        name:  "deployment-readiness",
        match: /deploy.*(ready|check|verify|readiness)|pre.?deploy|ready.*(deploy|prod|release)/i,
        steps: [
            {
                cmd:          "node --version && npm --version 2>&1",
                label:        "Verify Node/npm environment",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "npm ls --depth=0 2>&1 | grep -E 'UNMET|missing' | wc -l | xargs -I{} sh -c 'if [ {} -eq 0 ]; then echo \"deps OK\"; else echo \"{} missing deps\"; fi'",
                label:        "Check dependency integrity",
                approvalLevel: "safe", failBehavior: "warn",
                successHint:  "deps OK",
            },
            {
                cmd:          "npm test -- --watchAll=false 2>&1 | tail -15",
                label:        "Run test suite",
                approvalLevel: "safe", failBehavior: "stop",
                successHint:  "passed|Tests:",
            },
            {
                cmd:          "cd frontend && npm run build 2>&1 | tail -10",
                label:        "Build frontend bundle",
                approvalLevel: "caution", failBehavior: "stop",
                probes:       { files: ["frontend/build/index.html"] },
                successHint:  "Compiled successfully",
            },
            {
                cmd:          "pm2 status 2>&1",
                label:        "Verify runtime process health",
                approvalLevel: "safe", failBehavior: "warn",
                probes:       { pm2Processes: ["jarvis-backend"] },
                successHint:  "online",
            },
            {
                cmd:          "curl -s http://localhost:3001/api/health 2>&1 | head -100",
                label:        "Validate API health endpoint",
                approvalLevel: "safe", failBehavior: "warn",
                probes:       { httpEndpoints: ["http://localhost:3001/api/health"] },
            },
            {
                cmd:          "df -h . 2>&1 | tail -3",
                label:        "Check disk headroom",
                approvalLevel: "safe", failBehavior: "continue",
            },
            {
                cmd:          "git log --oneline -3 2>&1 && git status --short 2>&1",
                label:        "Confirm git state clean",
                approvalLevel: "safe", failBehavior: "warn",
            },
        ],
    },

    // ── Existing chains (preserved) ───────────────────────────────────────────
    {
        name:  "stabilize-frontend",
        match: /stabilize.*(frontend|ui|react)|frontend.*stable/i,
        steps: [
            { cmd: "pm2 logs jarvis-backend --lines 30 --nostream 2>&1", label: "Inspect recent backend logs", approvalLevel: "safe", failBehavior: "continue" },
            { cmd: "cd frontend && npm ls --depth=0 2>&1 | head -20",   label: "Check frontend dependencies",  approvalLevel: "safe", failBehavior: "continue" },
            { cmd: "cd frontend && npm run build 2>&1 | tail -30",       label: "Build frontend bundle",        approvalLevel: "caution", failBehavior: "stop",
              probes: { files: ["frontend/build/index.html"] } },
            { cmd: "pm2 restart jarvis-backend 2>&1",                    label: "Restart backend runtime",      approvalLevel: "caution", failBehavior: "stop",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "pm2 status 2>&1",                                    label: "Verify runtime is healthy",    approvalLevel: "safe", failBehavior: "warn" },
        ],
    },
    {
        name:  "deploy-update",
        match: /deploy|push.*(prod|main)|release/i,
        steps: [
            { cmd: "git status 2>&1",                                              label: "Check working tree",         approvalLevel: "safe",     failBehavior: "continue" },
            { cmd: "npm test -- --watchAll=false 2>&1 | tail -20",                 label: "Run tests",                  approvalLevel: "safe",     failBehavior: "stop" },
            { cmd: "npm run build 2>&1 | tail -20",                                label: "Build artifacts",            approvalLevel: "caution",  failBehavior: "stop" },
            { cmd: "git push 2>&1",                                                label: "Push to remote",             approvalLevel: "critical", failBehavior: "stop" },
            { cmd: "pm2 restart jarvis-backend 2>&1",                              label: "Restart runtime",            approvalLevel: "caution",  failBehavior: "stop",
              probes: { pm2Processes: ["jarvis-backend"] } },
            { cmd: "pm2 logs jarvis-backend --lines 20 --nostream 2>&1",           label: "Verify post-deploy logs",    approvalLevel: "safe",     failBehavior: "warn" },
        ],
    },
    {
        name:  "health-check",
        match: /health.?check|diagnose|system.?status|check.*runtime/i,
        steps: [
            { cmd: "pm2 status 2>&1",                                              label: "Runtime process status",     approvalLevel: "safe", failBehavior: "continue" },
            { cmd: "pm2 logs jarvis-backend --lines 20 --nostream 2>&1",           label: "Recent backend logs",        approvalLevel: "safe", failBehavior: "continue" },
            { cmd: "df -h 2>&1",                                                   label: "Disk usage",                 approvalLevel: "safe", failBehavior: "continue" },
            { cmd: "free -h 2>/dev/null || vm_stat 2>&1",                          label: "Memory usage",               approvalLevel: "safe", failBehavior: "continue" },
            { cmd: "curl -s http://localhost:3001/api/health 2>&1 | head -200",    label: "API health endpoint",        approvalLevel: "safe", failBehavior: "warn",
              probes: { httpEndpoints: ["http://localhost:3001/api/health"] } },
        ],
    },
    {
        name:  "clean-install",
        match: /clean.?install|reinstall.?deps|fresh.*install/i,
        steps: [
            { cmd: "rm -rf node_modules package-lock.json",  label: "Remove existing node_modules", approvalLevel: "caution", failBehavior: "stop" },
            { cmd: "npm install 2>&1 | tail -10",            label: "Fresh install",                 approvalLevel: "caution", failBehavior: "stop" },
            { cmd: "npm run build 2>&1 | tail -20",          label: "Rebuild artifacts",             approvalLevel: "caution", failBehavior: "warn" },
            { cmd: "npm test -- --watchAll=false 2>&1 | tail -10", label: "Verify tests pass",       approvalLevel: "safe",    failBehavior: "warn" },
        ],
    },
];

const MAX_DEPTH = 8;

function planChain(goal) {
    if (!goal || typeof goal !== "string") return null;
    const template = CHAIN_TEMPLATES.find(t => t.match.test(goal));
    if (!template) return null;
    return {
        name:  template.name,
        goal,
        steps: template.steps.slice(0, MAX_DEPTH).map((s, i) => ({ ...s, idx: i })),
    };
}

function listTemplates() {
    return CHAIN_TEMPLATES.map(t => ({
        name:        t.name,
        pattern:     t.match.toString(),
        steps:       t.steps.length,
        hasCritical: t.steps.some(s => s.approvalLevel === "critical"),
        hasCaution:  t.steps.some(s => s.approvalLevel === "caution"),
        hasProbes:   t.steps.some(s => s.probes),
    }));
}

function classifyApprovalLevel(cmd) {
    if (!cmd) return "safe";
    const lower = cmd.trim().toLowerCase();
    if (/rm -rf|drop (table|database)|shutdown|reboot|format|mkfs/i.test(lower)) return "critical";
    if (/git push|pm2 (restart|delete|stop)|npm run build|rm |kill |pkill/i.test(lower)) return "caution";
    return "safe";
}

module.exports = { planChain, listTemplates, classifyApprovalLevel };
