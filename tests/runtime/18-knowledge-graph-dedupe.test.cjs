"use strict";
/**
 * Phase B.12 regression: graph edge dedupe must be total, regardless of id type.
 *
 * knowledgeGraph.addEdge() deduplicates by (fromType, fromId, relation, toType,
 * toId) using ===. That is correct for strings but NEVER matches a non-string
 * id, because {a:1} === {a:1} is false (reference comparison). Every full
 * reindex therefore appended a fresh copy of any edge whose id was not a
 * primitive — an unbounded leak in the knowledge graph.
 *
 * Reproduced 3/3 live: POST /graph/index reported a constant indexed=1432 while
 * totalEdges grew 1482 → 1483 → 1484 → 1485, exactly +1 per run. Auditing the
 * store found precisely ONE duplicated logical edge, already at x5:
 *     ("user", {"a":1}, "member_of", "org", "org_1786219169715_1")
 * That non-string id came from Phase B.4 input-validation testing (POST
 * /orgs/:orgId/members with accountId={"a":1}), recorded there as F5 — so this
 * is the downstream consequence of that still-open input gap.
 *
 * After the fix, 5 consecutive full reindexes held totalEdges flat at 1530, and
 * the 4 historical surplus rows were removed via the existing removeEdge().
 *
 * These tests pin value-based dedupe, that primitives keep their fast identity
 * path, and that distinct ids are still treated as distinct.
 */
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const kg  = require("../../backend/services/knowledgeGraph.cjs");
const SRC = path.join(__dirname, "../../backend/services/knowledgeGraph.cjs");

const RUN = `b12-${Date.now().toString(36)}`;
const created = [];

function add(fromId, toId = `org_${RUN}`) {
    const e = kg.addEdge("user", fromId, kg.RELATIONS.MEMBER_OF, "org", toId);
    if (e && e.edgeId) created.push(e.edgeId);
    return e;
}

after(() => {
    // Remove only what this suite created.
    for (const id of new Set(created)) {
        try { kg.removeEdge(id); } catch { /* already gone */ }
    }
});

describe("knowledge graph edge dedupe (Phase B.12)", () => {
    it("dedupes a repeated STRING id (unchanged fast path)", () => {
        const before = kg.getStats().totalEdges;
        const a = add(`${RUN}_str`);
        const mid = kg.getStats().totalEdges;
        const b = add(`${RUN}_str`);
        const after = kg.getStats().totalEdges;
        assert.equal(mid, before + 1, "first add must create an edge");
        assert.equal(after, mid, "a repeated string id must not create a second edge");
        assert.equal(a.edgeId, b.edgeId, "dedupe must return the existing edge");
    });

    it("dedupes a repeated NON-STRING id — the reproduced leak", () => {
        const before = kg.getStats().totalEdges;
        add({ a: 1 }, `org_${RUN}_obj`);
        const mid = kg.getStats().totalEdges;
        // A structurally identical but distinct object: === would never match.
        add({ a: 1 }, `org_${RUN}_obj`);
        const after = kg.getStats().totalEdges;
        assert.equal(mid, before + 1, "first add must create an edge");
        assert.equal(after, mid,
            "an equal-by-value object id must dedupe — this grew +1 per reindex before the fix");
    });

    it("stays flat across repeated adds (idempotency under reindex pressure)", () => {
        add({ nested: { deep: true } }, `org_${RUN}_deep`);
        const stable = kg.getStats().totalEdges;
        for (let i = 0; i < 5; i++) add({ nested: { deep: true } }, `org_${RUN}_deep`);
        assert.equal(kg.getStats().totalEdges, stable,
            "5 further identical adds must not grow the store");
    });

    it("still treats genuinely different ids as different edges", () => {
        const before = kg.getStats().totalEdges;
        add({ a: 1 }, `org_${RUN}_distinct`);
        add({ a: 2 }, `org_${RUN}_distinct`);
        assert.equal(kg.getStats().totalEdges, before + 2,
            "dedupe must not collapse distinct ids");
    });

    it("still treats different relations as different edges", () => {
        const before = kg.getStats().totalEdges;
        kg.addEdge("user", `${RUN}_rel`, kg.RELATIONS.MEMBER_OF, "org", `org_${RUN}_rel`);
        kg.addEdge("user", `${RUN}_rel`, kg.RELATIONS.OWNS,      "org", `org_${RUN}_rel`);
        assert.equal(kg.getStats().totalEdges, before + 2);
        for (const e of kg.getEdges({ fromId: `${RUN}_rel` }).edges || []) created.push(e.edgeId);
    });

    it("compares by value rather than identity in the source", () => {
        const src = fs.readFileSync(SRC, "utf8");
        const fn  = src.slice(src.indexOf("function addEdge"), src.indexOf("function removeEdge"));
        assert.ok(/JSON\.stringify/.test(fn),
            "dedupe must fall back to a value comparison for non-primitive ids");
        assert.ok(!/e\.fromId === fromId &&/.test(fn),
            "the identity-only comparison must be gone or the leak returns");
    });

    it("leaves the live store free of duplicate logical edges", () => {
        const store = JSON.parse(fs.readFileSync(
            path.join(__dirname, "../../data/knowledge-graph-edges.json"), "utf8"));
        const edges = store.edges || store;
        const seen = new Map();
        for (const e of edges) {
            const k = JSON.stringify([e.fromType, e.fromId, e.relation, e.toType, e.toId]);
            seen.set(k, (seen.get(k) || 0) + 1);
        }
        const dups = [...seen.values()].filter(n => n > 1);
        assert.equal(dups.length, 0,
            `the live graph must carry no duplicate logical edges (found ${dups.length} sets)`);
    });
});
