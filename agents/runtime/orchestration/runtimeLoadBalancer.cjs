"use strict";
/**
 * runtimeLoadBalancer — distributes execution load across adapter slots.
 * Selects the least-loaded adapter for a given capability. Tracks per-adapter
 * utilization and exposes load distribution metrics.
 *
 * registerAdapter(spec)          → { registered, adapterId }
 * selectAdapter(spec)            → { selected, adapterId, adapterType, loadScore }
 * recordUtilization(spec)        → { recorded }
 * releaseSlot(spec)              → { released }
 * getLoadDistribution()          → LoadDistribution
 * getLoadBalancerMetrics()       → LBMetrics
 * reset()
 *
 * Load score = activeSlots / maxSlots (0.0–1.0). Lowest score wins.
 * Tie-breaking: alphabetical adapterId for determinism.
 */

const CAPABILITY_ADAPTER_MAP = {
    execute_command: "terminal", dry_run: "terminal",
    read_file: "filesystem", write_file: "filesystem",
    list_directory: "filesystem", delete_file: "filesystem",
    git_status: "git", git_diff: "git", git_branch: "git",
    git_commit: "git", git_checkout: "git",
    navigate_file: "vscode", edit_file: "vscode",
    scan_workspace: "vscode", capture_state: "vscode",
    inspect_container: "docker", list_containers: "docker", get_logs: "docker",
    navigate_url: "browser", capture_screenshot: "browser",
};

const DEFAULT_MAX_SLOTS = 10;

let _adapters = new Map();   // adapterId → AdapterRecord
let _counter  = 0;
let _total    = 0;

// ── registerAdapter ────────────────────────────────────────────────────

function registerAdapter(spec = {}) {
    const {
        adapterType = null,
        maxSlots    = DEFAULT_MAX_SLOTS,
        weight      = 1.0,
        meta        = null,
    } = spec;

    if (!adapterType) return { registered: false, reason: "adapterType_required" };

    const adapterId = `lb-${adapterType}-${++_counter}`;
    _adapters.set(adapterId, {
        adapterId, adapterType, maxSlots, weight,
        activeSlots: 0, completedSlots: 0, failedSlots: 0,
        meta: meta ?? null,
    });
    return { registered: true, adapterId, adapterType };
}

// ── selectAdapter ──────────────────────────────────────────────────────

function selectAdapter(spec = {}) {
    const { capability = null, adapterType = null, excludeIds = [] } = spec;

    const targetType = adapterType ?? (capability ? CAPABILITY_ADAPTER_MAP[capability] : null);
    if (!targetType) return { selected: false, reason: "cannot_resolve_adapter_type" };

    const candidates = [..._adapters.values()]
        .filter(a => a.adapterType === targetType && !excludeIds.includes(a.adapterId))
        .filter(a => a.activeSlots < a.maxSlots);

    if (candidates.length === 0)
        return { selected: false, reason: "no_available_adapter_slot", adapterType: targetType };

    // Least-loaded (weighted), tie-break alphabetically
    candidates.sort((a, b) => {
        const loadA = (a.activeSlots / a.maxSlots) / a.weight;
        const loadB = (b.activeSlots / b.maxSlots) / b.weight;
        if (Math.abs(loadA - loadB) < 0.001) return a.adapterId.localeCompare(b.adapterId);
        return loadA - loadB;
    });

    const best = candidates[0];
    const loadScore = Math.round((best.activeSlots / best.maxSlots) * 1000) / 1000;

    return { selected: true, adapterId: best.adapterId, adapterType: best.adapterType, loadScore };
}

// ── recordUtilization ──────────────────────────────────────────────────

function recordUtilization(spec = {}) {
    const { adapterId = null, delta = 1 } = spec;
    if (!adapterId) return { recorded: false, reason: "adapterId_required" };
    const ad = _adapters.get(adapterId);
    if (!ad) return { recorded: false, reason: "adapter_not_found", adapterId };
    ad.activeSlots = Math.max(0, ad.activeSlots + delta);
    _total++;
    return { recorded: true, adapterId, activeSlots: ad.activeSlots };
}

// ── releaseSlot ────────────────────────────────────────────────────────

function releaseSlot(spec = {}) {
    const { adapterId = null, outcome = "completed" } = spec;
    if (!adapterId) return { released: false, reason: "adapterId_required" };
    const ad = _adapters.get(adapterId);
    if (!ad) return { released: false, reason: "adapter_not_found", adapterId };
    ad.activeSlots = Math.max(0, ad.activeSlots - 1);
    if (outcome === "completed") ad.completedSlots++;
    else if (outcome === "failed") ad.failedSlots++;
    return { released: true, adapterId, activeSlots: ad.activeSlots };
}

// ── getLoadDistribution ────────────────────────────────────────────────

function getLoadDistribution() {
    const rows = [..._adapters.values()].map(a => ({
        adapterId:   a.adapterId,
        adapterType: a.adapterType,
        activeSlots: a.activeSlots,
        maxSlots:    a.maxSlots,
        loadScore:   Math.round((a.activeSlots / a.maxSlots) * 1000) / 1000,
        weight:      a.weight,
    })).sort((a, b) => b.loadScore - a.loadScore);

    const byType = {};
    for (const a of _adapters.values()) {
        if (!byType[a.adapterType]) byType[a.adapterType] = { adapterCount: 0, totalActive: 0, totalMax: 0 };
        byType[a.adapterType].adapterCount++;
        byType[a.adapterType].totalActive += a.activeSlots;
        byType[a.adapterType].totalMax    += a.maxSlots;
    }

    return { adapters: rows, byType };
}

// ── getLoadBalancerMetrics ─────────────────────────────────────────────

function getLoadBalancerMetrics() {
    const all       = [..._adapters.values()];
    const totalAct  = all.reduce((s, a) => s + a.activeSlots, 0);
    const totalMax  = all.reduce((s, a) => s + a.maxSlots, 0);
    return {
        registeredAdapters: all.length,
        totalActiveSlots:   totalAct,
        totalCapacity:      totalMax,
        globalUtilization:  totalMax > 0 ? Math.round(totalAct / totalMax * 1000) / 1000 : 0,
        totalSelections:    _total,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() { _adapters = new Map(); _counter = 0; _total = 0; }

module.exports = {
    CAPABILITY_ADAPTER_MAP, DEFAULT_MAX_SLOTS,
    registerAdapter, selectAdapter, recordUtilization, releaseSlot,
    getLoadDistribution, getLoadBalancerMetrics, reset,
};
