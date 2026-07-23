"use strict";
/**
 * Universal Composition Engine — Completion Gaps Phase 5: Frontend
 * org/company scoping. Fast, service-layer regression test (the real,
 * slow end-to-end HTTP proof — including actual company creation via
 * the full 13-step pipeline — lives in
 * scratchpad/verify-phase5-org-scoping.cjs and was run manually against
 * a live server; this test proves the same underlying authorization
 * mechanism organizationService.hasPermission() genuinely denies
 * cross-org access, without paying the cost of the full AI-driven
 * company-creation pipeline for every test run).
 *
 * The real bug fixed: backend/routes/companyFactory.js's
 * GET /company-factory/companies (list), GET /company-factory/companies/:id,
 * and GET /company-factory/companies/:id/detail previously had ZERO
 * authorization — any authenticated account could view any other org's
 * company by id/list. Fixed by resolving the company's real orgId
 * server-side and checking organizationService.hasPermission(orgId,
 * accountId, "view_members") before returning data — never trusting a
 * frontend-supplied id without that check.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("Company Factory org/company scoping (Phase 5) — authorization mechanism", () => {
    const accountService = require("../../backend/services/accountService.js");
    const organizationService = require("../../backend/services/organizationService.cjs");

    let orgA, orgB, ownerA, ownerB, memberA, outsiderC;

    before(() => {
        const stamp = Date.now();
        ownerA = accountService.createAccount({ email: `p5-owner-a-${stamp}@test.local`, password: "TestPass123!", name: "Owner A" }).account;
        ownerB = accountService.createAccount({ email: `p5-owner-b-${stamp}@test.local`, password: "TestPass123!", name: "Owner B" }).account;
        memberA = accountService.createAccount({ email: `p5-member-a-${stamp}@test.local`, password: "TestPass123!", name: "Member A" }).account;
        outsiderC = accountService.createAccount({ email: `p5-outsider-c-${stamp}@test.local`, password: "TestPass123!", name: "Outsider C" }).account;

        orgA = organizationService.createOrg({ name: `P5 Org A ${stamp}` }, ownerA.id);
        orgB = organizationService.createOrg({ name: `P5 Org B ${stamp}` }, ownerB.id);
        organizationService.addMember(orgA.id, { accountId: memberA.id, orgRole: "member" }, ownerA.id);
    });

    after(() => {
        try { organizationService.deleteOrg(orgA.id, ownerA.id); } catch {}
        try { organizationService.deleteOrg(orgB.id, ownerB.id); } catch {}
    });

    describe("the real authorization mechanism the fixed routes rely on", () => {
        it("Org A's owner has view_members permission on Org A", () => {
            assert.equal(organizationService.hasPermission(orgA.id, ownerA.id, "view_members"), true);
        });
        it("Org A's member has view_members permission on Org A", () => {
            assert.equal(organizationService.hasPermission(orgA.id, memberA.id, "view_members"), true);
        });
        it("Org B's owner does NOT have view_members permission on Org A — cross-org denied", () => {
            assert.equal(organizationService.hasPermission(orgA.id, ownerB.id, "view_members"), false);
        });
        it("Org A's owner does NOT have view_members permission on Org B — cross-org denied (reverse direction)", () => {
            assert.equal(organizationService.hasPermission(orgB.id, ownerA.id, "view_members"), false);
        });
        it("a completely unrelated outsider (not a member of either org) is denied on BOTH", () => {
            assert.equal(organizationService.hasPermission(orgA.id, outsiderC.id, "view_members"), false);
            assert.equal(organizationService.hasPermission(orgB.id, outsiderC.id, "view_members"), false);
        });
    });

    describe("listOrgs() — the mechanism the fixed company-list route uses to scope results server-side", () => {
        it("Org A's owner's listOrgs() includes Org A but NOT Org B", () => {
            const { orgs } = organizationService.listOrgs(ownerA.id);
            const ids = orgs.map(o => o.id);
            assert.ok(ids.includes(orgA.id), "Org A owner should see Org A in their own org list");
            assert.ok(!ids.includes(orgB.id), "Org A owner must NOT see Org B in their own org list");
        });
        it("Org B's owner's listOrgs() includes Org B but NOT Org A", () => {
            const { orgs } = organizationService.listOrgs(ownerB.id);
            const ids = orgs.map(o => o.id);
            assert.ok(ids.includes(orgB.id));
            assert.ok(!ids.includes(orgA.id));
        });
        it("an outsider's listOrgs() includes neither Org A nor Org B", () => {
            const { orgs } = organizationService.listOrgs(outsiderC.id);
            const ids = orgs.map(o => o.id);
            assert.ok(!ids.includes(orgA.id));
            assert.ok(!ids.includes(orgB.id));
        });
    });
});

describe("companyFactory.js route source — structural verification of the fix", () => {
    const fs = require("fs");
    const path = require("path");
    const routeSource = fs.readFileSync(path.join(__dirname, "../../backend/routes/companyFactory.js"), "utf8");

    it("GET /company-factory/companies (list) now resolves the caller's authorized orgs server-side via listOrgs(accountId)", () => {
        const listRouteMatch = routeSource.match(/router\.get\("\/company-factory\/companies",[\s\S]{0,800}?\}\);/);
        assert.ok(listRouteMatch, "could not locate the company-list route");
        assert.ok(listRouteMatch[0].includes("_org()?.listOrgs?.(accountId)"), "the list route must resolve authorized orgs via organizationService.listOrgs(accountId), not trust a client-supplied filter");
        assert.ok(listRouteMatch[0].includes("authorizedOrgIds"), "the list route must filter results against the caller's own authorized org set");
    });

    it("GET /company-factory/companies/:id now requires _requireCompanyOrgPermission (real server-side authorization), not a bare id lookup", () => {
        const singleRouteMatch = routeSource.match(/router\.get\("\/company-factory\/companies\/:id",[\s\S]{0,300}?\}\);/);
        assert.ok(singleRouteMatch, "could not locate the single-company route");
        assert.ok(singleRouteMatch[0].includes("_requireCompanyOrgPermission"), "GET /company-factory/companies/:id must call _requireCompanyOrgPermission, not a bare unauthenticated lookup");
    });

    it("GET /company-factory/companies/:id/detail now requires _requireCompanyOrgPermission", () => {
        const detailRouteMatch = routeSource.match(/router\.get\("\/company-factory\/companies\/:id\/detail",[\s\S]{0,300}?\}\);/);
        assert.ok(detailRouteMatch, "could not locate the company-detail route");
        assert.ok(detailRouteMatch[0].includes("_requireCompanyOrgPermission"), "GET /company-factory/companies/:id/detail must call _requireCompanyOrgPermission");
    });
});
