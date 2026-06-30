"use strict";
const router = require("express").Router();
const crm    = require("../services/crmService");
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const operatorAudit = require("../middleware/operatorAudit");

// Operator-only bulk read (used by operator console / internal tooling)
router.get("/crm",       requireAuth, operatorOnly, (req, res) => res.json(crm.getLeads()));
router.get("/crm-leads", requireAuth, operatorOnly, (req, res) => res.json(crm.getLeads()));

// Customer-accessible: any authenticated user can manage their own contacts.
// operatorOnly was blocking role="user" accounts from ever adding or viewing contacts.
router.post("/crm/lead", requireAuth, operatorAudit, (req, res) => {
    const { phone, name, ...rest } = req.body;
    if (!phone) return res.status(400).json({ error: "phone required" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    if (name !== undefined && typeof name === "string" && name.trim().length > 200)
        return res.status(400).json({ error: "name too long — max 200 characters" });
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7)
        return res.status(400).json({ error: "Invalid phone number — include country code (e.g. 919876543210)" });
    const existing = crm.getLead(cleanPhone);
    if (existing) {
        const userId = req.user.sub || req.user.id || null;
        if (req.user.role === "operator" || existing.userId === userId) {
            return res.json({ success: true, duplicate: true, lead: existing, message: "Client already exists" });
        }
        return res.json({ success: true, duplicate: true, message: "Client already exists" });
    }
    const userId = req.user.sub || req.user.id || null;
    const lead = { phone: cleanPhone, name, ...rest, userId, status: "new", createdAt: new Date().toISOString() };
    crm.saveLead(lead);
    res.json({ success: true, duplicate: false, lead });
});

router.patch("/crm/lead/:phone", requireAuth, operatorAudit, (req, res) => {
    const phone = decodeURIComponent(req.params.phone);
    if (req.user.role !== "operator") {
        const lead = crm.getLead(phone);
        const userId = req.user.sub || req.user.id;
        if (!lead || lead.userId !== userId) {
            return res.status(403).json({ error: "Forbidden — not your lead" });
        }
    }
    crm.updateLead(phone, req.body);
    res.json({ success: true });
});

// Per-user contact list: returns only the leads belonging to the calling user.
// Scoped by userId (req.user.sub) so each SaaS customer sees only their own contacts.
router.get("/crm/leads", requireAuth, (req, res) => {
    const userId = req.user.sub || req.user.id;
    // Operator gets all leads; regular users get their own
    const all = crm.getLeads();
    if (req.user.role === "operator") return res.json(all);
    const mine = all.filter(l => l.userId === userId);
    res.json(mine);
});

module.exports = router;
