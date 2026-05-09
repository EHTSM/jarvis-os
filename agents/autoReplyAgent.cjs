"use strict";
/**
 * AutoReplyAgent — handles incoming WhatsApp messages.
 * Uses central whatsapp utility (fixes old hardcoded v18.0 + env var mismatch).
 */

const { sendWhatsApp } = require("../utils/whatsapp.cjs");

class AutoReplyAgent {
    async generateReply(message) {
        const text = (message || "").toLowerCase();

        if (text.includes("expensive") || text.includes("costly")) {
            return "I get that! Most users recover ₹999 in 2-3 days.\n\nThis is an income system, not an expense.\n\nWant to see how?";
        }
        if (text.includes("trust") || text.includes("scam") || text.includes("fake")) {
            return "Fair question! You don't need to trust blindly.\n\nI'll show you real results step-by-step.\n\nWant a quick demo?";
        }
        if (text.includes("price") || text.includes("cost") || text.includes("how much")) {
            return "JARVIS AI Automation starts at ₹999.\n\nYou get:\n✅ Lead generation\n✅ Auto WhatsApp replies\n✅ Payment system\n✅ Full AI automation\n\nMost users earn this back in 2-3 days.\n\nReady to start?";
        }
        if (text.includes("yes") || text.includes("interested") || text.includes("start")) {
            return "Perfect! Sending your payment link now...";
        }
        if (text.includes("done") || text.includes("paid")) {
            return "Verifying payment... Your JARVIS system will be activated shortly!";
        }
        return "Got it! Tell me your business type so I can show you exactly how JARVIS can help.";
    }

    async handleIncoming(phone, message) {
        const reply = await this.generateReply(message);
        await sendWhatsApp(phone, reply);
        return reply;
    }
}

module.exports = { AutoReplyAgent };
