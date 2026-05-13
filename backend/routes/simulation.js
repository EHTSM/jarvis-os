"use strict";
const router     = require("express").Router();
const crm        = require("../services/crmService");
const payment    = require("../services/paymentService");
const wa         = require("../services/whatsappService");
const ai         = require("../services/aiService");
const automation = require("../services/automationService");

router.post("/send-followup", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });
    const result = await automation.sendManualFollowUp(phone, message);
    res.json(result);
});

router.post("/simulate/full-flow", async (req, res) => {
    const { phone = "919999999999", name = "Test User" } = req.body;
    const steps = [];

    try {
        crm.saveLead({ phone, name });
        steps.push({ step: 1, label: "Lead saved", ok: true });

        const aiR = await ai.callAI("Hello, I want to automate my business.");
        steps.push({ step: 2, label: "AI replied", ok: !!aiR, preview: aiR.slice(0, 80) });

        const p = await payment.createPaymentLink({ amount: 999, name, description: "JARVIS Sim" });
        steps.push({ step: 3, label: "Payment link", ok: p.success, link: p.link });

        const token = process.env.WA_TOKEN || process.env.WHATSAPP_TOKEN;
        if (token && p.link) {
            const waR = await wa.sendMessage(phone, `Sim: ${p.link}`);
            steps.push({ step: 4, label: "WA message sent", ok: waR.success });
        } else {
            steps.push({ step: 4, label: "WA skip (not configured)", ok: true });
        }

        crm.updateLead(phone, { status: "paid", paymentStatus: "paid", paymentId: "sim_" + Date.now() });
        steps.push({ step: 5, label: "CRM updated to paid", ok: true });

        const lead = crm.getLead(phone);
        steps.push({ step: 6, label: "CRM verified", ok: lead?.status === "paid", leadStatus: lead?.status });

        res.json({ success: true, steps });
    } catch (err) {
        res.json({ success: false, steps, error: err.message });
    }
});

module.exports = router;
