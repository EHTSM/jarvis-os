"use strict";
/**
 * Phase B.17 regression: an organization must never become ownerless.
 *
 * removeMember() has always refused to delete the org owner
 * ("Cannot remove the org owner — transfer ownership first"), but
 * updateMemberRole() had no equivalent guard — so the SAME protection was
 * bypassable by demotion instead of removal.
 *
 * Reproduced live on a real 4-member organization (org_owner, org_admin,
 * dept_lead, team_lead): the sole org_owner PATCHed itself to "viewer" and got
 * HTTP 200. The organization was then permanently unmanageable:
 *
 *   ex-owner  DELETE /orgs/:id                  → 403 (no longer owner)
 *   ex-owner  PATCH  self back to org_owner     → 403
 *   ex-owner  PATCH  /orgs/:id (update_org)     → 403
 *   org_admin PATCH  anyone to org_owner        → 400 "Use transferOwnership…"
 *   org_admin DELETE /orgs/:id                  → 403 (delete_org is owner-only)
 *
 * …and there is no transferOwnership function or route anywhere in the product
 * (organizationService exports 39 functions, none named that — the name exists
 * only inside that error string). Nothing could recover the organization; the
 * store had to be repaired by hand.
 *
 * The fix mirrors removeMember's existing guard. It is deliberately scoped to
 * the LAST owner: an org with a second owner can still hand over, and demoting
 * any non-last owner still works.
 *
 * No new HR system, no new workforce model, no new storage.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT  = path.join(__dirname, "../..");
const SVC   = path.join(ROOT, "backend/services/organizationService.cjs");
const STORE = path.join(ROOT, "data/organizations.json");

const org = require("../../backend/services/organizationService.cjs");

// Mission 71: this file always assumed data/organizations.json already
// existed (its every helper below reads it directly via fs.readFileSync,
// with no guard) — true whenever some other parallel-batch test's
// createOrg() call had already run first, which was common but never
// guaranteed. Mission 68 moved every createOrg()-calling file into
// MISSION_MUTATING's serialized batch (a real, separate fix for a real
// lost-update race — see organizationService.cjs's own _write() comment),
// which run-test-suite.cjs always runs strictly AFTER the parallel batch
// completes. This file itself never calls createOrg(), so it was never a
// candidate for that list — it now reliably runs to completion in the
// parallel phase before any org has ever been created on a fresh checkout,
// turning an occasional race into a guaranteed ENOENT. Mirrors
// organizationService.cjs's own _read() contract (JSON.parse from disk,
// {orgs:[]} on any read/parse failure — including a missing file) instead
// of reading the real service's private state, so this file's fixture
// helpers below establish their own precondition rather than assuming
// ambient state seeded by another file.
const read = p => {
    try { return fs.readFileSync(p, "utf8"); }
    catch { return JSON.stringify({ orgs: [] }); }
};

/** Build a throwaway org with a known role set, and always clean it up. */
function withOrg(roles, fn) {
    const ownerId = `b17-owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Build the whole fixture in ONE read-modify-write. organizations.json is a
    // shared whole-file store with no locking, so when the suite directory runs
    // together a concurrent test's write can land between two operations and
    // drop whatever the first one added (observed live). Creating the org and
    // its members in a single write keeps this fixture ordering-independent.
    // updateMemberRole's guard — the behaviour under test — is still exercised
    // through the real service; addMember's permission check has its own test.
    const orgId = `org_b17_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ids = { owner: ownerId };
    const now = new Date().toISOString();
    const members = [{ accountId: ownerId, orgRole: "org_owner", joinedAt: now }];
    for (const [label, role] of Object.entries(roles)) {
        const id = `b17-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        members.push({ accountId: id, orgRole: role, joinedAt: now });
        ids[label] = id;
    }
    const record = {
        id: orgId, name: `B17 regression ${ownerId}`, description: "",
        slug: `b17-regression-${ownerId}`, plan: "free", status: "active",
        createdAt: now, updatedAt: now, departments: [], settings: {}, members,
    };
    // Retry the seed until it is actually visible: a concurrent suite writing
    // the same unlocked whole-file store can clobber our insert.
    let seeded = false;
    for (let attempt = 0; attempt < 25 && !seeded; attempt++) {
        const seed = JSON.parse(read(STORE));
        if (!seed.orgs.some(o => o.id === orgId)) seed.orgs.push(record);
        fs.writeFileSync(STORE, JSON.stringify(seed, null, 2));
        seeded = JSON.parse(read(STORE)).orgs.some(o => o.id === orgId);
    }
    assert.ok(seeded, "the fixture org must be present in the store");

    try {
        return fn(orgId, ids, record);
    } finally {
        try {
            const store = JSON.parse(read(STORE));
            store.orgs = store.orgs.filter(o => o.id !== orgId);
            fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
        } catch { /* leave the store alone if it cannot be parsed */ }
    }
}

function ownerCount(orgId) {
    const store = JSON.parse(read(STORE));
    const o = store.orgs.find(x => x.id === orgId);
    return (o?.members || []).filter(m => m.orgRole === "org_owner").length;
}

/**
 * Assert that demoting `target` is refused by the last-owner guard, retrying
 * through fixture collisions.
 *
 * `node --test` runs files concurrently and organizations.json is a shared,
 * unlocked whole-file store, so another suite's write can drop this fixture's
 * org or members between the seed and the call. updateMemberRole then fails
 * with "Organization not found" / "Member not found" / a permission error
 * because the seeded owner is gone — all fixture collisions, not the behaviour
 * under test. Re-seed and retry rather than pass on the wrong error, and never
 * treat a collision as success.
 */
function assertDemotionRefused(orgId, record, target, newRole, actor) {
    const reseed = () => {
        const store = JSON.parse(read(STORE));
        const idx = store.orgs.findIndex(o => o.id === orgId);
        if (idx >= 0) store.orgs[idx] = JSON.parse(JSON.stringify(record));
        else store.orgs.push(JSON.parse(JSON.stringify(record)));
        fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
    };

    for (let attempt = 0; attempt < 25; attempt++) {
        let err = null;
        try {
            org.updateMemberRole(orgId, target, newRole, actor);
        } catch (e) { err = e; }

        if (err && /Cannot demote the last org owner/.test(err.message)) return;
        if (err && /Organization not found|Member not found|requires permission/.test(err.message)) {
            reseed();
            continue;
        }
        assert.fail(err
            ? `expected the last-owner guard, got: ${err.message}`
            : `demoting the sole owner to "${newRole}" must be refused — it strands the organization`);
    }
    assert.fail("fixture kept being clobbered by a concurrent write; could not evaluate the guard");
}

describe("workforce ownership integrity (Phase B.17)", () => {
    it("refuses to demote the last org owner", () => {
        withOrg({ admin: "org_admin" }, (orgId, ids, record) => {
            assertDemotionRefused(orgId, record, ids.owner, "viewer", ids.owner);
            // The refusal must leave the owner in place. A concurrent suite can
            // clobber the fixture; only assert when it is still ours.
            const n = ownerCount(orgId);
            if (n > 0) assert.equal(n, 1, "the owner must still be an owner after the refusal");
        });
    });

    it("refuses the demotion whichever role is targeted", () => {
        withOrg({ admin: "org_admin" }, (orgId, ids, record) => {
            for (const role of ["viewer", "member", "team_lead", "dept_lead", "org_admin"]) {
                assertDemotionRefused(orgId, record, ids.owner, role, ids.owner);
            }
        });
    });

    it("blocks an admin from demoting the last owner too, not just self-demotion", () => {
        withOrg({ admin: "org_admin" }, (orgId, ids, record) => {
            // An org_admin holds manage_members, so it must not be able to
            // strand the organization either.
            assertDemotionRefused(orgId, record, ids.owner, "member", ids.admin);
        });
    });

    it("still allows a genuine hand-over once a second owner exists", () => {
        withOrg({ admin: "org_admin" }, (orgId, ids) => {
            // Promote a second owner the only way currently possible (the store),
            // since transferOwnership does not exist — see G1.
            const store = JSON.parse(read(STORE));
            const o = store.orgs.find(x => x.id === orgId);
            o.members.find(m => m.accountId === ids.admin).orgRole = "org_owner";
            fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
            assert.equal(ownerCount(orgId), 2, "precondition: two owners");

            const r = org.updateMemberRole(orgId, ids.owner, "viewer", ids.admin);
            assert.equal(r.updated, true, "stepping down must still work when a successor exists");
            assert.equal(ownerCount(orgId), 1, "the successor remains owner");
        });
    });

    it("still allows demoting and promoting non-owners", () => {
        withOrg({ admin: "org_admin", worker: "member" }, (orgId, ids) => {
            assert.equal(org.updateMemberRole(orgId, ids.worker, "team_lead", ids.owner).orgRole,
                "team_lead", "promoting a member must still work");
            assert.equal(org.updateMemberRole(orgId, ids.admin, "member", ids.owner).orgRole,
                "member", "demoting a non-owner admin must still work");
            assert.equal(ownerCount(orgId), 1);
        });
    });

    it("keeps rejecting an invalid role and direct promotion to org_owner", () => {
        withOrg({ worker: "member" }, (orgId, ids) => {
            assert.throws(() => org.updateMemberRole(orgId, ids.worker, "emperor", ids.owner),
                /Invalid orgRole/, "an unknown role must be refused");
            assert.throws(() => org.updateMemberRole(orgId, ids.worker, "org_owner", ids.owner),
                /Use transferOwnership/, "direct promotion to owner must stay blocked");
        });
    });

    it("keeps removeMember's original last-owner guard intact", () => {
        withOrg({ admin: "org_admin" }, (orgId, ids) => {
            assert.throws(() => org.removeMember(orgId, ids.owner, ids.owner),
                /Cannot remove the org owner/,
                "the guard this fix mirrors must not regress");
        });
    });

    it("guards demotion in the service, not only at the route", () => {
        // The bypass was reachable over HTTP; the check belongs where every
        // caller (route, SCIM sync, script) passes through.
        const src = read(SVC);
        const fn  = src.slice(src.indexOf("function updateMemberRole"));
        const body = fn.slice(0, fn.indexOf("\nfunction "));
        assert.ok(/m\.orgRole === "org_owner" && newRole !== "org_owner"/.test(body),
            "updateMemberRole must detect an owner being demoted");
        assert.ok(/owners\.length <= 1/.test(body),
            "the guard must trigger only for the LAST owner, so hand-over still works");
        assert.ok(/Cannot demote the last org owner/.test(body),
            "the error must name the real constraint");
    });

    it("audits the role change (attribution must survive the fix)", () => {
        const src = read(SVC);
        const fn  = src.slice(src.indexOf("function updateMemberRole"));
        const body = fn.slice(0, fn.indexOf("\nfunction "));
        assert.ok(/permission\.role_changed/.test(body),
            "a role change must remain audited with previousRole/newRole");
        assert.ok(/actorId: requestingAccountId/.test(body),
            "the audit entry must record who made the change");
    });

    it("still gates member management behind manage_members", () => {
        withOrg({ worker: "member" }, (orgId, ids) => {
            // A plain member must not be able to add or re-role anyone.
            assert.throws(
                () => org.addMember(orgId, { accountId: "b17-intruder", orgRole: "org_admin" }, ids.worker),
                /Forbidden — requires permission: manage_members/,
                "adding a member must require manage_members");
            assert.throws(
                () => org.updateMemberRole(orgId, ids.worker, "org_admin", ids.worker),
                /Forbidden — requires permission: manage_members/,
                "self-promotion must require manage_members");
        });
    });

    it("every org in the live store still has an owner", () => {
        const store = JSON.parse(read(STORE));
        const active = store.orgs.filter(o => o.status !== "archived");
        const ownerless = active.filter(o => !(o.members || []).some(m => m.orgRole === "org_owner"));
        assert.deepEqual(ownerless.map(o => o.id), [],
            "an active org with no owner cannot be administered or deleted by anyone");
    });
});
