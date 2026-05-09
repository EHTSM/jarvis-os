/**
 * Business Payment Agent — thin wrapper over existing PaymentAgent.
 * Single source of truth: agents/paymentAgent.cjs (Razorpay lazy init).
 * DO NOT add another Razorpay instance here.
 */

const { PaymentAgent }     = require("../paymentAgent.cjs");
const { createPaymentLink: utilLink } = require("../../utils/payment.cjs");

const _agent = new PaymentAgent();

async function run(task) {
    const p    = task.payload || {};
    const type = task.type;

    try {
        if (type === "create_payment" || type === "create_payment_link" || type === "payment_link") {
            const amount = Number(p.amount) || 999;
            const name   = p.name || p.customer || "Customer";
            const desc   = p.description || "AI Automation Service";

            // Use util for richer link (name, notify), fall back to agent
            let url;
            try {
                url = await utilLink({ amount, name, description: desc });
            } catch {
                url = await _agent.createPaymentLink(amount);
            }

            return { success: true, type: "paymentAgent", data: { url, amount, currency: "INR", customer: name } };
        }

        if (type === "payment_status") {
            return { success: true, type: "paymentAgent", data: { status: "manual_check_required", note: "Razorpay webhook handles real-time status" } };
        }

        return { success: false, type: "paymentAgent", data: { error: `Unknown payment task: ${type}` } };

    } catch (err) {
        return { success: false, type: "paymentAgent", data: { error: err.message } };
    }
}

module.exports = { run };
