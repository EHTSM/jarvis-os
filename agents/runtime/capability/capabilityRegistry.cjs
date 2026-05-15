"use strict";
/**
 * capabilityRegistry — register and discover runtime capabilities.
 *
 * register(capability)       → { registered, id, version }
 * unregister(id)             → { unregistered, id } | { unregistered:false, reason }
 * get(id)                    → capability | null
 * list(filter?)              → capability[]  filter: { policy?, tag? }
 * discover(policy?)          → string[]  ids matching policy (all if omitted)
 * reset()
 *
 * Capability shape:
 *   { id, name, version?, policy, contract, handler, tags?, description? }
 */

const _registry = new Map();   // id → stored capability record

function register(capability) {
    if (!capability?.id)                                            throw new Error("capability.id is required");
    if (!capability?.handler || typeof capability.handler !== "function") throw new Error(`capability "${capability.id}" must have a handler function`);
    if (!capability?.policy)                                        throw new Error(`capability "${capability.id}" must declare a policy`);

    const existing = _registry.get(capability.id);
    const version  = existing ? (existing.version ?? 1) + 1 : (capability.version ?? 1);

    const record = { ...capability, version, registeredAt: new Date().toISOString() };
    _registry.set(capability.id, record);
    return { registered: true, id: capability.id, version };
}

function unregister(id) {
    if (!_registry.has(id)) return { unregistered: false, reason: "not_found", id };
    _registry.delete(id);
    return { unregistered: true, id };
}

function get(id) { return _registry.get(id) ?? null; }

function list(filter = {}) {
    let caps = [..._registry.values()];
    if (filter.policy) caps = caps.filter(c => c.policy === filter.policy);
    if (filter.tag)    caps = caps.filter(c => c.tags?.includes(filter.tag));
    return caps;
}

function discover(policy = null) {
    const caps = policy ? list({ policy }) : [..._registry.values()];
    return caps.map(c => c.id);
}

function reset() { _registry.clear(); }

module.exports = { register, unregister, get, list, discover, reset };
