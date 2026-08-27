"use strict";
/**
 * Phase B.7 regression: list-limit params must clamp to a sane lower bound.
 *
 * 23 list endpoints across 4 route files sized their result with
 *     Math.min(parseInt(req.query.n) || 50, 500)
 * which caps the UPPER bound but passes negatives straight through, because
 * Math.min(-5, 500) === -5. The value then reached Array.prototype.slice(0, n),
 * where a negative offset counts from the END — so it silently returned
 * "everything except the last N" instead of "N items".
 *
 * Reproduced live 3/3 on GET /runtime/dead-letter?n=-5 → count=995 while the
 * declared cap was 500. Fixed by wrapping each expression in Math.max(1, ...),
 * preserving every existing default and cap.
 *
 * These tests pin the arithmetic contract itself (not one endpoint), because
 * that is what regressed and what the 23 call sites share.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/** The corrected sizing expression, as applied at all 23 call sites. */
function clamp(raw, dflt, cap) {
    return Math.max(1, Math.min(parseInt(raw) || dflt, cap));
}
/** The original, buggy expression — kept to document what must never return. */
function legacy(raw, dflt, cap) {
    return Math.min(parseInt(raw) || dflt, cap);
}

describe("list limit clamping (Phase B.7)", () => {
    it("never yields a negative size, so slice() cannot count from the end", () => {
        for (const raw of ["-1", "-5", "-500", "-99999"]) {
            assert.equal(clamp(raw, 50, 500), 1, `n=${raw} must clamp to 1`);
            assert.ok(legacy(raw, 50, 500) < 0, `n=${raw} was negative before the fix`);
        }
    });

    it("proves the negative-slice behavior the bug exposed", () => {
        const rows = Array.from({ length: 10 }, (_, i) => i);
        assert.equal(rows.slice(0, legacy("-5", 50, 500)).length, 5,
            "slice(0,-5) returns all-but-last-5 — the leak mechanism");
        assert.equal(rows.slice(0, clamp("-5", 50, 500)).length, 1,
            "clamped size returns exactly 1 row");
    });

    it("still honours the declared upper cap", () => {
        assert.equal(clamp("99999", 50, 500), 500);
        assert.equal(clamp("501", 50, 500), 500);
        assert.equal(clamp("500", 50, 500), 500);
    });

    it("still honours the declared default for absent/invalid input", () => {
        for (const raw of [undefined, "", "abc", "null", "0"]) {
            assert.equal(clamp(raw, 50, 500), 50, `raw=${JSON.stringify(raw)} must use the default`);
        }
    });

    it("passes valid in-range values through unchanged", () => {
        for (const n of [1, 2, 17, 250, 499]) {
            assert.equal(clamp(String(n), 50, 500), n);
        }
    });

    it("holds for every default/cap pair used across the 23 call sites", () => {
        const pairs = [[10, 20], [10, 50], [20, 50], [20, 100], [30, 150], [50, 200], [50, 500], [100, 500]];
        for (const [dflt, cap] of pairs) {
            assert.equal(clamp("-9", dflt, cap), 1,      `[${dflt},${cap}] negative must clamp to 1`);
            assert.equal(clamp("999999", dflt, cap), cap, `[${dflt},${cap}] must respect cap`);
            assert.equal(clamp("abc", dflt, cap), dflt,   `[${dflt},${cap}] must respect default`);
        }
    });
});
