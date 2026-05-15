"use strict";
/**
 * runtimeAuthorityManager — execution authority assignment, validation,
 * revocation, and hierarchy enforcement.
 *
 * registerAuthority(spec)     → { registered, authorityId, principalId, level }
 * validateAuthority(spec)     → { valid, principalId, level, canPerform }
 * revokeAuthority(spec)       → { revoked, authorityId }
 * getAuthorityState()         → AuthorityState
 * getAuthorityMetrics()       → AuthorityMetrics
 * reset()
 *
 * Levels (least → most): observer → operator → controller → governor → root-runtime
 * Deny-by-default: unregistered principals have no authority.
 * root-runtime cannot be granted except via explicit allow flag.
 */

const AUTHORITY_LEVELS = ["observer", "operator", "controller", "governor", "root-runtime"];
const AUTHORITY_RANK   = Object.fromEntries(AUTHORITY_LEVELS.map((l, i) => [l, i]));

let _authorities = new Map();   // authorityId → AuthorityRecord
let _principals  = new Map();   // principalId → authorityId (active only)
let _counter     = 0;

// ── registerAuthority ─────────────────────────────────────────────────

function registerAuthority(spec = {}) {
    const {
        principalId      = null,
        level            = null,
        domain           = "global",
        allowRootRuntime = false,
    } = spec;

    if (!principalId) return { registered: false, reason: "principalId_required" };
    if (!level)       return { registered: false, reason: "level_required" };
    if (!AUTHORITY_LEVELS.includes(level))
        return { registered: false, reason: `invalid_level: ${level}` };
    if (level === "root-runtime" && !allowRootRuntime)
        return { registered: false, reason: "root_runtime_requires_explicit_allow" };
    if (_principals.has(principalId))
        return { registered: false, reason: "principal_already_has_authority", principalId };

    const authorityId = `auth-${++_counter}`;
    const record = {
        authorityId, principalId, level, domain,
        active: true, grantedAt: new Date().toISOString(),
    };
    _authorities.set(authorityId, record);
    _principals.set(principalId, authorityId);

    return { registered: true, authorityId, principalId, level, domain };
}

// ── validateAuthority ─────────────────────────────────────────────────

function validateAuthority(spec = {}) {
    const { principalId = null, requiredLevel = "observer" } = spec;
    if (!principalId) return { valid: false, reason: "principalId_required" };
    if (!AUTHORITY_LEVELS.includes(requiredLevel))
        return { valid: false, reason: `invalid_required_level: ${requiredLevel}` };

    const authId = _principals.get(principalId);
    if (!authId) return { valid: false, reason: "no_authority_found", principalId, canPerform: false };

    const rec = _authorities.get(authId);
    if (!rec.active) return { valid: false, reason: "authority_revoked", principalId, canPerform: false };

    const canPerform = AUTHORITY_RANK[rec.level] >= AUTHORITY_RANK[requiredLevel];
    return {
        valid:         true,
        authorityId:   authId,
        principalId,
        level:         rec.level,
        requiredLevel,
        canPerform,
    };
}

// ── revokeAuthority ───────────────────────────────────────────────────

function revokeAuthority(spec = {}) {
    const { authorityId = null } = spec;
    if (!authorityId) return { revoked: false, reason: "authorityId_required" };

    const rec = _authorities.get(authorityId);
    if (!rec)        return { revoked: false, reason: "authority_not_found" };
    if (!rec.active) return { revoked: false, reason: "authority_already_revoked" };

    rec.active    = false;
    rec.revokedAt = new Date().toISOString();
    _principals.delete(rec.principalId);

    return { revoked: true, authorityId, principalId: rec.principalId, level: rec.level };
}

// ── getAuthorityState ─────────────────────────────────────────────────

function getAuthorityState() {
    const all    = [..._authorities.values()];
    const active = all.filter(r => r.active);
    const byLevel = {};
    for (const l of AUTHORITY_LEVELS) byLevel[l] = 0;
    for (const r of active) byLevel[r.level]++;

    return {
        totalAuthorities:  all.length,
        activeCount:       active.length,
        revokedCount:      all.length - active.length,
        byLevel,
        registeredPrincipals: _principals.size,
    };
}

// ── getAuthorityMetrics ───────────────────────────────────────────────

function getAuthorityMetrics() {
    const all    = [..._authorities.values()];
    const active = all.filter(r => r.active);
    return {
        totalGranted: all.length,
        activeCount:  active.length,
        rootCount:    active.filter(r => r.level === "root-runtime").length,
        highPrivCount: active.filter(r => AUTHORITY_RANK[r.level] >= AUTHORITY_RANK["governor"]).length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _authorities = new Map();
    _principals  = new Map();
    _counter     = 0;
}

module.exports = {
    AUTHORITY_LEVELS, AUTHORITY_RANK,
    registerAuthority, validateAuthority, revokeAuthority,
    getAuthorityState, getAuthorityMetrics, reset,
};
