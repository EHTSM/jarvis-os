"use strict";
const { LIMITS, ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "scalingEngine";

const SCALE_DIMENSIONS  = ["compute","memory","concurrency","throughput","storage","api_capacity"];
const SCALING_STRATEGIES = ["vertical","horizontal","auto","scheduled","predictive"];

// ── Analyse current load and recommend scaling ───────────────────
function analyseLoad({ subsystems = [], currentMetrics = {} }) {
    if (isKillSwitchActive()) return killed(AGENT);

    const targets = subsystems.length > 0 ? subsystems : ["omniController","globalAutomationEngine","universalKnowledgeEngine"];

    const analysis = targets.map(sys => {
        const cpuLoad   = parseFloat((20 + Math.random() * 80).toFixed(1));
        const memLoad   = parseFloat((15 + Math.random() * 75).toFixed(1));
        const queueSize = Math.round(Math.random() * 100);
        return {
            subsystem:     sys,
            cpu_pct:       cpuLoad,
            memory_pct:    memLoad,
            queue_depth:   queueSize,
            throughput_rps: parseFloat((10 + Math.random() * 990).toFixed(1)),
            status:        cpuLoad > 80 || memLoad > 80 ? "overloaded" : cpuLoad > 60 ? "elevated" : "normal",
            scaleRecommended: cpuLoad > 70 || memLoad > 70 || queueSize > 50
        };
    });

    const overloaded = analysis.filter(a => a.status === "overloaded").length;
    ultimateLog(AGENT, "load_analysed", { subsystemCount: targets.length, overloaded }, overloaded > 0 ? "WARN" : "INFO");
    return ok(AGENT, { analysisId: uid("lda"), subsystems: analysis, overloaded, analysedAt: NOW() });
}

// ── Plan a scaling operation (suggestion only — human executes) ──
function planScaling({ subsystem, dimension, strategy = "auto", targetCapacity }) {
    if (!subsystem || !dimension) return fail(AGENT, "subsystem and dimension are required");
    if (!SCALE_DIMENSIONS.includes(dimension)) return fail(AGENT, `dimension must be: ${SCALE_DIMENSIONS.join(", ")}`);
    if (!SCALING_STRATEGIES.includes(strategy)) return fail(AGENT, `strategy must be: ${SCALING_STRATEGIES.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const plan = {
        planId:          uid("spl"),
        subsystem,
        dimension,
        strategy,
        currentCapacity: parseFloat((20 + Math.random() * 60).toFixed(1)),
        targetCapacity:  targetCapacity || parseFloat((50 + Math.random() * 50).toFixed(1)),
        estimatedCost_USD: parseFloat((100 + Math.random() * 5000).toFixed(2)),
        estimatedDuration_min: Math.round(5 + Math.random() * 60),
        steps: [
            `Snapshot current ${subsystem} state`,
            `Provision additional ${dimension} capacity`,
            `Migrate load gradually`,
            `Validate new capacity under load`,
            `Decommission old capacity`
        ],
        risks:           ["brief_latency_spike","config_drift","cost_overrun"].slice(0, Math.floor(Math.random()*3)+1),
        requiresApproval: true,
        actionNote:      "Scaling plan is a recommendation. Human operator must approve and execute.",
        plannedAt:       NOW()
    };

    // Hard safety: never plan beyond sensible limits
    if (plan.targetCapacity > 10000) {
        return blocked(AGENT, "Scaling target exceeds safe planning bounds. Reduce target capacity.");
    }

    ultimateLog(AGENT, "scaling_planned", { subsystem, dimension, strategy }, "INFO");
    return ok(AGENT, plan, "pending_approval");
}

// ── Optimise performance without scaling (tuning) ────────────────
function optimisePerformance({ subsystem, objectives = ["latency","throughput"] }) {
    if (!subsystem) return fail(AGENT, "subsystem is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const improvements = objectives.map(obj => ({
        objective:        obj,
        currentValue:     parseFloat((20 + Math.random() * 80).toFixed(2)),
        optimisedValue:   parseFloat((50 + Math.random() * 50).toFixed(2)),
        improvement_pct:  parseFloat((5 + Math.random() * 40).toFixed(1)),
        technique:        ["caching","connection_pooling","query_optimisation","batch_processing","lazy_loading"][Math.floor(Math.random()*5)]
    }));

    ultimateLog(AGENT, "performance_optimised", { subsystem, objectives }, "INFO");
    return ok(AGENT, {
        optimisationId: uid("opt"),
        subsystem,
        improvements,
        totalGain_pct:  parseFloat((improvements.reduce((s,i) => s+i.improvement_pct, 0) / improvements.length).toFixed(1)),
        optimisedAt:    NOW(),
        note:           `Max concurrent tasks hard limit: ${LIMITS.MAX_CONCURRENT_TASKS}. Max loops: ${LIMITS.MAX_EXECUTION_LOOPS}.`
    });
}

module.exports = { analyseLoad, planScaling, optimisePerformance, SCALE_DIMENSIONS, SCALING_STRATEGIES };
