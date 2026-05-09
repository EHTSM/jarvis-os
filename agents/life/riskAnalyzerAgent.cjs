/**
 * Risk Analyzer Agent — assess financial risk tolerance. Educational only.
 */

const { uid, NOW, logToMemory, ok, fail, FINANCE_DISCLAIMER } = require("./_lifeStore.cjs");

// Risk questionnaire with scoring
const QUESTIONS = [
    {
        id: "age",
        question: "What is your age group?",
        options: [
            { label: "18-25", score: 5 },
            { label: "26-35", score: 4 },
            { label: "36-45", score: 3 },
            { label: "46-55", score: 2 },
            { label: "55+",   score: 1 }
        ]
    },
    {
        id: "horizon",
        question: "How long can you keep your money invested?",
        options: [
            { label: "Less than 1 year", score: 1 },
            { label: "1-3 years",        score: 2 },
            { label: "3-5 years",        score: 3 },
            { label: "5-10 years",       score: 4 },
            { label: "10+ years",        score: 5 }
        ]
    },
    {
        id: "reaction",
        question: "If your portfolio dropped 20% in a month, what would you do?",
        options: [
            { label: "Sell everything immediately",     score: 1 },
            { label: "Sell some to reduce risk",        score: 2 },
            { label: "Do nothing and wait",             score: 3 },
            { label: "Buy a little more",               score: 4 },
            { label: "Buy aggressively — great deal!",  score: 5 }
        ]
    },
    {
        id: "income_stability",
        question: "How stable is your income?",
        options: [
            { label: "Very unstable (freelance/irregular)", score: 1 },
            { label: "Somewhat unstable",                   score: 2 },
            { label: "Moderately stable",                   score: 3 },
            { label: "Very stable (salaried)",              score: 4 },
            { label: "Multiple income streams",             score: 5 }
        ]
    },
    {
        id: "emergency_fund",
        question: "Do you have an emergency fund (3-6 months expenses)?",
        options: [
            { label: "No",                     score: 1 },
            { label: "Less than 1 month",      score: 2 },
            { label: "1-3 months",             score: 3 },
            { label: "3-6 months",             score: 4 },
            { label: "More than 6 months",     score: 5 }
        ]
    }
];

const RISK_PROFILES = [
    { label: "Conservative",       minScore: 5,  maxScore: 10, equity: 20, debt: 65, gold: 15, description: "Prioritize capital preservation. Avoid high-risk assets." },
    { label: "Moderately Conservative", minScore: 11, maxScore: 14, equity: 35, debt: 50, gold: 15, description: "Slightly higher returns with limited risk." },
    { label: "Moderate",           minScore: 15, maxScore: 18, equity: 50, debt: 35, gold: 15, description: "Balanced approach. Long-term growth with manageable volatility." },
    { label: "Moderately Aggressive", minScore: 19, maxScore: 21, equity: 65, debt: 25, gold: 10, description: "Growth-focused. Comfortable with market swings." },
    { label: "Aggressive",         minScore: 22, maxScore: 25, equity: 80, debt: 10, gold: 10, description: "Maximum growth. High risk tolerance and long time horizon." }
];

function getQuestions() {
    return { questions: QUESTIONS, instructions: "Answer each question to get your risk profile. Higher score = higher risk tolerance." };
}

function assess({ answers = {}, userId = "" }) {
    const totalScore = QUESTIONS.reduce((sum, q) => {
        const answer = answers[q.id];
        const option = q.options.find(o => o.label === answer || o.score === answer);
        return sum + (option?.score || 3);
    }, 0);

    const profile = RISK_PROFILES.find(p => totalScore >= p.minScore && totalScore <= p.maxScore) || RISK_PROFILES[2];

    const result = {
        id:         uid("risk"),
        userId,
        score:      totalScore,
        maxScore:   25,
        profile:    profile.label,
        description: profile.description,
        suggestedAllocation: { equity: profile.equity + "%", debt: profile.debt + "%", gold: profile.gold + "%" },
        redFlags: [
            !answers.emergency_fund || answers.emergency_fund === "No" ? "⚠️ No emergency fund — build this before investing." : null,
            totalScore < 10 ? "⚠️ Very low risk tolerance — stick to FD, PPF, and liquid MFs." : null
        ].filter(Boolean),
        nextSteps: [
            `Your profile is ${profile.label} — consult a SEBI-registered advisor for personalized portfolio construction.`,
            "Re-assess your risk profile every 2-3 years or after major life changes.",
            "Never invest beyond your actual risk tolerance — financial and emotional."
        ],
        disclaimer: FINANCE_DISCLAIMER,
        assessedAt: NOW()
    };

    logToMemory("riskAnalyzerAgent", `${userId}:assess`, { score: totalScore, profile: profile.label });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "risk_questions") {
            data = getQuestions();
        } else {
            data = assess({ answers: p.answers || {}, userId: p.userId || "" });
        }
        return ok("riskAnalyzerAgent", data, ["Risk tolerance is personal — be honest", "Low risk tolerance is perfectly valid"]);
    } catch (err) { return fail("riskAnalyzerAgent", err.message); }
}

module.exports = { getQuestions, assess, QUESTIONS, RISK_PROFILES, run };
