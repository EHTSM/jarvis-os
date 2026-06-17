"use strict";
/**
 * Learning Memory Engine — Jarvis remembers what problems occurred and what fixes worked.
 *
 * Entry points:
 *   ingest(opts)            — record one healing run outcome into memory
 *   ingestFromRun(runId)    — convenience: load a HealingRun and call ingest()
 *   getMemory()             — full memory state
 *   getSummary()            — counts, trends, top patterns
 *   getPatterns(opts)       — list incident/RCA/fix patterns with filters
 *   getRecommendations(ctx) — given current context, return learned recommendations
 *   detectRepeated(opts)    — check if a given ruleId/causeCategory is a known repeat
 *
 * Reuses (all fail-safe):
 *   selfHealingPipeline.getHealingRun()  — load run by ID
 *   autoFixPlanner.getPlan()             — load plan for context
 *   rootCauseAnalyzer.getReport()        — load RCA for context
 *   incidentEngine.getIncident()         — load incident for context
 *   telemetryEngine.getHistory()         — validate repeated patterns against live data
 *
 * No new architecture. No AI calls. No agent army.
 *
 * Memory model:
 *   data/learning-memory.json contains:
 *
 *   incidentPatterns: {
 *     [fingerprint]: {
 *       fingerprint, ruleId, causeCategory, severity,
 *       count,            — total times this pattern was seen
 *       firstSeenAt, lastSeenAt,
 *       affectedRoutes[], affectedFiles[],
 *       outcomes: { success, failed, rolled_back, pending },
 *       bestFix: { approach, confidence, successRate } | null,
 *       worstFix: { approach, error, failureRate } | null,
 *     }
 *   }
 *
 *   rcaPatterns: {
 *     [causeCategory]: {
 *       causeCategory,
 *       count, firstSeenAt, lastSeenAt,
 *       topErrorCodes[],     — most frequent errorCodes that led to this cause
 *       topRoutes[],         — most affected routes
 *       avgConfidence,
 *       fixOutcomes: { success, failed, rolled_back },
 *       bestApproach: string | null,   — approach with highest success rate
 *     }
 *   }
 *
 *   fixPatterns: {
 *     [approach]: {
 *       approach,
 *       attempts, successes, failures, rollbacks,
 *       successRate,
 *       avgTaskCount,
 *       avgConfidence,
 *       firstSeenAt, lastSeenAt,
 *       examplePlanIds[],    — up to 3 recent plan IDs
 *     }
 *   }
 *
 *   repeatAlerts: [{
 *     fingerprint, ruleId, causeCategory, count,
 *     firstSeenAt, lastSeenAt, alertedAt,
 *     recommendation: string,
 *   }]                        — generated when count >= REPEAT_THRESHOLD
 *
 *   ingestLog: [{             — ring buffer of what was ingested
 *     ingestedAt, runId, planId, incidentId, outcome, causeCategory, approach,
 *   }]                        max 200
 *
 * Storage: data/learning-memory.json  (single file, atomic write)
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const DATA_DIR    = path.join(__dirname, "../../data");
const MEMORY_PATH = path.join(DATA_DIR, "learning-memory.json");

const REPEAT_THRESHOLD  = 3;    // fire repeatAlert when pattern count >= this
const MAX_INGEST_LOG    = 200;
const MAX_REPEAT_ALERTS = 50;
const MAX_EXAMPLE_IDS   = 3;

// ── Lazy accessors ────────────────────────────────────────────────
function _shp() { try { return require("./selfHealingPipeline.cjs"); } catch { return null; } }
function _afp() { try { return require("./autoFixPlanner.cjs");      } catch { return null; } }
function _rca() { try { return require("./rootCauseAnalyzer.cjs");   } catch { return null; } }
function _inc() { try { return require("./incidentEngine.cjs");      } catch { return null; } }
function _tel() { try { return require("./telemetryEngine.cjs");     } catch { return null; } }

// ── Storage ───────────────────────────────────────────────────────
function _empty() {
    return {
        incidentPatterns: {},
        rcaPatterns:      {},
        fixPatterns:      {},
        repeatAlerts:     [],
        ingestLog:        [],
        updatedAt:        null,
    };
}

function _load() {
    try {
        const raw = fs.readFileSync(MEMORY_PATH, "utf8");
        const d   = JSON.parse(raw);
        // Ensure all top-level keys exist (forward-compat)
        return { ..._empty(), ...d };
    } catch { return _empty(); }
}

function _save(mem) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    mem.updatedAt = new Date().toISOString();
    const tmp = MEMORY_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
    fs.renameSync(tmp, MEMORY_PATH);
}

// ── Pattern key helpers ───────────────────────────────────────────
function _incidentFp(ruleId, causeCategory, severity) {
    return `${ruleId}|${causeCategory || "unknown"}|${severity || "MEDIUM"}`;
}

// ── Ingest helpers ────────────────────────────────────────────────

/**
 * Core ingest: record one complete healing run outcome into memory.
 *
 * @param {object} opts
 * @param {string}  opts.runId          — healing run ID
 * @param {string}  opts.planId
 * @param {string}  opts.rcaId
 * @param {string}  opts.incidentId
 * @param {string}  opts.outcome        — "success"|"rolled-back"|"failed"|"recommend-only"|"awaiting-approval"
 * @param {string}  opts.causeCategory  — from RCA
 * @param {string}  opts.approach       — from fix plan strategy
 * @param {string}  opts.ruleId         — incident rule that fired
 * @param {string}  opts.severity       — incident severity
 * @param {string}  opts.mode           — healing mode used
 * @param {number}  opts.confidence     — plan confidence
 * @param {number}  opts.taskCount      — number of tasks in plan
 * @param {string[]} opts.affectedRoutes
 * @param {string[]} opts.affectedFiles
 * @param {string[]} opts.topErrorCodes
 * @param {string}  opts.errorDetail    — first error from rollback (if failed)
 * @returns {object}  — { ok, patternKey, isRepeat, repeatAlert? }
 */
