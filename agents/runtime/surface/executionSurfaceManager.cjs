"use strict";
/**
 * executionSurfaceManager — unified runtime execution interface + capability registry.
 *
 * Surfaces: terminal, filesystem, vscode, browser, git, docker, n8n
 * Classifications: safe | elevated | dangerous | destructive
 *
 * registerCapability(id, opts)         → CapabilityRecord
 * getCapability(id)                    → CapabilityRecord | null
 * listCapabilities(filter)             → CapabilityRecord[]
 * executeCapability(capId, payload, ctx) → ExecutionResult
 * getCapabilityStats()                 → Stats
 * reset()
 */

const CLASSIFICATIONS = ["safe", "elevated", "dangerous", "destructive"];

const SURFACES = ["terminal", "filesystem", "vscode", "browser", "git", "docker", "n8n"];

// Built-in capability table: surface.action → classification
const BUILTIN_CAPABILITIES = {
    // ── terminal ──────────────────────────────────────────────────────
    "terminal.read":         { surface: "terminal",    classification: "safe",        description: "Read terminal output or env"       },
    "terminal.execute":      { surface: "terminal",    classification: "elevated",    description: "Execute shell command"             },
    "terminal.admin":        { surface: "terminal",    classification: "dangerous",   description: "Execute privileged shell command"  },
    // ── filesystem ────────────────────────────────────────────────────
    "fs.read":               { surface: "filesystem",  classification: "safe",        description: "Read file or directory"            },
    "fs.write":              { surface: "filesystem",  classification: "elevated",    description: "Write or create a file"            },
    "fs.delete":             { surface: "filesystem",  classification: "dangerous",   description: "Delete file or directory"          },
    "fs.format":             { surface: "filesystem",  classification: "destructive", description: "Format or wipe filesystem"         },
    // ── vscode ────────────────────────────────────────────────────────
    "vscode.read":           { surface: "vscode",      classification: "safe",        description: "Read workspace state"             },
    "vscode.edit":           { surface: "vscode",      classification: "elevated",    description: "Edit file in workspace"           },
    "vscode.run_task":       { surface: "vscode",      classification: "elevated",    description: "Run VS Code task"                 },
    "vscode.debug":          { surface: "vscode",      classification: "elevated",    description: "Start debug session"              },
    // ── browser ───────────────────────────────────────────────────────
    "browser.navigate":      { surface: "browser",     classification: "safe",        description: "Navigate to URL"                  },
    "browser.click":         { surface: "browser",     classification: "elevated",    description: "Click UI element"                 },
    "browser.form":          { surface: "browser",     classification: "elevated",    description: "Submit form data"                 },
    "browser.download":      { surface: "browser",     classification: "elevated",    description: "Download file via browser"        },
    "browser.screenshot":    { surface: "browser",     classification: "safe",        description: "Capture screenshot"               },
    // ── git ───────────────────────────────────────────────────────────
    "git.read":              { surface: "git",         classification: "safe",        description: "Read git state"                   },
    "git.commit":            { surface: "git",         classification: "elevated",    description: "Create git commit"                },
    "git.push":              { surface: "git",         classification: "elevated",    description: "Push to remote"                   },
    "git.force_push":        { surface: "git",         classification: "dangerous",   description: "Force push (destructive)"         },
    "git.revert":            { surface: "git",         classification: "elevated",    description: "Revert commits"                   },
    "git.reset_hard":        { surface: "git",         classification: "dangerous",   description: "Hard reset (discards changes)"    },
    // ── docker ────────────────────────────────────────────────────────
    "docker.inspect":        { surface: "docker",      classification: "safe",        description: "Inspect container or image"       },
    "docker.run":            { surface: "docker",      classification: "elevated",    description: "Start container"                  },
    "docker.stop":           { surface: "docker",      classification: "elevated",    description: "Stop container"                   },
    "docker.remove":         { surface: "docker",      classification: "dangerous",   description: "Remove container/image"           },
    "docker.prune":          { surface: "docker",      classification: "destructive", description: "Prune all unused resources"       },
    // ── n8n ───────────────────────────────────────────────────────────
    "n8n.trigger":           { surface: "n8n",         classification: "elevated",    description: "Trigger n8n workflow"             },
    "n8n.schedule":          { surface: "n8n",         classification: "elevated",    description: "Schedule n8n workflow"            },
    "n8n.delete":            { surface: "n8n",         classification: "dangerous",   description: "Delete n8n workflow"              },
    "n8n.read":              { surface: "n8n",         classification: "safe",        description: "Read n8n workflow state"          },
};

