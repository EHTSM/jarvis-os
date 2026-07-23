"use strict";
/**
 * Universal Composition Engine, Phase 13 — Capability Evolution
 * (Cases C/D: new skill/tool registration from a repositoryEditingEngine
 * bundle). Tests the registration/approval gate in isolation from the
 * real AI-driven planBundle()/applyBundle() pipeline (which requires a
 * live AI call and a real repo — out of scope for a fast unit test);
 * instead constructs a synthetic 'applied' bundle record directly in
 * the same real data file repositoryEditingEngine.cjs itself reads,
 * proving the registration/approval logic genuinely reads real bundle
 * state rather than being tested against a mock.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const BUNDLES_FILE = path.join(__dirname, "../../data/acp6-bundles.json");
const SKILLS_FILE  = path.join(__dirname, "../../data/skills.json");
let _bundlesBackup = null, _skillsBackup = null;

before(() => {
    try { _bundlesBackup = fs.readFileSync(BUNDLES_FILE, "utf8"); } catch { _bundlesBackup = null; }
    try { _skillsBackup = fs.readFileSync(SKILLS_FILE, "utf8"); } catch { _skillsBackup = null; }
});
after(() => {
    if (_bundlesBackup !== null) fs.writeFileSync(BUNDLES_FILE, _bundlesBackup); else { try { fs.unlinkSync(BUNDLES_FILE); } catch {} }
    if (_skillsBackup !== null) fs.writeFileSync(SKILLS_FILE, _skillsBackup); else { try { fs.unlinkSync(SKILLS_FILE); } catch {} }
});

const repoEditEngine = require("../../backend/services/repositoryEditingEngine.cjs");
const skillRegistry = require("../../backend/services/skillRegistry.cjs");
const approvalQueue = require("../../backend/services/approvalQueue.cjs");

function _seedAppliedBundle(bundleId, goal = "add a new skill") {
    let data;
    try { data = JSON.parse(fs.readFileSync(BUNDLES_FILE, "utf8")); } catch { data = { bundles: {} }; }
    data.bundles[bundleId] = {
        bundleId, goal, status: "applied", createdAt: new Date().toISOString(),
        appliedAt: new Date().toISOString(), files: [], pipelineIds: [],
        plan: { summary: "test", riskLevel: "low", commitMsg: "feat: test" },
        metrics: { filesApplied: 1 },
    };
    fs.writeFileSync(BUNDLES_FILE, JSON.stringify(data, null, 2));
}

describe("repositoryEditingEngine — Capability Evolution (Phase 13)", () => {

    it("registerCapabilityFromBundle() throws for a bundle that isn't genuinely 'applied'", () => {
        const bundleId = `bnd_notapplied_${Date.now()}`;
        let data;
        try { data = JSON.parse(fs.readFileSync(BUNDLES_FILE, "utf8")); } catch { data = { bundles: {} }; }
        data.bundles[bundleId] = { bundleId, status: "planned", goal: "test" };
        fs.writeFileSync(BUNDLES_FILE, JSON.stringify(data, null, 2));

        assert.throws(() => repoEditEngine.registerCapabilityFromBundle(bundleId, "Skill", {
            id: `cap_${Date.now()}`, name: "Test", category: "test", riskLevel: "low", executionHandler: "ai", version: "1.0.0",
        }));
    });

    it("registerCapabilityFromBundle() throws for an unknown bundle", () => {
        assert.throws(() => repoEditEngine.registerCapabilityFromBundle("not-a-real-bundle", "Skill", {
            id: "x", name: "x", category: "x", riskLevel: "low", executionHandler: "ai", version: "1.0.0",
        }));
    });

    it("registerCapabilityFromBundle() rejects a raw secret smuggled into the capability metadata", () => {
        const bundleId = `bnd_secret_${Date.now()}`;
        _seedAppliedBundle(bundleId);
        assert.throws(() => repoEditEngine.registerCapabilityFromBundle(bundleId, "Skill", {
            id: `cap_secret_${Date.now()}`, name: "Test", category: "test", riskLevel: "low",
            executionHandler: "ai", version: "1.0.0", apiKey: "sk_should_be_rejected",
        }));
    });

    it("registerCapabilityFromBundle() genuinely registers the skill as PENDING, not active — never composable yet", () => {
        const bundleId = `bnd_pending_${Date.now()}`;
        _seedAppliedBundle(bundleId);
        const capId = `cap_pending_${Date.now()}`;

        const result = repoEditEngine.registerCapabilityFromBundle(bundleId, "Skill", {
            id: capId, name: "New Test Skill", category: "test", riskLevel: "low", executionHandler: "ai", version: "1.0.0",
        });

        assert.equal(result.ok, true);
        assert.equal(result.healthStatus, "pending");
        assert.ok(result.approvalRequestId, "a real approval request must be created");

        const skill = skillRegistry.getSkill(capId);
        assert.equal(skill.healthStatus, "pending", "the skill is genuinely registered but NOT active");

        const composability = skillRegistry.isComposableNow(capId);
        assert.equal(composability.composable, false, "a pending capability is NEVER composable, per the mission's non-negotiable rule");
        assert.equal(composability.reason, "healthStatus:pending");
    });

    it("NO self-generated capability may enter production merely on the pipeline's say-so: without approval, activation is impossible", () => {
        const bundleId = `bnd_noapproval_${Date.now()}`;
        _seedAppliedBundle(bundleId);
        const capId = `cap_noapproval_${Date.now()}`;
        const { approvalRequestId } = repoEditEngine.registerCapabilityFromBundle(bundleId, "Skill", {
            id: capId, name: "Unapproved Skill", category: "test", riskLevel: "low", executionHandler: "ai", version: "1.0.0",
        });

        // Attempting to activate WITHOUT approving the request first must fail.
        assert.throws(() => repoEditEngine.approveCapabilityFromBundle("Skill", capId, approvalRequestId));
        assert.equal(skillRegistry.getSkill(capId).healthStatus, "pending", "still pending — activation genuinely blocked");
    });

    it("approving the REAL request in approvalQueue.cjs is what unblocks activation — full end-to-end proof", () => {
        // agentRegistry.cjs is an empty Map until bootstrapRuntime.cjs runs
        // (real server startup) — bootstrap here so isComposableNow()'s
        // live-handler check has the real runtime to verify against,
        // exactly as production does (same pattern as skillRegistry's
        // own verifyNoOrphans() test).
        require("../../agents/runtime/bootstrapRuntime.cjs");
        const bundleId = `bnd_approved_${Date.now()}`;
        _seedAppliedBundle(bundleId);
        const capId = `cap_approved_${Date.now()}`;
        const { approvalRequestId } = repoEditEngine.registerCapabilityFromBundle(bundleId, "Skill", {
            id: capId, name: "Approved Skill", category: "test", riskLevel: "low", executionHandler: "ai", version: "1.0.0",
        });

        // A human operator approves via the REAL, single-source-of-truth queue.
        approvalQueue.approve(approvalRequestId, { approvedBy: "test-operator" });

        const activation = repoEditEngine.approveCapabilityFromBundle("Skill", capId, approvalRequestId);
        assert.equal(activation.ok, true);
        assert.equal(activation.activated, true);

        const skill = skillRegistry.getSkill(capId);
        assert.equal(skill.healthStatus, "active", "the skill is genuinely activated after real approval");

        const composability = skillRegistry.isComposableNow(capId);
        assert.equal(composability.composable, true, "now genuinely composable, only after real human approval");
    });

    it("approveCapabilityFromBundle() throws if the approval request was REJECTED, not approved", () => {
        const bundleId = `bnd_rejected_${Date.now()}`;
        _seedAppliedBundle(bundleId);
        const capId = `cap_rejected_${Date.now()}`;
        const { approvalRequestId } = repoEditEngine.registerCapabilityFromBundle(bundleId, "Skill", {
            id: capId, name: "Rejected Skill", category: "test", riskLevel: "low", executionHandler: "ai", version: "1.0.0",
        });
        approvalQueue.reject(approvalRequestId, { reason: "not needed", rejectedBy: "test-operator" });
        assert.throws(() => repoEditEngine.approveCapabilityFromBundle("Skill", capId, approvalRequestId));
        assert.equal(skillRegistry.getSkill(capId).healthStatus, "pending");
    });

    it("approveCapabilityFromBundle() throws for an unknown approval request id", () => {
        assert.throws(() => repoEditEngine.approveCapabilityFromBundle("Skill", "some-cap", "not-a-real-request-id"));
    });
});
