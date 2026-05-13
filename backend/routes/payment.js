"use strict";
const router  = require("express").Router();
const payment = require("../services/paymentService");
const wa      = require("../services/whatsappService");
const { handleRazorpayWebhook } = require("../controllers/webhookController");

router.post("/payment/link", async (req, res) => {
    try {
        const { amount = 999, name = "Customer", phone, description = "JARVIS Access" } = req.body;
        const result = await payment.createPaymentLink({ amount, name, phone, description });
        if (!result.success) return res.status(500).json({ error: result.error });
        if (phone) await wa.sendMessage(phone, `Your payment link:\n${result.link}\n\nAmount: ₹${amount}`);
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/webhook/razorpay", handleRazorpayWebhook);
router.post("/razorpay-webhook", handleRazorpayWebhook);

module.exports = router;
