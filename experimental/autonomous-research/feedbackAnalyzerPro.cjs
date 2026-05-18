/**
 * Feedback Analyzer Pro — collects and analyzes execution results to drive improvement.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const STORE = "feedback-log";

const SYSTEM = `You are an execution analyst. Analyze business outcomes and identify what to improve next.
Respond ONLY with valid JSON.`;

function _score(execution = {}) {
    let score = 50;
    if (execution.success === true)  score += 20;
    if (execution.success === false) score -= 20;
    if (execution.completedSteps)    score += Math.min(execution.completedSteps * 5, 25);
    if (execution.errors?.length)    score -= execution.errors.length * 10;
    return Math.min(100, Math.max(0, score));
}

function _classify(score) {
    if (score >= 80) return { label: "Excellent", direction: "scale_up" };
    if (score >= 60) return { label: "Good",      direction: "optimize"  };
    if (score >= 40) return { label: "Fair",      direction: "iterate"   };
    return              { label: "Poor",      direction: "pivot"     };
}

async function analyze(execution = {}, goal = "") {
    const score       = _score(execution);
    const { label, direction } = _classify(score);

    const baseInsights = {
        performanceScore: score,
        performanceLabel: label,
        recommendedAction: direction,
        completedSteps:   execution.completedSteps || 0,
        totalSteps:       execution.totalSteps     || 5,
        errors:           execution.errors         || [],
        successFactors:   execution.completedSteps >= 3 ? ["Clear plan was followed", "Resources were adequate"] : [],
        failureFactors:   (execution.errors || []).slice(0, 3)
    };

    let aiInsights = null;
    try {
        const prompt = `Execution result for goal: "${goal}". Score: ${score}/100. Completed: ${execution.completedSteps || 0}/${execution.totalSteps || 5} steps. Errors: ${(execution.errors || []).join(", ") || "none"}.
What should be improved next?
JSON: { "rootCause": "...", "quickFix": "...", "nextAction": "...", "learnings": ["..."] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 300 });
        aiInsights = groq.parseJson(raw);
    } catch { /* base only */ }

    const feedback = {
        id:          uid("fb"),
        goal,
        execution,
        ...baseInsights,
        aiInsights,
        suggestions: [
            direction === "scale_up" ? "Increase budget/effort — proven model" : null,
            direction === "optimize" ? "Run A/B tests on underperforming steps" : null,
            direction === "iterate"  ? "Fix top 2 failure factors in next cycle" : null,
            direction === "pivot"    ? "Fundamentally rethink the approach" : null
        ].filter(Boolean),
        analyzedAt:  NOW()
    };

    // Persist for trend analysis
    const all = load(STORE, []);
    all.push({ id: feedback.id, goal, score, direction, analyzedAt: feedback.analyzedAt });
    flush(STORE, all.slice(-100));

    logToMemory("feedbackAnalyzerPro", goal, { score, direction });
    return feedback;
}

function getTrends(limit = 10) {
    const all = load(STORE, []);
    const recent = all.slice(-limit);
    const avgScore = recent.length ? +(recent.reduce((s, f) => s + f.score, 0) / recent.length).toFixed(1) : 0;
    const improving = recent.length >= 2 ? recent.at(-1).score > recent.at(-2).score : null;
    return { recent, avgScore, improving, trend: improving === null ? "insufficient_data" : improving ? "improving" : "declining" };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "feedback_trends") {
            data = getTrends(p.limit || 10);
        } else {
            data = await analyze(p.execution || {}, p.goal || task.input || "");
        }
        return ok("feedbackAnalyzerPro", data, ["Track every execution", "Feedback loops compound improvement"]);
    } catch (err) { return fail("feedbackAnalyzerPro", err.message); }
}

module.exports = { analyze, getTrends, run };
