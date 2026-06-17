"use strict";
/**
 * Incident Detection Engine — converts operational telemetry into structured incidents.
 *
 * Entry points:
 *   detect(opts)                    — run all rules against current telemetry → open/update incidents
 *   acknowledge(incidentId, note)   — mark an incident acknowledged
 *   resolve(incidentId, note)       — close an incident
 *   getIncident(incidentId)         — retrieve one incident
 *   listIncidents(opts)             — list incidents with filters
 *   getIncidentSummary()            — counts by severity and status
 *
 * Reuses:
 *   - telemetryEngine.getHealthSummary()  (aggregate health signal)
 *   - telemetryEngine.getHistory()        (raw events for rule evaluation)
 *   - telemetryEngine.getMetrics()        (aggregated counters)
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Detection rules (evaluated in detect() against a telemetry window):
 *   deploy_failed       — deploy event with ok:false in last windowMins
 *   deploy_rollback     — deploy event with phase:"rolled-back"
 *   api_error_spike     — errorRate > 25% with ≥3 requests in last 15 min → CRITICAL
 *   api_error_elevated  — errorRate 10-25% with ≥3 requests in last 15 min → MEDIUM
 *   api_repeated_error  — same path+errorCode appears ≥3 times in window  → MEDIUM
 *   health_critical     — summary.overall === "critical"                   → CRITICAL
 *   health_degraded     — summary.overall === "degraded"                   → LOW
 *   route_failure       — single route has 100% error rate with ≥2 calls  → HIGH
 *   slow_api            — p95 latency > 5000ms                            → LOW
 *   deploy_slow         — average deploy > 30s over last 3 deploys         → INFO
 *
 * Severity levels: INFO < LOW < MEDIUM < HIGH < CRITICAL
 *
 * Deduplication:
 *   Each incident has a fingerprint = hash of { ruleId, blueprintId, affectedResource }.
 *   If an open incident with the same fingerprint exists (opened within dedupWindowMins),
 *   the existing incident is updated (occurrence count++) rather than a new one created.
 *   When the condition clears, the incident transitions to "auto-resolved".
 *
 * Incident lifecycle:
 *   open → acknowledged → resolved
 *   open → auto-resolved (condition cleared on next detect() run)
 *   open → escalated     (open longer than escalateAfterMins, default 60)
 *
 * Storage: data/incidents.json  (max 500, newest-first, atomic write)
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

function _tel() { return require("./telemetryEngine.cjs"); }

const DATA_DIR      = path.join(__dirname, "../../data");
const STORE_PATH    = path.join(DATA_DIR, "incidents.json");
const MAX_INCIDENTS = 500;

// Dedup: don't open a new incident if an open one with same fingerprint
// was opened within this window.
const DEDUP_WINDOW_MINS   = 30;
// Auto-escalate open incidents older than this
const ESCALATE_AFTER_MINS = 60;

// ── Severity ordering ─────────────────────────────────────────────
const SEVERITY_RANK = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

// ── Storage ───────────────────────────────────────────────────────
function _load() {
    try {
        const raw    = fs.readFileSync(STORE_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function _save(incidents) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(incidents.slice(0, MAX_INCIDENTS), null, 2));
    fs.renameSync(tmp, STORE_PATH);
}

function _persist(incident) {
    const all = _load();
    const idx = all.findIndex(i => i.incidentId === incident.incidentId);
    if (idx !== -1) all[idx] = incident;
    else all.unshift(incident);
    _save(all);
}

// ── Fingerprint (dedup key) ───────────────────────────────────────
// Simple deterministic string — no crypto needed.
function _fingerprint(ruleId, blueprintId, affectedResource) {
    return `${ruleId}|${blueprintId || "global"}|${affectedResource || ""}`;
}

// ── Incident factory ──────────────────────────────────────────────
let _idCounter = Date.now();

function _newIncident({ ruleId, title, description, severity, blueprintId, productName, affectedResource, evidence }) {
    const fp = _fingerprint(ruleId, blueprintId, affectedResource);
    return {
        incidentId:       `inc_${++_idCounter}`,
        fingerprint:      fp,
        ruleId,
        title,
        description,
        severity,
        status:           "open",
        blueprintId:      blueprintId || null,
        productName:      productName || null,
        affectedResource: affectedResource || null,
        evidence:         evidence || [],
        occurrences:      1,
        openedAt:         new Date().toISOString(),
        updatedAt:        new Date().toISOString(),
        acknowledgedAt:   null,
        resolvedAt:       null,
        notes:            [],
    };
}

// ── Rule evaluators ───────────────────────────────────────────────
// Each evaluator receives { summary, events, windowMins, blueprintId, productName }
// and returns an array of { ruleId, title, description, severity, affectedResource, evidence }
// — one entry per detected condition. Empty array = condition clear.

const RULES = [

    // ── deploy_failed ─────────────────────────────────────────────
    {
        id:      "deploy_failed",
        evalFn({ events, blueprintId }) {
            const failed = events.filter(e =>
                e.type === "deploy" &&
                (e.phase === "failed" || (e.phase === "completed" && e.ok === false)) &&
                (!blueprintId || e.blueprintId === blueprintId)
            );
            if (failed.length === 0) return [];
            return [{
                ruleId:          "deploy_failed",
                title:           "Deploy failed",
                description:     `${failed.length} deploy failure(s) detected. Last error: ${failed[0]?.error || "health check did not pass"}`,
                severity:        "HIGH",
                affectedResource: "deploy",
                evidence:        failed.slice(0, 3).map(e => ({ ts: e.ts, error: e.error, elapsedMs: e.elapsedMs })),
            }];
        },
    },

    // ── deploy_rollback ───────────────────────────────────────────
    {
        id:      "deploy_rollback",
        evalFn({ events, blueprintId }) {
            const rolled = events.filter(e =>
                e.type === "deploy" && e.phase === "rolled-back" &&
                (!blueprintId || e.blueprintId === blueprintId)
            );
            if (rolled.length === 0) return [];
            return [{
                ruleId:          "deploy_rollback",
                title:           "Deploy rolled back",
                description:     `Deployment was automatically rolled back after health check failure.`,
                severity:        "HIGH",
                affectedResource: "deploy",
                evidence:        rolled.slice(0, 2).map(e => ({ ts: e.ts, gitHead: e.gitHead })),
            }];
        },
    },

    // ── api_error_spike ───────────────────────────────────────────
    {
        id:      "api_error_spike",
        evalFn({ summary }) {
            const { total, errors, errorRate } = summary.api;
            if (total < 3 || errorRate <= 25) return [];
            return [{
                ruleId:          "api_error_spike",
                title:           "API error spike",
                description:     `API error rate is ${errorRate}% (${errors}/${total} requests failed).`,
                severity:        "CRITICAL",
                affectedResource: "api",
                evidence:        summary.api.topErrors.slice(0, 3),
            }];
        },
    },

    // ── api_error_elevated ────────────────────────────────────────
    {
        id:      "api_error_elevated",
        evalFn({ summary }) {
            const { total, errors, errorRate } = summary.api;
            if (total < 3 || errorRate <= 10 || errorRate > 25) return [];
            return [{
                ruleId:          "api_error_elevated",
                title:           "API error rate elevated",
                description:     `API error rate is ${errorRate}% (${errors}/${total} requests failed) — above the 10% warning threshold.`,
                severity:        "MEDIUM",
                affectedResource: "api",
                evidence:        summary.api.topErrors.slice(0, 3),
            }];
        },
    },

    // ── api_repeated_error ────────────────────────────────────────
    {
        id:      "api_repeated_error",
        evalFn({ events, blueprintId }) {
            const errEvents = events.filter(e =>
                e.type === "api_error" &&
                (!blueprintId || e.blueprintId === blueprintId)
            );
            // Count by path + errorCode
            const counts = {};
            for (const e of errEvents) {
                const k = `${e.method} ${e.path}:${e.errorCode || "unknown"}`;
                counts[k] = (counts[k] || 0) + 1;
            }
            const repeated = Object.entries(counts)
                .filter(([, n]) => n >= 3)
                .sort(([, a], [, b]) => b - a);

            return repeated.map(([key, count]) => ({
                ruleId:          "api_repeated_error",
                title:           `Repeated error on ${key.split(":")[0]}`,
                description:     `Error ${key.split(":")[1]} occurred ${count} time(s) on ${key.split(":")[0]}.`,
                severity:        "MEDIUM",
                affectedResource: key.split(":")[0],
                evidence:        [{ key, count }],
            }));
        },
    },

    // ── health_critical ───────────────────────────────────────────
    {
        id:      "health_critical",
        evalFn({ summary }) {
            if (summary.overall !== "critical") return [];
            return [{
                ruleId:          "health_critical",
                title:           "Product health is CRITICAL",
                description:     `Health summary reports critical status. Deploy failures: ${summary.deploy.failed}, API error rate: ${summary.api.errorRate}%.`,
                severity:        "CRITICAL",
                affectedResource: "product",
                evidence:        [{ overall: summary.overall, deploy: summary.deploy, api: { errorRate: summary.api.errorRate, errors: summary.api.errors } }],
            }];
        },
    },

    // ── health_degraded ───────────────────────────────────────────
    {
        id:      "health_degraded",
        evalFn({ summary }) {
            if (summary.overall !== "degraded") return [];
            return [{
                ruleId:          "health_degraded",
                title:           "Product health is degraded",
                description:     `Health summary reports degraded status. API error rate: ${summary.api.errorRate}%, deploy failures: ${summary.deploy.failed}.`,
                severity:        "LOW",
                affectedResource: "product",
                evidence:        [{ overall: summary.overall, errorRate: summary.api.errorRate }],
            }];
        },
    },

    // ── route_failure ─────────────────────────────────────────────
    {
        id:      "route_failure",
        evalFn({ events, blueprintId }) {
            const apiEvents = events.filter(e =>
                (e.type === "api_request" || e.type === "api_error") &&
                (!blueprintId || e.blueprintId === blueprintId) &&
                e.path
            );
            // Group by path → count total and errors
            const byPath = {};
            for (const e of apiEvents) {
                if (!byPath[e.path]) byPath[e.path] = { total: 0, errors: 0 };
                byPath[e.path].total++;
                if (e.type === "api_error" || (e.statusCode && e.statusCode >= 500)) {
                    byPath[e.path].errors++;
                }
            }
            return Object.entries(byPath)
                .filter(([, s]) => s.total >= 2 && s.errors / s.total >= 1.0)
                .map(([p, s]) => ({
                    ruleId:          "route_failure",
                    title:           `Route ${p} is failing`,
                    description:     `${p} has a 100% failure rate (${s.errors}/${s.total} requests failed).`,
                    severity:        "HIGH",
                    affectedResource: p,
                    evidence:        [{ path: p, ...s, errorRate: "100%" }],
                }));
        },
    },

    // ── slow_api ──────────────────────────────────────────────────
    {
        id:      "slow_api",
        evalFn({ summary }) {
            if (!summary.api.p95Ms || summary.api.p95Ms <= 5000) return [];
            return [{
                ruleId:          "slow_api",
                title:           "API response time is high",
                description:     `p95 API latency is ${summary.api.p95Ms}ms, exceeding the 5000ms threshold.`,
                severity:        "LOW",
                affectedResource: "api",
                evidence:        [{ p50Ms: summary.api.p50Ms, p95Ms: summary.api.p95Ms }],
            }];
        },
    },

    // ── deploy_slow ───────────────────────────────────────────────
    {
        id:      "deploy_slow",
        evalFn({ events, blueprintId }) {
            const deploys = events
                .filter(e => e.type === "deploy" && e.phase === "completed" && e.elapsedMs &&
                    (!blueprintId || e.blueprintId === blueprintId))
                .slice(0, 3);
            if (deploys.length === 0) return [];
            const avg = deploys.reduce((s, e) => s + e.elapsedMs, 0) / deploys.length;
            if (avg <= 30_000) return [];
            return [{
                ruleId:          "deploy_slow",
                title:           "Deploys are taking too long",
                description:     `Average deploy time is ${Math.round(avg / 1000)}s over the last ${deploys.length} deploy(s).`,
                severity:        "INFO",
                affectedResource: "deploy",
                evidence:        [{ avgMs: Math.round(avg), sampleSize: deploys.length }],
            }];
        },
    },

];

// ── Core detection logic ──────────────────────────────────────────

/**
 * Run all detection rules against current telemetry.
 *
 * @param {object} opts
 * @param {number}  opts.windowMins   — telemetry lookback window (default 60)
 * @param {string}  opts.blueprintId  — scope to one product (optional)
 * @param {string}  opts.productName
 * @returns {DetectionResult}
 *   { opened: Incident[], updated: Incident[], autoResolved: Incident[], total }
 */
