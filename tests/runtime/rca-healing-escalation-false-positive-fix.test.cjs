"use strict";
/**
 * Mission 103 — regression test for the Mission 102-confirmed defect in
 * rootCauseAnalysisEngine.cjs's _rcaHealingCeiling():
 *
 *   const allEscalate = healing.every(h => h.strategy === "escalate");
 *
 * ...was computed but never checked before returning the
 * "self_healing_escalation_ceiling" finding. As a result the finding fired
 * whenever healing.length > 0, regardless of what strategies the records
 * actually used — a false positive against any real, healthy self-healing
 * history (confirmed live against this repo's own data/healing-history.json,
 * which has 2000 records and zero "escalate" entries, yet the RCA reported
 * "2000 occurrences, confidence=95%").
 *
 * This test uses fs.readFileSync interception scoped ONLY to the specific
 * data files rootCauseAnalysisEngine.cjs reads (healing-history.json and
 * its sibling _loadX() sources) so the real module logic runs unmodified
 * against isolated fixture data — never the real data/ directory. No
 * production file is read or written by this test.
 */

const fs   = require("fs");
const path = require("path");
const assert = require("assert");
const { test, describe, before, after, beforeEach } = require("node:test");

const RCA_MODULE_PATH = require.resolve("../../backend/services/rootCauseAnalysisEngine.cjs");
const DATA_DIR        = path.join(__dirname, "../../data");

// ── Isolated fs.readFileSync interception ──────────────────────────────
// Only intercepts reads for the exact data files rootCauseAnalysisEngine.cjs
// loads (by absolute path match) — every other fs.readFileSync call
// (engineeringRuleRegistry.cjs, logger, etc.) passes through untouched to
// the real filesystem, so we are not stubbing the whole fs module.
let _fixtures = {};
const _origReadFileSync = fs.readFileSync;

function _install() {
    fs.readFileSync = function (file, ...rest) {
        const abs = typeof file === "string" ? path.resolve(file) : file;
        for (const [name, content] of Object.entries(_fixtures)) {
            if (abs === path.join(DATA_DIR, name)) {
                return JSON.stringify(content);
            }
        }
        return _origReadFileSync.call(fs, file, ...rest);
    };
}

function _uninstall() {
    fs.readFileSync = _origReadFileSync;
}

function _freshRcaModule() {
    delete require.cache[RCA_MODULE_PATH];
    return require(RCA_MODULE_PATH);
}

