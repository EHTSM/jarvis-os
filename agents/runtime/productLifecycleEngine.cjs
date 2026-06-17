"use strict";
/**
 * Product Lifecycle Engine — continuous evaluation and improvement of deployed products.
 *
 * Entry points:
 *   evaluate(opts)           — run one full lifecycle evaluation tick → LifecycleTick
 *   scheduleEvaluation(opts) — schedule recurring evaluation via setInterval
 *   stopScheduler()          — stop the recurring scheduler
 *   getLastTick()            — most recent evaluation tick
 *   listReports(opts)        — list stored LifecycleReports
 *   getReport(reportId)      — retrieve one report
 *   getMaturity(blueprintId) — current maturity score for a product
 *   getDebtItems(opts)       — list tracked technical debt items
 *
 * Reuses (all fail-safe, lazy require):
 *   telemetryEngine.getHealthSummary()     — current health signal
 *   telemetryEngine.getHistory()           — raw events for trend analysis
 *   telemetryEngine.getMetrics()           — aggregated counters
 *   incidentEngine.listIncidents()         — open/recent incidents
 *   incidentEngine.getIncidentSummary()    — severity counts
 *   rootCauseAnalyzer.listReports()        — recent RCA reports
 *   autoFixPlanner.listPlans()             — fix plans and their status
 *   selfHealingPipeline.listHealingRuns()  — run history for success rate
 *   learningMemoryEngine.getSummary()      — pattern trends
 *   learningMemoryEngine.getRecommendations() — learned improvements
 *   learningMemoryEngine.detectRepeated()  — recurring incident check
 *
 * No new architecture. No agent army. No AI calls.
 *
 * Evaluation pipeline (per tick):
 *   1. healthEvaluation      — current health + trend (improving/stable/degrading)
 *   2. incidentAnalysis      — open incidents, recurring patterns, unresolved HIGH+
 *   3. improvementDetection  — gaps between recurring problems and fix success rate
 *   4. preventiveMaintenance — rules that fire before problems escalate
 *   5. debtTracking          — register and score technical debt items
 *   6. maturityScoring       — 0-100 score across 5 dimensions
 *   7. reportGeneration      — assemble LifecycleReport + persist
 *
 * Maturity dimensions (20 pts each = 100 total):
 *   reliability    — % of incidents resolved successfully (from healing runs)
 *   recoverability — avg time to resolution + rollback rate
 *   observability  — telemetry coverage: deploy, API, page events all present
 *   debt_control   — ratio of resolved vs open debt items
 *   learning       — LME ingest count + repeat alert reduction trend
 *
 * Technical debt item types:
 *   recurring_incident  — same incident pattern ≥ 3 times with < 70% resolution
 *   unresolved_incident — HIGH/CRITICAL incident open > 60 minutes
 *   failed_fix          — fix plan with rolled-back outcome, no successful retry
 *   low_maturity        — any maturity dimension < 30
 *   high_error_rate     — API errorRate consistently > 10%
 *
 * Storage:
 *   data/lifecycle-reports.json   — ring buffer, max 50, newest-first, atomic write
 *   data/lifecycle-debt.json      — debt items: open + resolved, max 200, atomic write
 *
 * LifecycleTick shape (lightweight, not persisted):
 *   { evaluatedAt, health, incidents, improvements, preventive, debt, maturity }
 *
 * LifecycleReport shape (persisted):
 *   {
 *     reportId, blueprintId, productName, generatedAt,
 *     health: { overall, trend, errorRate, deploySuccessRate, p95Ms },
 *     incidents: { open, openCritical, openHigh, recurring, unresolved },
 *     improvements: [{ type, title, detail, priority }],
 *     preventive:   [{ rule, title, detail, urgency }],
 *     debt: { open, resolved, score },
 *     maturity: { total, dimensions: { reliability, recoverability, observability, debt_control, learning } },
 *     recommendations: [{ type, message, confidence, source }],
 *     summary: string,   — one-paragraph human-readable summary
 *   }
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const DATA_DIR      = path.join(__dirname, "../../data");
const REPORTS_PATH  = path.join(DATA_DIR, "lifecycle-reports.json");
const DEBT_PATH     = path.join(DATA_DIR, "lifecycle-debt.json");
const MAX_REPORTS   = 50;
const MAX_DEBT      = 200;

// ── Lazy accessors ────────────────────────────────────────────────
function _tel()  { try { return require("./telemetryEngine.cjs");      } catch { return null; } }
function _inc()  { try { return require("./incidentEngine.cjs");       } catch { return null; } }
function _rca()  { try { return require("./rootCauseAnalyzer.cjs");    } catch { return null; } }
function _afp()  { try { return require("./autoFixPlanner.cjs");       } catch { return null; } }
function _shp()  { try { return require("./selfHealingPipeline.cjs");  } catch { return null; } }
function _lme()  { try { return require("./learningMemoryEngine.cjs"); } catch { return null; } }

// ── Storage ───────────────────────────────────────────────────────
function _loadReports() {
    try { const d = JSON.parse(fs.readFileSync(REPORTS_PATH, "utf8")); return Array.isArray(d) ? d : []; }
    catch { return []; }
}
function _saveReports(reports) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = REPORTS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(reports.slice(0, MAX_REPORTS), null, 2));
    fs.renameSync(tmp, REPORTS_PATH);
}
function _loadDebt() {
    try { const d = JSON.parse(fs.readFileSync(DEBT_PATH, "utf8")); return Array.isArray(d) ? d : []; }
    catch { return []; }
}
function _saveDebt(items) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DEBT_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(items.slice(0, MAX_DEBT), null, 2));
    fs.renameSync(tmp, DEBT_PATH);
}

let _idCtr = Date.now();
function _newId(prefix) { return `${prefix}_${++_idCtr}`; }

// ─────────────────────────────────────────────────────────────────
// STEP 1 — Health evaluation
// ─────────────────────────────────────────────────────────────────

function _evalHealth(blueprintId, windowMins) {
    const tel     = _tel();
    if (!tel) return { overall: "unknown", trend: "unknown", errorRate: null, deploySuccessRate: null, p95Ms: null, eventCount: 0 };

    const summary = tel.getHealthSummary({ windowMins });
    const metrics = tel.getMetrics({ windowMins, blueprintId });

    // Compute deploy success rate
    const deploys       = summary.deploy;
    const deployTotal   = (deploys.ok || 0) + (deploys.failed || 0);
    const deploySucc    = deployTotal > 0 ? Math.round((deploys.ok / deployTotal) * 100) : null;

    // Trend: compare last 15 min vs 30 min error rate
    const shortSum = tel.getHealthSummary({ windowMins: 15 });
    const longSum  = tel.getHealthSummary({ windowMins: 60 });
    let trend = "stable";
    if (shortSum.api.errorRate < longSum.api.errorRate - 5) trend = "improving";
    if (shortSum.api.errorRate > longSum.api.errorRate + 5) trend = "degrading";

    return {
        overall:          summary.overall,         // "healthy"|"degraded"|"critical"
        trend,                                     // "improving"|"stable"|"degrading"
        errorRate:        summary.api.errorRate,
        deploySuccessRate: deploySucc,
        p95Ms:            summary.api.p95Ms,
        eventCount:       summary.eventCount,
        windowMins,
    };
}

// ─────────────────────────────────────────────────────────────────
// STEP 2 — Incident analysis
// ─────────────────────────────────────────────────────────────────

const UNRESOLVED_THRESHOLD_MINS = 60;

function _evalIncidents(blueprintId) {
    const incMod = _inc();
    if (!incMod) return { open: 0, openCritical: 0, openHigh: 0, recurring: [], unresolved: [] };

    const summary  = incMod.getIncidentSummary();
    const openList = incMod.listIncidents({ limit: 100 })
        .filter(i => i.status === "open" || i.status === "escalated")
        .filter(i => !blueprintId || i.blueprintId === blueprintId || !i.blueprintId);

    // Unresolved HIGH/CRITICAL older than threshold
    const now          = Date.now();
    const unresolved   = openList
        .filter(i => (i.severity === "HIGH" || i.severity === "CRITICAL"))
        .filter(i => (now - new Date(i.openedAt).getTime()) > UNRESOLVED_THRESHOLD_MINS * 60_000)
        .map(i => ({
            incidentId: i.incidentId,
            ruleId:     i.ruleId,
            severity:   i.severity,
            title:      i.title,
            openMins:   Math.round((now - new Date(i.openedAt).getTime()) / 60_000),
        }));

    // Recurring patterns from LME
    const recurring = [];
    const lmeMod    = _lme();
    if (lmeMod) {
        for (const incident of openList) {
            const check = lmeMod.detectRepeated({ ruleId: incident.ruleId });
            if (check.isRepeat) {
                recurring.push({
                    ruleId:     incident.ruleId,
                    count:      check.count,
                    incidentId: incident.incidentId,
                    title:      incident.title,
                    bestFix:    check.pattern?.bestFix?.approach || null,
                });
            }
        }
    }

    return {
        open:         openList.length,
        openCritical: summary.openCritical,
        openHigh:     summary.openHigh,
        unresolved,
        recurring,
    };
}

// ─────────────────────────────────────────────────────────────────
// STEP 3 — Improvement opportunity detection
// ─────────────────────────────────────────────────────────────────

function _detectImprovements(healthEval, incidentEval) {
    const improvements = [];
    const lmeMod       = _lme();

    // High error rate with no fix plan in progress
    if (healthEval.errorRate > 10) {
        const afpMod     = _afp();
        const activePlans = afpMod
            ? afpMod.listPlans({ status: "approved" }).length + afpMod.listPlans({ status: "executing" }).length
            : 0;
        if (activePlans === 0) {
            improvements.push({
                type:     "error_rate_unaddressed",
                title:    `API error rate is ${healthEval.errorRate}% with no active fix plan`,
                detail:   "Run incident detection, then generate and execute a fix plan.",
                priority: healthEval.errorRate > 25 ? "HIGH" : "MEDIUM",
            });
        }
    }

    // Recurring incidents not being fixed
    for (const rec of incidentEval.recurring) {
        improvements.push({
            type:     "recurring_unresolved",
            title:    `"${rec.ruleId}" recurs (${rec.count}x) — no durable fix yet`,
            detail:   rec.bestFix
                ? `Best known fix: "${rec.bestFix}" — apply it.`
                : "No successful fix in memory — investigate root cause.",
            priority: "HIGH",
        });
    }

    // Unresolved HIGH/CRITICAL incidents
    for (const u of incidentEval.unresolved) {
        improvements.push({
            type:     "unresolved_incident",
            title:    `[${u.severity}] "${u.title}" open ${u.openMins}m`,
            detail:   `Incident ${u.incidentId} has been open for ${u.openMins} minutes without resolution.`,
            priority: u.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
        });
    }

    // Low deploy success rate
    if (healthEval.deploySuccessRate !== null && healthEval.deploySuccessRate < 70) {
        improvements.push({
            type:     "low_deploy_success",
            title:    `Deploy success rate is ${healthEval.deploySuccessRate}%`,
            detail:   "More than 30% of deploys are failing. Investigate deploy pipeline health.",
            priority: "HIGH",
        });
    }

    // Degrading trend
    if (healthEval.trend === "degrading") {
        improvements.push({
            type:     "health_degrading",
            title:    "Product health is trending downward",
            detail:   "Short-window (15m) error rate is higher than 60m average. Recent change may have introduced a regression.",
            priority: "MEDIUM",
        });
    }

    // Slow API with no optimization plan
    if (healthEval.p95Ms && healthEval.p95Ms > 3000) {
        improvements.push({
            type:     "latency_opportunity",
            title:    `p95 latency is ${healthEval.p95Ms}ms — optimization opportunity`,
            detail:   "Consider query profiling, caching, or index additions for high-traffic routes.",
            priority: "LOW",
        });
    }

    return improvements.sort((a, b) => {
        const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return (rank[b.priority] || 0) - (rank[a.priority] || 0);
    });
}

// ─────────────────────────────────────────────────────────────────
// STEP 4 — Preventive maintenance rules
// ─────────────────────────────────────────────────────────────────

const PREVENTIVE_RULES = [
    {
        id:   "no_recent_deploy_check",
        evalFn({ healthEval, incidentEval }) {
            if (healthEval.overall === "critical" && healthEval.deploySuccessRate === null) {
                return {
                    rule:    "no_recent_deploy_check",
                    title:   "No deploy events in the current window — health cannot be verified post-deploy",
                    detail:  "Ensure telemetry is recording deploy events: call recordDeploy() after each deployment.",
                    urgency: "MEDIUM",
                };
            }
            return null;
        },
    },
    {
        id:   "high_open_incidents",
        evalFn({ incidentEval }) {
            if (incidentEval.open >= 3) {
                return {
                    rule:    "high_open_incidents",
                    title:   `${incidentEval.open} incidents open simultaneously — incident backlog building`,
                    detail:  "Acknowledge and triage incidents before new ones pile up. Consider running a bulk detect+analyze cycle.",
                    urgency: incidentEval.openCritical > 0 ? "HIGH" : "MEDIUM",
                };
            }
            return null;
        },
    },
    {
        id:   "fix_plan_stale",
        evalFn({ plans }) {
            const stale = plans.filter(p => {
                const ageMins = (Date.now() - new Date(p.createdAt).getTime()) / 60_000;
                return p.status === "draft" && ageMins > 120;
            });
            if (stale.length > 0) {
                return {
                    rule:    "fix_plan_stale",
                    title:   `${stale.length} fix plan(s) in draft for > 2 hours`,
                    detail:  `Plans not executed: ${stale.map(p => p.planId).slice(0, 3).join(", ")}. Execute or abandon stale plans.`,
                    urgency: "MEDIUM",
                };
            }
            return null;
        },
    },
    {
        id:   "repeated_rollback",
        evalFn({ runs }) {
            const recent     = runs.slice(0, 10);
            const rollbacks  = recent.filter(r => r.outcome === "rolled-back").length;
            if (recent.length >= 3 && rollbacks / recent.length >= 0.5) {
                return {
                    rule:    "repeated_rollback",
                    title:   `${rollbacks}/${recent.length} recent healing runs rolled back`,
                    detail:  "Rollback rate >= 50%. Fixes are not holding. Review the fix strategy and consider a different approach.",
                    urgency: "HIGH",
                };
            }
            return null;
        },
    },
    {
        id:   "no_learning_data",
        evalFn({ lmeSummary }) {
            if (!lmeSummary || lmeSummary.totalIngested === 0) {
                return {
                    rule:    "no_learning_data",
                    title:   "Learning memory is empty — Jarvis has no operational history yet",
                    detail:  "Complete at least one full healing cycle (incident → RCA → fix → heal) to populate learning memory.",
                    urgency: "LOW",
                };
            }
            return null;
        },
    },
    {
        id:   "critical_no_rca",
        evalFn({ incidentEval, rcaReports }) {
            const criticalNoRca = incidentEval.unresolved
                .filter(u => u.severity === "CRITICAL")
                .filter(u => !rcaReports.some(r => r.incidentId === u.incidentId));
            if (criticalNoRca.length > 0) {
                return {
                    rule:    "critical_no_rca",
                    title:   `${criticalNoRca.length} CRITICAL incident(s) without RCA`,
                    detail:  `Run POST /incidents/${criticalNoRca[0].incidentId}/analyze immediately.`,
                    urgency: "CRITICAL",
                };
            }
            return null;
        },
    },
];

function _evalPreventive(ctx) {
    return PREVENTIVE_RULES
        .map(rule => { try { return rule.evalFn(ctx); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => {
            const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
            return (rank[b.urgency] || 0) - (rank[a.urgency] || 0);
        });
}

// ─────────────────────────────────────────────────────────────────
// STEP 5 — Technical debt tracking
// ─────────────────────────────────────────────────────────────────

const DEBT_TYPES = {
    recurring_incident:  { base: 20, label: "Recurring Incident" },
    unresolved_incident: { base: 15, label: "Unresolved Incident" },
    failed_fix:          { base: 10, label: "Failed Fix Attempt" },
    low_maturity:        { base: 5,  label: "Low Maturity Dimension" },
    high_error_rate:     { base: 8,  label: "Persistent High Error Rate" },
};

function _trackDebt(improvements, incidentEval, healthEval, blueprintId) {
    const existing = _loadDebt();
    const now      = new Date().toISOString();
    const seen     = new Set(existing.filter(d => d.status === "open").map(d => d.debtKey));
    const newItems = [];

    function _register(type, key, title, detail, severity) {
        if (seen.has(key)) {
            // Update existing open item
            const item = existing.find(d => d.debtKey === key && d.status === "open");
            if (item) { item.lastSeenAt = now; item.occurrences = (item.occurrences || 1) + 1; }
            return;
        }
        newItems.push({
            debtId:      _newId("debt"),
            debtKey:     key,
            type,
            title,
            detail,
            severity:    severity || "MEDIUM",
            status:      "open",
            blueprintId: blueprintId || null,
            openedAt:    now,
            lastSeenAt:  now,
            resolvedAt:  null,
            occurrences: 1,
            score:       DEBT_TYPES[type]?.base || 5,
        });
    }

    // Register debt from recurring incidents
    for (const rec of incidentEval.recurring) {
        _register(
            "recurring_incident",
            `recurring:${rec.ruleId}`,
            `Recurring: ${rec.ruleId} (${rec.count}x)`,
            rec.bestFix ? `Known fix: ${rec.bestFix}` : "No successful fix yet",
            "HIGH",
        );
    }

    // Register debt from unresolved HIGH/CRITICAL
    for (const u of incidentEval.unresolved) {
        _register(
            "unresolved_incident",
            `unresolved:${u.incidentId}`,
            `Unresolved ${u.severity}: ${u.title}`,
            `Open for ${u.openMins}m`,
            u.severity,
        );
    }

    // Register high error rate debt
    if (healthEval.errorRate > 10) {
        _register(
            "high_error_rate",
            `errorrate:${blueprintId || "global"}`,
            `Persistent error rate ${healthEval.errorRate}%`,
            "API error rate above 10% threshold",
            healthEval.errorRate > 25 ? "HIGH" : "MEDIUM",
        );
    }

    // Auto-resolve debt items that no longer apply
    for (const item of existing.filter(d => d.status === "open")) {
        const stillApplies = (
            incidentEval.recurring.some(r => item.debtKey === `recurring:${r.ruleId}`) ||
            incidentEval.unresolved.some(u => item.debtKey === `unresolved:${u.incidentId}`) ||
            (item.type === "high_error_rate" && healthEval.errorRate > 10)
        );
        if (!stillApplies && item.type !== "low_maturity" && item.type !== "failed_fix") {
            item.status     = "auto-resolved";
            item.resolvedAt = now;
        }
    }

    const all = [...newItems, ...existing].slice(0, MAX_DEBT);
    _saveDebt(all);

    const open     = all.filter(d => d.status === "open").length;
    const resolved = all.filter(d => d.status !== "open").length;
    const score    = all.filter(d => d.status === "open").reduce((s, d) => s + (d.score || 0), 0);

    return { open, resolved, score, newItems: newItems.length };
}

// ─────────────────────────────────────────────────────────────────
// STEP 6 — Maturity scoring (0–100)
// ─────────────────────────────────────────────────────────────────

function _scoreMaturity(healthEval, incidentEval, debtSummary, lmeSummary, runs) {
    // reliability: % of healing runs that succeeded (max 20)
    let reliability = 10;  // baseline when no data
    if (runs.length > 0) {
        const succRate = runs.filter(r => r.outcome === "success").length / runs.length;
        reliability    = Math.round(succRate * 20);
    }

    // recoverability: penalise high unresolved count + rollback rate (max 20)
    let recoverability = 20;
    recoverability    -= Math.min(incidentEval.unresolved.length * 4, 12);
    if (runs.length > 0) {
        const rollbackRate = runs.filter(r => r.outcome === "rolled-back").length / runs.length;
        recoverability    -= Math.round(rollbackRate * 8);
    }
    recoverability = Math.max(recoverability, 0);

    // observability: telemetry coverage (max 20)
    let observability = 0;
    if (healthEval.eventCount > 0)            observability += 8;
    if (healthEval.errorRate !== null)        observability += 6;
    if (healthEval.deploySuccessRate !== null) observability += 6;

    // debt_control: lower open debt = better (max 20)
    let debt_control = 20;
    debt_control    -= Math.min(debtSummary.open * 3, 18);
    debt_control     = Math.max(debt_control, 2);

    // learning: LME ingest count (max 20)
    let learning = 0;
    if (lmeSummary) {
        const ingested = lmeSummary.totalIngested || 0;
        learning       = Math.min(ingested * 2, 12);       // 2 pts per ingest, cap 12
        const alerts   = lmeSummary.repeatAlerts || 0;
        learning      += alerts > 0 ? 8 : 4;               // has alerts → learned from repeats
        learning       = Math.min(learning, 20);
    }

    const total = reliability + recoverability + observability + debt_control + learning;

    return {
        total: Math.min(total, 100),
        dimensions: {
            reliability,
            recoverability,
            observability,
            debt_control,
            learning,
        },
    };
}

// ─────────────────────────────────────────────────────────────────
// STEP 7 — Report generation
// ─────────────────────────────────────────────────────────────────

function _buildSummary(healthEval, incidentEval, improvements, preventive, maturity, blueprintId) {
    const parts = [];
    const name  = blueprintId || "product";

    if (healthEval.overall === "healthy" && improvements.length === 0) {
        parts.push(`${name} is healthy with no open incidents or improvement opportunities.`);
    } else {
        parts.push(`${name} health is ${healthEval.overall} (trend: ${healthEval.trend}).`);
    }

    if (incidentEval.open > 0) {
        parts.push(`${incidentEval.open} open incident(s): ${incidentEval.openCritical} CRITICAL, ${incidentEval.openHigh} HIGH.`);
    }
    if (incidentEval.recurring.length > 0) {
        parts.push(`${incidentEval.recurring.length} recurring pattern(s) detected — these issues keep coming back.`);
    }
    if (improvements.length > 0) {
        const top = improvements[0];
        parts.push(`Top improvement: [${top.priority}] ${top.title}`);
    }
    if (preventive.length > 0) {
        const urgent = preventive.find(p => p.urgency === "CRITICAL" || p.urgency === "HIGH");
        if (urgent) parts.push(`Preventive alert: ${urgent.title}`);
    }
    parts.push(`Maturity score: ${maturity.total}/100.`);

    return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────

/**
 * Run one full lifecycle evaluation.
 *
 * @param {object} opts
 * @param {string}  [opts.blueprintId]   — scope to one product (optional)
 * @param {string}  [opts.productName]
 * @param {number}  [opts.windowMins=60] — telemetry lookback window
 * @param {boolean} [opts.persist=true]  — whether to store the resulting report
 * @returns {LifecycleReport}
 */
