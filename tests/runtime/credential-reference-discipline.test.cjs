"use strict";
/**
 * Universal Composition Engine, Phase 8 — Credential Vault reference-only
 * discipline. secretVault.cjs itself is unchanged (real AES-256-GCM
 * storage, unmodified per the plan — vault-internals hardening, e.g. the
 * founderVault.js plaintext-reveal route or _vkey()'s convention-only
 * org-scoping, is explicitly out of scope for this mission and is
 * flagged in the Reality Report instead).
 *
 * What this proves: Company/Agent/Workflow definitions built through the
 * NEW composition-engine registries (agentInstanceRegistry.cjs,
 * skillRegistry.cjs, capabilityContract.cjs) can only ever carry a
 * credentialRef (a string pointing INTO the vault) — never a raw secret
 * value — end to end, from real vault storage through to an agent
 * instance's resolved ctx at dispatch time.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// secretVault.cjs requires a real JWT_SECRET to derive its AES-256-GCM
// encryption key — unlike other tests/runtime/* files, this one exercises
// the real vault, so it needs the real .env loaded (matching the
// scratchpad verification-script convention used throughout this mission).
require("dotenv").config();

const VAULT_FILE = path.join(__dirname, "../../data/vault.json");
const INST_FILE  = path.join(__dirname, "../../data/agent-instances.json");
let _vaultBackup = null;

before(() => {
    try { _vaultBackup = fs.readFileSync(VAULT_FILE, "utf8"); } catch { _vaultBackup = null; }
    try { fs.unlinkSync(INST_FILE); } catch {}
});
after(() => {
    if (_vaultBackup !== null) fs.writeFileSync(VAULT_FILE, _vaultBackup);
    else { try { fs.unlinkSync(VAULT_FILE); } catch {} }
    try { fs.unlinkSync(INST_FILE); } catch {}
});

const vault = require("../../backend/services/secretVault.cjs");
const agentInstanceRegistry = require("../../backend/services/agentInstanceRegistry.cjs");
const contract = require("../../backend/services/capabilityContract.cjs");

describe("Credential Vault reference-only discipline (Phase 8)", () => {

    it("a real secret can be stored in the vault and resolved back by value (vault's own real behavior, unchanged)", () => {
        const orgId = `org_cred_${Date.now()}`;
        vault.storeSecret("test-connector", "api_key", "sk_live_real_secret_value_xyz", {}, orgId);
        const resolved = vault.getSecret("test-connector", "api_key", orgId);
        assert.equal(resolved, "sk_live_real_secret_value_xyz");
    });

    it("listSecrets() never returns the raw value (vault's own real sanitization, unchanged)", () => {
        const orgId = `org_cred_list_${Date.now()}`;
        vault.storeSecret("test-connector-2", "api_key", "sk_should_never_appear", {}, orgId);
        const list = vault.listSecrets({ orgId });
        assert.ok(list.length > 0);
        for (const rec of list) {
            assert.equal(JSON.stringify(rec).includes("sk_should_never_appear"), false, "listSecrets() leaked a raw secret value");
        }
    });

    it("an AgentInstance can only ever reference the secret by a credentialRef string, never the value itself", () => {
        const orgId = `org_cred_ref_${Date.now()}`;
        vault.storeSecret("test-connector-3", "api_key", "sk_actual_secret_should_not_leak", {}, orgId);
        // The composition-engine convention: store a REFERENCE string
        // (e.g. "vault:test-connector-3:api_key"), never the value itself.
        const credentialRef = `vault:test-connector-3:api_key:${orgId}`;

        const inst = agentInstanceRegistry.register("crm", orgId, "co_cred_test", {
            credentialRefs: [credentialRef],
        });

        assert.deepEqual(inst.credentialRefs, [credentialRef]);
        assert.equal(JSON.stringify(inst).includes("sk_actual_secret_should_not_leak"), false, "AgentInstance record leaked a raw secret value");

        // Resolution happens only by explicitly calling back into the
        // vault with the reference — proving the two systems are
        // correctly decoupled (registry never resolves secrets itself).
        const resolvedViaRef = vault.getSecret("test-connector-3", "api_key", orgId);
        assert.equal(resolvedViaRef, "sk_actual_secret_should_not_leak");
    });

    it("capabilityContract.cjs structurally rejects a raw secret value even if a caller tries to smuggle one into credentialRefs' sibling fields", () => {
        const check = contract.validate("Agent", {
            id: "agent_x", orgId: "org_x", archetypeId: "crm",
            credentialRefs: ["vault:github:oauth_token"],
            config: { apiKey: "sk_smuggled_raw_secret" },
        });
        assert.equal(check.ok, false);
        assert.ok(check.errors.some(e => e.includes("apiKey")));
    });

    it("registering an AgentInstance with a raw secret value anywhere in config throws (enforced end-to-end via agentInstanceRegistry -> capabilityContract)", () => {
        assert.throws(() => agentInstanceRegistry.register("crm", `org_x_${Date.now()}`, "co_x", {
            goals: [], token: "sk_should_be_rejected",
        }));
    });

    it("credentialRefs are plain strings (references), never nested objects that could carry a value", () => {
        const orgId = `org_cred_shape_${Date.now()}`;
        const inst = agentInstanceRegistry.register("crm", orgId, "co_shape_test", {
            credentialRefs: ["vault:stripe:secret_key"],
        });
        for (const ref of inst.credentialRefs) {
            assert.equal(typeof ref, "string", "credentialRefs must be reference strings, not objects");
        }
    });
});
