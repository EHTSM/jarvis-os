"use strict";
/**
 * agents/paymentAgent.cjs — thin class adapter over the real payment
 * service (backend/services/paymentService.js, Razorpay-backed, already
 * live-credentialed per the connector audit).
 *
 * agents/business/paymentAgent.cjs depends on { PaymentAgent } from
 * "../paymentAgent.cjs" as its fallback path (its primary path is
 * utils/payment.cjs's createPaymentLink, a separate real Razorpay client),
 * but this file never existed anywhere in the repo. Does not create a
 * second Razorpay client or duplicate any payment logic — only adapts the
 * existing service's options-object signature
 * (createPaymentLink({amount,name,phone,description,accountId})) to the
 * single-argument createPaymentLink(amount) shape the caller expects.
 */

const paymentService = require("../backend/services/paymentService.js");

class PaymentAgent {
    async createPaymentLink(amount, opts = {}) {
        const result = await paymentService.createPaymentLink({
            amount,
            name: opts.name || "Customer",
            phone: opts.phone || null,
            description: opts.description || "AI Automation Service",
            accountId: opts.accountId || null,
        });
        if (!result?.success) {
            throw new Error(result?.error || "Payment link creation failed");
        }
        return result.link;
    }
}

module.exports = { PaymentAgent };
