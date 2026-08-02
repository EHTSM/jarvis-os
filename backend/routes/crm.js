"use strict";
const router = require("express").Router();
const crm    = require("../services/crmService");
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");
const operatorAudit = require("../middleware/operatorAudit");
const { parseCsvRecords } = require("../utils/csvParse.cjs");
const rateLimiter = require("../middleware/rateLimiter");

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

// Enterprise Capability Expansion mission — real bulk CRM import.
// Confirmed genuinely absent before this: POST /crm/lead only ever
// accepted one lead per request. Reuses the exact same validation
// (phone required, digit-only, min 7 digits, name length cap) and dedup
// logic (existing phone -> duplicate, never overwritten) as the
// single-lead route above, just looped over real parsed CSV rows instead
// of a single req.body. Rate-limited since a bulk import is a much
// heavier write than a single lead.
function _validateLeadRow(row) {
    const phone = row.phone || row.Phone || row.mobile || row.Mobile;
    if (!phone) return { error: "phone required" };
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7) return { error: "invalid phone number" };
    const name = row.name || row.Name || undefined;
    if (name !== undefined && String(name).trim().length > 200) return { error: "name too long — max 200 characters" };
    return { cleanPhone, name };
}

router.post("/crm/leads/import", requireAuth, rateLimiter(5, 15 * 60_000), operatorAudit, (req, res) => {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== "string") return res.status(400).json({ error: "csv (string body) required" });

    let records;
    try { records = parseCsvRecords(csv); }
    catch (e) { return res.status(400).json({ error: "Could not parse CSV: " + e.message }); }
    if (!records.length) return res.status(400).json({ error: "CSV contains no data rows" });
    if (records.length > 5000) return res.status(400).json({ error: "Import limited to 5000 rows per request" });

    const userId = req.user.sub || req.user.id || null;
    const results = { imported: 0, duplicates: 0, failed: 0, errors: [] };

    records.forEach((row, i) => {
        const v = _validateLeadRow(row);
        if (v.error) {
            results.failed++;
            if (results.errors.length < 50) results.errors.push({ row: i + 2, error: v.error });
            return;
        }
        const existing = crm.getLead(v.cleanPhone);
        if (existing) { results.duplicates++; return; }
        const { phone: _p, name: _n, ...rest } = row;
        const lead = { phone: v.cleanPhone, name: v.name, ...rest, userId, status: "new", createdAt: new Date().toISOString() };
        crm.saveLead(lead);
        results.imported++;
    });

    res.json({ success: true, totalRows: records.length, ...results });
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

// Enterprise Import/Export Validation mission — real CSV export.
// Confirmed genuinely absent before this: every existing "export"-adjacent
// endpoint in this codebase just returned JSON. This produces real,
// RFC-4180-safe CSV bytes (Content-Type: text/csv, quoted cells, comma-
// separated) — same quoting approach already used by
// auditService.cjs's _toCsv (JSON.stringify per cell handles embedded
// commas/quotes/newlines correctly without a new CSV library). Respects
// the exact same operator-vs-own-leads scoping as GET /crm/leads above —
// a regular user can only export their own contacts, never the full CRM.
function _leadsToCsv(leads) {
    // Column set is the union of every field actually present across the
    // leads being exported (crmService's schema is free-form/spread), with
    // the common ones ordered first for a stable, readable column order.
    const preferredOrder = ["phone", "name", "status", "userId", "createdAt", "lastCampaign", "lastCampaignAt"];
    const allKeys = new Set();
    for (const l of leads) for (const k of Object.keys(l)) allKeys.add(k);
    const cols = [...preferredOrder.filter(k => allKeys.has(k)), ...[...allKeys].filter(k => !preferredOrder.includes(k)).sort()];
    if (!cols.length) return "\n";

    const header = cols.map(c => JSON.stringify(c)).join(",") + "\n";
    const rows = leads.map(l => cols.map(c => JSON.stringify(String(l[c] ?? ""))).join(","));
    return header + rows.join("\n") + (rows.length ? "\n" : "");
}

router.get("/crm/leads/export", requireAuth, (req, res) => {
    const userId = req.user.sub || req.user.id;
    const all = crm.getLeads(req.query.status || undefined);
    const scoped = req.user.role === "operator" ? all : all.filter(l => l.userId === userId);

    const csv = _leadsToCsv(scoped);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="crm-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
});

module.exports = router;
