/**
 * Upsell Agent — suggests higher-value offers based on current plan/purchase.
 * Reads subscriptions from subscriptionAgent. Connects to paymentAgent for link generation.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are an expert upsell copywriter. Write a short, compelling upsell offer message (max 4 lines).
Be specific about the upgrade benefit. End with a clear CTA. No fluff.`;

// Plan upgrade paths
const UPSELL_MAP = {
    free: {
        upgradeTo:   "pro",
        price:       "₹999/month",
        headline:    "Unlock the Full AI Engine 🚀",
        benefits:    ["All 30+ AI agents", "WhatsApp automation", "CRM + leads system", "Priority support"],
        urgency:     "Limited slots this month"
    },
    pro: {
        upgradeTo:   "premium",
        price:       "₹2999/month",
        headline:    "Go Premium — Maximum Revenue 💎",
        benefits:    ["Custom AI agents", "Priority support (1hr response)", "White-label dashboard", "Dedicated onboarding call"],
        urgency:     "Only 10 Premium spots available"
    },
    premium: {
        upgradeTo:   "enterprise",
        price:       "Custom pricing",
        headline:    "Scale With Enterprise Power 🏢",
        benefits:    ["Unlimited agents", "API access", "Custom integrations", "Dedicated success manager"],
        urgency:     "Book a call to discuss"
    }
};

function _buildOffer(currentPlan, leadName = "there") {
    const upsell = UPSELL_MAP[currentPlan?.toLowerCase()] || UPSELL_MAP.free;
    const name   = leadName || "there";

    const message = `Hey ${name}! 👋\n\n${upsell.headline}\n\nUpgrade to ${upsell.upgradeTo.toUpperCase()} for ${upsell.price}:\n${upsell.benefits.map(b => `✅ ${b}`).join("\n")}\n\n⏰ ${upsell.urgency}\n\nReply YES to get your upgrade link instantly.`;

    return { currentPlan, ...upsell, message };
}

async function _groqOffer(currentPlan, context, leadName) {
    const upsell = UPSELL_MAP[currentPlan?.toLowerCase()] || UPSELL_MAP.free;
    const prompt = `Write an upsell message for ${leadName || "a customer"} currently on "${currentPlan}" plan.
Upgrade to: ${upsell.upgradeTo} at ${upsell.price}. Context: ${context || "SaaS AI platform"}.
Benefits: ${upsell.benefits.join(", ")}.`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 300 });
    return { currentPlan, ...upsell, message: raw };
}

async function suggest({ currentPlan = "free", leadName = "", context = "" }) {
    try {
        return await _groqOffer(currentPlan, context, leadName);
    } catch {
        return _buildOffer(currentPlan, leadName);
    }
}

async function run(task) {
    const p           = task.payload || {};
    const currentPlan = p.currentPlan || p.plan || "free";
    const leadName    = p.name   || p.leadName || "";
    const context     = p.context || task.input || "";

    try {
        const data = await suggest({ currentPlan, leadName, context });
        return { success: true, type: "business_pro", agent: "upsellAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "upsellAgent", data: { error: err.message } };
    }
}

module.exports = { suggest, run };
