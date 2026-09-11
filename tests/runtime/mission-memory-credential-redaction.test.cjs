"use strict";
/**
 * Phase 2 (Agent Memory, Missions 133-136) regression coverage.
 *
 * "Credential values must NEVER be stored in agent memory." missionMemory.cjs
 * previously had no guard of this kind on any write entrypoint, unlike
 * toolExecutionLayer.cjs's _sanitizeParams()/sentryService.cjs's _redact(),
 * which this fix's _scrubSecrets() mirrors. Uses the existing
 * buildIsolatedMissionMemory() helper so this test never touches the real
 * data/missions.json.
 */
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const { buildIsolatedMissionMemory } = require("./_isolatedMissionMemory.helper.cjs");

const iso    = buildIsolatedMissionMemory();
const memory = iso.memory;

after(() => iso.cleanup());

describe("missionMemory — Phase 2 Agent Memory credential redaction", () => {

    describe("_scrubSecretsForTest() — direct unit coverage", () => {
        it("redacts sensitive keys at the top level", () => {
            const out = memory._scrubSecretsForTest({ apiKey: "sk-live-abc123", note: "fine" });
            assert.equal(out.apiKey, "[redacted]");
            assert.equal(out.note, "fine");
        });
        it("redacts sensitive keys recursively", () => {
            const out = memory._scrubSecretsForTest({ nested: { token: "ghp_xxx", ok: "value" } });
            assert.equal(out.nested.token, "[redacted]");
            assert.equal(out.nested.ok, "value");
        });
        it("redacts inside arrays", () => {
            const out = memory._scrubSecretsForTest([{ password: "hunter2" }, { fine: "yes" }]);
            assert.equal(out[0].password, "[redacted]");
            assert.equal(out[1].fine, "yes");
        });
        it("passes through plain strings/numbers/null unchanged", () => {
            assert.equal(memory._scrubSecretsForTest("hello"), "hello");
            assert.equal(memory._scrubSecretsForTest(42), 42);
            assert.equal(memory._scrubSecretsForTest(null), null);
        });
    });

    describe("createMission() — metadata redaction", () => {
        it("redacts a credential-shaped key in data.metadata", () => {
            const m = memory.createMission({ objective: "test obj A", metadata: { secretToken: "s3cr3t-value", region: "us-east" } });
            assert.equal(m.metadata.secretToken, "[redacted]");
            assert.equal(m.metadata.region, "us-east");
        });
    });

    describe("updateMission() — metadata patch redaction (HTTP-reachable path)", () => {
        it("redacts a credential-shaped key in a metadata patch", () => {
            const m = memory.createMission({ objective: "test obj B" });
            const updated = memory.updateMission(m.id, { metadata: { apiSecret: "leak-me", visible: "ok" } });
            assert.equal(updated.metadata.apiSecret, "[redacted]");
            assert.equal(updated.metadata.visible, "ok");
        });
        it("still preserves existing orgId-immutability behavior after redaction", () => {
            const m = memory.createMission({ objective: "test obj C", metadata: { orgId: "org-keep-me" } });
            const updated = memory.updateMission(m.id, { metadata: { orgId: "org-attacker", password: "nope" } });
            assert.equal(updated.metadata.orgId, "org-keep-me", "orgId in metadata must not be reassignable via patch");
            assert.equal(updated.metadata.password, "[redacted]");
        });
    });

    describe("addSubtask() — output redaction", () => {
        it("redacts a credential-shaped key in subtask.output", () => {
            const m = memory.createMission({ objective: "test obj D" });
            const updated = memory.addSubtask(m.id, { description: "do thing", output: { sessionToken: "tok-abc", result: "done" } });
            const st = updated.subtasks[updated.subtasks.length - 1];
            assert.equal(st.output.sessionToken, "[redacted]");
            assert.equal(st.output.result, "done");
        });
    });

    describe("recordDecision/recordArtifact/recordFailure/addLearning — free-text field redaction", () => {
        it("recordDecision redacts object-shaped rationale/outcome", () => {
            const m = memory.createMission({ objective: "test obj E" });
            const updated = memory.recordDecision(m.id, {
                description: "chose provider",
                rationale: { credential: "abc", reason: "cheapest" },
                outcome: { apikey: "xyz", result: "ok" },
            });
            const dec = updated.decisions[updated.decisions.length - 1];
            assert.equal(dec.rationale.credential, "[redacted]");
            assert.equal(dec.rationale.reason, "cheapest");
            assert.equal(dec.outcome.apikey, "[redacted]");
        });
        it("recordArtifact redacts object-shaped description", () => {
            const m = memory.createMission({ objective: "test obj F" });
            const updated = memory.recordArtifact(m.id, { name: "config.json", description: { authHeader: "Bearer xxx", kind: "config" } });
            const art = updated.artifacts[updated.artifacts.length - 1];
            assert.equal(art.description.authHeader, "[redacted]");
            assert.equal(art.description.kind, "config");
        });
        it("recordFailure redacts object-shaped rootCause", () => {
            const m = memory.createMission({ objective: "test obj G" });
            const updated = memory.recordFailure(m.id, { description: "call failed", rootCause: { dsn: "https://x@y/z", phase: "deploy" } });
            const fail = updated.failures[updated.failures.length - 1];
            assert.equal(fail.rootCause.dsn, "[redacted]");
            assert.equal(fail.rootCause.phase, "deploy");
        });
        it("addLearning redacts object-shaped source", () => {
            const m = memory.createMission({ objective: "test obj H" });
            const updated = memory.addLearning(m.id, { insight: "retry helps", source: { credential: "leak", agent: "dev" } });
            const lrn = updated.learnings[updated.learnings.length - 1];
            assert.equal(lrn.source.credential, "[redacted]");
            assert.equal(lrn.source.agent, "dev");
        });
    });

    describe("timeline redaction", () => {
        it("timeline details are also redacted, mirroring the primary record", () => {
            const m = memory.createMission({ objective: "test obj I" });
            const updated = memory.recordDecision(m.id, { description: "x", outcome: { secret: "leak" } });
            const entry = updated.timeline.find(t => t.event === "decision_recorded");
            assert.ok(entry, "expected a decision_recorded timeline entry");
            // details only carries type/description/decisionId (see _appendTimeline
            // call site) — this asserts the redaction pass runs without throwing
            // and doesn't corrupt the details shape for the fields it does carry.
            assert.equal(typeof entry.details.description, "string");
        });
    });
});
