"use strict";
/**
 * 100-Company Missing Capability Build-Out — regression test for a real
 * bug found and fixed in agents/runtime/executionEngine.cjs.
 *
 * Root cause: many skills (strategy/executive_summary, and every new
 * HR/Legal/Procurement/Inventory/Logistics skill this mission adds)
 * share the generic executionHandler:"ai" — there is no dedicated agent
 * per skill, by design (the whole point of reusing the existing "ai"
 * agent instead of writing new agent files). taskRouter.resolveCapability
 * correctly collapses any such skill's task.type down to capability "ai"
 * for AGENT dispatch. But executionEngine.cjs's Phase 11 skill lookup
 * used to look up skillRegistry.getSkill(capability) using that SAME
 * collapsed "ai" string — which only ever found the generic "ai" skill
 * entry itself (riskLevel:"low"), never the actual skill being invoked.
 * This silently made every such skill's own riskLevel/requiredTools/
 * optionalConnectors invisible to the tool-permission check, connector-
 * health check, and — most importantly — the approval gate: a
 * riskLevel:"high" skill like "employment_action_review" would execute
 * WITHOUT ever requesting approval, because the engine was checking the
 * generic "ai" skill's (low) risk level instead of its own.
 *
 * The same collapse applied to agentInstanceRegistry.findForOrgAndArchetype
 * (used to look up per-org instance config) — two different skills
 * sharing the "ai" agent would collide onto the SAME registered
 * AgentInstance for a given org, since both resolved to archetypeId "ai".
 *
 * Fix (additive, backward compatible): executionEngine.cjs now looks up
 * the skill AND the agent instance by the raw task.type FIRST (a skill's
 * own id), falling back to the resolved capability only when nothing is
 * registered under task.type directly — preserving identical behavior
 * for every skill whose id already IS its own dedicated agent capability
 * (e.g. "crm", "seo", "content_writer").
 */
process.env.JARVIS_TEST_DATA_SUFFIX = `test-${process.pid}-${Date.now()}`;

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const INST_FILE = path.join(__dirname, `../../data/agent-instances.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`);
const SKILLS_FILE = path.join(__dirname, `../../data/skills.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`);
after(() => { for (const f of [INST_FILE, SKILLS_FILE]) { try { fs.unlinkSync(f); } catch {} } });

require("../../agents/runtime/bootstrapRuntime.cjs"); // registers the REAL "ai" agent (real aiService.callAI handler) — required for genuine, unmodified dispatch, not a synthetic per-test agent
const executionEngine = require("../../agents/runtime/executionEngine.cjs");
const agentInstanceRegistry = require("../../backend/services/agentInstanceRegistry.cjs");
const skillRegistry = require("../../backend/services/skillRegistry.cjs");
const approvalQueue = require("../../backend/services/approvalQueue.cjs");
const agentRegistry = require("../../agents/runtime/agentRegistry.cjs");

