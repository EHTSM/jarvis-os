"use strict";
/**
 * Webhook Controller — Razorpay + Stripe payment webhooks.
 * Extracted from jarvisController (no dependency on the AI pipeline).
 *
 * WhatsApp incoming webhook is NOT here — it reuses the sales/execution
 * pipelines defined in jarvisController and stays there to avoid coupling.
 */

const logger     = require("../utils/logger");
const errTracker = require("../utils/errorTracker");
const payment    = require("../services/paymentService");
const stripe     = require("../services/stripeService");
const crm        = require("../services/crmService");
const automation = require("../services/automationService");
const billing    = require("../services/billingService");
const { checkIdempotency, recordIdempotency } = require("../services/socialPublishSupport.cjs");

/**
 * POST /webhook/razorpay  and  POST /razorpay-webhook
 * HMAC verify → CRM update → triggerFulfillment
 */
async function handleRazorpayWebhook(req, res) {
    try {
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const sig     = req.headers["x-razorpay-signature"] || "";

        if (!payment.verifyWebhookSignature(rawBody, sig)) {
            logger.warn("[Webhook] Razorpay signature mismatch — rejected");
            return res.status(400).json({ error: "Invalid signature" });
        }

        const parsed = payment.parseWebhookEvent(rawBody);
        if (!parsed) return res.json({ status: "ignored" });

        const { event, payment: p } = parsed;
        logger.info(`[Webhook] Event: ${event}`);

        if (event === "payment.captured" && p) {
            const phone     = p.contact || "";
            const name      = p.customer_details?.name || "";
            const accountId = p.notes?.accountId || parsed.raw?.payload?.payment_link?.entity?.notes?.accountId || null;

            logger.info(`[Webhook] Payment captured — phone=${phone} id=${p.id} accountId=${accountId || "unknown"}`);

            // CRM: mark lead paid and trigger WhatsApp onboarding message
            const identifier = String(phone).replace(/\D/g, "");
            if (identifier) {
                crm.updateLead(identifier, {
                    status:        "paid",
                    paymentStatus: "paid",
                    paymentId:     p.id,
                    paidAt:        new Date().toISOString()
                });
                await automation.triggerFulfillment(identifier, name);
            }

            // Billing: activate the account that initiated the payment
            if (accountId) {
                billing.activatePlan(accountId, "starter", null);
                logger.info(`[Webhook] Billing activated via payment.captured: ${accountId} → starter`);
            } else {
                logger.warn(`[Webhook] payment.captured has no notes.accountId — billing not auto-activated. Payment id=${p.id}`);
            }
        }

        // Subscription events — activate/cancel Ooplix billing
        if (event === "subscription.activated") {
            const sub       = parsed.subscription;
            const subId     = sub?.id;
            const planId    = sub?.plan_id;
            // Map Razorpay plan ID → our plan name via env vars
            const planName  = planId === process.env.RAZORPAY_PLAN_ID_GROWTH ? "growth"
                            : planId === process.env.RAZORPAY_PLAN_ID_SCALE  ? "scale"
                            : "starter";
            const accountId = sub?.notes?.accountId || "operator";
            billing.activatePlan(accountId, planName, subId);
            logger.info(`[Webhook] Subscription activated: ${accountId} → ${planName} (${subId})`);
        }

        if (event === "subscription.cancelled" || event === "subscription.completed") {
            const sub       = parsed.subscription;
            const accountId = sub?.notes?.accountId || "operator";
            billing.cancelPlan(accountId);
            logger.info(`[Webhook] Subscription ended: ${accountId} (${event})`);
        }

        // payment.failed — log for retry tracking
        if (event === "payment.failed") {
            const p = parsed.payment;
            logger.warn(`[Webhook] Payment failed: id=${p?.id} reason=${p?.error_reason || "unknown"}`);
        }

        // refund.processed
        if (event === "refund.processed") {
            const r = parsed.refund;
            logger.info(`[Webhook] Refund processed: id=${r?.id} amount=₹${(r?.amount || 0) / 100}`);
        }

        res.json({ status: "ok" });
    } catch (err) {
        errTracker.record("razorpay_webhook", err.message);
        logger.error("[Webhook] Razorpay error:", err.message);
        res.sendStatus(500);
    }
}

