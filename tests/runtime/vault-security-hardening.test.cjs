"use strict";
/**
 * Vault Security Hardening — org-scoping enforcement + access audit log.
 *
 * Closes the two gaps flagged in
 * docs/audits/UNIVERSAL-COMPOSITION-ENGINE-REALITY.md as "unfixed by
 * design... explicitly out of scope":
 *   1. secretVault.cjs's _vkey() org-scoping was convention-only — no
 *      caller-identity check inside the vault itself.
 *   2. founderVault.js's plaintext-reveal route had no real audit trail.
 *
 * This proves, against the REAL vault and REAL organizationService (no
 * mocks): a caller passing a different org's orgId is genuinely denied via
 * organizationService.hasPermission(); omitting requestingAccountId (every
 * pre-existing caller) preserves prior behavior exactly; and a successful
 * reveal is genuinely recorded in the access audit log.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// secretVault.cjs requires a real JWT_SECRET to derive its AES-256-GCM key —
// matches the convention in credential-reference-discipline.test.cjs.
require("dotenv").config();

const VAULT_FILE = path.join(__dirname, "../../data/vault.json");
const AUDIT_FILE = path.join(__dirname, "../../data/vault-access-audit.json");
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
});

const vault = require("../../backend/services/secretVault.cjs");
const org = require("../../backend/services/organizationService.cjs");

describe("Vault Security Hardening — org-scoping enforcement (_assertOrgAccess)", () => {

    it("backward compatibility: omitting requestingAccountId preserves existing behavior exactly (no check performed)", () => {
        const orgId = `org_vsh_compat_${Date.now()}`;
        const rec = vault.storeSecret("test-connector-vsh", "api_key", "sk_compat_value", {}, orgId);
        assert.ok(rec, "storeSecret with no requestingAccountId still succeeds, unchanged");
        const resolved = vault.getSecret("test-connector-vsh", "api_key", orgId);
        assert.equal(resolved, "sk_compat_value");
        const list = vault.listSecrets({ orgId });
        assert.equal(list.length, 1);
        assert.equal(vault.deleteSecret("test-connector-vsh", "api_key", orgId), true);
    });

    it("GLOBAL_ORG is exempt from the org-check even when requestingAccountId is passed (founder/operator partition)", () => {
        const rec = vault.storeSecret("test-connector-vsh-global", "api_key", "sk_global_value", {}, vault.GLOBAL_ORG, "some_random_account");
        assert.ok(rec, "GLOBAL_ORG storage succeeds regardless of requestingAccountId — not a multi-tenant org");
        vault.deleteSecret("test-connector-vsh-global", "api_key", vault.GLOBAL_ORG, "some_random_account");
    });

    it("a genuine org member with manage_billing (org_owner) can store/reveal/rotate/delete their own org's secret", () => {
        const owner = `acct_vsh_owner_${Date.now()}`;
        const created = org.createOrg({ name: `VSH Test Org ${Date.now()}` }, owner);
        const orgId = created.id;

        const stored = vault.storeSecret("test-connector-vsh-owner", "api_key", "sk_owner_value", {}, orgId, owner);
        assert.ok(stored, "org_owner is genuinely authorized to store a secret for their own org");

        const revealed = vault.getSecret("test-connector-vsh-owner", "api_key", orgId, owner, { reason: "test verification" });
        assert.equal(revealed, "sk_owner_value");

        const rotated = vault.rotateSecret("test-connector-vsh-owner", "api_key", "sk_owner_value_v2", orgId, owner);
        assert.ok(rotated);

        const validated = vault.validateSecret("test-connector-vsh-owner", "api_key", orgId, owner);
        assert.ok(validated);

        assert.equal(vault.deleteSecret("test-connector-vsh-owner", "api_key", orgId, owner), true);
    });

    it("cross-org denial: an account with no membership in the target org is genuinely rejected (real organizationService.hasPermission check)", () => {
        const owner = `acct_vsh_ownerB_${Date.now()}`;
        const outsider = `acct_vsh_outsider_${Date.now()}`;
        const created = org.createOrg({ name: `VSH Test Org B ${Date.now()}` }, owner);
        const orgId = created.id;

        assert.throws(
            () => vault.storeSecret("test-connector-vsh-x", "api_key", "sk_x", {}, orgId, outsider),
            (e) => e.status === 403,
            "an outsider account must be denied storeSecret with a real 403, not silently allowed"
        );

        // Seed a real secret as the legitimate owner, then prove the outsider
        // cannot read, rotate, validate, list, or delete it either.
        vault.storeSecret("test-connector-vsh-x", "api_key", "sk_x_real", {}, orgId, owner);

        assert.throws(() => vault.getSecret("test-connector-vsh-x", "api_key", orgId, outsider), (e) => e.status === 403);
        assert.throws(() => vault.rotateSecret("test-connector-vsh-x", "api_key", "sk_x_new", orgId, outsider), (e) => e.status === 403);
        assert.throws(() => vault.validateSecret("test-connector-vsh-x", "api_key", orgId, outsider), (e) => e.status === 403);
        assert.throws(() => vault.deleteSecret("test-connector-vsh-x", "api_key", orgId, outsider), (e) => e.status === 403);
        assert.throws(() => vault.listSecrets({ orgId, requestingAccountId: outsider }), (e) => e.status === 403);

        // The legitimate owner can still delete it (cleanup, and proves the
        // denial above was identity-specific, not a blanket lockout).
        assert.equal(vault.deleteSecret("test-connector-vsh-x", "api_key", orgId, owner), true);
    });

    it("a dept_lead (view_analytics-eligible role) can list/validate but is denied manage_billing-gated store/delete/rotate", () => {
        const owner = `acct_vsh_ownerC_${Date.now()}`;
        const lead = `acct_vsh_lead_${Date.now()}`;
        const created = org.createOrg({ name: `VSH Test Org C ${Date.now()}` }, owner);
        const orgId = created.id;
        org.addMember(orgId, { accountId: lead, orgRole: "dept_lead" }, owner);

        vault.storeSecret("test-connector-vsh-c", "api_key", "sk_c_value", {}, orgId, owner);

        // view_analytics-gated reads succeed for a dept_lead.
        const list = vault.listSecrets({ orgId, requestingAccountId: lead });
        assert.equal(list.length, 1);
        const validated = vault.validateSecret("test-connector-vsh-c", "api_key", orgId, lead);
        assert.ok(validated);

        // manage_billing-gated mutations are denied for a dept_lead (org_owner-only action).
        assert.throws(() => vault.storeSecret("test-connector-vsh-c", "api_key", "sk_c_v2", {}, orgId, lead), (e) => e.status === 403);
        assert.throws(() => vault.deleteSecret("test-connector-vsh-c", "api_key", orgId, lead), (e) => e.status === 403);

        vault.deleteSecret("test-connector-vsh-c", "api_key", orgId, owner);
    });
});

describe("Vault Security Hardening — plaintext-reveal access audit log", () => {

    it("a successful getSecret() reveal with requestingAccountId is genuinely recorded in the audit log", () => {
        const owner = `acct_vsh_audit_${Date.now()}`;
        const created = org.createOrg({ name: `VSH Audit Org ${Date.now()}` }, owner);
        const orgId = created.id;
        const connectorId = `test-connector-vsh-audit-${Date.now()}`;

        vault.storeSecret(connectorId, "api_key", "sk_audit_value", {}, orgId, owner);
        vault.getSecret(connectorId, "api_key", orgId, owner, { reason: "manual verification of audit trail" });

        const auditEntries = vault.getAccessAudit({ connectorId });
        assert.equal(auditEntries.length, 1, "exactly one reveal event should be recorded for this connectorId");
        assert.equal(auditEntries[0].event, "reveal");
        assert.equal(auditEntries[0].connectorId, connectorId);
        assert.equal(auditEntries[0].orgId, orgId);
        assert.equal(auditEntries[0].accountId, owner);
        assert.equal(auditEntries[0].reason, "manual verification of audit trail");
        assert.ok(auditEntries[0].ts, "audit entry has a timestamp");

        vault.deleteSecret(connectorId, "api_key", orgId, owner);
    });

    it("getSecret() without requestingAccountId does NOT write an audit entry (backward compatible, no accountId = no audit)", () => {
        const orgId = `org_vsh_noaudit_${Date.now()}`;
        const connectorId = `test-connector-vsh-noaudit-${Date.now()}`;
        vault.storeSecret(connectorId, "api_key", "sk_noaudit_value", {}, orgId);
        vault.getSecret(connectorId, "api_key", orgId); // no requestingAccountId

        const auditEntries = vault.getAccessAudit({ connectorId });
        assert.equal(auditEntries.length, 0, "a system-internal getSecret call (no requestingAccountId) must not appear in the human-reveal audit trail");

        vault.deleteSecret(connectorId, "api_key", orgId);
    });

    it("getAccessAudit() supports filtering by connectorId and a limit", () => {
        const owner = `acct_vsh_auditlimit_${Date.now()}`;
        const created = org.createOrg({ name: `VSH Audit Limit Org ${Date.now()}` }, owner);
        const orgId = created.id;
        const connectorId = `test-connector-vsh-auditlimit-${Date.now()}`;

        vault.storeSecret(connectorId, "api_key", "sk_v1", {}, orgId, owner);
        for (let i = 0; i < 3; i++) {
            vault.getSecret(connectorId, "api_key", orgId, owner, { reason: `reveal ${i}` });
        }

        const all = vault.getAccessAudit({ connectorId });
        assert.equal(all.length, 3);
        const limited = vault.getAccessAudit({ connectorId, limit: 1 });
        assert.equal(limited.length, 1);
        // Most recent first.
        assert.equal(limited[0].reason, "reveal 2");

        vault.deleteSecret(connectorId, "api_key", orgId, owner);
    });
});
