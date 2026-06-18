"use strict";
/**
 * unifiedIntelligenceLayer.cjs — Phase B5: Unified Intelligence Layer
 *
 * Bridges Engineering OS and Business OS into one reasoning layer.
 * No duplicate intelligence engine. No duplicate memory. No duplicate runtime.
 *
 * Engineering stack (read-only):
 *   intelligenceLayer.cjs          → getCorrelations, getInsights, getTrends
 *   rootCauseAnalysisEngine.cjs    → listAnalyses, getStats
 *   selfHealingRuntime.cjs         → getStatus, getHistory
 *   engineeringRuleRegistry.cjs    → listRules, classifyError
 *   engineeringConfidenceEngine.cjs→ explain
 *
 * Business stack (read-only):
 *   businessIntelligenceEngine.cjs → getHealthMetrics, scan, getRecommendations
 *   businessEventAdapter.cjs       → getStats, getEventLog
 *   businessDataService.cjs        → listLeads, listOpportunities, getDashboard
 *
 * Shared (write):
 *   missionOrchestrator.cjs        → createManual (cross-domain missions)
 *   continuousLearningEngine.cjs   → createLesson (unified lessons)
 *   operationsAlertingLayer.cjs    → fire (executive alerts)
 *   missionMemory.cjs              → recordDecision (cross-domain decisions)
 *   runtimeEventBus.cjs            → emit("unified:insight")
 *
 * Public API:
 *   reason()                       → full unified intelligence report
 *   correlate()                    → engineering↔business correlation vectors
 *   getExecutiveDashboard()        → executive impact scores + top risks
 *   detectCrossDomainEvents()      → events that span eng↔biz (e.g. deploy→churn)
 *   getUnifiedRecommendations()    → merged eng+biz recommendations, deduped
 *   scoreImpact(event)             → executive impact score for any event
 *   registerCrossRule(rule)        → add a cross-domain rule
 *   listCrossRules()               → all cross-domain rule definitions
 */

const logger = require("../utils/logger");
const crypto = require("crypto");

// ── Lazy loaders — Engineering stack ─────────────────────────────────────────
function _il()   { try { return require("./intelligenceLayer.cjs");           } catch { return null; } }
function _rca()  { try { return require("./rootCauseAnalysisEngine.cjs");     } catch { return null; } }
function _heal() { try { return require("./selfHealingRuntime.cjs");          } catch { return null; } }
function _reg()  { try { return require("./engineeringRuleRegistry.cjs");     } catch { return null; } }
function _ce()   { try { return require("./engineeringConfidenceEngine.cjs"); } catch { return null; } }

// ── Lazy loaders — Business stack ─────────────────────────────────────────────
function _bie()  { try { return require("./businessIntelligenceEngine.cjs");  } catch { return null; } }
function _bea()  { try { return require("./businessEventAdapter.cjs");        } catch { return null; } }
function _bds()  { try { return require("./businessDataService.cjs");         } catch { return null; } }

