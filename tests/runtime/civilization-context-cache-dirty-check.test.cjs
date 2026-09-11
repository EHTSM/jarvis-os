"use strict";
/**
 * Mission 115 — regression test for the Mission 114-confirmed defect:
 * civilizationState.cjs's getCivilizationHealth() (line ~842-878) persists
 * context.json unconditionally on every call, even when nothing changed —
 * every dashboard/health read causes a disk write, a defect Mission 114
 * classified P3/Informational and Mission 113 was surprised by directly.
 *
 * This test proves the dirty-check fix: getCivilizationHealth() must skip
 * the context.json write when the newly-computed membersCount/healthScore
 * are identical to what's already cached, and must still write when they
 * genuinely differ.
 *
 * Isolation: sets JARVIS_TEST_DATA_SUFFIX before any require(), matching
 * the established convention (civilizationState.cjs already honors it,
 * same as Mission 107/113's own test files) — this test never reads or
 * writes the real data/civilization/*.json files.
 *
 * Write-count instrumentation: getCivilizationHealth() calls the internal
 * (module-local) updateCivContext()/​_save("context") -> fs.writeFileSync,
 * not the exported reference — so a spy on the exported updateCivContext
 * would NOT observe an internal call. Instead this test spies on
 * fs.writeFileSync itself, filtered to this test's own isolated
 * context.json path, which is the one boundary every write path (both
 * the getCivilizationHealth() side effect and the explicit
 * updateCivContext() API) must cross regardless of internal call routing.
 */
process.env.JARVIS_TEST_DATA_SUFFIX = process.env.JARVIS_TEST_DATA_SUFFIX || `test-${process.pid}-${Date.now()}`;

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test, describe, before, beforeEach, after } = require("node:test");

const st = require("../../backend/services/civilizationState.cjs");

const TS = Date.now();
const CONTEXT_PATH = path.join(__dirname, "../../data", `civilization.${process.env.JARVIS_TEST_DATA_SUFFIX}`, "context.json");

let writeFileSyncCalls = [];
const originalWriteFileSync = fs.writeFileSync;

function installSpy() {
    writeFileSyncCalls = [];
    fs.writeFileSync = function (filePath, ...args) {
        if (String(filePath) === CONTEXT_PATH) writeFileSyncCalls.push({ filePath, at: Date.now() });
        return originalWriteFileSync.call(fs, filePath, ...args);
    };
}
function uninstallSpy() {
    fs.writeFileSync = originalWriteFileSync;
}
function contextWriteCount() {
    return writeFileSyncCalls.length;
}

