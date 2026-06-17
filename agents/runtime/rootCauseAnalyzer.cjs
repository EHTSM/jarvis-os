"use strict";
/**
 * Root Cause Analyzer — converts an incident record into a probable root cause report.
 *
 * Entry points:
 *   analyze(incidentId, opts)   — run full RCA for a single incident → RcaReport
 *   analyzeInline(incident, opts) — same but accepts an incident object directly
 *   listReports(opts)           — list stored RCA reports
 *   getReport(rcaId)            — retrieve one RCA report
 *
 * Reuses:
 *   - incidentEngine.getIncident()      (incident record + evidence)
 *   - telemetryEngine.getHistory()      (raw events for temporal analysis)
 *   - telemetryEngine.getDeployHistory() (deploy correlation)
 *   - data/api-manifests.json           (route → file mapping)
 *   - data/db-manifests.json            (table → FK dependency graph)
 *   - data/product-manifests.json       (product → feature → component mapping)
 *   - data/page-manifests.json          (page → route → API binding)
 *
 * No new architecture. No AI calls. No agent army.
 *
 * RCA pipeline (for each incident):
 *   1. causeMapping   — map ruleId + evidence → probable cause category
 *   2. deployCorrelation — check if a recent deploy preceded the incident
 *   3. routeAnalysis  — which routes are affected, error breakdown per route
 *   4. fileAnalysis   — which source files are implicated via manifests
 *   5. componentAnalysis — which features/tables/services are affected
 *   6. confidenceScoring — compute 0–100 confidence from signal strength
 *   7. reportGeneration  — assemble RcaReport and persist to data/rca-reports.json
 *
 * Cause categories:
 *   deploy_regression   — a recent deploy introduced the failure
 *   database_error      — errorCode pattern indicates DB layer (DB_*, SQL_*, MIGRATION_*)
 *   external_dependency — errorCode pattern indicates third-party (GATEWAY_*, TIMEOUT, 5xx on /api/pay* etc.)
 *   config_error        — missing env / misconfigured service
 *   code_error          — unhandled exception / crash / 500 without DB/ext pattern
 *   capacity_error      — memory / rate limit / OOM signals
 *   unknown             — insufficient signal
 *
 * Confidence scoring:
 *   Base confidence per cause category (from ruleId match)        +30–60
 *   Deploy correlation within 10 min of incident open             +20
 *   Route 100% failure rate                                       +10
 *   errorCode pattern matches cause category                      +10
 *   Affected file found in manifests                              +5
 *   Evidence depth (≥3 evidence items)                            +5
 *   Total capped at 98 (never claim 100% certainty)
 *
 * RcaReport shape:
 *   {
 *     rcaId, incidentId, analyzedAt,
 *     cause: { category, summary, detail },
 *     confidence,                  // 0–100
 *     deployCorrelation: { correlated, deployId, gitHead, deltaMinutes, deployOk },
 *     affectedRoutes: [{ method, path, errorCount, errorRate, topErrorCodes[] }],
 *     affectedFiles:  [{ filePath, role, feature }],
 *     affectedComponents: [{ type, name, detail }],
 *     recommendations: string[],
 *   }
 *
 * Storage: data/rca-reports.json  (max 200, newest-first, atomic write)
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const DATA_DIR    = path.join(__dirname, "../../data");
const RCA_PATH    = path.join(DATA_DIR, "rca-reports.json");
const MAX_REPORTS = 200;

// Lazy getters to avoid circular require at module init
function _tel() { return require("./telemetryEngine.cjs"); }
function _inc() { return require("./incidentEngine.cjs"); }

// ── Manifest loaders (fail-safe) ──────────────────────────────────

function _loadJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const d   = JSON.parse(raw);
        return Array.isArray(d) ? d : (d && typeof d === "object" ? d : null);
    } catch { return null; }
}

function _apiManifests()     { return _loadJson(path.join(DATA_DIR, "api-manifests.json"))     || []; }
function _dbManifests()      { return _loadJson(path.join(DATA_DIR, "db-manifests.json"))      || []; }
function _productManifests() { return _loadJson(path.join(DATA_DIR, "product-manifests.json")) || []; }
function _pageManifests()    { return _loadJson(path.join(DATA_DIR, "page-manifests.json"))    || []; }

// ── Storage ───────────────────────────────────────────────────────

function _loadReports() {
    try {
        const raw    = fs.readFileSync(RCA_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _saveReports(reports) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = RCA_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(reports.slice(0, MAX_REPORTS), null, 2));
    fs.renameSync(tmp, RCA_PATH);
}

function _persistReport(report) {
    const all = _loadReports();
    const idx = all.findIndex(r => r.rcaId === report.rcaId);
    if (idx !== -1) all[idx] = report;
    else all.unshift(report);
    _saveReports(all);
}

// ── ID generation ─────────────────────────────────────────────────
let _idCounter = Date.now();
function _newId() { return `rca_${++_idCounter}`; }

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — Cause mapping
// Maps ruleId + errorCode patterns → { category, summary, detail, baseConfidence }
// ═══════════════════════════════════════════════════════════════════

// ErrorCode → cause category patterns (checked in order, first match wins)
const ERROR_CODE_PATTERNS = [
    { pattern: /^DB_|^SQL_|^MIGRATION_|^POOL_|^CONNECTION_REFUSED/i, category: "database_error" },
    { pattern: /^GATEWAY_|^UPSTREAM_|^STRIPE_|^RAZORPAY_|^EXTERNAL_|^THIRD_PARTY_/i, category: "external_dependency" },
    { pattern: /^OOM|^MEMORY_|^RATE_LIMIT|^CAPACITY_/i, category: "capacity_error" },
    { pattern: /^CONFIG_|^ENV_|^MISSING_KEY|^INVALID_CONFIG/i, category: "config_error" },
    { pattern: /^TIMEOUT$/i, category: "external_dependency" },  // generic timeout → external
];

// 5xx path patterns that suggest external dependency
const EXTERNAL_PATH_PATTERNS = [/\/pay/i, /\/stripe/i, /\/razorpay/i, /\/webhook/i, /\/telegram/i, /\/whatsapp/i];

function _classifyErrorCode(errorCode, path) {
    if (!errorCode && !path) return null;
    if (errorCode) {
        for (const { pattern, category } of ERROR_CODE_PATTERNS) {
            if (pattern.test(errorCode)) return category;
        }
    }
    if (path) {
        for (const p of EXTERNAL_PATH_PATTERNS) {
            if (p.test(path)) return "external_dependency";
        }
    }
    return null;
}

// Rule ID → primary cause category + base confidence + messaging
const RULE_CAUSE_MAP = {
    deploy_failed: {
        category: "deploy_regression",
        baseConfidence: 55,
        summary: "Deploy failure — new code or config introduced a regression",
        detail:  "The deployment process failed, which directly caused service degradation. Check the deploy error, health check output, and any code changes in the last commit.",
    },
    deploy_rollback: {
        category: "deploy_regression",
        baseConfidence: 60,
        summary: "Deploy rolled back — health check failed after new code deployed",
        detail:  "The system automatically rolled back after the new deploy failed its health check. The previous version is running. Investigate what changed between the rolled-back commit and the prior stable version.",
    },
    api_error_spike: {
        category: "code_error",     // refined by errorCode later
        baseConfidence: 45,
        summary: "API error rate spiked above 25% — systemic failure in one or more handlers",
        detail:  "More than 25% of API requests are failing. This indicates a widespread issue rather than a single endpoint problem. Could be a bad deploy, database connectivity issue, or external service outage.",
    },
    api_error_elevated: {
        category: "code_error",
        baseConfidence: 35,
        summary: "API error rate elevated (10–25%) — degraded but not critical",
        detail:  "A subset of API calls are failing above the warning threshold. Likely a specific endpoint or feature area under stress.",
    },
    api_repeated_error: {
        category: "code_error",
        baseConfidence: 40,
        summary: "Repeated error on a specific route — likely a logic bug or missing dependency",
        detail:  "The same error is occurring repeatedly on the same route. This is most likely a code regression, a missing database table, or a broken external integration for that specific endpoint.",
    },
    health_critical: {
        category: "deploy_regression",  // refined — health_critical often follows a bad deploy
        baseConfidence: 40,
        summary: "Product health is CRITICAL — multiple failure signals active simultaneously",
        detail:  "Overall product health has reached CRITICAL status. This is usually a symptom of an underlying cause (failed deploy, database down, external dependency outage) rather than a root cause itself.",
    },
    health_degraded: {
        category: "code_error",
        baseConfidence: 25,
        summary: "Product health degraded — performance or reliability is below acceptable threshold",
        detail:  "Overall health has dropped below healthy levels. Could be gradual memory leak, slow query, or intermittent external service failures.",
    },
    route_failure: {
        category: "code_error",
        baseConfidence: 50,
        summary: "Route 100% failing — a specific endpoint is completely broken",
        detail:  "Every request to this route is failing. Likely cause: unhandled exception in the handler, missing database table, broken middleware, or a dependency that the route exclusively relies on.",
    },
    slow_api: {
        category: "capacity_error",
        baseConfidence: 30,
        summary: "API latency high — p95 exceeds 5000ms",
        detail:  "API responses are taking too long. Likely causes: slow database queries, N+1 query patterns, external service latency, or insufficient server resources.",
    },
    deploy_slow: {
        category: "capacity_error",
        baseConfidence: 20,
        summary: "Deploy duration exceeding 30s — infrastructure or build pipeline degradation",
        detail:  "Deploys are taking longer than expected. Could indicate disk I/O issues, slow npm install, or health check waiting too long for the process to start.",
    },
};

function _mapCause(incident, errorEvents) {
    const base = RULE_CAUSE_MAP[incident.ruleId] || {
        category: "unknown",
        baseConfidence: 10,
        summary: "Insufficient signal to determine probable cause",
        detail:  "No matching rule pattern found. Review raw telemetry events manually.",
    };

    // Try to refine category from evidence errorCodes
    let refinedCategory = base.category;
    if (errorEvents.length > 0) {
        const codes = errorEvents.map(e => e.errorCode).filter(Boolean);
        const paths = errorEvents.map(e => e.path).filter(Boolean);
        // Count categories from all error codes
        const catCounts = {};
        for (const code of codes) {
            const cat = _classifyErrorCode(code, null);
            if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
        }
        // Also check paths if no code match
        if (Object.keys(catCounts).length === 0) {
            for (const p of paths) {
                const cat = _classifyErrorCode(null, p);
                if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
            }
        }
        // Pick highest-count category to refine
        const topCat = Object.entries(catCounts).sort(([,a],[,b]) => b - a)[0]?.[0];
        if (topCat) refinedCategory = topCat;
    }

    return { ...base, category: refinedCategory };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 2 — Deploy correlation
// Was there a deploy within 10 minutes BEFORE the incident opened?
// ═══════════════════════════════════════════════════════════════════

const DEPLOY_CORRELATION_WINDOW_MS = 10 * 60_000;

function _deployCorrelation(incident, deployEvents) {
    const incidentOpenedMs = new Date(incident.openedAt).getTime();
    const windowStart      = incidentOpenedMs - DEPLOY_CORRELATION_WINDOW_MS;

    // Find the most recent deploy (any phase) before the incident opened.
    // Prefer completed-ok deploys (the last "good" state before things broke),
    // then fall back to failed/rolled-back (the deploy that may have caused it).
    const inWindow = deployEvents
        .filter(e =>
            e.type === "deploy" &&
            new Date(e.ts).getTime() <= incidentOpenedMs &&
            new Date(e.ts).getTime() >= windowStart
        )
        .sort((a, b) => new Date(b.ts) - new Date(a.ts)); // newest first

    // Prefer: last completed-ok deploy (most informative gitHead)
    // Fallback: last failed deploy in window
    const prior = inWindow.filter(e => e.phase === "completed")
        .concat(inWindow.filter(e => e.phase === "failed" || e.phase === "rolled-back"));

    if (prior.length === 0) {
        return { correlated: false, deployId: null, gitHead: null, deltaMinutes: null, deployOk: null };
    }

    const deploy     = prior[0];
    const deltaMs    = incidentOpenedMs - new Date(deploy.ts).getTime();
    const deltaMin   = Math.round(deltaMs / 60_000 * 10) / 10;

    return {
        correlated:    true,
        deployId:      deploy.id,
        gitHead:       deploy.gitHead || null,
        deltaMinutes:  deltaMin,
        deployOk:      deploy.ok,
        phase:         deploy.phase,
        productName:   deploy.productName || null,
    };
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3 — Route analysis
// Which routes show errors? What are the error rates and top codes?
// ═══════════════════════════════════════════════════════════════════

function _routeAnalysis(incident, allEvents, blueprintId) {
    const apiReqEvents = allEvents.filter(e =>
        (e.type === "api_request" || e.type === "api_error") &&
        e.path &&
        (!blueprintId || e.blueprintId === blueprintId)
    );

    // Group by path
    const byPath = {};
    for (const e of apiReqEvents) {
        if (!byPath[e.path]) byPath[e.path] = { total: 0, errors: 0, errorCodes: {} };
        byPath[e.path].total++;
        const isError = e.type === "api_error" || (e.statusCode && e.statusCode >= 400);
        if (isError) {
            byPath[e.path].errors++;
            if (e.errorCode) {
                byPath[e.path].errorCodes[e.errorCode] = (byPath[e.path].errorCodes[e.errorCode] || 0) + 1;
            }
        }
    }

    // Affected routes: any route with ≥1 error, sorted by error rate desc
    const routes = Object.entries(byPath)
        .filter(([, s]) => s.errors > 0)
        .map(([p, s]) => ({
            path:         p,
            total:        s.total,
            errorCount:   s.errors,
            errorRate:    s.total > 0 ? Math.round(s.errors / s.total * 100) : 100,
            topErrorCodes: Object.entries(s.errorCodes)
                .sort(([,a],[,b]) => b - a)
                .slice(0, 3)
                .map(([code, count]) => ({ code, count })),
        }))
        .sort((a, b) => b.errorRate - a.errorRate || b.errorCount - a.errorCount);

    // If the incident has a specific affectedResource that looks like a path, prioritize it
    if (incident.affectedResource && incident.affectedResource.startsWith("/")) {
        const idx = routes.findIndex(r => r.path === incident.affectedResource);
        if (idx > 0) {
            const [primary] = routes.splice(idx, 1);
            routes.unshift(primary);
        }
    }

    return routes.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════
// STEP 4 — File analysis
// Cross-reference affected routes with api-manifests.json to find source files
// ═══════════════════════════════════════════════════════════════════

function _fileAnalysis(affectedRoutes, blueprintId) {
    const manifests = _apiManifests();
    if (!manifests.length) return [];

    const affectedPaths = new Set(affectedRoutes.map(r => r.path));
    const files         = [];
    const seen          = new Set();

    for (const manifest of manifests) {
        // blueprintId filter (loose — manifests may or may not carry it)
        if (blueprintId && manifest.blueprintId && manifest.blueprintId !== blueprintId) continue;

        const mPath = manifest.apiPath;
        if (!mPath) continue;

        // Match exact path or prefix match (e.g. /api/plans matches /api/plans/:id)
        const matched = [...affectedPaths].some(ap =>
            mPath === ap ||
            ap.startsWith(mPath.replace(/\/:.*$/, "")) ||
            mPath.startsWith(ap.replace(/\/:.*$/, ""))
        );
        if (!matched) continue;

        const fp = manifest.filePaths;
        if (!fp) continue;

        const add = (filePath, role, feature) => {
            if (!filePath || seen.has(filePath)) return;
            seen.add(filePath);
            files.push({ filePath, role, feature: feature || manifest.productName || null });
        };

        add(fp.routeFile,      "route",      fp.featureName);
        add(fp.serviceFile,    "service",    fp.featureName);
        add(fp.validatorFile,  "validator",  fp.featureName);
        add(fp.errorFile,      "middleware", fp.featureName);
        // Add migration files when database_error likely
        if (Array.isArray(fp.migrations)) {
            fp.migrations.forEach(m => add(m, "migration", fp.featureName));
        }
    }

    return files;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 5 — Component analysis
// Which features, tables, and services are implicated?
// ═══════════════════════════════════════════════════════════════════

function _componentAnalysis(incident, affectedRoutes, affectedFiles, blueprintId) {
    const components = [];
    const seen       = new Set();

    function add(type, name, detail) {
        const key = `${type}:${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        components.push({ type, name, detail });
    }

    // From API manifests — feature-level components
    const manifests = _apiManifests();
    for (const m of manifests) {
        if (blueprintId && m.blueprintId && m.blueprintId !== blueprintId) continue;
        const mPath = m.apiPath;
        if (!mPath) continue;
        const isAffected = affectedRoutes.some(r =>
            r.path === mPath ||
            r.path.startsWith(mPath.replace(/\/:.*$/, "")) ||
            mPath.startsWith(r.path.replace(/\/:.*$/, ""))
        );
        if (!isAffected) continue;

        const fp = m.filePaths;
        if (fp?.featureName) add("feature", fp.featureName, `${m.apiMethod} ${m.apiPath}`);
        if (fp?.feature?.name) add("feature", fp.feature.name, m.apiPath);

        // Tables from this feature's manifests
        if (Array.isArray(fp?.tables)) {
            fp.tables.forEach(t => add("table", t.name, `accessed by ${m.apiPath}`));
        }
    }

    // From DB manifests — if a DB error code is present, add relevant tables
    const errorEvents  = [];  // passed via closure from analyze()
    const dbManifests  = _dbManifests();
    const hasDbError   = incident.evidence?.some?.(ev =>
        (ev.key && /DB_|SQL_|MIGRATION_/i.test(ev.key)) ||
        (ev.code && /DB_|SQL_|MIGRATION_/i.test(ev.code))
    );
    if (hasDbError && Array.isArray(dbManifests)) {
        for (const dbM of dbManifests) {
            if (blueprintId && dbM.blueprintId && dbM.blueprintId !== blueprintId) continue;
            if (Array.isArray(dbM.tables)) {
                dbM.tables.forEach(t => add("table", t.name, `${t.columns?.join(", ") || ""}`));
            }
        }
    }

    // From product manifests — product-level service
    const productManifests = _productManifests();
    for (const pm of productManifests) {
        if (blueprintId && pm.blueprintId && pm.blueprintId !== blueprintId) continue;
        add("product", pm.productName || pm.blueprintId, `status: ${pm.status || "unknown"}`);
    }

    // Deploy component if deploy-correlated
    if (incident.ruleId === "deploy_failed" || incident.ruleId === "deploy_rollback") {
        add("service", "deploy-pipeline", "The deploy pipeline itself failed");
    }

    return components;
}

// ═══════════════════════════════════════════════════════════════════
// STEP 6 — Confidence scoring
// ═══════════════════════════════════════════════════════════════════

function _scoreConfidence({ cause, deployCorr, affectedRoutes, affectedFiles, incident, errorEvents }) {
    let score = cause.baseConfidence;

    // Deploy correlation within 10 min → strong signal
    if (deployCorr.correlated) score += 20;
    // Failed deploy specifically → extra signal
    if (deployCorr.correlated && !deployCorr.deployOk) score += 5;

    // Route fully failed → confirms the route-level cause
    const fullFail = affectedRoutes.find(r => r.errorRate >= 100 && r.total >= 2);
    if (fullFail) score += 10;

    // errorCode pattern matches the inferred cause category
    const codeMatch = errorEvents.some(e => {
        const cat = _classifyErrorCode(e.errorCode, e.path);
        return cat && cat === cause.category;
    });
    if (codeMatch) score += 10;

    // Found source files from manifests → analysis is grounded
    if (affectedFiles.length > 0) score += 5;

    // Deep evidence (≥3 evidence items)
    if ((incident.evidence?.length || 0) >= 3) score += 5;

    // Multiple occurrences (incident was seen repeatedly)
    if ((incident.occurrences || 1) >= 3) score += 5;

    // High error count strengthens confidence
    const totalErrors = affectedRoutes.reduce((s, r) => s + r.errorCount, 0);
    if (totalErrors >= 10) score += 5;

    // Cap at 98 — never claim certainty
    return Math.min(score, 98);
}

// ═══════════════════════════════════════════════════════════════════
// STEP 7 — Recommendations
// Rule-based action items based on cause category + signals
// ═══════════════════════════════════════════════════════════════════

function _recommendations({ cause, deployCorr, affectedRoutes, affectedFiles, incident }) {
    const recs = [];

    if (cause.category === "deploy_regression") {
        if (deployCorr.correlated && deployCorr.gitHead) {
            recs.push(`Review changes in commit ${deployCorr.gitHead} — deployed ${deployCorr.deltaMinutes}m before this incident opened.`);
        }
        recs.push("Run: git diff <prev-tag> HEAD to identify changed files.");
        if (!deployCorr.deployOk) {
            recs.push("Deploy failed — check deploy logs and health check endpoint output.");
        } else {
            recs.push("Deploy succeeded but may have introduced a runtime regression — check application logs for exceptions.");
        }
    }

    if (cause.category === "database_error") {
        recs.push("Check database connectivity: pg_isready / mysql ping.");
        recs.push("Review migration status — a pending or failed migration may have left tables in inconsistent state.");
        recs.push("Check connection pool exhaustion: look for 'too many connections' or 'pool timeout' in logs.");
        const dbFiles = affectedFiles.filter(f => f.role === "migration");
        if (dbFiles.length) recs.push(`Review migration files: ${dbFiles.map(f => f.filePath).join(", ")}`);
    }

    if (cause.category === "external_dependency") {
        recs.push("Check external service status pages (Stripe, Razorpay, WhatsApp API, etc.).");
        recs.push("Review retry and circuit-breaker logic on affected routes.");
        recs.push("If timeout, consider increasing client timeout or adding fallback response.");
    }

    if (cause.category === "code_error") {
        const routeFiles = affectedFiles.filter(f => f.role === "route" || f.role === "service");
        if (routeFiles.length) {
            recs.push(`Check server logs for exceptions in: ${routeFiles.map(f => f.filePath).join(", ")}`);
        }
        const topRoutes = affectedRoutes.filter(r => r.errorRate === 100);
        if (topRoutes.length) {
            recs.push(`Route(s) fully failed (100% error rate): ${topRoutes.map(r => r.path).join(", ")} — likely a handler exception or missing dependency.`);
        }
        recs.push("Search logs for 'Error:' and 'Unhandled' around the incident open time.");
    }

    if (cause.category === "capacity_error") {
        recs.push("Check process memory: GET /ops for heap usage report.");
        recs.push("Review for N+1 queries or missing database indexes on high-traffic routes.");
        recs.push("Consider horizontal scaling or caching for endpoints with p95 > 5000ms.");
    }

    if (cause.category === "config_error") {
        recs.push("Verify all required environment variables are set (JWT_SECRET, GROQ_API_KEY, etc.).");
        recs.push("Check service capability flags in GET /health — missing env vars disable services.");
    }

    if (recs.length === 0) {
        recs.push("Insufficient signal — review raw telemetry events and application logs.");
    }

    return recs;
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Run full RCA for a given incident ID.
 *
 * @param {string} incidentId
 * @param {object} opts
 * @param {number} [opts.windowMins=60]   — telemetry lookback window
 * @returns {RcaReport|null}
 */
