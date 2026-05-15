"use strict";
/**
 * capabilityRegistry — register and manage runtime capability health and availability.
 *
 * registerCapability(opts)                    → RegistrationResult
 * disableCapability(capabilityId, reason)     → DisableResult
 * enableCapability(capabilityId)              → EnableResult
 * getCapability(capabilityId)                 → CapabilityRecord | null
 * listCapabilities(filter)                    → CapabilityRecord[]
 * getHealthyCapabilities(minHealthScore)      → CapabilityRecord[]
 * updateHealth(capabilityId, healthScore)     → UpdateResult
 * reset()
 */

const CAPABILITY_TYPES = ["filesystem", "terminal", "git", "docker", "browser", "vscode", "network", "automation"];

let _registry = new Map();   // capabilityId → CapabilityRecord

// ── registerCapability ────────────────────────────────────────────────

function registerCapability(opts = {}) {
    const {
        capabilityId,
        type                = "terminal",
        permissions         = [],
        safeModes           = ["normal", "safe", "degraded", "recovery"],
        requiresVerification = false,
        rollbackSupported   = false,
        healthScore         = 1.0,
        description         = "",
        cooldownMs          = 0,
    } = opts;

    if (!capabilityId) return { registered: false, reason: "missing_capabilityId" };
    if (!CAPABILITY_TYPES.includes(type)) return { registered: false, reason: `invalid_type: ${type}` };

    const record = {
        capabilityId,
        type,
        permissions:         [...permissions],
        safeModes:           [...safeModes],
        requiresVerification,
        rollbackSupported,
        healthScore:         _clamp(healthScore),
        description,
        cooldownMs,
        enabled:             true,
        disableReason:       null,
        disabledAt:          null,
        lastUsedAt:          null,
        useCount:            0,
        registeredAt:        new Date().toISOString(),
    };

    _registry.set(capabilityId, record);
    return { registered: true, capabilityId, type };
}

// ── disableCapability / enableCapability ──────────────────────────────

function disableCapability(capabilityId, reason = "manual") {
    const cap = _registry.get(capabilityId);
    if (!cap) return { disabled: false, reason: "not_found" };
    cap.enabled       = false;
    cap.disableReason = reason;
    cap.disabledAt    = new Date().toISOString();
    return { disabled: true, capabilityId, reason };
}

function enableCapability(capabilityId) {
    const cap = _registry.get(capabilityId);
    if (!cap) return { enabled: false, reason: "not_found" };
    cap.enabled       = true;
    cap.disableReason = null;
    cap.disabledAt    = null;
    return { enabled: true, capabilityId };
}

// ── getCapability / listCapabilities ──────────────────────────────────

function getCapability(capabilityId) {
    return _registry.get(capabilityId) ?? null;
}

function listCapabilities(filter = {}) {
    let caps = [..._registry.values()];
    if (filter.type    != null) caps = caps.filter(c => c.type    === filter.type);
    if (filter.enabled != null) caps = caps.filter(c => c.enabled === filter.enabled);
    if (filter.mode    != null) caps = caps.filter(c => c.safeModes.includes(filter.mode));
    return caps;
}

// ── getHealthyCapabilities ────────────────────────────────────────────

function getHealthyCapabilities(minHealthScore = 0.5) {
    return [..._registry.values()].filter(c => c.enabled && c.healthScore >= minHealthScore);
}

// ── updateHealth ──────────────────────────────────────────────────────

function updateHealth(capabilityId, healthScore) {
    const cap = _registry.get(capabilityId);
    if (!cap) return { updated: false, reason: "not_found" };
    cap.healthScore = _clamp(healthScore);
    return { updated: true, capabilityId, healthScore: cap.healthScore };
}

// ── helpers ───────────────────────────────────────────────────────────

function _clamp(v) { return Math.min(1.0, Math.max(0, +v || 0)); }

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _registry = new Map();
}

module.exports = {
    CAPABILITY_TYPES,
    registerCapability, disableCapability, enableCapability,
    getCapability, listCapabilities, getHealthyCapabilities, updateHealth,
    reset,
};
