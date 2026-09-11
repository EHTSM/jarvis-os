"use strict";
/**
 * Mission 113 — regression test for the Mission 112-confirmed defect:
 * civilizationState.cjs's recordReputationEvent()/endorseMember()/awardBadge()
 * (lines ~543-587) accept an arbitrary memberId string with zero validation
 * against the real civilization registry, and no HTTP route adds any
 * additional check either (backend/routes/civilizationOrg.js:88-92).
 *
 * Mission 112 proved 216 reputation reference instances (126 scores + 45
 * endorsements + 45 badges) are permanently dangling because of exactly
 * this gap. This test proves the fix closes the gap for FUTURE writes
 * without touching any existing record — same shape as Mission 107's
 * addCouncilMember() fix, reusing the same getMember() lookup.
 *
 * Isolation: sets JARVIS_TEST_DATA_SUFFIX before any require(), matching
 * the established convention (civilizationState.cjs already honors it) —
 * this test never reads or writes the real data/civilization/*.json files.
 */
process.env.JARVIS_TEST_DATA_SUFFIX = process.env.JARVIS_TEST_DATA_SUFFIX || `test-${process.pid}-${Date.now()}`;

const assert = require("assert");
const { test, describe, before } = require("node:test");

const st = require("../../backend/services/civilizationState.cjs");

const TS = Date.now();
let memberA, memberB;

