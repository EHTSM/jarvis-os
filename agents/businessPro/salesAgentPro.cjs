/**
 * Sales Agent Pro — extends existing salesAgent with structured objection handling,
 * follow-up logic, and Groq-powered contextual replies.
 */

const { SalesAgent }           = require("../salesAgent.cjs");
const { getLeads, updateLead } = require("../crm.cjs");
const groq                     = require("../core/groqClient.cjs");
const { NOW }                  = require("./_store.cjs");

const base = new SalesAgent();

const SYSTEM = `You are an elite sales closer for a SaaS/AI automation company.
Your job: handle objections, build trust, and close deals.
Be concise (max 5 lines), use emojis sparingly, end with a question or CTA.
Company: Jarvis OS — AI automation at ₹999/month.`;

// Extended objection library
const OBJECTIONS = {
    "expensive|costly|too much|price high": [
        `💡 Think of it this way — ₹999/month is ₹33/day.\n\nOne client you close with Jarvis = ₹5000+.\n\nThat's 5× ROI from day one.\n\nWant me to show you how to close your first client today?`
    ],
    "not sure|think about|later|maybe": [
        `Totally fair 🤝\n\nMost people who "think about it" come back after watching competitors use it.\n\nHere's what you'd get if you started today: [feature 1], [feature 2], [feature 3].\n\nWhat's the ONE thing holding you back?`
    ],
    "trust|scam|real|proof|legit": [
        `No trust without proof — fair ✅\n\nHere's what we offer:\n• 7-day money-back guarantee\n• Live demo before you buy\n• Real clients, real results\n\nWant a 10-minute live demo right now?`
    ],
    "already have|using another|competitor": [
        `Smart you're comparing 👍\n\nMost tools give you one thing.\nJarvis gives you 30+ AI agents — leads, content, code, sales, CRM — all in one.\n\nWhat does your current tool NOT do that frustrates you?`
    ],
    "no time|busy|later": [
        `I hear you 🕐\n\nThat's exactly why Jarvis exists — to save you time, not take it.\n\nSetup takes 10 minutes. After that, it runs automatically.\n\nCan we do a 5-minute walkthrough?`
    ],
    "no money|broke|budget": [
        `Makes sense 💙\n\nThat's why we have a Free tier.\n\nStart free, see results, upgrade only when you're making money.\n\nWant me to activate your free account right now?`
    ]
};

function _matchObjection(message) {
    const lower = message.toLowerCase();
    for (const [pattern, replies] of Object.entries(OBJECTIONS)) {
        if (pattern.split("|").some(kw => lower.includes(kw))) {
            return replies[0];
        }
    }
    return null;
}

/**
 * Generate a sales reply for a given message.
 * Uses: objection library → base salesAgent → Groq AI
 */
async function reply(message, leadContext = {}) {
    // 1. Objection library (instant)
    const objReply = _matchObjection(message);
    if (objReply) return { reply: objReply, source: "objection_handler" };

    // 2. Base salesAgent quick rules
    const baseReply = await base.generateReply(message, []);
    if (baseReply && baseReply !== "...") return { reply: baseReply, source: "sales_rules" };

    // 3. Groq AI with lead context
    try {
        const context = leadContext.name
            ? `Lead: ${leadContext.name}, Status: ${leadContext.status || "new"}, Score: ${leadContext.qualificationScore || 0}`
            : "No lead context";
        const raw = await groq.chat(SYSTEM, `Context: ${context}\nMessage: ${message}`);
        return { reply: raw, source: "groq_ai" };
    } catch {
        return { reply: "Thanks for reaching out! Let me connect you with the right information. What's your main goal right now?", source: "fallback" };
    }
}

/**
 * Process a message for a specific lead — saves interaction to CRM.
 */
async function processLeadMessage(phone, message) {
    const leads = getLeads();
    const lead  = leads.find(l => l.phone === phone);

    const result = await reply(message, lead || {});

    if (lead) {
        updateLead(phone, {
            lastMessage:    message.slice(0, 100),
            lastReply:      result.reply.slice(0, 100),
            lastInteraction: NOW(),
            status: message.toLowerCase().includes("buy") || message.toLowerCase().includes("yes") ? "hot" : lead.status
        });
    }

    return { phone, reply: result.reply, source: result.source, leadFound: !!lead };
}

async function run(task) {
    const p       = task.payload || {};
    const message = p.message || p.query || task.input || "";
    const phone   = p.phone   || null;

    if (!message) return { success: false, type: "business_pro", agent: "salesAgentPro", data: { error: "message required" } };

    try {
        const data = phone
            ? await processLeadMessage(phone, message)
            : await reply(message);
        return { success: true, type: "business_pro", agent: "salesAgentPro", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "salesAgentPro", data: { error: err.message } };
    }
}

module.exports = { reply, processLeadMessage, run };
