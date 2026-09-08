"use strict";
/**
 * Phase 2 (Agent Identity, Missions 121-124) regression coverage.
 *
 * Covers the new agent-allowlist check added to toolExecutionLayer.execute():
 * opts.agentId was already threaded through for audit/logging but never
 * checked against the calling agent's own agentRegistry.canUseTool() before
 * this change — any agentId could invoke any tool the org/platform-wide
 * permission grant allowed. Uses JARVIS_TEST_DATA_SUFFIX (the same isolation
 * convention toolExecutionLayer.cjs and agentInstanceRegistry.cjs already
 * document) so this test never touches the real data/tool-*.json files.
 */
process.env.JARVIS_TEST_DATA_SUFFIX = `test-agent-identity-${Date.now()}`;

const { describe, it, after } = require("node:test");
const assert   = require("node:assert/strict");
const fs       = require("fs");
const path     = require("path");

const registry = require("../../agents/runtime/agentRegistry.cjs");
const toolExec = require("../../backend/services/toolExecutionLayer.cjs");

const P = `tei-${Date.now().toString(36)}`;

describe("toolExecutionLayer — Phase 2 Agent Identity gating", () => {

    it("a call with no opts.agentId is unaffected (pre-existing behavior)", async () => {
        const result = await toolExec.execute("github", "read_repo", {});
        // Not asserting success (no real GitHub token in test env) — only that
        // it is never denied for the NEW reason this change introduces.
        assert.notEqual(result.error, undefined && "agent_not_allowed");
        if (!result.success) assert.ok(!String(result.error).startsWith("agent_not_allowed"));
    });

    it("an agentId not present in agentRegistry is unaffected (fail-open to pre-existing checks)", async () => {
        const result = await toolExec.execute("github", "read_repo", {}, { agentId: "no-such-agent-in-registry" });
        if (!result.success) assert.ok(!String(result.error).startsWith("agent_not_allowed"));
    });

    it("a registered agent with allowedTools NOT including the tool is denied", async () => {
        registry.register({ id: `${P}-restricted`, capabilities: ["cap"], handler: () => ({ success: true }), allowedTools: ["gmail"] });
        const result = await toolExec.execute("github", "read_repo", {}, { agentId: `${P}-restricted` });
        assert.equal(result.success, false);
        assert.match(result.error, /agent_not_allowed/);
    });

    it("a registered agent WITH the tool on its allowlist is not denied by identity (may still fail for other reasons)", async () => {
        registry.register({ id: `${P}-allowed`, capabilities: ["cap"], handler: () => ({ success: true }), allowedTools: ["github"] });
        const result = await toolExec.execute("github", "read_repo", {}, { agentId: `${P}-allowed` });
        if (!result.success) assert.ok(!String(result.error).startsWith("agent_not_allowed"));
    });

    it("a registered agent with no allowedTools (unrestricted) is not denied by identity", async () => {
        registry.register({ id: `${P}-unrestricted`, capabilities: ["cap"], handler: () => ({ success: true }) });
        const result = await toolExec.execute("github", "read_repo", {}, { agentId: `${P}-unrestricted` });
        if (!result.success) assert.ok(!String(result.error).startsWith("agent_not_allowed"));
    });

    it("a retired agent is denied even with an otherwise-unrestricted allowlist", async () => {
        registry.register({ id: `${P}-retired`, capabilities: ["cap"], handler: () => ({ success: true }) });
        registry.setLifecycleState(`${P}-retired`, "retired");
        const result = await toolExec.execute("github", "read_repo", {}, { agentId: `${P}-retired` });
        assert.equal(result.success, false);
        assert.match(result.error, /agent_not_allowed/);
    });

    after(() => {
        // Clean up the isolated test-data files this suite created.
        const suffix = process.env.JARVIS_TEST_DATA_SUFFIX;
        for (const name of ["tool-usage", "tool-permissions", "tool-failures"]) {
            try { fs.unlinkSync(path.join(__dirname, `../../data/${name}.${suffix}.json`)); } catch { /* best effort */ }
        }
    });
});
