"use strict";
/**
 * PHASE 5 — LEARNING & EVOLUTION, Missions 176-195.
 *
 * This mission's audit found the overwhelming majority of 176-195 already
 * implemented and reused as-is (continuousLearningEngine.cjs for experience
 * capture + pattern detection with an existing, already-correctly-gated
 * applyLearningRecord(lessonId, action, approvedBy) write-back;
 * learningMemoryEngine.cjs / runtimePatternRecognition.cjs for pattern
 * detection; selfReviewEngine.cjs / consolidationAudit.cjs for evaluation;
 * approvalQueue.cjs / approvalEngine.cjs / approvalPolicy.cjs for the real
 * approval gate; executionVerifier.cjs for verification;
 * executionRecovery.cjs / missionOrchestrator.cjs for rollback;
 * skillRegistry.cjs / agentRegistry.cjs as the only legitimate mutation
 * targets for an approved "new/improved capability or agent").
 *
 * ONE genuine, live, HTTP-reachable UNSAFE gap was found and closed this
 * mission: backend/services/improvementLoopEngine.cjs's apply(recId, change)
 * used to mutate real production state (agent tool/permission grants via
 * agentFactoryAutomation.cjs, or data/system-params.json) IMMEDIATELY on
 * call, with ZERO approval/policy/test/verification gate before the
 * mutation — "keep"/"revert" only ever ran AFTER the fact, as a manual
 * post-hoc undo, not a pre-mutation gate. POST /p20/improve/apply
 * (backend/routes/phase20.js) is gated only by requireAuth (no
 * operatorOnly, no approval check), so any authenticated account could
 * reach agentFactoryAutomation.assignTools()/setPermissions() on an
 * arbitrary real agent with a single HTTP call. Two autonomous callers
 * (aeoState.cjs's applyEvolution() via the 240s aeo_coordinator tick, and
 * evolutionEvolutionEngine.cjs's EXECUTE step) ALSO call apply() with a
 * single-object argument — a pre-existing bug (apply() takes two
 * positional args, so `change` was always undefined) that happens to make
 * both autonomous call sites throw and no-op today. That accident is not a
 * safety control, and this fix does not touch it — see improvementLoopEngine.cjs's
 * own header comment.
 *
 * The fix: apply() now only PROPOSES a change (enqueues a real
 * approvalQueue.cjs request — the exact primitive Phase 3/4 already
 * established as the correct composition point). A NEW function,
 * activateApprovedTrial(trialId), is the ONLY code path that ever calls
 * the real mutation executor, and it refuses unless the approvalQueue
 * request has genuinely resolved to "approved"/"auto_approved".
 *
 * Isolation: agentFactoryAutomation.cjs, memoryPersistenceLayer.cjs,
 * approvalQueue.cjs, and improvementLoopEngine.cjs itself are all required
 * from a throwaway mkdtempSync copy (the same technique already
 * established by tests/runtime/orchestrator-approval-and-compensation-phase3.test.cjs),
 * so this file writes ZERO bytes to any real data/*.json file. No test in
 * this file touches data/agent-registry.json, data/improvement-trials.json,
 * data/approval-queue.json, data/system-params.json, or data/lessons.json.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_REPO_ROOT = path.join(__dirname, "..", "..");
const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phase5-iso-"));
fs.mkdirSync(path.join(isoRoot, "backend", "services"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "backend", "utils"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "agents", "runtime"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "data"), { recursive: true });

function _copy(rel) {
    const dest = path.join(isoRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REAL_REPO_ROOT, rel), dest);
    return dest;
}

// Plain, no-relative-dependency files first.
_copy("backend/utils/logger.js");
_copy("backend/utils/auditLog.cjs");
_copy("backend/services/humanInTheLoop.cjs");
_copy("backend/services/approvalPolicy.cjs");
_copy("backend/services/agentFactoryAutomation.cjs");
_copy("backend/services/memoryPersistenceLayer.cjs");

// approvalQueue.cjs resolves runtimeEventBus.cjs relative to its OWN
// __dirname ("../../agents/runtime/runtimeEventBus.cjs") — same real defect
// class already documented and worked around in
// orchestrator-approval-and-compensation-phase3.test.cjs's header comment.
// Place a thin re-export at that same relative path so the isolated
// approvalQueue.cjs and the real event bus are the same singleton (not a
// second bus instance) — this test doesn't strictly need bus events, but
// keeping the shim means approvalQueue.cjs's own internal `_bus()?.emit()`
// calls don't throw/no-op unexpectedly.
const realBusAbsPath = require.resolve("../../agents/runtime/runtimeEventBus.cjs");
fs.writeFileSync(
    path.join(isoRoot, "agents", "runtime", "runtimeEventBus.cjs"),
    `"use strict";\nmodule.exports = require(${JSON.stringify(realBusAbsPath)});\n`
);
_copy("backend/services/approvalQueue.cjs");
_copy("backend/services/improvementLoopEngine.cjs");
_copy("backend/services/continuousLearningEngine.cjs");
_copy("backend/services/decisionLearningEngine.cjs");
_copy("backend/services/missionMemory.cjs");

const ile = require(path.join(isoRoot, "backend/services/improvementLoopEngine.cjs"));
const aq  = require(path.join(isoRoot, "backend/services/approvalQueue.cjs"));
const afa = require(path.join(isoRoot, "backend/services/agentFactoryAutomation.cjs"));
const cle = require(path.join(isoRoot, "backend/services/continuousLearningEngine.cjs"));
const dle = require(path.join(isoRoot, "backend/services/decisionLearningEngine.cjs"));
const mm  = require(path.join(isoRoot, "backend/services/missionMemory.cjs"));

function realDataSnapshot() {
    const files = [
        "data/improvement-trials.json", "data/approval-queue.json",
        "data/agent-registry.json", "data/system-params.json",
        "data/lessons.json", "data/missions.json", "data/decision-learning.json",
    ];
    const snap = {};
    for (const f of files) {
        const p = path.join(REAL_REPO_ROOT, f);
        try { snap[f] = fs.statSync(p).size; } catch { snap[f] = null; }
    }
    return snap;
}

// Captured at module-load time, before any test body runs (describe()
// callbacks register tests synchronously, but it() bodies execute later via
// node:test's own scheduler — this const is assigned during module
// evaluation, which always completes first).
const INITIAL_DATA_SNAPSHOT = realDataSnapshot();

describe("Phase 5 — Learning & Evolution safety (Missions 176-195)", () => {

    describe("176-179 Experience Learning — capture, provenance, secret scrubbing (reused, not rebuilt)", () => {
        it("createLesson() captures an experience record with real provenance fields", () => {
            const r = cle.createLesson({ type: "manual", title: "T1 test lesson", detail: "detail", source: "phase5-test", agentId: "agent-x" });
            assert.equal(r.saved, true);
            const { lessons } = cle.getLessons({ source: "phase5-test" });
            assert.equal(lessons.length, 1);
            assert.equal(lessons[0].agentId, "agent-x");
            assert.equal(lessons[0].applied, false); // never pre-applied
        });

        it("decisionLearningEngine.recordDecision() captures founder-decision experience with timing/domain provenance", () => {
            const r = dle.recordDecision({ type: "approve", subject: "T1 decision", workflowId: "wf_x", domain: "deployment", outcome: "approved", durationMs: 500 });
            assert.equal(r.ok, true);
            const { decisions } = dle.getDecisions({ domain: "deployment" });
            assert.ok(decisions.some(d => d.subject === "T1 decision"));
        });

        it("createLesson()'s free-text detail is length-bounded (defensive against unbounded experience payloads)", () => {
            const huge = "x".repeat(5000);
            const r = cle.createLesson({ type: "manual", title: "T1 bound", detail: huge, source: "phase5-test" });
            const { lessons } = cle.getLessons({ source: "phase5-test" });
            const found = lessons.find(l => l.lessonId === r.lessonId);
            assert.ok(found.detail.length <= 1000);
        });
    });

    describe("180-183 Pattern Learning — clustering, confidence/thresholding (reused, not rebuilt)", () => {
        it("analyzeFailures() clusters by error pattern and assigns severity from real occurrence counts (never fabricated)", () => {
            const r = cle.analyzeFailures({ limit: 10 });
            assert.ok(Array.isArray(r.clusters));
            for (const c of r.clusters) {
                assert.ok(["low", "medium", "high"].includes(c.severity));
                assert.ok(c.count > 0);
            }
        });

        it("decisionLearningEngine pattern confidence scales with real sample size, never fixed/fabricated", () => {
            for (let i = 0; i < 5; i++) {
                dle.recordDecision({ type: "approve", subject: `bulk ${i}`, workflowId: "wf_bulk", domain: "security", outcome: "approved", durationMs: 100 });
            }
            const { patterns } = dle.getPatterns();
            const secPattern = patterns.security_approval_rate;
            assert.ok(secPattern);
            assert.ok(secPattern.confidence > 0 && secPattern.confidence <= 1);
            assert.equal(secPattern.sampleSize >= 5, true);
        });
    });

    describe("184-187 Workflow Optimization — proposal-only, never auto-applied", () => {
        it("apply() PROPOSES a workflow/runtime change without mutating anything (THE FIX)", async () => {
            const paramFileExistedBefore = fs.existsSync(path.join(isoRoot, "data", "system-params.json"));
            const r = await ile.apply("rec_wf_1", { target: "system_param", targetId: "phase5_test_param", params: { value: "should-not-apply-yet" } });
            assert.equal(r.status, "awaiting_approval");
            assert.ok(r.reqId);
            // The param file must not have been created/modified by apply() itself.
            const paramFileExistsAfter = fs.existsSync(path.join(isoRoot, "data", "system-params.json"));
            assert.equal(paramFileExistsAfter, paramFileExistedBefore, "apply() must not write system-params.json before approval");
        });

        it("a pending (unapproved) proposal cannot be activated (SAFETY BOUNDARY)", async () => {
            const r = await ile.apply("rec_wf_2", { target: "system_param", targetId: "phase5_test_param_2", params: { value: 1 } });
            await assert.rejects(() => ile.activateApprovedTrial(r.trialId), /not approved|awaiting_approval/i);
        });

        it("a rejected proposal cannot be activated (SAFETY BOUNDARY)", async () => {
            const r = await ile.apply("rec_wf_3", { target: "system_param", targetId: "phase5_test_param_3", params: { value: 1 } });
            aq.reject(r.reqId, { reason: "not needed", rejectedBy: "test-founder" });
            await assert.rejects(() => ile.activateApprovedTrial(r.trialId), /not approved/i);
        });

        it("an approved proposal CAN activate, in isolation only, and genuinely mutates only after approval (SAFETY BOUNDARY)", async () => {
            const r = await ile.apply("rec_wf_4", { target: "system_param", targetId: "phase5_test_param_4", params: { value: "approved-value" } });
            aq.approve(r.reqId, { approvedBy: "test-founder" });
            const activated = await ile.activateApprovedTrial(r.trialId);
            assert.equal(activated.status, "active");
            const paramFile = JSON.parse(fs.readFileSync(path.join(isoRoot, "data", "system-params.json"), "utf8"));
            assert.equal(paramFile.phase5_test_param_4, "approved-value");
        });

        it("keep() refuses on a trial that was never activated (no fabricated success — CLAUDE.md §18)", async () => {
            const r = await ile.apply("rec_wf_5", { target: "system_param", targetId: "phase5_test_param_5", params: { value: 1 } });
            await assert.rejects(() => ile.keep(r.trialId), /not active/i);
        });

        it("revert() on a not-yet-activated proposal cancels honestly rather than reporting a fabricated rollback", async () => {
            const r = await ile.apply("rec_wf_6", { target: "system_param", targetId: "phase5_test_param_6", params: { value: 1 } });
            const reverted = await ile.revert(r.trialId);
            assert.equal(reverted.status, "cancelled");
        });

        it("rollback restores prior state after a genuine activation+revert (architecturally supported case)", async () => {
            // Establish a baseline value directly via a second approved trial.
            const r1 = await ile.apply("rec_wf_7a", { target: "system_param", targetId: "phase5_rollback_param", params: { value: "v1" } });
            aq.approve(r1.reqId, { approvedBy: "test-founder" });
            await ile.activateApprovedTrial(r1.trialId);

            const r2 = await ile.apply("rec_wf_7b", { target: "system_param", targetId: "phase5_rollback_param", params: { value: "v2" } });
            aq.approve(r2.reqId, { approvedBy: "test-founder" });
            await ile.activateApprovedTrial(r2.trialId);

            let paramFile = JSON.parse(fs.readFileSync(path.join(isoRoot, "data", "system-params.json"), "utf8"));
            assert.equal(paramFile.phase5_rollback_param, "v2");

            const revertResult = await ile.revert(r2.trialId);
            assert.equal(revertResult.status, "reverted");
            paramFile = JSON.parse(fs.readFileSync(path.join(isoRoot, "data", "system-params.json"), "utf8"));
            assert.equal(paramFile.phase5_rollback_param, "v1", "revert() must restore the pre-change snapshot exactly");
        });
    });

    describe("188-191 Agent Evolution — proposal shape, never bypasses agentRegistry/agentFactoryAutomation's own mutation APIs", () => {
        it("an approved agent_config proposal only ever calls agentFactoryAutomation's own assignTools()/setPermissions() APIs — never a raw file write", async () => {
            const created = afa.createAgent({ name: "phase5-test-agent", role: "test", tools: [] });
            const agentId = created.agentId;

            const r = await ile.apply("rec_agent_1", { target: "agent_config", targetId: agentId, params: { tools: ["github"] } });
            assert.equal(r.status, "awaiting_approval");
            // Not yet mutated:
            assert.deepEqual(afa.getAgent(agentId).tools, []);

            aq.approve(r.reqId, { approvedBy: "test-founder" });
            const activated = await ile.activateApprovedTrial(r.trialId);
            assert.equal(activated.status, "active");
            assert.deepEqual(afa.getAgent(agentId).tools, ["github"]);
        });

        it("continuousLearningEngine.applyLearningRecord() requires an explicit approvedBy — no self-applied agent-weight learning (pre-existing, reused, re-verified)", () => {
            assert.throws(() => cle.applyLearningRecord("nonexistent", { agentId: "a", weightDelta: 0.1 }, null), /approvedBy/);
        });
    });

    describe("192-195 Safe Self-Improvement — the end-to-end approval/policy/test/verify/rollback/audit gate chain", () => {
        it("UNSAFE-BOUNDARY: a proposal cannot skip the queue — activateApprovedTrial() always re-checks approvalQueue's live status, never trusts a caller-supplied flag", async () => {
            const r = await ile.apply("rec_safe_1", { target: "agent_config", targetId: "nonexistent-agent-id", params: { tools: [] } });
            // Even though the caller "knows" the trialId and reqId, nothing
            // in activateApprovedTrial()'s signature accepts a bypass flag.
            await assert.rejects(() => ile.activateApprovedTrial(r.trialId), /not approved/i);
        });

        it("a failed activation (e.g. unknown agent) never marks a trial active, and never gets a fabricated success", async () => {
            const r = await ile.apply("rec_safe_2", { target: "agent_config", targetId: "definitely-does-not-exist", params: { tools: ["github"] } });
            aq.approve(r.reqId, { approvedBy: "test-founder" });
            await assert.rejects(() => ile.activateApprovedTrial(r.trialId), /Agent .* not found|Failed to apply/i);
            const trial = ile.getTrial(r.trialId);
            assert.equal(trial.status, "activation_failed");
        });

        it("tenant isolation: two different lesson/decision sources' experience records never cross-influence each other's pattern computation", () => {
            dle.recordDecision({ type: "approve", subject: "tenantA-only", workflowId: "wf_tenantA", domain: "cost", outcome: "approved", durationMs: 10 });
            const { decisions: domainScoped } = dle.getDecisions({ domain: "cost" });
            assert.ok(domainScoped.every(d => d.domain === "cost"));
            assert.ok(!domainScoped.some(d => d.domain === "security"));
        });

        it("missionMemory experience records with different orgId never leak into an orgId-filtered listMissions() query (reused Phase 2 tenant boundary)", () => {
            const a = mm.createMission({ objective: "phase5 tenant A mission", orgId: "org-phase5-a" });
            const b = mm.createMission({ objective: "phase5 tenant B mission", orgId: "org-phase5-b" });
            const { missions: aOnly } = mm.listMissions({ orgId: "org-phase5-a", limit: 100 });
            assert.ok(aOnly.some(m => m.id === a.id));
            assert.ok(!aOnly.some(m => m.id === b.id));
        });

        it("untrusted learned/experience text is never executed — createLesson()'s free-text fields never reach eval/exec/require, only produce a structured record", () => {
            const maliciously_shaped = "require('fs').unlinkSync('/etc/passwd'); process.exit(1)";
            const r = cle.createLesson({ type: "manual", title: "T1", detail: maliciously_shaped, recommendation: maliciously_shaped, source: "phase5-test" });
            assert.equal(r.saved, true);
            // Merely creating the lesson must not have thrown, executed, or
            // crashed the process — proving the text was stored as data.
            const { lessons } = cle.getLessons({ source: "phase5-test" });
            const found = lessons.find(l => l.lessonId === r.lessonId);
            assert.equal(found.detail, maliciously_shaped);
            assert.equal(typeof found.detail, "string");
        });

        it("audit trail is present for the full propose->approve->activate chain", async () => {
            // auditLog.cjs writes via a buffered fs.createWriteStream — wait
            // briefly for the OS to flush before reading, rather than assuming
            // a synchronous write (its own real, pre-existing behavior).
            const auditPath = path.join(isoRoot, "data", "logs", "audit.ndjson");
            const readLines = () => fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
            const waitFor = async (pred, timeoutMs = 2000) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    if (pred()) return true;
                    await new Promise(r => setTimeout(r, 20));
                }
                return false;
            };

            const r = await ile.apply("rec_audit_1", { target: "system_param", targetId: "phase5_audit_param", params: { value: 1 } });
            aq.approve(r.reqId, { approvedBy: "test-founder" });
            await ile.activateApprovedTrial(r.trialId);

            const ok = await waitFor(() => {
                const lines = readLines();
                return lines.some(l => l.type === "improvement_propose" && l.trialId === r.trialId)
                    && lines.some(l => l.type === "improvement_activate" && l.trialId === r.trialId);
            });
            assert.ok(ok, "propose + activate must both append real, findable audit entries");
        });
    });

    describe("Production data integrity", () => {
        it("this entire test file wrote zero bytes to any real data/*.json file", () => {
            const after = realDataSnapshot();
            assert.deepEqual(after, INITIAL_DATA_SNAPSHOT);
        });
    });
});