describe("executionEngine.cjs — skill/instance lookup no longer collapses onto the shared 'ai' capability", () => {

    it("a riskLevel:high skill sharing executionHandler:'ai' genuinely triggers the approval gate under REAL, unmodified dispatch (no taskRouter override)", async () => {
        // employment_action_review is seeded (SEED_SKILLS in skillRegistry.cjs) as riskLevel:"high", executionHandler:"ai".
        const skill = skillRegistry.getSkill("employment_action_review");
        assert.ok(skill, "employment_action_review must be a real seeded skill");
        assert.equal(skill.riskLevel, "high");
        assert.equal(skill.executionHandler, "ai");

        const orgId = `org_collapse_highrisk_${Date.now()}`;
        agentInstanceRegistry.register("employment_action_review", orgId, "co_collapse_highrisk", {});

        // Deliberately NO taskRouter.resolveCapability override — this must work through the real, unmodified router (which correctly collapses this task.type to capability "ai").
        const result = await executionEngine.executeTask({ type: "employment_action_review", orgId, label: "terminate employee X" });

        assert.equal(result.success, false, "a high-risk skill sharing the 'ai' capability must still be blocked pending approval");
        assert.ok(result.error.includes("approval_required"), `expected approval_required, got: ${result.error}`);
        assert.ok(result.approvalRequestId, "a real approval request must have been created");
        const realRequest = approvalQueue.getRequest(result.approvalRequestId);
        assert.ok(realRequest, "the approval request must genuinely exist in approvalQueue.cjs");
    });

    it("a riskLevel:low skill sharing executionHandler:'ai' executes without an approval gate under real dispatch", async () => {
        const skill = skillRegistry.getSkill("candidate_screening");
        assert.ok(skill);
        assert.equal(skill.riskLevel, "low");

        const orgId = `org_collapse_lowrisk_${Date.now()}`;
        agentInstanceRegistry.register("candidate_screening", orgId, "co_collapse_lowrisk", {});
        const result = await executionEngine.executeTask({ type: "candidate_screening", orgId, label: "screen candidate" });

        assert.equal(result.agentId, "ai", "must genuinely dispatch to the real 'ai' agent, not a fabricated handler");
        assert.ok(!result.error?.includes("approval_required"), "a low-risk skill must never be blocked pending approval");
    });

    it("two different skills sharing the 'ai' capability, registered as separate AgentInstances for the SAME org, no longer collide onto one shared instance", async () => {
        const orgId = `org_collapse_noclash_${Date.now()}`;
        const instHr = agentInstanceRegistry.register("job_description_generation", orgId, "co_collapse_noclash", { goals: ["hr goal"] });
        const instLegal = agentInstanceRegistry.register("contract_analysis", orgId, "co_collapse_noclash", { goals: ["legal goal"] });
        assert.notEqual(instHr.id, instLegal.id, "two distinct instances must be created, not collapsed into one");

        // Temporarily wrap the REAL "ai" agent's handler to capture ctx,
        // instead of registering a competing shadow agent under the same
        // "ai" capability (which would permanently pollute findForCapability's
        // load-balancing pool for every subsequent test in this process).
        let capturedCtxHr = null, capturedCtxLegal = null;
        const realAiAgent = agentRegistry.get("ai");
        assert.ok(realAiAgent, "the real 'ai' agent must be registered (via bootstrapRuntime.cjs)");
        const originalHandler = realAiAgent.handler;
        realAiAgent.handler = async (task, ctx) => {
            if (task.type === "job_description_generation") capturedCtxHr = ctx;
            if (task.type === "contract_analysis") capturedCtxLegal = ctx;
            return { success: true };
        };

        await executionEngine.executeTask({ type: "job_description_generation", orgId, label: "draft JD" });
        await executionEngine.executeTask({ type: "contract_analysis", orgId, label: "review contract" });
        realAiAgent.handler = originalHandler;

        assert.ok(capturedCtxHr, "HR task must have dispatched");
        assert.ok(capturedCtxLegal, "Legal task must have dispatched");
        assert.equal(capturedCtxHr.agentInstanceId, instHr.id, "HR task's ctx must carry the HR instance's id, not a collapsed/shared one");
        assert.equal(capturedCtxLegal.agentInstanceId, instLegal.id, "Legal task's ctx must carry the Legal instance's id, not a collapsed/shared one");
        assert.notEqual(capturedCtxHr.agentInstanceId, capturedCtxLegal.agentInstanceId, "the two instances must remain genuinely distinct in dispatch, proving the capability-collapse bug is fixed");
    });

    it("backward compatibility: a task type mapped to its own dedicated agent capability (e.g. task.type 'get_leads' -> capability 'crm', per taskRouter's real TASK_TYPE_MAP) is unaffected by the fix", async () => {
        const orgId = `org_collapse_backcompat_${Date.now()}`;
        // "get_leads" is the real task.type taskRouter.cjs maps to capability "crm" — there is no skill registered under the literal id "get_leads", so the getSkill(task.type) lookup this fix adds correctly finds nothing and falls back to the resolved capability "crm", identical to pre-fix behavior.
        agentInstanceRegistry.register("crm", orgId, "co_collapse_backcompat", {});
        const result = await executionEngine.executeTask({ type: "get_leads", orgId, label: "get leads" });
        assert.equal(result.agentId, "crm", "a task type with its own dedicated agent capability must still reach that agent, not regress onto the generic 'ai' fallback");
    });
});
