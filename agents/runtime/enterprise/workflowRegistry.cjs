"use strict";
/**
 * workflowRegistry — lightweight enterprise controls for workflow metadata.
 *
 * register(id, meta)          — register workflow with name/owner/tags/retentionDays
 * tag(id, tag)                — add tag
 * untag(id, tag)              — remove tag
 * get(id)                     → record or null
 * list(filter?)               → filter by {tag, owner}
 * recordActivity(id, type, detail?) — log activity event
 * getAuditSummary(id)         → { id, name, owner, tags, registeredAt, lastActivity, activityCount }
 * pruneExpired()              → { pruned, remaining }
 * reset()
 */

// id → { id, name, owner, tags[], retentionDays, registeredAt, activities[] }
const _registry   = new Map();
let   _seq        = 0;

function register(id, meta = {}) {
    if (_registry.has(id)) return _registry.get(id);
    const rec = {
        id,
        name:          meta.name          || id,
        owner:         meta.owner         || "unknown",
        tags:          Array.isArray(meta.tags) ? [...meta.tags] : [],
        retentionDays: meta.retentionDays || null,
        registeredAt:  new Date().toISOString(),
        activities:    [],
    };
    _registry.set(id, rec);
    return rec;
}

function tag(id, tagName) {
    const rec = _registry.get(id);
    if (!rec) return false;
    if (!rec.tags.includes(tagName)) rec.tags.push(tagName);
    return true;
}

function untag(id, tagName) {
    const rec = _registry.get(id);
    if (!rec) return false;
    rec.tags = rec.tags.filter(t => t !== tagName);
    return true;
}

function get(id) {
    return _registry.get(id) || null;
}

function list(filter = {}) {
    let all = [..._registry.values()];
    if (filter.tag)   all = all.filter(r => r.tags.includes(filter.tag));
    if (filter.owner) all = all.filter(r => r.owner === filter.owner);
    return all;
}

function recordActivity(id, type, detail = {}) {
    if (!_registry.has(id)) register(id);
    const rec = _registry.get(id);
    rec.activities.push({
        seq:    ++_seq,
        ts:     new Date().toISOString(),
        type:   type || "generic",
        detail,
    });
}

function getAuditSummary(id) {
    const rec = _registry.get(id);
    if (!rec) return null;

    const last = rec.activities.length > 0
        ? rec.activities[rec.activities.length - 1]
        : null;

    return {
        id:            rec.id,
        name:          rec.name,
        owner:         rec.owner,
        tags:          [...rec.tags],
        registeredAt:  rec.registeredAt,
        lastActivity:  last ? last.ts : null,
        activityCount: rec.activities.length,
        retentionDays: rec.retentionDays,
    };
}

function pruneExpired() {
    const now     = Date.now();
    const pruned  = [];

    for (const [id, rec] of _registry) {
        if (!rec.retentionDays) continue;
        const ageMs   = now - new Date(rec.registeredAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > rec.retentionDays) {
            pruned.push(id);
            _registry.delete(id);
        }
    }

    return { pruned, remaining: _registry.size };
}

function reset() { _registry.clear(); _seq = 0; }

module.exports = {
    register,
    tag,
    untag,
    get,
    list,
    recordActivity,
    getAuditSummary,
    pruneExpired,
    reset,
};