function evaluate({ blueprintId, productName, windowMins = 60, persist = true } = {}) {
    const now = new Date().toISOString();
    logger.info(`[Lifecycle] evaluate — blueprintId=${blueprintId || "global"} window=${windowMins}m`);

    // Load data from all engines
    const shpMod    = _shp();
    const afpMod    = _afp();
    const rcaMod    = _rca();
    const lmeMod    = _lme();

    const runs       = shpMod ? shpMod.listHealingRuns({ limit: 20 })       : [];
    const plans      = afpMod ? afpMod.listPlans({ limit: 50 })             : [];
    const rcaReports = rcaMod ? rcaMod.listReports({ limit: 20 })           : [];
    const lmeSummary = lmeMod ? lmeMod.getSummary()                         : null;

    // Pipeline
    const healthEval   = _evalHealth(blueprintId, windowMins);
    const incidentEval = _evalIncidents(blueprintId);
    const improvements = _detectImprovements(healthEval, incidentEval);

    const preventiveCtx = { healthEval, incidentEval, plans, runs, rcaReports, lmeSummary };
    const preventive    = _evalPreventive(preventiveCtx);

    const debtSummary   = _trackDebt(improvements, incidentEval, healthEval, blueprintId);
    const maturity      = _scoreMaturity(healthEval, incidentEval, debtSummary, lmeSummary, runs);

    // Learned recommendations from LME
    const recommendations = [];
    if (lmeMod) {
        for (const inc of (incidentEval.recurring || [])) {
            const recs = lmeMod.getRecommendations({ ruleId: inc.ruleId });
            recommendations.push(...recs.slice(0, 2));
        }
    }

    const report = {
        reportId:     _newId("lc"),
        blueprintId:  blueprintId || null,
        productName:  productName || null,
        generatedAt:  now,
        windowMins,
        health:       healthEval,
        incidents:    incidentEval,
        improvements,
        preventive,
        debt:         debtSummary,
        maturity,
        recommendations: recommendations.slice(0, 8),
        summary:      _buildSummary(healthEval, incidentEval, improvements, preventive, maturity, blueprintId || productName || "product"),
    };

    if (persist) {
        const all = _loadReports();
        all.unshift(report);
        _saveReports(all);
    }

    logger.info(`[Lifecycle] ${report.reportId} — health=${healthEval.overall} maturity=${maturity.total} improvements=${improvements.length} debt=${debtSummary.open}`);
    return report;
}

