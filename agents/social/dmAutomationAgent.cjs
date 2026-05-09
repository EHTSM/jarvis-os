/**
 * DM Automation Agent — extends WhatsApp/messaging layer with human-like delays.
 * Max 10 DMs/hour. Randomized 30-120s delay between sends.
 * Uses utils/whatsapp.cjs as single source of truth for actual delivery.
 */

const { load, flush, uid, NOW, CAPS, randomDelay } = require("./_socialStore.cjs");
const { getLeads } = require("../crm.cjs");

const LOG_STORE = "dm-log";

function _sendWA(phone, message) {
    try {
        const { sendWhatsApp } = require("../../utils/whatsapp.cjs");
        return sendWhatsApp(phone, message);
    } catch { return Promise.resolve({ sent: false, note: "WhatsApp not configured" }); }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Hourly DM cap ─────────────────────────────────────────────────
function _canSendDm() {
    const log  = load("dm-hourly", { hour: -1, count: 0 });
    const hour = new Date().getHours();
    if (log.hour !== hour) return true;
    return log.count < CAPS.maxDmsPerHour;
}
function _recordDm() {
    const log  = load("dm-hourly", { hour: -1, count: 0 });
    const hour = new Date().getHours();
    if (log.hour !== hour) { log.hour = hour; log.count = 0; }
    log.count++;
    flush("dm-hourly", log);
}

function _personalize(template, lead) {
    return template
        .replace(/{name}/g, lead?.name || "there")
        .replace(/{phone}/g, lead?.phone || "")
        .replace(/{status}/g, lead?.status || "new");
}

// ── DM templates for social contexts ─────────────────────────────
const TEMPLATES = {
    welcome_follower: `Hey {name}! 👋 Thanks for connecting. I'd love to know — what's your biggest challenge with [topic] right now?`,
    collab_outreach:  `Hi {name}! Your content on [topic] is amazing. I think our audiences overlap — would you be open to a quick collab or story swap this week?`,
    value_share:      `Hey {name}! Saw your recent post. I made a free resource on [topic] that might help — want me to send it over?`,
    follow_up:        `Hi {name}! Just following up on my last message. No pressure — just let me know if [offer] is something you'd find useful!`,
    event_invite:     `Hey {name}! I'm hosting a free [event] on [date]. Thought you'd be a great fit — want the details?`
};

async function sendDm({ phone, message, templateKey, lead, delayMs }) {
    if (!phone) throw new Error("phone required");
    if (!_canSendDm()) return { sent: false, skipped: true, reason: `DM cap reached (max ${CAPS.maxDmsPerHour}/hour)` };

    const delay = delayMs || randomDelay(CAPS.dmDelayMin, CAPS.dmDelayMax);
    await _sleep(delay);

    const text    = message || (templateKey ? _personalize(TEMPLATES[templateKey] || TEMPLATES.welcome_follower, lead || { name: "there" }) : "Hello!");
    let sent = false;
    try { await _sendWA(phone, text); sent = true; } catch { /* log anyway */ }

    _recordDm();
    const entry = { id: uid("dm"), phone, message: text.slice(0, 100), templateKey: templateKey || null, sent, delayMs: delay, sentAt: NOW() };
    const log = load(LOG_STORE, []);
    log.push(entry);
    if (log.length > 200) log.splice(0, log.length - 200);
    flush(LOG_STORE, log);

    return { phone, sent, delayMs: delay, templateKey };
}

async function bulkDm({ message, templateKey, filter = null, limit = 10 }) {
    const leads  = getLeads().filter(l => l.phone && (!filter || l.status === filter)).slice(0, Math.min(limit, CAPS.maxDmsPerHour));
    const results = [];
    for (const lead of leads) {
        const r = await sendDm({ phone: lead.phone, templateKey, message, lead });
        results.push({ ...r, name: lead.name });
        if (r.skipped) break; // hourly cap hit
    }
    return { targeted: leads.length, sent: results.filter(r => r.sent).length, results };
}

function dmLog() { return load(LOG_STORE, []).slice(-50); }

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "dm_bulk") {
            data = await bulkDm({ message: p.message, templateKey: p.template, filter: p.filter, limit: p.limit || 10 });
        } else if (task.type === "dm_log") {
            data = { log: dmLog() };
        } else {
            data = await sendDm({ phone: p.phone, message: p.message, templateKey: p.template, lead: p.lead });
        }
        return { success: true, type: "social", agent: "dmAutomationAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "dmAutomationAgent", data: { error: err.message } };
    }
}

module.exports = { sendDm, bulkDm, dmLog, TEMPLATES, run };
