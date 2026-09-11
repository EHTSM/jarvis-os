"use strict";
/**
 * B.21 — support ticket tenant scoping.
 *
 * Reproduced live during the real-company simulation: two genuinely separate
 * companies (Atlas Works / Borealis) each called
 * GET /customer-org/support/tickets and received the SAME 50-ticket list —
 * containing other tenants' tickets (support_test_1, escalation_test, …) and
 * NEITHER company's own. Tickets carried no tenant field at all, and
 * listTickets() applied no org filter.
 *
 * Fetching by id was a separate direct IDOR: any authenticated caller could
 * read any ticket by guessing/observing its id.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ENGINE = path.join(__dirname, "..", "..", "backend", "services", "customerSupportEngine.cjs");
const ROUTES = path.join(__dirname, "..", "..", "backend", "routes", "customerOrg.js");

describe("B.21 — support ticket tenant scoping", () => {
  it("createTicket records an orgId on the ticket", () => {
    const eng = require(ENGINE);
    const r = eng.createTicket({
      customerId: `b21-test-${Date.now()}`,
      issue: "b21 regression probe",
      orgId: "org_B21_TEST_A",
    });
    assert.equal(r.ok, true, "ticket creation should succeed");
    assert.equal(r.ticket.orgId, "org_B21_TEST_A",
      "a ticket must carry the creating org — without it no list can be scoped");
  });

  it("listTickets returns only the requested org's tickets", () => {
    const eng = require(ENGINE);
    const orgA = `org_B21_A_${Date.now()}`;
    const orgB = `org_B21_B_${Date.now()}`;
    eng.createTicket({ customerId: "b21-a", issue: "alpha issue", orgId: orgA });
    eng.createTicket({ customerId: "b21-b", issue: "beta issue",  orgId: orgB });

    const a = eng.listTickets({ orgId: orgA, limit: 500 });
    const b = eng.listTickets({ orgId: orgB, limit: 500 });

    assert.ok(a.tickets.length >= 1, "org A must see its own ticket");
    assert.ok(b.tickets.length >= 1, "org B must see its own ticket");
    assert.equal(a.tickets.every(t => t.orgId === orgA), true,
      "org A must see ONLY org A tickets — this is the reproduced cross-tenant leak");
    assert.equal(b.tickets.every(t => t.orgId === orgB), true,
      "org B must see ONLY org B tickets");
    assert.equal(a.tickets.some(t => t.orgId === orgB), false,
      "org A must not see org B's tickets");
  });

  it("an org with no tickets sees an empty list, not the platform's", () => {
    const eng = require(ENGINE);
    const r = eng.listTickets({ orgId: "org_B21_DEFINITELY_NONE", limit: 500 });
    assert.equal(r.tickets.length, 0,
      `an org with no tickets must see 0, got ${r.tickets.length} — legacy rows must not be attributed to whoever asks`);
  });

  it("an unscoped call still works (internal callers such as stats)", () => {
    const eng = require(ENGINE);
    const r = eng.listTickets({ limit: 5 });
    assert.equal(r.ok, true);
    assert.equal(Array.isArray(r.tickets), true);
  });

  it("the routes resolve a VERIFIED org, not a client-supplied header", () => {
    const src = fs.readFileSync(ROUTES, "utf8");
    assert.match(src, /attachOrg/,
      "the router must attach the org via middleware that checks real membership");
    assert.match(src, /req\.org && req\.orgRole \? req\.org\.id : null/,
      "scoping must require a real membership role, so a forged X-Org-Id header cannot widen access");
  });

  it("the list and create routes pass the caller's org through", () => {
    const src = fs.readFileSync(ROUTES, "utf8");
    assert.match(src, /createTicket\?\.\(\{ \.\.\.req\.body, orgId: _orgId\(req\) \}\)/,
      "create must stamp the caller's org");
    assert.match(src, /listTickets\?\.\(\{[\s\S]*?orgId: _orgId\(req\)/,
      "list must scope by the caller's org");
  });

  it("fetching a ticket by id is scoped (closes the IDOR)", () => {
    const src = fs.readFileSync(ROUTES, "utf8");
    assert.match(src, /if \(org && t\.orgId !== org\) return err\(res, "ticket not found", 404\)/,
      "reading a ticket by id must reject another org's ticket, and must not confirm it exists");
  });
});
