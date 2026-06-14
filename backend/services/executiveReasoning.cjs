"use strict";
/**
 * ExecutiveReasoning — Track F, Priority F1: Strategic layer above all agents.
 *
 * Prioritizes missions, compares execution plans, estimates cost/risk/time,
 * and chooses optimal paths using a weighted scoring matrix.  All logic is
 * rule-based + pattern matching against on-disk data — no external API calls.
 *
 * Wraps reasoningEngine.cjs for scoreConfidence() and analyzeRisk() —
 * no logic is duplicated from that module.
 *
 * Public API:
 *   prioritizeMissions(missions)          → ranked missions with scores + justification
 *   compareExecutionPlans(plans)          → { winner, ranking[], tradeoffs{} }
 *   estimateMissionCost(mission)          → { engineeringHours, deploymentRisk,
 *                                             rollbackProbability, successProbability,
 *                                             recommendation }
 *   chooseOptimalPath(options)            → { chosen, score, rationale, warnings[] }
 *   getExecutiveDecisions(opts)           → filtered list from executive-decisions.json
 *   getDecision(decisionId)              → single decision by id | null
 *   assessStrategicRisk(context)          → { riskLevel, factors[], mitigations[],
 *                                             shouldProceed }
 *
 * Data read:
 *   data/recommendations.json
 *   data/reasoned-recommendations.json
 *   data/lessons.json
 *   data/healing-history.json
 *   data/task-graphs.json
 *   data/autonomous-cycles.json
 *
 * Data written:
 *   data/executive-decisions.json
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// ── Import only what we need from reasoningEngine; never duplicate ──────────
const { scoreConfidence, analyzeRisk } = require("./reasoningEngine.cjs");

// ── File paths ──────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, "../../data");
const RECS_FILE      = path.join(DATA_DIR, "recommendations.json");
const REASONED_FILE  = path.join(DATA_DIR, "reasoned-recommendations.json");
const LESSONS_FILE   = path.join(DATA_DIR, "lessons.json");
const HEAL_FILE      = path.join(DATA_DIR, "healing-history.json");
const GRAPHS_FILE    = path.join(DATA_DIR, "task-graphs.json");
const CYCLES_FILE    = path.join(DATA_DIR, "autonomous-cycles.json");
const DECISIONS_FILE = path.join(DATA_DIR, "executive-decisions.json");

// ── I/O helpers ─────────────────────────────────────────────────────────────
function _rj(file, fb) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; }
}
function _wj(file, data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

// ── Data loaders (re-read each call to pick up live changes) ────────────────
function _loadRecs()     { return _rj(RECS_FILE,      []); }
function _loadReasoned() { return _rj(REASONED_FILE,  []); }
function _loadLessons()  { return _rj(LESSONS_FILE,   []); }
function _loadHeal()     { return _rj(HEAL_FILE,       []); }
function _loadGraphs()   { return _rj(GRAPHS_FILE,    []); }
function _loadCycles()   { return _rj(CYCLES_FILE,    []); }
function _loadDecisions(){ return _rj(DECISIONS_FILE, []); }

// ── ID generator ────────────────────────────────────────────────────────────
function _newId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Persist a decision record ────────────────────────────────────────────────
function _persistDecision(type, input, output, confidence) {
    try {
        const decisions = _loadDecisions();
        const record = {
            id:         _newId("exec"),
            type,
            input,
            output,
            timestamp:  new Date().toISOString(),
            confidence,
        };
        decisions.push(record);
        _wj(DECISIONS_FILE, decisions);
        logger.info(`[ExecutiveReasoning] persisted decision ${record.id} (type=${type})`);
        return record.id;
    } catch (err) {
        logger.warn(`[ExecutiveReasoning] failed to persist decision: ${err.message}`);
        return null;
    }
}

// ── Effort → base engineering hours ─────────────────────────────────────────
const EFFORT_HOURS = { low: 4, medium: 16, high: 40, critical: 80 };

function _effortHours(effort) {
    return EFFORT_HOURS[(effort || "medium").toLowerCase()] || 16;
}

// ── Scoring weights (must sum to 1.0) ───────────────────────────────────────
const WEIGHTS = { impact: 0.35, effortInverse: 0.25, riskInverse: 0.20, deadlineUrgency: 0.20 };

// ── Normalise a 0-100 priority/effort/risk number from mixed input ───────────
// Accepts number 0-100, string "low|medium|high|critical", or undefined.
function _norm(value, defaultVal = 50) {
    if (value === undefined || value === null) return defaultVal;
    if (typeof value === "number") return Math.max(0, Math.min(100, value));
    switch ((value + "").toLowerCase()) {
        case "critical": return 90;
        case "high":     return 70;
        case "medium":   return 50;
        case "low":      return 25;
        case "info":     return 10;
        default:
            const n = parseFloat(value);
            return isNaN(n) ? defaultVal : Math.max(0, Math.min(100, n));
    }
}

// ── Deadline urgency score (0-100) ─────────────────────────────────────────
// Returns 100 if deadline is now or past; 0 if > 30 days away; linear between.
function _deadlineUrgency(deadline) {
    if (!deadline) return 30; // default moderate urgency when unspecified
    const msRemaining = new Date(deadline).getTime() - Date.now();
    if (msRemaining <= 0)          return 100;
    const days = msRemaining / (24 * 3600 * 1000);
    if (days >= 30)                return 0;
    return Math.round(100 - (days / 30) * 100);
}

// ── Mission score (weighted matrix) ─────────────────────────────────────────
function _scoreMission(mission) {
    const impact         = _norm(mission.impact,   50);
    const effort         = _norm(mission.effort,   50);
    const risk           = _norm(mission.risk,     30);
    const deadlineScore  = _deadlineUrgency(mission.deadline);

    const effortInverse  = 100 - effort;
    const riskInverse    = 100 - risk;

    return Math.round(
        impact        * WEIGHTS.impact        +
        effortInverse * WEIGHTS.effortInverse +
        riskInverse   * WEIGHTS.riskInverse   +
        deadlineScore * WEIGHTS.deadlineUrgency
    );
}

// ── Justification text for a scored mission ─────────────────────────────────
function _justifyMission(mission, score) {
    const parts = [];

    const impact        = _norm(mission.impact,   50);
    const effort        = _norm(mission.effort,   50);
    const risk          = _norm(mission.risk,     30);
    const deadlineScore = _deadlineUrgency(mission.deadline);

    parts.push(`Impact score ${impact}/100 contributes ${Math.round(impact * WEIGHTS.impact)} pts.`);
    parts.push(`Effort inverse ${100 - effort}/100 contributes ${Math.round((100 - effort) * WEIGHTS.effortInverse)} pts (lower effort = higher priority).`);
    parts.push(`Risk inverse ${100 - risk}/100 contributes ${Math.round((100 - risk) * WEIGHTS.riskInverse)} pts (lower risk = higher priority).`);
    parts.push(`Deadline urgency ${deadlineScore}/100 contributes ${Math.round(deadlineScore * WEIGHTS.deadlineUrgency)} pts.`);

    if (score >= 75) {
        parts.push("Overall: HIGH PRIORITY — recommend executing immediately.");
    } else if (score >= 50) {
        parts.push("Overall: MEDIUM PRIORITY — schedule within current sprint.");
    } else if (score >= 25) {
        parts.push("Overall: LOW PRIORITY — backlog candidate; revisit next cycle.");
    } else {
        parts.push("Overall: DEPRIORITISED — minimal urgency, high cost/risk ratio.");
    }

    return parts.join(" ");
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. prioritizeMissions
// ══════════════════════════════════════════════════════════════════════════════
/**
 * prioritizeMissions(missions)
 *
 * @param {Array<{id, objective, priority, effort, impact, risk, deadline}>} missions
 * @returns {{ ranked: Array, executionOrder: string[], totalMissions: number }}
 */