// ── Scheduler ─────────────────────────────────────────────────────
let _schedulerHandle = null;

/**
 * Schedule recurring evaluation.
 * @param {object} opts
 * @param {number}  [opts.intervalMins=60]   — evaluation frequency
 * @param {string}  [opts.blueprintId]
 * @param {number}  [opts.windowMins=60]
 */
function scheduleEvaluation({ intervalMins = 60, blueprintId, windowMins = 60 } = {}) {
    if (_schedulerHandle) {
        clearInterval(_schedulerHandle);
        _schedulerHandle = null;
    }
    const ms = intervalMins * 60_000;
    _schedulerHandle = setInterval(() => {
        try { evaluate({ blueprintId, windowMins }); }
        catch (e) { logger.info(`[Lifecycle] scheduled eval error: ${e.message}`); }
    }, ms);
    logger.info(`[Lifecycle] scheduler started — interval=${intervalMins}m`);
    return { ok: true, intervalMins };
}

/** Stop the recurring scheduler. */
function stopScheduler() {
    if (_schedulerHandle) { clearInterval(_schedulerHandle); _schedulerHandle = null; }
    logger.info("[Lifecycle] scheduler stopped");
    return { ok: true };
}

// ── Reader API ────────────────────────────────────────────────────

function getLastTick() {
    const reports = _loadReports();
    return reports[0] || null;
}

function listReports({ blueprintId, limit = 10 } = {}) {
    let r = _loadReports();
    if (blueprintId) r = r.filter(x => x.blueprintId === blueprintId);
    return r.slice(0, limit);
}

function getReport(reportId) {
    return _loadReports().find(r => r.reportId === reportId) || null;
}

function getMaturity(blueprintId) {
    const reports = _loadReports();
    const r = blueprintId ? reports.find(x => x.blueprintId === blueprintId) : reports[0];
    return r ? { ...r.maturity, reportId: r.reportId, generatedAt: r.generatedAt } : null;
}

function getDebtItems({ blueprintId, status, type, limit = 50 } = {}) {
    let items = _loadDebt();
    if (blueprintId) items = items.filter(d => d.blueprintId === blueprintId || !d.blueprintId);
    if (status)      items = items.filter(d => d.status === status);
    if (type)        items = items.filter(d => d.type   === type);
    return items.slice(0, limit);
}

module.exports = {
    evaluate,
    scheduleEvaluation,
    stopScheduler,
    getLastTick,
    listReports,
    getReport,
    getMaturity,
    getDebtItems,
};