describe("civilizationState reputation writers — Mission 113 referential-integrity fix", () => {
    before(() => {
        const a = st.registerMember({ name: `RepFixOrgA-${TS}`, type: "organization", capabilities: ["engineering"] });
        assert.ok(a.ok, `test setup failed: could not register memberA: ${a.error}`);
        memberA = a.member;
        const b = st.registerMember({ name: `RepFixOrgB-${TS}`, type: "organization", capabilities: ["engineering"] });
        assert.ok(b.ok, `test setup failed: could not register memberB: ${b.error}`);
        memberB = b.member;
    });

    describe("recordReputationEvent", () => {
        test("CASE A — a valid, existing registry memberId succeeds", () => {
            const r = st.recordReputationEvent({ memberId: memberA.id, eventType: "mission_completed", score: 5 });
            assert.strictEqual(r.ok, true, `expected success for a real registry member, got: ${r.error}`);
            assert.ok(r.reputation, "no reputation object returned on success");
        });

        test("CASE B — a non-existent memberId is deterministically rejected", () => {
            const fakeId = `cmem_does_not_exist_${TS}`;
            const r = st.recordReputationEvent({ memberId: fakeId, eventType: "mission_completed", score: 5 });
            assert.strictEqual(r.ok, false,
                "a memberId that does not resolve to any real registry member must be rejected — " +
                "this is the exact Mission 112 defect: the pre-fix implementation returns ok:true here");
            assert.ok(r.error && /not found|does not exist|invalid/i.test(r.error),
                `expected a clear not-found-style error, got: ${JSON.stringify(r.error)}`);
        });

        test("CASE B2 — a missing memberId is still rejected by the pre-existing 'memberId and eventType required' check (unaffected by the fix)", () => {
            const r = st.recordReputationEvent({ eventType: "mission_completed", score: 5 });
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.error, "memberId and eventType required");
        });
    });

    describe("endorseMember", () => {
        test("CASE A — valid fromMemberId and toMemberId succeed", () => {
            const r = st.endorseMember({ fromMemberId: memberA.id, toMemberId: memberB.id, domain: "engineering", message: "test" });
            assert.strictEqual(r.ok, true, `expected success for two real registry members, got: ${r.error}`);
            assert.ok(r.endorsement?.id, "no endorsement id returned on success");
        });

        test("CASE B — a non-existent toMemberId is deterministically rejected", () => {
            const fakeId = `cmem_does_not_exist_to_${TS}`;
            const r = st.endorseMember({ fromMemberId: memberA.id, toMemberId: fakeId, domain: "engineering", message: "test" });
            assert.strictEqual(r.ok, false,
                "an endorsement whose recipient does not resolve to any real registry member must be rejected");
            assert.ok(r.error && /not found|does not exist|invalid/i.test(r.error),
                `expected a clear not-found-style error, got: ${JSON.stringify(r.error)}`);
        });

        test("CASE C — a non-existent fromMemberId is deterministically rejected", () => {
            const fakeId = `cmem_does_not_exist_from_${TS}`;
            const r = st.endorseMember({ fromMemberId: fakeId, toMemberId: memberB.id, domain: "engineering", message: "test" });
            assert.strictEqual(r.ok, false,
                "an endorsement whose sender does not resolve to any real registry member must be rejected");
            assert.ok(r.error && /not found|does not exist|invalid/i.test(r.error),
                `expected a clear not-found-style error, got: ${JSON.stringify(r.error)}`);
        });

        test("CASE D — missing fromMemberId/toMemberId is still rejected by the pre-existing required check (unaffected by the fix)", () => {
            const r = st.endorseMember({ domain: "engineering", message: "test" });
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.error, "fromMemberId and toMemberId required");
        });
    });

    describe("awardBadge", () => {
        test("CASE A — a valid, existing registry memberId succeeds", () => {
            const r = st.awardBadge({ memberId: memberA.id, badge: "Pioneer", reason: "test", fromMemberId: "civilization" });
            assert.strictEqual(r.ok, true, `expected success for a real registry member, got: ${r.error}`);
            assert.ok(r.badge?.id, "no badge id returned on success");
        });

        test("CASE B — a non-existent memberId is deterministically rejected", () => {
            const fakeId = `cmem_does_not_exist_badge_${TS}`;
            const r = st.awardBadge({ memberId: fakeId, badge: "Pioneer", reason: "test", fromMemberId: "civilization" });
            assert.strictEqual(r.ok, false,
                "a badge whose recipient does not resolve to any real registry member must be rejected — " +
                "this is the exact Mission 112 defect for the badge writer");
            assert.ok(r.error && /not found|does not exist|invalid/i.test(r.error),
                `expected a clear not-found-style error, got: ${JSON.stringify(r.error)}`);
        });

        test("CASE C — a missing memberId is still rejected by the pre-existing 'memberId and badge required' check (unaffected by the fix)", () => {
            const r = st.awardBadge({ badge: "Pioneer", reason: "test" });
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.error, "memberId and badge required");
        });
    });

    describe("indirect production path — platformState.certifyOrg() → civilizationState.awardBadge()", () => {
        test("CASE A — certifying an org whose name matches a real civilization member still succeeds (existing valid behavior unchanged)", () => {
            const ps = require("../../backend/services/platformState.cjs");
            // certifyOrg looks up an org by orgId, then separately looks up a
            // civilization member by matching org.name === member.name (per
            // platformState.cjs:731) — register a platform org with the SAME
            // name as memberA so the internal awardBadge() call targets a real,
            // already-registered civilization member.
            const orgReg = ps.registerOrg({ name: memberA.name, ownerId: `owner-${TS}` });
            assert.ok(orgReg?.ok, `test setup failed: could not register a platform org: ${orgReg?.error}`);
            const orgId = orgReg.org.id;
            const r = ps.certifyOrg({ orgId, level: "bronze" });
            assert.strictEqual(r.ok, true, `certifyOrg should still succeed for a real org: ${r.error}`);
            // The internal awardBadge() call is best-effort (wrapped in try/catch
            // in platformState.cjs, per Mission 112-SIDE's own finding) — confirm
            // it did not silently no-op due to the new guard, by checking the
            // badge actually landed against the real member.
            const rep = st.getReputation(memberA.id);
            assert.ok(rep.badges.includes(`Certified-bronze`),
                "certifyOrg's internal awardBadge() call must still succeed when the target member genuinely exists");
        });
    });
});
