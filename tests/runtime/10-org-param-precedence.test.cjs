"use strict";
/**
 * Phase B.7 regression: X-Org-Id must never override an :orgId path param.
 *
 * attachOrg() resolves the tenant for a request. It used to give the X-Org-Id
 * header unconditional precedence, which turned every route shaped
 * `/orgs/:orgId/...` into a confused deputy: requireOrgPermission() authorized
 * against the HEADER's org while the handler read req.params.orgId and served
 * the PATH's org.
 *
 * Reproduced live 3/3 — an account holding membership in org A only:
 *     GET /orgs/<orgB>/members   with   X-Org-Id: <orgA>   -> 200 + org B roster
 *     GET /orgs/<orgB>/members   (no header)               -> 403
 * Confirmed on /members, /departments and /teams.
 *
 * These tests build two REAL organizations through organizationService and
 * assert on the resolved req.org.id / req.orgRole, so they fail if the
 * precedence regresses. (An earlier draft used non-existent org ids; both
 * resolved to null, so it passed with and without the fix — worthless.)
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { attachOrg } = require("../../backend/middleware/orgMiddleware.cjs");
const orgSvc = require("../../backend/services/organizationService.cjs");

const RUN     = `b7-${Date.now().toString(36)}`;
const OWNER   = `acct_${RUN}_owner`;

let PATH_ORG;    // caller is a real member (owner) here
let HEADER_ORG;  // caller has NO membership here

before(() => {
    PATH_ORG   = orgSvc.createOrg({ name: `${RUN}-path` },   OWNER).id;
    HEADER_ORG = orgSvc.createOrg({ name: `${RUN}-header` }, `acct_${RUN}_other`).id;
});

after(() => {
    // purgeOrg is permission-gated; archive via the owner instead so the test
    // leaves no active fixtures behind.
    try { orgSvc.archiveOrg(PATH_ORG, OWNER); } catch { /* best effort */ }
    try { orgSvc.archiveOrg(HEADER_ORG, `acct_${RUN}_other`); } catch { /* best effort */ }
});

function resolve({ params = {}, headers = {}, query = {}, body = {} }) {
    const req = { params, headers, query, body, user: { sub: OWNER } };
    let called = false;
    attachOrg(req, {}, () => { called = true; });
    assert.equal(called, true, "attachOrg must always call next()");
    return req;
}

describe("org resolution precedence (Phase B.7)", () => {
    it("resolves the :orgId path param, not a conflicting X-Org-Id header", () => {
        const req = resolve({
            params:  { orgId: PATH_ORG },
            headers: { "x-org-id": HEADER_ORG },
        });
        assert.equal(req.org.id, PATH_ORG, "the addressed resource must be the authorization subject");
        assert.notEqual(req.org.id, HEADER_ORG, "header must not win over the path param");
    });

    it("does not grant the header org's role when the path org differs", () => {
        // The live bypass worked precisely because orgRole came from the header
        // org (where the caller was owner) while the handler served the path org.
        const req = resolve({
            params:  { orgId: HEADER_ORG },   // caller is NOT a member here
            headers: { "x-org-id": PATH_ORG }, // caller IS owner here
        });
        assert.equal(req.org.id, HEADER_ORG, "resolution must follow the path param");
        assert.equal(req.orgRole, null, "no role may be inherited from the header org");
    });

    it("still honours X-Org-Id when the route carries no :orgId", () => {
        const req = resolve({ headers: { "x-org-id": HEADER_ORG } });
        assert.equal(req.org.id, HEADER_ORG, "header remains the selector for non-:orgId routes");
    });

    it("ignores query/body orgId that contradicts the path param", () => {
        const req = resolve({
            params: { orgId: PATH_ORG },
            query:  { orgId: HEADER_ORG },
            body:   { orgId: HEADER_ORG },
        });
        assert.equal(req.org.id, PATH_ORG);
    });

    it("grants the caller's real role when path and header agree", () => {
        const req = resolve({
            params:  { orgId: PATH_ORG },
            headers: { "x-org-id": PATH_ORG },
        });
        assert.equal(req.org.id, PATH_ORG);
        assert.equal(req.orgRole, "org_owner", "legitimate access must keep working");
    });

    it("never throws and calls next() with no org context at all", () => {
        assert.doesNotThrow(() => resolve({}));
    });
});