/**
 * POST /webhook/stripe  and  POST /stripe-webhook
 * HMAC verify → dedup → bounded event handling.
 *
 * ERA-2 Mission 76 (P10 continuation): now that a real Stripe Checkout
 * Session creation path exists (stripeService.createCheckoutSession(),
 * wired at POST /payment/stripe/checkout), this webhook can legitimately
 * receive real checkout/payment_intent events for the first time — this
 * handler's own prior comment (still true when it was written) predicted
 * exactly this: "wiring real business-logic reactions to each event type
 * is future work once (and only once) a real Stripe checkout path is
 * built." That precondition is now met, so billing activation is wired
 * for the events that have an unambiguous internal meaning — but ONLY for
 * checkout requests that flowed through /payment/stripe/checkout, whose
 * metadata.accountId/orgId/plan is server-derived (see that route's own
 * comment). A session with no accountId in metadata (e.g. a session
 * created some other way, or a malformed/foreign event) is deliberately
 * left unactivated rather than guessed at — same "don't fabricate
 * business meaning that isn't there" posture as the Razorpay handler's
 * own `if (accountId) {...} else { logger.warn(...) }` branch above.
 *
 * Duplicate delivery protection: Stripe redelivers events on any non-2xx
 * response or timeout (same real-world behavior as Razorpay, per test
 * 16's own comment) and every Stripe event carries a globally unique
 * `id` (evt_...) specifically for deduplication — Stripe's own documented
 * recommendation. Reuses socialPublishSupport.cjs's existing bounded
 * TTL Map dedup helper (the same one whatsappService.js's webhook-replay
 * guard and paymentService.js's refund idempotency already use) rather
 * than inventing a second dedup mechanism.
 */
async function handleStripeWebhook(req, res) {
    try {
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const sig     = req.headers["stripe-signature"] || "";

        if (!stripe.verifyWebhookSignature(rawBody, sig)) {
            logger.warn("[Webhook] Stripe signature mismatch — rejected");
            return res.status(400).json({ error: "Invalid signature" });
        }

        const parsed = stripe.parseWebhookEvent(rawBody);
        if (!parsed || !parsed.event) return res.json({ status: "ignored" });

        const eventId = parsed.raw?.id || null;
        const dedupKey = eventId ? `stripe-webhook-event:${eventId}` : null;
        if (dedupKey && checkIdempotency(dedupKey)) {
            logger.info(`[Webhook] Stripe event already processed — duplicate delivery ignored (id=${eventId})`);
            return res.json({ status: "ok", duplicate: true });
        }

        logger.info(`[Webhook] Stripe event received: ${parsed.event} (id=${eventId || "unknown"})`);

        const { event, data } = parsed;

        // checkout.session.completed — the checkout flow's own explicit
        // completion signal (fires once Stripe has collected payment
        // details; for "payment" mode this coincides with payment success,
        // for "subscription" mode it means the subscription was created).
        // This is the ONLY place billing is activated from Stripe — never
        // from session creation (POST /payment/stripe/checkout), which
        // only proves Stripe accepted the request, not that anyone paid.
        if (event === "checkout.session.completed" && data) {
            const accountId = data.metadata?.accountId || null;
            const orgId     = data.metadata?.orgId || null;
            const plan      = data.metadata?.plan || null;
            const paymentStatus = data.payment_status; // "paid" | "unpaid" | "no_payment_required"

            if (accountId && plan && paymentStatus === "paid") {
                billing.activatePlan(accountId, plan, data.subscription || data.id);
                logger.info(`[Webhook] Stripe billing activated: ${accountId} → ${plan} (session=${data.id})`);
                if (orgId) {
                    const identifier = String(accountId).replace(/\D/g, "");
                    if (identifier) crm.updateLead(identifier, { status: "paid", paymentStatus: "paid", paymentId: data.id, paidAt: new Date().toISOString() });
                }
            } else if (accountId && plan) {
                // Session completed but payment_status isn't "paid" (e.g.
                // async payment methods still settling) — do not activate;
                // payment_intent.succeeded below, or a later
                // checkout.session.completed redelivery, is the real signal.
                logger.info(`[Webhook] Stripe checkout.session.completed with payment_status=${paymentStatus} — not activating (awaiting payment confirmation)`);
            } else {
                logger.warn(`[Webhook] Stripe checkout.session.completed has no metadata.accountId/plan — billing not auto-activated. Session id=${data.id}`);
            }
        }

        // payment_intent.succeeded — authoritative payment-succeeded signal
        // for "payment" mode checkouts. Distinct from checkout.session.completed:
        // a PaymentIntent does not itself carry the checkout session's
        // metadata (Stripe does not copy Checkout Session metadata onto
        // the PaymentIntent it creates), so this event is logged for
        // observability/reconciliation but does not independently activate
        // billing — checkout.session.completed (paid) above is this
        // codebase's actual activation trigger, avoiding a second,
        // metadata-less activation path that could race or double-fire
        // against the first.
        if (event === "payment_intent.succeeded" && data) {
            logger.info(`[Webhook] Stripe payment_intent.succeeded: id=${data.id} amount=${data.amount} currency=${data.currency}`);
        }

        // payment_intent.payment_failed — log for retry/support visibility,
        // same posture as the Razorpay handler's payment.failed branch.
        if (event === "payment_intent.payment_failed" && data) {
            const reason = data.last_payment_error?.message || "unknown";
            logger.warn(`[Webhook] Stripe payment_intent.payment_failed: id=${data.id} reason=${reason}`);
        }

        if (dedupKey) recordIdempotency(dedupKey, { status: "ok" });
        res.json({ status: "ok" });
    } catch (err) {
        errTracker.record("stripe_webhook", err.message);
        logger.error("[Webhook] Stripe error:", err.message);
        res.sendStatus(500);
    }
}

module.exports = { handleRazorpayWebhook, handleStripeWebhook };
