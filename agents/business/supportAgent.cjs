/**
 * Support Agent — handles FAQs with static answers + Groq fallback.
 */

const groq = require("../core/groqClient.cjs");

const FAQ = {
    "how does it work":       "Jarvis is an AI automation platform. You send a command → AI understands → routes to the right agent → executes and replies. No coding needed!",
    "what is the price":      "We offer 3 plans: Free (basic), Pro at ₹999/month (all AI agents + WhatsApp), Premium at ₹2999/month (everything + priority support + custom agents).",
    "how to pay":             "You can pay via Razorpay — we accept UPI, cards, net banking. Ask for a payment link and we'll send it instantly.",
    "can i cancel":           "Yes, you can cancel anytime. No lock-in contracts. Your access continues until the end of the billing period.",
    "what agents are included":"Pro includes: Code Generator, Debugger, API Builder, Database Agent, Security Scanner, Deployment Agent, CRM, Sales Agent, and more.",
    "whatsapp automation":    "Yes! Jarvis can send WhatsApp messages, follow-ups, campaigns, and payment links automatically using the WhatsApp Business API.",
    "how to get leads":       "Jarvis can scrape leads from Google Maps, LinkedIn, and Fiverr. Just tell Jarvis the niche/location and it generates a lead list.",
    "is my data safe":        "Yes. Your data is stored locally on your server. We don't share your leads, payments, or conversations with any third party.",
    "how to contact support": "You can message us on WhatsApp or use the /support command in Jarvis chat. We respond within 24 hours.",
    "refund policy":          "We offer a 7-day refund if you're not satisfied. Just reach out to support within 7 days of purchase."
};

const SYSTEM = `You are a friendly and helpful customer support agent for Jarvis OS, an AI automation platform.
Answer the user's question accurately, briefly, and helpfully.
If you don't know the answer, say so honestly and suggest they contact support.`;

function _findFAQ(question) {
    const q = question.toLowerCase();
    for (const [key, answer] of Object.entries(FAQ)) {
        if (q.includes(key) || key.split(" ").filter(w => w.length > 3).some(w => q.includes(w))) {
            return answer;
        }
    }
    return null;
}

async function answer(question) {
    // Try static FAQ first (fast, no API cost)
    const staticAnswer = _findFAQ(question);
    if (staticAnswer) return { answer: staticAnswer, source: "faq" };

    // Fall back to Groq
    const context = Object.entries(FAQ).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n");
    const prompt  = `FAQ context:\n${context}\n\nUser question: ${question}`;
    const raw     = await groq.chat(SYSTEM, prompt, { maxTokens: 512 });
    return { answer: raw, source: "ai" };
}

async function run(task) {
    const p        = task.payload || {};
    const question = p.question || p.query || task.input || "";

    switch (task.type) {
        case "support_help":
        case "faq":
        case "get_help": {
            if (!question) return { success: true, type: "supportAgent", data: { faqs: Object.keys(FAQ) } };
            const result = await answer(question);
            return { success: true, type: "supportAgent", data: result };
        }

        case "list_faqs":
            return { success: true, type: "supportAgent", data: { topics: Object.keys(FAQ), count: Object.keys(FAQ).length } };

        default:
            if (question) {
                const result = await answer(question);
                return { success: true, type: "supportAgent", data: result };
            }
            return { success: false, type: "supportAgent", data: { error: "question required" } };
    }
}

module.exports = { run, answer };