describe("civilizationState.getCivilizationHealth() — Mission 115 context-cache dirty-check fix", () => {
    before(() => {
        // Register one real member so getCivilizationHealth()'s derived
        // membersCount/healthScore are deterministic and non-zero across
        // this test's calls, avoiding the members===0 "critical" alert
        // branch which is an unrelated code path.
        const r = st.registerMember({ name: `ContextFixOrg-${TS}`, type: "organization" });
        assert.ok(r.ok, `test setup failed: could not register a member: ${r.error}`);
    });

    beforeEach(() => {
        installSpy();
    });

    after(() => {
        uninstallSpy();
    });

    test("CASE 1 — getCivilizationHealth() still returns the correct health object, AND the first required context update persists correctly", () => {
        // This is genuinely the very first call to getCivilizationHealth() in
        // this isolated data dir (before() above only calls registerMember,
        // never getCivilizationHealth) — the cache started at DEFAULTS
        // (membersCount:0, healthScore:100), which differs from the real
        // computed values below, so a persist MUST occur here.
        const before1 = contextWriteCount();
        const h = st.getCivilizationHealth();
        const after1 = contextWriteCount();

        assert.ok(h && typeof h.score === "number", "health object missing numeric score");
        assert.ok(h.layers && h.layers.civilization, "health object missing civilization layer");
        assert.strictEqual(h.layers.civilization.members, 1, "expected exactly 1 active member (the one registered in before())");

        assert.ok(after1 > before1, "first health computation (differing from DEFAULTS) must persist to context.json");
        const ctx = st.getCivContext();
        assert.strictEqual(ctx.membersCount, h.layers.civilization.members, "context.membersCount must match the just-computed value after the first persist");
        assert.strictEqual(ctx.healthScore, h.score, "context.healthScore must match the just-computed value after the first persist");
    });

    test("CASE 2 — a second call immediately after the first genuinely-dirty persist does not persist again (dirty-check re-engages right away)", () => {
        const before1 = contextWriteCount();
        st.getCivilizationHealth();
        const after1 = contextWriteCount();
        assert.strictEqual(after1, before1, "the call immediately following the first genuine persist must already see stable values and skip the write");
    });

    test("CASE 3 — calling getCivilizationHealth() again with identical derived values does NOT rewrite context.json", () => {
        // State hasn't changed since CASE 2 (no new member, no new dispute,
        // no new treaty, no new reputation event) — the derived
        // membersCount/healthScore must be identical, so no write should occur.
        const before1 = contextWriteCount();
        const h1 = st.getCivilizationHealth();
        const after1 = contextWriteCount();
        assert.strictEqual(after1, before1,
            "a second call with unchanged derived values must NOT write context.json again — " +
            "this is the exact Mission 114 defect: the pre-fix implementation writes unconditionally every call");

        const before2 = contextWriteCount();
        const h2 = st.getCivilizationHealth();
        const after2 = contextWriteCount();
        assert.strictEqual(after2, before2, "a third consecutive identical call must also skip the write");

        assert.strictEqual(h1.score, h2.score, "repeated calls must still return the correct, consistent health score");
    });

    test("CASE 4 — context.json content remains unchanged when there is no dirty state", () => {
        const ctxBefore = JSON.stringify(st.getCivContext());
        st.getCivilizationHealth();
        st.getCivilizationHealth();
        const ctxAfter = JSON.stringify(st.getCivContext());
        assert.strictEqual(ctxAfter, ctxBefore, "context object content must be byte-identical across repeated no-op health calls");

        // Also verify at the actual file level, not just the in-memory cache.
        const fileBefore = fs.readFileSync(CONTEXT_PATH, "utf8");
        st.getCivilizationHealth();
        const fileAfter = fs.readFileSync(CONTEXT_PATH, "utf8");
        assert.strictEqual(fileAfter, fileBefore, "the on-disk context.json bytes must be unchanged when nothing is dirty");
    });

    test("CASE 5 — when a tracked context field genuinely changes, persistence still occurs", () => {
        // Register a second member -> membersCount must change -> a write
        // must occur on the NEXT getCivilizationHealth() call.
        const r = st.registerMember({ name: `ContextFixOrg2-${TS}`, type: "organization" });
        assert.ok(r.ok, `could not register second member: ${r.error}`);

        const before1 = contextWriteCount();
        const h = st.getCivilizationHealth();
        const after1 = contextWriteCount();
        assert.ok(after1 > before1,
            "a genuine membersCount change must still trigger a context.json write — the dirty-check " +
            "must never suppress a real update, only a no-op repeat");
        assert.strictEqual(h.layers.civilization.members, 2, "expected exactly 2 active members after the second registration");

        const ctx = st.getCivContext();
        assert.strictEqual(ctx.membersCount, 2, "context.membersCount must reflect the genuine change after persistence");

        // And immediately calling again with the now-stable (2-member) state
        // must go back to skipping the write, proving the dirty-check
        // re-engages correctly after a real change.
        const before2 = contextWriteCount();
        st.getCivilizationHealth();
        const after2 = contextWriteCount();
        assert.strictEqual(after2, before2, "after a genuine change persists, the very next identical call must skip the write again");
    });

    test("CASE 6 — existing dashboard behavior remains correct", () => {
        const db = st.getCivilizationDashboard();
        assert.ok(db && db.civilization && db.civilization.reputation, "dashboard missing expected civilization.reputation section");
        assert.ok(db.health && typeof db.health.score === "number", "dashboard missing expected health.score");
        assert.ok(db.context && typeof db.context.membersCount === "number", "dashboard's embedded context field must still be present and populated");
        // The dashboard's own embedded context field must reflect the
        // just-computed values (getCivilizationHealth runs first inside
        // getCivilizationDashboard, so by the time `context: _cx()` is
        // read, the cache already holds the fresh values) — unaffected by
        // the dirty-check fix, since the fix only skips the WRITE, never
        // the in-memory update needed for this same-call read-back.
        assert.strictEqual(db.context.membersCount, db.health.layers.civilization.members,
            "dashboard's embedded context.membersCount must match its own health.layers.civilization.members in the same call");
    });

    test("CASE 7 — explicit updateCivContext() API remains fully compatible (unrelated write path, untouched by the fix)", () => {
        const before1 = contextWriteCount();
        const r = st.updateCivContext({ phase: "expansion" });
        const after1 = contextWriteCount();
        assert.ok(after1 > before1, "updateCivContext() must always persist — it is an explicit, intentional write, not subject to the dirty-check");
        assert.strictEqual(r.phase, "expansion");
        // Restore phase so this test doesn't leave cross-test-file state
        // dependent on ordering (this isolated store is per-process anyway,
        // but keep behavior explicit).
        st.updateCivContext({ phase: "active" });
    });
});
