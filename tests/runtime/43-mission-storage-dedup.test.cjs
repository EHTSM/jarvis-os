"use strict";
/**
 * JARVIS INCIDENT REPAIR (2026-09-03, P0-2) regression: missionMemory.cjs's
 * createMission() had no dedup of its own — every layer that deduped sat
 * ABOVE this file (agentRuntimeSupervisor.cjs's _missionExists(),
 * businessIntelligenceEngine.cjs's _recentlyTriggered()) and neither covered
 * the ~20 org-department modules or any other direct caller. Confirmed live:
 * 8,393 of 9,394 real missions sat permanently "planned", with duplicate-
 * objective clusters up to 3,550 copies of the same text.
 *
 * createMission() now dedups at the storage layer itself, scoped per-org,
 * matching only NON-TERMINAL missions, using an EXACT (trim+lowercase, no
 * digit-collapsing) objective match — digit-collapsing was tried first and
 * reverted after it broke tests/runtime/mission-orchestrator-nodetypes.test
 * .cjs live (every one of its missions differs from another only in an
 * embedded Date.now() timestamp; collapsing digits wrongly flagged them all
 * as duplicates of each other).
 *
 * Org isolation is the highest-severity property to prove here: this
 * codebase has TWO real, coexisting org-scoping conventions —
 * mission.orgId (missionMemory.cjs's own, documented convention — used by
 * phase27.js/codingAssistant.js) and mission.metadata.orgId
 * (organizationService.cjs's createMissionForOrg(), confirmed by direct
 * inspection of listOrgMissions() filtering on m.metadata?.orgId, never
 * m.orgId). The dedup index must recognize BOTH, or missions created via
 * organizationService.cjs would all silently fall into the same
 * "unscoped" bucket and dedup across real, different orgs — the exact
 * cross-tenant leak this mechanism must never introduce.
 *
 * These tests use real missionMemory.cjs calls — the only way to prove
 * this fix works end-to-end against the actual persistence layer — but,
 * as of MISSION 82 (Test 40/43 Data Isolation), against an isolated
 * throwaway COPY of missionMemory.cjs (mkdtempSync + module-copy, the
 * same proven technique used by the packaged Mission 82C/P0/P1 regression
 * suites), never the real data/missions.json. Cleanup (marking created
 * missions "cancelled" — missionMemory.cjs has no delete API) remains
 * unchanged and now operates on the isolated copy's own throwaway store,
 * so nothing accumulates in the real dataset across repeated runs.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { buildIsolatedMissionMemory } = require("./_isolatedMissionMemory.helper.cjs");

const RUN = `m43-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const _createdIds = [];

let iso, memory;

function _cleanup() {
    for (const id of _createdIds) {
        try { memory.updateMission(id, { status: "cancelled", metadata: { m43TestCleanup: true } }); }
        catch { /* best effort */ }
    }
}

