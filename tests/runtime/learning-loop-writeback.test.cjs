"use strict";
/**
 * Universal Composition Engine, Phase 12 — Learning Loop write-back.
 *
 * continuousLearningEngine.cjs's analysis (runFullAnalysis, real
 * clustering) was already genuine, but every lesson's `applied` field
 * was created false and NOTHING ever flipped it (confirmed: zero
 * `applied: true` anywhere in the file before this phase). These tests
 * prove the one narrow write-back this phase adds — an approval-gated
 * preferenceWeight nudge on agentRegistry — closes that gap without
 * ever self-applying or touching source files.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const LESSONS_FILE = path.join(__dirname, "../../data/lessons.json");
let _lessonsBackup = null;

before(() => { try { _lessonsBackup = fs.readFileSync(LESSONS_FILE, "utf8"); } catch { _lessonsBackup = null; } });
after(() => {
    if (_lessonsBackup !== null) fs.writeFileSync(LESSONS_FILE, _lessonsBackup);
    else { try { fs.unlinkSync(LESSONS_FILE); } catch {} }
});

const learningEngine = require("../../backend/services/continuousLearningEngine.cjs");
const agentRegistry = require("../../agents/runtime/agentRegistry.cjs");

function noop() { return { success: true, message: "ok" }; }

describe("agentRegistry — preferenceWeight tie-breaking (Phase 12)", () => {

    it("new agents default to preferenceWeight 0 (neutral, no behavior change)", () => {
        agentRegistry.register({ id: `pw-agent-${Date.now()}`, capabilities: [`pw-cap-${Date.now()}`], handler: noop });
        const all = agentRegistry.listAll();
        const created = all[all.length - 1];
        assert.equal(created.preferenceWeight, 0);
    });

    it("setPreferenceWeight() clamps to [-1, 1]", () => {
        const id = `pw-clamp-${Date.now()}`;
        agentRegistry.register({ id, capabilities: ["pw-clamp-cap"], handler: noop });
        assert.equal(agentRegistry.setPreferenceWeight(id, 5), 1);
        assert.equal(agentRegistry.setPreferenceWeight(id, -5), -1);
    });

    it("setPreferenceWeight() throws for an unknown agent", () => {
        assert.throws(() => agentRegistry.setPreferenceWeight("not-a-real-agent-xyz", 1));
    });

    it("findForCapability() only uses preferenceWeight to break a TRUE load tie — never overrides a genuinely lower-loaded agent", () => {
        const cap = `pw-tiebreak-${Date.now()}`;
        agentRegistry.register({ id: `pw-a-${cap}`, capabilities: [cap], maxConcurrent: 2, handler: noop });
        agentRegistry.register({ id: `pw-b-${cap}`, capabilities: [cap], maxConcurrent: 2, handler: noop });

        // Give pw-b a lower load (0 active vs pw-a's 1 active) — pw-b must
        // win regardless of preferenceWeight, since load is checked FIRST.
        agentRegistry.setPreferenceWeight(`pw-a-${cap}`, 1);  // highest possible weight
        agentRegistry.setPreferenceWeight(`pw-b-${cap}`, -1); // lowest possible weight
        const agentA = agentRegistry.get(`pw-a-${cap}`);
        agentA.acquireSlot(); // pw-a now has 1/2 active load, pw-b has 0/2

        const found = agentRegistry.findForCapability(cap);
        assert.equal(found.id, `pw-b-${cap}`, "genuinely lower load must win regardless of preferenceWeight");
        agentA.recordSuccess(); // release slot
    });

    it("findForCapability() breaks a genuine tie in favor of higher preferenceWeight", () => {
        const cap = `pw-realtie-${Date.now()}`;
        agentRegistry.register({ id: `pw-a2-${cap}`, capabilities: [cap], maxConcurrent: 3, handler: noop });
        agentRegistry.register({ id: `pw-b2-${cap}`, capabilities: [cap], maxConcurrent: 3, handler: noop });
        // Both at 0/3 load — a genuine tie.
        agentRegistry.setPreferenceWeight(`pw-b2-${cap}`, 0.5);

        const found = agentRegistry.findForCapability(cap);
        assert.equal(found.id, `pw-b2-${cap}`, "higher preferenceWeight wins a genuine load tie");
    });
});

describe("continuousLearningEngine.applyLearningRecord() — approval-gated write-back (Phase 12)", () => {

    it("a lesson is created with applied:false (existing, unchanged behavior)", () => {
        const { lessonId } = learningEngine.createLesson({ type: "test", title: "test lesson", detail: "test" });
        const { lessons } = learningEngine.getLessons({ limit: 200 });
        const found = lessons.find(l => l.lessonId === lessonId);
        assert.equal(found.applied, false);
    });

    it("applyLearningRecord() requires an explicit approvedBy — throws without one", () => {
        const { lessonId } = learningEngine.createLesson({ type: "test", title: "no-approver test" });
        const agentId = `apply-agent-${Date.now()}`;
        agentRegistry.register({ id: agentId, capabilities: ["apply-cap"], handler: noop });
        assert.throws(() => learningEngine.applyLearningRecord(lessonId, { agentId, weightDelta: 0.1 }, null));
    });

    it("applyLearningRecord() with a real approvedBy flips applied:true and nudges the real agent's preferenceWeight", () => {
        const { lessonId } = learningEngine.createLesson({ type: "test", title: "real apply test" });
        const agentId = `apply-agent2-${Date.now()}`;
        agentRegistry.register({ id: agentId, capabilities: ["apply-cap2"], handler: noop });

        const result = learningEngine.applyLearningRecord(lessonId, { agentId, weightDelta: 0.3 }, "test-operator");
        assert.equal(result.applied, true);
        assert.equal(result.appliedBy, "test-operator");

        const agentRecord = agentRegistry.get(agentId);
        assert.equal(agentRecord.preferenceWeight, 0.3, "the REAL agentRegistry record was genuinely nudged, not just the lesson metadata");

        const { lessons } = learningEngine.getLessons({ limit: 200 });
        assert.equal(lessons.find(l => l.lessonId === lessonId).applied, true, "applied:true is genuinely persisted");
    });

    it("applyLearningRecord() throws for an already-applied lesson (no double-apply)", () => {
        const { lessonId } = learningEngine.createLesson({ type: "test", title: "double apply test" });
        const agentId = `apply-agent3-${Date.now()}`;
        agentRegistry.register({ id: agentId, capabilities: ["apply-cap3"], handler: noop });
        learningEngine.applyLearningRecord(lessonId, { agentId, weightDelta: 0.1 }, "test-operator");
        assert.throws(() => learningEngine.applyLearningRecord(lessonId, { agentId, weightDelta: 0.1 }, "test-operator"));
    });

    it("applyLearningRecord() throws for an unknown lesson or agent", () => {
        assert.throws(() => learningEngine.applyLearningRecord("not-a-real-lesson", { agentId: "x", weightDelta: 0.1 }, "op"));
        const { lessonId } = learningEngine.createLesson({ type: "test", title: "unknown agent test" });
        assert.throws(() => learningEngine.applyLearningRecord(lessonId, { agentId: "not-a-real-agent-xyz", weightDelta: 0.1 }, "op"));
    });

    it("applyLearningRecord() NEVER writes to any source file (operational learning only, not code evolution)", () => {
        const { lessonId } = learningEngine.createLesson({ type: "test", title: "no source mutation test" });
        const agentId = `apply-agent4-${Date.now()}`;
        agentRegistry.register({ id: agentId, capabilities: ["apply-cap4"], handler: noop });

        const fsWriteSpyCalls = [];
        const originalWriteFileSync = fs.writeFileSync;
        fs.writeFileSync = (...args) => { fsWriteSpyCalls.push(args[0]); return originalWriteFileSync(...args); };

        learningEngine.applyLearningRecord(lessonId, { agentId, weightDelta: 0.2 }, "test-operator");

        fs.writeFileSync = originalWriteFileSync;
        for (const filePath of fsWriteSpyCalls) {
            assert.ok(!String(filePath).match(/\.(cjs|js|jsx|ts|tsx)(\.tmp)?$/), `applyLearningRecord must never write a source file, but wrote: ${filePath}`);
        }
    });
});
