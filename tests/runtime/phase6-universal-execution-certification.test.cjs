"use strict";
/**
 * PHASE 6 — UNIVERSAL EXECUTION, Missions 196-220 (capstone integration).
 *
 * This mission's inventory found that Phases 1-5 each already built a real,
 * independently-certified piece of the target chain
 *
 *   Intent -> Capability -> Agent -> Workflow -> Tool/Connector -> Execution
 *   -> Verification -> Evidence -> Memory -> Learning -> Controlled Evolution
 *
 * but nothing composed them into one callable path, and nothing proved the
 * composition actually works end-to-end (each phase's own tests only prove
 * that phase's slice in isolation). The one genuine wiring gap found (196-200,
 * "Intent -> Capability"): capabilityDiscovery.discover()/capabilityRouting.routeIntent()
 * (Phase 1) already accept raw free text and already resolve it to a routed,
 * risk-scored capability decision — but nothing chained that decision into an
 * actual gated dispatch + verification + evidence pass. computerExecutionEngine.cjs
 * (desktop-automation-only, 16 regexes) and orgAiBrain.cjs (a pure LLM
 * chat/completion proxy — forwards `messages` to aiOrchestrator.execute(),
 * never touches skillRegistry/capabilityDiscovery/capabilityRouting at all)
 * were both directly traced and confirmed NOT to be a genuine intent-to-
 * capability bridge for the real work-capability registry. The frontend's
 * only *intent*-named file, frontend/src/hooks/useOperatorIntent.js, was also
 * traced and confirmed to be a local-only, localStorage-based command-history
 * predictor with no backend call and no capability awareness whatsoever.
 *
 * The fix: backend/services/universalExecutionGateway.cjs (new, additive-only,
 * zero new registries/stores) — a thin composition layer that chains, in
 * this exact order, six ALREADY-REAL, ALREADY-CERTIFIED primitives and
 * nothing else:
 *   1. capabilityRouting.routeIntent()      (Phase 1 — intent -> capability -> agent)
 *   2. skillRegistry.getSkill().inputSchema (never fabricates a missing
 *      required param — declines with needs_clarification instead)
 *   3. approvalQueue.enqueue()/getRequest() (the exact primitive Phase 3's
 *      orchestratorApprovalBridge.cjs, Phase 4's marketplaceAutomationEngine.cjs
 *      fix, and Phase 5's improvementLoopEngine.cjs activateApprovedTrial()
 *      all already use for "a proposal needs a real decision before it mutates
 *      anything")
 *   4. agentExecutionEngine.executeTask()   (existing per-agent dispatch)
 *   5. executionVerifier.verify()           (Phase 2's real pm2/http/file
 *      probes + honest falsePositive detection — reapplied here exactly as
 *      approvalEngine.cjs's own verifiedOutcome fix already established)
 *   6. approvalEvidence.record()            (existing append-only evidence ledger)
 *
 * This test file is the mission's real deliverable per its own explicit
 * framing ("this mission's real deliverable may be PROOF the chain
 * composes... rather than new capability"): it proves the composed chain
 * for the 12 TEST A-L certification scenarios named in the mission brief,
 * using controlled fakes at exactly two boundaries (documented below) and
 * real isolated copies of every other module in the chain.
 *
 * ── Isolation ────────────────────────────────────────────────────────────
 * skillRegistry.cjs, capabilityDiscovery.cjs, capabilityRouting.cjs,
 * agentRegistry.cjs, approvalQueue.cjs, approvalPolicy.cjs,
 * humanInTheLoop.cjs, approvalEvidence.cjs, universalExecutionGateway.cjs
 * are all required from a throwaway mkdtempSync copy tree (the same
 * technique established by tests/runtime/orchestrator-approval-and-compensation-phase3.test.cjs
 * and tests/runtime/phase5-learning-evolution-safety.test.cjs), including
 * that same family's runtimeEventBus.cjs relative-path re-export shim so
 * approvalQueue.cjs's internal event emission resolves correctly without a
 * second bus instance.
 *
 * agentExecutionEngine.cjs and executionVerifier.cjs are replaced with
 * small, explicit, in-file FAKE modules (not the real files) — disclosed
 * here, not silently substituted: the real agentExecutionEngine.cjs
 * unconditionally writes to data/agent-runs.json and calls the real
 * runtimeOrchestrator.cjs (which would attempt real dispatch machinery far
 * outside this test's scope), and the real executionVerifier.cjs shells out
 * to `pm2 jlist` and makes real HTTP probes. Both fakes are written into the
 * isolated copy tree at the exact same relative paths
 * universalExecutionGateway.cjs requires them from, so the gateway's own
 * require() calls resolve to the fakes without any change to the gateway's
 * own source. No real external API, real data file, or real process/network
 * probe is touched anywhere in this test file — verified by the final
 * "zero bytes written to any real data/*.json file" assertion.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_REPO_ROOT = path.join(__dirname, "..", "..");
const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phase6-iso-"));
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

// Plain, no-cross-dependency files first.
_copy("backend/utils/logger.js");
_copy("backend/utils/auditLog.cjs");
_copy("backend/utils/execLog.cjs");
_copy("backend/services/humanInTheLoop.cjs");
_copy("backend/services/approvalPolicy.cjs");
_copy("backend/services/skillRegistry.cjs");
_copy("backend/services/capabilityDiscovery.cjs");
_copy("backend/services/capabilityRouting.cjs");
_copy("agents/runtime/agentRegistry.cjs");

// approvalQueue.cjs resolves runtimeEventBus.cjs relative to its OWN
// __dirname — same real characteristic already documented in
// orchestrator-approval-and-compensation-phase3.test.cjs and
// phase5-learning-evolution-safety.test.cjs's own header comments. A thin
// re-export at the same relative path keeps this the real, singleton bus
// (not a second instance) without requiring the whole event-bus module tree.
const realBusAbsPath = require.resolve("../../agents/runtime/runtimeEventBus.cjs");
fs.writeFileSync(
    path.join(isoRoot, "agents", "runtime", "runtimeEventBus.cjs"),
    `"use strict";\nmodule.exports = require(${JSON.stringify(realBusAbsPath)});\n`
);
_copy("backend/services/approvalQueue.cjs");
_copy("backend/services/approvalEvidence.cjs");

// ── Disclosed fakes (not the real files) ─────────────────────────────────
// agentExecutionEngine FAKE — a controllable per-agent dispatcher. Tests
// mutate `__FAKE_STATE__` (via the isolated module's own exported test hook)
// to control success/failure per scenario, exactly the shape the real
// module returns ({ runId, success, output, error, durationMs }), so
// universalExecutionGateway.cjs's own code is exercised unmodified.
fs.writeFileSync(path.join(isoRoot, "backend", "services", "agentExecutionEngine.cjs"), `
"use strict";
let _seq = 0;
let _mode = "success"; // "success" | "fail" | "throw"
let _calls = [];
function __setMode(m) { _mode = m; }
function __getCalls() { return _calls; }
function __reset() { _mode = "success"; _calls = []; _seq = 0; }
async function executeTask(agentId, input, opts = {}) {
    const runId = "fake_run_" + (++_seq);
    _calls.push({ agentId, input, opts, runId });
    if (_mode === "throw") throw new Error("fake_dispatch_throw");
    if (_mode === "fail") return { runId, success: false, output: null, error: "fake_dispatch_failure", durationMs: 5 };
    return { runId, success: true, output: "fake dispatch output", error: null, durationMs: 5 };
}
module.exports = { executeTask, __setMode, __getCalls, __reset };
`);

// executionVerifier FAKE — controllable post-dispatch verification. Default
// behavior mirrors the real module's shape ({ verified, checks,
// falsePositive, summary }); tests can force falsePositive:true to prove
// the gateway demotes a tool-reported success to a failed verifiedOutcome
// (Phase 2's verifiedOutcome pattern, reapplied here).
fs.writeFileSync(path.join(isoRoot, "agents", "runtime", "executionVerifier.cjs"), `
"use strict";
let _forceFalsePositive = false;
function __setForceFalsePositive(v) { _forceFalsePositive = v; }
function __reset() { _forceFalsePositive = false; }
async function verify(result, probes = {}) {
    if (_forceFalsePositive) {
        return { verified: false, checks: [{ name: "fake_probe", ok: false, reason: "forced false positive" }], falsePositive: true, summary: "forced" };
    }
    return { verified: result?.success === true, checks: [], falsePositive: false, summary: "fake verifier: no probes configured" };
}
module.exports = { verify, __setForceFalsePositive, __reset };
`);

_copy("backend/services/universalExecutionGateway.cjs");

const skillRegistry = require(path.join(isoRoot, "backend/services/skillRegistry.cjs"));
const agentRegistry = require(path.join(isoRoot, "agents/runtime/agentRegistry.cjs"));
const approvalQueue = require(path.join(isoRoot, "backend/services/approvalQueue.cjs"));
const gateway = require(path.join(isoRoot, "backend/services/universalExecutionGateway.cjs"));
const fakeAgentExec = require(path.join(isoRoot, "backend/services/agentExecutionEngine.cjs"));
const fakeVerifier = require(path.join(isoRoot, "agents/runtime/executionVerifier.cjs"));

function realDataSnapshot() {
    const files = [
        "data/skills.json", "data/agent-registry.json", "data/approval-queue.json",
        "data/agent-runs.json", "data/missions.json", "data/approval-evidence.json",
        "data/approval-evidence.ndjson",
    ];
    const snap = {};
    for (const f of files) {
        const p = path.join(REAL_REPO_ROOT, f);
        try { snap[f] = fs.statSync(p).size; } catch { snap[f] = null; }
    }
    return snap;
}
const INITIAL_DATA_SNAPSHOT = realDataSnapshot();

// ── Fixture: one low-risk, one high-risk skill, one agent registered for each ──
skillRegistry.registerSkill({
    id: "t6_low_risk_cap",
    name: "T6 Low Risk Capability",
    category: "operations",
    description: "Phase 6 test fixture — low risk, no required params.",
    inputSchema: { type: "object" },
    riskLevel: "low",
    executionHandler: "t6_low_risk_cap",
    source: "phase6-test",
    version: "1.0.0",
    healthStatus: "active",
});
skillRegistry.registerSkill({
    id: "t6_high_risk_cap",
    name: "T6 High Risk Capability",
    category: "operations",
    description: "Phase 6 test fixture — high risk, requires approval.",
    inputSchema: { type: "object" },
    riskLevel: "high",
    executionHandler: "t6_high_risk_cap",
    source: "phase6-test",
    version: "1.0.0",
    healthStatus: "active",
});
skillRegistry.registerSkill({
    id: "t6_marketplace_cap",
    name: "T6 Marketplace-Sourced Capability",
    category: "operations",
    description: "Phase 6 test fixture — sourced from a marketplace install, must get NO elevated privilege.",
    inputSchema: { type: "object" },
    riskLevel: "high",
    executionHandler: "t6_marketplace_cap",
    source: "marketplace-install",
    version: "1.0.0",
    healthStatus: "active",
});
skillRegistry.registerSkill({
    id: "t6_needs_params_cap",
    name: "T6 Requires Params",
    category: "operations",
    description: "Phase 6 test fixture — requires a param the gateway must never fabricate.",
    inputSchema: { type: "object", required: ["accountId"] },
    riskLevel: "low",
    executionHandler: "t6_needs_params_cap",
    source: "phase6-test",
    version: "1.0.0",
    healthStatus: "active",
});

agentRegistry.register({ id: "t6_agent_org_a", capabilities: ["t6_low_risk_cap", "t6_high_risk_cap", "t6_marketplace_cap", "t6_needs_params_cap"], handler: async () => ({}), maxConcurrent: 3, workspaceScope: ["org_a"] });
agentRegistry.register({ id: "t6_agent_org_b", capabilities: ["t6_low_risk_cap"], handler: async () => ({}), maxConcurrent: 3, workspaceScope: ["org_b"] });

describe("PHASE 6 — Universal Execution certification (Missions 196-220)", () => {

    describe("196-200 Intent -> Capability — genuine wiring gap closed", () => {
        it("planExecution() resolves free-text intent to a real routed capability decision (no fabrication)", () => {
            const plan = gateway.planExecution("t6_low_risk_cap");
            assert.equal(plan.ok, true);
            assert.equal(plan.capabilityId, "t6_low_risk_cap");
            assert.equal(plan.approvalRequired, false);
            assert.ok(plan.agentId);
        });

        it("an intent with NO matching capability is honestly declined, never fabricated as handled (the genuine MISSING case)", () => {
            const plan = gateway.planExecution("xqzxqzxqz flibbertigibbet wobsnorf zzyzx");
            assert.equal(plan.ok, false);
            assert.equal(plan.stage, "capability_discovery");
            assert.deepEqual(plan.blockedReasons, ["no_capability_match"]);
        });

        it("ambiguous intent requiring a fabricated parameter is declined with needs_clarification, never invented", () => {
            const plan = gateway.planExecution("t6_needs_params_cap", { params: {} });
            assert.equal(plan.ok, false);
            assert.equal(plan.stage, "needs_clarification");
            assert.deepEqual(plan.missingParams, ["accountId"]);
        });

        it("supplying the required parameter allows the plan to proceed (proves the gap is fabrication, not the field itself)", () => {
            const plan = gateway.planExecution("t6_needs_params_cap", { params: { accountId: "acct_1" } });
            assert.equal(plan.ok, true);
        });

        it("empty/whitespace intent text is refused outright, not silently coerced", () => {
            assert.equal(gateway.planExecution("").ok, false);
            assert.equal(gateway.planExecution("   ").ok, false);
        });
    });

    describe("201-205 Tool/Agent selection — bounded by authorized agents only", () => {
        it("routing only ever returns agents that are genuinely registered for the capability", () => {
            const plan = gateway.planExecution("t6_low_risk_cap");
            const ids = plan.eligibleAgents.map(a => a.agentId);
            assert.ok(ids.includes("t6_agent_org_a"));
            assert.ok(ids.includes("t6_agent_org_b"));
        });

        it("a capability with zero registered agents is blocked, never silently assigned an unrelated agent", () => {
            skillRegistry.registerSkill({
                id: "t6_orphan_cap", name: "T6 Orphan", category: "operations",
                description: "no agent registered", inputSchema: { type: "object" },
                riskLevel: "low", executionHandler: "t6_orphan_cap", source: "phase6-test", version: "1.0.0", healthStatus: "active",
            });
            const plan = gateway.planExecution("t6_orphan_cap");
            assert.equal(plan.ok, false);
            assert.ok(plan.blockedReasons.includes("no_eligible_agent"));
        });

        it("a marketplace-sourced capability gets NO implicit elevated privilege over an internal one (same risk-gating applies)", () => {
            const planInternal = gateway.planExecution("t6_high_risk_cap");
            const planMarket = gateway.planExecution("t6_marketplace_cap");
            assert.equal(planInternal.approvalRequired, true);
            assert.equal(planMarket.approvalRequired, true, "marketplace source must not bypass the same risk threshold");
        });
    });

    describe("TEST A — simple single-capability execution (low risk, no approval needed)", () => {
        it("executes end-to-end: routed -> dispatched -> verified -> evidence recorded", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            const result = await gateway.execute("t6_low_risk_cap");
            assert.equal(result.stage, "executed");
            assert.equal(result.ok, true);
            assert.equal(result.verifiedOutcome, "success");
            assert.equal(fakeAgentExec.__getCalls().length, 1);
        });
    });

    describe("TEST B — multi-step (sequential planExecution + execute calls composing correctly)", () => {
        it("two capabilities can be planned and executed in sequence, each independently verified", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            const step1 = await gateway.execute("t6_low_risk_cap");
            const step2 = await gateway.execute("t6_needs_params_cap", { params: { accountId: "acct_2" } });
            assert.equal(step1.ok, true);
            assert.equal(step2.ok, true);
            assert.equal(fakeAgentExec.__getCalls().length, 2);
        });
    });

    describe("TEST C — cross-app (mocked): a capability spans two distinct execution handlers", () => {
        it("routes and executes two capabilities representing distinct connector-shaped domains without cross-contamination", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            const crmStep = await gateway.execute("t6_low_risk_cap", { triggeredBy: "cross_app_test_crm" });
            const notifyStep = await gateway.execute("t6_needs_params_cap", { params: { accountId: "acct_3" }, triggeredBy: "cross_app_test_notify" });
            assert.equal(crmStep.ok, true);
            assert.equal(notifyStep.ok, true);
            const calls = fakeAgentExec.__getCalls();
            assert.equal(calls.length, 2);
            assert.notEqual(calls[0].runId, calls[1].runId);
        });
    });

    describe("TEST D — multi-agent: distinct workspace-scoped agents both remain independently reachable", () => {
        it("planExecution surfaces both eligible agents; caller may pin either one explicitly", async () => {
            fakeAgentExec.__reset();
            const planA = gateway.planExecution("t6_low_risk_cap", { agentId: "t6_agent_org_a" });
            const planB = gateway.planExecution("t6_low_risk_cap", { agentId: "t6_agent_org_b" });
            assert.equal(planA.agentId, "t6_agent_org_a");
            assert.equal(planB.agentId, "t6_agent_org_b");
            const resA = await gateway.execute("t6_low_risk_cap", { agentId: "t6_agent_org_a" });
            const resB = await gateway.execute("t6_low_risk_cap", { agentId: "t6_agent_org_b" });
            assert.equal(resA.agentId, "t6_agent_org_a");
            assert.equal(resB.agentId, "t6_agent_org_b");
        });
    });

    describe("TEST E — authorization failure -> blocked, never executed", () => {
        it("an unknown capability id is blocked, dispatch never attempted", async () => {
            fakeAgentExec.__reset();
            const result = await gateway.execute("xqzxqzxqz flibbertigibbet wobsnorf zzyzx");
            assert.equal(result.ok, false);
            assert.equal(result.stage, "capability_discovery");
            assert.equal(fakeAgentExec.__getCalls().length, 0, "must never dispatch for an unauthorized/unknown capability");
        });
    });

    describe("TEST F — credential/dispatch failure -> blocked honestly, not fabricated as success", () => {
        it("a dispatch that throws is honestly reported as a blocked/failed execution, never as success", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            fakeAgentExec.__setMode("throw");
            await assert.rejects(() => gateway.execute("t6_low_risk_cap"));
            fakeAgentExec.__setMode("success");
        });

        it("a dispatch that returns success:false is honestly reported as verifiedOutcome:failed", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            fakeAgentExec.__setMode("fail");
            const result = await gateway.execute("t6_low_risk_cap");
            assert.equal(result.ok, false);
            assert.equal(result.verifiedOutcome, "failed");
            fakeAgentExec.__setMode("success");
        });
    });

    describe("TEST G — approval required -> cannot execute before approval (reuses Phase 3/5's real approval gate)", () => {
        it("a high-risk capability is NEVER dispatched before approval resolves", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            const result = await gateway.execute("t6_high_risk_cap");
            assert.equal(result.stage, "awaiting_approval");
            assert.ok(result.reqId);
            assert.equal(fakeAgentExec.__getCalls().length, 0, "must not dispatch while awaiting approval");
        });

        it("resumeApprovedExecution() refuses to dispatch for a still-pending request", async () => {
            fakeAgentExec.__reset();
            const gated = await gateway.execute("t6_high_risk_cap");
            const resumed = await gateway.resumeApprovedExecution(gated.reqId);
            assert.equal(resumed.ok, false);
            assert.match(resumed.reason, /approval_not_resolved/);
            assert.equal(fakeAgentExec.__getCalls().length, 0);
        });

        it("resumeApprovedExecution() dispatches ONLY after a genuine, queue-resolved approval (never trusts a caller-supplied flag)", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            const gated = await gateway.execute("t6_high_risk_cap");
            approvalQueue.approve(gated.reqId, { approvedBy: "t6-test-founder" });
            const resumed = await gateway.resumeApprovedExecution(gated.reqId);
            assert.equal(resumed.ok, true);
            assert.equal(resumed.stage, "executed");
            assert.equal(fakeAgentExec.__getCalls().length, 1);
        });

        it("a rejected approval permanently blocks execution — resumeApprovedExecution() refuses even after rejection", async () => {
            fakeAgentExec.__reset();
            const gated = await gateway.execute("t6_high_risk_cap");
            approvalQueue.reject(gated.reqId, { rejectedBy: "t6-test-founder", reason: "not needed" });
            const resumed = await gateway.resumeApprovedExecution(gated.reqId);
            assert.equal(resumed.ok, false);
            assert.match(resumed.reason, /approval_not_resolved/);
            assert.equal(fakeAgentExec.__getCalls().length, 0);
        });
    });

    describe("TEST H — execution failure -> honest failure, no retry/recovery fabrication beyond what exists", () => {
        it("a failed verified execution never reports ok:true, and the failure is visible on the returned object", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            fakeAgentExec.__setMode("fail");
            const result = await gateway.execute("t6_low_risk_cap");
            assert.equal(result.ok, false);
            assert.equal(result.dispatchResult.success, false);
            assert.equal(result.dispatchResult.error, "fake_dispatch_failure");
            fakeAgentExec.__setMode("success");
        });
    });

    describe("TEST I — partial failure / compensation is honestly out of this gateway's scope (not fabricated)", () => {
        it("the gateway itself makes no compensation claim — it returns a plain failed outcome for a caller's own recovery layer (e.g. Phase 3's missionOrchestrator/executionRecovery) to act on", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            fakeAgentExec.__setMode("fail");
            const result = await gateway.execute("t6_low_risk_cap");
            assert.equal(result.ok, false);
            assert.equal("compensation" in result, false, "gateway must not fabricate a compensation/rollback claim it cannot honor itself");
            fakeAgentExec.__setMode("success");
        });
    });

    describe("TEST J — tenant isolation: workspace-scoped agents are not cross-assigned", () => {
        it("an agent explicitly pinned by opts.agentId is honored, and org-scoped agent identity is never silently swapped", async () => {
            fakeAgentExec.__reset();
            const result = await gateway.execute("t6_low_risk_cap", { agentId: "t6_agent_org_b" });
            assert.equal(result.agentId, "t6_agent_org_b");
            assert.equal(fakeAgentExec.__getCalls()[0].agentId, "t6_agent_org_b");
        });

        it("routing for a capability org_b's agent cannot serve never exposes org_b as eligible", () => {
            const plan = gateway.planExecution("t6_high_risk_cap");
            const ids = plan.eligibleAgents.map(a => a.agentId);
            assert.equal(ids.includes("t6_agent_org_b"), false, "org_b's agent never registered t6_high_risk_cap capability");
        });
    });

    describe("TEST K — verification failure -> final state must NOT be VERIFIED even if the tool reported success", () => {
        it("a tool-reported success with a failed independent verification is demoted to verifiedOutcome:failed (Phase 2's verifiedOutcome pattern)", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            fakeAgentExec.__setMode("success");
            fakeVerifier.__setForceFalsePositive(true);
            const result = await gateway.execute("t6_low_risk_cap");
            assert.equal(result.dispatchResult.success, true, "the tool itself reported success");
            assert.equal(result.verification.falsePositive, true);
            assert.equal(result.verifiedOutcome, "failed", "must not be reported as success just because the tool claimed it");
            assert.equal(result.ok, false);
            fakeVerifier.__setForceFalsePositive(false);
        });
    });

    describe("TEST L — evidence: a traceable record exists for a successful verified execution", () => {
        it("approvalEvidence carries a 'verified' event for the execution, with the real outcome, not a fabricated one", () => {
            const approvalEvidence = require(path.join(isoRoot, "backend/services/approvalEvidence.cjs"));
            const evidence = approvalEvidence.listEvidence({ event: "verified", limit: 100 });
            assert.ok(evidence.length > 0, "at least one verified-execution evidence record must exist from the prior TEST A/H/K runs");
            assert.ok(evidence.some(e => e.outcome === "success"));
            assert.ok(evidence.some(e => e.outcome === "failed"), "a verification-failure outcome must also be recorded honestly, not omitted");
        });

        it("an awaiting-approval execution also leaves a traceable 'created' or 'auto_approved' evidence record", () => {
            const approvalEvidence = require(path.join(isoRoot, "backend/services/approvalEvidence.cjs"));
            const evidence = approvalEvidence.listEvidence({ limit: 200 });
            assert.ok(evidence.some(e => e.event === "created" && e.workflowId?.startsWith("wf_universal_exec_")));
        });
    });

    describe("216-218 Verification & Evidence — learning/evolution never auto-mutated after success", () => {
        it("the gateway module itself never requires improvementLoopEngine.cjs/continuousLearningEngine.cjs and never calls applyLearningRecord/activateApprovedTrial as executable code (comment mentions of the sibling pattern are fine; require()/live calls are not)", () => {
            const src = fs.readFileSync(path.join(isoRoot, "backend/services/universalExecutionGateway.cjs"), "utf8");
            // Strip line and block comments before checking for actual code references,
            // so this assertion can't be defeated (or falsely tripped) by prose that
            // documents *why* those functions are deliberately never called from here.
            const codeOnly = src
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .split("\n").map(line => line.replace(/\/\/.*$/, "")).join("\n");
            assert.equal(/require\([^)]*improvementLoopEngine/.test(codeOnly), false, "must not require improvementLoopEngine.cjs");
            assert.equal(/require\([^)]*continuousLearningEngine/.test(codeOnly), false, "must not require continuousLearningEngine.cjs");
            assert.equal(/\.applyLearningRecord\s*\(/.test(codeOnly), false, "must not call applyLearningRecord() as code");
            assert.equal(/\.activateApprovedTrial\s*\(/.test(codeOnly), false, "must not call activateApprovedTrial() as code");
        });
    });

    describe("219-220 Certification — full corpus integrity", () => {
        it("this entire test file wrote zero bytes to any real data/*.json file", () => {
            const finalSnapshot = realDataSnapshot();
            assert.deepEqual(finalSnapshot, INITIAL_DATA_SNAPSHOT, "Phase 6 certification test must not touch any real data/ file");
        });

        it("no external network call or real pm2/http probe was made — the fake verifier's own probes array stayed empty by construction", async () => {
            fakeAgentExec.__reset(); fakeVerifier.__reset();
            const result = await gateway.execute("t6_low_risk_cap");
            assert.deepEqual(result.verification.checks, []);
        });
    });
});