function ingest(opts = {}) {
    const {
        runId, planId, rcaId, incidentId,
        outcome        = "unknown",
        causeCategory  = "unknown",
        approach       = "unknown",
        ruleId         = "unknown",
        severity       = "MEDIUM",
        mode           = "unknown",
        confidence     = 50,
        taskCount      = 0,
        affectedRoutes = [],
        affectedFiles  = [],
        topErrorCodes  = [],
        errorDetail    = null,
    } = opts;

    const mem    = _load();
    const now    = new Date().toISOString();
    const isSucc = outcome === "success";
    const isFail = outcome === "rolled-back" || outcome === "failed";

    // ── 1. Incident pattern ────────────────────────────────────────
    const fp = _incidentFp(ruleId, causeCategory, severity);
    if (!mem.incidentPatterns[fp]) {
        mem.incidentPatterns[fp] = {
            fingerprint:    fp,
            ruleId,
            causeCategory,
            severity,
            count:          0,
            firstSeenAt:    now,
            lastSeenAt:     now,
            affectedRoutes: [],
            affectedFiles:  [],
            outcomes:       { success: 0, failed: 0, rolled_back: 0, pending: 0 },
            bestFix:        null,
            worstFix:       null,
        };
    }
    const ip = mem.incidentPatterns[fp];
    ip.count++;
    ip.lastSeenAt = now;

    // Merge routes/files (union, keep unique, cap at 10)
    for (const r of affectedRoutes) {
        if (!ip.affectedRoutes.includes(r)) ip.affectedRoutes.push(r);
    }
    ip.affectedRoutes = ip.affectedRoutes.slice(0, 10);
    for (const f of affectedFiles) {
        if (!ip.affectedFiles.includes(f)) ip.affectedFiles.push(f);
    }
    ip.affectedFiles = ip.affectedFiles.slice(0, 10);

    // Track outcomes
    if (isSucc)               ip.outcomes.success++;
    else if (outcome === "rolled-back") ip.outcomes.rolled_back++;
    else if (outcome === "failed")      ip.outcomes.failed++;
    else                                ip.outcomes.pending++;

    // Update bestFix / worstFix
    if (isSucc) {
        const total   = ip.outcomes.success + ip.outcomes.failed + ip.outcomes.rolled_back;
        const succRate = ip.outcomes.success / Math.max(total, 1);
        if (!ip.bestFix || succRate >= ip.bestFix.successRate) {
            ip.bestFix = { approach, confidence, successRate: Math.round(succRate * 100) / 100 };
        }
    }
    if (isFail) {
        const total    = ip.outcomes.success + ip.outcomes.failed + ip.outcomes.rolled_back;
        const failRate = (ip.outcomes.failed + ip.outcomes.rolled_back) / Math.max(total, 1);
        if (!ip.worstFix || failRate >= ip.worstFix.failureRate) {
            ip.worstFix = { approach, error: errorDetail, failureRate: Math.round(failRate * 100) / 100 };
        }
    }

    // ── 2. RCA pattern ────────────────────────────────────────────
    if (!mem.rcaPatterns[causeCategory]) {
        mem.rcaPatterns[causeCategory] = {
            causeCategory,
            count:          0,
            firstSeenAt:    now,
            lastSeenAt:     now,
            topErrorCodes:  {},  // code → count
            topRoutes:      {},  // route → count
            totalConfidence: 0,
            avgConfidence:  0,
            fixOutcomes:    { success: 0, failed: 0, rolled_back: 0 },
            bestApproach:   null,
            _approachStats: {},  // approach → { attempts, successes }
        };
    }
    const rp = mem.rcaPatterns[causeCategory];
    rp.count++;
    rp.lastSeenAt     = now;
    rp.totalConfidence = (rp.totalConfidence || 0) + confidence;
    rp.avgConfidence   = Math.round(rp.totalConfidence / rp.count);

    for (const code of topErrorCodes) {
        rp.topErrorCodes[code] = (rp.topErrorCodes[code] || 0) + 1;
    }
    for (const route of affectedRoutes) {
        rp.topRoutes[route] = (rp.topRoutes[route] || 0) + 1;
    }

    if (isSucc)                         rp.fixOutcomes.success++;
    else if (outcome === "rolled-back") rp.fixOutcomes.rolled_back++;
    else if (outcome === "failed")      rp.fixOutcomes.failed++;

    // Track best approach per cause category
    if (!rp._approachStats[approach]) rp._approachStats[approach] = { attempts: 0, successes: 0 };
    rp._approachStats[approach].attempts++;
    if (isSucc) rp._approachStats[approach].successes++;

    // Derive bestApproach: highest success rate with ≥ 1 attempt
    const best = Object.entries(rp._approachStats)
        .map(([appr, s]) => ({ appr, rate: s.attempts > 0 ? s.successes / s.attempts : 0 }))
        .sort((a, b) => b.rate - a.rate)[0];
    rp.bestApproach = best?.appr || null;

    // ── 3. Fix pattern ────────────────────────────────────────────
    if (!mem.fixPatterns[approach]) {
        mem.fixPatterns[approach] = {
            approach,
            attempts:      0,
            successes:     0,
            failures:      0,
            rollbacks:     0,
            successRate:   0,
            avgTaskCount:  0,
            totalTasks:    0,
            avgConfidence: 0,
            totalConfidence: 0,
            firstSeenAt:   now,
            lastSeenAt:    now,
            examplePlanIds: [],
        };
    }
    const fp2 = mem.fixPatterns[approach];
    fp2.attempts++;
    fp2.lastSeenAt       = now;
    fp2.totalTasks       = (fp2.totalTasks || 0) + taskCount;
    fp2.avgTaskCount     = Math.round(fp2.totalTasks / fp2.attempts);
    fp2.totalConfidence  = (fp2.totalConfidence || 0) + confidence;
    fp2.avgConfidence    = Math.round(fp2.totalConfidence / fp2.attempts);

    if (isSucc)                         fp2.successes++;
    else if (outcome === "rolled-back") fp2.rollbacks++;
    else if (outcome === "failed")      fp2.failures++;

    fp2.successRate = Math.round((fp2.successes / fp2.attempts) * 100) / 100;

    if (planId && !fp2.examplePlanIds.includes(planId)) {
        fp2.examplePlanIds.unshift(planId);
        fp2.examplePlanIds = fp2.examplePlanIds.slice(0, MAX_EXAMPLE_IDS);
    }

    // ── 4. Repeat alert ───────────────────────────────────────────
    let repeatAlert = null;
    let isRepeat    = false;

    if (ip.count >= REPEAT_THRESHOLD) {
        isRepeat = true;
        // Generate or update an alert for this pattern
        const existing = mem.repeatAlerts.find(a => a.fingerprint === fp);
        const succRate  = ip.outcomes.success / Math.max(ip.count, 1);
        const rec       = _buildRepeatRecommendation(ip, rp);

        if (!existing) {
            repeatAlert = {
                fingerprint:    fp,
                ruleId,
                causeCategory,
                severity,
                count:          ip.count,
                firstSeenAt:    ip.firstSeenAt,
                lastSeenAt:     now,
                alertedAt:      now,
                successRate:    Math.round(succRate * 100) / 100,
                recommendation: rec,
            };
            mem.repeatAlerts.unshift(repeatAlert);
            mem.repeatAlerts = mem.repeatAlerts.slice(0, MAX_REPEAT_ALERTS);
            logger.info(`[LearningMemory] REPEAT ALERT: ${fp} seen ${ip.count}x`);
        } else {
            existing.count        = ip.count;
            existing.lastSeenAt   = now;
            existing.successRate  = Math.round(succRate * 100) / 100;
            existing.recommendation = rec;
            repeatAlert           = existing;
        }
    }

    // ── 5. Ingest log ─────────────────────────────────────────────
    mem.ingestLog.unshift({
        ingestedAt:    now,
        runId:         runId || null,
        planId:        planId || null,
        incidentId:    incidentId || null,
        outcome,
        causeCategory,
        approach,
        ruleId,
        severity,
        mode,
        confidence,
    });
    mem.ingestLog = mem.ingestLog.slice(0, MAX_INGEST_LOG);

    _save(mem);

    logger.info(`[LearningMemory] ingested: ${fp} outcome=${outcome} approach=${approach} repeat=${isRepeat}`);
    return {
        ok:           true,
        patternKey:   fp,
        incidentCount: ip.count,
        isRepeat,
        repeatAlert:  isRepeat ? repeatAlert : null,
    };
}

