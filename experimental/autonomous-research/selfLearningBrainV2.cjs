/**
 * Self-Learning Brain V2 — learns from past executions and adjusts system behavior.
 * Stores patterns, identifies what worked, and surfaces recommendations.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const STORE = "learning-brain";

const PATTERN_TYPES = {
    success:  { weight: 1.5, label: "Reinforce"  },
    failure:  { weight: 1.0, label: "Avoid"      },
    neutral:  { weight: 0.5, label: "Monitor"    }
};

function _classifyOutcome(score = 0) {
    if (score >= 70) return "success";
    if (score >= 40) return "neutral";
    return "failure";
}

function recordExecution({ goal = "", agentChain = [], score = 0, decisionScore = 0, riskLevel = "Medium", actions = [], metadata = {} }) {
    const outcomeType = _classifyOutcome(score);
    const pattern     = {
        id:           uid("pat"),
        goal:         goal.slice(0, 200),
        agentChain,
        score,
        decisionScore,
        riskLevel,
        actions,
        outcomeType,
        weight:       PATTERN_TYPES[outcomeType].weight,
        learnedAt:    NOW()
    };

    const db = load(STORE, { patterns: [], insights: [] });
    db.patterns.push(pattern);
    // Keep last 200 patterns
    db.patterns = db.patterns.slice(-200);
    flush(STORE, db);
    logToMemory("selfLearningBrainV2", goal, { outcomeType, score });
    return pattern;
}

function generateInsights() {
    const db        = load(STORE, { patterns: [], insights: [] });
    const patterns  = db.patterns;

    if (patterns.length < 3) return { message: "Insufficient data — run at least 3 executions", insights: [], recommendations: [] };

    const successes = patterns.filter(p => p.outcomeType === "success");
    const failures  = patterns.filter(p => p.outcomeType === "failure");

    // Most common success patterns
    const successChains = {};
    for (const p of successes) {
        const key = p.agentChain.join("→");
        successChains[key] = (successChains[key] || 0) + 1;
    }
    const topChain = Object.entries(successChains).sort((a, b) => b[1] - a[1])[0];

    // Common failure causes
    const failureRisks = {};
    for (const p of failures) {
        failureRisks[p.riskLevel] = (failureRisks[p.riskLevel] || 0) + 1;
    }

    const avgScore      = +(patterns.reduce((s, p) => s + p.score, 0) / patterns.length).toFixed(1);
    const successRate   = +((successes.length / patterns.length) * 100).toFixed(0);
    const improving     = patterns.length >= 6 ?
        patterns.slice(-3).reduce((s, p) => s + p.score, 0) > patterns.slice(-6, -3).reduce((s, p) => s + p.score, 0)
        : null;

    const insights = {
        totalExecutions: patterns.length,
        successRate:     successRate + "%",
        avgScore,
        trend:           improving === null ? "insufficient_data" : improving ? "improving 📈" : "declining 📉",
        bestAgentChain:  topChain ? { chain: topChain[0], occurrences: topChain[1] } : null,
        riskCorrelation: failures.length ? `High-risk executions fail ${Math.round((failureRisks.High || 0) / failures.length * 100)}% of the time` : "No failure data yet",
        recommendations: [
            successRate < 50  ? "Decision threshold may be too low — raise DECISION_THRESHOLD" : null,
            avgScore < 50     ? "Execution quality low — improve plan quality in aiDecisionMaker" : null,
            improving === false ? "Performance declining — trigger a full system review" : null,
            topChain          ? `Optimal pipeline: ${topChain[0]} — use this chain for similar goals` : null
        ].filter(Boolean),
        generatedAt: NOW()
    };

    // Persist insights
    db.insights.push({ ...insights, id: uid("ins") });
    db.insights = db.insights.slice(-20);
    flush(STORE, db);

    return insights;
}

function getKnowledge() {
    const db = load(STORE, { patterns: [], insights: [] });
    return {
        totalPatterns:   db.patterns.length,
        recentPatterns:  db.patterns.slice(-5),
        latestInsight:   db.insights.at(-1) || null
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "brain_insights") {
            data = generateInsights();
        } else if (task.type === "brain_knowledge") {
            data = getKnowledge();
        } else {
            data = recordExecution({ goal: p.goal || "", agentChain: p.agentChain || [], score: p.score || 0, decisionScore: p.decisionScore || 0, riskLevel: p.riskLevel || "Medium", actions: p.actions || [] });
        }
        return ok("selfLearningBrainV2", data, ["More data = smarter decisions", "System learns from every run"]);
    } catch (err) { return fail("selfLearningBrainV2", err.message); }
}

module.exports = { recordExecution, generateInsights, getKnowledge, run };
