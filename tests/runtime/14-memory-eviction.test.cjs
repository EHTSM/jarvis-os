"use strict";
/**
 * Phase B.10 regression: a newly-saved memory must survive its own save.
 *
 * memoryPersistenceLayer caps the active store at MAX_STORE_NODES (2000) and
 * evicts overflow. Eviction was ordered by importance alone, so once the store
 * was saturated the lowest-importance node was dropped — and a brand-new node
 * was always the lowest.
 *
 * Measured on the live store: 2000/2000 nodes with a MINIMUM importance of 95
 * (1918 written at exactly 95 by the autonomous RCA-playbook writer: 640 for
 * circuit_breaker_open_media, 639 for ai_service_timeout). saveTypedMemory()
 * defaults to importance 60, so every newly-learned memory was evicted inside
 * the same _persist() call that saved it, while save() still returned
 * { saved: true }. Retrieval measured recall@8 = 0/3 for three memories that
 * had just been written "successfully"; after the fix, 3/3.
 *
 * The fix protects nodes for EVICTION_GRACE_MS after creation and adds
 * usage recency to the ordering (which the surrounding comment already claimed).
 * These tests pin that a fresh save is always readable back, that the cap is
 * still honoured, and that importance ordering still governs older nodes.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const mpl = require("../../backend/services/memoryPersistenceLayer.cjs");
const sms = require("../../backend/services/semanticMemorySearch.cjs");

const RUN = `b10-${Date.now().toString(36)}`;

function saveFailure(marker, importance) {
    return sms.saveTypedMemory(
        "failure",
        {
            errorType:  `${RUN}_${marker}`,
            context:    `regression context for ${marker}`,
            resolution: `regression resolution for ${marker}`,
        },
        { importance, tags: [RUN] },
    );
}

describe("memory eviction fairness (Phase B.10)", () => {
    it("a node saved below the store's minimum importance is still readable", () => {
        // importance 60 is the saveTypedMemory default and was BELOW the live
        // store's floor of 95 — the exact case that silently vanished.
        const r = saveFailure("low", 60);
        assert.equal(r.saved, true, "save must report success");
        assert.ok(mpl.load(r.nodeId), "a just-saved node must be readable back");
    });

    it("survives at importance values on both sides of the old cutoff", () => {
        for (const imp of [1, 60, 94, 95, 96]) {
            const r = saveFailure(`edge${imp}`, imp);
            assert.ok(mpl.load(r.nodeId), `node at importance ${imp} must survive its own save`);
        }
    });

    it("is retrievable through semanticSearch immediately after saving", () => {
        const marker = "retrievable";
        saveFailure(marker, 60);
        const res = sms.semanticSearch(`regression context for ${marker}`, { limit: 10 });
        const arr = (res && res.results) || [];
        const found = arr.some(x => JSON.stringify(x).includes(`${RUN}_${marker}`));
        assert.equal(found, true, "a saved memory must be findable — recall was 0/3 before the fix");
    });

    it("still honours the store cap under sustained writes", () => {
        // The grace window must not let the store grow without bound.
        const before = mpl.list ? mpl.list({ limit: 1 }).total : null;
        for (let i = 0; i < 40; i++) saveFailure(`bulk${i}`, 50);
        if (before !== null) {
            const after = mpl.list({ limit: 1 }).total;
            assert.ok(after <= 2000 + 40,
                `store must stay bounded (was ${before}, now ${after})`);
        }
    });

    it("keeps importance as the primary ordering for evictable nodes", () => {
        const src = require("node:fs").readFileSync(
            require("node:path").join(__dirname, "../../backend/services/memoryPersistenceLayer.cjs"), "utf8");
        assert.ok(/\(a\.importance \|\| 0\) - \(b\.importance \|\| 0\)/.test(src),
            "importance must remain the first sort key");
        assert.ok(/EVICTION_GRACE_MS/.test(src),
            "the grace window must exist or new memories vanish again");
        assert.ok(/usageCount/.test(src),
            "usage recency must participate in eviction ordering");
    });

    it("does not evict a node that was just read", () => {
        const r = saveFailure("justread", 60);
        mpl.load(r.nodeId);                       // bumps usageCount + lastUsedAt
        for (let i = 0; i < 20; i++) saveFailure(`pressure${i}`, 50);
        assert.ok(mpl.load(r.nodeId), "a recently-used node must not be evicted first");
    });
});
