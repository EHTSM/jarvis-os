"use strict";
/**
 * CRM Service — unified lead management.
 * Storage: ../data/leads.json (JSON array, relative to project root).
 *
 * Standard lead schema:
 *   { phone, name, userId, orgId, status, lastMessage, lastInteraction, paymentStatus,
 *     createdAt, updatedAt, chatId, paymentId, onboardingDone }
 *
 * Final Production Integration mission — org isolation fix. Confirmed
 * genuine cross-org data leak before this: every function here read/wrote
 * one flat, unscoped array — dedup-by-phone meant two different
 * organizations onboarding a contact who shares a phone number would
 * collide (the second org's "new lead" would silently become a duplicate
 * of the first org's real lead record, exposing it). orgId follows the
 * exact same additive, nullable convention already used by
 * creativeAssetLibrary.cjs (`orgId: opts.orgId || null`, filtered only
 * when the caller supplies one) — existing null-orgId leads (pre-org
 * accounts, or operator-created records) keep working unchanged.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE = path.join(__dirname, "../../data/leads.json");

// ── Internal I/O ───────────────────────────────────────────────────
function _read() {
    try {
        if (!fs.existsSync(DATA_FILE)) return [];
        const raw = fs.readFileSync(DATA_FILE, "utf-8").trim();
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

// OOPLIX V1 MASTER AUDIT (2026-08-16, load-test coverage audit): the old
// fixed `DATA_FILE + ".tmp"` path meant every concurrent saveLead() call's
// read-modify-write cycle shared one literal tmp filename — the same defect
// class already found and fixed in taskQueue.cjs's _save() (Final
// Production Integration mission, Blocker #6) and missionMemory.cjs's
// _saveMissions() — this file was never swept for the identical pattern.
// Fixed with the same proven per-call-unique tmp filename (pid + random
// suffix), eliminating the literal-path collision. Note: this file is not
// actually the write path POST /business/leads exercises (that route calls
// businessDataService.cjs's createLead(), a separate module also fixed this
// same pass); saveLead() here is used by the WhatsApp/webhook ingestion
// pipeline instead — fixed on the same evidence-driven sweep for the
// identical pattern, not because a defect was live-reproduced through this
// specific file.
function _write(data) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
}

// Digits-only identity normalization, used everywhere this file compares
// two phone-like values for equality (dedup on save, lookup by phone in
// updateLead/getLead). Was six independent `.replace(/\D/g, "")` call
// sites — consolidated to one function so the identity rule can't drift
// between them. Distinct from paymentService.js/whatsappService.js's own
// phone normalization, which ALSO strips leading zeros because it builds
// an international dialing format (`+${clean}`) for an outbound API call
// — a different operation with a real reason to diverge, not the same
// bug; not consolidated with this one.
function _normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Save a new lead (deduplicates by phone, WITHIN the same orgId only —
 * two different orgs may legitimately have a contact sharing a phone
 * number; a null-orgId caller only dedups against other null-orgId leads).
 */
function saveLead(lead) {
    const data = _read();
    const phone = _normalizePhone(lead.phone);
    const userId = String(lead.userId || lead.chatId || "");
    const orgId = lead.orgId || null;

    // Reject leads with no usable identifier
    if (!phone && (!userId || userId === "unknown")) return;

    // Dedup by phone (if present), scoped to the same org
    if (phone && data.some(l => _normalizePhone(l.phone) === phone && (l.orgId || null) === orgId)) return;
    // Dedup by userId (non-phone leads like Telegram chatIds), scoped to the same org
    if (!phone && userId && data.some(l => String(l.userId || l.chatId || "") === userId && (l.orgId || null) === orgId)) return;

    data.push({
        phone:           phone || null,
        name:            lead.name            || null,
        userId:          lead.userId          || lead.chatId || null,
        orgId,
        status:          lead.status          || "new",
        lastMessage:     lead.lastMessage     || null,
        lastInteraction: new Date().toISOString(),
        paymentStatus:   lead.paymentStatus   || "pending",
        createdAt:       new Date().toISOString(),
        updatedAt:       new Date().toISOString(),
        chatId:          lead.chatId          || null,
        paymentId:       null,
        onboardingDone:  false,
        ...lead
    });
    _write(data);
}

/**
 * Update a lead identified by phone or userId, scoped to orgId when
 * supplied — an org-scoped caller can never patch another org's lead
 * even if the identifier collides.
 */
function updateLead(identifier, updates, orgId) {
    const data   = _read();
    const clean  = _normalizePhone(identifier);
    const updated = data.map(l => {
        if (orgId !== undefined && (l.orgId || null) !== (orgId || null)) return l;
        const lPhone = _normalizePhone(l.phone || l.userId);
        if (lPhone === clean || String(l.userId) === String(identifier)) {
            return { ...l, ...updates, updatedAt: new Date().toISOString() };
        }
        return l;
    });
    _write(updated);
}

/**
 * Get all leads, optionally filtered by status and/or orgId.
 * orgId undefined = no org filter (operator/global view, unchanged
 * behavior for existing callers); orgId given = only that org's leads.
 */
function getLeads(filterStatus, orgId) {
    const data = _read();
    let out = filterStatus ? data.filter(l => l.status === filterStatus) : data;
    if (orgId !== undefined) out = out.filter(l => (l.orgId || null) === (orgId || null));
    return out;
}

/**
 * Get a single lead by phone or userId, optionally scoped to orgId —
 * when orgId is supplied, a lead belonging to a different org is treated
 * as not found rather than returned (the actual fix for the phone-number
 * collision leak: org A's lookup can no longer resolve to org B's lead).
 */
function getLead(identifier, orgId) {
    const clean = _normalizePhone(identifier);
    return _read().find(l => {
        if (orgId !== undefined && (l.orgId || null) !== (orgId || null)) return false;
        return _normalizePhone(l.phone) === clean || String(l.userId) === String(identifier);
    }) || null;
}

/**
 * Get CRM statistics, optionally scoped to orgId.
 */
function getStats(orgId) {
    const data = orgId !== undefined ? getLeads(undefined, orgId) : _read();
    const paid = data.filter(l => l.status === "paid" || l.paymentStatus === "paid");
    return {
        total:          data.length,
        new:            data.filter(l => l.status === "new").length,
        hot:            data.filter(l => l.status === "hot").length,
        paid:           paid.length,
        onboarded:      data.filter(l => l.onboardingDone).length,
        revenue:        paid.length * (parseInt(process.env.PRODUCT_PRICE) || 999),
        conversionRate: data.length > 0 ? ((paid.length / data.length) * 100).toFixed(1) + "%" : "0%"
    };
}

module.exports = { saveLead, updateLead, getLeads, getLead, getStats };