/**
 * Convenience: load a HealingRun by ID and ingest it.
 *
 * @param {string} runId
 * @returns {object}  ingest() result or { ok: false, error }
 */
function ingestFromRun(runId) {
    const shp = _shp();
    if (!shp) return { ok: false, error: "selfHealingPipeline unavailable" };

    const run = shp.getHealingRun(runId);
    if (!run) return { ok: false, error: `Run ${runId} not found` };

    // Load enrichment from plan and RCA
    let causeCategory  = "unknown";
    let approach       = "unknown";
    let confidence     = 50;
    let taskCount      = 0;
    let affectedRoutes = [];
    let affectedFiles  = [];
    let topErrorCodes  = [];
    let ruleId         = "unknown";
    let severity       = "MEDIUM";
    let errorDetail    = null;

    // From fix plan
    const afp  = _afp();
    if (afp && run.planId) {
        const plan = afp.getPlan(run.planId);
        if (plan) {
            causeCategory  = plan.strategy?.category || causeCategory;
            approach       = plan.strategy?.approach  || approach;
            confidence     = plan.confidence          || confidence;
            taskCount      = plan.tasks?.length       || taskCount;
            affectedRoutes = plan.targetFiles?.map(f => f.filePath) || [];
            affectedFiles  = plan.targetFiles?.map(f => f.filePath) || [];
        }
    }

    // From RCA report
    const rcaMod = _rca();
    if (rcaMod && run.rcaId) {
        const rcaRep = rcaMod.getReport(run.rcaId);
        if (rcaRep) {
            causeCategory  = rcaRep.cause?.category   || causeCategory;
            affectedRoutes = rcaRep.affectedRoutes?.map(r => r.path)       || affectedRoutes;
            affectedFiles  = rcaRep.affectedFiles?.map(f => f.filePath)    || affectedFiles;
            topErrorCodes  = rcaRep.affectedRoutes?.flatMap(r =>
                r.topErrorCodes?.map(e => e.code) || []) || [];
        }
    }

    // From incident
    const incMod = _inc();
    if (incMod && run.incidentId) {
        const incident = incMod.getIncident(run.incidentId);
        if (incident) {
            ruleId   = incident.ruleId   || ruleId;
            severity = incident.severity || severity;
        }
    }

    // Error detail from rollback log
    if (run.rollbackLog?.length) {
        errorDetail = run.rollbackLog.find(l => /fail|error/i.test(l)) || run.rollbackLog[0];
    }

    return ingest({
        runId, planId: run.planId, rcaId: run.rcaId, incidentId: run.incidentId,
        outcome: run.outcome, causeCategory, approach, ruleId, severity, mode: run.mode,
        confidence, taskCount, affectedRoutes, affectedFiles, topErrorCodes, errorDetail,
    });
}

