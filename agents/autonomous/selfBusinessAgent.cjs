/**
 * Self Business Agent — orchestrates content + marketing + sales + workflow into a unified business system.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, approvalRequired, isHighRisk } = require("./_autoStore.cjs");

const SYSTEM = `You are an autonomous business builder AI. Generate complete, actionable business systems.
Respond ONLY with valid JSON.`;

const BUSINESS_MODULES = {
    content:   ["blog", "social posts", "email newsletter", "video scripts"],
    marketing: ["SEO strategy", "paid ads brief", "influencer outreach template", "launch plan"],
    sales:     ["lead magnet", "sales funnel", "email sequence", "pricing tiers"],
    workflow:  ["onboarding checklist", "fulfillment process", "support templates", "KPI dashboard"]
};

async function buildSystem({ businessType = "saas", niche = "productivity", monthlyBudget = 5000, actions = [], userId = "" }) {
    // Safety gate
    const riskyActions = actions.filter(a => isHighRisk(a));
    if (riskyActions.length) {
        return approvalRequired("selfBusinessAgent", `High-risk actions: ${riskyActions.join(", ")}`, riskyActions[0]);
    }

    const modules = Object.entries(BUSINESS_MODULES).map(([module, deliverables]) => ({
        module,
        deliverables: deliverables.slice(0, 3),
        weeklyHours:  module === "content" ? 5 : module === "marketing" ? 4 : module === "sales" ? 3 : 2,
        tools:        module === "content" ? ["Claude/GPT", "Canva"] : module === "marketing" ? ["Google Ads", "Meta Ads"] : module === "sales" ? ["Email tool", "CRM"] : ["Notion", "Zapier"]
    }));

    let aiSystem = null;
    try {
        const prompt = `Build a ${businessType} business system for "${niche}" niche with ₹${monthlyBudget}/month budget.
JSON: { "businessModel": "...", "revenueStreams": ["..."], "30dayPlan": ["..."], "kpis": ["..."], "automations": ["..."] }`;
        const raw   = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        aiSystem    = groq.parseJson(raw);
    } catch { /* template */ }

    const system = {
        id:            uid("biz"),
        userId,
        businessType,
        niche,
        monthlyBudget,
        modules,
        aiSystem,
        weeklySchedule: {
            Mon: "Content creation",
            Tue: "Marketing tasks",
            Wed: "Sales outreach",
            Thu: "Product/service delivery",
            Fri: "Analytics + optimization",
            Sat: "Learning + planning",
            Sun: "Rest"
        },
        createdAt: NOW()
    };

    logToMemory("selfBusinessAgent", `${niche}:${businessType}`, { budget: monthlyBudget });
    return system;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await buildSystem({ businessType: p.type || "saas", niche: p.niche || "productivity", monthlyBudget: p.budget || 5000, actions: p.actions || [], userId: p.userId || "" });
        if (data.approvalRequired) return data;
        return ok("selfBusinessAgent", data, ["Build systems, not just tasks", "Automate the repeatable first"]);
    } catch (err) { return fail("selfBusinessAgent", err.message); }
}

module.exports = { buildSystem, run };