let _registry  = new Map();   // capId → CapabilityRecord
let _execLog   = [];
let _counter   = 0;

// ── _seed ─────────────────────────────────────────────────────────────

function _seed() {
    for (const [id, def] of Object.entries(BUILTIN_CAPABILITIES)) {
        _registry.set(id, { capId: id, ...def, enabled: true, execCount: 0 });
    }
}
_seed();

// ── registerCapability ────────────────────────────────────────────────

function registerCapability(id, opts = {}) {
    if (!CLASSIFICATIONS.includes(opts.classification ?? "safe")) {
        return { registered: false, reason: "invalid_classification" };
    }
    if (opts.surface && !SURFACES.includes(opts.surface)) {
        return { registered: false, reason: "invalid_surface" };
    }
    const record = {
        capId:          id,
        surface:        opts.surface         ?? "generic",
        classification: opts.classification  ?? "safe",
        description:    opts.description     ?? "",
        enabled:        opts.enabled         ?? true,
        execCount:      0,
        custom:         true,
    };
    _registry.set(id, record);
    return { registered: true, capId: id, classification: record.classification };
}

// ── getCapability / listCapabilities ──────────────────────────────────

function getCapability(id) {
    return _registry.get(id) ?? null;
}

function listCapabilities(filter = {}) {
    let caps = [..._registry.values()];
    if (filter.surface)        caps = caps.filter(c => c.surface        === filter.surface);
    if (filter.classification) caps = caps.filter(c => c.classification === filter.classification);
    if (filter.enabled != null) caps = caps.filter(c => c.enabled === filter.enabled);
    return caps;
}

// ── executeCapability ─────────────────────────────────────────────────

function executeCapability(capId, payload = {}, ctx = {}) {
    const cap = _registry.get(capId);
    if (!cap) return { executed: false, reason: "capability_not_found", capId };
    if (!cap.enabled) return { executed: false, reason: "capability_disabled", capId };

    const execId    = ctx.execId ?? `surf-${++_counter}`;
    const traceId   = ctx.traceId ?? `tr-${_counter}`;
    const isolation = ctx.isolation ?? _defaultIsolation(cap.classification);

    cap.execCount++;

    // Use caller-provided handler if present, otherwise simulate
    let result;
    if (typeof ctx.handler === "function") {
        result = ctx.handler({ capId, payload, isolation, execId });
    } else {
        result = { simulated: true, output: null, exitCode: 0 };
    }

    const entry = {
        execId,
        traceId,
        capId,
        surface:        cap.surface,
        classification: cap.classification,
        isolation,
        payload:        { ...payload },
        result,
        ts:             new Date().toISOString(),
    };
    _execLog.push(entry);
    if (_execLog.length > 2000) _execLog.shift();

    return {
        executed:       true,
        execId,
        traceId,
        capId,
        surface:        cap.surface,
        classification: cap.classification,
        isolation,
        result,
    };
}

function _defaultIsolation(classification) {
    return classification === "destructive" ? "sandboxed"
         : classification === "dangerous"   ? "sandboxed"
         : classification === "elevated"    ? "standard"
         :                                    "none";
}

// ── getCapabilityStats ────────────────────────────────────────────────

function getCapabilityStats() {
    const caps     = [..._registry.values()];
    const byClass  = {};
    const bySurface = {};
    for (const c of caps) {
        byClass[c.classification]  = (byClass[c.classification]  ?? 0) + 1;
        bySurface[c.surface]       = (bySurface[c.surface]       ?? 0) + 1;
    }
    return {
        total:      caps.length,
        enabled:    caps.filter(c => c.enabled).length,
        byClassification: byClass,
        bySurface,
        executions: _execLog.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _registry  = new Map();
    _execLog   = [];
    _counter   = 0;
    _seed();
}

module.exports = {
    CLASSIFICATIONS, SURFACES, BUILTIN_CAPABILITIES,
    registerCapability, getCapability, listCapabilities,
    executeCapability, getCapabilityStats, reset,
};
