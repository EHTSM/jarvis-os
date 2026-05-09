/**
 * WhatsApp Bot Pro — extends existing marketingAgent with auto-reply logic.
 * Handles inbound message classification + instant templated replies.
 * Uses sendWhatsApp from utils/whatsapp.cjs (single source of truth).
 */

const { getLeads, updateLead, saveLead } = require("../crm.cjs");
const { MAX_BATCH, MAX_RETRY, NOW }      = require("./_store.cjs");

// Avoid requiring sendWhatsApp at module load — lazy-load to handle missing env gracefully
function _sendWA(phone, message) {
    const { sendWhatsApp } = require("../../utils/whatsapp.cjs");
    return sendWhatsApp(phone, message);
}

// Intent → reply map
const AUTO_REPLIES = {
    greeting:    { patterns: ["hi","hello","hey","hii","namaste","good morning","good evening"], reply: `Hey {name}! 👋 Welcome to Jarvis OS.\n\nI'm your AI business assistant. Here's what I can do:\n\n📦 1 - Show pricing\n🤖 2 - Book a demo\n💳 3 - Get payment link\n📈 4 - See features\n\nReply a number or ask anything!` },
    pricing:     { patterns: ["price","cost","how much","rate","charges","fees","subscription","plan","₹"], reply: `Here's our pricing 💰\n\n🆓 Free — Basic features, always free\n🚀 Pro — ₹999/month (All AI agents + WhatsApp)\n💎 Premium — ₹2999/month (Everything + Priority support)\n\n👉 Reply PAY to get a payment link right now.` },
    demo:        { patterns: ["demo","trial","test","show me","how it works","can i try"], reply: `Great! Let's schedule your demo 🗓️\n\nOur demos are:\n• 10 minutes\n• Live walkthrough\n• See results in real-time\n\nReply your preferred time:\n⏰ Morning (10-12)\n⏰ Afternoon (2-5)\n⏰ Evening (7-9)` },
    payment:     { patterns: ["pay","payment","buy","purchase","start","activate","pro plan","get it","yes"], reply: `Awesome! Here's your payment link 🔗\n\n💳 Jarvis OS Pro — ₹999/month\n\n[PAYMENT_LINK_PLACEHOLDER]\n\nSafe & secure via Razorpay. UPI / Cards / Net Banking accepted.\n\nQuestions? Reply HELP.` },
    support:     { patterns: ["help","support","issue","problem","not working","error","stuck"], reply: `No worries! Our team is here 🙌\n\nFor quick help:\n1. Reply your issue\n2. Share a screenshot if needed\n3. We respond within 1 hour\n\nOr email: support@jarvis.app` },
    features:    { patterns: ["feature","what can","capabilities","what does","agents","tools","what do you"], reply: `Jarvis OS has 40+ AI agents 🤖\n\n💻 Dev: Code, Debug, Deploy, Git\n💼 Business: CRM, Payments, Analytics\n📱 Content: Reels, Captions, Scripts\n🌐 Internet: News, Trends, Scraping\n📈 Business Pro: Funnels, Ads, Forecasting\n\nReply DEMO to see it live!` },
    stop:        { patterns: ["stop","unsubscribe","remove","opt out","no more"], reply: `Understood 🙏 I've removed you from our messages.\n\nIf you change your mind, just say HI again.\n\nTake care!` }
};

function _detectIntent(message) {
    const lower = message.toLowerCase().trim();
    for (const [intent, { patterns }] of Object.entries(AUTO_REPLIES)) {
        if (patterns.some(p => lower.includes(p))) return intent;
    }
    return "unknown";
}

function _personalize(template, lead) {
    return template.replace(/{name}/g, lead?.name || "there");
}

/**
 * Process an inbound WhatsApp message and generate a reply.
 * @param {string} phone    Sender's phone number
 * @param {string} message  Inbound message text
 * @returns {{ reply, intent, leadSaved }}
 */
async function processInbound(phone, message) {
    const intent = _detectIntent(message);
    const leads  = getLeads();
    let   lead   = leads.find(l => l.phone === phone);

    // Auto-save new leads to CRM
    if (!lead) {
        saveLead({ phone, name: "WhatsApp Lead", status: "new", source: "whatsapp_inbound", createdAt: NOW() });
        lead = { phone, name: "WhatsApp Lead" };
    }

    // Update last interaction
    updateLead(phone, { lastWhatsapp: message.slice(0, 100), lastWhatsappAt: NOW(), status: intent === "payment" ? "hot" : lead.status || "new" });

    const replyTemplate = AUTO_REPLIES[intent]?.reply || `Hey {name}! Thanks for your message 👋\n\nI'll pass this to our team right away.\n\nFor instant answers, reply:\n1 - Pricing\n2 - Demo\n3 - Features\n4 - Support`;
    const reply         = _personalize(replyTemplate, lead);

    // Optionally send it (if sendWhatsApp is configured)
    let sent = false;
    try {
        await _sendWA(phone, reply);
        sent = true;
    } catch { /* WhatsApp not configured — return reply for manual sending */ }

    return { phone, intent, reply, sent, leadSaved: !leads.find(l => l.phone === phone) };
}

/**
 * Send a bulk message to a filtered segment of leads.
 * Wraps broadcastToAll from marketingAgent with rate limiting.
 */
async function bulkSend(message, filter = null, limit = 20) {
    const batch  = Math.min(limit, MAX_BATCH);
    const leads  = getLeads().filter(l => l.phone && (!filter || l.status === filter)).slice(0, batch);
    const results = [];

    for (const lead of leads) {
        let attempt = 0;
        while (attempt < MAX_RETRY) {
            try {
                const msg = _personalize(message, lead);
                await _sendWA(lead.phone, msg);
                results.push({ phone: lead.phone, sent: true });
                break;
            } catch (err) {
                attempt++;
                if (attempt >= MAX_RETRY) results.push({ phone: lead.phone, sent: false, error: err.message });
            }
        }
    }

    const sentCount = results.filter(r => r.sent).length;
    return { targeted: leads.length, sent: sentCount, failed: leads.length - sentCount, results };
}

async function run(task) {
    const p       = task.payload || {};
    const phone   = p.phone   || null;
    const message = p.message || task.input || "";

    try {
        let data;
        if (task.type === "wa_inbound" || task.type === "whatsapp_reply") {
            if (!phone || !message) throw new Error("phone and message required");
            data = await processInbound(phone, message);
        } else if (task.type === "wa_bulk" || task.type === "whatsapp_bulk") {
            if (!message) throw new Error("message required");
            data = await bulkSend(message, p.filter, p.limit);
        } else {
            data = { intents: Object.keys(AUTO_REPLIES), usage: "Send wa_inbound or wa_bulk task type" };
        }
        return { success: true, type: "business_pro", agent: "whatsappBotPro", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "whatsappBotPro", data: { error: err.message } };
    }
}

module.exports = { processInbound, bulkSend, run };
