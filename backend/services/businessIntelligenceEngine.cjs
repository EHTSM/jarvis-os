"use strict";
/**
 * businessIntelligenceEngine.cjs — Phase B3: Business Intelligence Engine
 *
 * Teaches Business OS to make intelligent business decisions by scanning
 * business entity state, computing health metrics, generating recommendations,
 * scoring confidence, and creating follow-up missions — all via existing systems.
 *
 * NO new workflow engine. NO new scheduler. NO new runtime.
 *
 * Reused systems:
 *   businessDataService.cjs         → entity reads (leads/deals/customers/campaigns)
 *   continuousLearningEngine.cjs    → createLesson, getRecommendations, updateRecommendation
 *   engineeringConfidenceEngine.cjs → explain() for signal confidence scoring
 *   engineeringRuleRegistry.cjs     → registerRule, classifyError (business rules)
 *   missionOrchestrator.cjs         → createManual (follow-up mission creation)
 *   businessEntityModel.cjs         → createBusinessMission, BUSINESS_RULES
 *   operationsAlertingLayer.cjs     → fire() notifications
 *   missionMemory.cjs               → recordDecision
 *
 * Public API:
 *   scan(opts)                      → intelligenceReport (full analysis)
 *   scanLeads(opts)                 → lead signals + recommendations
 *   scanDeals(opts)                 → deal signals + recommendations
 *   scanCustomers(opts)             → customer signals + recommendations
 *   scanCampaigns(opts)             → campaign signals + recommendations
 *   getHealthMetrics()              → aggregated business health dashboard
 *   getRecommendations(opts)        → open business recommendations
 *   dismissRecommendation(recId)    → mark dismissed
 *   acceptRecommendation(recId)     → mark accepted + create mission
 *   registerBusinessRule(rule)      → register into engineeringRuleRegistry
 *   getBusinessRules()              → list business-tagged rules
 *   scoreSignal(signal, context)    → confidence score via confidence engine
 */

const logger = require("../utils/logger");
const crypto = require("crypto");

