"use strict";
/**
 * POST-Ω P11 — Autonomous Customer Organization
 * Routes: /customer-org/*
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");
// B.21: attachOrg resolves req.org from the X-Org-Id header (or the caller's
// own primary membership when absent) AND sets req.orgRole from real
// membership — so the org used for scoping below is verified, never simply
// trusted from a client header. Support tickets previously carried no tenant
// field at all, so listTickets() returned every org's tickets to every
// authenticated caller (reproduced live: two separate companies received the
// SAME 50-ticket list, containing neither company's own tickets).
//
// ECOSYSTEM OS RECOVERY (2026-08-15): _orgId(req) below correctly returns
// null for a forged X-Org-Id header the caller isn't a real member of — but
// every downstream service function (customerHealthEngine.listHealthRecords,
// and the same pattern elsewhere in this file) treats a null/undefined
// orgId as "don't filter" rather than "return nothing", by design, for
// legitimate unscoped/operator callers. That created an inverted
// vulnerability: an account with a FORGED header for an org it does not
// belong to received MORE data (the entire platform-wide record set) than
// a genuine member of its own org with zero records. Live-reproduced:
// GET /customer-org/health with X-Org-Id forged to a real foreign org
// returned 58 real records spanning many different real orgIds, while the
// same account's own org (no forgery) correctly returned 0. Fixed by
// requiring real membership in whatever org attachOrg resolves, closing
// off the "verified nobody" path before it can reach any handler — the
// same requireOrgMember gate business.js's CRM routes already use.
router.use("/customer-org", requireAuth, attachOrg, requireOrgMember);

/** The caller's verified org, or null when they hold no membership in it.
 * requireOrgMember above already guarantees req.orgRole is real by the time
 * any handler runs — kept as defense in depth, not the primary gate. */
function _orgId(req) {
    return req.org && req.orgRole ? req.org.id : null;
}

const _try   = fn => { try { return fn(); } catch { return null; } };
const _cje   = () => _try(() => require("../services/customerJourneyEngine.cjs"));
const _che   = () => _try(() => require("../services/customerHealthEngine.cjs"));
const _cse   = () => _try(() => require("../services/customerSuccessEngine.cjs"));
const _csup  = () => _try(() => require("../services/customerSupportEngine.cjs"));
const _cae   = () => _try(() => require("../services/customerAutomationEngine.cjs"));
const _cod   = () => _try(() => require("../services/customerOrganizationDashboard.cjs"));

function ok(res, data)     { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { err(res, e.message, 500); }
  };
}

// ── Journey ───────────────────────────────────────────────────────────────────
router.post("/customer-org/journey/sync", wrap(async (req, res) => {
  ok(res, _cje()?.syncJourneys?.());
}));
router.get("/customer-org/journey/stages", wrap(async (req, res) => {
  ok(res, _cje()?.getStageDistribution?.());
}));
// Phase B.16: /stats was registered AFTER /:customerId, so Express matched
// "stats" as a customerId and the route answered 404 {"error":"journey not
// found"} — the statistics were unreachable over HTTP even though getStats()
// works and holds real data (59 journeys). Same slip on health and automation
// below. /journey/stages was already correctly ordered above, which is how the
// pattern was spotted. Literal paths must precede the parameterised ones.
router.get("/customer-org/journey/stats", wrap(async (req, res) => {
  ok(res, _cje()?.getStats?.() || {});
}));
router.get("/customer-org/journey/:customerId", wrap(async (req, res) => {
  const j = _cje()?.getJourney?.(req.params.customerId, _orgId(req));
  if (!j) return err(res, "journey not found", 404);
  ok(res, { journey: j });
}));
// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): _orgId(req)
// was never threaded through here, so any authenticated customer (verified
// as a member of some org by the router-level requireOrgMember above, but
// not necessarily the RIGHT org for this specific customerId) could advance
// a foreign org's customer lifecycle stage. Live-reproduced. advanceStage()
// now takes the same optional orgId param as getJourney() and rejects a
// mismatch, matching the existing convention for this file's other routes.
router.post("/customer-org/journey/:customerId/advance", wrap(async (req, res) => {
  const r = _cje()?.advanceStage?.(req.params.customerId, req.body.stage, _orgId(req));
  if (r && r.ok === false && r.error === "journey not found") return err(res, "journey not found", 404);
  ok(res, r);
}));
// Cross-tenant fix — same class as /customer-org/support/tickets (B.21).
// listJourneys() now filters by orgId when the caller has a verified org
// membership (see customerJourneyEngine.cjs); without one, _orgId(req)
// returns null and the call stays unscoped (matches existing internal-caller
// behaviour, not a regression for callers with no org context).
router.get("/customer-org/journey", wrap(async (req, res) => {
  const { stage, churnRisk, limit } = req.query;
  ok(res, _cje()?.listJourneys?.({ stage, churnRisk, limit: Math.max(1, Math.min(parseInt(limit) || 50, 500)), orgId: _orgId(req) }));
}));