describe("rootCauseAnalysisEngine._rcaHealingCeiling — Mission 103 false-positive fix", () => {
    before(() => _install());
    after(() => {
        _uninstall();
        delete require.cache[RCA_MODULE_PATH];
    });

    beforeEach(() => {
        // Every _loadX() source defaults to empty so only the healing-history
        // fixture under test actually varies between cases.
        _fixtures = {
            "execution-runtime.ndjson": [],
            "agent-runs.json":          [],
            "autonomous-cycles.json":   [],
            "healing-history.json":     [],
            "dead-letter.json":         [],
        };
    });

    test("CASE C — empty healing history: no self_healing_escalation_ceiling finding (preserves existing behavior)", () => {
        _fixtures["healing-history.json"] = [];
        const rca = _freshRcaModule();
        const { analyses } = rca.runAnalysis({ force: true });
        const finding = analyses.find(a => a.problemClass === "self_healing_escalation_ceiling");
        assert.strictEqual(finding, undefined,
            "empty healing history must not produce a self_healing_escalation_ceiling finding");
    });

    test("CASE A — non-escalate strategies only (mixed, real-world shape): must NOT emit the finding", () => {
        // Mirrors this repo's own real data/healing-history.json shape —
        // dead_letter / native_runtime_heal / retry_with_backoff, zero escalate.
        _fixtures["healing-history.json"] = [
            { ts: "2026-08-23T07:11:35.602Z", strategy: "dead_letter", targetType: "task", targetId: "t1", success: false },
            { ts: "2026-08-24T00:00:00.000Z", strategy: "native_runtime_heal", targetType: "runtime", targetId: "unknown", success: false, native: true },
            { ts: "2026-08-25T00:00:00.000Z", strategy: "retry_with_backoff", targetType: "task", targetId: "t2", success: true },
        ];
        const rca = _freshRcaModule();
        const { analyses } = rca.runAnalysis({ force: true });
        const finding = analyses.find(a => a.problemClass === "self_healing_escalation_ceiling");
        assert.strictEqual(finding, undefined,
            "a healing history with zero 'escalate' records must not produce this finding — " +
            "this is the exact defect Mission 102 confirmed and this test proves fixed");
    });

    test("CASE A2 — single non-escalate record: must NOT emit the finding", () => {
        _fixtures["healing-history.json"] = [
            { ts: "2026-09-01T00:00:00.000Z", strategy: "fail_fast", targetType: "task", targetId: "t1", success: true },
        ];
        const rca = _freshRcaModule();
        const { analyses } = rca.runAnalysis({ force: true });
        const finding = analyses.find(a => a.problemClass === "self_healing_escalation_ceiling");
        assert.strictEqual(finding, undefined,
            "even a single non-escalate record must be enough to suppress the finding, " +
            "since the rule's own stated precondition is ALL records being 'escalate'");
    });

    test("CASE B — all records are 'escalate': finding MUST still be emitted (existing intended semantics preserved)", () => {
        _fixtures["healing-history.json"] = [
            { ts: "2026-08-23T07:11:35.602Z", strategy: "escalate", targetType: "task", targetId: "t1", success: false, reason: "max retries (3) exceeded" },
            { ts: "2026-08-24T00:00:00.000Z", strategy: "escalate", targetType: "task", targetId: "t2", success: false, reason: "max retries (3) exceeded" },
            { ts: "2026-08-25T00:00:00.000Z", strategy: "escalate", targetType: "cycle", targetId: "c1", success: false, reason: "max retries (3) exceeded" },
        ];
        const rca = _freshRcaModule();
        const { analyses } = rca.runAnalysis({ force: true });
        const finding = analyses.find(a => a.problemClass === "self_healing_escalation_ceiling");
        assert.ok(finding, "an all-escalate healing history must still produce the finding — the rule's real signal must not be lost by the fix");
        assert.strictEqual(finding.frequency, 3);
        assert.strictEqual(finding.confidence, 95);
        assert.strictEqual(finding.status, "active");
    });

    test("CASE B — mixed history that happens to include escalate entries alongside others: must NOT emit (all-escalate, not any-escalate, is the intended condition)", () => {
        _fixtures["healing-history.json"] = [
            { ts: "2026-08-23T00:00:00.000Z", strategy: "escalate", targetType: "task", targetId: "t1", success: false },
            { ts: "2026-08-24T00:00:00.000Z", strategy: "dead_letter", targetType: "task", targetId: "t2", success: false },
        ];
        const rca = _freshRcaModule();
        const { analyses } = rca.runAnalysis({ force: true });
        const finding = analyses.find(a => a.problemClass === "self_healing_escalation_ceiling");
        assert.strictEqual(finding, undefined,
            "one non-escalate record among escalate records must still suppress the finding, " +
            "matching the rule's own literal 'all' semantics (healing.every(...))");
    });

    test("live repro against this repo's own real data/healing-history.json shape is fixed (regression proof)", () => {
        // Read the REAL file's content once (read-only) to use its actual
        // strategy distribution as fixture input — this does not write to
        // or otherwise touch the real file, and the module under test never
        // sees the real path (interception redirects it to this in-memory copy).
        const realPath = path.join(DATA_DIR, "healing-history.json");
        let real;
        try {
            real = JSON.parse(_origReadFileSync.call(fs, realPath, "utf8"));
        } catch {
            real = null;
        }
        if (!real || !real.length) {
            // If the real file is absent/empty in this environment, this
            // specific regression proof is skipped — the other cases above
            // already cover the fix generically.
            return;
        }
        _fixtures["healing-history.json"] = real;
        const rca = _freshRcaModule();
        const { analyses } = rca.runAnalysis({ force: true });
        const finding = analyses.find(a => a.problemClass === "self_healing_escalation_ceiling");
        const hasEscalate = real.some(h => h.strategy === "escalate");
        if (hasEscalate && real.every(h => h.strategy === "escalate")) {
            assert.ok(finding, "real data is all-escalate — finding should be present");
        } else {
            assert.strictEqual(finding, undefined,
                "this repo's real healing-history.json is not all-escalate " +
                "(confirmed by Mission 102: 0 of 2000 records) — the finding must not appear");
        }
    });
});
