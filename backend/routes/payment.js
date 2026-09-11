"use strict";
const router  = require("express").Router();
const payment = require("../services/paymentService");
const stripe  = require("../services/stripeService");
const billing = require("../services/billingService");
const wa      = require("../services/whatsappService");
const { handleRazorpayWebhook, handleStripeWebhook } = require("../controllers/webhookController");
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
const rateLimiter = require("../middleware/rateLimiter");
const approvalQueue = require("../services/approvalQueue.cjs");

// Payments Ecosystem mission: paymentService.js's _resolveCreds(orgId) has
// resolved org-scoped Razorpay credentials since Connector Secret Isolation
// (see paymentService.js's own comment) — but this route never mounted
// attachOrg, so req.org was always undefined and orgId was always null in
// practice (the exact gap this file's own prior comment predicted: "this
// only activates once org context is attached"). Fixed the same way as
// every other credential-consuming route in this codebase that resolves a
// real external financial credential: attachOrg (non-blocking — resolves
// req.org from a caller-supplied X-Org-Id/body.orgId with NO membership
// check on its own, per orgMiddleware.cjs's own docstring) MUST be paired
// with a membership gate before the resolved org is used for anything
// beyond a read/auto-resolve fallback — otherwise a caller from Org A could
// set X-Org-Id/body.orgId to Org B and this route would create a payment
// link (and send a real WhatsApp message) using Org B's own stored
// Razorpay/WhatsApp credentials. Same bug class, same fix, as the
// cross-tenant credential-hijack already found and fixed on
// creativeStudio.js's social publish routes (test 114) — a solo caller
// with no org at all still falls through to the documented global
// Razorpay/WhatsApp env fallback, unaffected.
function _requireOrgMemberIfOrgContext(req, res, next) {
    if (!req.org) return next();
    return requireOrgMember(req, res, next);
}

// Unauthenticated by design (Razorpay calls this directly) and HMAC-verified
// inside handleRazorpayWebhook, but still rate-limited per IP so a flood
// can't exhaust webhook-processing capacity before the signature check runs.
const _webhookRL = rateLimiter(30, 60_000, "payment-webhook");

// External Actions, Payments, Webhooks & Side-Effect Security Audit
// (2026-08-21): same gap as /billing/upgrade — a real external Razorpay
// payment-link creation call per request, plus a real WhatsApp send when a
// phone is supplied, with zero rate limit. Same established fix pattern.
const _paymentLinkRL = rateLimiter(15, 60_000, "payment-link-create");