// ── Health ────────────────────────────────────────────────────────────────────
router.post("/customer-org/health/score-all", wrap(async (req, res) => {
  ok(res, _che()?.scoreAll?.());
}));
// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21):
// scoreCustomer() itself auto-attributes orgId from the matching CRM lead
// (by design — see the file's own comment), so it can't be spoofed on
// write. But nothing stopped a caller from targeting a customerId they have
// no relationship to at all: any authenticated customer could trigger a
// rescore of, and read the result for, another org's real customer.
// Live-reproduced. Fixed the same way as the read-side routes below: if a
// health record already exists for this customerId, its orgId must match
// the caller's verified org before a rescore is allowed.
router.post("/customer-org/health/score/:customerId", wrap(async (req, res) => {
  const existing = _che()?.getHealthRecord?.(req.params.customerId);
  if (existing && (existing.orgId || null) !== _orgId(req)) return err(res, "health record not found", 404);
  ok(res, _che()?.scoreCustomer?.(req.params.customerId, req.body));
}));
// Phase B.16: literal path before the parameterised ones (see /journey/stats).
router.get("/customer-org/health/stats", wrap(async (req, res) => {
  ok(res, _che()?.getStats?.() || {});
}));
router.get("/customer-org/health/:customerId", wrap(async (req, res) => {
  const h = _che()?.getHealthRecord?.(req.params.customerId, _orgId(req));
  if (!h) return err(res, "health record not found", 404);
  ok(res, { health: h });
}));
// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): neither
// route threaded _orgId(req) through, so any authenticated customer could
// read another org's real customer health history/trend by customerId.
// Live-reproduced. Fixed by passing the caller's verified orgId — both
// service functions now reject a mismatch, matching getHealthRecord().
router.get("/customer-org/health/:customerId/history", wrap(async (req, res) => {
  const r = _che()?.getHealthHistory?.(req.params.customerId, Math.max(1, Math.min(parseInt(req.query.limit) || 10, 500)), _orgId(req));
  if (r && r.ok === false) return err(res, r.error || "health record not found", 404);
  ok(res, r);
}));
router.get("/customer-org/health/:customerId/trend", wrap(async (req, res) => {
  const r = _che()?.getHealthTrend?.(req.params.customerId, _orgId(req));
  if (r && r.ok === false && r.error === "health record not found") return err(res, "health record not found", 404);
  ok(res, r);
}));
// Cross-tenant fix — same class as journeys above.
router.get("/customer-org/health", wrap(async (req, res) => {
  const { risk, grade, limit } = req.query;
  ok(res, _che()?.listHealthRecords?.({ risk, grade, limit: Math.max(1, Math.min(parseInt(limit) || 50, 500)), orgId: _orgId(req) }));
}));

// ── Success ───────────────────────────────────────────────────────────────────
// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): same
// class as health/score above — generateSuccessPlan() auto-attributes orgId
// from the health record (by design), but nothing stopped a caller from
// targeting a customerId outside their own org to generate/read a plan.
// Fixed the same way: if a plan already exists for this customerId, its
// orgId must match the caller's verified org first.
router.post("/customer-org/success/plan/:customerId", wrap(async (req, res) => {
  const existing = _cse()?.getPlan?.(req.params.customerId);
  if (existing && (existing.orgId || null) !== _orgId(req)) return err(res, "plan not found", 404);
  ok(res, _cse()?.generateSuccessPlan?.(req.params.customerId));
}));
router.get("/customer-org/success/plan/:customerId", wrap(async (req, res) => {
  const p = _cse()?.getPlan?.(req.params.customerId, _orgId(req));
  if (!p) return err(res, "plan not found", 404);
  ok(res, { plan: p });
}));
// Cross-tenant fix — same class as journeys/health above.
router.get("/customer-org/success/plans", wrap(async (req, res) => {
  ok(res, _cse()?.listPlans?.({ stage: req.query.stage, limit: parseInt(req.query.limit)||50, orgId: _orgId(req) }));
}));
// Customer-Reachable API / Data-Access Boundary Audit (2026-08-21): predict()
// derives real churn/renewal/NPS/support-demand intelligence from the
// customer's health+journey records with no orgId check at all — live-
// reproduced returning another org's real customer predictions. Fixed by
// checking the health record's own orgId (the same source predict() itself
// reads from) before allowing the call through.
router.post("/customer-org/success/predict/:customerId", wrap(async (req, res) => {
  const existing = _che()?.getHealthRecord?.(req.params.customerId);
  if (existing && (existing.orgId || null) !== _orgId(req)) return err(res, "customer not found", 404);
  ok(res, _cse()?.predict?.(req.params.customerId));
}));
// recordOutcome() only increments platform-wide aggregate counters
// (churnPrevented/expansionsTriggered) and forwards to the learning engine
// with no per-customer record read or written — no orgId-scoped data exists
// here to leak or corrupt, so no gate was needed (confirmed by reading the
// full function body, not assumed).
router.post("/customer-org/success/outcome/:customerId", wrap(async (req, res) => {
  ok(res, _cse()?.recordOutcome?.(req.params.customerId, req.body));
}));
router.get("/customer-org/success/stats", wrap(async (req, res) => {
  ok(res, _cse()?.getStats?.() || {});
}));

