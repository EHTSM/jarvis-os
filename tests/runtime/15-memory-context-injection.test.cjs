"use strict";
/**
 * Phase B.10 regression: recalled memory must actually reach the AI context.
 *
 * contextBuilder.build() assembles the context handed to AI workflows and has a
 * dedicated "Engineering memory recall" step. It read the recall result as:
 *
 *     engineeringMemory = Array.isArray(recall) ? recall : [];
 *
 * but engineeringMemoryEngine.recall() returns an ENVELOPE:
 *
 *     { query, totalFound, results: [...] }
 *
 * and never a bare array — so the guard always took the `[]` branch and every
 * recalled memory was discarded. Reproduced live across three queries:
 * isArray=false in all cases, including one reporting totalFound=1 that still
 * produced engineeringMemory=[]. Memory was stored, durable and searchable —
 * it simply never reached the AI that the field exists to inform.
 *
 * Verified after the fix: recall('connection pool') → totalFound=1 →
 * contextBuilder engineeringMemory = 1 entry (was 0).
 *
 * These tests pin the envelope contract on both sides, since it is the mismatch
 * between them that regressed.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT = path.join(__dirname, "../..");
const eme  = require("../../backend/services/engineeringMemoryEngine.cjs");
const cb   = require("../../backend/services/contextBuilder.cjs");

/** The corrected unwrap, as applied in contextBuilder. */
function unwrap(recall) {
    return Array.isArray(recall)          ? recall
         : Array.isArray(recall?.results) ? recall.results
         : [];
}

describe("memory → AI context injection (Phase B.10)", () => {
    it("recall() returns an envelope, not a bare array", () => {
        // If this ever changes, the unwrap below must be revisited deliberately.
        return eme.recall({ query: "connection pool", limit: 5 }).then(r => {
            assert.equal(Array.isArray(r), false, "recall returns an envelope object");
            assert.ok(Array.isArray(r.results), "the envelope must carry a results array");
            assert.equal(typeof r.totalFound, "number", "the envelope must report totalFound");
        });
    });

    it("the old guard would have discarded a populated recall", () => {
        const populated = { query: "q", totalFound: 2, results: [{ source: "rule" }, { source: "lesson" }] };
        // This is precisely what the bug did.
        const legacy = Array.isArray(populated) ? populated : [];
        assert.equal(legacy.length, 0, "the legacy guard drops real results");
        assert.equal(unwrap(populated).length, 2, "the fixed unwrap keeps them");
    });

    it("unwraps the envelope, a bare array, and empty/absent results safely", () => {
        assert.deepEqual(unwrap({ results: [1, 2, 3] }), [1, 2, 3]);
        assert.deepEqual(unwrap([4, 5]), [4, 5]);
        assert.deepEqual(unwrap({ results: [] }), []);
        assert.deepEqual(unwrap({}), []);
        assert.deepEqual(unwrap(null), []);
        assert.deepEqual(unwrap(undefined), []);
        assert.deepEqual(unwrap("nonsense"), []);
    });

    it("contextBuilder carries recalled memory through to the built context", async () => {
        // "connection pool" is a query the live recall sources genuinely match.
        const r   = await eme.recall({ query: "connection pool", limit: 5 });
        const ctx = await cb.build("connection pool", {});
        assert.ok(Array.isArray(ctx.engineeringMemory),
            "engineeringMemory must remain an array — consumers rely on that shape");
        assert.equal(ctx.engineeringMemory.length, (r.results || []).length,
            "every recalled memory must reach the context, not be silently dropped");
    });

    it("keeps engineeringMemory an array even when recall finds nothing", async () => {
        const ctx = await cb.build(`b10-no-match-${Date.now()}-zzzz`, {});
        assert.ok(Array.isArray(ctx.engineeringMemory));
    });

    it("contextBuilder no longer uses the array-only guard", () => {
        const src = fs.readFileSync(path.join(ROOT, "backend/services/contextBuilder.cjs"), "utf8");
        assert.ok(src.includes("Array.isArray(recall?.results)"),
            "the envelope branch must exist or recalled memory is dropped again");
    });
});
