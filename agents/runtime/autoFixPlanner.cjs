"use strict";
/**
 * Auto-Fix Planner — converts an RCA report into a structured engineering fix plan.
 *
 * Entry points:
 *   plan(rcaId, opts)           — generate fix plan for a stored RCA report
 *   planInline(rcaReport, opts) — same but accepts the report object directly
 *   getPlan(planId)             — retrieve one stored plan
 *   listPlans(opts)             — list stored plans
 *
 * Reuses:
 *   - rootCauseAnalyzer.getReport()     (RCA report as input)
 *   - incidentEngine.getIncident()      (original incident for context)
 *   - patchAssistant.proposePatch/proposeSet  (register patch proposals)
 *   - deploymentPipeline.PIPELINES      (pipeline names for deploy tasks)
 *   - data/api-manifests.json           (route → file targets)
 *   - data/db-manifests.json            (table → migration targets)
 *
 * No new architecture. No AI calls. No agent army.
 *
 * Fix plan pipeline (per RCA):
 *   1. strategyMapping    — cause.category → fix strategy + approach
 *   2. targetFiles        — which files to patch, in what order, with what role
 *   3. taskGraph          — ordered tasks with dependsOn, owner, and verification
 *   4. pipelineSelection  — which deployment pipeline to run after patching
 *   5. confidenceScoring  — inherit RCA confidence, adjust for target file availability
 *   6. riskAssessment     — risk level (LOW/MEDIUM/HIGH/CRITICAL) from cause + severity
 *   7. planGeneration     — assemble FixPlan + persist to data/fix-plans.json
 *
 * Fix strategy categories (one per cause category):
 *   deploy_regression   — revert commit OR cherry-pick fix, redeploy via safe-update pipeline
 *   database_error      — run migration repair, check connection pool, restart service
 *   external_dependency — add retry/timeout, disable failing integration, add circuit breaker
 *   config_error        — set missing env vars, restart, verify /health
 *   code_error          — patch handler/service, add error guard, redeploy
 *   capacity_error      — add caching/indexing, scale horizontally, reduce payload size
 *   unknown             — manual triage — enable debug logging, collect stack traces
 *
 * Risk levels:
 *   CRITICAL  — deploy_regression with severity CRITICAL, or database_error with data risk
 *   HIGH      — deploy_regression HIGH, route_failure, database_error MEDIUM+
 *   MEDIUM    — api_error_spike, api_repeated_error, external_dependency
 *   LOW       — health_degraded, slow_api, deploy_slow, config_error (env-only)
 *
 * Task types:
 *   investigate   — read logs, check status (no change, always safe)
 *   patch_file    — edit a source file (requires approval, registers with patchAssistant)
 *   run_migration — apply a DB migration (HIGH risk, needs DBA approval)
 *   run_command   — shell command (git, pm2, npm — CAUTION level)
 *   redeploy      — trigger a named pipeline (uses deploymentPipeline)
 *   verify        — run a health check or test suite
 *   notify        — alert the team (low risk, informational)
 *
 * FixPlan shape:
 *   {
 *     planId, rcaId, incidentId, createdAt,
 *     strategy:  { category, approach, rationale },
 *     risk:      { level, factors[] },
 *     confidence,
 *     targetFiles: [{ filePath, role, feature, action, priority }],
 *     tasks: [{
 *       seq, type, title, detail,
 *       targetFile?, command?, pipeline?,
 *       dependsOn: number[],
 *       approvalRequired: boolean,
 *       estimatedMins: number,
 *       patchId?     — set when proposePatch is called during planning
 *     }],
 *     pipeline: { name, label, requiresApproval },
 *     suggestedChanges: string[],   — human-readable summary of what to change
 *     status: "draft" | "approved" | "executing" | "done" | "abandoned",
 *   }
 *
 * Storage: data/fix-plans.json  (max 100, newest-first, atomic write)
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR   = path.join(__dirname, "../../data");
const PLANS_PATH = path.join(DATA_DIR, "fix-plans.json");
const MAX_PLANS  = 100;

function _rca()  { return require("./rootCauseAnalyzer.cjs"); }
function _inc()  { return require("./incidentEngine.cjs"); }

// patchAssistant and deploymentPipeline are optional — if unavailable, planning still works
// but patch registration is skipped.
function _patch()    { try { return require("./patchAssistant.cjs"); }    catch { return null; } }
function _pipeline() { try { return require("./deploymentPipeline.cjs"); } catch { return null; } }

// ── Storage ───────────────────────────────────────────────────────
function _loadPlans() {
    try {
        const raw    = fs.readFileSync(PLANS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _savePlans(plans) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = PLANS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(plans.slice(0, MAX_PLANS), null, 2));
    fs.renameSync(tmp, PLANS_PATH);
}

function _persistPlan(plan) {
    const all = _loadPlans();
    const idx = all.findIndex(p => p.planId === plan.planId);
    if (idx !== -1) all[idx] = plan;
    else all.unshift(plan);
    _savePlans(all);
}

let _idCounter = Date.now();
function _newId() { return `plan_${++_idCounter}`; }

// ── Manifest loaders ──────────────────────────────────────────────
function _loadJson(fp) {
    try { const d = JSON.parse(fs.readFileSync(fp, "utf8")); return Array.isArray(d) ? d : (d && typeof d === "object" ? d : null); }
    catch { return null; }
}
function _apiManifests() { return _loadJson(path.join(DATA_DIR, "api-manifests.json")) || []; }
function _dbManifests()  { return _loadJson(path.join(DATA_DIR, "db-manifests.json"))  || []; }

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — Strategy mapping
// cause.category → { category, approach, rationale, suggestedChanges[] }
// ═══════════════════════════════════════════════════════════════════

const STRATEGY_MAP = {
    deploy_regression: {
        approach:  "revert-or-fix",
        rationale: "A recent deploy introduced the regression. The fastest path to recovery is to revert the bad commit or cherry-pick a fix. Then redeploy through the safe-update pipeline.",
        suggestedChanges: [
            "Identify the bad commit: git log --oneline -10",
            "Revert: git revert <commit> --no-edit",
            "Or cherry-pick the fix commit: git cherry-pick <fix-sha>",
            "Run the safe-update pipeline to redeploy",
            "Verify health endpoint returns ok after deploy",
        ],
    },
    database_error: {
        approach:  "migration-repair",
        rationale: "Database connectivity or schema issue. Check migration status, connection pool, and table integrity before attempting any code changes.",
        suggestedChanges: [
            "Check DB connectivity: pg_isready or sqlite3 <db> '.tables'",
            "Run pending migrations: node scripts/migrate.js (or equivalent)",
            "Check for missing tables referenced by the failing route",
            "Verify connection pool settings in service config",
            "Restart the service after migration to reload DB connection pool",
        ],
    },
    external_dependency: {
        approach:  "circuit-break-and-degrade",
        rationale: "An external service (payment gateway, messaging API, etc.) is returning errors. Add retry logic, circuit breaker, or graceful degradation so errors don't cascade.",
        suggestedChanges: [
            "Check external service status page",
            "Add try/catch with fallback response in the failing route handler",
            "Wrap external calls in a retry with exponential backoff (max 3 retries)",
            "Add circuit breaker: if 3 consecutive failures, return 503 instead of forwarding",
            "Set a hard timeout on the external HTTP call (default: 5000ms)",
        ],
    },
    config_error: {
        approach:  "env-fix-and-restart",
        rationale: "A missing or incorrect environment variable is disabling a service or causing runtime errors. Set the required vars and restart.",
        suggestedChanges: [
            "Review GET /health warnings for disabled services",
            "Add missing env vars to .env file",
            "Verify JWT_SECRET, GROQ_API_KEY, and any service-specific keys",
            "Restart the process: pm2 restart jarvis or equivalent",
            "Confirm GET /health returns ok with no service warnings",
        ],
    },
    code_error: {
        approach:  "patch-and-redeploy",
        rationale: "A handler, service, or middleware is throwing unhandled exceptions. Patch the specific file, add error handling, and redeploy.",
        suggestedChanges: [
            "Search logs for 'Error:' and 'UnhandledPromiseRejection' around incident time",
            "Add try/catch to the failing route handler",
            "Add input validation before calling downstream services",
            "Ensure the route returns a proper JSON error response (not an unhandled throw)",
            "Run the existing test suite: node --test tests/runtime/",
        ],
    },
    capacity_error: {
        approach:  "optimize-and-scale",
        rationale: "Resource exhaustion (memory, query time, rate limits). Profile the bottleneck before applying fixes.",
        suggestedChanges: [
            "Check GET /ops for heap usage and memory trend",
            "Profile slow routes: add query timing logs to service files",
            "Add DB index on frequently-queried columns",
            "Add response caching for read-heavy endpoints (e.g. GET /plans)",
            "Consider horizontal scaling if heap consistently above 350MB",
        ],
    },
    unknown: {
        approach:  "manual-triage",
        rationale: "Insufficient signal to determine a fix strategy. Enable verbose logging, collect stack traces, and re-run detection after gathering more data.",
        suggestedChanges: [
            "Enable debug logging: set LOG_LEVEL=debug in .env and restart",
            "Tail logs: pm2 logs jarvis --lines 200",
            "Run POST /incidents/detect after 5 minutes to re-evaluate",
            "Review raw telemetry: GET /metrics?windowMins=30",
        ],
    },
};

function _mapStrategy(causeCategory) {
    return STRATEGY_MAP[causeCategory] || STRATEGY_MAP.unknown;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2 — Target files
// Combine RCA affectedFiles with manifest data, assign priority and action
// ═══════════════════════════════════════════════════════════════════

const FILE_ROLE_PRIORITY = { migration: 1, service: 2, route: 3, validator: 4, middleware: 5 };
const FILE_ROLE_ACTION   = {
    migration:  "run_migration",
    service:    "patch_file",
    route:      "patch_file",
    validator:  "patch_file",
    middleware: "patch_file",
};

function _targetFiles(rcaReport, causeCategory) {
    const fromRca = rcaReport.affectedFiles || [];

    // Also pull any migration files from db-manifests when database_error
    const extra = [];
    if (causeCategory === "database_error") {
        const dbM = _dbManifests();
        const affectedTables = new Set(
            (rcaReport.affectedComponents || [])
                .filter(c => c.type === "table")
                .map(c => c.name)
        );
        for (const manifest of dbM) {
            if (Array.isArray(manifest.tables)) {
                manifest.tables
                    .filter(t => affectedTables.has(t.name))
                    .forEach(() => {
                        // DB manifests don't carry file paths, but api-manifests do
                    });
            }
        }
        // Pull migration files from api-manifests for affected routes
        const apiM = _apiManifests();
        const affectedPaths = new Set((rcaReport.affectedRoutes || []).map(r => r.path));
        for (const m of apiM) {
            if (!m.filePaths?.migrations) continue;
            const matches = [...affectedPaths].some(ap =>
                m.apiPath === ap ||
                ap.startsWith((m.apiPath || "").replace(/\/:.*$/, "")) ||
                (m.apiPath || "").startsWith(ap.replace(/\/:.*$/, ""))
            );
            if (!matches) continue;
            for (const mig of m.filePaths.migrations) {
                if (!fromRca.find(f => f.filePath === mig)) {
                    extra.push({ filePath: mig, role: "migration", feature: m.filePaths.featureName || null });
                }
            }
        }
    }

    const combined = [...fromRca, ...extra];
    const seen     = new Set();
    const targets  = [];

    for (const f of combined) {
        if (!f.filePath || seen.has(f.filePath)) continue;
        seen.add(f.filePath);
        targets.push({
            filePath:  f.filePath,
            role:      f.role || "unknown",
            feature:   f.feature || null,
            action:    FILE_ROLE_ACTION[f.role] || "patch_file",
            priority:  FILE_ROLE_PRIORITY[f.role] ?? 9,
        });
    }

    // Sort by priority: migrations first, then services, routes, validators
    targets.sort((a, b) => a.priority - b.priority);
    return targets;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3 — Task graph
// Ordered tasks with dependsOn. Each task has a type, title, detail,
// estimated time, and approval requirement.
// ═══════════════════════════════════════════════════════════════════

function _buildTaskGraph(strategy, targetFiles, rcaReport, pipelineName) {
    const tasks  = [];
    let   seq    = 1;
    const ids    = {};  // filePath → seq, for dependsOn wiring

    function addTask(type, title, detail, opts = {}) {
        const task = {
            seq,
            type,
            title,
            detail,
            targetFile:       opts.targetFile       || null,
            command:          opts.command           || null,
            pipeline:         opts.pipeline          || null,
            dependsOn:        opts.dependsOn         || [],
            approvalRequired: opts.approvalRequired  ?? (type === "patch_file" || type === "run_migration" || type === "redeploy"),
            estimatedMins:    opts.estimatedMins     || _estimateMins(type),
        };
        tasks.push(task);
        if (opts.targetFile) ids[opts.targetFile] = seq;
        seq++;
        return task.seq;
    }

    function _estimateMins(type) {
        return { investigate: 5, patch_file: 15, run_migration: 10, run_command: 5, redeploy: 10, verify: 5, notify: 1 }[type] || 10;
    }

    const cause      = rcaReport.cause?.category;
    const severity   = rcaReport.incident?.severity;
    const affRoutes  = rcaReport.affectedRoutes || [];
    const deployCorr = rcaReport.deployCorrelation || {};

    // ── Task 1: always start with investigation ───────────────────
    addTask("investigate", "Review incident timeline and logs",
        `Check logs around ${rcaReport.incident?.openedAt || "incident open time"}. ` +
        `Incident: ${rcaReport.incident?.title || "unknown"}. ` +
        `Cause category: ${cause || "unknown"}.`,
        { approvalRequired: false, estimatedMins: 5 }
    );

    // ── Category-specific task sequence ──────────────────────────

    if (cause === "deploy_regression") {
        if (deployCorr.correlated && deployCorr.gitHead) {
            addTask("run_command",
                `Inspect commit ${deployCorr.gitHead}`,
                `git show ${deployCorr.gitHead} --stat to see what changed. Deploy was ${deployCorr.deltaMinutes}m before incident.`,
                { command: `git show ${deployCorr.gitHead} --stat`, dependsOn: [1], approvalRequired: false, estimatedMins: 3 }
            );
            addTask("run_command",
                `Revert commit ${deployCorr.gitHead}`,
                `git revert ${deployCorr.gitHead} --no-edit creates a safe revert commit without losing history.`,
                { command: `git revert ${deployCorr.gitHead} --no-edit`, dependsOn: [seq - 1], approvalRequired: true, estimatedMins: 5 }
            );
        } else {
            addTask("run_command",
                "Review recent git log for regression",
                "git log --oneline -10 to identify which commit introduced the failure.",
                { command: "git log --oneline -10", dependsOn: [1], approvalRequired: false, estimatedMins: 5 }
            );
        }
        // Patch any implicated source files
        for (const tf of targetFiles.filter(f => f.action === "patch_file")) {
            addTask("patch_file",
                `Fix regression in ${path.basename(tf.filePath)}`,
                `Patch ${tf.filePath} to restore pre-regression behaviour. Check error handling and any changed logic.`,
                { targetFile: tf.filePath, dependsOn: [seq - 1], estimatedMins: 20 }
            );
        }
    }

    if (cause === "database_error") {
        addTask("investigate",
            "Check database connectivity",
            "Run: sqlite3 data/jarvis.db '.tables' or pg_isready. Look for 'no table', 'connection refused', or pool exhaustion errors in logs.",
            { approvalRequired: false, dependsOn: [1], estimatedMins: 5 }
        );
        // Migrations first
        for (const tf of targetFiles.filter(f => f.action === "run_migration")) {
            const migSeq = addTask("run_migration",
                `Apply migration: ${path.basename(tf.filePath)}`,
                `Run migration ${tf.filePath} to ensure the table schema matches what the service expects.`,
                { targetFile: tf.filePath, dependsOn: [seq - 1], estimatedMins: 10 }
            );
        }
        // Then patch service if needed
        for (const tf of targetFiles.filter(f => f.action === "patch_file" && f.role === "service")) {
            addTask("patch_file",
                `Add connection error handling in ${path.basename(tf.filePath)}`,
                `Wrap DB calls in ${tf.filePath} with try/catch. Return a clear error response on DB failure instead of propagating the exception.`,
                { targetFile: tf.filePath, dependsOn: [seq - 1], estimatedMins: 15 }
            );
        }
    }

    if (cause === "external_dependency") {
        const failingRoutes = affRoutes.filter(r => r.errorRate >= 50);
        for (const r of failingRoutes.slice(0, 3)) {
            const routeFile = targetFiles.find(f => f.role === "route" &&
                f.filePath.toLowerCase().includes(r.path.replace(/^\/api\//,"").replace(/\//g,"-").split(":")[0])
            );
            if (routeFile) {
                addTask("patch_file",
                    `Add retry + fallback in ${path.basename(routeFile.filePath)}`,
                    `In ${routeFile.filePath}: wrap the external call with try/catch, add 3-retry logic with 1s backoff, return a 503 with Retry-After header on exhaustion.`,
                    { targetFile: routeFile.filePath, dependsOn: [1], estimatedMins: 20 }
                );
            } else {
                addTask("investigate",
                    `Locate handler for ${r.path}`,
                    `Search codebase for the route handler: grep -r '"${r.path}"\' backend/routes/`,
                    { command: `grep -r '"${r.path}"\' backend/routes/`, dependsOn: [1], approvalRequired: false, estimatedMins: 5 }
                );
            }
        }
        addTask("run_command",
            "Check external service status",
            "Review the external service's status page. If confirmed outage, no code change needed — wait for recovery.",
            { command: "curl -s https://status.stripe.com/api/v2/summary.json | head -5", dependsOn: [1], approvalRequired: false, estimatedMins: 3 }
        );
    }

    if (cause === "config_error") {
        addTask("investigate",
            "Audit missing environment variables",
            "GET /health — check the 'warnings' array for disabled services. Cross-reference with .env.example.",
            { approvalRequired: false, dependsOn: [1], estimatedMins: 5 }
        );
        addTask("patch_file",
            "Update .env with missing variables",
            "Add required environment variables to the .env file. Never commit secrets — add to .env only, not .env.example.",
            { targetFile: ".env", dependsOn: [seq - 1], estimatedMins: 10 }
        );
        addTask("run_command",
            "Restart service",
            "pm2 restart jarvis (or: node backend/server.js) to reload environment variables.",
            { command: "pm2 restart jarvis", dependsOn: [seq - 1], approvalRequired: true, estimatedMins: 5 }
        );
    }

    if (cause === "code_error") {
        addTask("investigate",
            "Locate exception in logs",
            `Search logs for unhandled errors: grep -i 'error\\|exception\\|unhandled' logs/runtime-alerts.log | tail -20`,
            { command: "grep -i 'error\\|exception\\|unhandled' logs/runtime-alerts.log | tail -20", dependsOn: [1], approvalRequired: false, estimatedMins: 5 }
        );
        // Patch route and service files
        for (const tf of targetFiles.filter(f => f.action === "patch_file")) {
            const isRoute   = tf.role === "route";
            const isService = tf.role === "service";
            if (!isRoute && !isService) continue;
            addTask("patch_file",
                `Add error handling in ${path.basename(tf.filePath)}`,
                `In ${tf.filePath}: wrap the handler body in try/catch. Return res.status(500).json({ error: 'Internal error' }) on exception. Validate request inputs before calling downstream.`,
                { targetFile: tf.filePath, dependsOn: [seq - 1], estimatedMins: 15 }
            );
        }
        addTask("run_command",
            "Run test suite",
            "node --test tests/runtime/ — confirm no new failures introduced by the patch.",
            { command: "node --test tests/runtime/", dependsOn: [seq - 1], approvalRequired: false, estimatedMins: 10 }
        );
    }

    if (cause === "capacity_error") {
        addTask("investigate",
            "Profile memory and query performance",
            "GET /ops — check heap usage and memory trend. GET /metrics — identify highest-latency routes.",
            { approvalRequired: false, dependsOn: [1], estimatedMins: 10 }
        );
        for (const tf of targetFiles.filter(f => f.action === "patch_file" && f.role === "service")) {
            addTask("patch_file",
                `Add query optimization in ${path.basename(tf.filePath)}`,
                `In ${tf.filePath}: add a timing log around the DB query. Check for missing WHERE clause indexes. Add a SELECT field whitelist instead of SELECT *.`,
                { targetFile: tf.filePath, dependsOn: [seq - 1], estimatedMins: 20 }
            );
        }
    }

    if (cause === "unknown") {
        addTask("run_command",
            "Capture detailed stack trace",
            "Temporarily increase log verbosity: set LOG_LEVEL=debug in .env and restart.",
            { command: "pm2 restart jarvis --update-env", dependsOn: [1], approvalRequired: true, estimatedMins: 5 }
        );
        addTask("investigate",
            "Re-run incident detection with debug logging active",
            "Wait 5 minutes, then POST /incidents/detect to see if new patterns emerge.",
            { approvalRequired: false, dependsOn: [seq - 1], estimatedMins: 10 }
        );
    }

    // ── Final tasks: redeploy + verify (for causes that need it) ──
    const redeployRequired = ["deploy_regression", "database_error", "code_error", "config_error"].includes(cause);
    if (redeployRequired && pipelineName) {
        const pip = _pipeline();
        const pipDef = pip?.PIPELINES?.[pipelineName] || { name: pipelineName, label: pipelineName, requiresApproval: true };
        addTask("redeploy",
            `Run ${pipDef.label || pipelineName} pipeline`,
            `Execute the ${pipelineName} deployment pipeline to push the fix to production.`,
            { pipeline: pipelineName, dependsOn: [seq - 1], approvalRequired: true, estimatedMins: 15 }
        );
    }

    // Always end with verify
    const verifyDep = tasks.length > 0 ? [tasks[tasks.length - 1].seq] : [1];
    addTask("verify",
        "Verify system health",
        "GET /health — confirm status:ok. GET /incidents — confirm incident resolved or auto-resolved.",
        { approvalRequired: false, dependsOn: verifyDep, estimatedMins: 5 }
    );

    return tasks;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4 — Pipeline selection
// Pick the safest deployment pipeline for the cause category
// ═══════════════════════════════════════════════════════════════════

const PIPELINE_FOR_CAUSE = {
    deploy_regression:   "safe-update",    // git revert then safe-update
    database_error:      "standard-deploy",// full pipeline with health-check after migration
    code_error:          "safe-update",    // minimal redeploy
    config_error:        "safe-update",    // env change + restart
    external_dependency: null,             // no redeploy needed — code change then safe-update
    capacity_error:      "safe-update",
    unknown:             null,
};

function _selectPipeline(causeCategory) {
    const name = PIPELINE_FOR_CAUSE[causeCategory] || null;
    if (!name) return null;
    const pip = _pipeline();
    const def = pip?.PIPELINES?.[name];
    if (!def) return { name, label: name, requiresApproval: true };
    return { name: def.name, label: def.label, requiresApproval: def.requiresApproval };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5 — Confidence scoring
// Inherit RCA confidence, adjust for actionability
// ═══════════════════════════════════════════════════════════════════

function _scoreConfidence(rcaReport, targetFiles, tasks) {
    let score = rcaReport.confidence || 30;

    // More target files = more specific plan = higher actionability
    if (targetFiles.length >= 3) score += 5;
    if (targetFiles.length === 0) score -= 10;

    // If we have a deploy correlation with a gitHead, the plan is highly actionable
    if (rcaReport.deployCorrelation?.correlated && rcaReport.deployCorrelation?.gitHead) score += 5;

    // More tasks = more complete plan (up to a point)
    if (tasks.length >= 4) score += 5;

    // No affected routes found reduces actionability
    if ((rcaReport.affectedRoutes?.length || 0) === 0) score -= 5;

    return Math.min(Math.max(score, 10), 98);
}

// ═══════════════════════════════════════════════════════════════════
// STEP 6 — Risk assessment
// ═══════════════════════════════════════════════════════════════════

const SEVERITY_RISK = { CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", INFO: "LOW" };
const CAUSE_RISK    = {
    deploy_regression:   "HIGH",
    database_error:      "HIGH",
    external_dependency: "MEDIUM",
    code_error:          "MEDIUM",
    capacity_error:      "LOW",
    config_error:        "LOW",
    unknown:             "MEDIUM",
};

function _riskLevel(causeCategory, severity) {
    const causeLvl    = CAUSE_RISK[causeCategory]   || "MEDIUM";
    const severityLvl = SEVERITY_RISK[severity]     || "MEDIUM";
    const rank        = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    // Take the higher of the two
    const level = rank[causeLvl] >= rank[severityLvl] ? causeLvl : severityLvl;
    const factors = [];
    if (causeCategory === "database_error")    factors.push("DB schema changes may require downtime");
    if (causeCategory === "deploy_regression") factors.push("Revert may require re-testing all affected features");
    if (causeCategory === "code_error")        factors.push("Handler patch may affect other callers of the same service");
    if (severity === "CRITICAL")               factors.push("CRITICAL severity — customer impact likely");
    if (severity === "HIGH")                   factors.push("HIGH severity — service degraded for all users");
    return { level, factors };
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a fix plan for a stored RCA report.
 * @param {string} rcaId
 * @param {object} opts
 * @returns {FixPlan|null}
 */
