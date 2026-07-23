"use strict";
const crypto     = require("crypto");
const router     = require("express").Router();
const wa         = require("../services/whatsappService");
const crm        = require("../services/crmService");
const controller = require("../controllers/jarvisController");
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter = require("../middleware/rateLimiter");

// ── WhatsApp HMAC verification ────────────────────────────────────
// Meta signs every incoming webhook with HMAC-SHA256 using the app secret.
// Header: x-hub-signature-256: sha256=<hex>
// Env var: WHATSAPP_APP_SECRET  (set in Meta App Dashboard > App Settings > App Secret)
function _verifyWhatsAppSignature(rawBody, header) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
        // Not configured — reject in production, warn in dev
        if (process.env.NODE_ENV === "production") return false;
        console.warn("[WA] WHATSAPP_APP_SECRET not set — skipping HMAC verification (dev only)");
        return true;
    }
    if (!header || !header.startsWith("sha256=")) return false;
    const incoming = Buffer.from(header.slice(7), "hex");
    const expected = crypto.createHmac("sha256", secret)
        .update(rawBody || "")
        .digest();
    if (incoming.length !== expected.length) return false;
    return crypto.timingSafeEqual(incoming, expected);
}

// ── Replay protection ──────────────────────────────────────────────
// Meta's webhook delivery is at-least-once — the same message.id can
// legitimately arrive more than once on retry, but a captured-and-replayed
// request must not be reprocessed (double CRM writes, double AI replies).
// Reuses the same bounded Map+TTL dedup pattern already used for runtime
// dispatch idempotency (backend/routes/runtime.js _dedupCache) — no new
// dedup mechanism, no external store.
const _seenMessageIds = new Map(); // messageId -> firstSeenTs
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000; // Meta retries webhooks for up to 24h
setInterval(() => {
    const cutoff = Date.now() - REPLAY_TTL_MS;
    for (const [id, ts] of _seenMessageIds) {
        if (ts < cutoff) _seenMessageIds.delete(id);
    }
}, 60 * 60 * 1000).unref();

function _extractMessageId(body) {
    return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || null;
}

function _isReplay(messageId) {
    if (!messageId) return false; // no id to key on (e.g. status callbacks) — can't dedup, let through
    if (_seenMessageIds.has(messageId)) return true;
    _seenMessageIds.set(messageId, Date.now());
    return false;
}

// Webhook verification (GET) — Meta sends this to confirm the endpoint.
router.get("/whatsapp/webhook", (req, res) => {
    const check = wa.verifyWebhook(req.query);
    if (check.valid) return res.status(200).send(check.challenge);
    res.sendStatus(403);
});

// Incoming messages (POST) — HMAC verified + rate-limited.
router.post(
    "/whatsapp/webhook",
    rateLimiter(300, 60_000, "wa-webhook"),   // 300 req/min — Meta sends batched events
    (req, res, next) => {
        const sig    = req.headers["x-hub-signature-256"] || "";
        const body   = req.rawBody || "";
        if (!_verifyWhatsAppSignature(body, sig)) {
            console.warn("[WA] Webhook HMAC mismatch — rejected");
            return res.status(401).json({ error: "Invalid webhook signature" });
        }
        // req.body is not reliable here — see handleWhatsAppWebhook's comment
        // in backend/controllers/jarvisController.js for why (rawBody.js
        // drains the stream before express.json() can parse it for this
        // route). Parse req.rawBody the same way.
        let parsedBody = null;
        try { parsedBody = req.rawBody ? JSON.parse(req.rawBody) : req.body; }
        catch { parsedBody = req.body; }
        const messageId = _extractMessageId(parsedBody);
        if (_isReplay(messageId)) {
            console.warn(`[WA] Replay detected for message ${messageId} — rejected`);
            return res.status(400).json({ error: "Replay detected" });
        }
        next();
    },
    controller.handleWhatsAppWebhook
);

router.post("/whatsapp/send", requireAuth, async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone and message required" });
    const result = await wa.sendMessage(phone, message);
    res.json(result);
});

router.post("/whatsapp/bulk", requireAuth, async (req, res) => {
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
