"use strict";
/**
 * trustBoundaryController — trust-boundary definition, cross-domain access
 * validation, and boundary violation tracking.
 *
 * defineTrustBoundary(spec)        → { defined, boundaryId, domain, trustLevel }
 * validateCrossDomainAccess(spec)  → { allowed, reason, boundaryId }
 * recordBoundaryViolation(spec)    → { recorded, violationId }
 * getTrustBoundaryState()          → TrustBoundaryState
 * getTrustMetrics()                → TrustMetrics
 * reset()
 *
 * Trust levels (least → most): untrusted → low → medium → high → system
 * Access rule: sourceTrustLevel must be >= targetDomain trustLevel,
 *              AND sourceDomain must not be in the target's deniedSources,
 *              AND sourceDomain must be in allowedSources if that list is non-empty.
 */

const TRUST_LEVELS = ["untrusted", "low", "medium", "high", "system"];
const TRUST_RANK   = Object.fromEntries(TRUST_LEVELS.map((l, i) => [l, i]));

let _boundaries = new Map();   // boundaryId → BoundaryRecord
let _domainMap  = new Map();   // domain → boundaryId
let _violations = [];
let _counter    = 0;

// ── defineTrustBoundary ───────────────────────────────────────────────

function defineTrustBoundary(spec = {}) {
    const {
        domain          = null,
        trustLevel      = "medium",
        allowedSources  = [],
        deniedSources   = [],
    } = spec;

    if (!domain) return { defined: false, reason: "domain_required" };
    if (!TRUST_LEVELS.includes(trustLevel))
        return { defined: false, reason: `invalid_trust_level: ${trustLevel}` };

    const boundaryId = `boundary-${++_counter}`;
    const record = {
        boundaryId, domain, trustLevel, allowedSources: [...allowedSources],
        deniedSources: [...deniedSources], definedAt: new Date().toISOString(),
    };
    _boundaries.set(boundaryId, record);
    _domainMap.set(domain, boundaryId);

    return { defined: true, boundaryId, domain, trustLevel };
}

// ── validateCrossDomainAccess ─────────────────────────────────────────

function validateCrossDomainAccess(spec = {}) {
    const {
        sourceDomain     = null,
        targetDomain     = null,
        sourceTrustLevel = "untrusted",
    } = spec;

    if (!sourceDomain) return { allowed: false, reason: "sourceDomain_required" };
    if (!targetDomain) return { allowed: false, reason: "targetDomain_required" };
    if (sourceDomain === targetDomain) return { allowed: true, reason: "same_domain" };

    const boundaryId = _domainMap.get(targetDomain);
    if (!boundaryId)
        return { allowed: false, reason: "no_boundary_defined_for_target", targetDomain };

    const boundary = _boundaries.get(boundaryId);

    // Explicit deny overrides everything
    if (boundary.deniedSources.includes(sourceDomain)) {
        _recordViolationInternal(sourceDomain, targetDomain, "source_explicitly_denied");
        return { allowed: false, reason: "source_explicitly_denied", boundaryId, sourceDomain, targetDomain };
    }

    // Trust level check
    if (!TRUST_LEVELS.includes(sourceTrustLevel) ||
        TRUST_RANK[sourceTrustLevel] < TRUST_RANK[boundary.trustLevel]) {
        _recordViolationInternal(sourceDomain, targetDomain, "insufficient_trust_level");
        return {
            allowed: false, reason: "insufficient_trust_level", boundaryId,
            required: boundary.trustLevel, provided: sourceTrustLevel,
        };
    }

    // allowedSources whitelist (if non-empty, must be present)
    if (boundary.allowedSources.length > 0 && !boundary.allowedSources.includes(sourceDomain)) {
        _recordViolationInternal(sourceDomain, targetDomain, "source_not_in_allowlist");
        return { allowed: false, reason: "source_not_in_allowlist", boundaryId, sourceDomain };
    }

    return { allowed: true, boundaryId, sourceDomain, targetDomain, sourceTrustLevel };
}

function _recordViolationInternal(sourceDomain, targetDomain, reason) {
    const violationId = `viol-${++_counter}`;
    _violations.push({ violationId, sourceDomain, targetDomain, reason, recordedAt: new Date().toISOString() });
}

// ── recordBoundaryViolation ───────────────────────────────────────────

function recordBoundaryViolation(spec = {}) {
    const { sourceDomain = null, targetDomain = null, reason = "unspecified" } = spec;
    if (!sourceDomain) return { recorded: false, reason: "sourceDomain_required" };
    if (!targetDomain) return { recorded: false, reason: "targetDomain_required" };

    const violationId = `viol-${++_counter}`;
    _violations.push({ violationId, sourceDomain, targetDomain, reason, recordedAt: new Date().toISOString() });
    return { recorded: true, violationId, sourceDomain, targetDomain, reason };
}

// ── getTrustBoundaryState ─────────────────────────────────────────────

function getTrustBoundaryState() {
    const byLevel = {};
    for (const l of TRUST_LEVELS) byLevel[l] = 0;
    for (const b of _boundaries.values()) byLevel[b.trustLevel]++;

    return {
        totalBoundaries:  _boundaries.size,
        totalViolations:  _violations.length,
        byLevel,
        recentViolations: _violations.slice(-5),
    };
}

// ── getTrustMetrics ───────────────────────────────────────────────────

function getTrustMetrics() {
    return {
        totalBoundaries:   _boundaries.size,
        totalViolations:   _violations.length,
        uniqueViolators:   new Set(_violations.map(v => v.sourceDomain)).size,
        systemBoundaries:  [..._boundaries.values()].filter(b => b.trustLevel === "system").length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _boundaries = new Map();
    _domainMap  = new Map();
    _violations = [];
    _counter    = 0;
}

module.exports = {
    TRUST_LEVELS, TRUST_RANK,
    defineTrustBoundary, validateCrossDomainAccess, recordBoundaryViolation,
    getTrustBoundaryState, getTrustMetrics, reset,
};
