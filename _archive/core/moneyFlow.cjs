/**
 * Unified Money Pipeline:
 * input → SalesAgent → InterestDetector → PaymentAgent → CRM → FollowUpSystem
 */
const { SalesAgent }       = require("../agents/salesAgent.cjs");
const { InterestDetector } = require("../agents/interestDetector.cjs");
const { PaymentAgent }     = require("../agents/paymentAgent.cjs");
const { saveLead, updateLead } = require("../agents/crm.cjs");
const { FollowUpSystem }   = require("../agents/followUpSystem.cjs");
const { sendWhatsApp }     = require("../utils/whatsapp.cjs");
const logger               = require("./logger.cjs");

const salesAgent = new SalesAgent();
const detector   = new InterestDetector();
const paymentAgent = new PaymentAgent();
const followUp   = new FollowUpSystem();

const FALLBACK_PAYMENT = "https://rzp.io/l/razorpay.me/@alwaliytechnologiesprivatelim";

async function run({ input, phone, name = "User", context = [] }) {
    try {
        // 1. Save lead to CRM
        if (phone) {
            saveLead({ name, phone, message: input, source: "jarvis" });
        }

        // 2. Generate AI sales reply
        let reply = await salesAgent.generateReply(input, context);
        const hot = detector.isHot(input);

        // 3. Hot lead → attach payment link + schedule follow-ups
        if (hot) {
            try {
                const link = await paymentAgent.createPaymentLink(999);
                reply += `\n\n💰 Start here: ${link}`;
            } catch {
                reply += `\n\n💰 Start here: ${FALLBACK_PAYMENT}`;
            }

            if (phone) {
                updateLead(phone, { status: "hot", updatedAt: new Date().toISOString() });
                followUp.scheduleFollowUps(phone);
            }
        }

        // 4. Send WhatsApp reply if phone provided
        if (phone) {
            await sendWhatsApp(phone, reply).catch(err =>
                logger.warn("WhatsApp send failed", { error: err.message })
            );
        }

        logger.info("Money flow complete", { hot, hasPhone: !!phone });
        return { success: true, reply, hot };

    } catch (err) {
        logger.error("Money flow error", { error: err.message });
        return { success: false, error: err.message, reply: "Processing error — please try again." };
    }
}

module.exports = { run };
