const { sendWhatsApp } = require("../utils/whatsapp.cjs");

const MESSAGES = [
    "Hey, just checking — did you get a chance to see my last message? 👀",
    "Quick follow-up 🙂 We've helped similar businesses grow fast using AI automation.",
    "Last message from my side — want me to show you a quick demo? 🚀"
];

class FollowUpSystem {
    async sendFollowUp(phone, step = 0) {
        if (step >= MESSAGES.length) return;
        try {
            await sendWhatsApp(phone, MESSAGES[step]);
            console.log(`📩 Follow-up ${step + 1} sent to ${phone}`);
        } catch (err) {
            console.log("Follow-up error:", err.message);
        }
    }

    scheduleFollowUps(phone) {
        setTimeout(() => this.sendFollowUp(phone, 0), 24 * 60 * 60 * 1000);   // Day 1
        setTimeout(() => this.sendFollowUp(phone, 1), 48 * 60 * 60 * 1000);   // Day 2
        setTimeout(() => this.sendFollowUp(phone, 2), 72 * 60 * 60 * 1000);   // Day 3
    }
}

module.exports = { FollowUpSystem };
