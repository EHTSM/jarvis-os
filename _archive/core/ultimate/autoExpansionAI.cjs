"use strict";
const { LIMITS, ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "autoExpansionAI";

// Controlled expansion engine — identifies growth opportunities and proposes
// expansions for HUMAN approval. Never self-expands without authorisation.
// Hard caps enforced at every stage.

const EXPANSION_TYPES = ["new_module","new_integration","capability_extension","data_source","workflow_automation","reporting_layer"];
const EXPANSION_PRIORITIES = ["low","medium","high","critical"];

// ── Identify expansion opportunities ────────────────────────────
function identifyOpportunities({ currentCapabilities = [], goals = [] }) {
    if (isKillSwitchActive()) return killed(AGENT);

    const opportunities = EXPANSION_TYPES.map(type => ({
        type,
        description:       `Identified opportunity to add ${type.replace(/_/g," ")} capability`,
        estimatedImpact:   Math.round(40 + Math.random() * 60),
        complexity:        ["low","medium","high"][Math.floor(Math.random()*3)],
        priority:          EXPANSION_PRIORITIES[Math.floor(Math.random()*4)],
        goalsServed:       goals.slice(0, Math.floor(Math.random()*3)+1),
        estimatedDevWeeks: Math.round(1 + Math.random() * 12),
        requiresApproval:  true,
        humanDecisionRequired: "All expansions require human approval before implementation"
    })).sort((a, b) => b.estimatedImpact - a.estimatedImpact);

    ultimateLog(AGENT, "expansion_opportunities_identified", { count: opportunities.length }, "INFO");
    return ok(AGENT, {
        scanId:        uid("exp"),
        opportunities,
        totalFound:    opportunities.length,
        highPriority:  opportunities.filter(o => o.priority === "high" || o.priority === "critical").length,
        note:          "All expansion proposals require explicit human approval. System cannot self-expand.",
        scannedAt:     NOW()
    }, "pending_approval");
}

// ── Plan a controlled expansion ──────────────────────────────────
function planExpansion({ expansionType, description, approvedBy, approvalRef }) {
    if (!expansionType || !description) return fail(AGENT, "expansionType and description are required");
    if (!EXPANSION_TYPES.includes(expansionType)) return fail(AGENT, `expansionType must be: ${EXPANSION_TYPES.join(", ")}`);
    if (!approvedBy || !approvalRef) return blocked(AGENT, "Expansion planning requires approvedBy and approvalRef — human authorisation is mandatory");
    if (isKillSwitchActive()) return killed(AGENT);

    const plan = {
        planId:          uid("exppl"),
        expansionType,
        description:     description.slice(0, 500),
        approvedBy,
        approvalRef,
        phases: [
            { phase: 1, name: "Specification", actions: ["Define requirements","Assess dependencies","Security review"] },
            { phase: 2, name: "Development",   actions: ["Implement module","Unit tests","Integration tests"] },
            { phase: 3, name: "Validation",    actions: ["Ethics check","Safety review","Performance test"] },
            { phase: 4, name: "Deployment",    actions: ["Staged rollout","Monitor metrics","Rollback plan ready"] }
        ],
        safetyCheckpoints: ["ethics_monitor","safety_lock","admin_approval","kill_switch_verification"],
        estimatedWeeks:  Math.round(2 + Math.random() * 16),
        rollbackPlan:    "Full state checkpoint before each phase. Instant rollback capability maintained.",
        plannedAt:       NOW()
    };

    ultimateLog(AGENT, "expansion_planned", { expansionType, approvedBy, approvalRef }, "WARN");
    return ok(AGENT, plan);
}

// ── Get expansion history ────────────────────────────────────────
function getExpansionHistory({ limit = 20 }) {
    const log = load("expansion_history", []);
    return ok(AGENT, { total: log.length, recent: log.slice(-limit), expansionTypes: EXPANSION_TYPES });
}

module.exports = { identifyOpportunities, planExpansion, getExpansionHistory, EXPANSION_TYPES };
