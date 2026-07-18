"use strict";
/**
 * myConnectors.js — customer-facing connector setup (Public SaaS mission,
 * Module 7).
 *
 * The existing /integrations/* and /vault/* routes manage the FOUNDER's own
 * platform-wide connector credentials (env-var-backed, operator-only) — a
 * regular customer has no way to connect their OWN WhatsApp/payment/email
 * account. This file adds a small, curated set of customer-connectable
 * providers, backed by secretVault.cjs's existing org-scoping (storeSecret's
 * orgId parameter), so each org's credentials are private to that org.
 *
 * Does not duplicate secretVault.cjs or integrationConnectors.cjs — this is
 * a thin, org-scoped, curated-subset wrapper over the existing vault.
 *
 * Routes (all require org membership via attachOrg):
 *   GET    /my-connectors                — list this org's connector status
 *   POST   /my-connectors/:providerId    — store this org's credential(s)
 *   DELETE /my-connectors/:providerId    — remove this org's credential(s)
 *   POST   /my-connectors/:providerId/validate — check presence/rotation status
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg } = require("../middleware/orgMiddleware.cjs");

function _vault() { try { return require("../services/secretVault.cjs"); } catch { return null; } }

function _ok(res, data)     { res.json({ ok: true, ...data }); }
function _err(res, e, code) { res.status(code || 400).json({ ok: false, error: e?.message || String(e) }); }

// Curated customer-connectable providers. connectorId/type map onto
// secretVault.cjs's existing (connectorId, type) key shape and CRED_TYPES —
// intentionally a SUBSET of the founder's full A-L catalogue, limited to
// providers a customer would plausibly bring their own account for.
const PROVIDERS = {
  whatsapp: {
    label: "WhatsApp Business", connectorId: "msg:whatsapp", category: "messaging",
    fields: [{ key: "api_key", label: "WhatsApp API Token", type: "password" }],
  },
  razorpay: {
    label: "Razorpay", connectorId: "pay:razorpay", category: "payments",
    fields: [
      { key: "api_key",        label: "Key ID",        type: "text" },
      { key: "webhook_secret", label: "Key Secret",    type: "password" },
    ],
  },
  stripe: {
    label: "Stripe", connectorId: "pay:stripe", category: "payments",
    fields: [
      { key: "api_key",        label: "Secret Key",     type: "password" },
      { key: "webhook_secret", label: "Webhook Secret", type: "password" },
    ],
  },
  smtp: {
    label: "Email (SMTP)", connectorId: "email:smtp", category: "email",
    fields: [{ key: "smtp_credentials", label: "SMTP Password", type: "password" }],
  },
};

router.use("/my-connectors", requireAuth, attachOrg);

// GET /my-connectors — status of every curated provider for the caller's org
router.get("/my-connectors", (req, res) => {
  const vault = _vault();
  if (!vault) return _err(res, new Error("secretVault unavailable"), 503);
  const orgId = req.org?.id;
  if (!orgId) return _err(res, new Error("No organization context — join or create an organization first"), 400);

  try {
    const providers = Object.entries(PROVIDERS).map(([id, def]) => {
      const fieldStatus = def.fields.map(f => {
        const v = vault.validateSecret(def.connectorId, f.key, orgId);
        return { key: f.key, label: f.label, present: v.present && v.source === "vault", detail: v.detail };
      });
      return {
        id, label: def.label, category: def.category,
        connected: fieldStatus.every(f => f.present),
        fields: fieldStatus,
      };
    });
    _ok(res, { providers });
  } catch (e) { _err(res, e, 500); }
});

// POST /my-connectors/:providerId — store this org's credential(s)
// Body: { [fieldKey]: value, ... } — one or more of the provider's fields.
router.post("/my-connectors/:providerId", (req, res) => {
  const vault = _vault();
  if (!vault) return _err(res, new Error("secretVault unavailable"), 503);
  const orgId = req.org?.id;
  if (!orgId) return _err(res, new Error("No organization context — join or create an organization first"), 400);

  const def = PROVIDERS[req.params.providerId];
  if (!def) return _err(res, new Error(`Unknown provider: ${req.params.providerId}`), 404);

  const body = req.body || {};
  const validKeys = new Set(def.fields.map(f => f.key));
  const stored = [];
  try {
    for (const [key, value] of Object.entries(body)) {
      if (!validKeys.has(key)) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      vault.storeSecret(def.connectorId, key, value.trim(), { setBy: req.user.sub }, orgId);
      stored.push(key);
    }
    if (!stored.length) return _err(res, new Error("No valid credential fields provided"), 400);
    _ok(res, { providerId: req.params.providerId, stored });
  } catch (e) { _err(res, e, 400); }
});

// DELETE /my-connectors/:providerId — remove all of this org's stored fields
router.delete("/my-connectors/:providerId", (req, res) => {
  const vault = _vault();
  if (!vault) return _err(res, new Error("secretVault unavailable"), 503);
  const orgId = req.org?.id;
  if (!orgId) return _err(res, new Error("No organization context"), 400);

  const def = PROVIDERS[req.params.providerId];
  if (!def) return _err(res, new Error(`Unknown provider: ${req.params.providerId}`), 404);

  try {
    const removed = def.fields
      .map(f => vault.deleteSecret(def.connectorId, f.key, orgId))
      .filter(Boolean).length;
    _ok(res, { providerId: req.params.providerId, removed });
  } catch (e) { _err(res, e, 400); }
});

// POST /my-connectors/:providerId/validate — re-check presence/rotation status
router.post("/my-connectors/:providerId/validate", (req, res) => {
  const vault = _vault();
  if (!vault) return _err(res, new Error("secretVault unavailable"), 503);
  const orgId = req.org?.id;
  if (!orgId) return _err(res, new Error("No organization context"), 400);

  const def = PROVIDERS[req.params.providerId];
  if (!def) return _err(res, new Error(`Unknown provider: ${req.params.providerId}`), 404);

  try {
    const results = def.fields.map(f => ({ key: f.key, ...vault.validateSecret(def.connectorId, f.key, orgId) }));
    _ok(res, { providerId: req.params.providerId, results });
  } catch (e) { _err(res, e, 400); }
});

module.exports = router;