describe("JARVIS incident repair P0-2 — missionMemory.createMission() storage-level dedup", () => {
    before(() => {
        iso = buildIsolatedMissionMemory();
        memory = iso.memory;
    });

    after(() => {
        iso.cleanup();
    });

    it("1. an exact-duplicate objective (same org/unscoped, non-terminal) is deduped, not duplicated", () => {
        const objective = `${RUN} — exact duplicate probe`;
        const first = memory.createMission({ objective, priority: "low" });
        _createdIds.push(first.id);
        assert.equal(first.deduped, undefined, "the first creation must not be marked deduped");

        const second = memory.createMission({ objective, priority: "low" });
        assert.equal(second.deduped, true, "an exact-duplicate objective must be deduped");
        assert.equal(second.id, first.id, "the deduped result must be the SAME mission as the original");

        _cleanup();

        const list = memory.listMissions({ search: RUN, limit: 100 });
        const matching = list.missions.filter(m => m.objective === objective);
        assert.equal(matching.length, 1, "only ONE mission with this exact objective must exist in storage — no duplicate row was ever created");
    });

    it("2. objectives differing only by embedded digits are NOT deduped (the mission-orchestrator-nodetypes.test.cjs regression this fix must not reintroduce)", () => {
        const a = memory.createMission({ objective: `${RUN} test goal 111111`, priority: "low" });
        _createdIds.push(a.id);
        const b = memory.createMission({ objective: `${RUN} test goal 222222`, priority: "low" });
        _createdIds.push(b.id);

        assert.equal(a.deduped, undefined);
        assert.equal(b.deduped, undefined, "an objective differing only in embedded digits from an existing one must NOT be deduped — exact match only, no digit-collapsing");
        assert.notEqual(a.id, b.id);

        _cleanup();
    });

    it("3. a TERMINAL mission (cancelled) does not block a new, otherwise-identical mission from being created", () => {
        const objective = `${RUN} — terminal-then-recreate probe`;
        const first = memory.createMission({ objective, priority: "low" });
        _createdIds.push(first.id);
        memory.updateMission(first.id, { status: "cancelled" });

        const second = memory.createMission({ objective, priority: "low" });
        _createdIds.push(second.id);
        assert.equal(second.deduped, undefined, "a new mission with the same objective as a now-TERMINAL mission must be created fresh, not deduped");
        assert.notEqual(second.id, first.id);

        _cleanup();

        // The original terminal mission itself must still exist, untouched —
        // "preserve completed/failed/cancelled historical missions".
        const original = memory.getMission(first.id);
        assert.ok(original, "the original terminal mission must still exist in storage");
        assert.equal(original.objective, objective, "the original terminal mission's objective must be unchanged");
    });

    it("4. ORG ISOLATION: two different orgs (top-level orgId) with the identical objective both get their own mission", () => {
        const objective = `${RUN} — cross-org top-level-orgId probe`;
        const orgA = memory.createMission({ objective, priority: "low", orgId: `${RUN}-orgA` });
        _createdIds.push(orgA.id);
        const orgB = memory.createMission({ objective, priority: "low", orgId: `${RUN}-orgB` });
        _createdIds.push(orgB.id);

        assert.equal(orgA.deduped, undefined);
        assert.equal(orgB.deduped, undefined, "an identical objective for a DIFFERENT org must never be deduped against another org's mission");
        assert.notEqual(orgA.id, orgB.id);

        // Same org, same objective — THIS must dedup.
        const orgADupe = memory.createMission({ objective, priority: "low", orgId: `${RUN}-orgA` });
        assert.equal(orgADupe.deduped, true, "the SAME org creating the identical objective again must still be deduped");
        assert.equal(orgADupe.id, orgA.id);

        _cleanup();
    });

    it("5. ORG ISOLATION: an unscoped (orgId: null) mission never dedups against a real org's mission with the same objective, or vice versa", () => {
        const objective = `${RUN} — unscoped-vs-scoped probe`;
        const scoped = memory.createMission({ objective, priority: "low", orgId: `${RUN}-orgC` });
        _createdIds.push(scoped.id);
        const unscoped = memory.createMission({ objective, priority: "low" }); // no orgId
        _createdIds.push(unscoped.id);

        assert.equal(unscoped.deduped, undefined, "an unscoped mission must not be deduped against a different, org-scoped mission with the same objective");
        assert.notEqual(unscoped.id, scoped.id);

        _cleanup();
    });

    it("6. ORG ISOLATION: organizationService.cjs's metadata.orgId convention is ALSO recognized — two different orgs via THAT convention never cross-dedup", () => {
        // organizationService.cjs's createMissionForOrg() stamps org ownership
        // as metadata.orgId (confirmed live: its own listOrgMissions() filters
        // on m.metadata?.orgId, never the top-level m.orgId) — a DIFFERENT
        // convention from missionMemory.cjs's own top-level orgId field. Both
        // must be recognized by the dedup index, or every organizationService
        // -created mission would silently fall into the same "unscoped"
        // bucket and dedup across real, different orgs.
        const objective = `${RUN} — metadata.orgId cross-org probe`;
        const orgX = memory.createMission({ objective, priority: "low", metadata: { orgId: `${RUN}-orgX` } });
        _createdIds.push(orgX.id);
        const orgY = memory.createMission({ objective, priority: "low", metadata: { orgId: `${RUN}-orgY` } });
        _createdIds.push(orgY.id);

        assert.equal(orgX.deduped, undefined);
        assert.equal(orgY.deduped, undefined, "two different orgs scoped via metadata.orgId must never dedup against each other");
        assert.notEqual(orgX.id, orgY.id);

        // Same org (via metadata.orgId), same objective — must dedup.
        const orgXDupe = memory.createMission({ objective, priority: "low", metadata: { orgId: `${RUN}-orgX` } });
        assert.equal(orgXDupe.deduped, true, "the same org (via metadata.orgId) creating the identical objective again must be deduped");
        assert.equal(orgXDupe.id, orgX.id);

        _cleanup();
    });

    it("7. ORG ISOLATION: top-level orgId and metadata.orgId for the SAME org value dedup against each other (same effective org, either convention)", () => {
        // Both conventions resolve to the same _effectiveOrgId() — a mission
        // created via one convention and a duplicate created via the other,
        // for the SAME real org id, are correctly recognized as the same org.
        const objective = `${RUN} — same-org-different-convention probe`;
        const viaTopLevel = memory.createMission({ objective, priority: "low", orgId: `${RUN}-orgZ` });
        _createdIds.push(viaTopLevel.id);
        const viaMetadata = memory.createMission({ objective, priority: "low", metadata: { orgId: `${RUN}-orgZ` } });

        assert.equal(viaMetadata.deduped, true, "the same real org id, expressed via metadata.orgId, must dedup against an existing mission for that same org expressed via top-level orgId");
        assert.equal(viaMetadata.id, viaTopLevel.id);

        _cleanup();
    });

    it("8. a deduped createMission() return never mutates the existing mission it points to", () => {
        const objective = `${RUN} — no-mutation-on-dedup probe`;
        const first = memory.createMission({ objective, priority: "medium", subtasks: [{ description: "original subtask" }] });
        _createdIds.push(first.id);
        const beforeUpdatedAt = memory.getMission(first.id).updatedAt;

        memory.createMission({ objective, priority: "critical", subtasks: [{ description: "a different subtask that must never be added" }] });

        const after = memory.getMission(first.id);
        assert.equal(after.updatedAt, beforeUpdatedAt, "a deduped createMission() call must not touch the existing mission's updatedAt — zero mutation");
        assert.equal(after.priority, "medium", "the existing mission's priority must be unchanged by a deduped call passing a different priority");
        assert.equal(after.subtasks.length, 1, "the existing mission's subtasks must be unchanged — the deduped call's subtasks must never be merged in");

        _cleanup();
    });

});