function plan(rcaId, opts = {}) {
    const rca        = _rca();
    const rcaReport  = rca.getReport(rcaId);
    if (!rcaReport) return null;
    return planInline(rcaReport, opts);
}

/**
 * Generate a fix plan from an RCA report object directly.
 * @param {object} rcaReport   — RcaReport from rootCauseAnalyzer
 * @param {object} [opts]
 * @param {boolean} [opts.registerPatches=false]  — call patchAssistant.proposePatch for patch_file tasks
 * @returns {FixPlan}
 */
function planInline(rcaReport, { registerPatches = false } = {}) {
    const causeCategory = rcaReport.cause?.category || "unknown";
    const severity      = rcaReport.incident?.severity || "MEDIUM";

    // ── Pipeline ──────────────────────────────────────────────────
    const strategy      = _mapStrategy(causeCategory);
    const pipelineDef   = _selectPipeline(causeCategory);
    const targetFiles   = _targetFiles(rcaReport, causeCategory);
    const tasks         = _buildTaskGraph(strategy, targetFiles, rcaReport, pipelineDef?.name || null);
    const confidence    = _scoreConfidence(rcaReport, targetFiles, tasks);
    const risk          = _riskLevel(causeCategory, severity);

    // ── Optional: register patch proposals for patch_file tasks ──
    if (registerPatches) {
        const pa = _patch();
        if (pa) {
            for (const task of tasks.filter(t => t.type === "patch_file" && t.targetFile)) {
                try {
                    const result = pa.proposePatch({
                        filePath:       task.targetFile,
                        patchedContent: `// FIX NEEDED: ${task.detail}\n// planId: (pending) — replace this placeholder with the actual fix\n`,
                        reason:         `[AutoFixPlanner] ${task.title} — incidentId: ${rcaReport.incidentId}`,
                    });
                    if (result.ok) task.patchId = result.patchId;
                } catch { /* non-fatal */ }
            }
        }
    }

    const fixPlan = {
        planId:           _newId(),
        rcaId:            rcaReport.rcaId,
        incidentId:       rcaReport.incidentId,
        createdAt:        new Date().toISOString(),
        strategy: {
            category:         causeCategory,
            approach:         strategy.approach,
            rationale:        strategy.rationale,
        },
        risk,
        confidence,
        targetFiles,
        tasks,
        pipeline:         pipelineDef,
        suggestedChanges: strategy.suggestedChanges,
        status:           "draft",
    };

    _persistPlan(fixPlan);
    console.log(`[AutoFixPlanner] ${fixPlan.planId} — rca=${rcaReport.rcaId} cause=${causeCategory} risk=${risk.level} confidence=${confidence} tasks=${tasks.length}`);
    return fixPlan;
}

