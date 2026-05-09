/**
 * Agent Manager — central registry for all agents in the system.
 * Agents register here; all other modules read from here.
 * No imports from dev/ or multi/ to avoid circular deps.
 */

const _registry = new Map(); // name → { agent, meta, active, registeredAt }

function register(name, agent, meta = {}) {
    if (!name || typeof agent?.run !== "function") {
        throw new Error(`agentManager.register: "${name}" must have a run() function`);
    }
    _registry.set(name, {
        agent,
        meta:         { category: "general", version: "1.0.0", ...meta },
        active:       true,
        registeredAt: new Date().toISOString(),
        execCount:    0,
        failCount:    0
    });
    return { success: true, name, category: meta.category || "general" };
}

function get(name) {
    const entry = _registry.get(name);
    if (!entry || !entry.active) return null;
    return entry;
}

function activate(name)   { if (_registry.has(name)) _registry.get(name).active = true;  }
function deactivate(name) { if (_registry.has(name)) _registry.get(name).active = false; }

function list(filter = {}) {
    const all = [..._registry.entries()].map(([name, e]) => ({
        name,
        active:       e.active,
        category:     e.meta.category,
        version:      e.meta.version,
        registeredAt: e.registeredAt,
        execCount:    e.execCount,
        failCount:    e.failCount,
        ...e.meta
    }));

    if (filter.category) return all.filter(a => a.category === filter.category);
    if (filter.active !== undefined) return all.filter(a => a.active === filter.active);
    return all;
}

function recordExec(name, success) {
    const e = _registry.get(name);
    if (!e) return;
    e.execCount++;
    if (!success) e.failCount++;
}

function has(name) { return _registry.has(name) && _registry.get(name).active; }
function count()   { return _registry.size; }

module.exports = { register, get, activate, deactivate, list, recordExec, has, count };