function detect({ windowMins = 60, blueprintId, productName } = {}) {
    const tel     = _tel();
    const summary = tel.getHealthSummary({ windowMins });
    const events  = tel.getHistory({ windowMins, blueprintId });
    const ctx     = { summary, events, windowMins, blueprintId, productName };

    const now     = new Date();
    const existing = _load();

    const opened       = [];
    const updated      = [];
    const autoResolved = [];

    // Set of fingerprints that fired this detection run — used to auto-resolve stale incidents
    const firedFingerprints = new Set();

    // ── Evaluate each rule ────────────────────────────────────────
    for (const rule of RULES) {
        let detections;
        try { detections = rule.evalFn(ctx); }
        catch (err) {
            logger.info(`[IncidentEngine] rule ${rule.id} error: ${err.message}`);
            detections = [];
        }

        for (const det of detections) {
            const fp = _fingerprint(det.ruleId, blueprintId, det.affectedResource);
            firedFingerprints.add(fp);

            // Look for an existing open incident with this fingerprint
            const dedupCutoff = new Date(now - DEDUP_WINDOW_MINS * 60_000);
            const existing_inc = existing.find(i =>
                i.fingerprint === fp &&
                (i.status === "open" || i.status === "escalated") &&
                new Date(i.openedAt) >= dedupCutoff
            );

            if (existing_inc) {
                // Update: bump occurrence count, update evidence
                existing_inc.occurrences++;
                existing_inc.updatedAt = now.toISOString();
                existing_inc.description = det.description;
                existing_inc.evidence    = det.evidence;
                // Escalate if open too long
                const ageMs = now - new Date(existing_inc.openedAt);
                if (existing_inc.status === "open" && ageMs > ESCALATE_AFTER_MINS * 60_000) {
                    existing_inc.status = "escalated";
                    existing_inc.notes.push({ ts: now.toISOString(), note: `Auto-escalated after ${Math.round(ageMs / 60_000)} minutes open` });
                }
                _persist(existing_inc);
                updated.push(existing_inc);
            } else {
                // Open a new incident
                const inc = _newIncident({ ...det, blueprintId, productName });
                _persist(inc);
                opened.push(inc);
                logger.info(`[IncidentEngine] OPEN [${inc.severity}] ${inc.title} (${inc.incidentId})`);
            }
        }
    }

    // ── Auto-resolve incidents whose condition cleared ────────────
    const openIncidents = _load().filter(i =>
        (i.status === "open" || i.status === "escalated") &&
        (!blueprintId || i.blueprintId === blueprintId)
    );

    for (const inc of openIncidents) {
        if (!firedFingerprints.has(inc.fingerprint)) {
            inc.status     = "auto-resolved";
            inc.resolvedAt = now.toISOString();
            inc.updatedAt  = now.toISOString();
            inc.notes.push({ ts: now.toISOString(), note: "Condition cleared — auto-resolved by detection run" });
            _persist(inc);
            autoResolved.push(inc);
            logger.info(`[IncidentEngine] AUTO-RESOLVED ${inc.incidentId} (${inc.title})`);
        }
    }

    const result = {
        detectedAt:   now.toISOString(),
        windowMins,
        blueprintId:  blueprintId || null,
        opened:       opened.length,
        updated:      updated.length,
        autoResolved: autoResolved.length,
        openedList:   opened,
        updatedList:  updated,
        autoResolvedList: autoResolved,
    };

    logger.info(`[IncidentEngine] detect: opened=${opened.length} updated=${updated.length} autoResolved=${autoResolved.length}`);
    return result;
}

