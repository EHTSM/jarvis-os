"use strict";
const router  = require("express").Router();
const payment = require("../services/paymentService");
const wa      = require("../services/whatsappService");
const { handleRazorpayWebhook } = require("../controllers/webhookController");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

// Unauthenticated by design (Razorpay calls this directly) and HMAC-verified
// inside handleRazorpayWebhook, but still rate-limited per IP so a flood
// can't exhaust webhook-processing capacity before the signature check runs.
const _webhookRL = rateLimiter(30, 60_000, "payment-webhook");

// External Actions, Payments, Webhooks & Side-Effect Security Audit
// (2026-08-21): same gap as /billing/upgrade — a real external Razorpay
// payment-link creation call per request, plus a real WhatsApp send when a
// phone is supplied, with zero rate limit. Same established fix pattern.
const _paymentLinkRL = rateLimiter(15, 60_000, "payment-link-create");

router.post("/payment/link", requireAuth, _paymentLinkRL, async (req, res) => {
    try {
        const { amount = 999, name = "Customer", phone, description = "JARVIS Access" } = req.body;
        const accountId = req.user.sub || req.user.id || null;
        // Connector Secret Isolation: pass through org context when present
        // (req.org is populated by attachOrg on routes that mount it) so an
        // org with its own connected Razorpay/WhatsApp account (via
        // /my-connectors/*) uses its own credentials instead of the
        // founder's global ones. orgId is undefined today on this route
        // (attachOrg isn't mounted here), which preserves current behavior
        // exactly — this only activates once org context is attached.
        const orgId = req.org?.id || null;
        const result = await payment.createPaymentLink({ amount, name, phone, description, accountId, orgId });
        if (!result.success) return res.status(500).json({ error: result.error });
        if (phone) await wa.sendMessage(phone, `Your payment link:\n${result.link}\n\nAmount: ₹${amount}`, 2, orgId);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/webhook/razorpay", _webhookRL, handleRazorpayWebhook);
router.post("/razorpay-webhook", _webhookRL, handleRazorpayWebhook);

module.exports = router;
