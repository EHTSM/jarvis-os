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
const { attachOrg, requireOrgPermission } = require("../middleware/orgMiddleware.cjs");

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
    // Connector Secret Isolation: added phone_id (stored under the existing
    // webhook_secret credential type, same reuse-an-existing-slot convention
    // already used for Razorpay's second field below) so whatsappService.js
    // can resolve BOTH values this org needs to actually send through its
    // own WhatsApp Business number, not just the token.
    fields: [
      { key: "api_key",        label: "WhatsApp API Token", type: "password" },
      { key: "webhook_secret", label: "Phone Number ID",    type: "text" },
    ],
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
  // Enterprise & Physical Integration Mission, Module 5 — connectorId/type
  // pairs match the ENV_MAP entries just added in secretVault.cjs and the
  // connect<Name>() functions in integrationConnectors.cjs; nothing new to
  // wire on the vault side, this just exposes the curated setup form.
  teams: {
    label: "Microsoft Teams", connectorId: "msg:teams", category: "messaging",
    fields: [{ key: "webhook_secret", label: "Incoming Webhook URL", type: "password" }],
  },
  notion: {
    label: "Notion", connectorId: "prod:notion", category: "productivity",
    fields: [{ key: "api_key", label: "Internal Integration Token", type: "password" }],
  },
  jira: {
    label: "Jira", connectorId: "issue:jira", category: "project_management",
    fields: [{ key: "personal_access_token", label: "API Token", type: "password" }],
  },
  linear: {
    label: "Linear", connectorId: "issue:linear", category: "project_management",
    fields: [{ key: "api_key", label: "API Key", type: "password" }],
  },
  // Capability Reuse Verification mission — real posting via
  // backend/services/socialPostingService.cjs. Field key "oauth_token"
  // matches that service's vault.getSecret(CONNECTOR_ID, "oauth_token", orgId)
  // lookup, and secretVault.cjs's CRED_TYPES set (X's API v2 auth model is
  // a single bearer token, which fits the existing oauth_token slot).
  twitter: {
    label: "X (Twitter)", connectorId: "social:twitter", category: "social",
    fields: [{ key: "oauth_token", label: "Bearer Token", type: "password" }],
  },
};

// attachOrg alone does NOT block cross-tenant access — it resolves req.org
// from a CLIENT-SUPPLIED X-Org-Id header/body field with no ownership
// check (see orgMiddleware.cjs's own docstring: "Does NOT block requests
// — use requireOrgMember() for enforcement"). Every route below was
// missing that enforcement (Vault Security Hardening finding: a genuine
// cross-tenant IDOR — any authenticated user could pass another org's ID
// and store/list/delete/validate that org's connector credentials).
//
// Connector Permission Scoping: upgraded from requireOrgMember (any role)
// to requireOrgPermission("manage_connectors") (org_owner/org_admin only).
// These credentials are third-party secrets (WhatsApp/Razorpay/Stripe/etc)
// for the whole org, the same sensitivity class as manage_billing/manage_sso
// — a plain "member" or "viewer" role should not be able to read presence
// of, rotate, or delete them. manage_connectors is its own dedicated
// permission in organizationService.cjs's ACTIONS map, not a reuse of
// manage_billing, so this doesn't couple connector access to billing policy.
router.use("/my-connectors", requireAuth, attachOrg, requireOrgPermission("manage_connectors"));

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
    // Enterprise Module 4: connector-restriction policy (allow/deny list by
    // connectorId) applies here too, not just the Company Factory route.
    require("../services/policyService.cjs").assertConnectorAllowed(orgId, def.connectorId);
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
