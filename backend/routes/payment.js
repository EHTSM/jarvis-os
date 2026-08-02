"use strict";
const router  = require("express").Router();
const payment = require("../services/paymentService");
const wa      = require("../services/whatsappService");
const { handleRazorpayWebhook } = require("../controllers/webhookController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/payment/link", requireAuth, async (req, res) => {
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

router.post("/webhook/razorpay", handleRazorpayWebhook);
router.post("/razorpay-webhook", handleRazorpayWebhook);

module.exports = router;
