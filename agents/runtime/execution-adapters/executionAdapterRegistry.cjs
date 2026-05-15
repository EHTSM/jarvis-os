"use strict";
/**
 * executionAdapterRegistry — central registry of all execution adapter types,
 * their capabilities, authority requirements, and lifecycle flags.
 *
 * registerAdapter(spec)        → { registered, adapterId, adapterType }
 * lookupAdapter(adapterType)   → AdapterRecord | { found: false }
 * deactivateAdapter(spec)      → { deactivated, adapterId }
 * listAdapters()               → AdapterRecord[]
 * getRegistryMetrics()         → RegistryMetrics
 * reset()
 */

const ADAPTER_TYPES = [
    "terminal", "filesystem", "git", "vscode", "docker", "browser",
];

const VALID_CAPABILITIES = new Set([
    "execute_command", "dry_run",
    "read_file", "write_file", "list_directory", "delete_file",
    "git_status", "git_diff", "git_branch", "git_commit", "git_checkout",
    "navigate_file", "edit_file", "scan_workspace", "capture_state",
    "inspect_container", "list_containers", "get_logs",
    "navigate_url", "capture_screenshot",
]);

const BUILTIN_ADAPTERS = [
    {
        adapterType: "terminal",
        capabilities: ["execute_command", "dry_run"],
        minAuthority: "operator",
        sandboxed: true,
        replayCompatible: true,
        version: "1.0.0",
    },
    {
        adapterType: "filesystem",
        capabilities: ["read_file", "write_file", "list_directory", "delete_file"],
        minAuthority: "observer",
        sandboxed: true,
        replayCompatible: true,
        version: "1.0.0",
    },
    {
        adapterType: "git",
        capabilities: ["git_status", "git_diff", "git_branch", "git_commit", "git_checkout"],
        minAuthority: "observer",
        sandboxed: true,
        replayCompatible: true,
        version: "1.0.0",
    },
    {
        adapterType: "vscode",
        capabilities: ["navigate_file", "edit_file", "scan_workspace", "capture_state"],
        minAuthority: "observer",
        sandboxed: true,
        replayCompatible: true,
        version: "1.0.0",
    },
    {
        adapterType: "docker",
        capabilities: ["inspect_container", "list_containers", "get_logs"],
        minAuthority: "observer",
        sandboxed: true,
        replayCompatible: true,
        version: "1.0.0",
    },
    {
        adapterType: "browser",
        capabilities: ["navigate_url", "capture_screenshot"],
        minAuthority: "operator",
        sandboxed: true,
        replayCompatible: false,
        version: "1.0.0",
    },
];

let _registry = new Map();
let _counter  = 0;

// Pre-populate builtins
for (const spec of BUILTIN_ADAPTERS) {
    const adapterId = `adapter-${++_counter}`;
    _registry.set(spec.adapterType, { ...spec, adapterId, active: true, builtin: true, registeredAt: new Date().toISOString() });
}

// ── registerAdapter ───────────────────────────────────────────────────

function registerAdapter(spec = {}) {
    const {
        adapterType       = null,
        capabilities      = [],
        minAuthority      = "operator",
        sandboxed         = true,
        replayCompatible  = true,
        version           = "1.0.0",
    } = spec;

    if (!adapterType) return { registered: false, reason: "adapterType_required" };
    if (!ADAPTER_TYPES.includes(adapterType))
        return { registered: false, reason: `invalid_adapter_type: ${adapterType}` };
    if (_registry.has(adapterType))
        return { registered: false, reason: "adapter_already_registered", adapterType };

    const invalid = capabilities.filter(c => !VALID_CAPABILITIES.has(c));
    if (invalid.length > 0)
        return { registered: false, reason: `invalid_capabilities: ${invalid.join(",")}` };

    const adapterId = `adapter-${++_counter}`;
    _registry.set(adapterType, {
        adapterId, adapterType, capabilities, minAuthority,
        sandboxed, replayCompatible, version,
        active: true, builtin: false, registeredAt: new Date().toISOString(),
    });

    return { registered: true, adapterId, adapterType, capabilities };
}

// ── lookupAdapter ─────────────────────────────────────────────────────

function lookupAdapter(adapterType) {
    if (!adapterType) return { found: false, reason: "adapterType_required" };
    const rec = _registry.get(adapterType);
    return rec ? { found: true, ...rec } : { found: false, adapterType };
}

// ── deactivateAdapter ─────────────────────────────────────────────────

function deactivateAdapter(spec = {}) {
    const { adapterType = null } = spec;
    if (!adapterType) return { deactivated: false, reason: "adapterType_required" };
    const rec = _registry.get(adapterType);
    if (!rec) return { deactivated: false, reason: "adapter_not_found", adapterType };
    rec.active = false;
    return { deactivated: true, adapterId: rec.adapterId, adapterType };
}

// ── listAdapters ──────────────────────────────────────────────────────

function listAdapters() {
    return [..._registry.values()];
}

// ── getRegistryMetrics ────────────────────────────────────────────────

function getRegistryMetrics() {
    const all = [..._registry.values()];
    return {
        totalAdapters:     all.length,
        activeAdapters:    all.filter(a => a.active).length,
        sandboxedCount:    all.filter(a => a.sandboxed).length,
        replayCompatible:  all.filter(a => a.replayCompatible).length,
        builtinCount:      all.filter(a => a.builtin).length,
        adapterTypes:      all.map(a => a.adapterType),
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _registry = new Map();
    _counter  = 0;
    for (const spec of BUILTIN_ADAPTERS) {
        const adapterId = `adapter-${++_counter}`;
        _registry.set(spec.adapterType, { ...spec, adapterId, active: true, builtin: true, registeredAt: new Date().toISOString() });
    }
}

module.exports = {
    ADAPTER_TYPES, VALID_CAPABILITIES, BUILTIN_ADAPTERS,
    registerAdapter, lookupAdapter, deactivateAdapter,
    listAdapters, getRegistryMetrics, reset,
};
