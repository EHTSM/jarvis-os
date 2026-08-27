"use strict";
/**
 * Phase B.18 regression: a dead-letter entry must name the agent that failed.
 *
 * The dead-letter queue is the record of work that permanently failed after all
 * retries — it is what an operator triages during an incident. Measured on the
 * live queue: **0 of 980 entries carried an agentId**, while taskType and deadAt
 * were present on 980/980. The failures were real and varied — 550 "cb trigger",
 * 328 "permanent failure", 110 'Agent "weather" not found', 6 AI timeouts — but
 * every one was anonymous, so the queue could not answer *which component is
 * failing*. With the queue sitting exactly at its 1000-entry cap (oldest
 * evicted), an operator could not distinguish one bad adapter from a systemic
 * outage.
 *
 * Root cause: agents/runtime/executionEngine.cjs passed a hardcoded
 * `agentId: null` to dlq.push(). deadLetterQueue.push() has always documented
 * and stored an agentId — the caller simply never supplied it. `const agent` is
 * block-scoped inside the retry loop, so the push at the end of the function had
 * no reference to it; it is now tracked in `lastAgentId` alongside `lastError`,
 * which has exactly the same lifetime (the state of the final attempt).
 *
 * Recovery only — no new incident system, no new queue, no new storage.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const ROOT   = path.join(__dirname, "../..");
const ENGINE = path.join(ROOT, "agents/runtime/executionEngine.cjs");
const DLQ_SRC= path.join(ROOT, "agents/runtime/deadLetterQueue.cjs");
const DLQ_FILE = path.join(ROOT, "data/dead-letter.json");

const dlq = require("../../agents/runtime/deadLetterQueue.cjs");
const read = p => fs.readFileSync(p, "utf8");

describe("dead-letter attribution (Phase B.18)", () => {
    it("the DLQ still persists a supplied agentId end-to-end", () => {
        const marker = `b18-regression-${Date.now()}`;
        dlq.push({
            taskId: marker, taskType: "media", input: "b18 regression",
            error: "b18 induced permanent failure", attempts: 3,
            agentId: "b18-media-agent",
        });
        const entry = dlq.list().find(e => e.taskId === marker);
        assert.ok(entry, "the entry must be persisted");
        assert.equal(entry.agentId, "b18-media-agent",
            "agentId must survive the write — this is the field operators triage by");
        assert.equal(entry.taskType, "media", "taskType must not regress");
        assert.ok(entry.deadAt, "deadAt must be stamped");
    });

    it("the execution engine passes the attempted agent, not a hardcoded null", () => {
        const src = read(ENGINE);
        assert.ok(/dlq\.push\(\{[^}]*agentId: lastAgentId/.test(src),
            "the dead-letter push must carry the agent that was attempted");
        assert.ok(!/dlq\.push\(\{[^}]*agentId: null/.test(src),
            "no dead-letter push may hardcode agentId: null");
    });

    it("tracks the attempted agent across the retry loop", () => {
        const src = read(ENGINE);
        assert.ok(/let\s+lastAgentId = null;/.test(src),
            "lastAgentId must be declared outside the retry loop — `const agent` is block-scoped");
        assert.ok(/if \(agent\) lastAgentId = agent\.id;/.test(src),
            "the registered-agent path must record which agent was attempted");
        assert.ok(/lastAgentId = "legacy";/.test(src),
            "the legacy executor path must also identify itself");
    });

    it("reports the failing agent in the exhausted-retries return value too", () => {
        const src = read(ENGINE);
        const tail = src.slice(src.indexOf("const finalError = lastError?.message"));
        assert.ok(/agentId: lastAgentId/.test(tail),
            "the final failure return must name the agent, consistent with the DLQ record");
    });

    it("leaves the pre-agent bail-outs as null (no agent ran there)", () => {
        // Those returns fire before any agent executes — no handler registered,
        // or an approval gate. null is correct and must not be "fixed".
        const src = read(ENGINE);
        assert.ok(/No handler for capability/.test(src),
            "the no-handler bail must still exist");
        const nulls = (src.match(/agentId: null/g) || []).length;
        assert.ok(nulls >= 3,
            `the genuine no-agent cases must keep agentId: null (found ${nulls})`);
    });

    it("keeps the DLQ bounded and documented (continuity guard, not a leak)", () => {
        const src = read(DLQ_SRC);
        assert.ok(/const DLQ_CAP\s+= 1000;/.test(src), "the cap must remain explicit");
        assert.ok(/current\.length > DLQ_CAP \? current\.slice\(-DLQ_CAP\) : current/.test(src),
            "the queue must evict oldest rather than grow without bound");
        assert.ok(dlq.size() <= 1000, `DLQ must stay within its cap, saw ${dlq.size()}`);
    });

    it("keeps agentId documented in the push contract", () => {
        const src = read(DLQ_SRC);
        assert.ok(/agentId\s+\{string\|null\}/.test(src),
            "the push contract must keep documenting agentId");
        assert.ok(/agentId:\s+p\.agentId\s+\|\| null/.test(src),
            "push must persist a supplied agentId and default to null");
    });

    it("the live queue is parseable and every entry carries the triage fields", () => {
        const rows = JSON.parse(read(DLQ_FILE));
        assert.ok(Array.isArray(rows), "the dead-letter store must be an array");
        const missingType = rows.filter(r => !r.taskType).length;
        const missingWhen = rows.filter(r => !r.deadAt).length;
        assert.equal(missingType, 0, "every entry must record what kind of task failed");
        assert.equal(missingWhen, 0, "every entry must record when it died");
    });

    it("new failures are attributable even though historical ones are not", () => {
        // The fix cannot retroactively name the 980 pre-existing anonymous
        // entries; it must guarantee that anything written from now on is
        // attributable when an agent was involved.
        const marker = `b18-fresh-${Date.now()}`;
        dlq.push({ taskId: marker, taskType: "ai", input: "x",
                   error: "b18 fresh failure", attempts: 3, agentId: "b18-ai-agent" });
        const fresh = dlq.list().find(e => e.taskId === marker);
        assert.equal(fresh.agentId, "b18-ai-agent");
        assert.notEqual(fresh.agentId, null,
            "a failure with a known agent must never be recorded anonymously");
    });
});