// ── Lazy loaders ──────────────────────────────────────────────────────────────
function _bds()  { try { return require("./businessDataService.cjs");          } catch { return null; } }
function _bem()  { try { return require("./businessEntityModel.cjs");          } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");     } catch { return null; } }
function _ce()   { try { return require("./engineeringConfidenceEngine.cjs");  } catch { return null; } }
function _reg()  { try { return require("./engineeringRuleRegistry.cjs");      } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");          } catch { return null; } }
function _alert(){ try { return require("./operationsAlertingLayer.cjs");      } catch { return null; } }
function _mem()  { try { return require("./missionMemory.cjs");                } catch { return null; } }

// ── ID helpers ────────────────────────────────────────────────────────────────
let _seq = 0;
function _sid() { return `bsig_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Time helpers ──────────────────────────────────────────────────────────────
function _ageHours(isoStr) {
    if (!isoStr) return Infinity;
    return (Date.now() - new Date(isoStr).getTime()) / 3_600_000;
}
function _ageDays(isoStr) { return _ageHours(isoStr) / 24; }

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE RULES — declarative signal definitions
// Each rule: { id, name, entityType, check(entity)→signal|null, severity, action }
// signal: { type, description, recommendation, missionTrigger, confidence }
// ─────────────────────────────────────────────────────────────────────────────

const INTELLIGENCE_RULES = [

    // ── Lead rules ────────────────────────────────────────────────────────────
    {
        id:         "biz_ir_001",
        name:       "Lead idle > 7 days",
        entityType: "lead",
        severity:   "warning",
        check(lead) {
            if (!["new", "contacted"].includes(lead.status)) return null;
            const age = _ageDays(lead.updatedAt || lead.createdAt);
            if (age < 7) return null;
            return {
                type:           "lead_idle",
                description:    `Lead "${lead.name || lead.email || lead.phone}" idle for ${Math.floor(age)} days (status: ${lead.status})`,
                recommendation: `Follow up immediately — leads idle >7 days convert 80% less frequently`,
                missionTrigger: true,
                urgency:        age > 14 ? "critical" : "high",
                data:           { leadId: lead.id, ageDays: Math.floor(age), status: lead.status },
            };
        },
    },
    {
        id:         "biz_ir_002",
        name:       "Lead low score not disqualified",
        entityType: "lead",
        severity:   "info",
        check(lead) {
            if (lead.status === "disqualified" || lead.status === "converted") return null;
            if ((lead.score || 0) > 30) return null;
            return {
                type:           "lead_low_score",
                description:    `Lead "${lead.name || lead.phone}" has low score (${lead.score || 0}/100) and is still open`,
                recommendation: "Qualify or disqualify — low-score leads consume pipeline capacity without converting",
                missionTrigger: false,
                urgency:        "medium",
                data:           { leadId: lead.id, score: lead.score || 0 },
            };
        },
    },
    {
        id:         "biz_ir_003",
        name:       "Lead qualified but no proposal",
        entityType: "lead",
        severity:   "warning",
        check(lead) {
            if (lead.status !== "qualified") return null;
            const age = _ageDays(lead.qualifiedAt || lead.updatedAt || lead.createdAt);
            if (age < 2) return null;
            return {
                type:           "lead_qualified_no_proposal",
                description:    `Lead "${lead.name || lead.email}" qualified ${Math.floor(age)} days ago but no proposal sent`,
                recommendation: "Generate and send proposal — qualification momentum decays within 48 hours",
                missionTrigger: true,
                urgency:        "high",
                data:           { leadId: lead.id, ageDays: Math.floor(age) },
            };
        },
    },

    // ── Deal rules ────────────────────────────────────────────────────────────
    {
        id:         "biz_ir_010",
        name:       "Deal stalled > 7 days",
        entityType: "deal",
        severity:   "warning",
        check(deal) {
            if (["closed-won", "closed-lost"].includes(deal.stage)) return null;
            const age = _ageDays(deal.updatedAt || deal.createdAt);
            if (age < 7) return null;
            return {
                type:           "deal_stalled",
                description:    `Deal "${deal.title}" stalled at stage "${deal.stage}" for ${Math.floor(age)} days`,
                recommendation: "Re-engage or close lost — stalled deals degrade pipeline accuracy",
                missionTrigger: true,
                urgency:        age > 14 ? "critical" : "high",
                data:           { dealId: deal.id, stage: deal.stage, ageDays: Math.floor(age) },
            };
        },
    },
    {
        id:         "biz_ir_011",
        name:       "High-value deal no approval",
        entityType: "deal",
        severity:   "critical",
        check(deal) {
            if ((deal.value || 0) <= 10000) return null;
            if (["closed-won", "closed-lost"].includes(deal.stage)) return null;
            if (deal.approvalRequested) return null;
            if (deal.stage !== "proposal" && deal.stage !== "negotiation") return null;
            return {
                type:           "deal_no_approval",
                description:    `High-value deal "${deal.title}" (${deal.currency || "USD"} ${deal.value}) at "${deal.stage}" — no approval requested`,
                recommendation: "Request approval now — high-value deals require sign-off before advancing",
                missionTrigger: true,
                urgency:        "critical",
                data:           { dealId: deal.id, value: deal.value, stage: deal.stage },
            };
        },
    },
    {
        id:         "biz_ir_012",
        name:       "Deal in negotiation > 21 days",
        entityType: "deal",
        severity:   "warning",
        check(deal) {
            if (deal.stage !== "negotiation") return null;
            const age = _ageDays(deal.updatedAt || deal.createdAt);
            if (age < 21) return null;
            return {
                type:           "deal_negotiation_overdue",
                description:    `Deal "${deal.title}" has been in negotiation for ${Math.floor(age)} days`,
                recommendation: "Escalate to senior sales or accept/decline — prolonged negotiation signals misalignment",
                missionTrigger: true,
                urgency:        "high",
                data:           { dealId: deal.id, ageDays: Math.floor(age) },
            };
        },
    },

    // ── Customer rules ────────────────────────────────────────────────────────
    {
        id:         "biz_ir_020",
        name:       "Customer at-risk",
        entityType: "customer",
        severity:   "critical",
        check(customer) {
            if (customer.status !== "at_risk") return null;
            return {
                type:           "customer_at_risk",
                description:    `Customer "${customer.name || customer.id}" marked at-risk`,
                recommendation: "Immediately assign CS owner and run retention play",
                missionTrigger: true,
                urgency:        "critical",
                data:           { customerId: customer.id, name: customer.name, plan: customer.plan },
            };
        },
    },
    {
        id:         "biz_ir_021",
        name:       "Customer onboarding > 7 days",
        entityType: "customer",
        severity:   "warning",
        check(customer) {
            if (customer.status !== "onboarding") return null;
            const age = _ageDays(customer.createdAt);
            if (age < 7) return null;
            return {
                type:           "customer_onboarding_overdue",
                description:    `Customer "${customer.name || customer.id}" has been onboarding for ${Math.floor(age)} days`,
                recommendation: "Escalate to activation team — onboarding >7 days correlates with 60% churn",
                missionTrigger: true,
                urgency:        "high",
                data:           { customerId: customer.id, ageDays: Math.floor(age) },
            };
        },
    },
    {
        id:         "biz_ir_022",
        name:       "Customer churned — win-back opportunity",
        entityType: "customer",
        severity:   "info",
        check(customer) {
            if (customer.status !== "churned") return null;
            const age = _ageDays(customer.updatedAt || customer.createdAt);
            if (age > 90) return null; // too old
            return {
                type:           "customer_win_back",
                description:    `Customer "${customer.name || customer.id}" churned ${Math.floor(age)} days ago — win-back window`,
                recommendation: "Send win-back offer within 90-day re-engagement window",
                missionTrigger: false,
                urgency:        "medium",
                data:           { customerId: customer.id, ageDays: Math.floor(age) },
            };
        },
    },

    // ── Campaign rules ────────────────────────────────────────────────────────
    {
        id:         "biz_ir_030",
        name:       "Campaign low conversion rate",
        entityType: "campaign",
        severity:   "warning",
        check(campaign) {
            if (campaign.status !== "active") return null;
            const { impressions = 0, clicks = 0, conversions = 0 } = campaign.metrics || {};
            if (impressions < 100) return null; // too early
            const ctr = impressions > 0 ? clicks / impressions : 0;
            const cvr = clicks > 0 ? conversions / clicks : 0;
            if (ctr >= 0.02 && cvr >= 0.05) return null; // performing
            return {
                type:           "campaign_underperforming",
                description:    `Campaign "${campaign.name}" — CTR: ${(ctr * 100).toFixed(1)}%, CVR: ${(cvr * 100).toFixed(1)}% (below threshold)`,
                recommendation: "Review creative or targeting — campaign underperforming KPI targets (CTR<2%, CVR<5%)",
                missionTrigger: true,
                urgency:        "medium",
                data:           { campaignId: campaign.id, ctr: +(ctr * 100).toFixed(2), cvr: +(cvr * 100).toFixed(2), impressions, clicks, conversions },
            };
        },
    },
    {
        id:         "biz_ir_031",
        name:       "Campaign overdue end date",
        entityType: "campaign",
        severity:   "info",
        check(campaign) {
            if (campaign.status !== "active") return null;
            if (!campaign.endDate) return null;
            const age = _ageDays(campaign.endDate);
            if (age <= 0) return null; // not yet past end date
            return {
                type:           "campaign_overdue",
                description:    `Campaign "${campaign.name}" passed its end date ${Math.floor(age)} days ago but is still active`,
                recommendation: "Close or extend campaign — overdue active campaigns skew reporting",
                missionTrigger: false,
                urgency:        "low",
                data:           { campaignId: campaign.id, ageDays: Math.floor(age) },
            };
        },
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL SCORING via engineeringConfidenceEngine
// ─────────────────────────────────────────────────────────────────────────────

function scoreSignal(signal, context = {}) {
    const ce = _ce();
    if (!ce) return { confidence: 50, breakdown: [], note: "confidence engine unavailable" };
    const errorMsg = `${signal.type}: ${signal.description}`;
    const result = ce.explain(errorMsg, {
        capability:   `business:${signal.type}`,
        problemClass: signal.type,
        ...context,
    });
    return {
        confidence:  result.confidence,
        breakdown:   result.breakdown,
        matchedRule: result.matchedRule,
        problemClass: result.problemClass,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDATION EMISSION — via continuousLearningEngine
// ─────────────────────────────────────────────────────────────────────────────

function _emitRecommendation(signal, ruleId, entityType) {
    const le = _le();
    if (!le) return null;
    // Create lesson for every signal
    le.createLesson({
        type:          "business_signal",
        title:         `[BIZ] ${signal.type}: ${signal.description.slice(0, 120)}`,
        detail:        signal.recommendation,
        severity:      signal.urgency === "critical" ? "critical" : signal.urgency === "high" ? "warning" : "info",
        sourcePattern: signal.type,
        recommendation: signal.recommendation,
        source:        "businessIntelligenceEngine",
    });
    return { emitted: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSION CREATION — via missionOrchestrator/businessEntityModel
// ─────────────────────────────────────────────────────────────────────────────

function _triggerMission(signal, entityType, entityId) {
    try {
        const orch = _orch();
        if (!orch) return null;
        const priority = signal.urgency === "critical" ? "critical"
                       : signal.urgency === "high"     ? "high"
                       : "medium";
        const mission = orch.createManual({
            objective: `[Auto] ${signal.recommendation}`,
            priority,
            subtasks:  [
                { description: `Signal detected: ${signal.description}` },
                { description: signal.recommendation },
                { description: `Update ${entityType} record: ${entityId}` },
                { description: "Verify outcome and close mission" },
            ],
            metadata: {
                domain:         "business",
                entityType,
                entityId,
                signalType:     signal.type,
                autoTriggered:  true,
                triggeredAt:    new Date().toISOString(),
            },
        });
        return mission?.missionId || mission?.id || null;
    } catch (e) {
        logger.warn(`[BizIntel] Mission trigger failed: ${e.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _runRules(entities, entityType, opts = {}) {
    const rules    = INTELLIGENCE_RULES.filter(r => r.entityType === entityType);
    const signals  = [];
    const missions = [];

    for (const entity of entities) {
        for (const rule of rules) {
            try {
                const signal = rule.check(entity);
                if (!signal) continue;

                const scored    = scoreSignal(signal, { entityType });
                const fullSignal = {
                    signalId:   _sid(),
                    ruleId:     rule.id,
                    ruleName:   rule.name,
                    entityType,
                    entityId:   entity.id,
                    severity:   rule.severity,
                    confidence: scored.confidence,
                    ...signal,
                    detectedAt: new Date().toISOString(),
                };

                signals.push(fullSignal);

                // Emit lesson/recommendation
                _emitRecommendation(fullSignal, rule.id, entityType);

                // Auto-trigger mission for high-urgency signals when missionTrigger=true
                if (signal.missionTrigger && (signal.urgency === "critical" || signal.urgency === "high") && !opts.dryRun) {
                    const missionId = _triggerMission(fullSignal, entityType, entity.id);
                    if (missionId) {
                        missions.push({ signalId: fullSignal.signalId, missionId, entityId: entity.id });
                        // Also fire ops alert
                        _alert()?.fire({
                            title:    `[BizIntel] ${signal.type}: ${entity.id}`,
                            message:  signal.description,
                            severity: rule.severity,
                            source:   "businessIntelligenceEngine",
                        });
                    }
                }
            } catch (e) {
                logger.warn(`[BizIntel] Rule ${rule.id} failed on ${entityType}:${entity.id}: ${e.message}`);
            }
        }
    }

    return { signals, missions };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SCAN METHODS
// ─────────────────────────────────────────────────────────────────────────────

function scanLeads(opts = {}) {
    const bds = _bds();
    if (!bds) return { signals: [], missions: [], error: "businessDataService unavailable" };
    const leads = bds.listLeads({ limit: 500 }).items;
    return _runRules(leads, "lead", opts);
}

function scanDeals(opts = {}) {
    const bds = _bds();
    if (!bds) return { signals: [], missions: [], error: "businessDataService unavailable" };
    const deals = bds.listOpportunities({ limit: 500 }).items;
    return _runRules(deals, "deal", opts);
}

function scanCustomers(opts = {}) {
    const bds = _bds();
    if (!bds) return { signals: [], missions: [], error: "businessDataService unavailable" };
    const customers = bds.listContacts({ limit: 500 }).items;
    return _runRules(customers, "customer", opts);
}

function scanCampaigns(opts = {}) {
    const bds = _bds();
    if (!bds) return { signals: [], missions: [], error: "businessDataService unavailable" };
    const campaigns = bds.listCampaigns({ limit: 200 }).items;
    return _runRules(campaigns, "campaign", opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

function getHealthMetrics() {
    const bds = _bds();
    if (!bds) return { error: "businessDataService unavailable" };

    const leads   = bds.listLeads({ limit: 1000 }).items;
    const deals   = bds.listOpportunities({ limit: 1000 }).items;
    const camps   = bds.listCampaigns({ limit: 200 }).items;
    const rev     = bds.listRevenue({ limit: 1000 }).items;

    // Lead health
    const leadNew       = leads.filter(l => l.status === "new");
    const leadContacted = leads.filter(l => l.status === "contacted");
    const leadQualified = leads.filter(l => l.status === "qualified");
    const leadConverted = leads.filter(l => l.status === "converted");
    const leadIdle7d    = leads.filter(l => ["new","contacted"].includes(l.status) && _ageDays(l.updatedAt || l.createdAt) >= 7);
    const conversionRate = leads.length > 0 ? +(leadConverted.length / leads.length * 100).toFixed(1) : 0;

    // Pipeline health
    const openDeals     = deals.filter(d => !["closed-won","closed-lost"].includes(d.stage));
    const wonDeals      = deals.filter(d => d.stage === "closed-won");
    const lostDeals     = deals.filter(d => d.stage === "closed-lost");
    const stalledDeals  = deals.filter(d => !["closed-won","closed-lost"].includes(d.stage) && _ageDays(d.updatedAt || d.createdAt) >= 7);
    const pipelineValue = openDeals.reduce((s,d) => s + (d.value||0), 0);
    const wonValue      = wonDeals.reduce((s,d) => s + (d.value||0), 0);
    const winRate       = (wonDeals.length + lostDeals.length) > 0
        ? +(wonDeals.length / (wonDeals.length + lostDeals.length) * 100).toFixed(1) : 0;

    // Campaign health
    const activeCamps = camps.filter(c => c.status === "active");
    const totalImpressions = activeCamps.reduce((s,c) => s + (c.metrics?.impressions||0), 0);
    const totalConversions = activeCamps.reduce((s,c) => s + (c.metrics?.conversions||0), 0);
    const campaignCVR = totalImpressions > 0 ? +(totalConversions / totalImpressions * 100).toFixed(2) : 0;

    // Revenue
    const totalRevenue = rev.reduce((s,r) => s + (r.amount||0), 0);
    const revThisMonth = rev.filter(r => (r.recordedAt||"").startsWith(new Date().toISOString().slice(0,7))).reduce((s,r) => s+(r.amount||0),0);

    // Overall health score (0–100)
    let score = 100;
    if (leadIdle7d.length > 0)   score -= Math.min(20, leadIdle7d.length * 4);
    if (stalledDeals.length > 0) score -= Math.min(25, stalledDeals.length * 5);
    if (conversionRate < 10)     score -= 15;
    if (winRate < 30)            score -= 15;
    if (campaignCVR < 1)         score -= 10;
    score = Math.max(0, Math.round(score));

    return {
        computedAt: new Date().toISOString(),
        healthScore: score,
        leads: {
            total: leads.length,
            new: leadNew.length,
            contacted: leadContacted.length,
            qualified: leadQualified.length,
            converted: leadConverted.length,
            idle7d: leadIdle7d.length,
            conversionRate,
        },
        pipeline: {
            total:       deals.length,
            open:        openDeals.length,
            stalled:     stalledDeals.length,
            won:         wonDeals.length,
            lost:        lostDeals.length,
            pipelineValue,
            wonValue,
            winRate,
        },
        campaigns: {
            total:        camps.length,
            active:       activeCamps.length,
            totalImpressions,
            totalConversions,
            campaignCVR,
        },
        revenue: {
            total:       totalRevenue,
            thisMonth:   revThisMonth,
            count:       rev.length,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL SCAN
// ─────────────────────────────────────────────────────────────────────────────

function scan(opts = {}) {
    const startedAt = new Date().toISOString();
    const leadResult = scanLeads(opts);
    const dealResult = scanDeals(opts);
    const custResult = scanCustomers(opts);
    const campResult = scanCampaigns(opts);

    const allSignals  = [...leadResult.signals, ...dealResult.signals, ...custResult.signals, ...campResult.signals];
    const allMissions = [...leadResult.missions, ...dealResult.missions, ...custResult.missions, ...campResult.missions];

    const health = getHealthMetrics();

    const completedAt = new Date().toISOString();

    logger.info(`[BizIntel] Scan complete — signals: ${allSignals.length}, missions triggered: ${allMissions.length}, health: ${health.healthScore}`);

    return {
        startedAt,
        completedAt,
        healthScore:      health.healthScore,
        signalCount:      allSignals.length,
        missionCount:     allMissions.length,
        signals:          allSignals,
        missionsTriggered: allMissions,
        byEntityType: {
            lead:     { signals: leadResult.signals.length,     missions: leadResult.missions.length },
            deal:     { signals: dealResult.signals.length,     missions: dealResult.missions.length },
            customer: { signals: custResult.signals.length,     missions: custResult.missions.length },
            campaign: { signals: campResult.signals.length,     missions: campResult.missions.length },
        },
        health,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDATIONS PROXY
// ─────────────────────────────────────────────────────────────────────────────

function getRecommendations(opts = {}) {
    const le = _le();
    if (!le) return { recommendations: [], total: 0, error: "learning engine unavailable" };
    // Return business-tagged recommendations from the learning engine
    const all = le.getRecommendations({ status: opts.status, limit: opts.limit || 50 });
    return all;
}

function dismissRecommendation(recId) {
    const le = _le();
    if (!le) throw new Error("learning engine unavailable");
    return le.updateRecommendation(recId, { status: "dismissed" });
}

function acceptRecommendation(recId, opts = {}) {
    const le = _le();
    if (!le) throw new Error("learning engine unavailable");
    const updated = le.updateRecommendation(recId, { status: "accepted", acceptedAt: new Date().toISOString() });
    // Optionally trigger a mission
    if (opts.createMission && updated.title) {
        const orch = _orch();
        if (orch) {
            orch.createManual({
                objective: `[Accepted Recommendation] ${updated.title}`,
                priority:  "medium",
                subtasks:  [{ description: updated.detail || updated.title }],
                metadata:  { domain: "business", source: "recommendation", recId },
            });
        }
    }
    return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// RULE REGISTRATION — forward to engineeringRuleRegistry (with business tag)
// ─────────────────────────────────────────────────────────────────────────────

function registerBusinessRule(rule) {
    const reg = _reg();
    if (!reg) throw new Error("engineeringRuleRegistry unavailable");
    return reg.registerRule({
        ...rule,
        tags: [...(rule.tags || []), "business"],
    });
}

function getBusinessRules() {
    const reg = _reg();
    if (!reg) return { rules: [], total: 0 };
    // Get business-tagged rules plus built-in BUSINESS_RULES from entityModel
    const all = reg.listRules({ limit: 500 });
    const bizRules = (all.rules || []).filter(r => (r.tags || []).includes("business"));
    return { rules: bizRules, total: bizRules.length };
}

function listIntelligenceRules() {
    return INTELLIGENCE_RULES.map(r => ({
        id:         r.id,
        name:       r.name,
        entityType: r.entityType,
        severity:   r.severity,
    }));
}

module.exports = {
    scan,
    scanLeads,
    scanDeals,
    scanCustomers,
    scanCampaigns,
    getHealthMetrics,
    getRecommendations,
    dismissRecommendation,
    acceptRecommendation,
    registerBusinessRule,
    getBusinessRules,
    scoreSignal,
    listIntelligenceRules,
    INTELLIGENCE_RULES,
};
