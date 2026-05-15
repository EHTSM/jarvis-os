"use strict";
/**
 * runtimeStream — production-safe SSE transport layer for the JARVIS runtime.
 *
 * GET /runtime/stream
 *
 * On connect:
 *   1. Validates connection limit (max 10 concurrent SSE clients)
 *   2. Sets SSE response headers + flushes
 *   3. Sends "connected" ack with replay info
 *   4. Replays last 50 events from ring buffer (missed-event recovery)
 *   5. Subscribes to runtimeEventBus — live events flow from here
 *   6. Sends ": ping" comment every 20 s (nginx keep-alive)
 *
 * On disconnect / error:
 *   - Unsubscribes from bus
 *   - Decrements connection counter
 *   - Clears ping interval (no leaks)
 *
 * Backpressure:
 *   - EventBus auto-removes subscribers that throw on write
 *   - If res.write throws the subscriber fn throws → bus removes it
 *   - Counter is kept consistent via the cleanup function
 *
 * Usage:
 *   const streamRouter = require("./runtimeStream.cjs");
 *   app.use(streamRouter);
 */

const router = require("express").Router();
const bus    = require("./runtimeEventBus.cjs");

// Hard cap on concurrent SSE connections — prevents memory exhaustion
// from clients that connect and never disconnect.
const MAX_SSE = 10;
let _active  = 0;

// ── SSE helpers ───────────────────────────────────────────────────

function _sseHeaders(res) {
    res.setHeader("Content-Type",      "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control",     "no-cache, no-transform");
    res.setHeader("Connection",        "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");     // nginx: disable response buffering
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();
}

/**
 * Write a named SSE event.
 * Returns false if write failed (client gone).
 */
function _write(res, type, data) {
    try {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write a raw SSE comment (": text") — used for keep-alive pings.
 * These are invisible to EventSource.onmessage / addEventListener.
 */
function _ping(res) {
    try { res.write(": ping\n\n"); return true; }
    catch { return false; }
}

// ── Route ────────────────────────────────────────────────────────

router.get("/runtime/stream", (req, res) => {

    // Connection cap
    if (_active >= MAX_SSE) {
        return res.status(429).json({
            success: false,
            error: `SSE connection limit (${MAX_SSE}) reached — try again later`
        });
    }

    _sseHeaders(res);
    _active++;

    // Unique client ID for this connection
    const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ── Replay recent events ────────────────────────────────────
    // Sends buffered history so reconnecting clients catch up immediately.
    const recent = bus.getRecent(50);
    for (const e of recent) {
        _write(res, e.type, e.payload);
    }

    // Connection ack — lets client know it's live and how many events were replayed
    _write(res, "connected", {
        clientId,
        ts:          Date.now(),
        replayCount: recent.length
    });

    // ── Subscribe to live events ─────────────────────────────────
    let _subscribed = false;
    try {
        bus.subscribe(clientId, (event) => {
            if (!_write(res, event.type, event.payload)) {
                // Write failed — subscriber will throw, bus auto-removes it,
                // but we also need to decrement the counter.
                // Throw so the bus removes us cleanly.
                throw new Error("client disconnected");
            }
        });
        _subscribed = true;
    } catch (err) {
        // Bus at capacity or write error — send error event and close
        _write(res, "error", { message: err.message });
        res.end();
        _active = Math.max(0, _active - 1);
        return;
    }

    // ── Keep-alive ping every 20 s ───────────────────────────────
    // Prevents nginx / load balancers from closing the idle connection.
    const pingRef = setInterval(() => {
        if (!_ping(res)) {
            clearInterval(pingRef);
            cleanup();
        }
    }, 20_000);
    pingRef.unref();

    // ── Cleanup on disconnect ────────────────────────────────────
    let _cleaned = false;

    function cleanup() {
        if (_cleaned) return;
        _cleaned = true;
        clearInterval(pingRef);
        if (_subscribed) bus.unsubscribe(clientId);
        _active = Math.max(0, _active - 1);
    }

    req.on("close",  cleanup);
    req.on("error",  cleanup);
    res.on("error",  cleanup);
    res.on("finish", cleanup);   // handles res.end() from our side
});

// ── Diagnostics endpoint ──────────────────────────────────────────

router.get("/runtime/stream/status", (req, res) => {
    res.json({
        success:          true,
        activeConnections: _active,
        maxConnections:    MAX_SSE,
        bus:              bus.metrics()
    });
});

module.exports = router;