function analyze(incidentId, { windowMins = 60 } = {}) {
    const inc = _inc();
    const incident = inc.getIncident(incidentId);
    if (!incident) return null;
    return analyzeInline(incident, { windowMins });
}

/**
 * Run full RCA for an incident object directly (no store lookup needed).
 *
 * @param {object} incident   — incident record from incidentEngine
 * @param {object} opts
 * @param {number} [opts.windowMins=60]
 * @returns {RcaReport}
 */
function analyzeInline(incident, { windowMins = 60 } = {}) {
    const tel      = _tel();
    const now      = new Date();

    // ── Load telemetry data ───────────────────────────────────────
    const allEvents    = tel.getHistory({ windowMins, blueprintId: incident.blueprintId });
    const deployEvents = tel.getDeployHistory({ limit: 20, blueprintId: incident.blueprintId });
    const errorEvents  = allEvents.filter(e => e.type === "api_error");

    // ── Pipeline ──────────────────────────────────────────────────
    const cause         = _mapCause(incident, errorEvents);
    const deployCorr    = _deployCorrelation(incident, deployEvents);
    const affectedRoutes = _routeAnalysis(incident, allEvents, incident.blueprintId);
    const affectedFiles  = _fileAnalysis(affectedRoutes, incident.blueprintId);
    const affectedComps  = _componentAnalysis(incident, affectedRoutes, affectedFiles, incident.blueprintId);
    const confidence     = _scoreConfidence({ cause, deployCorr, affectedRoutes, affectedFiles, incident, errorEvents });
    const recommendations = _recommendations({ cause, deployCorr, affectedRoutes, affectedFiles, incident });

    const report = {
        rcaId:       _newId(),
        incidentId:  incident.incidentId,
        analyzedAt:  now.toISOString(),
        windowMins,
        incident: {
            ruleId:   incident.ruleId,
            title:    incident.title,
            severity: incident.severity,
            status:   incident.status,
            openedAt: incident.openedAt,
        },
        cause: {
            category: cause.category,
            summary:  cause.summary,
            detail:   cause.detail,
        },
        confidence,
        deployCorrelation: deployCorr,
        affectedRoutes,
        affectedFiles,
        affectedComponents: affectedComps,
        recommendations,
    };

    _persistReport(report);
    logger.info(`[RCA] ${report.rcaId} — ${incident.incidentId} — cause=${cause.category} confidence=${confidence}`);
    return report;
}

/**
 * List stored RCA reports.
 * @param {object} opts
 * @param {string} [opts.incidentId]  — filter by incident
 * @param {number} [opts.limit=20]
 */
function listReports({ incidentId, limit = 20 } = {}) {
    let reports = _loadReports();
    if (incidentId) reports = reports.filter(r => r.incidentId === incidentId);
    return reports.slice(0, limit);
}

/**
 * Retrieve one RCA report by ID.
 * @param {string} rcaId
 */
function getReport(rcaId) {
    return _loadReports().find(r => r.rcaId === rcaId) || null;
}

module.exports = {
    analyze,
    analyzeInline,
    listReports,
    getReport,
};
