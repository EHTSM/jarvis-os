"use strict";
/**
 * BackgroundRuntime — proactive observation layer for the Ooplix Autonomous
 * Engineering OS (Track D / D4 — Continuous Background Runtime).
 *
 * Runs six independent background observers that detect issues WITHOUT user
 * prompts and surface them as proactive recommendations.
 *
 * Observers:
 *   repoObserver       (5 min)  — git repository health
 *   pm2Observer        (2 min)  — PM2 process health
 *   logObserver        (1 min)  — structured log error-rate
 *   webhookObserver    (3 min)  — webhook queue depth / staleness
 *   deploymentObserver (5 min)  — stuck / unacknowledged deployments
 *   incidentObserver   (2 min)  — escalated heal records
 *
 * Public API:
 *   start()                         → { started: true, observerCount }
 *   stop()                          → void
 *   getStatus()                     → { running, observers[] }
 *   getRecommendations(opts)        → { recommendations[], total }
 *   triggerObserver(name)           → observer result
 *   clearRecommendations()          → { removed }
 */

const fs          = require("fs");
const path        = require("path");
const { execSync, exec } = require("child_process");

const logger = require("../utils/logger");

// ── Lazy-load integrations (never throw at module load) ───────────────────
function _getBus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

// ── File paths ────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, "../../data");
const RECS_FILE      = path.join(DATA_DIR, "background-recommendations.json");
const LOG_FILE       = path.join(DATA_DIR, "logs/structured.ndjson");
const WEBHOOK_FILE   = path.join(DATA_DIR, "webhook-queue.json");
const DEPLOY_FILE    = path.join(DATA_DIR, "deployments.json");
const HEAL_FILE      = path.join(DATA_DIR, "healing-history.json");

// ── Constants ─────────────────────────────────────────────────────────────
const MAX_RECOMMENDATIONS = 500;
const REC_TTL_MS          = 24 * 60 * 60 * 1000;   // 24 h

const INTERVALS = {
    repoObserver:       5 * 60 * 1000,   // 5 min
    pm2Observer:        2 * 60 * 1000,   // 2 min
    logObserver:        1 * 60 * 1000,   // 1 min
    webhookObserver:    3 * 60 * 1000,   // 3 min
    deploymentObserver: 5 * 60 * 1000,   // 5 min
    incidentObserver:   2 * 60 * 1000,   // 2 min
};

