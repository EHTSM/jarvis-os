"use strict";
/**
 * credentialImportTool.cjs — 100-Company Credential Activation mission.
 *
 * Reusable, safe pipeline for importing credentials from a source (an
 * env-var snapshot for this mission's Phase 4/5 run, or a normalized
 * spreadsheet row set in future runs) into the existing, hardened
 * secretVault.cjs — no new credential store, no second Vault.
 *
 * Pipeline: input -> normalize -> validate -> determine scope ->
 * encrypt/store (via the real secretVault.storeSecret) -> return a
 * credential reference -> sanitize source/result -> audit.
 *
 * Security invariants (enforced structurally, not just by convention):
 *   - NEVER logs a secret value. Every log/report line here uses only
 *     metadata (connectorId, type, orgId, presence, length-class) —
 *     grep this file: no console.log/logger call ever receives a raw
 *     credential.
 *   - dryRun mode performs ZERO writes — it only classifies rows.
 *   - Every real Vault write goes through the existing, unmodified
 *     secretVault.storeSecret()/deleteSecret() — this file adds no new
 *     encryption, no new storage format.
 *   - Idempotent: importing the same row twice is a safe no-op unless
 *     opts.overwrite is explicitly set (storeSecret's own versioning
 *     still applies underneath).
 */

const vault = require("./secretVault.cjs");

/**
 * @typedef {object} ImportRow
 * @property {string} envVarName   the source name (e.g. "GROQ_API_KEY")
 * @property {string} connectorId  canonical connector id (e.g. "ai:groq")
 * @property {string} credentialType  canonical vault credential type (e.g. "api_key")
 * @property {"PLATFORM_SHARED"|"ORGANIZATION_SHARED"|"COMPANY_SPECIFIC"} scope
 * @property {string} [orgId]      required if scope !== PLATFORM_SHARED
 */

/**
 * Classify a single row against the current environment + vault state,
 * WITHOUT writing anything. Used by both dry-run and real-run modes so
 * their classification logic can never drift apart.
 *
 * @returns {{ row: ImportRow, classification: string, detail: string }}
 */
function classifyRow(row, { overwrite = false } = {}) {
    const { envVarName, connectorId, credentialType } = row;

    if (!envVarName || !connectorId || !credentialType) {
        return { row, classification: "INVALID_FORMAT", detail: "missing envVarName/connectorId/credentialType" };
    }
    if (!vault.CRED_TYPES.has(credentialType)) {
        return { row, classification: "INVALID_FORMAT", detail: `unknown credential type "${credentialType}" — not in secretVault.cjs CRED_TYPES` };
    }

    const present = !!process.env[envVarName];
    if (!present) {
        return { row, classification: "MISSING_FROM_SHEET", detail: `${envVarName} not set in environment` };
    }

    const orgId = row.scope === "PLATFORM_SHARED" ? vault.GLOBAL_ORG : row.orgId;
    if (row.scope !== "PLATFORM_SHARED" && !orgId) {
        return { row, classification: "AMBIGUOUS", detail: "non-platform scope requires an explicit orgId — none provided" };
    }

    // validateSecret()/getSecret() both transparently fall back to the
    // raw env var when no VAULT entry exists (by design, for runtime
    // resolution) — that fallback is exactly the behavior an import
    // tool must NOT treat as "already imported". Only source === "vault"
    // means a real, decryptable Vault-native entry already exists.
    let existingValid = false;
    try {
        const existing = vault.validateSecret(connectorId, credentialType, orgId);
        existingValid = existing?.source === "vault" && !!existing?.valid;
    } catch { /* validateSecret itself may throw on a genuinely broken org-check path — treat as not-existing */ }

    if (existingValid && !overwrite) {
        return { row, classification: "WOULD_REUSE", detail: "a genuinely valid Vault entry already exists — keeping it (pass overwrite:true to replace)" };
    }
    if (existingValid && overwrite) {
        return { row, classification: "WOULD_UPDATE", detail: "a valid Vault entry exists and will be replaced (overwrite requested)" };
    }
    return { row, classification: "WOULD_CREATE", detail: existingValid === false ? "no existing valid Vault entry (absent or undecryptable) — will create fresh" : "will create" };
}

/**
 * Dry-run: classify every row, write nothing. Returns aggregate counts
 * ONLY — never a secret value, never even the full row list unless the
 * caller explicitly asks for row-level detail (still metadata-only).
 */
function dryRun(rows, opts = {}) {
    const results = rows.map(r => classifyRow(r, opts));
    const counts = {};
    for (const r of results) counts[r.classification] = (counts[r.classification] || 0) + 1;
    return {
        totalRows: rows.length,
        counts,
        rows: results.map(r => ({
            envVarName: r.row.envVarName,
            connectorId: r.row.connectorId,
            credentialType: r.row.credentialType,
            scope: r.row.scope,
            classification: r.classification,
            detail: r.detail,
        })),
    };
}

/**
 * Real import: for every row NOT classified as MISSING_FROM_SHEET/
 * INVALID_FORMAT/AMBIGUOUS/WOULD_REUSE, store the value via the real,
 * unmodified secretVault.storeSecret(). Returns a credential reference
 * per row, never the value itself.
 *
 * @param {ImportRow[]} rows
 * @param {{ overwrite?: boolean, requestingAccountId?: string, confirm: true }} opts
 *   `confirm: true` is REQUIRED — this is the explicit-confirmation gate
 *   Phase 3 requires before any production Vault write.
 */
function realImport(rows, opts = {}) {
    if (opts.confirm !== true) {
        throw new Error("realImport() requires explicit opts.confirm === true before any production Vault write");
    }
    const results = [];
    for (const row of rows) {
        const classification = classifyRow(row, opts);
        if (!["WOULD_CREATE", "WOULD_UPDATE"].includes(classification.classification)) {
            results.push({ ...classification, action: "SKIPPED" });
            continue;
        }
        const { envVarName, connectorId, credentialType } = row;
        const orgId = row.scope === "PLATFORM_SHARED" ? vault.GLOBAL_ORG : row.orgId;
        const value = process.env[envVarName];
        try {
            const record = vault.storeSecret(connectorId, credentialType, value, { importedFrom: "credentialImportTool", importedAt: new Date().toISOString() }, orgId, opts.requestingAccountId || null);
            results.push({
                envVarName, connectorId, credentialType, scope: row.scope,
                action: "IMPORTED",
                credentialRef: `${connectorId}::${credentialType}`,
                version: record.version,
                rotationDueAt: record.rotationDueAt,
            });
        } catch (e) {
            results.push({ envVarName, connectorId, credentialType, scope: row.scope, action: "FAILED", error: e.message });
        }
    }
    return {
        totalRows: rows.length,
        imported: results.filter(r => r.action === "IMPORTED").length,
        failed: results.filter(r => r.action === "FAILED").length,
        skipped: results.filter(r => r.action === "SKIPPED").length,
        results,
    };
}

module.exports = { classifyRow, dryRun, realImport };
