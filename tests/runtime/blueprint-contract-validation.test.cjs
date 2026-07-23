"use strict";
/**
 * Universal Composition Engine — Completion Gaps, Phase 1: Blueprint
 * Contract Validation. Reuses capabilityContract.cjs's existing
 * validate(kind, obj) function for every entity kind — no second schema
 * system. Proves: structurally invalid blueprints are rejected, raw
 * secrets anywhere in a blueprint are rejected, and reference chains
 * (department -> agent, agent -> skill, skill -> tool, tool ->
 * connector, connector -> credential requirement, action -> approval
 * policy) are genuinely checked, not assumed.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../../backend/services/capabilityContract.cjs");

describe("capabilityContract.validateBlueprint()", () => {

    describe("positive cases — valid blueprints pass", () => {
        it("a minimal valid blueprint (company only) passes", () => {
            const r = contract.validateBlueprint({ company: { id: "co_1", name: "Acme", niche: "saas" } });
            assert.equal(r.ok, true);
            assert.deepEqual(r.errors, []);
        });

        it("a full blueprint with every section populated and genuinely cross-referenced passes", () => {
            const blueprint = {
                company: { id: "co_1", name: "Acme", niche: "saas" },
                departments: [{ id: "dept_1", templateKey: "engineering", label: "Engineering", agentIds: ["agent_1"] }],
                agents: [{ id: "agent_1", orgId: "org_1", archetypeId: "dev", skillIds: ["skill_1"] }],
                skills: [{ id: "skill_1", name: "Dev Tooling", category: "engineering", riskLevel: "medium", executionHandler: "dev", version: "1.0.0", toolIds: ["tool_1"] }],
                tools: [{ id: "tool_1", name: "System Exec", riskLevel: "high", executionHandler: "system:exec", connectorId: "conn_1" }],
                connectors: [{ id: "conn_1", provider: "github", status: "CONNECTED", credentialRequirementId: "github" }],
                credentialRequirements: [{ provider: "github", credentialRef: "vault:github:oauth_token" }],
                workflows: [{ id: "wf_1", name: "Onboarding", stages: [] }],
                permissions: [{ action: "deploy", approvalPolicyId: "policy_1" }],
                approvalPolicies: [{ id: "policy_1", workflowId: "wf_deploy", risk: "high" }],
                memoryScope: { id: "mem_1", orgId: "org_1" },
                knowledgeScope: { id: "kb_1", orgId: "org_1" },
                kpis: [{ id: "kpi_1", name: "uptime" }],
                budget: { orgId: "org_1", amount: 5000 },
            };
            const r = contract.validateBlueprint(blueprint);
            assert.equal(r.ok, true, `expected no errors, got: ${JSON.stringify(r.errors)}`);
        });

        it("optional sections may be omitted entirely without failing", () => {
            const r = contract.validateBlueprint({ company: { id: "co_1", name: "Acme", niche: "saas" }, departments: [] });
            assert.equal(r.ok, true);
        });
    });

    describe("negative cases — structurally invalid blueprints are rejected", () => {
        it("rejects a blueprint with no company section", () => {
            const r = contract.validateBlueprint({ departments: [] });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("company")));
        });
        it("rejects a blueprint whose company entity is missing a required field", () => {
            const r = contract.validateBlueprint({ company: { id: "co_1", name: "Acme" } }); // missing niche
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("niche")));
        });
        it("rejects a department entity missing a required field", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                departments: [{ id: "dept_1", label: "Engineering" }], // missing templateKey
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("departments[0]")));
        });
        it("rejects a non-array section", () => {
            const r = contract.validateBlueprint({ company: { id: "co_1", name: "Acme", niche: "saas" }, skills: "not-an-array" });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("skills: must be an array")));
        });
        it("rejects a raw secret ANYWHERE in the blueprint, not just in a per-entity section", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                topLevelLeak: { apiKey: "sk_should_never_be_here" },
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("apiKey")));
        });
    });

    describe("reference-chain integrity", () => {
        it("rejects a department referencing an agentId that does not exist in blueprint.agents", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                departments: [{ id: "dept_1", templateKey: "engineering", label: "Engineering", agentIds: ["agent_ghost"] }],
                agents: [],
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("references unknown Agent") && e.includes("agent_ghost")));
        });
        it("rejects an agent referencing a skillId that does not exist in blueprint.skills", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                agents: [{ id: "agent_1", orgId: "org_1", archetypeId: "dev", skillIds: ["skill_ghost"] }],
                skills: [],
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("references unknown Skill") && e.includes("skill_ghost")));
        });
        it("rejects a skill referencing a toolId that does not exist in blueprint.tools", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                skills: [{ id: "skill_1", name: "X", category: "test", riskLevel: "low", executionHandler: "ai", version: "1.0.0", toolIds: ["tool_ghost"] }],
                tools: [],
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("references unknown Tool") && e.includes("tool_ghost")));
        });
        it("rejects a tool referencing a connectorId that does not exist in blueprint.connectors", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                tools: [{ id: "tool_1", name: "X", riskLevel: "low", executionHandler: "ai", connectorId: "conn_ghost" }],
                connectors: [],
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("references unknown Connector") && e.includes("conn_ghost")));
        });
        it("rejects a connector referencing a credentialRequirementId that does not exist", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                connectors: [{ id: "conn_1", provider: "github", status: "READY", credentialRequirementId: "ghost_provider" }],
                credentialRequirements: [],
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("references unknown CredentialRequirement")));
        });
        it("rejects a permission/action referencing an approvalPolicyId that does not exist", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                permissions: [{ action: "deploy", approvalPolicyId: "policy_ghost" }],
                approvalPolicies: [],
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("references unknown ApprovalPolicy")));
        });
        it("a department/agent/skill/tool with NO reference field at all is fine (empty is honest, not an error)", () => {
            const r = contract.validateBlueprint({
                company: { id: "co_1", name: "Acme", niche: "saas" },
                departments: [{ id: "dept_1", templateKey: "engineering", label: "Engineering" }], // no agentIds field
            });
            assert.equal(r.ok, true);
        });
    });
});

describe("companyFactory.cjs blueprint validation wiring", () => {
    const companyFactory = require("../../backend/services/companyFactory.cjs");

    it("assembleBlueprintForContract() produces a Company + Departments + Skills blueprint from real composed department data", () => {
        const composedDepartments = [
            { templateKey: "engineering", label: "Engineering", skills: ["dev", "code_search"], composable: true, requiresNewCapability: false },
        ];
        const blueprint = companyFactory.assembleBlueprintForContract({ id: "co_test", name: "Test Co" }, { id: "saas" }, composedDepartments);
        assert.equal(blueprint.company.id, "co_test");
        assert.equal(blueprint.departments.length, 1);
        assert.deepEqual(blueprint.departments[0].skillIds, ["dev", "code_search"]);
    });

    it("validateCompanyBlueprint() passes for a real, genuinely composable department set (skills resolve in the real skillRegistry)", () => {
        const composedDepartments = [
            { templateKey: "engineering", label: "Engineering", skills: ["dev"], composable: true, requiresNewCapability: false },
        ];
        const result = companyFactory.validateCompanyBlueprint({ id: "co_test2", name: "Test Co 2" }, { id: "saas" }, composedDepartments);
        assert.equal(result.ok, true, `expected pass, got: ${JSON.stringify(result.errors)}`);
    });

    it("validateCompanyBlueprint() honestly surfaces a reference-integrity gap when a department claims a skill that isn't in the real skill registry", () => {
        const composedDepartments = [
            { templateKey: "fake_dept", label: "Fake Dept", skills: ["totally-nonexistent-skill-xyz"], composable: false, requiresNewCapability: true },
        ];
        const result = companyFactory.validateCompanyBlueprint({ id: "co_test3", name: "Test Co 3" }, { id: "saas" }, composedDepartments);
        assert.equal(result.ok, false, "a department referencing a non-existent skill must fail contract validation, not silently pass");
        assert.ok(result.errors.some(e => e.includes("totally-nonexistent-skill-xyz")));
    });
});