// ── Helpers ───────────────────────────────────────────────────────────────
function _rj(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

function _exec(cmd, opts = {}) {
    return execSync(cmd, { timeout: 5000, encoding: "utf8", ...opts });
}

// ── Recommendation store ──────────────────────────────────────────────────
// In-memory cache populated lazily on first access. Avoids readFileSync on
// every recommendation emit (was: one readFileSync + writeFileSync per emit,
// firing up to 6 times per observer cycle, all on the main event-loop thread).
let _recsCache   = null;  // null = not yet loaded
let _recsDirty   = false; // true = pending async write
let _recsWriting = false; // true = async write in flight
let _seq = 0;

function _rid() { return `bgrec_${Date.now()}_${(++_seq).toString(36)}`; }

function _loadRecs() {
    if (_recsCache !== null) return _recsCache;
    _recsCache = _rj(RECS_FILE, []);
    return _recsCache;
}

function _saveRecs(recs) {
    // Enforce max 500 — evict oldest when over limit
    const capped = recs.length > MAX_RECOMMENDATIONS
        ? recs.slice(recs.length - MAX_RECOMMENDATIONS)
        : recs;
    _recsCache = capped;
    _recsDirty = true;
    // Debounced async write — never blocks the event loop
    if (!_recsWriting) {
        _recsWriting = true;
        setImmediate(() => {
            const data = JSON.stringify(_recsCache, null, 2);
            const tmp  = RECS_FILE + ".tmp";
            fs.writeFile(tmp, data, "utf8", (err) => {
                _recsWriting = false;
                if (!err) {
                    fs.rename(tmp, RECS_FILE, () => { _recsDirty = false; });
                } else {
                    logger.warn(`[BackgroundRuntime] async save failed: ${err.message}`);
                }
            });
        });
    }
}

/**
 * Save one recommendation and fan-out on the event bus.
 * @param {{ source, title, description, priority, context }} opts
 */
function _emitRecommendation({ source, title, description, priority = "MEDIUM", context = {} }) {
    const rec = {
        recId:       _rid(),
        source,
        title,
        description,
        priority,        // CRITICAL | HIGH | MEDIUM | LOW
        context,
        createdAt:   new Date().toISOString(),
        acknowledged: false,
    };

    const recs = _loadRecs();
    recs.push(rec);
    _saveRecs(recs);

    try {
        const bus = _getBus();
        if (bus) bus.emit("proactive:recommendation", rec);
    } catch (e) {
        logger.warn(`[BackgroundRuntime] event bus emit failed: ${e.message}`);
    }

    logger.info(`[BackgroundRuntime] recommendation emitted: [${priority}] ${title} (source: ${source})`);
    return rec;
}

// ── Observer state ────────────────────────────────────────────────────────
const _observerState = {};   // name → { lastRunAt, lastError, runCount, handle }

function _initObserverState(name) {
    if (!_observerState[name]) {
        _observerState[name] = { lastRunAt: null, lastError: null, runCount: 0, handle: null };
    }
}

function _wrapObserver(name, fn) {
    return async () => {
        const state = _observerState[name];
        try {
            const result = await fn();
            state.lastRunAt = new Date().toISOString();
            state.runCount++;
            state.lastError = null;
            return result;
        } catch (err) {
            state.lastError = err.message;
            state.lastRunAt = new Date().toISOString();
            state.runCount++;
            logger.warn(`[BackgroundRuntime] ${name} error: ${err.message}`);
            return null;
        }
    };
}

// ── Observer: repoObserver ────────────────────────────────────────────────
/**
 * Scans git repositories under process.cwd() (max depth 3).
 * Detects: uncommitted changes, diverged branches, merge conflicts.
 */
async function _repoObserver() {
    const cwd   = process.cwd();
    const found = [];

    // Find .git directories up to depth 3
    function _findGitDirs(dir, depth) {
        if (depth > 3) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (ent.name === "node_modules" || ent.name === ".cache") continue;
            const full = path.join(dir, ent.name);
            if (ent.name === ".git") {
                found.push(path.dirname(full));
                return;   // don't recurse inside .git
            }
            _findGitDirs(full, depth + 1);
        }
    }

    // Also check cwd itself
    if (fs.existsSync(path.join(cwd, ".git"))) {
        found.push(cwd);
    }
    _findGitDirs(cwd, 1);

    const unique = [...new Set(found)];
    const issues = [];

    for (const repo of unique) {
        let logOut   = "";
        let statusOut = "";
        try { logOut    = _exec("git log --oneline -5", { cwd: repo }); } catch { /* git may not be available */ }
        try { statusOut = _exec("git status --short",   { cwd: repo }); } catch { continue; }

        const repoName = path.basename(repo);
        const lines    = statusOut.trim().split("\n").filter(Boolean);

        // Uncommitted changes
        if (lines.length > 0) {
            const conflicted = lines.filter(l => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DD"));
            if (conflicted.length > 0) {
                issues.push({ repo, type: "merge_conflict", count: conflicted.length });
                _emitRecommendation({
                    source:      "repoObserver",
                    title:       `Merge conflict in ${repoName}`,
                    description: `${conflicted.length} file(s) have merge conflicts: ${conflicted.slice(0, 3).join(", ")}`,
                    priority:    "HIGH",
                    context:     { repo, conflictedFiles: conflicted },
                });
            } else {
                issues.push({ repo, type: "uncommitted_changes", count: lines.length });
                _emitRecommendation({
                    source:      "repoObserver",
                    title:       `Uncommitted changes in ${repoName}`,
                    description: `${lines.length} file(s) have uncommitted changes. Recent log: ${logOut.split("\n")[0] || "(none)"}`,
                    priority:    "LOW",
                    context:     { repo, changedFiles: lines.slice(0, 10) },
                });
            }
        }

        // Diverged branch detection (both ahead and behind)
        try {
            const branchOut = _exec("git status -b --short", { cwd: repo });
            if (branchOut.includes("ahead") && branchOut.includes("behind")) {
                issues.push({ repo, type: "diverged_branch" });
                _emitRecommendation({
                    source:      "repoObserver",
                    title:       `Diverged branch in ${repoName}`,
                    description: `Branch has diverged from upstream (both ahead and behind). Manual rebase or merge required.`,
                    priority:    "MEDIUM",
                    context:     { repo, statusLine: branchOut.split("\n")[0] },
                });
            }
        } catch { /* non-critical */ }
    }

    return { reposScanned: unique.length, issues };
}

// ── Observer: pm2Observer ─────────────────────────────────────────────────
/**
 * Checks PM2 process health.
 * Detects: status !== "online", restart_count > 10, memory > 512 MB.
 */
async function _pm2Observer() {
    let procs;
    try {
        // Use async exec to avoid blocking the event loop (pm2 jlist can take 200-800ms)
        const raw = await new Promise((resolve, reject) => {
            exec("pm2 jlist", { timeout: 5000, encoding: "utf8" }, (err, stdout) => {
                if (err) reject(err); else resolve(stdout);
            });
        });
        procs = JSON.parse(raw);
    } catch {
        // PM2 not installed or not running — silently skip
        return { pm2Available: false };
    }

    if (!Array.isArray(procs)) return { pm2Available: true, checked: 0 };

    const issues = [];

    for (const proc of procs) {
        const name         = proc.name || proc.pm_id;
        const status       = proc.pm2_env?.status;
        const restarts     = proc.pm2_env?.restart_time ?? 0;
        const memBytes     = proc.monit?.memory ?? 0;
        const memMB        = memBytes / (1024 * 1024);

        if (status !== "online") {
            issues.push({ name, issue: "status_not_online", status });
            _emitRecommendation({
                source:      "pm2Observer",
                title:       `PM2 process "${name}" is ${status}`,
                description: `Process "${name}" (pid: ${proc.pid}) has status "${status}". Expected "online". Check logs with: pm2 logs ${name}`,
                priority:    status === "errored" ? "HIGH" : "MEDIUM",
                context:     { name, status, pid: proc.pid, restarts },
            });
        }

        if (restarts > 10) {
            issues.push({ name, issue: "high_restart_count", restarts });
            _emitRecommendation({
                source:      "pm2Observer",
                title:       `PM2 process "${name}" has restarted ${restarts} times`,
                description: `High restart count suggests a recurring crash loop. Inspect logs: pm2 logs ${name} --err`,
                priority:    restarts > 50 ? "HIGH" : "MEDIUM",
                context:     { name, restarts, status },
            });
        }

        if (memMB > 512) {
            issues.push({ name, issue: "high_memory", memMB: memMB.toFixed(1) });
            _emitRecommendation({
                source:      "pm2Observer",
                title:       `PM2 process "${name}" using ${memMB.toFixed(0)}MB RAM`,
                description: `Memory exceeds 512MB threshold (${memMB.toFixed(1)}MB). Consider restarting or investigating for leaks.`,
                priority:    memMB > 1024 ? "HIGH" : "MEDIUM",
                context:     { name, memMB: memMB.toFixed(1), status, restarts },
            });
        }
    }

    return { pm2Available: true, checked: procs.length, issues };
}

// ── Observer: logObserver ─────────────────────────────────────────────────
/**
 * Reads data/logs/structured.ndjson (last 200 lines).
 * Counts error-level entries in last 5 minutes and generates recommendations
 * if the rate exceeds thresholds.
 */
async function _logObserver() {
    if (!fs.existsSync(LOG_FILE)) return { logFileExists: false };

    let raw = "";
    try { raw = fs.readFileSync(LOG_FILE, "utf8"); } catch { return { logFileExists: true, readable: false }; }

    const lines   = raw.split("\n").filter(Boolean);
    const last200 = lines.slice(-200);
    const cutoff  = Date.now() - 5 * 60 * 1000;   // 5 min ago

    let errorCount = 0;
    for (const line of last200) {
        try {
            const entry = JSON.parse(line);
            const ts    = new Date(entry.ts || entry.timestamp || entry.time || 0).getTime();
            if (ts >= cutoff && (entry.level === "error" || entry.level === "ERROR" || entry.severity === "error")) {
                errorCount++;
            }
        } catch { /* malformed line — skip */ }
    }

    const ratePerMin = errorCount / 5;

    if (ratePerMin > 5) {
        _emitRecommendation({
            source:      "logObserver",
            title:       `High error rate: ${errorCount} errors in last 5 minutes`,
            description: `Error rate of ${ratePerMin.toFixed(1)}/min exceeds HIGH threshold (5/min). Immediate investigation recommended.`,
            priority:    "HIGH",
            context:     { errorCount, ratePerMin: ratePerMin.toFixed(2), windowMin: 5 },
        });
    } else if (ratePerMin >= 1) {
        _emitRecommendation({
            source:      "logObserver",
            title:       `Elevated error rate: ${errorCount} errors in last 5 minutes`,
            description: `Error rate of ${ratePerMin.toFixed(1)}/min is above baseline. Monitor closely.`,
            priority:    "MEDIUM",
            context:     { errorCount, ratePerMin: ratePerMin.toFixed(2), windowMin: 5 },
        });
    }

    return { errorCount, ratePerMin: ratePerMin.toFixed(2), linesScanned: last200.length };
}

// ── Observer: webhookObserver ─────────────────────────────────────────────
/**
 * Checks webhook queue depth and staleness.
 * Detects: depth > 50, webhooks older than 1 hour.
 */
async function _webhookObserver() {
    if (!fs.existsSync(WEBHOOK_FILE)) return { queueExists: false };

    let queue;
    try { queue = _rj(WEBHOOK_FILE, []); } catch { return { queueExists: true, readable: false }; }
    if (!Array.isArray(queue)) return { queueExists: true, invalid: true };

    const depth    = queue.length;
    const cutoff1h = Date.now() - 60 * 60 * 1000;

    const stale = queue.filter(wh => {
        const ts = new Date(wh.createdAt || wh.ts || wh.timestamp || 0).getTime();
        return ts > 0 && ts < cutoff1h;
    });

    if (depth > 50) {
        _emitRecommendation({
            source:      "webhookObserver",
            title:       `Webhook queue depth is ${depth} (threshold: 50)`,
            description: `The webhook queue has ${depth} pending items. Consider draining the queue or increasing worker capacity.`,
            priority:    depth > 200 ? "HIGH" : "MEDIUM",
            context:     { depth, staleCount: stale.length },
        });
    }

    if (stale.length > 0) {
        _emitRecommendation({
            source:      "webhookObserver",
            title:       `${stale.length} stale webhooks older than 1 hour`,
            description: `${stale.length} webhook(s) have been pending for over 1 hour and may be stuck. Manual inspection recommended.`,
            priority:    "MEDIUM",
            context:     { staleCount: stale.length, depth, oldestTs: stale.map(w => w.createdAt || w.ts).sort()[0] || null },
        });
    }

    return { queueExists: true, depth, staleCount: stale.length };
}

// ── Observer: deploymentObserver ──────────────────────────────────────────
/**
 * Reads data/deployments.json.
 * Detects: stuck deployments (running > 30 min), failed and unacknowledged.
 */
async function _deploymentObserver() {
    if (!fs.existsSync(DEPLOY_FILE)) return { deploymentsFileExists: false };

    let deployments;
    try { deployments = _rj(DEPLOY_FILE, []); } catch { return { deploymentsFileExists: true, readable: false }; }
    if (!Array.isArray(deployments)) deployments = Object.values(deployments || {});

    const now       = Date.now();
    const stuck30   = now - 30 * 60 * 1000;
    const issues    = [];

    for (const dep of deployments) {
        const id        = dep.id || dep.deploymentId || dep.name || "(unknown)";
        const status    = (dep.status || "").toLowerCase();
        const startedAt = new Date(dep.startedAt || dep.createdAt || dep.ts || 0).getTime();

        // Stuck: running for more than 30 minutes
        if ((status === "running" || status === "in_progress" || status === "deploying") && startedAt > 0 && startedAt < stuck30) {
            const elapsedMin = Math.round((now - startedAt) / 60_000);
            issues.push({ id, issue: "stuck", elapsedMin });
            _emitRecommendation({
                source:      "deploymentObserver",
                title:       `Deployment "${id}" appears stuck (${elapsedMin}m running)`,
                description: `Deployment has been in "${status}" state for ${elapsedMin} minutes, exceeding the 30-minute threshold.`,
                priority:    "HIGH",
                context:     { id, status, elapsedMin, startedAt: dep.startedAt || dep.createdAt },
            });
        }

        // Failed and not acknowledged
        if ((status === "failed" || status === "error") && !dep.acknowledged) {
            issues.push({ id, issue: "failed_unacknowledged" });
            _emitRecommendation({
                source:      "deploymentObserver",
                title:       `Deployment "${id}" failed and is unacknowledged`,
                description: `Deployment "${id}" has status "${status}" and has not been acknowledged. Review and resolve.`,
                priority:    "MEDIUM",
                context:     { id, status, failedAt: dep.failedAt || dep.updatedAt || null },
            });
        }
    }

    return { deploymentsChecked: deployments.length, issues };
}

// ── Observer: incidentObserver ────────────────────────────────────────────
/**
 * Reads data/healing-history.json.
 * Detects escalated heal records in the last 30 minutes.
 */
async function _incidentObserver() {
    if (!fs.existsSync(HEAL_FILE)) return { healFileExists: false };

    let history;
    try { history = _rj(HEAL_FILE, []); } catch { return { healFileExists: true, readable: false }; }
    if (!Array.isArray(history)) return { healFileExists: true, invalid: true };

    const cutoff30 = Date.now() - 30 * 60 * 1000;

    const escalated = history.filter(rec => {
        const ts = new Date(rec.ts || 0).getTime();
        return ts >= cutoff30 && rec.strategy === "escalate";
    });

    if (escalated.length > 0) {
        const targets = escalated.map(r => r.targetId).filter(Boolean).slice(0, 5);
        _emitRecommendation({
            source:      "incidentObserver",
            title:       `${escalated.length} escalated incident(s) in the last 30 minutes`,
            description: `Self-healing escalations detected: ${targets.join(", ")}. These items could not be auto-healed and require manual intervention.`,
            priority:    "CRITICAL",
            context:     { escalatedCount: escalated.length, targets, recent: escalated.slice(-3) },
        });
    }

    return { healRecordsScanned: history.length, escalatedLast30m: escalated.length };
}

// ── Observer registry ─────────────────────────────────────────────────────
const _OBSERVERS = {
    repoObserver:       _repoObserver,
    pm2Observer:        _pm2Observer,
    logObserver:        _logObserver,
    webhookObserver:    _webhookObserver,
    deploymentObserver: _deploymentObserver,
    incidentObserver:   _incidentObserver,
};

// ── Runtime state ─────────────────────────────────────────────────────────
let _running = false;
const _handles = {};   // name → interval handle

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Start all background observers. Idempotent — safe to call multiple times.
 * @returns {{ started: boolean, observerCount: number }}
 */
function start() {
    if (_running) return { started: true, observerCount: Object.keys(_OBSERVERS).length };

    for (const [name, fn] of Object.entries(_OBSERVERS)) {
        _initObserverState(name);
        const wrapped = _wrapObserver(name, fn);

        // Run immediately on start (best-effort, non-blocking)
        Promise.resolve().then(wrapped).catch(() => {});

        const handle = setInterval(wrapped, INTERVALS[name]);
        if (handle.unref) handle.unref();   // don't prevent process exit
        _handles[name] = handle;
    }

    _running = true;
    logger.info(`[BackgroundRuntime] started — ${Object.keys(_OBSERVERS).length} observers active`);
    return { started: true, observerCount: Object.keys(_OBSERVERS).length };
}

/**
 * Stop all background observers and clear intervals.
 */
function stop() {
    for (const [name, handle] of Object.entries(_handles)) {
        clearInterval(handle);
        delete _handles[name];
    }
    _running = false;
    logger.info("[BackgroundRuntime] stopped — all observers cleared");
}

/**
 * Get current runtime status.
 * @returns {{ running: boolean, observers: Array<{name, lastRunAt, lastError, runCount}> }}
 */
function getStatus() {
    const observers = Object.entries(_observerState).map(([name, s]) => ({
        name,
        intervalMs: INTERVALS[name],
        lastRunAt:  s.lastRunAt,
        lastError:  s.lastError,
        runCount:   s.runCount,
    }));
    return { running: _running, observers };
}

/**
 * Get proactive recommendations.
 * @param {{ priority?, source?, acknowledged?, limit?, offset? }} opts
 * @returns {{ recommendations: Array, total: number }}
 */
function getRecommendations({ priority, source, acknowledged, limit = 100, offset = 0 } = {}) {
    let recs = _loadRecs().slice().reverse();   // newest first
    if (priority    !== undefined) recs = recs.filter(r => r.priority    === priority);
    if (source      !== undefined) recs = recs.filter(r => r.source      === source);
    if (acknowledged !== undefined) recs = recs.filter(r => !!r.acknowledged === !!acknowledged);
    const total = recs.length;
    return { recommendations: recs.slice(offset, offset + limit), total };
}

/**
 * Run a single observer immediately by name.
 * @param {string} name
 * @returns {Promise<any>} observer result
 */
async function triggerObserver(name) {
    const fn = _OBSERVERS[name];
    if (!fn) throw new Error(`Unknown observer: "${name}". Valid names: ${Object.keys(_OBSERVERS).join(", ")}`);
    _initObserverState(name);
    const wrapped = _wrapObserver(name, fn);
    return wrapped();
}

/**
 * Clear acknowledged recommendations older than 24 hours.
 * @returns {{ removed: number }}
 */
function clearRecommendations() {
    const recs    = _loadRecs();
    const cutoff  = Date.now() - REC_TTL_MS;
    const kept    = recs.filter(r => {
        if (!r.acknowledged) return true;   // keep all unacknowledged
        const ts = new Date(r.createdAt || 0).getTime();
        return ts > cutoff;                  // keep recent acknowledged ones
    });
    const removed = recs.length - kept.length;
    _saveRecs(kept);
    logger.info(`[BackgroundRuntime] cleared ${removed} acknowledged recommendation(s) older than 24h`);
    return { removed };
}

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
    start,
    stop,
    getStatus,
    getRecommendations,
    triggerObserver,
    clearRecommendations,
};
