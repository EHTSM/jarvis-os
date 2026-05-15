"use strict";
/**
 * runtimeActionRegistry — centralized registry of all known action types,
 * their risk class, required authority, replay and idempotency flags.
 *
 * registerActionType(spec)      → { registered, name }
 * lookupActionType(name)        → ActionTypeRecord | { found: false }
 * validateActionType(name)      → { valid, registered, record }
 * listActionTypes()             → ActionTypeRecord[]
 * getRegistryMetrics()          → RegistryMetrics
 * reset()
 */

const BUILTIN_ACTION_TYPES = [
    { name: "observe",        riskClass: "safe",       requiredAuthority: "observer",   replayable: true,  idempotent: true,  requiresApproval: false },
    { name: "schedule",       riskClass: "safe",       requiredAuthority: "operator",   replayable: true,  idempotent: true,  requiresApproval: false },
    { name: "execute",        riskClass: "guarded",    requiredAuthority: "operator",   replayable: true,  idempotent: false, requiresApproval: false },
    { name: "admit",          riskClass: "guarded",    requiredAuthority: "controller", replayable: false, idempotent: false, requiresApproval: false },
    { name: "degrade",        riskClass: "elevated",   requiredAuthority: "controller", replayable: false, idempotent: false, requiresApproval: true  },
    { name: "isolate",        riskClass: "elevated",   requiredAuthority: "controller", replayable: false, idempotent: false, requiresApproval: true  },
    { name: "failover",       riskClass: "critical",   requiredAuthority: "governor",   replayable: false, idempotent: false, requiresApproval: true  },
    { name: "quarantine",     riskClass: "critical",   requiredAuthority: "governor",   replayable: false, idempotent: true,  requiresApproval: true  },
    { name: "govern",         riskClass: "restricted", requiredAuthority: "governor",   replayable: false, idempotent: false, requiresApproval: true  },
    { name: "root_access",    riskClass: "restricted", requiredAuthority: "root-runtime", replayable: false, idempotent: false, requiresApproval: true },
    { name: "recover",        riskClass: "elevated",   requiredAuthority: "controller", replayable: true,  idempotent: true,  requiresApproval: false },
    { name: "signal",         riskClass: "safe",       requiredAuthority: "observer",   replayable: true,  idempotent: true,  requiresApproval: false },
    { name: "telemetry",      riskClass: "safe",       requiredAuthority: "observer",   replayable: true,  idempotent: true,  requiresApproval: false },
    { name: "health_check",   riskClass: "safe",       requiredAuthority: "observer",   replayable: true,  idempotent: true,  requiresApproval: false },
];

let _registry = new Map();

// Pre-populate with builtins
for (const t of BUILTIN_ACTION_TYPES) _registry.set(t.name, { ...t, builtin: true });

// ── registerActionType ────────────────────────────────────────────────

function registerActionType(spec = {}) {
    const {
        name              = null,
        riskClass         = "safe",
        requiredAuthority = "observer",
        replayable        = false,
        idempotent        = false,
        requiresApproval  = false,
        description       = "",
    } = spec;

    if (!name) return { registered: false, reason: "name_required" };

    const VALID_RISK   = ["safe", "guarded", "elevated", "critical", "restricted"];
    const VALID_AUTH   = ["observer", "operator", "controller", "governor", "root-runtime"];
    if (!VALID_RISK.includes(riskClass))
        return { registered: false, reason: `invalid_risk_class: ${riskClass}` };
    if (!VALID_AUTH.includes(requiredAuthority))
        return { registered: false, reason: `invalid_required_authority: ${requiredAuthority}` };
    if (_registry.has(name))
        return { registered: false, reason: "action_type_already_registered", name };

    _registry.set(name, { name, riskClass, requiredAuthority, replayable, idempotent, requiresApproval, description, builtin: false });
    return { registered: true, name, riskClass, requiredAuthority };
}

// ── lookupActionType ──────────────────────────────────────────────────

function lookupActionType(name) {
    if (!name) return { found: false, reason: "name_required" };
    const rec = _registry.get(name);
    return rec ? { found: true, ...rec } : { found: false, name };
}

// ── validateActionType ────────────────────────────────────────────────

function validateActionType(name) {
    const rec = _registry.get(name);
    return { valid: !!rec, registered: !!rec, name, record: rec ?? null };
}

// ── listActionTypes ───────────────────────────────────────────────────

function listActionTypes() {
    return [..._registry.values()];
}

// ── getRegistryMetrics ────────────────────────────────────────────────

function getRegistryMetrics() {
    const all    = [..._registry.values()];
    const byClass = { safe: 0, guarded: 0, elevated: 0, critical: 0, restricted: 0 };
    for (const t of all) byClass[t.riskClass] = (byClass[t.riskClass] ?? 0) + 1;
    return {
        totalRegistered: all.length,
        builtinCount:    all.filter(t => t.builtin).length,
        customCount:     all.filter(t => !t.builtin).length,
        replayableCount: all.filter(t => t.replayable).length,
        idempotentCount: all.filter(t => t.idempotent).length,
        byClass,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _registry = new Map();
    for (const t of BUILTIN_ACTION_TYPES) _registry.set(t.name, { ...t, builtin: true });
}

module.exports = {
    BUILTIN_ACTION_TYPES,
    registerActionType, lookupActionType, validateActionType,
    listActionTypes, getRegistryMetrics, reset,
};