router.post("/payment/link", requireAuth, attachOrg, _requireOrgMemberIfOrgContext, _paymentLinkRL, async (req, res) => {
    try {
        const { amount = 999, name = "Customer", phone, description = "JARVIS Access" } = req.body;
        const accountId = req.user.sub || req.user.id || null;
        // Connector Secret Isolation: pass through org context so an org
        // with its own connected Razorpay/WhatsApp account (via
        // /my-connectors/*) uses its own credentials instead of the
        // founder's global ones. attachOrg + _requireOrgMemberIfOrgContext
        // above now actually gate this — a solo caller with no org still
        // falls through to the global env fallback, unaffected.
        const orgId = req.org?.id || null;
        const result = await payment.createPaymentLink({ amount, name, phone, description, accountId, orgId });
        if (!result.success) return res.status(500).json({ error: result.error });
        if (phone) await wa.sendMessage(phone, `Your payment link:\n${result.link}\n\nAmount: ₹${amount}`, 2, orgId);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/webhook/razorpay", _webhookRL, handleRazorpayWebhook);
router.post("/razorpay-webhook", _webhookRL, handleRazorpayWebhook);

// ERA-2 Mission 76 (12_ROADMAP.md P10): Stripe webhook receiving/
// verification path. Unauthenticated by design (Stripe calls this
// directly) and HMAC-verified inside handleStripeWebhook, same posture
// and same per-IP rate limit as the Razorpay webhook above.
router.post("/webhook/stripe", _webhookRL, handleStripeWebhook);
router.post("/stripe-webhook", _webhookRL, handleStripeWebhook);

// ERA-2 Mission 76 (P10 continuation): Stripe Checkout Session creation.
// Same security shape as /payment/link above — requireAuth + attachOrg +
// _requireOrgMemberIfOrgContext so a caller cannot select another org's
// connected Stripe credentials (Connector Secret Isolation, same bug class
// as the /payment/link fix documented above), plus its own rate limit
// (same 15/min magnitude as _paymentLinkRL — a real external Stripe API
// call per request, same cost-exposure shape).
//
// Deliberately whitelist-only for pricing: `plan` must be one of
// billingService's real plans (starter/growth/scale) — the amount charged
// is ALWAYS resolved server-side from billingService.PLAN_PRICES (or a
// configured STRIPE_PRICE_ID_<PLAN>), never taken from the client. This
// closes the "arbitrary destination/amount manipulation" risk the mission
// explicitly calls out: a client cannot request an arbitrary amount,
// currency, or Stripe priceId — only a plan name it then maps server-side.
const _stripeCheckoutRL = rateLimiter(15, 60_000, "stripe-checkout-create");

router.post("/payment/stripe/checkout", requireAuth, attachOrg, _requireOrgMemberIfOrgContext, _stripeCheckoutRL, async (req, res) => {
    try {
        const { plan, mode = "payment" } = req.body || {};
        if (!["starter", "growth", "scale"].includes(plan)) {
            return res.status(400).json({ error: "Invalid plan. Choose: starter, growth, scale" });
        }
        if (!["payment", "subscription"].includes(mode)) {
            return res.status(400).json({ error: "Invalid mode. Choose: payment, subscription" });
        }

        const accountId = req.user.sub || req.user.id || null;
        const orgId     = req.org?.id || null;
        const email     = req.user.email || null;

        // Public HTTPS domain required for a coherent post-checkout redirect
        // (Stripe itself will happily redirect to localhost, but a customer
        // completing payment on their own device would land on a URL only
        // reachable from the server's machine) — same BASE_URL guard
        // paymentService.js's createPaymentLink() already enforces for
        // Razorpay's webhook callback_url, applied here for the redirect
        // target instead.
        const _baseUrl = process.env.BASE_URL || "";
        if (!_baseUrl || _baseUrl.includes("localhost") || _baseUrl.includes("127.0.0.1")) {
            return res.status(500).json({ error: "BASE_URL is not set to a public domain. Set BASE_URL=https://yourdomain.com in .env so Stripe can redirect customers back after checkout." });
        }

        const priceId = process.env[`STRIPE_PRICE_ID_${plan.toUpperCase()}`] || null;
        if (mode === "subscription" && !priceId) {
            return res.status(400).json({ error: `Subscription checkout requires STRIPE_PRICE_ID_${plan.toUpperCase()} to be configured in .env (Stripe needs a real recurring Price for subscriptions).` });
        }

        // Idempotency: derive a stable key from account+plan+mode+minute-
        // bucket, mirroring paymentService.js's refundPayment() use of a
        // caller-identity-scoped key rather than inventing a second scheme.
        // A caller retrying the exact same checkout request within the
        // window gets Stripe's original session back instead of a second
        // session (Stripe's own real Idempotency-Key mechanism — see
        // stripeService.js's createCheckoutSession() doc comment), while a
        // genuinely new checkout attempt a few minutes later is not
        // permanently blocked.
        const idempotencyKey = req.body?.idempotencyKey
            ? `stripe-checkout:${orgId || accountId || "global"}:${String(req.body.idempotencyKey).slice(0, 60)}`
            : `stripe-checkout:${orgId || accountId || "global"}:${plan}:${mode}:${Math.floor(Date.now() / 60000)}`;

        const result = await stripe.createCheckoutSession({
            priceId,
            amount: priceId ? null : (billing.PLAN_PRICES[plan] || 999) * 100, // Stripe amounts are minor units (cents); billingService.PLAN_PRICES is in whole currency units
            currency: "usd",
            productName: `Ooplix ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
            successUrl: `${_baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${_baseUrl}/billing/cancelled`,
            customerEmail: email,
            // Server-derived metadata only — accountId/orgId/plan come from
            // the authenticated session and server-side membership check
            // above, never from client-supplied body fields, so the
            // webhook handler can later trust this metadata to activate
            // the correct account without re-trusting client input.
            metadata: { accountId: accountId || "", orgId: orgId || "", plan },
            mode,
            orgId,
            idempotencyKey,
        });

        if (!result.success) {
            const status = result.status === 401 || result.status === 403 ? 502 : (result.retryable ? 503 : 400);
            return res.status(status).json({ error: result.error });
        }

        // Session creation succeeding means Stripe accepted the request —
        // it does NOT mean payment succeeded. No billing/CRM state is
        // touched here; only a verified webhook event
        // (checkout.session.completed / payment_intent.succeeded) may ever
        // establish that, per CLAUDE.md §17/§18 and this mission's explicit
        // instruction not to fabricate successful payment state.
        res.json({ success: true, sessionId: result.sessionId, url: result.url });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Payments Ecosystem mission: gateway-level refund, request→execute shape,
// reusing the EXACT same approvalQueue.cjs + wf_refund_finance policy
// already established and operator-only-gated for the internal credit-note
// refund path in revenueOS.js (RISK.HIGH, no autoApproveThreshold — a
// gateway refund can never auto-approve, per approvalPolicy.cjs's own
// shouldAutoApprove() logic, which only ever returns true for LOW/MEDIUM
// risk). This is a SEPARATE request/execute pair from revenueOS.js's,
// not a modification of it — that route issues an internal credit note
// against accountId/invoiceId (no real paymentId in its context shape); a
// real Razorpay gateway refund needs an actual payment_id, a genuinely
// different operation, reusing the same approval infrastructure rather
// than overloading the existing route's meaning.
const _refundRL = rateLimiter(10, 60_000, "payment-refund-request");

router.post("/payment/refund", requireAuth, operatorOnly, _refundRL, (req, res) => {
    try {
        const { paymentId, amount, reason } = req.body || {};
        if (!paymentId) return res.status(400).json({ error: "paymentId required" });

        const result = approvalQueue.enqueue({
            workflowId:  "wf_refund_finance",
            action:      `Issue gateway refund${amount ? ` of ${amount}` : " (full amount)"} for Razorpay payment ${paymentId}`,
            reason:      reason || "customer_request",
            approvalType: "PAYMENT_CONFIRM",
            expectedOutcome: `Razorpay refund issued for payment ${paymentId}`,
            rollbackPlan: "No rollback needed if rejected — no refund is issued until approved.",
            confidence:  0,
            context:     { paymentId, amount: amount || null, reason: reason || "customer_request", orgId: req.org?.id || null },
            triggeredBy: `operator:${req.user?.sub || "unknown"}`,
        });

        res.status(202).json({
            ok: true,
            status: result.autoApproved ? "auto_approved" : "pending_approval",
            reqId: result.reqId,
            request: result.request,
            message: result.autoApproved
                ? "Refund approved automatically by policy — call /payment/refund/:reqId/execute to complete it."
                : "Refund requires approval before it will execute. Approve via POST /approval/approve/:reqId, then call /payment/refund/:reqId/execute.",
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/payment/refund/:reqId/execute", requireAuth, operatorOnly, attachOrg, _requireOrgMemberIfOrgContext, async (req, res) => {
    try {
        const reqRecord = approvalQueue.getRequest(req.params.reqId);
        if (!reqRecord) return res.status(404).json({ error: "approval_request_not_found" });
        if (reqRecord.workflowId !== "wf_refund_finance") return res.status(400).json({ error: "wrong_request_type" });
        if (reqRecord.status !== "approved" && reqRecord.status !== "auto_approved") {
            return res.status(409).json({ error: "not_approved", status: reqRecord.status });
        }
        if (reqRecord.resumedAt) {
            return res.status(409).json({ error: "already_executed", executedAt: reqRecord.resumedAt });
        }

        const orgId = req.org?.id || reqRecord.context.orgId || null;
        const result = await payment.refundPayment(reqRecord.context.paymentId, {
            amount: reqRecord.context.amount,
            orgId,
            idempotencyKey: req.params.reqId, // the approval request id itself — one approved request can only ever execute one real refund
        });

        if (!result.success) return res.status(422).json({ ok: false, error: result.error });

        approvalQueue.markResumed(req.params.reqId);
        res.json({ ok: true, refundId: result.refundId, status: result.status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
