"use strict";
/**
 * Enterprise & Physical Integration Mission — Module 2: Enterprise Directory
 * Prefix: /enterprise/scim/:orgId/v2/* (the SCIM protocol endpoints — bearer
 *         auth per RFC 7644, verified against that org's own SCIM token)
 *         /enterprise/scim/:orgId/token (admin token management — requireAuth)
 *
 * SCIMMY.Resources.declare() is a process-wide singleton registration, so
 * User/Group handlers are declared once at module load; org-scoping happens
 * per-request via the `context` callback (Express route params, including
 * :orgId), which scimmy-routers passes through to every ingress/egress/
 * degress call as their second argument.
 */

const router = require("express").Router();
const SCIMMY = require("scimmy");
// scimmy-routers is an ESM package whose CJS interop shim exposes the real
// constructor under .default (verified directly: require("scimmy-routers")
// returns { SCIMMY, SCIMMYRouters, default } — not the constructor itself).
const SCIMMYRouters = require("scimmy-routers").default;
const { requireAuth } = require("../middleware/authMiddleware");

const _try = fn => { try { return fn(); } catch { return null; } };
const _scim = () => _try(() => require("../services/scimService.cjs"));

// ── One-time SCIMMY resource declarations ───────────────────────────────────
// ctx here is whatever the `context` callback below returns — this router
// always returns { orgId }, so every handler is fully org-scoped.

SCIMMY.Resources.declare(SCIMMY.Resources.User)
  .ingress((resource, instance, ctx) => _scim().ingressUser(ctx.orgId, resource, instance))
  .egress((resource, ctx) => _scim().egressUsers(ctx.orgId, resource))
  .degress((resource, ctx) => _scim().degressUser(ctx.orgId, resource));

SCIMMY.Resources.declare(SCIMMY.Resources.Group)
  .ingress((resource, instance, ctx) => _scim().ingressGroup(ctx.orgId, resource, instance))
  .egress((resource, ctx) => _scim().egressGroups(ctx.orgId, resource))
  .degress((resource, ctx) => _scim().degressGroup(ctx.orgId, resource));

// ── SCIM protocol endpoints (bearer-authed against the org's own token) ─────

router.use(
  "/enterprise/scim/:orgId/v2",
  (req, res, next) => new SCIMMYRouters({
    type: "bearer",
    docUri: "https://datatracker.ietf.org/doc/html/rfc7644",
    handler: (request) => {
      // request.params is populated the same way here as in the outer
      // Express route — scimmy-routers is itself mounted as middleware.
      const orgId = request.params.orgId;
      _scim().verifyScimBearer(orgId, request.header("Authorization"));
      return orgId; // returned value becomes the "authenticated user ID" scimmy-routers logs internally
    },
    context: (request) => ({ orgId: request.params.orgId }),
  })(req, res, next)
);

// ── Admin: SCIM token management (requires an authenticated session) ───────

router.get("/enterprise/scim/:orgId/token", requireAuth, (req, res) => {
  try {
    res.json({ ok: true, ..._scim().getScimToken(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post("/enterprise/scim/:orgId/token/rotate", requireAuth, (req, res) => {
  try {
    res.json({ ok: true, ..._scim().rotateScimToken(req.params.orgId, req.user.sub) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.delete("/enterprise/scim/:orgId/token", requireAuth, (req, res) => {
  try {
    res.json(_scim().deleteScimToken(req.params.orgId, req.user.sub));
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
