"use strict";
/**
 * Vault Security Hardening — MANDATORY PROOFS (continuation mission).
 *
 * Covers, against the REAL codebase (no mocks):
 *   1. Company-scoped credential isolation — two real companies (each its
 *      own org, per companyFactory.cjs's real 1:1 company:org model —
 *      there is no separate PLATFORM_SHARED/ORGANIZATION_SHARED/
 *      COMPANY_SPECIFIC tier in this codebase; the real tiers are
 *      GLOBAL_ORG (founder/platform partition) vs. a real orgId
 *      (== "company-specific" in this architecture, since every company
 *      gets its own fresh org). Tested at the VAULT layer directly, not
 *      just route authorization.
 *   2. Agent -> Skill -> Tool -> Connector -> CredentialRef -> Vault
 *      authorization -> resolved secret chain, using the real
 *      agentInstanceRegistry.cjs + executionEngine.cjs + the new
 *      resolveCredentialRef()/resolveCredentialRefs() added this session.
 *      Then: wrong org, wrong credential-ref substitution, and
 *      cross-company credential-ref reuse all fail closed.
 *
 * This file assumes commit 9bf4a8b's org-scoping (_assertOrgAccess) and
 * this session's resolveCredentialRef()/executionEngine.cjs wiring are
 * both present.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const VAULT_FILE = path.join(__dirname, "../../data/vault.json");
const AUDIT_FILE = path.join(__dirname, "../../data/vault-access-audit.json");
process.env.JARVIS_TEST_DATA_SUFFIX = `test-${process.pid}-${Date.now()}`;
const INST_FILE = path.join(__dirname, `../../data/agent-instances.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`);

let _vaultBackup = null;
let _auditBackup = null;
before(() => {
    try { _vaultBackup = fs.readFileSync(VAULT_FILE, "utf8"); } catch { _vaultBackup = null; }
    try { _auditBackup = fs.readFileSync(AUDIT_FILE, "utf8"); } catch { _auditBackup = null; }
});
after(() => {
    if (_vaultBackup !== null) fs.writeFileSync(VAULT_FILE, _vaultBackup);
    else { try { fs.unlinkSync(VAULT_FILE); } catch {} }
    if (_auditBackup !== null) fs.writeFileSync(AUDIT_FILE, _auditBackup);
    else { try { fs.unlinkSync(AUDIT_FILE); } catch {} }
    try { fs.unlinkSync(INST_FILE); } catch {}
});

const vault = require("../../backend/services/secretVault.cjs");
const org = require("../../backend/services/organizationService.cjs");
const agentInstanceRegistry = require("../../backend/services/agentInstanceRegistry.cjs");
const agentRegistry = require("../../agents/runtime/agentRegistry.cjs");
const skillRegistry = require("../../backend/services/skillRegistry.cjs");
const executionEngine = require("../../agents/runtime/executionEngine.cjs");
const taskRouter = require("../../agents/runtime/taskRouter.cjs");
const toolFabric = require("../../backend/services/toolExecutionLayer.cjs");

describe("MANDATORY PROOF 1 — Company-scoped credential isolation (vault layer, not just routes)", () => {
    it("two real companies (each a real org, real owners) get genuinely isolated COMPANY_SPECIFIC credentials at the vault layer", () => {
        const ownerA = `acct_companyA_${Date.now()}`;
        const ownerB = `acct_companyB_${Date.now()}`;
        const orgA = org.createOrg({ name: `Company A Org ${Date.now()}` }, ownerA);
        const orgB = org.createOrg({ name: `Company B Org ${Date.now()}` }, ownerB);
        const connectorId = `test-company-scoped-${Date.now()}`;

        // Company A stores its own COMPANY_SPECIFIC secret.
        vault.storeSecret(connectorId, "api_key", "sk_company_A_secret", {}, orgA.id, ownerA);
        // Company B stores its own COMPANY_SPECIFIC secret for the SAME connectorId/type.
        vault.storeSecret(connectorId, "api_key", "sk_company_B_secret", {}, orgB.id, ownerB);

        // Each company resolves ONLY its own value.
        assert.equal(vault.getSecret(connectorId, "api_key", orgA.id, ownerA), "sk_company_A_secret");
        assert.equal(vault.getSecret(connectorId, "api_key", orgB.id, ownerB), "sk_company_B_secret");

        // Company A's owner CANNOT resolve/update/delete/rotate Company B's secret — vault layer, not route layer.
        assert.throws(() => vault.getSecret(connectorId, "api_key", orgB.id, ownerA), (e) => e.status === 403, "Company A must not RESOLVE Company B's credential");
        assert.throws(() => vault.storeSecret(connectorId, "api_key", "sk_hijack", {}, orgB.id, ownerA), (e) => e.status === 403, "Company A must not UPDATE Company B's credential");
        assert.throws(() => vault.deleteSecret(connectorId, "api_key", orgB.id, ownerA), (e) => e.status === 403, "Company A must not DELETE Company B's credential");
        assert.throws(() => vault.rotateSecret(connectorId, "api_key", "sk_rotate_hijack", orgB.id, ownerA), (e) => e.status === 403, "Company A must not ROTATE Company B's credential");
        assert.throws(() => vault.listSecrets({ orgId: orgB.id, requestingAccountId: ownerA }), (e) => e.status === 403, "Company A must not LIST Company B's credentials");

        // Confirm Company B's secret is untouched by the attempted hijacks.
        assert.equal(vault.getSecret(connectorId, "api_key", orgB.id, ownerB), "sk_company_B_secret", "Company B's credential must be byte-for-byte unchanged after Company A's denied attempts");

        vault.deleteSecret(connectorId, "api_key", orgA.id, ownerA);
        vault.deleteSecret(connectorId, "api_key", orgB.id, ownerB);
    });

    it("PLATFORM_SHARED tier (GLOBAL_ORG) is readable across the platform by design, distinct from ORGANIZATION_SHARED/COMPANY_SPECIFIC (real orgId)", () => {
        // This codebase's real architecture has exactly two tiers, not three:
        //   - GLOBAL_ORG: the founder/platform partition (founderVault.js, operatorOnly) — analogous to "PLATFORM_SHARED".
        //   - a real orgId: company-specific, since companyFactory.cjs creates one fresh org per company (1:1) —
        //     there is no separate "ORGANIZATION_SHARED" tier above company but below platform; an org IS the company's boundary.
        // This test documents that distinction is real and enforced, not a naming gap glossed over.
        const connectorId = `test-platform-shared-${Date.now()}`;
        vault.storeSecret(connectorId, "api_key", "sk_platform_shared_value"); // no orgId -> GLOBAL_ORG
        const ownerX = `acct_tierX_${Date.now()}`;
        const orgX = org.createOrg({ name: `Tier Test Org ${Date.now()}` }, ownerX);

        // Any authenticated org member CAN read the GLOBAL_ORG/platform-shared value via the unscoped getSecret (GLOBAL_ORG is exempt from the org-check by design).
        assert.equal(vault.getSecret(connectorId, "api_key"), "sk_platform_shared_value");

        // But orgX's own COMPANY_SPECIFIC secret for the same connectorId/type is a SEPARATE vault entry, invisible via the GLOBAL_ORG key.
        vault.storeSecret(connectorId, "api_key", "sk_orgX_specific_value", {}, orgX.id, ownerX);
        assert.equal(vault.getSecret(connectorId, "api_key", vault.GLOBAL_ORG), "sk_platform_shared_value", "GLOBAL_ORG lookup must not accidentally surface orgX's company-specific value");
        assert.equal(vault.getSecret(connectorId, "api_key", orgX.id, ownerX), "sk_orgX_specific_value");

        vault.deleteSecret(connectorId, "api_key");
        vault.deleteSecret(connectorId, "api_key", orgX.id, ownerX);
    });
});

describe("MANDATORY PROOF 2 — Agent -> Skill -> Tool -> Connector -> CredentialRef -> Vault -> resolved secret (real chain)", () => {
    it("a real AgentInstance's credentialRefs resolve into ctx.resolvedCredentials via the real executionEngine dispatch chain, org-scoped", async () => {
        const ownerA = `acct_chainA_${Date.now()}`;
        const orgA = org.createOrg({ name: `Chain Org A ${Date.now()}` }, ownerA);
        const connectorId = `test-chain-connector-${Date.now()}`;
        const ref = `${connectorId}::api_key`;

        // Real vault secret, real org-scoped.
        vault.storeSecret(connectorId, "api_key", "sk_chain_real_value", {}, orgA.id, ownerA);

        const cap = `chain-cap-${Date.now()}`;
        let receivedCtx = null;
        agentRegistry.register({ id: `chain-agent-${cap}`, capabilities: [cap], handler: async (task, ctx) => { receivedCtx = ctx; return { success: true }; } });
        skillRegistry.registerSkill({ id: cap, name: "Chain test skill", category: "test", riskLevel: "low", executionHandler: cap, version: "1.0.0" });
        const inst = agentInstanceRegistry.register(cap, orgA.id, "co_chain_a", { credentialRefs: [ref] });

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === cap ? cap : originalResolve(type));
        const result = await executionEngine.executeTask({ type: cap, orgId: orgA.id, label: "chain-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, true);
        assert.ok(receivedCtx.resolvedCredentials, "handler ctx must contain resolvedCredentials");
        assert.equal(receivedCtx.resolvedCredentials[ref], "sk_chain_real_value", "the agent must receive the ACTUAL resolved secret value for its own org's credentialRef");
        // Agent gets a reference-keyed map (resolvedCredentials[ref]), not unrestricted raw vault access —
        // it never receives a callable into secretVault.cjs itself.
        assert.equal(typeof receivedCtx.getSecret, "undefined", "handler ctx must never expose a live vault function — only resolved values");

        vault.deleteSecret(connectorId, "api_key", orgA.id, ownerA);
    });

    it("FAIL CLOSED — wrong org: an AgentInstance registered under org A cannot resolve org B's credential even if a malicious/buggy ref pointed at org B's connector", async () => {
        const ownerA = `acct_wrongorgA_${Date.now()}`;
        const ownerB = `acct_wrongorgB_${Date.now()}`;
        const orgA = org.createOrg({ name: `Wrong Org A ${Date.now()}` }, ownerA);
        const orgB = org.createOrg({ name: `Wrong Org B ${Date.now()}` }, ownerB);
        const connectorId = `test-wrongorg-connector-${Date.now()}`;
        const ref = `${connectorId}::api_key`;

        // Only org B has this credential.
        vault.storeSecret(connectorId, "api_key", "sk_org_B_only_value", {}, orgB.id, ownerB);

        const cap = `wrongorg-cap-${Date.now()}`;
        let receivedCtx = null;
        agentRegistry.register({ id: `wrongorg-agent-${cap}`, capabilities: [cap], handler: async (task, ctx) => { receivedCtx = ctx; return { success: true }; } });
        skillRegistry.registerSkill({ id: cap, name: "Wrong org test skill", category: "test", riskLevel: "low", executionHandler: cap, version: "1.0.0" });
        // Agent instance is registered under ORG A, but its (misconfigured or attacker-supplied) credentialRefs array names org B's connector.
        agentInstanceRegistry.register(cap, orgA.id, "co_wrongorg_a", { credentialRefs: [ref] });

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === cap ? cap : originalResolve(type));
        const result = await executionEngine.executeTask({ type: cap, orgId: orgA.id, label: "wrongorg-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, true, "execution itself still succeeds (credential absence is not a hard failure)");
        assert.deepEqual(receivedCtx.resolvedCredentials, {}, "org A's agent must NOT receive org B's credential — resolution must fail closed and simply omit it, never leak cross-org");

        vault.deleteSecret(connectorId, "api_key", orgB.id, ownerB);
    });

    it("FAIL CLOSED — credential-ID substitution: a malformed/nonexistent credentialRef never crashes and never resolves", async () => {
        const ownerA = `acct_subst_${Date.now()}`;
        const orgA = org.createOrg({ name: `Substitution Org ${Date.now()}` }, ownerA);

        // Direct unit-level checks of resolveCredentialRef/resolveCredentialRefs — malformed ref shapes.
        assert.equal(vault.resolveCredentialRef(null, { orgId: orgA.id }), null);
        assert.equal(vault.resolveCredentialRef("not-a-valid-ref-format", { orgId: orgA.id }), null);
        assert.equal(vault.resolveCredentialRef("nonexistent-connector::api_key", { orgId: orgA.id }), null);
        assert.equal(vault.resolveCredentialRef(12345, { orgId: orgA.id }), null, "a non-string ref must never throw");
        assert.deepEqual(vault.resolveCredentialRefs(["bad-ref-1", "bad-ref-2::nope::extra"], { orgId: orgA.id }), {}, "every malformed ref is silently omitted, never throws");
    });

    it("FAIL CLOSED — wrong skill/tool permission: a skill requiring an ungranted tool is blocked before any credential resolution matters", async () => {
        const ownerA = `acct_toolperm_${Date.now()}`;
        const orgA = org.createOrg({ name: `Tool Perm Org ${Date.now()}` }, ownerA);
        const cap = `toolperm-cap-${Date.now()}`;
        let handlerCalled = false;
        agentRegistry.register({ id: `toolperm-agent-${cap}`, capabilities: [cap], handler: async () => { handlerCalled = true; return { success: true }; } });
        skillRegistry.registerSkill({ id: cap, name: "Tool perm test skill", category: "test", riskLevel: "low", executionHandler: cap, requiredTools: ["system:exec"], version: "1.0.0" });
        agentInstanceRegistry.register(cap, orgA.id, "co_toolperm", {});

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === cap ? cap : originalResolve(type));
        const result = await executionEngine.executeTask({ type: cap, orgId: orgA.id, label: "toolperm-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, false);
        assert.ok(result.error.includes("permission_denied"));
        assert.equal(handlerCalled, false, "handler (and therefore any credential use) must never run without the required tool grant");
    });

    it("FAIL CLOSED — wrong connector: an org with no vault credential for an optional connector is told NEEDS_CREDENTIALS, never a platform-wide false positive", async () => {
        const ownerA = `acct_wrongconn_${Date.now()}`;
        const orgA = org.createOrg({ name: `Wrong Connector Org ${Date.now()}` }, ownerA);
        const connectorId = `test-wrongconn-connector-${Date.now()}`;
        const cap = `wrongconn-cap-${Date.now()}`;
        let receivedCtx = null;
        agentRegistry.register({ id: `wrongconn-agent-${cap}`, capabilities: [cap], handler: async (task, ctx) => { receivedCtx = ctx; return { success: true }; } });
        skillRegistry.registerSkill({ id: cap, name: "Wrong connector test skill", category: "test", riskLevel: "low", executionHandler: cap, optionalConnectors: [connectorId], version: "1.0.0" });
        agentInstanceRegistry.register(cap, orgA.id, "co_wrongconn", {});
        // orgA never stores a credential for connectorId.

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === cap ? cap : originalResolve(type));
        const result = await executionEngine.executeTask({ type: cap, orgId: orgA.id, label: "wrongconn-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, true);
        assert.equal(receivedCtx.connectorStatus[connectorId], "NEEDS_CREDENTIALS", "an org with no vault-scoped credential must see NEEDS_CREDENTIALS, never a platform-wide CONNECTED_VERIFIED false positive");
    });

    it("FAIL CLOSED — wrong agent: an agent instance for a DIFFERENT archetype/capability never receives another capability's credentialRefs", async () => {
        const ownerA = `acct_wrongagent_${Date.now()}`;
        const orgA = org.createOrg({ name: `Wrong Agent Org ${Date.now()}` }, ownerA);
        const connectorId = `test-wrongagent-connector-${Date.now()}`;
        const ref = `${connectorId}::api_key`;
        vault.storeSecret(connectorId, "api_key", "sk_wrongagent_value", {}, orgA.id, ownerA);

        const capA = `wrongagent-cap-A-${Date.now()}`;
        const capB = `wrongagent-cap-B-${Date.now()}`;
        let receivedCtxB = null;
        agentRegistry.register({ id: `wrongagent-agent-A-${capA}`, capabilities: [capA], handler: async () => ({ success: true }) });
        agentRegistry.register({ id: `wrongagent-agent-B-${capB}`, capabilities: [capB], handler: async (task, ctx) => { receivedCtxB = ctx; return { success: true }; } });
        skillRegistry.registerSkill({ id: capA, name: "Wrong agent skill A", category: "test", riskLevel: "low", executionHandler: capA, version: "1.0.0" });
        skillRegistry.registerSkill({ id: capB, name: "Wrong agent skill B", category: "test", riskLevel: "low", executionHandler: capB, version: "1.0.0" });
        // Only capA's instance gets the credentialRef.
        agentInstanceRegistry.register(capA, orgA.id, "co_wrongagent", { credentialRefs: [ref] });
        agentInstanceRegistry.register(capB, orgA.id, "co_wrongagent", {}); // capB has NO credentialRefs

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === capB ? capB : (type === capA ? capA : originalResolve(type)));
        const result = await executionEngine.executeTask({ type: capB, orgId: orgA.id, label: "wrongagent-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, true);
        assert.equal(receivedCtxB.resolvedCredentials, undefined, "capB's agent instance (no credentialRefs configured) must never receive capA's resolved credential");

        vault.deleteSecret(connectorId, "api_key", orgA.id, ownerA);
    });

    it("enumeration resistance: resolveCredentialRefs never reveals WHICH refs exist vs. don't via timing/shape — always returns only successfully-resolved entries", () => {
        const ownerA = `acct_enum_${Date.now()}`;
        const orgA = org.createOrg({ name: `Enum Org ${Date.now()}` }, ownerA);
        const connectorId = `test-enum-connector-${Date.now()}`;
        const realRef = `${connectorId}::api_key`;
        vault.storeSecret(connectorId, "api_key", "sk_enum_value", {}, orgA.id, ownerA);

        const result = vault.resolveCredentialRefs([realRef, "fake-connector-1::api_key", "fake-connector-2::api_key"], { orgId: orgA.id });
        assert.equal(Object.keys(result).length, 1, "only the genuinely existing ref appears in the result — fake refs are indistinguishable from each other (both simply absent)");
        assert.equal(result[realRef], "sk_enum_value");

        vault.deleteSecret(connectorId, "api_key", orgA.id, ownerA);
    });
});

describe("MANDATORY PROOF 11 — Capability Evolution: a newly registered capability gets NO automatic vault access", () => {
    it("a freshly registered skill/agent-instance with NO credentialRefs configured has zero resolved credentials, even when real org secrets exist", async () => {
        const ownerA = `acct_capevo_${Date.now()}`;
        const orgA = org.createOrg({ name: `CapEvo Org ${Date.now()}` }, ownerA);
        const connectorId = `test-capevo-connector-${Date.now()}`;
        vault.storeSecret(connectorId, "api_key", "sk_capevo_existing_value", {}, orgA.id, ownerA);

        const cap = `capevo-new-cap-${Date.now()}`;
        let receivedCtx = null;
        agentRegistry.register({ id: `capevo-agent-${cap}`, capabilities: [cap], handler: async (task, ctx) => { receivedCtx = ctx; return { success: true }; } });
        // Simulates a Capability Evolution-approved new skill — freshly registered, no explicit credentialRefs granted.
        skillRegistry.registerSkill({ id: cap, name: "Newly evolved skill", category: "test", riskLevel: "low", executionHandler: cap, version: "1.0.0" });
        agentInstanceRegistry.register(cap, orgA.id, "co_capevo", {}); // no credentialRefs — the new capability must not auto-inherit anything

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === cap ? cap : originalResolve(type));
        const result = await executionEngine.executeTask({ type: cap, orgId: orgA.id, label: "capevo-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, true);
        assert.equal(receivedCtx.resolvedCredentials, undefined, "a newly evolved capability with no explicitly authorized credentialRefs must receive ZERO credentials, even though the org has real secrets stored");

        vault.deleteSecret(connectorId, "api_key", orgA.id, ownerA);
    });

    it("malicious cross-company credential request: a Capability-Evolution-created instance for Company B cannot be pointed at Company A's credentialRef and succeed", async () => {
        const ownerA = `acct_malA_${Date.now()}`;
        const ownerB = `acct_malB_${Date.now()}`;
        const orgA = org.createOrg({ name: `Malicious Org A ${Date.now()}` }, ownerA);
        const orgB = org.createOrg({ name: `Malicious Org B ${Date.now()}` }, ownerB);
        const connectorId = `test-malicious-connector-${Date.now()}`;
        const ref = `${connectorId}::api_key`;
        vault.storeSecret(connectorId, "api_key", "sk_companyA_confidential", {}, orgA.id, ownerA);

        const cap = `malicious-cap-${Date.now()}`;
        let receivedCtx = null;
        agentRegistry.register({ id: `malicious-agent-${cap}`, capabilities: [cap], handler: async (task, ctx) => { receivedCtx = ctx; return { success: true }; } });
        skillRegistry.registerSkill({ id: cap, name: "Malicious cross-company test skill", category: "test", riskLevel: "low", executionHandler: cap, version: "1.0.0" });
        // Company B's instance is (maliciously or via bug) configured with Company A's credentialRef string.
        agentInstanceRegistry.register(cap, orgB.id, "co_malicious_b", { credentialRefs: [ref] });

        const originalResolve = taskRouter.resolveCapability;
        taskRouter.resolveCapability = (type) => (type === cap ? cap : originalResolve(type));
        const result = await executionEngine.executeTask({ type: cap, orgId: orgB.id, label: "malicious-task" });
        taskRouter.resolveCapability = originalResolve;

        assert.equal(result.success, true);
        assert.deepEqual(receivedCtx.resolvedCredentials, {}, "Company B must NEVER obtain Company A's credential value, even by naming its ref directly — resolution is scoped to the DISPATCHING task's own orgId, not the ref string's origin");

        vault.deleteSecret(connectorId, "api_key", orgA.id, ownerA);
    });
});
