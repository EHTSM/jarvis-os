"use strict";
/**
 * GDPR Data Export — aggregates every real per-account record already
 * stored by existing services into a single downloadable JSON bundle.
 *
 * Enterprise Capability Expansion mission. Confirmed genuinely absent
 * before this: the only prior "data subject request" code lived in
 * _archive/ (not live) and only logged a ticket, it never gathered any
 * actual data. There is no aggregation service anywhere in the live
 * codebase, so this queries each source service directly by accountId —
 * the same accountId (req.user.sub) every route in the app already scopes
 * data by. No new data store, no new identity concept.
 *
 * Sources (all pre-existing, all real):
 *   - accountService.getById        → profile record
 *   - billingService.getRecord      → plan/subscription record
 *   - organizationService.listOrgs / listGrantsForAccount → org memberships
 *   - crmService.getLeads()         → filtered to this account's leads
 *   - creativeAssetLibrary.listAssets({ accountId }) → generated assets
 *
 * founderJournal.cjs is intentionally excluded — its store is a global
 * singleton keyed by date, not by account, so there is no per-account
 * slice of it to export without inventing an association that doesn't
 * exist in the data model.
 */

function _try(fn, fallback = null) {
    try { return fn(); } catch { return fallback; }
}

function gatherAccountData(accountId) {
    if (!accountId) throw new Error("accountId is required");

    const account = _try(() => require("./accountService.js").getById(accountId));
    const billing = _try(() => require("./billingService.js").getRecord(accountId));
    const orgs = _try(() => require("./organizationService.cjs").listOrgs(accountId), []) || [];
    const orgGrants = _try(() => require("./organizationService.cjs").listGrantsForAccount(accountId), []) || [];
    const leads = _try(() => {
        const crm = require("./crmService.js");
        return crm.getLeads().filter(l => l.userId === accountId);
    }, []) || [];
    const assets = _try(() => require("./creativeAssetLibrary.cjs").listAssets({ accountId, limit: 10000 }), []) || [];

    return {
        exportedAt: new Date().toISOString(),
        accountId,
        profile: account ? {
            id: account.id, email: account.email, name: account.name,
            role: account.role, createdAt: account.createdAt,
            lastLoginAt: account.lastLoginAt, emailVerified: account.emailVerified,
        } : null,
        billing: billing || null,
        organizations: orgs,
        organizationGrants: orgGrants,
        crmContacts: leads,
        creativeAssets: assets.map(a => ({
            id: a.id, type: a.type, capability: a.capability, url: a.url,
            mimeType: a.mimeType, createdAt: a.createdAt, folder: a.folder, tags: a.tags,
        })),
    };
}

module.exports = { gatherAccountData };