/**
 * Retrieve a single fix plan by ID.
 * @param {string} planId
 */
function getPlan(planId) {
    return _loadPlans().find(p => p.planId === planId) || null;
}

/**
 * List fix plans with optional filters.
 * @param {object} opts
 * @param {string}  [opts.rcaId]
 * @param {string}  [opts.incidentId]
 * @param {string}  [opts.status]
 * @param {number}  [opts.limit=20]
 */
function listPlans({ rcaId, incidentId, status, limit = 20 } = {}) {
    let plans = _loadPlans();
    if (rcaId)      plans = plans.filter(p => p.rcaId === rcaId);
    if (incidentId) plans = plans.filter(p => p.incidentId === incidentId);
    if (status)     plans = plans.filter(p => p.status === status);
    return plans.slice(0, limit);
}

/**
 * Update a plan's status (draft → approved → executing → done | abandoned).
 * @param {string} planId
 * @param {string} newStatus
 */
function updateStatus(planId, newStatus) {
    const all = _loadPlans();
    const p   = all.find(pl => pl.planId === planId);
    if (!p) return { ok: false, error: "plan_not_found" };
    const valid = ["draft", "approved", "executing", "done", "abandoned"];
    if (!valid.includes(newStatus)) return { ok: false, error: `invalid status: ${newStatus}` };
    p.status    = newStatus;
    p.updatedAt = new Date().toISOString();
    _savePlans(all);
    return { ok: true, plan: p };
}

module.exports = { plan, planInline, getPlan, listPlans, updateStatus };
