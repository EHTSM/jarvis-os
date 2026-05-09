"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const crypto = require("crypto");
const AGENT  = "memoryBackupAI";

// ⚠️ SIMULATION ONLY — no real neural memory or brain data is stored

const MEMORY_TYPES  = ["episodic","semantic","procedural","emotional","autobiographical"];
const RETENTION_TIERS = { short:7, medium:90, long:365, permanent:Infinity };

function _hashContent(content) {
    return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0,16);
}

function backupMemory({ userId, consent, memoryType = "episodic", content, retentionTier = "medium", tags = [] }) {
    const gate = requireConsent(consent, "memory backup");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!MEMORY_TYPES.includes(memoryType)) return fail(AGENT, `memoryType must be: ${MEMORY_TYPES.join(", ")}`);
    if (!RETENTION_TIERS[retentionTier]) return fail(AGENT, `retentionTier must be: ${Object.keys(RETENTION_TIERS).join(", ")}`);
    if (!content) return fail(AGENT, "content required");

    const entry = {
        id:           uid("mb"),
        memoryType,
        retentionTier,
        retentionDays: RETENTION_TIERS[retentionTier] === Infinity ? "permanent" : RETENTION_TIERS[retentionTier],
        contentHash:  _hashContent(content),
        contentPreview: String(content).slice(0,100),
        tags,
        storedAt:     NOW(),
        ...watermark(AGENT)
    };

    const memories = load(userId, "memory_backups", []);
    memories.push({ id: entry.id, memoryType, retentionTier, tags, storedAt: entry.storedAt });
    flush(userId, "memory_backups", memories.slice(-10000));

    humanAILog(AGENT, userId, "memory_backed_up", { memoryType, retentionTier, hash: entry.contentHash }, "INFO");
    return ok(AGENT, entry);
}

function recallMemory({ userId, consent, memoryId }) {
    const gate = requireConsent(consent, "memory recall");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !memoryId) return fail(AGENT, "userId and memoryId required");

    const memories = load(userId, "memory_backups", []);
    const mem = memories.find(m => m.id === memoryId);
    if (!mem) return fail(AGENT, `memoryId ${memoryId} not found`);

    humanAILog(AGENT, userId, "memory_recalled", { memoryId }, "INFO");
    return ok(AGENT, { ...mem, recalledAt: NOW(), simulatedVividness: Math.round(50 + Math.random() * 50) });
}

function searchMemories({ userId, consent, query, memoryType, limit = 20 }) {
    const gate = requireConsent(consent, "memory search");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    let memories = load(userId, "memory_backups", []);
    if (memoryType) memories = memories.filter(m => m.memoryType === memoryType);
    if (query) {
        const q = String(query).toLowerCase();
        memories = memories.filter(m => m.tags.some(t => t.toLowerCase().includes(q)));
    }

    humanAILog(AGENT, userId, "memory_searched", { query, memoryType, found: memories.length }, "INFO");
    return ok(AGENT, { total: memories.length, results: memories.slice(-limit).reverse() });
}

function deleteMemory({ userId, consent, memoryId, confirm }) {
    const gate = requireConsent(consent, "memory deletion");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !memoryId) return fail(AGENT, "userId and memoryId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete a memory backup");

    let memories = load(userId, "memory_backups", []);
    const before = memories.length;
    memories = memories.filter(m => m.id !== memoryId);
    if (memories.length === before) return fail(AGENT, `memoryId ${memoryId} not found`);
    flush(userId, "memory_backups", memories);

    humanAILog(AGENT, userId, "memory_deleted", { memoryId }, "WARN");
    return ok(AGENT, { deleted: memoryId, right_to_erasure: "honoured" });
}

function getMemoryStats({ userId, consent }) {
    const gate = requireConsent(consent, "memory stats");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const memories = load(userId, "memory_backups", []);
    const byType = {};
    MEMORY_TYPES.forEach(t => { byType[t] = memories.filter(m => m.memoryType === t).length; });
    return ok(AGENT, { total: memories.length, byType, memoryTypes: MEMORY_TYPES, retentionTiers: Object.keys(RETENTION_TIERS) });
}

module.exports = { backupMemory, recallMemory, searchMemories, deleteMemory, getMemoryStats };