// ── Support ───────────────────────────────────────────────────────────────────
router.post("/customer-org/support/ticket", wrap(async (req, res) => {
  const r = _csup()?.createTicket?.({ ...req.body, orgId: _orgId(req) });
  if (!r?.ok) return err(res, r?.error || "create failed");
  ok(res, r);
}));
// Cross-tenant write IDOR — the sibling read route below already carries the
// B.21 ownership check; this mutation route never got the same guard. Any
// authenticated caller (verified: a member of a completely unrelated org)
// could resolve any other tenant's ticket by id — a real, persisted status
// change to data they had no relationship to, confirmed on disk
// (status flipped open -> resolved, resolvedAt stamped). Same 404-not-403
// convention as the read route, so the endpoint does not confirm existence
// to a caller who isn't the owner.
router.post("/customer-org/support/ticket/:id/resolve", wrap(async (req, res) => {
  const existing = _csup()?.getTicket?.(req.params.id);
  if (!existing) return err(res, "ticket not found", 404);
  const org = _orgId(req);
  if (org && existing.orgId !== org) return err(res, "ticket not found", 404);
  ok(res, _csup()?.resolveTicket?.(req.params.id, req.body));
}));
router.get("/customer-org/support/ticket/:id", wrap(async (req, res) => {
  const t = _csup()?.getTicket?.(req.params.id);
  if (!t) return err(res, "ticket not found", 404);
  // B.21: fetching by id was a direct IDOR — any authenticated caller could
  // read any tenant's ticket. A caller with a verified org may only read that
  // org's tickets; 404 (not 403) so the endpoint does not confirm existence.
  const org = _orgId(req);
  if (org && t.orgId !== org) return err(res, "ticket not found", 404);
  ok(res, { ticket: t });
}));
router.get("/customer-org/support/tickets", wrap(async (req, res) => {
  const { customerId, status, severity, limit } = req.query;
  // Phase B.15: `parseInt(limit)||50` was unclamped, so ?limit=-1 reached
  // Array.prototype.slice(0, -1) and returned 189 of 190 tickets — the same
  // negative-limit cap bypass recovered across 38 sites in Phase B.7.
  // Reproduced: limit=-1 → 189 rows, limit=99999 → 190 rows.
  ok(res, _csup()?.listTickets?.({
    customerId, status, severity,
    orgId: _orgId(req),
    limit: Math.max(1, Math.min(parseInt(limit) || 50, 500)),
  }));
}));
router.post("/customer-org/support/suggest", wrap(async (req, res) => {
  const { issue, customerId } = req.body;
  ok(res, _csup()?.getSuggestedResolution?.(issue, customerId));
}));
router.get("/customer-org/support/stats", wrap(async (req, res) => {
  ok(res, _csup()?.getStats?.() || {});
}));

// ── Automation ────────────────────────────────────────────────────────────────
router.post("/customer-org/automation/trigger", wrap(async (req, res) => {
  const { customerId, type, context, skipExecute } = req.body;
  if (!customerId || !type) return err(res, "customerId and type required");
  const r = await _cae()?.trigger?.(customerId, type, { context, skipExecute });
  if (!r?.ok) return err(res, r?.error || "trigger failed");
  ok(res, r);
}));
router.post("/customer-org/automation/scan", wrap(async (req, res) => {
  ok(res, await _cae()?.runAutomationScan?.({ skipExecute: req.body.skipExecute }));
}));
// Phase B.16: literal path before the parameterised one (see /journey/stats).
router.get("/customer-org/automation/stats", wrap(async (req, res) => {
  ok(res, _cae()?.getStats?.() || {});
}));
router.get("/customer-org/automation/:id", wrap(async (req, res) => {
  const a = _cae()?.getAutomation?.(req.params.id);
  if (!a) return err(res, "automation not found", 404);
  ok(res, { automation: a });
}));
router.get("/customer-org/automation", wrap(async (req, res) => {
  const { customerId, type, status, limit } = req.query;
  ok(res, _cae()?.listAutomations?.({ customerId, type, status, limit: Math.max(1, Math.min(parseInt(limit) || 50, 500)) }));
}));

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/customer-org/dashboard", wrap(async (req, res) => {
  ok(res, _cod()?.getDashboard?.() || { ok: false, error: "dashboard unavailable" });
}));
router.get("/customer-org/dashboard/customer/:customerId", wrap(async (req, res) => {
  ok(res, _cod()?.getCustomerView?.(req.params.customerId));
}));
router.get("/customer-org/dashboard/health", wrap(async (req, res) => {
  ok(res, _cod()?.getCustomerOrganizationHealth?.() || {});
}));

module.exports = router;
