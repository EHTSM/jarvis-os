"use strict";
/**
 * Vault Security Hardening — Mandatory Proof 9: Backup/export/git safety.
 *
 * Confirms (against the real repo, not a simulation):
 *   - .env and the entire data/ directory (vault.json, vault-history.json,
 *     vault-access-audit.json, oauth-tokens.json, organizations.json) are
 *     git-ignored.
 *   - No tracked file contains a real-looking secret (sk-..., AKIA...,
 *     PEM private key headers).
 *   - .env.example files are placeholder-only, never real values.
 *   - secretVault.cjs's exportVault()/importVault() require a real
 *     passphrase and produce/consume only PBKDF2+AES-256-GCM encrypted
 *     blobs, never plaintext.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

require("dotenv").config();
const vault = require("../../backend/services/secretVault.cjs");

const REPO_ROOT = path.join(__dirname, "../..");

function _git(cmd) {
    return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

describe("MANDATORY PROOF 9 — Backup/export/git safety", () => {
    it(".env and data/ are genuinely git-ignored (not merely absent from the working tree)", () => {
        const envIgnored = _git("check-ignore -v .env").length > 0;
        assert.ok(envIgnored, ".env must be git-ignored");
        for (const f of ["data/vault.json", "data/vault-history.json", "data/vault-access-audit.json", "data/oauth-tokens.json", "data/organizations.json"]) {
            const ignored = _git(`check-ignore -v ${f}`).length > 0;
            assert.ok(ignored, `${f} must be git-ignored`);
        }
    });

    it("no git-tracked file contains a real-looking secret pattern (sk-*, AKIA*, a PEM private key with genuine base64 body — not a doc placeholder like '...')", () => {
        const trackedFiles = _git("ls-files").split("\n").filter(Boolean);
        // A real PEM body is multi-line base64 (64+ chars between markers); a doc
        // placeholder like "-----BEGIN...-----\n...\n-----END...-----" has no
        // genuine base64 body, so require at least one 40+ char base64-shaped
        // line between the markers to avoid flagging illustrative docs.
        const pemWithBody = /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?\n[A-Za-z0-9+/]{40,}={0,2}\n[\s\S]*?-----END/;
        const apiKeyPattern = /sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}/;
        const hits = [];
        for (const f of trackedFiles) {
            if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|pdf|zip|tar|gz)$/i.test(f)) continue;
            const full = path.join(REPO_ROOT, f);
            let content;
            try { content = fs.readFileSync(full, "utf8"); } catch { continue; }
            if (apiKeyPattern.test(content) || pemWithBody.test(content)) hits.push(f);
        }
        assert.equal(hits.length, 0, `no tracked file may contain a real-looking secret pattern (found in: ${JSON.stringify(hits)}) — if this ever fails, report ONLY the file/category, never print the matched value, and mark ROTATION_REQUIRED`);
    });

    it(".env.example files contain only placeholder values, never a real-looking secret", () => {
        const trackedFiles = _git("ls-files").split("\n").filter(f => /\.env(\..*)?\.example$/.test(f) || f.endsWith(".env.example"));
        assert.ok(trackedFiles.length > 0, "at least one .env.example must exist and be tracked");
        const suspiciousPattern = /sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}/;
        for (const f of trackedFiles) {
            const content = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
            assert.ok(!suspiciousPattern.test(content), `${f} must contain only placeholder values, never a real-looking secret`);
        }
    });

    it("exportVault() requires a real passphrase (min 8 chars) and produces a PBKDF2+AES-256-GCM encrypted blob, never plaintext JSON", () => {
        const connectorId = `test-backup-export-${Date.now()}`;
        vault.storeSecret(connectorId, "api_key", "sk_export_test_value_should_be_encrypted");

        assert.throws(() => vault.exportVault(""), /passphrase/i, "empty passphrase must be rejected");
        assert.throws(() => vault.exportVault("short"), /passphrase/i, "a passphrase under 8 chars must be rejected");

        const blob = vault.exportVault("a-genuinely-long-test-passphrase");
        assert.ok(!blob.includes("sk_export_test_value_should_be_encrypted"), "the exported blob must NEVER contain the plaintext secret value");
        const parsed = JSON.parse(blob);
        assert.equal(parsed.version, 1);
        assert.ok(parsed.salt && parsed.iv && parsed.tag && parsed.data, "export blob must be a real PBKDF2-salted, AES-256-GCM encrypted structure");

        // Wrong passphrase on import must fail closed.
        assert.throws(() => vault.importVault(blob, "wrong-passphrase-entirely"), undefined, "importing with the wrong passphrase must throw, never silently succeed with garbage data");

        vault.deleteSecret(connectorId, "api_key");
    });
});