// ── Repeat recommendation builder ─────────────────────────────────

function _buildRepeatRecommendation(incidentPattern, rcaPattern) {
    const { ruleId, causeCategory, count, bestFix, outcomes } = incidentPattern;
    const successRate = outcomes.success / Math.max(count, 1);

    if (bestFix && bestFix.successRate >= 0.7) {
        return `"${ruleId}" has occurred ${count} times. Best fix: "${bestFix.approach}" ` +
               `(${Math.round(bestFix.successRate * 100)}% success rate). Apply it immediately.`;
    }
    if (successRate < 0.3 && count >= 5) {
        return `"${ruleId}" is a chronic issue (${count} occurrences, ${Math.round(successRate * 100)}% resolution rate). ` +
               `Current fixes are not working — escalate for architectural review.`;
    }
    return `"${ruleId}" has recurred ${count} times (cause: ${causeCategory}). ` +
           `Review root cause pattern to prevent recurrence.`;
}

// ── Reader API ────────────────────────────────────────────────────

/** Return the full memory state. */
function getMemory() {
    return _load();
}

/**
 * Summary: counts, trend signals, top patterns.
 */
function getSummary() {
    const mem = _load();

    const incPatterns = Object.values(mem.incidentPatterns);
    const rcaPatterns = Object.values(mem.rcaPatterns);
    const fixPatterns = Object.values(mem.fixPatterns);

    // Top recurring incidents
    const topIncidents = incPatterns
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(p => ({
            fingerprint:   p.fingerprint,
            ruleId:        p.ruleId,
            causeCategory: p.causeCategory,
            count:         p.count,
            lastSeenAt:    p.lastSeenAt,
            successRate:   Math.round((p.outcomes.success / Math.max(p.count, 1)) * 100),
            bestApproach:  p.bestFix?.approach || null,
        }));

    // Top cause categories
    const topCauses = rcaPatterns
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(p => ({
            causeCategory: p.causeCategory,
            count:         p.count,
            successRate:   Math.round(((p.fixOutcomes.success || 0) / Math.max(p.count, 1)) * 100),
            bestApproach:  p.bestApproach,
        }));

    // Most effective fix approaches
    const topFixes = fixPatterns
        .filter(f => f.attempts >= 1)
        .sort((a, b) => (b.successRate - a.successRate) || (b.attempts - a.attempts))
        .slice(0, 5)
        .map(f => ({
            approach:    f.approach,
            attempts:    f.attempts,
            successRate: Math.round(f.successRate * 100),
            avgTaskCount: f.avgTaskCount,
        }));

    // Total outcomes from ingest log
    const outcomes = { success: 0, failed: 0, rolled_back: 0, other: 0 };
    for (const entry of mem.ingestLog) {
        if (entry.outcome === "success")                  outcomes.success++;
        else if (entry.outcome === "failed")              outcomes.failed++;
        else if (entry.outcome === "rolled-back")         outcomes.rolled_back++;
        else                                               outcomes.other++;
    }

    return {
        generatedAt:       new Date().toISOString(),
        totalIngested:     mem.ingestLog.length,
        outcomes,
        uniquePatterns:    incPatterns.length,
        repeatAlerts:      mem.repeatAlerts.length,
        topIncidents,
        topCauses,
        topFixes,
        updatedAt:         mem.updatedAt,
    };
}