// ── Lazy loaders — Shared write systems ──────────────────────────────────────
function _orch() { try { return require("./missionOrchestrator.cjs");         } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");    } catch { return null; } }
function _alert(){ try { return require("./operationsAlertingLayer.cjs");     } catch { return null; } }
function _mem()  { try { return require("./missionMemory.cjs");               } catch { return null; } }
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

// ── ID helpers ────────────────────────────────────────────────────────────────
let _seq = 0;
function _uid() { return `uil_${Date.now()}_${(++_seq).toString(36)}`; }

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-DOMAIN RULES
// Declarative rules that span engineering and business domains.
// Each rule: check(engState, bizState) → CrossDomainEvent | null
// CrossDomainEvent: { type, severity, description, recommendation,
//                    engContext, bizContext, impact, missionTrigger }
// ─────────────────────────────────────────────────────────────────────────────

const CROSS_DOMAIN_RULES = [

    {
        id:          "xdr_001",
        name:        "Deployment failure → Customer impact risk",
        description: "A deployment failure may be causing customer-visible issues",
        check(eng, biz) {
            const failedDeploys = (eng.deployments || []).filter(d => d.status === "failed" || d.outcome === "failed");
            const atRiskCustomers = (biz.customers || []).filter(c => c.status === "at_risk");
            if (!failedDeploys.length || !atRiskCustomers.length) return null;
            return {
                type:           "deploy_customer_risk",
                severity:       "critical",
                description:    `${failedDeploys.length} failed deployment(s) coincide with ${atRiskCustomers.length} at-risk customer(s)`,
                recommendation: "Correlate deploy failures with customer health — open a customer impact investigation mission",
                missionTrigger: true,
                engContext:     { failedDeploys: failedDeploys.slice(0, 3).map(d => d.id || d.version) },
                bizContext:     { atRiskCustomers: atRiskCustomers.slice(0, 3).map(c => c.id || c.name) },
                impact:         { customers: atRiskCustomers.length, deploys: failedDeploys.length },
            };
        },
    },

    {
        id:          "xdr_002",
        name:        "High bug rate → Sales risk",
        description: "Elevated engineering failure rate may affect deal closure probability",
        check(eng, biz) {
            const failRate = eng.failureRate || 0;
            if (failRate < 30) return null;
            const activeDeals = (biz.deals || []).filter(d => !["closed-won","closed-lost"].includes(d.stage));
            if (!activeDeals.length) return null;
            const dealValue = activeDeals.reduce((s, d) => s + (d.value || 0), 0);
            return {
                type:           "high_failure_rate_sales_risk",
                severity:       "warning",
                description:    `Engineering failure rate ${failRate}% may jeopardise ${activeDeals.length} open deals (pipeline: $${dealValue.toLocaleString()})`,
                recommendation: "Brief sales team on engineering status before prospect demos or proposal deadlines",
                missionTrigger: false,
                engContext:     { failureRate: failRate },
                bizContext:     { openDeals: activeDeals.length, pipelineValue: dealValue },
                impact:         { pipelineAtRisk: dealValue, dealCount: activeDeals.length },
            };
        },
    },

    {
        id:          "xdr_003",
        name:        "Bug report from customer → Engineering mission",
        description: "Customer support event should trigger an engineering investigation mission",
        check(eng, biz) {
            const bizEvents = (biz.events || []).filter(e =>
                e.source === "whatsapp" || e.source === "email" || e.source === "telegram"
            );
            const bugKeywords = /bug|error|broken|not working|crash|fail|issue|problem/i;
            const bugReports = bizEvents.filter(e =>
                bugKeywords.test(e.entityId || "") || bugKeywords.test(JSON.stringify(e).slice(0, 200))
            );
            if (!bugReports.length) return null;
            return {
                type:           "customer_bug_report",
                severity:       "warning",
                description:    `${bugReports.length} inbound customer message(s) contain bug/error keywords`,
                recommendation: "Create an engineering investigation mission linked to the customer report",
                missionTrigger: true,
                engContext:     { suggestedAction: "root_cause_analysis" },
                bizContext:     { reports: bugReports.slice(0, 3).map(e => e.eventId) },
                impact:         { reportCount: bugReports.length },
            };
        },
    },

    {
        id:          "xdr_004",
        name:        "Payment received → Onboarding mission",
        description: "Payment event should auto-trigger a customer onboarding engineering mission",
        check(eng, biz) {
            const payEvents = (biz.events || []).filter(e => e.source === "payment" && e.status === "ingested");
            const newCustomers = (biz.customers || []).filter(c =>
                c.status === "onboarding" &&
                (Date.now() - new Date(c.createdAt || 0).getTime()) < 24 * 3600 * 1000
            );
            if (!payEvents.length && !newCustomers.length) return null;
            const count = Math.max(payEvents.length, newCustomers.length);
            return {
                type:           "payment_onboarding_trigger",
                severity:       "info",
                description:    `${count} new payment/customer event(s) pending engineering onboarding setup`,
                recommendation: "Trigger infrastructure/account provisioning mission for new customers",
                missionTrigger: true,
                engContext:     { action: "provision_customer_environment" },
                bizContext:     { payEvents: payEvents.length, newCustomers: newCustomers.length },
                impact:         { newCustomers: count },
            };
        },
    },

    {
        id:          "xdr_005",
        name:        "Engineering healing loop active → Notify sales",
        description: "Self-healing events indicate production instability customers may notice",
        check(eng, biz) {
            const healEvents = (eng.healingHistory || []).filter(h => h.status === "healed" || h.outcome === "recovered");
            if (healEvents.length < 3) return null;
            const activeDeals = (biz.deals || []).filter(d => d.stage === "proposal" || d.stage === "negotiation");
            if (!activeDeals.length) return null;
            return {
                type:           "heal_loop_sales_risk",
                severity:       "warning",
                description:    `${healEvents.length} self-healing events in recent history while ${activeDeals.length} deal(s) are in proposal/negotiation`,
                recommendation: "Prepare engineering stability report for sales team — production incidents affect enterprise close rates",
                missionTrigger: false,
                engContext:     { healEvents: healEvents.length },
                bizContext:     { dealsAtRisk: activeDeals.map(d => d.title || d.id).slice(0, 3) },
                impact:         { dealsAtRisk: activeDeals.length },
            };
        },
    },

    {
        id:          "xdr_006",
        name:        "Stalled lead → Check deployment freshness",
        description: "Long-stalled leads may indicate a product demo or trial environment issue",
        check(eng, biz) {
            const stalledLeads = (biz.leads || []).filter(l =>
                ["new","contacted"].includes(l.status) &&
                (Date.now() - new Date(l.updatedAt || l.createdAt || 0).getTime()) > 14 * 24 * 3600 * 1000
            );
            if (stalledLeads.length < 3) return null;
            const lastDeploy = eng.lastDeployAt ? (Date.now() - new Date(eng.lastDeployAt).getTime()) / (24 * 3600 * 1000) : null;
            if (lastDeploy !== null && lastDeploy < 7) return null; // recent deploy — not the issue
            return {
                type:           "stalled_leads_stale_deploy",
                severity:       "info",
                description:    `${stalledLeads.length} leads stalled >14 days — possibly related to stale product/demo environment`,
                recommendation: "Verify demo environment is up-to-date and performing well",
                missionTrigger: false,
                engContext:     { lastDeployDaysAgo: lastDeploy ? Math.floor(lastDeploy) : "unknown" },
                bizContext:     { stalledLeads: stalledLeads.length },
                impact:         { stalledLeads: stalledLeads.length },
            };
        },
    },

    {
        id:          "xdr_007",
        name:        "Campaign launch → Engineering readiness",
        description: "Active marketing campaign may drive traffic spikes engineering should prepare for",
        check(eng, biz) {
            const activeCamps = (biz.campaigns || []).filter(c => c.status === "active");
            if (!activeCamps.length) return null;
            const highImpression = activeCamps.filter(c => (c.metrics?.impressions || 0) > 500);
            if (!highImpression.length) return null;
            const runtimeIssues = (eng.topErrors || []).length > 0;
            if (!runtimeIssues) return null;
            return {
                type:           "campaign_engineering_readiness",
                severity:       "warning",
                description:    `${highImpression.length} high-traffic campaign(s) active while engineering has open runtime errors`,
                recommendation: "Resolve top runtime errors before campaign traffic peaks",
                missionTrigger: true,
                engContext:     { openErrors: eng.topErrors?.length || 0 },
                bizContext:     { activeCampaigns: highImpression.map(c => c.name).slice(0, 3) },
                impact:         { impressionsAtRisk: highImpression.reduce((s,c) => s+(c.metrics?.impressions||0),0) },
            };
        },
    },
];

// ── Custom rules (runtime-registered) ────────────────────────────────────────
const _customRules = [];

function registerCrossRule(rule) {
    if (!rule.id || !rule.name || typeof rule.check !== "function") {
        throw new Error("Cross-domain rule requires: id, name, check(eng,biz)→event|null");
    }
    _customRules.push(rule);
    logger.info(`[UnifiedIntel] Registered custom cross-domain rule: ${rule.id}`);
    return { registered: true, id: rule.id };
}

function listCrossRules() {
    return [...CROSS_DOMAIN_RULES, ..._customRules].map(r => ({
        id: r.id, name: r.name, description: r.description,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE READERS — pull current state from each domain (non-blocking best-effort)
// ─────────────────────────────────────────────────────────────────────────────

function _readEngState() {
    const state = {
        failureRate: 0, deployments: [], healingHistory: [], topErrors: [], lastDeployAt: null,
        rcaStats: null, correlations: null, insights: null,
    };
    try {
        const rcaStats = _rca()?.getStats?.();
        if (rcaStats) {
            state.rcaStats     = rcaStats;
            state.failureRate  = rcaStats.totalFailures > 0
                ? Math.round((rcaStats.resolvedCount || 0) / rcaStats.totalFailures * 100)
                : 0;
            // Invert: failureRate should be % that are unresolved
            const unresolved = (rcaStats.totalFailures || 0) - (rcaStats.resolvedCount || 0);
            state.failureRate  = rcaStats.totalFailures > 0
                ? Math.round(unresolved / rcaStats.totalFailures * 100)
                : 0;
        }
    } catch {}
    try { state.correlations = _il()?.getCorrelations?.(); } catch {}
    try { state.insights     = _il()?.getInsights?.();     } catch {}
    try {
        const healStatus = _heal()?.getStatus?.();
        state.healingHistory = healStatus?.recentEvents || [];
    } catch {}
    try {
        const healHist = _heal()?.getHistory?.({ limit: 20 });
        state.healingHistory = healHist?.history || state.healingHistory;
    } catch {}
    try {
        // Read deployments from data file directly (same as intelligenceLayer)
        const fs = require("fs"); const path = require("path");
        const f = path.join(__dirname, "../../data/deploy_meta.json");
        if (fs.existsSync(f)) {
            const d = JSON.parse(fs.readFileSync(f, "utf8"));
            state.deployments  = Array.isArray(d) ? d.slice(-10) : [];
            const last = state.deployments[state.deployments.length - 1];
            state.lastDeployAt = last?.deployedAt || last?.createdAt || null;
        }
    } catch {}
    try {
        const fs = require("fs"); const path = require("path");
        const f = path.join(__dirname, "../../data/observability.json");
        if (fs.existsSync(f)) {
            const d = JSON.parse(fs.readFileSync(f, "utf8"));
            state.topErrors = (Array.isArray(d) ? d : d.errors || []).slice(0, 10);
        }
    } catch {}
    return state;
}

function _readBizState() {
    const state = {
        leads: [], deals: [], customers: [], campaigns: [], events: [],
        health: null, dashboard: null,
    };
    try {
        const bds = _bds();
        if (bds) {
            state.leads     = bds.listLeads({ limit: 500 }).items || [];
            state.deals     = bds.listOpportunities({ limit: 500 }).items || [];
            state.campaigns = bds.listCampaigns({ limit: 100 }).items || [];
            state.dashboard = bds.getDashboard();
        }
    } catch {}
    try {
        const contacts = _bds()?.listContacts?.({ limit: 500 });
        state.customers = (contacts?.items || []).filter(c => c.status);
    } catch {}
    try {
        const evLog = _bea()?.getEventLog?.({ limit: 100 });
        state.events = evLog?.events || [];
    } catch {}
    try {
        state.health = _bie()?.getHealthMetrics?.();
    } catch {}
    return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATE — run all cross-domain rules against current state
// ─────────────────────────────────────────────────────────────────────────────

function correlate() {
    const eng   = _readEngState();
    const biz   = _readBizState();
    const rules  = [...CROSS_DOMAIN_RULES, ..._customRules];
    const events = [];

    for (const rule of rules) {
        try {
            const ev = rule.check(eng, biz);
            if (!ev) continue;
            // Score confidence via engineeringConfidenceEngine
            let confidence = 60;
            try {
                const scored = _ce()?.explain(`${ev.type}: ${ev.description}`, { capability: `cross_domain:${ev.type}`, problemClass: ev.type });
                confidence = scored?.confidence || 60;
            } catch {}
            events.push({
                crossEventId: _uid(),
                ruleId:       rule.id,
                ruleName:     rule.name,
                confidence,
                detectedAt:   new Date().toISOString(),
                ...ev,
            });
        } catch (e) {
            logger.warn(`[UnifiedIntel] Rule ${rule.id} failed: ${e.message}`);
        }
    }

    return { crossDomainEvents: events, total: events.length, engState: { failureRate: eng.failureRate, healEvents: eng.healingHistory?.length || 0 }, bizState: { healthScore: biz.health?.healthScore, leads: biz.leads.length, deals: biz.deals.length } };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED RECOMMENDATIONS — merge eng + biz, deduplicate, rank by impact
// ─────────────────────────────────────────────────────────────────────────────

function getUnifiedRecommendations(opts = {}) {
    const limit = opts.limit || 20;
    const recs  = [];

    // Engineering recommendations (from continuousLearningEngine / intelligenceLayer)
    try {
        const engRecs = _le()?.getRecommendations({ status: "open", limit: 50 });
        for (const r of engRecs?.recommendations || []) {
            recs.push({ ...r, domain: "engineering", source: r.source || "engineering" });
        }
    } catch {}

    // Business signals (from businessIntelligenceEngine scan — dryRun)
    try {
        const bizScan = _bie()?.scan?.({ dryRun: true });
        for (const sig of bizScan?.signals || []) {
            recs.push({
                recId:      `bizsig_${sig.signalId}`,
                title:      `[BIZ] ${sig.type}: ${sig.description.slice(0, 100)}`,
                detail:     sig.recommendation,
                priority:   sig.urgency === "critical" ? 1 : sig.urgency === "high" ? 2 : 3,
                status:     "open",
                domain:     "business",
                confidence: sig.confidence,
                entityType: sig.entityType,
                entityId:   sig.entityId,
            });
        }
    } catch {}

    // Cross-domain events from correlate()
    try {
        const crossEvts = correlate().crossDomainEvents;
        for (const ev of crossEvts) {
            recs.push({
                recId:    `xdr_${ev.crossEventId}`,
                title:    `[CROSS] ${ev.ruleName}`,
                detail:   `${ev.description} — ${ev.recommendation}`,
                priority: ev.severity === "critical" ? 1 : ev.severity === "warning" ? 2 : 3,
                status:   "open",
                domain:   "cross",
                confidence: ev.confidence,
                impact:   ev.impact,
            });
        }
    } catch {}

    // Deduplicate by title prefix, sort by priority then confidence
    const seen = new Set();
    const deduped = recs.filter(r => {
        const key = (r.title || "").slice(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    deduped.sort((a, b) => (a.priority - b.priority) || ((b.confidence || 0) - (a.confidence || 0)));

    return { recommendations: deduped.slice(0, limit), total: deduped.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTIVE IMPACT SCORE — score any event against business + engineering health
// ─────────────────────────────────────────────────────────────────────────────

function scoreImpact(event) {
    if (!event) throw new Error("event object required");

    const eng = _readEngState();
    const biz = _readBizState();

    // Base score factors
    let score      = 0;
    const factors  = [];

    // Engineering signal
    if (event.domain === "engineering" || event.type?.includes("fail") || event.type?.includes("error")) {
        const fRate = eng.failureRate || 0;
        const fScore = Math.min(40, fRate * 0.5);
        score += fScore;
        factors.push({ name: "engineering_failure_rate", contribution: fScore, detail: `${fRate}% failure rate` });
    }

    // Business health
    if (biz.health?.healthScore !== undefined) {
        const bizPenalty = Math.max(0, (100 - biz.health.healthScore) * 0.3);
        score += bizPenalty;
        factors.push({ name: "business_health_deficit", contribution: bizPenalty, detail: `health score: ${biz.health.healthScore}` });
    }

    // Active deals at risk
    const openDeals    = (biz.deals || []).filter(d => !["closed-won","closed-lost"].includes(d.stage));
    const dealValue    = openDeals.reduce((s, d) => s + (d.value || 0), 0);
    if (dealValue > 0) {
        const dealScore = Math.min(20, Math.log10(dealValue + 1) * 3);
        score += dealScore;
        factors.push({ name: "pipeline_at_risk", contribution: dealScore, detail: `$${dealValue.toLocaleString()} open pipeline` });
    }

    // At-risk customers
    const atRisk = (biz.customers || []).filter(c => c.status === "at_risk").length;
    if (atRisk > 0) {
        const custScore = Math.min(15, atRisk * 5);
        score += custScore;
        factors.push({ name: "at_risk_customers", contribution: custScore, detail: `${atRisk} at-risk` });
    }

    // Severity multiplier
    const sevMult = event.severity === "critical" ? 1.4 : event.severity === "warning" ? 1.2 : 1.0;
    score = Math.min(100, Math.round(score * sevMult));

    // Confidence scoring
    let confidence = 60;
    try {
        const scored = _ce()?.explain(`${event.type || "unknown"}: ${event.description || ""}`, { problemClass: event.type });
        confidence = scored?.confidence || 60;
    } catch {}

    return {
        impactScore:  score,
        confidence,
        severity:     score >= 70 ? "critical" : score >= 40 ? "warning" : "info",
        factors,
        context: {
            engineeringFailureRate: eng.failureRate,
            businessHealthScore:    biz.health?.healthScore,
            openPipelineValue:      dealValue,
            atRiskCustomers:        atRisk,
        },
        scoredAt: new Date().toISOString(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTIVE DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function getExecutiveDashboard() {
    const eng  = _readEngState();
    const biz  = _readBizState();
    const corr = correlate();

    // Top risks = critical cross-domain events + high-confidence signals
    const topRisks = corr.crossDomainEvents
        .filter(e => e.severity === "critical" || e.severity === "warning")
        .slice(0, 5)
        .map(e => ({
            id:          e.crossEventId,
            domain:      "cross",
            type:        e.type,
            severity:    e.severity,
            description: e.description,
            action:      e.recommendation,
            impact:      e.impact,
            confidence:  e.confidence,
        }));

    // Engineering KPIs
    const engKPIs = {
        failureRate:    eng.failureRate,
        healingEvents:  eng.healingHistory?.length || 0,
        recentDeploys:  eng.deployments?.length || 0,
        lastDeployAt:   eng.lastDeployAt,
        openRCAs:       eng.rcaStats?.totalFailures || 0,
    };

    // Business KPIs
    const health   = biz.health || {};
    const bizKPIs  = {
        healthScore:      health.healthScore || 0,
        pipelineValue:    health.pipeline?.pipelineValue || 0,
        winRate:          health.pipeline?.winRate || 0,
        atRiskCustomers:  health.leads?.idle7d || 0,
        activeLeads:      health.leads?.total || 0,
        conversionRate:   health.leads?.conversionRate || 0,
        revenueThisMonth: health.revenue?.thisMonth || 0,
    };

    // Overall system health score (0–100)
    const systemScore = Math.round(
        ((100 - (eng.failureRate || 0)) * 0.35) +
        ((health.healthScore || 50) * 0.35)     +
        (Math.min(100, (health.pipeline?.winRate || 0) * 2) * 0.15) +
        (Math.max(0, 100 - (corr.crossDomainEvents.filter(e=>e.severity==="critical").length * 20)) * 0.15)
    );

    return {
        computedAt:           new Date().toISOString(),
        systemHealthScore:    Math.max(0, Math.min(100, systemScore)),
        topRisks,
        crossDomainEvents:    corr.crossDomainEvents.length,
        engineering:          engKPIs,
        business:             bizKPIs,
        correlations: {
            total:            corr.total,
            critical:         corr.crossDomainEvents.filter(e => e.severity === "critical").length,
            warning:          corr.crossDomainEvents.filter(e => e.severity === "warning").length,
            info:             corr.crossDomainEvents.filter(e => e.severity === "info").length,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECT CROSS-DOMAIN EVENTS — with mission creation for actionable ones
// ─────────────────────────────────────────────────────────────────────────────

function detectCrossDomainEvents(opts = {}) {
    const { dryRun = false } = opts;
    const result = correlate();
    const triggered = [];

    for (const ev of result.crossDomainEvents) {
        if (!ev.missionTrigger) continue;
        if (dryRun) { triggered.push({ type: ev.type, missionId: null, dry: true }); continue; }
        try {
            const priority = ev.severity === "critical" ? "critical" : ev.severity === "warning" ? "high" : "medium";
            const mission  = _orch()?.createManual({
                objective: `[Cross-Domain] ${ev.recommendation}`,
                priority,
                subtasks: [
                    { description: `Signal: ${ev.description}` },
                    { description: ev.recommendation },
                    { description: `Engineering context: ${JSON.stringify(ev.engContext || {})}` },
                    { description: `Business context: ${JSON.stringify(ev.bizContext || {})}` },
                    { description: "Verify resolution and close mission" },
                ],
                metadata: {
                    domain:      "cross",
                    ruleId:      ev.ruleId,
                    crossEvent:  ev.type,
                    engContext:  ev.engContext,
                    bizContext:  ev.bizContext,
                    autoCreated: true,
                },
            });
            const missionId = mission?.missionId || mission?.id;
            triggered.push({ type: ev.type, missionId, ruleId: ev.ruleId });

            // Alert
            _alert()?.fire({
                title:    `[CrossDomain] ${ev.ruleName}`,
                message:  ev.description,
                severity: ev.severity,
                source:   "unifiedIntelligenceLayer",
            });

            // Lesson
            _le()?.createLesson({
                type:          "cross_domain_event",
                title:         `[CROSS] ${ev.type}: ${ev.description.slice(0, 100)}`,
                detail:        ev.recommendation,
                severity:      ev.severity,
                sourcePattern: ev.type,
                source:        "unifiedIntelligenceLayer",
            });

            // EventBus
            _bus()?.emit("unified:insight", { ruleId: ev.ruleId, type: ev.type, severity: ev.severity, missionId });

        } catch (e) {
            logger.warn(`[UnifiedIntel] Mission trigger failed for ${ev.type}: ${e.message}`);
        }
    }

    return {
        crossDomainEvents: result.crossDomainEvents,
        missionTriggered:  triggered,
        total:             result.crossDomainEvents.length,
        triggered:         triggered.length,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// REASON — full unified report
// ─────────────────────────────────────────────────────────────────────────────

function reason(opts = {}) {
    const startedAt    = new Date().toISOString();
    const dashboard    = getExecutiveDashboard();
    const crossEvents  = detectCrossDomainEvents({ dryRun: opts.dryRun });
    const unified      = getUnifiedRecommendations({ limit: 15 });

    const completedAt = new Date().toISOString();
    logger.info(`[UnifiedIntel] Reason complete — crossEvents: ${crossEvents.total}, missions: ${crossEvents.triggered}, systemScore: ${dashboard.systemHealthScore}`);

    return {
        startedAt,
        completedAt,
        systemHealthScore:    dashboard.systemHealthScore,
        crossDomainEvents:    crossEvents.total,
        missionsTriggered:    crossEvents.triggered,
        topRisks:             dashboard.topRisks,
        engineering:          dashboard.engineering,
        business:             dashboard.business,
        correlations:         dashboard.correlations,
        recommendations:      unified.recommendations,
        recommendationCount:  unified.total,
        events:               crossEvents.crossDomainEvents,
        missionDetails:       crossEvents.missionTriggered,
    };
}

module.exports = {
    reason,
    correlate,
    getExecutiveDashboard,
    detectCrossDomainEvents,
    getUnifiedRecommendations,
    scoreImpact,
    registerCrossRule,
    listCrossRules,
    CROSS_DOMAIN_RULES,
};
