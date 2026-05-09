/**
 * Retargeting Engine — re-engages cold/lost leads from existing CRM.
 * Uses marketingAgent for WhatsApp delivery. Max batch: 50. Max retries: 3.
 */

const { getLeads, updateLead }      = require("../crm.cjs");
const { broadcastToAll, sendCampaign } = require("../business/marketingAgent.cjs");
const { load, flush, uid, MAX_BATCH, MAX_RETRY, NOW } = require("./_store.cjs");

const STORE = "retargeting-runs";

const SEQUENCES = {
    cold: [
        { day: 0,  message: `Hey {name}! 👋 We noticed you checked out Jarvis OS but haven't started yet.\n\nMost users see results within 3 days.\n\nWant a 10-minute demo? Reply YES.` },
        { day: 2,  message: `{name}, just circling back 🙂\n\nStill thinking about Jarvis? Here's what 3 users said this week:\n• "Saved 4 hours/day"\n• "Got 12 leads in first week"\n• "Closed ₹15k in 3 days"\n\nYour results could be next. Reply START.` },
        { day: 5,  message: `Last message, {name} 🙏\n\nWe're offering a FREE 7-day trial — no card needed.\n\nJust say GO and I'll activate it right now.` }
    ],
    lost: [
        { day: 0,  message: `Hey {name}! Long time no talk 👋\n\nWe've added 10 new AI agents since you last tried Jarvis.\n\nCode generator, CRM, WhatsApp bot, content engine — all in one.\n\nWant to see what's new? Reply SHOW ME.` },
        { day: 3,  message: `{name}, we have a win-back offer for you:\n\n✅ First month: ₹499 (regular ₹999)\n✅ Locked for 3 months\n✅ Cancel anytime\n\nReply COMEBACK to claim it.` }
    ],
    abandoned: [
        { day: 0,  message: `{name}, you left something behind! 😅\n\nYour Jarvis setup was 80% complete.\n\nFinish in 5 minutes and your account goes live. Ready? Reply FINISH.` }
    ]
};

function _personalize(template, lead) {
    return template.replace(/{name}/g, lead.name || "there");
}

/**
 * Run a retargeting sequence for a segment of leads.
 * @param {string} segment  "cold" | "lost" | "abandoned"
 * @param {number} limit    Max leads to contact (capped at MAX_BATCH)
 */
async function runSequence(segment = "cold", limit = 20) {
    const batch  = Math.min(limit, MAX_BATCH);
    const seq    = SEQUENCES[segment];
    if (!seq) throw new Error(`Unknown segment: ${segment}. Options: ${Object.keys(SEQUENCES).join(", ")}`);

    // Find matching leads from CRM
    const allLeads = getLeads();
    const targets  = allLeads
        .filter(l => {
            if (segment === "cold")      return ["new", "cold"].includes(l.status) && l.phone;
            if (segment === "lost")      return l.status === "lost" && l.phone;
            if (segment === "abandoned") return l.qualificationGrade === "warm" && l.status === "new" && l.phone;
            return false;
        })
        .slice(0, batch);

    if (!targets.length) return { sent: 0, segment, message: "No leads matched this segment" };

    const results  = [];
    const firstMsg = seq[0].message;

    for (const lead of targets) {
        let attempt = 0;
        let sent    = false;

        while (attempt < MAX_RETRY && !sent) {
            try {
                const { sendWhatsApp } = require("../../utils/whatsapp.cjs");
                const msg = _personalize(firstMsg, lead);
                await sendWhatsApp(lead.phone, msg);
                updateLead(lead.phone, { retargetedAt: NOW(), retargetSegment: segment, retargetCount: (lead.retargetCount || 0) + 1 });
                results.push({ phone: lead.phone, name: lead.name, sent: true });
                sent = true;
            } catch (err) {
                attempt++;
                if (attempt >= MAX_RETRY) {
                    results.push({ phone: lead.phone, sent: false, error: err.message });
                }
            }
        }
    }

    // Save run log
    const runs = load(STORE, []);
    runs.push({ id: uid("ret"), segment, batch: targets.length, sent: results.filter(r => r.sent).length, runAt: NOW() });
    if (runs.length > 50) runs.splice(0, runs.length - 50);
    flush(STORE, runs);

    const sentCount = results.filter(r => r.sent).length;
    return { segment, targeted: targets.length, sent: sentCount, failed: targets.length - sentCount, results };
}

/**
 * Get retargeting run history.
 */
function history() { return load(STORE, []); }

/**
 * Get leads that need retargeting (cold + no recent contact).
 */
function getRetargetable() {
    const leads = getLeads();
    const cutoff = Date.now() - 7 * 86_400_000;  // 7 days
    return {
        cold:      leads.filter(l => l.status === "new"  && (!l.retargetedAt || new Date(l.retargetedAt).getTime() < cutoff)),
        lost:      leads.filter(l => l.status === "lost" && (!l.retargetedAt || new Date(l.retargetedAt).getTime() < cutoff)),
        abandoned: leads.filter(l => l.qualificationGrade === "warm" && !l.retargetedAt)
    };
}

async function run(task) {
    const p       = task.payload || {};
    const segment = p.segment || "cold";
    const limit   = Math.min(p.limit || 20, MAX_BATCH);

    try {
        let data;
        if (task.type === "retarget_preview") {
            data = getRetargetable();
        } else if (task.type === "retarget_history") {
            data = { runs: history() };
        } else {
            data = await runSequence(segment, limit);
        }
        return { success: true, type: "business_pro", agent: "retargetingEngine", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "retargetingEngine", data: { error: err.message } };
    }
}

module.exports = { runSequence, getRetargetable, history, run };
