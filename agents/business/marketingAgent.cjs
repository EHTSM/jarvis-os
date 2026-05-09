/**
 * Marketing Agent — campaign triggers and automation hooks.
 * Reuses existing WhatsApp utility + CRM. Never creates duplicate senders.
 */

const { getLeads, updateLead } = require("../crm.cjs");
const { sendWhatsApp }         = require("../../utils/whatsapp.cjs");

const CAMPAIGN_TEMPLATES = {
    promo:    (name) => `Hi ${name}! 🚀 We have an exclusive offer for you — AI automation at ₹999/month. Reply YES to grab it!`,
    followup: (name) => `Hey ${name}! Just checking in 👋 Did you get a chance to try our AI system? We'd love to help you grow!`,
    upsell:   (name) => `Hey ${name}! Upgrade to Premium and unlock all AI agents + priority support. Starting ₹2999/mo 💎`,
    reactivate: (name) => `Hi ${name}! We miss you 💙 Come back and see what's new — your first week is on us!`
};

async function sendCampaign({ type = "promo", filter = "interested", limit = 10 }) {
    const leads   = getLeads().filter(l => l.status === filter && l.phone);
    const targets = leads.slice(0, limit);

    const results = [];
    for (const lead of targets) {
        const message = (CAMPAIGN_TEMPLATES[type] || CAMPAIGN_TEMPLATES.promo)(lead.name || "Friend");
        try {
            await sendWhatsApp(lead.phone, message);
            updateLead(lead.phone, { lastCampaign: type, lastCampaignAt: new Date().toISOString() });
            results.push({ phone: lead.phone, sent: true });
        } catch (err) {
            results.push({ phone: lead.phone, sent: false, error: err.message });
        }
    }

    return { sent: results.filter(r => r.sent).length, failed: results.filter(r => !r.sent).length, results };
}

async function broadcastToAll(message, filter = null) {
    const all     = getLeads();
    const targets = filter ? all.filter(l => l.status === filter && l.phone) : all.filter(l => l.phone);
    const results = [];

    for (const lead of targets) {
        try {
            await sendWhatsApp(lead.phone, message);
            results.push({ phone: lead.phone, sent: true });
        } catch (err) {
            results.push({ phone: lead.phone, sent: false, error: err.message });
        }
    }
    return { total: targets.length, sent: results.filter(r => r.sent).length, results };
}

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "send_campaign":
        case "trigger_campaign": {
            const result = await sendCampaign({
                type:   p.campaignType || p.type || "promo",
                filter: p.filter       || "interested",
                limit:  p.limit        || 10
            });
            return { success: true, type: "marketingAgent", data: result };
        }

        case "broadcast": {
            if (!p.message) return { success: false, type: "marketingAgent", data: { error: "message required" } };
            const result = await broadcastToAll(p.message, p.filter || null);
            return { success: true, type: "marketingAgent", data: result };
        }

        case "list_templates":
            return { success: true, type: "marketingAgent", data: { templates: Object.keys(CAMPAIGN_TEMPLATES) } };

        default:
            return { success: false, type: "marketingAgent", data: { error: `Unknown marketing task: ${task.type}` } };
    }
}

module.exports = { run, sendCampaign, broadcastToAll };