// ── Lifecycle mutations ───────────────────────────────────────────

/**
 * Acknowledge an incident.
 * @param {string} incidentId
 * @param {string} [note]
 */
function acknowledge(incidentId, note = "") {
    const all = _load();
    const inc = all.find(i => i.incidentId === incidentId);
    if (!inc) return { ok: false, error: "incident_not_found" };
    if (inc.status === "resolved" || inc.status === "auto-resolved") {
        return { ok: false, error: `Cannot acknowledge — incident is ${inc.status}` };
    }
    inc.status         = "acknowledged";
    inc.acknowledgedAt = new Date().toISOString();
    inc.updatedAt      = new Date().toISOString();
    if (note) inc.notes.push({ ts: new Date().toISOString(), note });
    _save(all);
    return { ok: true, incident: inc };
}

/**
 * Resolve an incident.
 * @param {string} incidentId
 * @param {string} [note]
 */
function resolve(incidentId, note = "") {
    const all = _load();
    const inc = all.find(i => i.incidentId === incidentId);
    if (!inc) return { ok: false, error: "incident_not_found" };
    if (inc.status === "resolved") return { ok: false, error: "Already resolved" };
    inc.status     = "resolved";
    inc.resolvedAt = new Date().toISOString();
    inc.updatedAt  = new Date().toISOString();
    if (note) inc.notes.push({ ts: new Date().toISOString(), note });
    _save(all);
    logger.info(`[IncidentEngine] RESOLVED ${incidentId}`);
    return { ok: true, incident: inc };
}

