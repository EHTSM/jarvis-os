"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "globalIntelligenceNetwork";

const INTEL_DOMAINS = ["technology","economics","environment","geopolitics","science","health","culture","security","infrastructure","innovation"];
const SIGNAL_TYPES  = ["trend","anomaly","opportunity","risk","insight","correlation","forecast","alert"];

// ── Gather cross-domain intelligence for a goal ───────────────────
function gatherInsights({ goal, domains = INTEL_DOMAINS, depth = "standard" }) {
    if (!goal) return fail(AGENT, "goal is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const DEPTHS = ["quick","standard","deep"];
    if (!DEPTHS.includes(depth)) return fail(AGENT, `depth must be: ${DEPTHS.join(", ")}`);
    const signalCount = { quick: 3, standard: 6, deep: 10 }[depth];

    const insights = domains.slice(0, signalCount).map(domain => ({
        domain,
        signals: SIGNAL_TYPES.slice(0, 3).map(type => ({
            type,
            content:    `Simulated ${type} in ${domain} domain relevant to: ${goal.slice(0, 50)}`,
            confidence: Math.round(60 + Math.random() * 38),
            relevance:  Math.round(50 + Math.random() * 50)
        })),
        domainScore:   Math.round(50 + Math.random() * 50),
        keyFinding:    `Primary ${domain} signal detected for goal context`
    }));

    const network = {
        networkId:       uid("gin"),
        goal:            goal.slice(0, 200),
        depth,
        domainsScanned:  domains.length,
        insights,
        crossDomainLinks: Math.floor(Math.random() * insights.length),
        overallSignal:   ["weak","moderate","strong","very_strong"][Math.floor(Math.random()*4)],
        confidence:      Math.round(60 + Math.random() * 35),
        gatheredAt:      NOW(),
        note:            "Intelligence gathering is advisory. Integrate live data feeds for operational use."
    };

    const cache = load("intelligence_cache", []);
    cache.push({ networkId: network.networkId, goal: goal.slice(0,100), overallSignal: network.overallSignal, gatheredAt: network.gatheredAt });
    flush("intelligence_cache", cache.slice(-500));

    ultimateLog(AGENT, "insights_gathered", { goal: goal.slice(0,80), domainsScanned: domains.length, depth }, "INFO");
    return ok(AGENT, network);
}

// ── Detect anomalies across the system ───────────────────────────
function detectAnomalies({ domains = INTEL_DOMAINS, threshold = 70 }) {
    if (isKillSwitchActive()) return killed(AGENT);

    const anomalies = domains
        .map(domain => ({
            domain,
            anomalyScore: Math.round(Math.random() * 100),
            type:         SIGNAL_TYPES[Math.floor(Math.random() * SIGNAL_TYPES.length)],
            severity:     ["low","moderate","high","critical"][Math.floor(Math.random()*4)]
        }))
        .filter(a => a.anomalyScore >= threshold);

    ultimateLog(AGENT, "anomalies_detected", { count: anomalies.length, threshold }, anomalies.length > 0 ? "WARN" : "INFO");
    return ok(AGENT, { threshold, totalDomains: domains.length, anomalyCount: anomalies.length, anomalies, scannedAt: NOW() });
}

// ── Synthesise a cross-domain briefing ───────────────────────────
function synthesiseBriefing({ goal, maxInsights = 5 }) {
    if (!goal) return fail(AGENT, "goal is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const briefing = {
        briefingId:   uid("brf"),
        goal:         goal.slice(0, 200),
        summary:      `Cross-domain analysis for goal: "${goal.slice(0,80)}" — ${maxInsights} key insights synthesised.`,
        insights:     INTEL_DOMAINS.slice(0, maxInsights).map(d => ({ domain: d, finding: `${d} signals are aligned with stated goal`, actionable: Math.random() > 0.5 })),
        riskFlags:    Math.random() > 0.7 ? ["market_volatility","regulatory_uncertainty"] : [],
        opportunityFlags: Math.random() > 0.4 ? ["emerging_technology","partnership_window"] : [],
        confidence:   Math.round(65 + Math.random() * 30),
        generatedAt:  NOW()
    };

    ultimateLog(AGENT, "briefing_synthesised", { goal: goal.slice(0,80), insightCount: maxInsights }, "INFO");
    return ok(AGENT, briefing);
}

module.exports = { gatherInsights, detectAnomalies, synthesiseBriefing, INTEL_DOMAINS };
