/**
 * Startup Builder Agent — generates validated startup ideas and full launch plans.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a startup advisor. Generate specific, validated startup plans — not vague concepts.
Respond ONLY with valid JSON.`;

const STARTUP_TEMPLATES = {
    saas: {
        structure:   ["Landing page", "Auth system", "Core feature", "Payment integration", "Dashboard"],
        mvpTimeline: "6-8 weeks",
        revenue:     "Subscription (₹499-₹4999/month)",
        stack:       ["Node.js/Next.js", "PostgreSQL/Firebase", "Stripe/Razorpay", "Vercel/Railway"]
    },
    marketplace: {
        structure:   ["Buyer side", "Seller side", "Transaction system", "Review system", "Admin panel"],
        mvpTimeline: "10-12 weeks",
        revenue:     "Commission (5-15%) + listing fees",
        stack:       ["React + Node.js", "PostgreSQL", "Stripe Connect", "AWS"]
    },
    ai_tool: {
        structure:   ["Prompt interface", "AI integration", "Output formatter", "Usage limits", "Payment"],
        mvpTimeline: "3-4 weeks",
        revenue:     "Pay-per-use or credits",
        stack:       ["Next.js", "OpenAI/Anthropic API", "Supabase", "Stripe"]
    }
};

async function generate({ problem = "", market = "", budget = "₹10,000", timeline = "3 months", type = "saas", userId = "" }) {
    const template = STARTUP_TEMPLATES[type] || STARTUP_TEMPLATES.saas;

    let aiPlan = null;
    try {
        const prompt = `Generate a startup plan. Problem: "${problem}". Market: "${market}". Budget: ${budget}. Timeline: ${timeline}.
JSON: {
  "startupName": "...", "tagline": "...", "problemStatement": "...", "solution": "...",
  "targetCustomer": "...", "uniqueAdvantage": "...",
  "revenueProjection": { "month3": "₹...", "month6": "₹...", "month12": "₹..." },
  "competitors": ["..."], "differentiator": "...", "nextStep": "..."
}`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        aiPlan     = groq.parseJson(raw);
    } catch { /* template */ }

    const plan = {
        id:       uid("startup"),
        userId,
        input:    { problem, market, budget, timeline, type },
        template,
        aiPlan,
        milestones: [
            { week: "1-2",   task: "Customer validation — talk to 10 potential users" },
            { week: "3-4",   task: "Build MVP — core feature only" },
            { week: "5-6",   task: "Soft launch — 50 beta users" },
            { week: "7-8",   task: "Iterate on feedback — fix top 3 issues" },
            { week: "9-12",  task: "Growth phase — first paying customers" }
        ],
        checklist: [
            "Validate problem with 10 real people",
            "Define 1 core feature (not 10)",
            "Set up payments before building anything else",
            "Launch publicly by week 6 — done > perfect",
            "Track 3 KPIs only: signups, activation, revenue"
        ],
        createdAt: NOW()
    };

    logToMemory("startupBuilderAgent", problem || type, { market, budget });
    return plan;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ problem: p.problem || p.idea || "", market: p.market || "", budget: p.budget || "₹10,000", timeline: p.timeline || "3 months", type: p.type || "saas", userId: p.userId || "" });
        return ok("startupBuilderAgent", data, ["Validate before building", "Charge from day 1"]);
    } catch (err) { return fail("startupBuilderAgent", err.message); }
}

module.exports = { generate, run };
