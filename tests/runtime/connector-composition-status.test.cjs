"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const conn = require("../../backend/services/integrationConnectors.cjs");

describe("integrationConnectors — Phase 7 composition status vocabulary", () => {

    describe("getCompositionStatus() — derived, not hand-authored per connector", () => {
        it("maps a MISSING-status connector to NEEDS_CREDENTIALS when a real adapter exists and only the credential is absent (100-Company Missing Capability Build-Out, Phase 5: fixed a real bug — ai:deepseek/anthropic/gemini/etc. have genuine adapters, real base URLs, real probe calls; MISSING there only ever meant 'API key env var not set', the same situation git:github's READY status already correctly maps to NEEDS_CREDENTIALS for)", () => {
            const all = conn.getAllStatus();
            const missingWithRealCreds = all.find(c => c.status === "MISSING" && (c.credentials?.required?.length || 0) > 0);
            if (missingWithRealCreds) {
                const composed = conn.getCompositionStatus(missingWithRealCreds.id);
                assert.equal(composed.status, "NEEDS_CREDENTIALS", `${missingWithRealCreds.id} has a real required credential — must be NEEDS_CREDENTIALS, not a false NOT_IMPLEMENTED`);
                assert.equal(composed.legacyStatus, "MISSING");
            }
        });
        it("maps a MISSING-status connector to NOT_IMPLEMENTED only when it has no real adapter at all (empty required-credentials array — e.g. ai:stability/ai:elevenlabs, which have zero adapter code, confirmed by direct source read)", () => {
            const all = conn.getAllStatus();
            const missingNoAdapter = all.find(c => c.status === "MISSING" && (c.credentials?.required?.length || 0) === 0);
            if (missingNoAdapter) {
                const composed = conn.getCompositionStatus(missingNoAdapter.id);
                assert.equal(composed.status, "NOT_IMPLEMENTED", `${missingNoAdapter.id} has no real adapter/credential requirement — genuinely NOT_IMPLEMENTED`);
                assert.equal(composed.legacyStatus, "MISSING");
            }
        });
        it("maps a real READY-status connector to NEEDS_CREDENTIALS or CONFIGURED_UNVERIFIED depending on missing creds", () => {
            const all = conn.getAllStatus();
            const ready = all.find(c => c.status === "READY");
            if (ready) {
                const composed = conn.getCompositionStatus(ready.id);
                assert.ok(["NEEDS_CREDENTIALS", "CONFIGURED_UNVERIFIED"].includes(composed.status));
                assert.equal(composed.legacyStatus, "READY");
                if ((ready.credentials?.missing || []).length > 0) {
                    assert.equal(composed.status, "NEEDS_CREDENTIALS");
                } else {
                    assert.equal(composed.status, "CONFIGURED_UNVERIFIED");
                }
            }
        });
        it("maps a real PARTIAL-status connector to a specific failure reason, never a generic CONNECTED_VERIFIED", () => {
            const all = conn.getAllStatus();
            const partial = all.find(c => c.status === "PARTIAL");
            if (partial) {
                const composed = conn.getCompositionStatus(partial.id);
                assert.ok(["AUTH_FAILED", "UNREACHABLE", "CONFIGURED_UNVERIFIED"].includes(composed.status));
                assert.notEqual(composed.status, "CONNECTED_VERIFIED", "a PARTIAL (probe-failed) connector must never report CONNECTED_VERIFIED");
            }
        });
        it("CONNECTED_VERIFIED is only ever derived from a real CONNECTED legacy status", () => {
            const all = conn.getAllStatus();
            for (const c of all) {
                const composed = conn.getCompositionStatus(c.id);
                if (composed.status === "CONNECTED_VERIFIED") {
                    assert.equal(c.status, "CONNECTED", `${c.id} reported CONNECTED_VERIFIED without a real CONNECTED legacy status`);
                }
            }
        });
        it("returns NOT_CONFIGURED for a connector with no record at all", () => {
            const composed = conn.getCompositionStatus("totally-unknown-connector-xyz");
            assert.equal(composed.status, "NOT_CONFIGURED");
            assert.equal(composed.legacyStatus, "NOT_APPLICABLE");
        });
    });

    describe("getAllCompositionStatus()", () => {
        it("returns one composition-status entry per recorded connector, all using the richer vocabulary", () => {
            const all = conn.getAllStatus();
            const composed = conn.getAllCompositionStatus();
            assert.equal(composed.length, all.length);
            const validStatuses = new Set([
                "NOT_CONFIGURED", "NEEDS_CREDENTIALS", "CONFIGURED_UNVERIFIED", "VERIFYING",
                "CONNECTED_VERIFIED", "DEGRADED", "AUTH_FAILED", "UNREACHABLE", "NOT_IMPLEMENTED",
            ]);
            for (const c of composed) {
                assert.ok(validStatuses.has(c.status), `unexpected composition status: ${c.status}`);
            }
        });
    });

    describe("getConnectorCapabilities()", () => {
        it("returns declared capabilities/scopes for a known connector", () => {
            const caps = conn.getConnectorCapabilities("git:github");
            assert.ok(Array.isArray(caps.capabilities));
            assert.ok(caps.capabilities.length > 0);
            assert.ok(Array.isArray(caps.scopes));
        });
        it("returns empty arrays (not fabricated data) for a connector with no declared capability metadata", () => {
            const caps = conn.getConnectorCapabilities("ai:some-connector-never-declared");
            assert.deepEqual(caps.capabilities, []);
            assert.deepEqual(caps.scopes, []);
        });
    });

    describe("regression — existing exports unchanged", () => {
        it("getStatus()/getAllStatus() still return the original legacy vocabulary untouched", () => {
            const all = conn.getAllStatus();
            for (const c of all) {
                assert.ok(["CONNECTED", "READY", "PARTIAL", "MISSING", "NOT_APPLICABLE"].includes(c.status), `unexpected legacy status: ${c.status}`);
            }
        });
    });
});
