"use strict";
/**
 * Phase 2 (Agent Identity, Missions 121-124) regression coverage.
 *
 * Covers the additive AgentRecord identity fields (role, allowedTools,
 * credentialScope, workspaceScope, lifecycleState, provenance) and the two
 * new behaviors they enable: canUseTool() gating and lifecycle-based
 * exclusion from dispatch. Also proves the pre-existing minimal registration
 * shape ({id, capabilities, handler}) still gets safe defaults, so no
 * existing production caller (bootstrapRuntime.cjs) is affected.
 */
const { describe, it } = require("node:test");
const assert   = require("node:assert/strict");
const registry = require("../../agents/runtime/agentRegistry.cjs");

const P = `idn-${Date.now().toString(36)}`;
function noop() { return { success: true }; }

describe("agentRegistry — Phase 2 Agent Identity", () => {

    describe("backward compatibility", () => {
        it("minimal registration (id, capabilities, handler) still works with safe identity defaults", () => {
            registry.register({ id: `${P}-minimal`, capabilities: ["cap"], handler: noop });
            const a = registry.get(`${P}-minimal`);
            assert.equal(a.role, null);
            assert.equal(a.allowedTools, null, "no allowedTools = unrestricted, matching pre-Phase-2 behavior");
            assert.equal(a.lifecycleState, "active");
            assert.ok(a.credentialScope instanceof Set);
            assert.equal(a.credentialScope.size, 0);
            assert.ok(a.provenance && typeof a.provenance === "object");
        });
        it("an agent with no allowedTools can use any tool", () => {
            registry.register({ id: `${P}-unrestricted`, capabilities: ["cap"], handler: noop });
            const a = registry.get(`${P}-unrestricted`);
            assert.equal(a.canUseTool("github"), true);
            assert.equal(a.canUseTool("anything-at-all"), true);
        });
    });

    describe("identity fields", () => {
        it("stores role, purpose, credentialScope, workspaceScope, provenance", () => {
            registry.register({
                id: `${P}-full`, capabilities: ["cap"], handler: noop,
                role: "sales", purpose: "handles inbound leads",
                credentialScope: ["crm", "email"],
                workspaceScope: "org-abc",
                provenance: { registeredBy: "bootstrapRuntime", registeredAt: "2026-09-08T00:00:00Z", source: "static" },
            });
            const a = registry.get(`${P}-full`);
            assert.equal(a.role, "sales");
            assert.equal(a.purpose, "handles inbound leads");
            assert.ok(a.credentialScope.has("crm"));
            assert.ok(a.credentialScope.has("email"));
            assert.equal(a.workspaceScope, "org-abc");
            assert.equal(a.provenance.registeredBy, "bootstrapRuntime");
        });
        it("toJSON() exposes all identity fields", () => {
            registry.register({ id: `${P}-json`, capabilities: ["cap"], handler: noop, role: "dev" });
            const j = registry.get(`${P}-json`).toJSON();
            for (const key of ["role", "purpose", "allowedTools", "credentialScope", "workspaceScope", "lifecycleState", "provenance"]) {
                assert.ok(key in j, `toJSON() missing identity field: ${key}`);
            }
            assert.equal(j.role, "dev");
        });
        it("rejects an invalid lifecycleState at construction, falling back to active", () => {
            registry.register({ id: `${P}-badstate`, capabilities: ["cap"], handler: noop, lifecycleState: "bogus" });
            assert.equal(registry.get(`${P}-badstate`).lifecycleState, "active");
        });
    });

    describe("canUseTool() — allowlist enforcement", () => {
        it("an explicit allowedTools list denies tools not on it", () => {
            registry.register({ id: `${P}-scoped`, capabilities: ["cap"], handler: noop, allowedTools: ["github"] });
            const a = registry.get(`${P}-scoped`);
            assert.equal(a.canUseTool("github"), true);
            assert.equal(a.canUseTool("gmail"), false);
        });
        it("a retired agent can never use any tool, even with an unrestricted allowlist", () => {
            registry.register({ id: `${P}-retired-tool`, capabilities: ["cap"], handler: noop });
            registry.setLifecycleState(`${P}-retired-tool`, "retired");
            assert.equal(registry.get(`${P}-retired-tool`).canUseTool("github"), false);
        });
    });

    describe("lifecycleState — dispatch exclusion", () => {
        it("setLifecycleState() changes state and rejects invalid values", () => {
            registry.register({ id: `${P}-lc`, capabilities: [`${P}-lc-cap`], handler: noop });
            assert.equal(registry.setLifecycleState(`${P}-lc`, "paused"), "paused");
            assert.throws(() => registry.setLifecycleState(`${P}-lc`, "not-a-real-state"));
        });
        it("a paused agent is not isAvailable() and is excluded from findForCapability()", () => {
            registry.register({ id: `${P}-paused`, capabilities: [`${P}-paused-cap`], handler: noop });
            registry.setLifecycleState(`${P}-paused`, "paused");
            const a = registry.get(`${P}-paused`);
            assert.equal(a.isAvailable(), false);
            assert.equal(registry.findForCapability(`${P}-paused-cap`), null);
        });
        it("a retired agent is likewise excluded from dispatch", () => {
            registry.register({ id: `${P}-retired-disp`, capabilities: [`${P}-retired-disp-cap`], handler: noop });
            registry.setLifecycleState(`${P}-retired-disp`, "retired");
            assert.equal(registry.findForCapability(`${P}-retired-disp-cap`), null);
        });
        it("re-activating a paused agent restores availability", () => {
            registry.register({ id: `${P}-reactivate`, capabilities: [`${P}-reactivate-cap`], handler: noop });
            registry.setLifecycleState(`${P}-reactivate`, "paused");
            registry.setLifecycleState(`${P}-reactivate`, "active");
            assert.equal(registry.get(`${P}-reactivate`).isAvailable(), true);
            assert.ok(registry.findForCapability(`${P}-reactivate-cap`));
        });
        it("setLifecycleState() throws for an unknown agent id", () => {
            assert.throws(() => registry.setLifecycleState("totally-unknown-xyz-abc", "paused"));
        });
    });
});
