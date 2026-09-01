#!/usr/bin/env node
"use strict";
/**
 * Payments Ecosystem mission — /payment/link tenant-isolation fix regression.
 *
 * Discovery + direct verification found /payment/link never mounted
 * attachOrg, even though paymentService.js's _resolveCreds(orgId) has
 * resolved org-scoped Razorpay/WhatsApp credentials since a prior
 * "Connector Secret Isolation" mission — the route's own comment predicted
 * exactly this: "this only activates once org context is attached." Fixed
 * by mounting attachOrg + the SAME non-blocking-then-gate pattern
 * (_requireOrgMemberIfOrgContext) already proven across every social
 * platform in this codebase (test 114 and its 12+ siblings) — attachOrg
 * alone resolves req.org from a caller-supplied X-Org-Id/body.orgId with
 * NO membership check, so it must never be mounted without a follow-up
 * gate wherever the resolved org is used for a credential-consuming
 * write action.
 *
 * Usage: node tests/security/142-payment-link-tenant-isolation.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function resStub() {
  let code = null, body = null;
  return { status(c) { code = c; return this; }, json(b) { body = b; return this; }, _code: () => code, _body: () => body };
}

async function main() {
  section("Wiring — /payment/link composes attachOrg + the org-membership gate before its handler");
  {
    const router = require("../../backend/routes/payment.js");
    const linkLayer = router.stack.find(l => l.route && l.route.path === "/payment/link" && l.route.methods.post);
    assert(!!linkLayer, "POST /payment/link route exists");
    const names = linkLayer.route.stack.map(h => h.name);
    assert(names.includes("attachOrg"), "POST /payment/link mounts attachOrg", names.join(","));
    assert(names.includes("_requireOrgMemberIfOrgContext"), "POST /payment/link mounts the membership gate", names.join(","));
    assert(names.indexOf("attachOrg") < names.indexOf("_requireOrgMemberIfOrgContext"),
      "attachOrg runs before the membership gate", names.join(","));
  }

  section("Behavior — a resolved-but-foreign org is rejected before the payment-link handler runs");
  {
    const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
    function _requireOrgMemberIfOrgContext(req, res, next) {
      if (!req.org) return next();
      return requireOrgMember(req, res, next);
    }
    const orgSvc = require("../../backend/services/organizationService.cjs");
    const origAdmin  = orgSvc.isEnterpriseAdmin;
    const origGrants = orgSvc.listGrantsForAccount;
    orgSvc.isEnterpriseAdmin    = () => false;
    orgSvc.listGrantsForAccount = () => [];
    try {
      let called = false;
      const res = resStub();
      const req = {
        org: { id: "victim-org", status: "active" },
        orgRole: null,
        user: { sub: "attacker-account" },
        path: "/payment/link",
      };
      _requireOrgMemberIfOrgContext(req, res, () => { called = true; });
      assert(called === false, "handler (and paymentService's credential lookup) never runs for a non-member");
      assert(res._code() === 403, "caller receives 403, not a silent pass-through", `got ${res._code()}`);
    } finally {
      orgSvc.isEnterpriseAdmin    = origAdmin;
      orgSvc.listGrantsForAccount = origGrants;
    }
  }

  section("Behavior — no org context at all falls through (solo/global-fallback caller unaffected)");
  {
    const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
    function _requireOrgMemberIfOrgContext(req, res, next) {
      if (!req.org) return next();
      return requireOrgMember(req, res, next);
    }
    let called = false;
    const req = { org: null };
    _requireOrgMemberIfOrgContext(req, resStub(), () => { called = true; });
    assert(called === true, "solo caller with no resolved org passes straight through to the handler (global env fallback preserved)");
  }

  section("Behavior — a genuine member of the resolved org still passes");
  {
    const { requireOrgMember } = require("../../backend/middleware/orgMiddleware.cjs");
    function _requireOrgMemberIfOrgContext(req, res, next) {
      if (!req.org) return next();
      return requireOrgMember(req, res, next);
    }
    let called = false;
    const req = { org: { id: "own-org", status: "active" }, orgRole: "member", user: { sub: "real-member-account" } };
    _requireOrgMemberIfOrgContext(req, resStub(), () => { called = true; });
    assert(called === true, "a real member of the resolved org reaches the handler normally");
  }

  section("Webhook routes remain completely unauthenticated (Razorpay must be able to call them directly)");
  {
    const router = require("../../backend/routes/payment.js");
    const webhookLayer1 = router.stack.find(l => l.route && l.route.path === "/webhook/razorpay" && l.route.methods.post);
    const webhookLayer2 = router.stack.find(l => l.route && l.route.path === "/razorpay-webhook" && l.route.methods.post);
    assert(!!webhookLayer1 && !!webhookLayer2, "both Razorpay webhook routes still exist");
    const names1 = webhookLayer1.route.stack.map(h => h.name);
    assert(!names1.includes("requireAuth"), "webhook route does NOT require auth (Razorpay has no session)", names1.join(","));
    assert(!names1.includes("attachOrg"), "webhook route does NOT require org context either", names1.join(","));
  }

  console.log(`\n${"=".repeat(60)}\n  Pass: ${pass}   Fail: ${fail}\n${"=".repeat(60)}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
