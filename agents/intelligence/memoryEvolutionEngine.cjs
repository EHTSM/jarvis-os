"use strict";
const { load, flush, uid, NOW, ok, fail } = require("./_intelligenceStore.cjs");
const AGENT = "memoryEvolutionEngine";

const MEMORY_TYPES = {
    insight:    { label:"Insight",    retention:1.0, decay:0.01  },
    hypothesis: { label:"Hypothesis", retention:0.8, decay:0.02  },
    lesson:     { label:"Lesson",     retention:0.9, decay:0.005 },
    failure:    { label:"Failure",    retention:0.7, decay:0.03  },
    pattern:    { label:"Pattern",    retention:1.0, decay:0.008 }
};

function _computeStrength(memory) {
    const ageMs     = Date.now() - new Date(memory.storedAt).getTime();
    const ageDays   = ageMs / 86400000;
    const mtype     = MEMORY_TYPES[memory.type] || MEMORY_TYPES.insight;
    const decayed   = memory.strength * Math.exp(-mtype.decay * ageDays);
    const reinforced = decayed + (memory.accessCount || 0) * 0.05;
    return Math.min(1.0, Math.round(reinforced * 100) / 100);
}

function storeLearning({ userId, goal, type = "insight", content, score = 50, tags = [] }) {
    if (!userId || !content) return fail(AGENT, "userId and content required");
    if (!MEMORY_TYPES[type]) return fail(AGENT, `type must be: ${Object.keys(MEMORY_TYPES).join(", ")}`);

    const memories = load(userId, "evolved_memory", []);
    const memory   = {
        id:          uid("mem"),
        goal:        goal || null,
        type,
        content:     content.slice(0, 500),
        score,
        tags,
        strength:    MEMORY_TYPES[type].retention,
        accessCount: 0,
        storedAt:    NOW(),
        lastAccessed:null
    };

    memories.push(memory);
    flush(userId, "evolved_memory", memories.slice(-1000));

    return ok(AGENT, { memoryId: memory.id, type, strength: memory.strength, storedAt: memory.storedAt });
}

function recallLearnings({ userId, query, type, minStrength = 0.3, limit = 10 }) {
    if (!userId) return fail(AGENT, "userId required");

    let memories = load(userId, "evolved_memory", []);
    memories = memories.map(m => ({ ...m, currentStrength: _computeStrength(m) }));
    memories = memories.filter(m => m.currentStrength >= minStrength);

    if (type)  memories = memories.filter(m => m.type === type);
    if (query) {
        const q = query.toLowerCase();
        memories = memories.filter(m => m.content.toLowerCase().includes(q) || (m.goal || "").toLowerCase().includes(q) || (m.tags || []).some(t => t.toLowerCase().includes(q)));
    }

    // Update access count
    const allMemories = load(userId, "evolved_memory", []);
    const recalledIds = new Set(memories.slice(0, limit).map(m => m.id));
    const updated     = allMemories.map(m => recalledIds.has(m.id) ? { ...m, accessCount: (m.accessCount || 0) + 1, lastAccessed: NOW() } : m);
    flush(userId, "evolved_memory", updated);

    return ok(AGENT, {
        total:    memories.length,
        recalled: memories.slice(0, limit).sort((a,b) => b.currentStrength - a.currentStrength).map(m => ({
            id: m.id, type: m.type, content: m.content, currentStrength: m.currentStrength,
            accessCount: m.accessCount + 1, goal: m.goal, tags: m.tags
        }))
    });
}

function evolveMemory({ userId }) {
    if (!userId) return fail(AGENT, "userId required");

    const memories  = load(userId, "evolved_memory", []);
    const evolved   = memories.map(m => ({ ...m, strength: _computeStrength(m) }));
    const pruned    = evolved.filter(m => m.strength >= 0.1);
    flush(userId, "evolved_memory", pruned);

    return ok(AGENT, {
        totalBefore: memories.length,
        totalAfter:  pruned.length,
        pruned:      memories.length - pruned.length,
        note:        "Weak memories (strength < 0.1) pruned. Remaining memories reinforced based on access patterns."
    });
}

function getMemoryStats({ userId }) {
    if (!userId) return fail(AGENT, "userId required");

    const memories = load(userId, "evolved_memory", []);
    const byType   = {};
    Object.keys(MEMORY_TYPES).forEach(t => { byType[t] = 0; });
    memories.forEach(m => { if (byType[m.type] !== undefined) byType[m.type]++; });

    const avgStrength = memories.length ? (memories.reduce((s,m) => s + (_computeStrength(m)), 0) / memories.length).toFixed(2) : 0;

    return ok(AGENT, { totalMemories: memories.length, byType, avgStrength: parseFloat(avgStrength), memoryTypes: Object.entries(MEMORY_TYPES).map(([k,v]) => ({ type:k, ...v })) });
}

module.exports = { storeLearning, recallLearnings, evolveMemory, getMemoryStats };
