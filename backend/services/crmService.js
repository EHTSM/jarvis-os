"use strict";
/**
 * CRM Service — unified lead management.
 * Storage: ../data/leads.json (JSON array, relative to project root).
 *
 * Standard lead schema:
 *   { phone, name, userId, status, lastMessage, lastInteraction, paymentStatus,
 *     createdAt, updatedAt, chatId, paymentId, onboardingDone }
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/leads.json");

// ── Internal I/O ───────────────────────────────────────────────────
function _read() {
    try {
        if (!fs.existsSync(DATA_FILE)) return [];
        const raw = fs.readFileSync(DATA_FILE, "utf-8").trim();
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function _write(data) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Save a new lead (deduplicates by phone).
 */
function saveLead(lead) {
    const data = _read();
    const phone = String(lead.phone || "").replace(/\D/g, "");
    const userId = String(lead.userId || lead.chatId || "");

    // Reject leads with no usable identifier
    if (!phone && (!userId || userId === "unknown")) return;

    // Dedup by phone (if present)
    if (phone && data.some(l => String(l.phone || "").replace(/\D/g, "") === phone)) return;
    // Dedup by userId (non-phone leads like Telegram chatIds)
    if (!phone && userId && data.some(l => String(l.userId || l.chatId || "") === userId)) return;

    data.push({
        phone:           phone || null,
        name:            lead.name            || null,
        userId:          lead.userId          || lead.chatId || null,
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
 * Update a lead identified by phone or userId.
 */
function updateLead(identifier, updates) {
    const data   = _read();
    const clean  = String(identifier || "").replace(/\D/g, "");
    const updated = data.map(l => {
        const lPhone = String(l.phone || l.userId || "").replace(/\D/g, "");
        if (lPhone === clean || String(l.userId) === String(identifier)) {
            return { ...l, ...updates, updatedAt: new Date().toISOString() };
        }
        return l;
    });
    _write(updated);
}

/**
 * Get all leads, optionally filtered by status.
 */
function getLeads(filterStatus) {
    const data = _read();
    return filterStatus ? data.filter(l => l.status === filterStatus) : data;
}

/**
 * Get a single lead by phone or userId.
 */
function getLead(identifier) {
    const clean = String(identifier || "").replace(/\D/g, "");
    return _read().find(l =>
        String(l.phone || "").replace(/\D/g, "") === clean ||
        String(l.userId) === String(identifier)
    ) || null;
}

/**
 * Get CRM statistics.
 */
function getStats() {
    const data = _read();
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
