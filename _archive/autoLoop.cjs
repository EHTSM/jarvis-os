"use strict";
/**
 * Auto Loop — cron-based lead follow-up engine.
 * Replaces the old setInterval approach with node-cron for reliability.
 * Rate-limited to 1 message per cycle to stay within WhatsApp limits.
 */

const cron         = require("node-cron");
const { getLeads } = require("./crm.cjs");
const { sendWhatsApp } = require("../utils/whatsapp.cjs");

let started = false;

function autoLoop() {
    if (started) return;
    started = true;

    console.log("[AutoLoop] Starting cron-based follow-up engine...");

    // Every 30 minutes: follow up with one new lead
    cron.schedule("*/30 * * * *", async () => {
        try {
            const leads = getLeads();
            if (!leads || leads.length === 0) return;

            // Only target new leads not yet contacted
            const targets = leads.filter(l => l.status === "new" && l.phone);
            if (targets.length === 0) return;

            // Pick one at random (rate limit: 1 per cycle)
            const lead = targets[Math.floor(Math.random() * targets.length)];

            const message = `Hey ${lead.name || "there"} — still thinking about automating your business? Reply YES and I'll show you how JARVIS can do it.`;

            await sendWhatsApp(lead.phone, message);
            console.log(`[AutoLoop] Follow-up sent to ${lead.phone}`);

        } catch (err) {
            console.error("[AutoLoop] Error:", err.message);
        }
    });

    console.log("[AutoLoop] Running — follows up with new leads every 30 min");
}

module.exports = { autoLoop };
