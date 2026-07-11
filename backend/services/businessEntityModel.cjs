"use strict";
/**
 * businessEntityModel.cjs — Phase B1: Business Entity Model
 *
 * Defines the canonical business entity types that map to Missions.
 * NO new runtime. NO new storage. Reuses:
 *   Storage    → missionMemory.cjs  (data/missions.json)
 *   Execution  → missionOrchestrator.cjs (createManual)
 *   Rules      → engineeringRuleRegistry.cjs (extended with business classes)
 *   Learning   → continuousLearningEngine.cjs
 *   Leads      → crmService.js (data/leads.json)
 *
 * Business entities ARE missions. This module owns:
 *   • Entity schema definitions (Lead, Deal, Task, Customer, Operation)
 *   • Entity → Mission mapping (objective, subtasks, priority, domain metadata)
 *   • Pipeline stage definitions per entity type
 *   • Business rule classes (injected into engineeringRuleRegistry-compatible format)
 */

const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

// ── Lazy loaders (same pattern as existing services) ─────────────────────────
function _mem()  { try { return require("./missionMemory.cjs");          } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");    } catch { return null; } }
function _crm()  { try { return require("./crmService");                 } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }

// ── Entity Types ─────────────────────────────────────────────────────────────

const ENTITY_TYPES = {
    lead:      "lead",
    deal:      "deal",
    task:      "marketing_task",
    customer:  "customer",
    operation: "operation",
};

// ── Pipeline Stages per entity type ──────────────────────────────────────────

const PIPELINE_STAGES = {
    lead: [
        { id: "new",          label: "New Lead",         description: "Lead just arrived, not yet qualified" },
        { id: "contacted",    label: "Contacted",         description: "First outreach sent" },
        { id: "qualified",    label: "Qualified",         description: "Lead confirmed as valid opportunity" },
        { id: "proposal",     label: "Proposal Sent",     description: "Proposal or quote delivered" },
        { id: "negotiating",  label: "Negotiating",       description: "Active back-and-forth on terms" },
        { id: "closed_won",   label: "Closed Won",        description: "Deal signed, becomes customer" },
        { id: "closed_lost",  label: "Closed Lost",       description: "Opportunity did not convert" },
    ],
    deal: [
        { id: "identified",   label: "Identified",        description: "Deal opportunity created" },
        { id: "scoping",      label: "Scoping",           description: "Scope and requirements being defined" },
        { id: "proposal",     label: "Proposal",          description: "Proposal stage" },
        { id: "approval",     label: "Approval",          description: "Waiting for internal or client approval" },
        { id: "won",          label: "Won",               description: "Deal closed successfully" },
        { id: "lost",         label: "Lost",              description: "Deal did not close" },
    ],
    marketing_task: [
        { id: "backlog",      label: "Backlog",           description: "Queued but not started" },
        { id: "in_progress",  label: "In Progress",       description: "Actively being worked on" },
        { id: "review",       label: "Review",            description: "Awaiting review or approval" },
        { id: "published",    label: "Published",         description: "Released/live" },
        { id: "cancelled",    label: "Cancelled",         description: "Will not be completed" },
    ],
    customer: [
        { id: "onboarding",   label: "Onboarding",        description: "New customer being set up" },
        { id: "active",       label: "Active",            description: "Healthy active customer" },
        { id: "at_risk",      label: "At Risk",           description: "Showing churn signals" },
        { id: "churned",      label: "Churned",           description: "Customer has left" },
        { id: "won_back",     label: "Won Back",          description: "Churned customer re-engaged" },
    ],
    operation: [
        { id: "planned",      label: "Planned",           description: "Scheduled, not started" },
        { id: "running",      label: "Running",           description: "Execution in progress" },
        { id: "blocked",      label: "Blocked",           description: "Waiting on external dependency" },
        { id: "done",         label: "Done",              description: "Operation complete" },
        { id: "failed",       label: "Failed",            description: "Operation failed" },
    ],
};

// ── Business Rules (problemClass-compatible with engineeringRuleRegistry) ────

const BUSINESS_RULES = [
    {
        id:           "br_001",
        problemClass: "lead_response_sla",
        title:        "Lead Response SLA Breach",
        why:          "Leads not contacted within 1 hour convert at 7x lower rate",
        solution:     "Immediately create a follow-up mission and notify assigned owner",
        action:       "escalate",
        autoApply:    true,
        errorPatterns: ["lead.*new.*hour", "response.*overdue", "sla.*breach"],
        tags:         ["business", "crm", "lead", "sla"],
        performanceImpact: "high",
    },
    {
        id:           "br_002",
        problemClass: "deal_stalled",
        title:        "Deal Stalled in Pipeline",
        why:          "Deals with no activity for 7+ days rarely close",
        solution:     "Trigger a check-in mission and log the interaction",
        action:       "retry",
        autoApply:    true,
        errorPatterns: ["deal.*stall", "no.*activity.*day", "pipeline.*stuck"],
        tags:         ["business", "crm", "deal", "pipeline"],
        performanceImpact: "high",
    },
    {
        id:           "br_003",
        problemClass: "customer_at_risk",
        title:        "Customer At-Risk Signal",
        why:          "Customers with no login or support activity for 14 days trend toward churn",
        solution:     "Create a customer success mission to proactively engage",
        action:       "escalate",
        autoApply:    true,
        errorPatterns: ["customer.*risk", "churn.*signal", "no.*login.*week"],
        tags:         ["business", "crm", "customer", "retention"],
        performanceImpact: "high",
    },
    {
        id:           "br_004",
        problemClass: "proposal_not_opened",
        title:        "Proposal Not Opened",
        why:          "Proposals not viewed within 48h rarely convert",
        solution:     "Follow up with a personalised message and updated proposal",
        action:       "retry",
        autoApply:    false,
        errorPatterns: ["proposal.*unopened", "not.*viewed", "proposal.*stale"],
        tags:         ["business", "crm", "deal", "proposal"],
        performanceImpact: "medium",
    },
    {
        id:           "br_005",
        problemClass: "onboarding_incomplete",
        title:        "Customer Onboarding Incomplete",
        why:          "Customers who don't complete onboarding within 7 days have 60% churn rate",
        solution:     "Escalate to success team and create onboarding completion mission",
        action:       "escalate",
        autoApply:    true,
        errorPatterns: ["onboard.*incomplete", "setup.*not.*done", "activation.*pending"],
        tags:         ["business", "customer", "onboarding", "success"],
        performanceImpact: "high",
    },
];

// ── Entity → Mission Mapping ──────────────────────────────────────────────────

/**
 * Maps a business entity to a mission-compatible opts object for createManual().
 * Returns: { objective, priority, subtasks[], metadata{} }
 */
function entityToMission(entityType, entity, opts = {}) {
    const type = ENTITY_TYPES[entityType] || entityType;
    const stages = PIPELINE_STAGES[type] || PIPELINE_STAGES[entityType] || [];

    switch (type) {
        case "lead": {
            return {
                objective: `CRM: Qualify and convert lead — ${entity.name || entity.phone || entity.email || "Unknown"}`,
                priority:  opts.priority || "high",
                subtasks:  [
                    { description: `Contact lead: ${entity.name || entity.phone}` },
                    { description: "Qualify needs and budget" },
                    { description: "Send proposal or next steps" },
                    { description: "Follow up and close" },
                ],
                metadata: {
                    domain:     "business",
                    entityType: "lead",
                    entityId:   entity.id || entity.phone || entity.userId,
                    pipeline:   "sales",
                    stage:      entity.status || "new",
                    source:     entity.source || "manual",
                    leadData:   { name: entity.name, phone: entity.phone, email: entity.email },
                },
            };
        }
        case "deal": {
            return {
                objective: `Sales: Close deal — ${entity.name || entity.title || entity.id}`,
                priority:  opts.priority || "high",
                subtasks:  [
                    { description: `Define scope: ${entity.description || entity.name}` },
                    { description: "Prepare and send proposal" },
                    { description: "Handle objections and negotiate" },
                    { description: "Get signature / close" },
                ],
                metadata: {
                    domain:     "business",
                    entityType: "deal",
                    entityId:   entity.id,
                    pipeline:   "sales",
                    stage:      entity.stage || "identified",
                    value:      entity.value || null,
                },
            };
        }
        case "marketing_task": {
            return {
                objective: `Marketing: ${entity.title || entity.name || "Complete marketing task"}`,
                priority:  opts.priority || "medium",
                subtasks:  (entity.subtasks || [
                    { description: "Brief and plan" },
                    { description: "Create content / asset" },
                    { description: "Review and approve" },
                    { description: "Publish / deliver" },
                ]),
                metadata: {
                    domain:     "business",
                    entityType: "marketing_task",
                    entityId:   entity.id,
                    campaign:   entity.campaign || null,
                    channel:    entity.channel || null,
                },
            };
        }
        case "customer": {
            return {
                objective: `Customer Success: ${entity.action || "Retain"} customer — ${entity.name || entity.id}`,
                priority:  opts.priority || (entity.status === "at_risk" ? "critical" : "medium"),
                subtasks:  [
                    { description: `Review customer health: ${entity.name}` },
                    { description: "Identify blockers or at-risk signals" },
                    { description: "Execute retention or success play" },
                    { description: "Log outcome and update CRM" },
                ],
                metadata: {
                    domain:     "business",
                    entityType: "customer",
                    entityId:   entity.id || entity.phone,
                    plan:       entity.plan || null,
                    status:     entity.status || "active",
                },
            };
        }
        case "operation": {
            return {
                objective: `Operations: ${entity.title || entity.name || "Run operation"}`,
                priority:  opts.priority || "medium",
                subtasks:  (entity.steps || []).map(s => ({ description: s })),
                metadata: {
                    domain:     "business",
                    entityType: "operation",
                    entityId:   entity.id,
                    category:   entity.category || "general",
                },
            };
        }
        default:
            return {
                objective: `Business: ${entity.title || entity.name || entityType}`,
                priority:  opts.priority || "medium",
                subtasks:  [],
                metadata:  { domain: "business", entityType, entityId: entity.id },
            };
    }
}

// ── Public: Create a business mission ────────────────────────────────────────

/**
 * createBusinessMission(entityType, entity, opts)
 * Maps entity to mission opts and calls orchestrator.createManual().
 * Returns the created orchestrated mission record.
 */
function createBusinessMission(entityType, entity, opts = {}) {
    const orch = _orch();
    if (!orch) throw new Error("missionOrchestrator not available");

    const missionOpts = entityToMission(entityType, entity, opts);
    const mission = orch.createManual({ ...missionOpts, goal: missionOpts.objective });

    // Record a business-specific lesson on creation
    try {
        _le()?.createLesson({
            context:       `business:${entityType}`,
            sourcePattern: `${entityType}_mission_created`,
            insight:       `Business mission created for ${entityType}: ${missionOpts.objective}`,
            tags:          ["business", entityType, "mission_created"],
        });
    } catch { /* non-fatal */ }

    return mission;
}

/**
 * listBusinessMissions(opts)
 * Returns missions that have domain=business in metadata, via missionMemory.
 * opts: { entityType, stage, status, limit }
 */
function listBusinessMissions(opts = {}) {
    const mem = _mem();
    if (!mem) return { missions: [], total: 0 };
    const { entityType, status, limit = 50 } = opts;
    const all = mem.listMissions({ status, limit: 500 });
    let missions = (all.missions || []).filter(m => {
        const meta = m.metadata || {};
        if (meta.domain !== "business") return false;
        if (entityType && meta.entityType !== entityType) return false;
        return true;
    });
    if (limit) missions = missions.slice(0, limit);
    return { missions, total: missions.length };
}

/**
 * getPipelineStages(entityType) — return stage definitions.
 */
function getPipelineStages(entityType) {
    const type = ENTITY_TYPES[entityType] || entityType;
    return PIPELINE_STAGES[type] || PIPELINE_STAGES[entityType] || [];
}

/**
 * getBusinessRules() — return business rule definitions.
 */
function getBusinessRules() {
    return [...BUSINESS_RULES];
}

/**
 * getPipelineSummary() — counts per entity type and stage.
 * Reads from missionMemory, groups by entityType.
 */
function getPipelineSummary() {
    const mem = _mem();
    if (!mem) return {};
    const all = mem.listMissions({ limit: 1000 });
    const summary = {};
    for (const m of (all.missions || [])) {
        const meta = m.metadata || {};
        if (meta.domain !== "business") continue;
        const et = meta.entityType || "unknown";
        if (!summary[et]) summary[et] = { total: 0, byStage: {}, byStatus: {} };
        summary[et].total++;
        const stage = meta.stage || "unknown";
        summary[et].byStage[stage] = (summary[et].byStage[stage] || 0) + 1;
        summary[et].byStatus[m.status] = (summary[et].byStatus[m.status] || 0) + 1;
    }
    return summary;
}

module.exports = {
    ENTITY_TYPES,
    PIPELINE_STAGES,
    BUSINESS_RULES,
    entityToMission,
    createBusinessMission,
    listBusinessMissions,
    getPipelineStages,
    getBusinessRules,
    getPipelineSummary,
};
