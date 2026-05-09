/**
 * Cross-Sell Agent — recommends complementary products/services.
 * Based on what a lead has purchased or is currently using.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a cross-sell strategist. Suggest 1-2 complementary products or services.
Be specific, concise (max 5 lines). Show how it works WITH what they already have.`;

// Complementary product/service map
const CROSS_SELL_MAP = {
    pro: [
        { product: "Content Creation Pack", price: "₹499/month add-on", reason: "Auto-generate social posts + reels from your Jarvis data" },
        { product: "Lead Scraper Pro",       price: "₹299/month add-on", reason: "Get 500+ fresh leads/month from Google Maps + LinkedIn" }
    ],
    premium: [
        { product: "White-Label Dashboard", price: "₹1499/month add-on", reason: "Sell Jarvis under your own brand to clients" },
        { product: "AI Phone Agent",         price: "₹999/month add-on", reason: "AI handles inbound calls + books appointments automatically" }
    ],
    ecommerce: [
        { product: "Inventory Manager",     price: "₹299/month add-on", reason: "Auto-track stock levels + reorder alerts" },
        { product: "Dropship Finder",       price: "₹199/month add-on", reason: "Find verified suppliers for your niche in 60 seconds" }
    ],
    content: [
        { product: "Video Script Writer",   price: "₹199/month add-on", reason: "Turn your blog posts into YouTube scripts automatically" },
        { product: "Hashtag Optimizer",     price: "₹99/month add-on",  reason: "Get niche hashtags that 3× your organic reach" }
    ],
    leads: [
        { product: "WhatsApp Automation",   price: "₹499/month add-on", reason: "Auto-reply to every lead within 30 seconds, 24/7" },
        { product: "Email Sequences",       price: "₹299/month add-on", reason: "7-day nurture sequence converts 30% more cold leads" }
    ]
};

function _suggest(currentProduct, leadContext = {}) {
    const key = (currentProduct || "").toLowerCase();
    const matches = CROSS_SELL_MAP[key] || CROSS_SELL_MAP.pro;

    return matches.map(m => ({
        ...m,
        message: `Since you're using ${currentProduct}, you'll love ${m.product} (${m.price}).\n\n💡 ${m.reason}\n\nReply ADD to unlock it now.`
    }));
}

async function suggest({ currentProduct = "pro", leadName = "", context = "" }) {
    try {
        const prompt = `${leadName || "A customer"} uses "${currentProduct}". Suggest 2 complementary add-ons. Context: ${context}.\nReturn JSON: { "suggestions": [{ "product": "name", "price": "₹X", "reason": "why it helps", "message": "pitch message" }] }`;
        const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        const parsed = JSON.parse(raw.replace(/```json?/g, "").replace(/```/g, "").trim());
        return { currentProduct, ...parsed };
    } catch {
        return { currentProduct, suggestions: _suggest(currentProduct, { name: leadName }) };
    }
}

async function run(task) {
    const p              = task.payload || {};
    const currentProduct = p.product || p.currentProduct || p.plan || "pro";
    const leadName       = p.name    || p.leadName || "";

    try {
        const data = await suggest({ currentProduct, leadName, context: task.input || "" });
        return { success: true, type: "business_pro", agent: "crossSellAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "crossSellAgent", data: { error: err.message } };
    }
}

module.exports = { suggest, run };
