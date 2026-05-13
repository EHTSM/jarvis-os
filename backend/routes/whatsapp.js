"use strict";
const router     = require("express").Router();
const wa         = require("../services/whatsappService");
const crm        = require("../services/crmService");
const controller = require("../controllers/jarvisController");

// Webhook verification (GET) — Meta sends this to confirm the endpoint.
router.get("/whatsapp/webhook", (req, res) => {
    const check = wa.verifyWebhook(req.query);
    if (check.valid) return res.status(200).send(check.challenge);
    res.sendStatus(403);
});

// Incoming messages (POST) — handled by the full sales/intelligence pipeline.
router.post("/whatsapp/webhook", controller.handleWhatsAppWebhook);

router.post("/whatsapp/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
    const result = await wa.sendMessage(phone, message);
    res.json(result);
});

router.post("/whatsapp/bulk", async (req, res) => {
    const { message, statusFilter } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    const leads = crm.getLeads(statusFilter || "new").filter(l => l.phone);
    const batch = leads.slice(0, 50);   // hard cap — stays under WA Cloud API rate limits
    let sent = 0;
    const _sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < batch.length; i++) {
        const r = await wa.sendMessage(batch[i].phone, message);
        if (r.success) sent++;
        if (i < batch.length - 1) await _sleep(1_200);
    }
    res.json({ success: true, sent, total: leads.length });
});

module.exports = router;