/**
 * Return incident/RCA/fix patterns with optional filters.
 *
 * @param {object} opts
 * @param {string}  [opts.type]          — "incident"|"rca"|"fix"
 * @param {string}  [opts.causeCategory]
 * @param {string}  [opts.ruleId]
 * @param {number}  [opts.minCount=1]
 * @param {number}  [opts.limit=20]
 */
function getPatterns({ type, causeCategory, ruleId, minCount = 1, limit = 20 } = {}) {
    const mem    = _load();
    const result = {};

    if (!type || type === "incident") {
        result.incidentPatterns = Object.values(mem.incidentPatterns)
            .filter(p => p.count >= minCount)
            .filter(p => !causeCategory || p.causeCategory === causeCategory)
            .filter(p => !ruleId        || p.ruleId        === ruleId)
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    if (!type || type === "rca") {
        result.rcaPatterns = Object.values(mem.rcaPatterns)
            .filter(p => p.count >= minCount)
            .filter(p => !causeCategory || p.causeCategory === causeCategory)
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    if (!type || type === "fix") {
        result.fixPatterns = Object.values(mem.fixPatterns)
            .filter(p => p.attempts >= minCount)
            .sort((a, b) => b.successRate - a.successRate || b.attempts - a.attempts)
            .slice(0, limit);
    }

    return result;
}

/**
 * Given current context, return learned recommendations.
 *
 * Context: { ruleId, causeCategory, severity, affectedRoutes[] }
 *
 * Returns: [{
 *   type: "best_fix" | "avoid_fix" | "recurring_issue" | "escalate",
 *   message: string,
 *   confidence: number,   — 0–100
 *   source: "fix_pattern" | "incident_pattern" | "rca_pattern",
 * }]
 */
function getRecommendations({ ruleId, causeCategory, severity, affectedRoutes = [] } = {}) {
    const mem  = _load();
    const recs = [];

    // ── Incident pattern match ─────────────────────────────────────
    const incPattern = Object.values(mem.incidentPatterns).find(p =>
        (!ruleId        || p.ruleId        === ruleId) &&
        (!causeCategory || p.causeCategory === causeCategory)
    );

    if (incPattern) {
        const succRate = incPattern.outcomes.success / Math.max(incPattern.count, 1);

        if (incPattern.count >= REPEAT_THRESHOLD) {
            recs.push({
                type:       "recurring_issue",
                message:    `This "${ruleId}" pattern has occurred ${incPattern.count} times. ` +
                            `It is a known recurring issue (${Math.round(succRate * 100)}% resolution rate).`,
                confidence: Math.min(50 + incPattern.count * 5, 90),
                source:     "incident_pattern",
            });
        }

        if (incPattern.bestFix && incPattern.bestFix.successRate >= 0.6) {
            recs.push({
                type:       "best_fix",
                message:    `Best known fix: "${incPattern.bestFix.approach}" ` +
                            `(${Math.round(incPattern.bestFix.successRate * 100)}% success rate across ${incPattern.count} incidents).`,
                confidence: Math.round(incPattern.bestFix.successRate * 100),
                source:     "incident_pattern",
            });
        }

        if (incPattern.worstFix && incPattern.worstFix.failureRate >= 0.5) {
            recs.push({
                type:       "avoid_fix",
                message:    `Avoid approach "${incPattern.worstFix.approach}" — ` +
                            `it has a ${Math.round(incPattern.worstFix.failureRate * 100)}% failure rate for this pattern.`,
                confidence: Math.round(incPattern.worstFix.failureRate * 100),
                source:     "incident_pattern",
            });
        }

        if (incPattern.count >= 5 && succRate < 0.3) {
            recs.push({
                type:       "escalate",
                message:    `"${ruleId}" has occurred ${incPattern.count} times with only ${Math.round(succRate * 100)}% resolution. ` +
                            `Current fixes are ineffective — escalate for architectural review.`,
                confidence: 80,
                source:     "incident_pattern",
            });
        }
    }

    // ── RCA pattern match ─────────────────────────────────────────
    if (causeCategory && mem.rcaPatterns[causeCategory]) {
        const rcaP = mem.rcaPatterns[causeCategory];
        if (rcaP.bestApproach) {
            const apprStats = rcaP._approachStats?.[rcaP.bestApproach];
            const rate      = apprStats?.attempts > 0
                ? Math.round((apprStats.successes / apprStats.attempts) * 100) : 0;
            recs.push({
                type:       "best_fix",
                message:    `For "${causeCategory}" incidents, "${rcaP.bestApproach}" has the best track record ` +
                            `(${rate}% success rate, ${rcaP.count} incidents).`,
                confidence: rate,
                source:     "rca_pattern",
            });
        }
    }

    // ── Fix pattern match ─────────────────────────────────────────
    // Find fix patterns used for this cause category
    const relevantFixes = Object.values(mem.fixPatterns)
        .filter(f => f.attempts >= 2)
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 3);

    for (const fix of relevantFixes) {
        if (fix.successRate >= 0.8) {
            recs.push({
                type:       "best_fix",
                message:    `Fix approach "${fix.approach}" has an ${Math.round(fix.successRate * 100)}% success rate ` +
                            `across ${fix.attempts} attempts.`,
                confidence: Math.round(fix.successRate * 100),
                source:     "fix_pattern",
            });
        }
    }

    // Deduplicate by type+source (keep highest confidence)
    const seen   = {};
    const unique = [];
    for (const r of recs.sort((a, b) => b.confidence - a.confidence)) {
        const key = `${r.type}:${r.source}`;
        if (!seen[key]) { seen[key] = true; unique.push(r); }
    }

    return unique.slice(0, 8);
}

/**
 * Check whether a given ruleId/causeCategory combination is a known repeat.
 *
 * @param {object} opts
 * @param {string}  opts.ruleId
 * @param {string}  [opts.causeCategory]
 * @param {string}  [opts.severity]
 * @returns {{ isRepeat, count, pattern, alert }}
 */
function detectRepeated({ ruleId, causeCategory, severity } = {}) {
    const mem = _load();

    // Exact match first
    const fp  = _incidentFp(ruleId, causeCategory || "unknown", severity || "MEDIUM");
    let   pat = mem.incidentPatterns[fp];

    // Loose match (same ruleId, any cause/severity)
    if (!pat) {
        pat = Object.values(mem.incidentPatterns).find(p => p.ruleId === ruleId);
    }

    if (!pat) return { isRepeat: false, count: 0, pattern: null, alert: null };

    const alert = mem.repeatAlerts.find(a => a.fingerprint === pat.fingerprint) || null;
    return {
        isRepeat:  pat.count >= REPEAT_THRESHOLD,
        count:     pat.count,
        pattern:   pat,
        alert,
    };
}

module.exports = {
    ingest,
    ingestFromRun,
    getMemory,
    getSummary,
    getPatterns,
    getRecommendations,
    detectRepeated,
};
