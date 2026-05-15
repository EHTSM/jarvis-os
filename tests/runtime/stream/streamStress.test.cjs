"use strict";
/**
 * streamStress.test.cjs — unit + stress tests for runtimeEventBus.cjs
 *
 * Tests:
 *   1. Ring buffer bounded at RING_SIZE (500)
 *   2. Fan-out to all active subscribers
 *   3. Erroring subscriber auto-removed, others unaffected
 *   4. Unsubscribe stops delivery
 *   5. getRecent() ordering (oldest → newest)
 *   6. Rapid subscribe/unsubscribe stability (no counter leak)
 *   7. Telemetry event shape validation
 *   8. start/stop/reset lifecycle
 *   9. Seq counter monotone across reset boundary (resets to 0 cleanly)
 *  10. MAX_SUBS capacity enforcement
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// Each require() returns the same module singleton — we need reset() between tests.
const bus = require("../../../agents/runtime/runtimeEventBus.cjs");

// ── Helpers ────────────────────────────────────────────────────────

let _subIdCounter = 0;
function uid() { return `test-sub-${++_subIdCounter}-${Date.now()}`; }

function collect(id) {
    const received = [];
    bus.subscribe(id, (evt) => received.push(evt));
    return received;
}

// ── Suite ─────────────────────────────────────────────────────────

describe("runtimeEventBus — stress + unit tests", () => {

    beforeEach(() => {
        bus.reset();  // clean state for every test
    });

    after(() => {
        bus.reset();  // leave clean on exit
    });

    // ── 1. Ring buffer bounded ───────────────────────────────────

    describe("ring buffer", () => {
        it("stores events up to RING_SIZE without error", () => {
            for (let i = 0; i < bus.RING_SIZE; i++) {
                bus.emit("test", { i });
            }
            const r = bus.getRecent(bus.RING_SIZE);
            assert.equal(r.length, bus.RING_SIZE);
        });

        it("oldest event is evicted once ring is full", () => {
            for (let i = 0; i < bus.RING_SIZE + 10; i++) {
                bus.emit("ring-test", { i });
            }
            const r = bus.getRecent(bus.RING_SIZE);
            // Ring should be full but not exceed RING_SIZE
            assert.equal(r.length, bus.RING_SIZE,
                `expected ${bus.RING_SIZE} events, got ${r.length}`);
        });

        it("getRecent(n) respects n limit", () => {
            for (let i = 0; i < 20; i++) bus.emit("limit-test", { i });
            const r = bus.getRecent(5);
            assert.equal(r.length, 5);
        });

        it("getRecent(n) returns oldest → newest order", () => {
            bus.emit("order", { v: 1 });
            bus.emit("order", { v: 2 });
            bus.emit("order", { v: 3 });
            const r = bus.getRecent(3).filter(e => e.type === "order");
            assert.equal(r[0].payload.v, 1);
            assert.equal(r[1].payload.v, 2);
            assert.equal(r[2].payload.v, 3);
        });

        it("getRecent with n > ring size returns all events", () => {
            for (let i = 0; i < 10; i++) bus.emit("small", {});
            const r = bus.getRecent(9999);
            assert.equal(r.length, 10);
        });
    });

    // ── 2. Fan-out ───────────────────────────────────────────────

    describe("fan-out", () => {
        it("delivers event to all active subscribers", () => {
            const ids = ["fan-a", "fan-b", "fan-c"];
            const stores = ids.map(id => collect(id));

            bus.emit("fanout", { msg: "hello" });

            for (const store of stores) {
                assert.equal(store.length, 1);
                assert.equal(store[0].payload.msg, "hello");
            }

            ids.forEach(id => bus.unsubscribe(id));
        });

        it("subscriber receives events in emission order", () => {
            const id = uid();
            const received = collect(id);

            bus.emit("seq", { n: 1 });
            bus.emit("seq", { n: 2 });
            bus.emit("seq", { n: 3 });

            const seqEvents = received.filter(e => e.type === "seq");
            assert.equal(seqEvents.length, 3);
            assert.equal(seqEvents[0].payload.n, 1);
            assert.equal(seqEvents[2].payload.n, 3);

            bus.unsubscribe(id);
        });

        it("each event carries seq, ts, type, payload fields", () => {
            const id = uid();
            const received = collect(id);

            bus.emit("shape-check", { key: "val" });

            assert.equal(received.length, 1);
            const evt = received[0];
            assert.ok(typeof evt.seq  === "number",  "seq must be number");
            assert.ok(typeof evt.ts   === "number",  "ts must be number");
            assert.ok(typeof evt.type === "string",  "type must be string");
            assert.ok(typeof evt.payload === "object", "payload must be object");

            bus.unsubscribe(id);
        });

        it("seq values are strictly monotone", () => {
            const id = uid();
            const received = collect(id);

            for (let i = 0; i < 10; i++) bus.emit("mono", {});

            for (let i = 1; i < received.length; i++) {
                assert.ok(received[i].seq > received[i - 1].seq,
                    `seq not monotone at index ${i}: ${received[i - 1].seq} → ${received[i].seq}`);
            }

            bus.unsubscribe(id);
        });
    });

    // ── 3. Erroring subscriber auto-removal ──────────────────────

    describe("erroring subscriber", () => {
        it("error in subscriber does not throw to caller", () => {
            const id = uid();
            bus.subscribe(id, () => { throw new Error("subscriber crash"); });

            // Must not throw
            assert.doesNotThrow(() => bus.emit("crash-test", {}));
        });

        it("erroring subscriber is removed after first failure", () => {
            const badId   = uid();
            let   badCalls = 0;
            bus.subscribe(badId, () => { badCalls++; throw new Error("die"); });

            bus.emit("crash-1", {});
            bus.emit("crash-2", {});

            // After first emit the bad subscriber is evicted — should only be called once
            assert.equal(badCalls, 1);

            const m = bus.metrics();
            const stillThere = m.subscribers.some(s => s.id === badId);
            assert.ok(!stillThere, "erroring subscriber should be auto-removed");
        });

        it("other subscribers are unaffected when one errors", () => {
            const goodId = uid();
            const goodEvents = collect(goodId);

            const badId = uid();
            bus.subscribe(badId, () => { throw new Error("bad sub"); });

            bus.emit("mixed", { v: 1 });
            bus.emit("mixed", { v: 2 });

            const mixed = goodEvents.filter(e => e.type === "mixed");
            assert.equal(mixed.length, 2, "good subscriber should receive both events");

            bus.unsubscribe(goodId);
        });
    });

    // ── 4. Unsubscribe stops delivery ────────────────────────────

    describe("unsubscribe", () => {
        it("no events delivered after unsubscribe", () => {
            const id = uid();
            const received = collect(id);

            bus.emit("before-unsub", {});
            bus.unsubscribe(id);
            bus.emit("after-unsub",  {});

            assert.equal(received.filter(e => e.type === "before-unsub").length, 1);
            assert.equal(received.filter(e => e.type === "after-unsub").length,  0);
        });

        it("unsubscribe returns true for known id, false for unknown", () => {
            const id = uid();
            bus.subscribe(id, () => {});
            assert.equal(bus.unsubscribe(id),     true);
            assert.equal(bus.unsubscribe(id),     false);
            assert.equal(bus.unsubscribe("x-y-z"), false);
        });
    });

    // ── 5. Rapid subscribe/unsubscribe ───────────────────────────

    describe("rapid subscribe/unsubscribe stability", () => {
        it("100 rapid cycles leave subscriber count at 0", () => {
            for (let i = 0; i < 100; i++) {
                const id = uid();
                bus.subscribe(id, () => {});
                bus.unsubscribe(id);
            }
            assert.equal(bus.metrics().subscriberCount, 0);
        });

        it("interleaved subscribes and emits do not corrupt counter", () => {
            const ids = [];
            for (let i = 0; i < 5; i++) {
                const id = uid();
                ids.push(id);
                bus.subscribe(id, () => {});
                bus.emit("interleave", { i });
            }
            assert.equal(bus.metrics().subscriberCount, 5);
            ids.forEach(id => bus.unsubscribe(id));
            assert.equal(bus.metrics().subscriberCount, 0);
        });

        it("1000 emits with no subscribers do not throw or accumulate", () => {
            assert.doesNotThrow(() => {
                for (let i = 0; i < 1000; i++) bus.emit("no-subs", { i });
            });
        });
    });

    // ── 6. MAX_SUBS capacity enforcement ────────────────────────

    describe("MAX_SUBS capacity", () => {
        it("rejects subscription beyond MAX_SUBS", () => {
            const ids = [];
            for (let i = 0; i < bus.MAX_SUBS; i++) {
                const id = uid();
                ids.push(id);
                bus.subscribe(id, () => {});
            }
            assert.equal(bus.metrics().subscriberCount, bus.MAX_SUBS);

            assert.throws(
                () => bus.subscribe(uid(), () => {}),
                /at capacity/
            );

            ids.forEach(id => bus.unsubscribe(id));
        });

        it("freeing a slot allows a new subscriber", () => {
            const ids = [];
            for (let i = 0; i < bus.MAX_SUBS; i++) {
                const id = uid();
                ids.push(id);
                bus.subscribe(id, () => {});
            }
            // Remove one
            bus.unsubscribe(ids.pop());

            // Should succeed now
            const newId = uid();
            assert.doesNotThrow(() => bus.subscribe(newId, () => {}));
            bus.unsubscribe(newId);

            ids.forEach(id => bus.unsubscribe(id));
        });
    });

    // ── 7. Metrics shape ─────────────────────────────────────────

    describe("metrics()", () => {
        it("returns expected shape", () => {
            const m = bus.metrics();
            assert.ok(typeof m.subscriberCount === "number");
            assert.ok(typeof m.maxSubscribers  === "number");
            assert.ok(typeof m.totalEvents     === "number");
            assert.ok(typeof m.eventsLastMin   === "number");
            assert.ok(typeof m.ringSize        === "number");
            assert.ok(typeof m.maxRingSize     === "number");
            assert.ok(Array.isArray(m.subscribers));
        });

        it("totalEvents increments with each emit", () => {
            const before = bus.metrics().totalEvents;
            bus.emit("count-a", {});
            bus.emit("count-b", {});
            const after = bus.metrics().totalEvents;
            assert.equal(after, before + 2);
        });

        it("subscriberCount tracks active subs", () => {
            assert.equal(bus.metrics().subscriberCount, 0);
            const id = uid();
            bus.subscribe(id, () => {});
            assert.equal(bus.metrics().subscriberCount, 1);
            bus.unsubscribe(id);
            assert.equal(bus.metrics().subscriberCount, 0);
        });
    });

    // ── 8. Lifecycle (start / stop / reset) ─────────────────────

    describe("lifecycle", () => {
        it("reset clears ring buffer", () => {
            bus.emit("pre-reset", {});
            assert.ok(bus.getRecent(10).length > 0);
            bus.reset();
            assert.equal(bus.getRecent(10).length, 0);
        });

        it("reset clears all subscribers", () => {
            const id = uid();
            bus.subscribe(id, () => {});
            assert.equal(bus.metrics().subscriberCount, 1);
            bus.reset();
            assert.equal(bus.metrics().subscriberCount, 0);
        });

        it("reset clears totalEvents counter", () => {
            bus.emit("before", {});
            bus.emit("before", {});
            bus.reset();
            assert.equal(bus.metrics().totalEvents, 0);
        });

        it("start() is idempotent — calling twice does not throw", () => {
            assert.doesNotThrow(() => {
                bus.start();
                bus.start();
            });
            bus.stop();
        });

        it("stop() clears subscribers and stops tickers", () => {
            const id = uid();
            bus.subscribe(id, () => {});
            bus.start();
            bus.stop();
            assert.equal(bus.metrics().subscriberCount, 0);
        });
    });

    // ── 9. Payload handling ──────────────────────────────────────

    describe("payload handling", () => {
        it("null payload becomes empty object", () => {
            bus.emit("null-payload", null);
            const r = bus.getRecent(1);
            assert.deepEqual(r[0].payload, {});
        });

        it("undefined payload becomes empty object", () => {
            bus.emit("undef-payload");
            const r = bus.getRecent(1);
            assert.deepEqual(r[0].payload, {});
        });

        it("large payload stored without truncation", () => {
            const big = { data: "x".repeat(10_000) };
            bus.emit("big-payload", big);
            const r = bus.getRecent(1);
            assert.equal(r[0].payload.data.length, 10_000);
        });
    });

});