// ── Reader API ────────────────────────────────────────────────────

/** Retrieve a single incident by id. */
function getIncident(incidentId) {
    return _load().find(i => i.incidentId === incidentId) || null;
}

/**
 * List incidents with optional filters.
 * @param {object} opts
 * @param {string}  opts.status      — "open"|"acknowledged"|"resolved"|"auto-resolved"|"escalated"
 * @param {string}  opts.severity    — "INFO"|"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"
 * @param {string}  opts.blueprintId
 * @param {number}  opts.limit       — default 50
 * @param {string}  opts.ruleId      — filter by detection rule
 */
function listIncidents({ status, severity, blueprintId, ruleId, limit = 50 } = {}) {
    let incidents = _load();
    if (status)      incidents = incidents.filter(i => i.status === status);
    if (severity)    incidents = incidents.filter(i => i.severity === severity);
    if (blueprintId) incidents = incidents.filter(i => i.blueprintId === blueprintId);
    if (ruleId)      incidents = incidents.filter(i => i.ruleId === ruleId);
    return incidents.slice(0, limit);
}

/**
 * Summary counts by severity and status.
 */
function getIncidentSummary() {
    const all = _load();
    const bySeverity = { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const byStatus   = { open: 0, acknowledged: 0, escalated: 0, resolved: 0, "auto-resolved": 0 };

    for (const i of all) {
        if (bySeverity[i.severity] !== undefined) bySeverity[i.severity]++;
        if (byStatus[i.status]     !== undefined) byStatus[i.status]++;
    }

    const openCritical = all.filter(i => i.severity === "CRITICAL" && (i.status === "open" || i.status === "escalated")).length;
    const openHigh     = all.filter(i => i.severity === "HIGH"     && (i.status === "open" || i.status === "escalated")).length;

    return {
        total:        all.length,
        open:         (byStatus.open || 0) + (byStatus.escalated || 0),
        bySeverity,
        byStatus,
        openCritical,
        openHigh,
        requiresAttention: openCritical > 0 || openHigh > 0,
    };
}

module.exports = {
    detect,
    acknowledge,
    resolve,
    getIncident,
    listIncidents,
    getIncidentSummary,
};