function prioritizeMissions(missions = []) {
    if (!Array.isArray(missions) || missions.length === 0) {
        logger.warn("[ExecutiveReasoning] prioritizeMissions: empty or invalid input");
        return { ranked: [], executionOrder: [], totalMissions: 0 };
    }

    const ranked = missions.map((m, idx) => {
        const score         = _scoreMission(m);
        const justification = _justifyMission(m, score);
        return {
            id:            m.id || `mission_${idx}`,
            objective:     m.objective || "",
            score,
            justification,
            breakdown: {
                impact:          _norm(m.impact,   50),
                effortInverse:   100 - _norm(m.effort, 50),
                riskInverse:     100 - _norm(m.risk,   30),
                deadlineUrgency: _deadlineUrgency(m.deadline),
            },
            originalPriority: m.priority,
            effort:           m.effort,
            impact:           m.impact,
            risk:             m.risk,
            deadline:         m.deadline || null,
        };
    }).sort((a, b) => b.score - a.score);

    const executionOrder = ranked.map(r => r.id);

    const confidence = scoreConfidence({
        lessonCount:           0,
        recurrenceRate:        0,
        historicalSuccessRate: 0.7,
        dataFreshnessMs:       0,
        severity:              "medium",
    });

    _persistDecision(
        "prioritizeMissions",
        { missionCount: missions.length },
        { ranked: ranked.map(r => ({ id: r.id, score: r.score })), executionOrder },
        confidence
    );

    logger.info(`[ExecutiveReasoning] prioritizeMissions: ranked ${ranked.length} missions`);
    return { ranked, executionOrder, totalMissions: ranked.length };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. compareExecutionPlans
// ══════════════════════════════════════════════════════════════════════════════
/**
 * compareExecutionPlans(plans)
 *
 * @param {Array<{id, name, steps[], estimatedHours, deploymentRisk,
 *                rollbackProbability, costEstimate}>} plans
 * @returns {{ winner: planId, ranking: Array, tradeoffs: Object }}
 */
function compareExecutionPlans(plans = []) {
    if (!Array.isArray(plans) || plans.length === 0) {
        logger.warn("[ExecutiveReasoning] compareExecutionPlans: empty or invalid input");
        return { winner: null, ranking: [], tradeoffs: {} };
    }

    // Score each plan: efficiency (time/cost) vs safety (risk/rollback)
    // efficiency = 100 - normalised(estimatedHours relative to set max) → 30%
    // deploymentSafety = 100 - deploymentRisk → 35%
    // rollbackSafety   = 100 - rollbackProbability → 20%
    // costEfficiency   = 100 - normalised(costEstimate relative to set max) → 15%
    const maxHours = Math.max(...plans.map(p => p.estimatedHours || 0), 1);
    const maxCost  = Math.max(...plans.map(p => p.costEstimate  || 0), 1);

    const scored = plans.map((p, idx) => {
        const hoursNorm      = Math.round(((p.estimatedHours || 0) / maxHours) * 100);
        const costNorm       = Math.round(((p.costEstimate   || 0) / maxCost)  * 100);
        const deployRisk     = _norm(p.deploymentRisk,    30);
        const rollbackProb   = _norm(p.rollbackProbability, 20);

        const planScore = Math.round(
            (100 - hoursNorm)   * 0.30 +
            (100 - deployRisk)  * 0.35 +
            (100 - rollbackProb)* 0.20 +
            (100 - costNorm)    * 0.15
        );

        return {
            id:                  p.id || `plan_${idx}`,
            name:                p.name || `Plan ${idx + 1}`,
            score:               planScore,
            estimatedHours:      p.estimatedHours || 0,
            deploymentRisk:      deployRisk,
            rollbackProbability: rollbackProb,
            costEstimate:        p.costEstimate || 0,
            stepCount:           Array.isArray(p.steps) ? p.steps.length : 0,
        };
    }).sort((a, b) => b.score - a.score);

    const winner = scored[0].id;

    // Build tradeoffs map: for each plan, describe vs winner
    const tradeoffs = {};
    for (const p of scored) {
        if (p.id === winner) {
            tradeoffs[p.id] = "Winner — optimal balance of speed, safety, and cost.";
            continue;
        }
        const issues = [];
        if (p.estimatedHours > scored[0].estimatedHours * 1.2) {
            issues.push(`${Math.round(p.estimatedHours - scored[0].estimatedHours)}h longer than winner`);
        }
        if (p.deploymentRisk > scored[0].deploymentRisk + 10) {
            issues.push(`deployment risk ${p.deploymentRisk - scored[0].deploymentRisk} pts higher`);
        }
        if (p.rollbackProbability > scored[0].rollbackProbability + 10) {
            issues.push(`rollback probability ${p.rollbackProbability - scored[0].rollbackProbability} pts higher`);
        }
        if (p.costEstimate > scored[0].costEstimate * 1.2) {
            issues.push(`cost estimate ${Math.round((p.costEstimate / scored[0].costEstimate - 1) * 100)}% more expensive`);
        }
        tradeoffs[p.id] = issues.length > 0
            ? `Suboptimal: ${issues.join("; ")}.`
            : "Close to winner in all dimensions — acceptable alternative.";
    }

    const confidence = scoreConfidence({
        lessonCount:           0,
        recurrenceRate:        0,
        historicalSuccessRate: 0.75,
        dataFreshnessMs:       0,
        severity:              "medium",
    });

    _persistDecision(
        "compareExecutionPlans",
        { planCount: plans.length },
        { winner, ranking: scored.map(s => ({ id: s.id, score: s.score })), tradeoffs },
        confidence
    );

    logger.info(`[ExecutiveReasoning] compareExecutionPlans: winner=${winner} from ${plans.length} plans`);
    return { winner, ranking: scored, tradeoffs };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. estimateMissionCost
// ══════════════════════════════════════════════════════════════════════════════
/**
 * estimateMissionCost(mission)
 *
 * Uses healing-history failure rate for similar operations to factor a risk
 * multiplier onto base engineering hours.
 *
 * @param {{ id, objective, effort, risk, type, agentId, toolId }} mission
 * @returns {{ engineeringHours, deploymentRisk, rollbackProbability,
 *             successProbability, recommendation }}
 */
function estimateMissionCost(mission = {}) {
    const heal     = _loadHeal();
    const lessons  = _loadLessons();
    const graphs   = _loadGraphs();
    const cycles   = _loadCycles();

    // ── Base hours from effort ───────────────────────────────────────────────
    const baseHours = _effortHours(mission.effort);

    // ── Healing history: failure rate for similar target types ────────────────
    const missionText = (
        (mission.objective || "") + " " +
        (mission.type      || "") + " " +
        (mission.agentId   || "") + " " +
        (mission.toolId    || "")
    ).toLowerCase();

    const relevantHeals = heal.filter(h => {
        if (!h.targetType && !h.strategy) return false;
        const healText = ((h.strategy || "") + " " + (h.targetType || "") + " " + (h.targetId || "")).toLowerCase();
        // Match by agentId/toolId or broad keyword overlap
        if (mission.agentId && healText.includes(mission.agentId.toLowerCase())) return true;
        if (mission.toolId  && healText.includes(mission.toolId.toLowerCase()))  return true;
        // Fallback: any heal entry if no specific ids
        return (!mission.agentId && !mission.toolId);
    });

    const healFailures  = relevantHeals.filter(h => !h.success);
    const healSuccesses = relevantHeals.filter(h =>  h.success);
    const totalHeals    = relevantHeals.length;
    const failureRate   = totalHeals > 0 ? healFailures.length / totalHeals : 0.15; // default 15%

    // Risk multiplier: 1.0 at 0% failure, 2.5 at 100% failure
    const riskMultiplier = 1.0 + (failureRate * 1.5);
    const engineeringHours = Math.round(baseHours * riskMultiplier * 10) / 10;

    // ── Deployment risk (0-100) ──────────────────────────────────────────────
    // Base from input risk field, bumped by failure history
    let deploymentRisk = _norm(mission.risk, 30);
    deploymentRisk = Math.min(100, Math.round(deploymentRisk + failureRate * 30));

    // Task-graph complexity signal: count nodes in recent graphs for similar goals
    const similarGraphs = graphs.filter(g => {
        const goal = (g.goal || "").toLowerCase();
        return missionText.split(" ").some(w => w.length > 4 && goal.includes(w));
    });
    const avgNodeCount = similarGraphs.length > 0
        ? similarGraphs.reduce((s, g) => s + (Array.isArray(g.nodes) ? g.nodes.length : 0), 0) / similarGraphs.length
        : 0;
    if (avgNodeCount > 10) deploymentRisk = Math.min(100, deploymentRisk + 10);
    if (avgNodeCount > 20) deploymentRisk = Math.min(100, deploymentRisk + 10);

    // ── Rollback probability (0-100) ─────────────────────────────────────────
    // Based on recent cycle failure rate for similar goals
    const similarCycles = cycles.filter(c => {
        const goal = (c.goal || "").toLowerCase();
        return missionText.split(" ").some(w => w.length > 4 && goal.includes(w));
    });
    const failedCycles = similarCycles.filter(c => c.status === "failed");
    const rollbackProbability = similarCycles.length > 0
        ? Math.min(100, Math.round((failedCycles.length / similarCycles.length) * 100))
        : Math.min(100, Math.round(failureRate * 60)); // derive from heal rate if no cycle data

    // ── Success probability (0-100) ──────────────────────────────────────────
    // Boosted by lesson corroboration
    const lessonMatches = lessons.filter(l => {
        const lText = ((l.title || "") + " " + (l.detail || "") + " " + (l.sourcePattern || "")).toLowerCase();
        return missionText.split(" ").some(w => w.length > 4 && lText.includes(w));
    });

    const healSuccessRate = totalHeals > 0
        ? healSuccesses.length / totalHeals
        : 0.7;

    const successProbability = Math.min(100, Math.round(
        healSuccessRate * 60 +
        Math.min(30, lessonMatches.length * 5) +
        (deploymentRisk < 40 ? 10 : 0)
    ));

    // ── Recommendation text ───────────────────────────────────────────────────
    let recommendation;
    if (successProbability >= 75 && deploymentRisk < 40) {
        recommendation = "High success probability and low deployment risk — proceed with standard rollout.";
    } else if (successProbability >= 60 && deploymentRisk < 60) {
        recommendation = "Moderate confidence — proceed with staged rollout and monitor closely.";
    } else if (deploymentRisk >= 60) {
        recommendation = "High deployment risk detected — require peer review and a tested rollback plan before proceeding.";
    } else if (successProbability < 50) {
        recommendation = "Low success probability — investigate prior failures in healing-history before committing engineering time.";
    } else {
        recommendation = "Proceed with caution — schedule during low-traffic window and prepare rollback procedure.";
    }

    const confidence = scoreConfidence({
        lessonCount:           lessonMatches.length,
        recurrenceRate:        Math.min(1, totalHeals / 20),
        historicalSuccessRate: healSuccessRate,
        dataFreshnessMs:       0,
        severity:              mission.risk === "critical" ? "high" : "medium",
    });

    const output = {
        engineeringHours,
        deploymentRisk,
        rollbackProbability,
        successProbability,
        recommendation,
        confidence,
        supportingData: {
            baseHours,
            riskMultiplier,
            failureRate:    Math.round(failureRate * 100),
            totalHeals,
            lessonMatches:  lessonMatches.length,
            similarGraphs:  similarGraphs.length,
            similarCycles:  similarCycles.length,
        },
    };

    _persistDecision("estimateMissionCost", { missionId: mission.id, objective: mission.objective }, output, confidence);
    logger.info(`[ExecutiveReasoning] estimateMissionCost: mission=${mission.id} hours=${engineeringHours} risk=${deploymentRisk}`);
    return output;
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. chooseOptimalPath
// ══════════════════════════════════════════════════════════════════════════════
/**
 * chooseOptimalPath(options)
 *
 * Weighs cost vs impact vs risk using a scoring matrix across arbitrary options.
 *
 * @param {Array<{id, name, cost, impact, risk, effort, notes}>} options
 * @returns {{ chosen: optionId, score: number, rationale: string, warnings: string[] }}
 */
function chooseOptimalPath(options = []) {
    if (!Array.isArray(options) || options.length === 0) {
        logger.warn("[ExecutiveReasoning] chooseOptimalPath: empty or invalid options");
        return { chosen: null, score: 0, rationale: "No options provided.", warnings: [] };
    }

    // Normalise cost relative to option set
    const maxCost = Math.max(...options.map(o => _norm(o.cost, 50)), 1);

    const scored = options.map((o, idx) => {
        const impact       = _norm(o.impact,  50);
        const risk         = _norm(o.risk,    30);
        const effort       = _norm(o.effort,  50);
        const costRaw      = _norm(o.cost,    50);
        const costNorm     = Math.round((costRaw / maxCost) * 100);

        // Weighted: impact 35%, cost-inverse 25%, risk-inverse 20%, effort-inverse 20%
        const score = Math.round(
            impact          * 0.35 +
            (100 - costNorm)* 0.25 +
            (100 - risk)    * 0.20 +
            (100 - effort)  * 0.20
        );

        return {
            id:     o.id    || `option_${idx}`,
            name:   o.name  || `Option ${idx + 1}`,
            score,
            impact,
            risk,
            effort,
            costNorm,
            notes:  o.notes || "",
        };
    }).sort((a, b) => b.score - a.score);

    const best   = scored[0];
    const runner = scored[1] || null;

    // Warnings
    const warnings = [];
    if (best.risk >= 60) {
        warnings.push(`Chosen option "${best.name}" carries high risk (${best.risk}/100) — ensure rollback plan is ready.`);
    }
    if (best.effort >= 70) {
        warnings.push(`High effort level (${best.effort}/100) — validate resourcing before committing.`);
    }
    if (runner && best.score - runner.score < 5) {
        warnings.push(`Scores between "${best.name}" (${best.score}) and "${runner.name}" (${runner.score}) are very close — both options are viable.`);
    }
    if (scored.every(s => s.score < 35)) {
        warnings.push("All options score below 35 — consider re-scoping or deferring this decision until higher-impact paths are available.");
    }

    // Rationale
    const rationale = [
        `"${best.name}" selected with score ${best.score}/100.`,
        `Impact: ${best.impact}/100, risk: ${best.risk}/100, effort: ${best.effort}/100, cost index: ${best.costNorm}/100.`,
        runner
            ? `Runner-up "${runner.name}" scored ${runner.score} — ${best.score - runner.score < 5 ? "nearly equivalent, consider resource availability" : "clearly inferior overall"}.`
            : "Only one option evaluated.",
        best.notes ? `Additional context: ${best.notes}` : "",
    ].filter(Boolean).join(" ");

    const confidence = scoreConfidence({
        lessonCount:           0,
        recurrenceRate:        0,
        historicalSuccessRate: best.score / 100,
        dataFreshnessMs:       0,
        severity:              best.risk >= 60 ? "high" : "medium",
    });

    const output = { chosen: best.id, score: best.score, rationale, warnings, allScored: scored };
    _persistDecision("chooseOptimalPath", { optionCount: options.length }, output, confidence);
    logger.info(`[ExecutiveReasoning] chooseOptimalPath: chosen=${best.id} score=${best.score}`);
    return { chosen: best.id, score: best.score, rationale, warnings };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. getExecutiveDecisions
// ══════════════════════════════════════════════════════════════════════════════
/**
 * getExecutiveDecisions(opts)
 *
 * @param {{ limit?: number, type?: string, since?: string }} opts
 * @returns {{ decisions: Array, total: number }}
 */
function getExecutiveDecisions(opts = {}) {
    let decisions = _loadDecisions();

    // Filter by type
    if (opts.type) {
        decisions = decisions.filter(d => d.type === opts.type);
    }

    // Filter by since (ISO timestamp)
    if (opts.since) {
        const sinceMs = new Date(opts.since).getTime();
        if (!isNaN(sinceMs)) {
            decisions = decisions.filter(d => new Date(d.timestamp).getTime() >= sinceMs);
        }
    }

    // Sort newest first
    decisions = decisions.slice().sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const total = decisions.length;

    // Apply limit
    if (opts.limit && opts.limit > 0) {
        decisions = decisions.slice(0, opts.limit);
    }

    return { decisions, total };
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. getDecision
// ══════════════════════════════════════════════════════════════════════════════
/**
 * getDecision(decisionId)
 *
 * @param {string} decisionId
 * @returns {Object|null}
 */
function getDecision(decisionId) {
    if (!decisionId) return null;
    const decisions = _loadDecisions();
    return decisions.find(d => d.id === decisionId) || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. assessStrategicRisk
// ══════════════════════════════════════════════════════════════════════════════
/**
 * assessStrategicRisk(context)
 *
 * Uses reasoningEngine.analyzeRisk() as its foundation, then layers in
 * executive-level signals: task-graph complexity, autonomous cycle failure
 * rates, healing history, and cross-cutting system concerns.
 *
 * @param {{ objective, type, agentId, toolId, scope, environment, hasTests,
 *            criticalPath, affectedServices, estimatedUsers }} context
 * @returns {{ riskLevel: "low|medium|high|critical", riskScore: number,
 *             factors: string[], mitigations: string[], shouldProceed: boolean }}
 */
function assessStrategicRisk(context = {}) {
    const heal   = _loadHeal();
    const graphs = _loadGraphs();
    const cycles = _loadCycles();

    const contextText = (
        (context.objective       || "") + " " +
        (context.type            || "") + " " +
        (context.scope           || "") + " " +
        (context.environment     || "") + " " +
        (context.agentId         || "") + " " +
        (context.toolId          || "")
    ).toLowerCase();

    // ── Use reasoningEngine.analyzeRisk as foundation ────────────────────────
    const baseRec = {
        title:  context.objective || context.type || "strategic action",
        detail: context.objective || "",
        type:   context.type      || "",
        priority: context.criticalPath ? 1 : 3,
    };
    const baseRiskResult = analyzeRisk(baseRec, {
        hasTests:     context.hasTests,
        criticalPath: context.criticalPath,
    });

    let riskScore  = baseRiskResult.riskPct || 0;
    const factors     = [...(baseRiskResult.factors     || [])];
    const mitigations = [...(baseRiskResult.mitigations || [])];

    // ── Task-graph complexity signal ──────────────────────────────────────────
    const relevantGraphs = graphs.filter(g => {
        const goal = (g.goal || "").toLowerCase();
        return contextText.split(" ").some(w => w.length > 4 && goal.includes(w));
    });
    if (relevantGraphs.length > 0) {
        const avgNodes = relevantGraphs.reduce((s, g) =>
            s + (Array.isArray(g.nodes) ? g.nodes.length : 0), 0) / relevantGraphs.length;
        if (avgNodes > 15) {
            riskScore += 15;
            factors.push(`Similar task graphs have averaged ${Math.round(avgNodes)} nodes — high complexity.`);
            mitigations.push("Break the mission into smaller task graphs with checkpoints between each.");
        } else if (avgNodes > 8) {
            riskScore += 8;
            factors.push(`Similar task graphs have averaged ${Math.round(avgNodes)} nodes — moderate complexity.`);
        }
    }

    // ── Autonomous cycle failure rate ─────────────────────────────────────────
    const relevantCycles = cycles.filter(c => {
        const goal = (c.goal || "").toLowerCase();
        return contextText.split(" ").some(w => w.length > 4 && goal.includes(w));
    });
    if (relevantCycles.length >= 3) {
        const failedCycles = relevantCycles.filter(c => c.status === "failed");
        const cycleFailRate = failedCycles.length / relevantCycles.length;
        if (cycleFailRate > 0.5) {
            riskScore += 20;
            factors.push(`${Math.round(cycleFailRate * 100)}% of similar autonomous cycles have failed (${failedCycles.length}/${relevantCycles.length}).`);
            mitigations.push("Review failed cycles before proceeding — understand systematic failure causes.");
        } else if (cycleFailRate > 0.25) {
            riskScore += 10;
            factors.push(`${Math.round(cycleFailRate * 100)}% of similar autonomous cycles have failed — above-average failure rate.`);
            mitigations.push("Monitor cycle execution in real-time and set up alerting thresholds.");
        }
    }

    // ── Healing history: recent failure cluster ───────────────────────────────
    const recentHeal = heal.slice(-50); // last 50 entries
    const recentFails = recentHeal.filter(h => !h.success);
    if (recentFails.length > 10) {
        riskScore += 10;
        factors.push(`${recentFails.length} of the last 50 healing events failed — system instability signal.`);
        mitigations.push("Stabilise the system by reviewing healing-history patterns before launching new missions.");
    }

    // ── Environment signal ────────────────────────────────────────────────────
    const env = (context.environment || "").toLowerCase();
    if (env === "production" || env === "prod") {
        riskScore += 15;
        factors.push("Action targets the production environment directly.");
        mitigations.push("Schedule during lowest-traffic window; have on-call engineer available.");
    } else if (env === "staging") {
        // slight positive — staging is safer
        riskScore = Math.max(0, riskScore - 5);
    }

    // ── Affected services blast-radius ────────────────────────────────────────
    if (Array.isArray(context.affectedServices) && context.affectedServices.length > 5) {
        riskScore += 10;
        factors.push(`${context.affectedServices.length} services are in scope — wide blast radius.`);
        mitigations.push("Implement change in a phased rollout — one service at a time with validation gates.");
    }

    // ── User-facing scale ─────────────────────────────────────────────────────
    if (context.estimatedUsers && context.estimatedUsers > 10000) {
        riskScore += 10;
        factors.push(`Affects an estimated ${context.estimatedUsers.toLocaleString()} users.`);
        mitigations.push("Use a feature flag or canary release to limit initial exposure.");
    }

    // ── Cap and classify ──────────────────────────────────────────────────────
    riskScore = Math.min(100, Math.max(0, Math.round(riskScore)));

    let riskLevel;
    if      (riskScore > 75) riskLevel = "critical";
    else if (riskScore > 50) riskLevel = "high";
    else if (riskScore > 25) riskLevel = "medium";
    else                     riskLevel = "low";

    // Ensure at least one mitigation
    if (mitigations.length === 0) {
        mitigations.push("Monitor system metrics closely after applying the action.");
    }

    const shouldProceed = riskLevel !== "critical";

    const confidence = scoreConfidence({
        lessonCount:           0,
        recurrenceRate:        Math.min(1, relevantCycles.length / 10),
        historicalSuccessRate: 1 - (riskScore / 100),
        dataFreshnessMs:       0,
        severity:              riskLevel === "critical" || riskLevel === "high" ? "high" : "medium",
    });

    const output = { riskLevel, riskScore, factors, mitigations, shouldProceed };
    _persistDecision(
        "assessStrategicRisk",
        { objective: context.objective, environment: context.environment },
        output,
        confidence
    );

    logger.info(
        `[ExecutiveReasoning] assessStrategicRisk: level=${riskLevel} score=${riskScore} shouldProceed=${shouldProceed}`
    );
    return output;
}

// ── Module export ────────────────────────────────────────────────────────────
module.exports = {
    prioritizeMissions,
    compareExecutionPlans,
    estimateMissionCost,
    chooseOptimalPath,
    getExecutiveDecisions,
    getDecision,
    assessStrategicRisk,
};
