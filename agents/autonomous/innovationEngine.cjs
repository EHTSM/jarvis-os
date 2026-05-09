/**
 * Innovation Engine — generates novel product and business ideas using structured creativity.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a serial innovator. Generate specific, validated, high-potential ideas.
No vague concepts — every idea must have a clear customer, pain, and revenue model. Respond ONLY with valid JSON.`;

const INNOVATION_FRAMEWORKS = {
    scamper: ["Substitute", "Combine", "Adapt", "Modify", "Put to other uses", "Eliminate", "Reverse"],
    blue_ocean: ["Eliminate", "Reduce", "Raise", "Create"],
    jobs_to_be_done: { question: "What job is the customer hiring this product to do?" },
    first_principles: { question: "Break the problem down to its fundamentals — what is absolutely true?" }
};

const TREND_ACCELERATORS = [
    "AI / Automation",
    "Remote work infrastructure",
    "Creator economy tools",
    "Health + wellness tech",
    "Financial inclusion (emerging markets)",
    "Climate / sustainability",
    "Education disruption",
    "Web3 / decentralization (cautious)"
];

async function generate({ domain = "", constraints = [], framework = "scamper", userId = "" }) {
    const frameworkSteps = INNOVATION_FRAMEWORKS[framework] || INNOVATION_FRAMEWORKS.scamper;

    let aiIdeas = null;
    try {
        const prompt = `Generate 3 innovative business ideas in "${domain}" space. Constraints: ${constraints.join(", ") || "none"}.
Framework: ${framework}. Each idea must have a specific customer segment and clear revenue model.
JSON: { "ideas": [{ "title": "...", "customer": "...", "pain": "...", "solution": "...", "revenue": "...", "differentiation": "...", "viabilityScore": 75 }] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        aiIdeas    = groq.parseJson(raw);
    } catch { /* template */ }

    const templateIdeas = [
        { title: `AI-powered ${domain} assistant`,      customer: "SMBs",       pain: "Too much manual work",        revenue: "₹499/mo SaaS", viabilityScore: 78 },
        { title: `${domain} marketplace platform`,       customer: "Freelancers", pain: "Hard to find quality clients", revenue: "15% commission",  viabilityScore: 65 },
        { title: `${domain} analytics dashboard`,        customer: "Agencies",   pain: "No visibility into performance", revenue: "₹1999/mo",       viabilityScore: 72 }
    ];

    const result = {
        id:           uid("innov"),
        userId,
        domain,
        framework,
        ideas:        aiIdeas?.ideas || templateIdeas,
        trendContext: TREND_ACCELERATORS.slice(0, 4),
        frameworkSteps: Array.isArray(frameworkSteps) ? frameworkSteps : [frameworkSteps.question],
        evaluationCriteria: [
            "Does a specific, reachable customer exist?",
            "Is the pain acute enough to pay for a solution?",
            "Can it generate ₹50,000+ MRR in 12 months?",
            "Is there a clear unfair advantage?"
        ],
        createdAt:    NOW()
    };

    logToMemory("innovationEngine", domain || framework, { ideas: result.ideas.length });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ domain: p.domain || p.niche || "AI tools", constraints: p.constraints || [], framework: p.framework || "scamper", userId: p.userId || "" });
        return ok("innovationEngine", data, ["Ideas are worthless without execution", "Validate before falling in love with an idea"]);
    } catch (err) { return fail("innovationEngine", err.message); }
}

module.exports = { generate, INNOVATION_FRAMEWORKS, TREND_ACCELERATORS, run };
