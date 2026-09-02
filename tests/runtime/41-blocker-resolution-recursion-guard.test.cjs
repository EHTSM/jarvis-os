"use strict";
/**
 * JARVIS INCIDENT REPAIR (2026-09-03, P0-3) regression: graphReasoningEngine.cjs's
 * findBlockedMissions() previously excluded "Resolve blockers for mission: X"
 * missions from being re-flagged as blocked using ONLY a title-prefix string
 * match — a real, live-confirmed self-nesting bug (missionMemory.cjs's
 * updateSubtask, fixed separately) meant that while subtask status could
 * never persist, every active mission with subtasks looked permanently
 * stuck, including these unblock missions themselves. The single title-
 * prefix check was the only thing standing between that and unbounded
 * "Resolve blockers for mission: Resolve blockers for mission: ..." nesting.
 *
 * Fix: blocker-resolution missions are now tagged with a structural
 * metadata.kind === "blocker_resolution" field at creation time (immune to
 * any future objective-text change), plus a bounded metadata.blockerDepth.
 * generateRecommendations() refuses to create another blocker-resolution
 * candidate once MAX_BLOCKER_DEPTH is reached, independent of the exclusion
 * in findBlockedMissions(). The original title-prefix check is kept as a
 * fallback so the 56 real historical missions (created before metadata.kind
 * existed) remain excluded exactly as before.
 *
 * These tests use real missionMemory.cjs calls (the only way to prove this
 * against the actual persistence layer) and clean up every mission they
 * create by cancelling it — same convention as tests/runtime/40-mission-
 * dedup-and-recovery.test.cjs.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const GRE_SRC_PATH = path.join(__dirname, "../../backend/services/graphReasoningEngine.cjs");

const memory = require("../../backend/services/missionMemory.cjs");
const gre    = require("../../backend/services/graphReasoningEngine.cjs");

const RUN = `m41-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const _createdIds = [];

function _cleanup() {
    for (const id of _createdIds) {
        try { memory.updateMission(id, { status: "cancelled", metadata: { m41TestCleanup: true } }); }
        catch { /* best effort */ }
    }
}

describe("JARVIS incident repair P0-3 — structural blocker-resolution recursion guard", () => {

    it("1. source now defines a hard MAX_BLOCKER_DEPTH constant", () => {
        const src = fs.readFileSync(GRE_SRC_PATH, "utf8");
        assert.match(src, /const MAX_BLOCKER_DEPTH\s*=\s*\d+/, "MAX_BLOCKER_DEPTH must be defined");
    });

    it("2. findBlockedMissions() excludes a mission by structural metadata.kind, not title text alone", () => {
        const objective = `${RUN} — plain objective, no special title, tagged blocker_resolution`;
        const created = memory.createMission({
            objective,
            priority: "high",
            subtasks: [{ description: "some subtask", status: "pending" }],
            metadata: { kind: "blocker_resolution", blockerDepth: 1 },
        });
        _createdIds.push(created.id);
        // Make it look "stuck": active status, all subtasks pending.
        memory.updateMission(created.id, { status: "active" });

        const { blockedMissions } = gre.findBlockedMissions({ limit: 1000 });
        const found = blockedMissions.find(bm => bm.missionId === created.id);
        assert.equal(found, undefined,
            "a mission tagged metadata.kind === 'blocker_resolution' must never be reported as blocked, regardless of its objective text");

        _cleanup();
    });

    it("3. findBlockedMissions() still excludes the legacy title-prefix shape (no metadata.kind) — historical missions unaffected", () => {
        const objective = `Resolve blockers for mission: ${RUN} — legacy shape, no metadata.kind`;
        const created = memory.createMission({
            objective,
            priority: "high",
            subtasks: [{ description: "some subtask", status: "pending" }],
            metadata: { domain: "ops" }, // no kind field — mirrors the 56 real historical records
        });
        _createdIds.push(created.id);
        memory.updateMission(created.id, { status: "active" });

        const { blockedMissions } = gre.findBlockedMissions({ limit: 1000 });
        const found = blockedMissions.find(bm => bm.missionId === created.id);
        assert.equal(found, undefined,
            "a mission whose objective starts with the legacy 'Resolve blockers for mission:' prefix must remain excluded even with no metadata.kind");

        _cleanup();
    });

    it("4. an ordinary stuck mission (not a blocker-resolution mission) IS still correctly reported as blocked — no regression to the working case", () => {
        const objective = `${RUN} — ordinary stuck mission, must still be detected`;
        const created = memory.createMission({
            objective,
            priority: "high",
            subtasks: [{ description: "some subtask", status: "pending" }],
        });
        _createdIds.push(created.id);
        memory.updateMission(created.id, { status: "active" });

        const { blockedMissions } = gre.findBlockedMissions({ limit: 1000 });
        const found = blockedMissions.find(bm => bm.missionId === created.id);
        assert.ok(found, "an ordinary mission with all subtasks stuck pending must still be reported as blocked");
        assert.equal(found.blockerDepth, 0, "an ordinary mission's blockerDepth defaults to 0");

        _cleanup();
    });

    it("5. generateRecommendations() tags a newly generated blocker-resolution candidate with structural metadata", () => {
        const objective = `${RUN} — source mission for a real unblock candidate`;
        const created = memory.createMission({
            objective,
            priority: "high",
            subtasks: [{ description: "some subtask", status: "pending" }],
        });
        _createdIds.push(created.id);
        memory.updateMission(created.id, { status: "active" });

        const { recommendations } = gre.generateRecommendations({ limit: 50 });
        const candidate = (recommendations || []).find(r =>
            r.autoMissionCandidate?.metadata?.blockedMissionId === created.id
        );
        assert.ok(candidate, "generateRecommendations() must produce an unblock candidate for the real stuck mission created above");
        assert.equal(candidate.autoMissionCandidate.metadata.kind, "blocker_resolution",
            "the generated candidate's metadata.kind must be 'blocker_resolution'");
        assert.equal(candidate.autoMissionCandidate.metadata.blockerDepth, 1,
            "a candidate generated from a depth-0 blocked mission must itself be depth 1");

        _cleanup();
    });

    it("6. generateRecommendations() refuses to generate a candidate once MAX_BLOCKER_DEPTH is reached", () => {
        // Simulate a blocked mission that is ALREADY at the max depth by
        // directly tagging metadata.blockerDepth = MAX_BLOCKER_DEPTH — this
        // is the second, independent bound described in the file header,
        // exercised even though findBlockedMissions()'s own exclusion would
        // normally prevent this mission from being seen as blocked at all.
        const src = fs.readFileSync(GRE_SRC_PATH, "utf8");
        const m = src.match(/const MAX_BLOCKER_DEPTH\s*=\s*(\d+)/);
        const maxDepth = Number(m[1]);

        const objective = `${RUN} — already at max blocker depth`;
        const created = memory.createMission({
            objective,
            priority: "high",
            subtasks: [{ description: "some subtask", status: "pending" }],
            metadata: { blockerDepth: maxDepth }, // no kind — so findBlockedMissions() still sees it as blocked
        });
        _createdIds.push(created.id);
        memory.updateMission(created.id, { status: "active" });

        const { recommendations } = gre.generateRecommendations({ limit: 50 });
        const candidate = (recommendations || []).find(r =>
            r.autoMissionCandidate?.metadata?.blockedMissionId === created.id
        );
        assert.equal(candidate, undefined,
            "generateRecommendations() must not create a blocker-resolution candidate once the source mission is already at MAX_BLOCKER_DEPTH");

        _cleanup();
    });

});
