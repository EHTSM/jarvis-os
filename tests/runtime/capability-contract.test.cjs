"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../../backend/services/capabilityContract.cjs");

describe("capabilityContract", () => {

    describe("listKinds()", () => {
        it("lists all 18 universal composition entity kinds", () => {
            const kinds = contract.listKinds();
            assert.equal(kinds.length, 18);
            for (const k of [
                "Company", "Department", "Agent", "Skill", "Tool", "Connector",
                "CredentialRequirement", "Workflow", "Trigger", "Permission",
                "ApprovalPolicy", "MemoryScope", "KnowledgeScope", "KPI",
                "Budget", "Execution", "Observation", "LearningRecord",
            ]) {
                assert.ok(kinds.includes(k), `missing kind: ${k}`);
            }
        });
    });

    describe("validate() — valid objects pass", () => {
        it("valid Company passes", () => {
            const r = contract.validate("Company", { id: "co_1", name: "Acme", niche: "saas" });
            assert.equal(r.ok, true);
            assert.deepEqual(r.errors, []);
        });
        it("valid Skill passes", () => {
            const r = contract.validate("Skill", {
                id: "skill_1", name: "Send Email", category: "communication",
                riskLevel: "low", executionHandler: "email_send", version: "1.0.0",
            });
            assert.equal(r.ok, true);
        });
        it("valid CredentialRequirement (reference only) passes", () => {
            const r = contract.validate("CredentialRequirement", {
                provider: "github", credentialRef: "vault:github:oauth_token",
            });
            assert.equal(r.ok, true);
        });
        it("valid LearningRecord passes", () => {
            const r = contract.validate("LearningRecord", { id: "lr_1", type: "success", applied: false });
            assert.equal(r.ok, true);
        });
    });

    describe("validate() — missing/wrong-type required fields fail", () => {
        it("missing required field fails", () => {
            const r = contract.validate("Company", { id: "co_1", name: "Acme" });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("niche")));
        });
        it("wrong type on required field fails", () => {
            const r = contract.validate("Workflow", { id: "wf_1", name: "Onboard", stages: "not-an-array" });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("stages")));
        });
        it("empty-string required field fails", () => {
            const r = contract.validate("Company", { id: "co_1", name: "  ", niche: "saas" });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("name")));
        });
        it("unknown kind fails clearly", () => {
            const r = contract.validate("NotAKind", { id: "x" });
            assert.equal(r.ok, false);
            assert.ok(r.errors[0].includes("Unknown capability contract kind"));
        });
        it("non-object input fails", () => {
            const r = contract.validate("Company", null);
            assert.equal(r.ok, false);
        });
    });

    describe("validate() — raw secret fields are structurally rejected", () => {
        it("rejects a top-level apiKey field", () => {
            const r = contract.validate("Connector", {
                id: "conn_1", provider: "stripe", status: "CONNECTED", apiKey: "sk_live_xxx",
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("apiKey")));
        });
        it("rejects a nested token field", () => {
            const r = contract.validate("Agent", {
                id: "agent_1", orgId: "org_1", archetypeId: "crm",
                config: { auth: { token: "raw-secret-value" } },
            });
            assert.equal(r.ok, false);
            assert.ok(r.errors.some(e => e.includes("config.auth.token")));
        });
        it("rejects password/privateKey/clientSecret variants", () => {
            for (const field of ["password", "privateKey", "clientSecret", "secret"]) {
                const r = contract.validate("Company", { id: "co_1", name: "Acme", niche: "saas", [field]: "x" });
                assert.equal(r.ok, false, `expected rejection for field: ${field}`);
            }
        });
        it("credentialRef (a reference, not a value) is explicitly allowed", () => {
            const r = contract.validate("Agent", {
                id: "agent_1", orgId: "org_1", archetypeId: "crm",
                credentialRefs: ["vault:github:oauth_token"],
            });
            assert.equal(r.ok, true);
        });
    });

    describe("_id()", () => {
        it("generates unique IDs with the given prefix", () => {
            const ids = new Set();
            for (let i = 0; i < 50; i++) ids.add(contract._id("test"));
            assert.equal(ids.size, 50, "expected all generated IDs to be unique");
            for (const id of ids) assert.ok(id.startsWith("test_"));
        });
    });
});
