"use strict";
const router = require("express").Router();
const crm    = require("../services/crmService");
const { optionalAuth } = require("../middleware/firebaseAuth");

router.get("/crm",       optionalAuth, (req, res) => res.json(crm.getLeads()));
router.get("/crm-leads", optionalAuth, (req, res) => res.json(crm.getLeads()));

router.post("/crm/lead", optionalAuth, (req, res) => {
    const { phone, name, ...rest } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7)
        return res.status(400).json({ error: "Invalid phone number — include country code (e.g. 919876543210)" });
    const existing = crm.getLead(cleanPhone);
    if (existing)
        return res.json({ success: true, duplicate: true, message: "Client already exists" });
    crm.saveLead({ phone: cleanPhone, name, ...rest });
    res.json({ success: true, duplicate: false });
});

router.patch("/crm/lead/:phone", optionalAuth, (req, res) => {
    crm.updateLead(decodeURIComponent(req.params.phone), req.body);
    res.json({ success: true });
});

module.exports = router;
