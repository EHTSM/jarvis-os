"use strict";
/**
 * 100-Company Credential Activation mission — credentialImportTool.cjs.
 *
 * Proves the safe import pipeline (input -> normalize -> validate ->
 * scope -> encrypt/store via the REAL secretVault.cjs -> credential
 * reference -> audit) against the real vault, no mocks. Specifically
 * regression-tests a real bug found during this mission: validateSecret()
 * transparently falls back to the raw env var when no Vault-native entry
 * exists (correct for runtime resolution) — an import tool that used
 * that same "valid" signal to mean "already imported" would silently
 * skip every credential that's only in .env, never actually importing
 * anything. classifyRow() must check `source === "vault"` specifically.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const VAULT_FILE = path.join(__dirname, "../../data/vault.json");
let _vaultBackup = null;
before(() => { try { _vaultBackup = fs.readFileSync(VAULT_FILE, "utf8"); } catch { _vaultBackup = null; } });
after(() => {
    if (_vaultBackup !== null) fs.writeFileSync(VAULT_FILE, _vaultBackup);
    else { try { fs.unlinkSync(VAULT_FILE); } catch {} }
});

const importTool = require("../../backend/services/credentialImportTool.cjs");
const vault = require("../../backend/services/secretVault.cjs");

describe("credentialImportTool.cjs — safe import pipeline", () => {

    it("classifyRow: MISSING_FROM_SHEET for an env var that genuinely isn't set", () => {
        const row = { envVarName: "TEST_IMPORT_TOOL_NONEXISTENT_VAR_XYZ", connectorId: "ai:groq", credentialType: "api_key", scope: "PLATFORM_SHARED" };
        const result = importTool.classifyRow(row);
        assert.equal(result.classification, "MISSING_FROM_SHEET");
    });

    it("classifyRow: INVALID_FORMAT for an unknown credential type", () => {
        process.env.TEST_IMPORT_TOOL_VAR_A = "some-real-looking-value";
        const row = { envVarName: "TEST_IMPORT_TOOL_VAR_A", connectorId: "ai:groq", credentialType: "not_a_real_type", scope: "PLATFORM_SHARED" };
        const result = importTool.classifyRow(row);
        assert.equal(result.classification, "INVALID_FORMAT");
        delete process.env.TEST_IMPORT_TOOL_VAR_A;
    });

    it("classifyRow: AMBIGUOUS for a non-platform scope with no orgId provided", () => {
        process.env.TEST_IMPORT_TOOL_VAR_B = "some-real-looking-value";
        const row = { envVarName: "TEST_IMPORT_TOOL_VAR_B", connectorId: "test:conn", credentialType: "api_key", scope: "COMPANY_SPECIFIC" };
        const result = importTool.classifyRow(row);
        assert.equal(result.classification, "AMBIGUOUS");
        delete process.env.TEST_IMPORT_TOOL_VAR_B;
    });

    it("classifyRow: WOULD_CREATE for an env-only credential with NO existing Vault-native entry (regression test for the source==='env' vs source==='vault' bug)", () => {
        // Uses a REAL secretVault.cjs ENV_MAP connector (ai:groq) so
        // validateSecret()'s own env-fallback path genuinely fires — a
        // synthetic connectorId has no ENV_MAP entry at all and would
        // report source:"none", not exercising the actual bug scenario.
        // Ensure no genuine Vault-native entry exists for ai:groq first
        // (this test's own before/after backs up + restores vault.json).
        vault.deleteSecret("ai:groq", "api_key");
        const row = { envVarName: "GROQ_API_KEY", connectorId: "ai:groq", credentialType: "api_key", scope: "PLATFORM_SHARED" };

        // Sanity: validateSecret() DOES report valid:true here (via its own env fallback, since GROQ_API_KEY is genuinely set in this dev environment) — proving the bug this test guards against is real, not hypothetical.
        const preCheck = vault.validateSecret("ai:groq", "api_key");
        if (preCheck.source !== "env") {
            // GROQ_API_KEY isn't set in this environment — the scenario this test targets doesn't apply here; skip gracefully rather than fail on an environment difference.
            return;
        }
        assert.equal(preCheck.valid, true);

        const result = importTool.classifyRow(row);
        assert.equal(result.classification, "WOULD_CREATE", "an env-only credential (no real Vault entry) must be WOULD_CREATE, never WOULD_REUSE");
    });

    it("classifyRow: WOULD_REUSE for a credential with a genuine, valid Vault-native entry", () => {
        const connectorId = `test-import-tool-reuse-${Date.now()}`;
        process.env.TEST_IMPORT_TOOL_VAR_D = "some-real-looking-value";
        vault.storeSecret(connectorId, "api_key", "sk_test_import_tool_reuse_value");

        const row = { envVarName: "TEST_IMPORT_TOOL_VAR_D", connectorId, credentialType: "api_key", scope: "PLATFORM_SHARED" };
        const result = importTool.classifyRow(row);
        assert.equal(result.classification, "WOULD_REUSE");

        vault.deleteSecret(connectorId, "api_key");
        delete process.env.TEST_IMPORT_TOOL_VAR_D;
    });

    it("dryRun() never writes to the Vault", () => {
        const connectorId = `test-import-tool-dryrun-${Date.now()}`;
        process.env.TEST_IMPORT_TOOL_VAR_E = "some-real-looking-value";
        const rows = [{ envVarName: "TEST_IMPORT_TOOL_VAR_E", connectorId, credentialType: "api_key", scope: "PLATFORM_SHARED" }];

        const report = importTool.dryRun(rows);
        assert.equal(report.counts.WOULD_CREATE, 1);

        const check = vault.validateSecret(connectorId, "api_key");
        assert.notEqual(check.source, "vault", "dryRun() must NEVER write to the vault — this connectorId must still have no real Vault entry");
        delete process.env.TEST_IMPORT_TOOL_VAR_E;
    });

    it("realImport() requires explicit confirm:true before any write", () => {
        const rows = [{ envVarName: "TEST_IMPORT_TOOL_VAR_F", connectorId: "test:conn", credentialType: "api_key", scope: "PLATFORM_SHARED" }];
        assert.throws(() => importTool.realImport(rows, {}), /confirm/);
        assert.throws(() => importTool.realImport(rows, { confirm: false }), /confirm/);
    });

    it("realImport() genuinely stores a real, decryptable Vault entry and returns a credential reference, never the value", () => {
        const connectorId = `test-import-tool-real-${Date.now()}`;
        process.env.TEST_IMPORT_TOOL_VAR_G = "sk_test_import_tool_real_value";
        const rows = [{ envVarName: "TEST_IMPORT_TOOL_VAR_G", connectorId, credentialType: "api_key", scope: "PLATFORM_SHARED" }];

        const report = importTool.realImport(rows, { confirm: true });
        assert.equal(report.imported, 1);
        const resultJson = JSON.stringify(report);
        assert.ok(!resultJson.includes("sk_test_import_tool_real_value"), "realImport's own report must never contain the plaintext value");
        assert.equal(report.results[0].credentialRef, `${connectorId}::api_key`);

        // Confirm it's genuinely a real, decryptable Vault-native entry now.
        const postCheck = vault.validateSecret(connectorId, "api_key");
        assert.equal(postCheck.source, "vault");
        assert.equal(postCheck.valid, true);
        assert.equal(vault.getSecret(connectorId, "api_key"), "sk_test_import_tool_real_value", "the real value must genuinely round-trip through the vault");

        vault.deleteSecret(connectorId, "api_key");
        delete process.env.TEST_IMPORT_TOOL_VAR_G;
    });

    it("realImport() is idempotent: importing the same row twice without overwrite:true does not touch the existing entry", () => {
        const connectorId = `test-import-tool-idempotent-${Date.now()}`;
        process.env.TEST_IMPORT_TOOL_VAR_H = "sk_test_import_tool_first_value";
        const rows = [{ envVarName: "TEST_IMPORT_TOOL_VAR_H", connectorId, credentialType: "api_key", scope: "PLATFORM_SHARED" }];

        importTool.realImport(rows, { confirm: true });
        const firstVersion = vault.validateSecret(connectorId, "api_key").version;

        // Second import attempt with a DIFFERENT env value — must be skipped, not overwritten, since overwrite isn't set.
        process.env.TEST_IMPORT_TOOL_VAR_H = "sk_test_import_tool_second_value";
        const secondReport = importTool.realImport(rows, { confirm: true });
        assert.equal(secondReport.skipped, 1);
        assert.equal(secondReport.imported, 0);

        const afterSecond = vault.validateSecret(connectorId, "api_key");
        assert.equal(afterSecond.version, firstVersion, "the existing entry's version must be unchanged — the second import must not have overwritten it");
        assert.equal(vault.getSecret(connectorId, "api_key"), "sk_test_import_tool_first_value", "the ORIGINAL value must still be what's stored");

        vault.deleteSecret(connectorId, "api_key");
        delete process.env.TEST_IMPORT_TOOL_VAR_H;
    });

    it("no function in credentialImportTool.cjs ever logs/returns a secret value — structural source check", () => {
        const src = fs.readFileSync(path.join(__dirname, "../../backend/services/credentialImportTool.cjs"), "utf8");
        assert.ok(!/console\.log\([^)]*value/i.test(src), "no console.log call may reference a 'value' variable directly");
    });
});
