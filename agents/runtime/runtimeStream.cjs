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
const { verifyJWT, COOKIE_NAME } = require("../../backend/middleware/authMiddleware");

// Hard cap on concurrent SSE connections — prevents memory exhaustion
// from clients that connect and never disconnect.
const MAX_SSE = 10;
let _active  = 0;

// ── Reconnect damping ─────────────────────────────────────────────
// Tracks reconnects per 60s window. When rate is high, sends a
// Retry-After header on the connected event so clients back off.
const _reconnectTimes = [];
const RECONNECT_STORM_THRESHOLD = 15;  // reconnects per 60s before damping kicks in
const RECONNECT_DAMP_DELAY_MS   = 10_000;  // suggest 10s minimum between reconnects

function _reconnectDampDelay() {
    const now = Date.now();
    // Trim old entries outside 60s window
    while (_reconnectTimes.length > 0 && _reconnectTimes[0] < now - 60_000) _reconnectTimes.shift();
    _reconnectTimes.push(now);
    // Hard cap — can't exceed MAX_SSE reconnects in any window
    if (_reconnectTimes.length > MAX_SSE * 4) _reconnectTimes.splice(0, MAX_SSE);
    if (_reconnectTimes.length >= RECONNECT_STORM_THRESHOLD) return RECONNECT_DAMP_DELAY_MS;
    return 0;
}

// ── SSE helpers ───────────────────────────────────────────────────

function _sseHeaders(res, req) {
    res.setHeader("Content-Type",      "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control",     "no-cache, no-transform");
    res.setHeader("Connection",        "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");     // nginx: disable response buffering
    // Reflect the request origin so withCredentials:true works.
    // ALLOWED_ORIGINS is already enforced by the global CORS middleware.
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, "") || "";
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin",      origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.flushHeaders();
}

/**
 * Write a named SSE event with optional id for Last-Event-ID tracking.
 * Returns false if write failed (client gone).
 */
function _write(res, type, data, seq) {
    try {
        const idLine = seq != null ? `id: ${seq}\n` : "";
        res.write(`${idLine}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
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

    // Connection cap — tell client to back off 30s before retrying
    if (_active >= MAX_SSE) {
        res.setHeader("Retry-After", "30");
        return res.status(429).json({
            success: false,
            error: `SSE connection limit (${MAX_SSE}) reached — try again in 30s`,
            retryAfterMs: 30_000
        });
    }

    _sseHeaders(res, req);
    _active++;

    const isReconnect = _active > 1;
    if (isReconnect) {
        bus.recordReconnect();
        try { require("./driftMonitor.cjs").recordReconnect(); } catch {}
    }

    // Reconnect damping — suggest a retry delay if reconnect storm detected
    const dampDelay = isReconnect ? _reconnectDampDelay() : 0;
    if (dampDelay > 0) res.setHeader("X-Reconnect-Damp-Ms", String(dampDelay));

    // Unique client ID for this connection
    const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ── Replay missed events ────────────────────────────────────
    // If client sends Last-Event-ID, replay only the gap.
    // Otherwise replay the last 50 buffered events (cold connect).
    const lastEventId = parseInt(req.headers["last-event-id"]) || 0;
    const replay = lastEventId > 0
        ? bus.getSince(lastEventId)
        : bus.getRecent(50);
    for (const e of replay) {
        _write(res, e.type, e.payload, e.seq);
    }

    // Connection ack — lets client know it's live and how many events were replayed
    _write(res, "connected", {
        clientId,
        ts:          Date.now(),
        replayCount: replay.length,
        lastSeq:     replay.length > 0 ? replay[replay.length - 1].seq : lastEventId
    });

    // ── Subscribe to live events ─────────────────────────────────
    let _subscribed = false;
    try {
        bus.subscribe(clientId, (event) => {
            if (!_write(res, event.type, event.payload, event.seq)) {
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

    // ── JWT expiry warning ───────────────────────────────────────
    // If the operator's token expires during this SSE session, emit
    // a jwt_expiry_warning event 5 minutes before expiry so the
    // frontend can show a reconnect banner before the session goes dark.
    let _expiryWarnTimer = null;
    try {
        const rawCookie = req.headers.cookie || "";
        const cookieMap = {};
        for (const part of rawCookie.split(";")) {
            const idx = part.indexOf("=");
            if (idx < 0) continue;
            try {
                cookieMap[decodeURIComponent(part.slice(0, idx).trim())] =
                    decodeURIComponent(part.slice(idx + 1).trim());
            } catch { /* malformed cookie pair — ignore */ }
        }
        const token = cookieMap[COOKIE_NAME];
        if (token) {
            const payload = verifyJWT(token);
            if (payload?.exp) {
                const WARN_BEFORE_MS = 5 * 60 * 1000;  // 5 minutes
                const msUntilWarn = (payload.exp * 1000) - Date.now() - WARN_BEFORE_MS;
                if (msUntilWarn > 0) {
                    _expiryWarnTimer = setTimeout(() => {
                        _write(res, "jwt_expiry_warning", {
                            message:   "Session expires in ~5 minutes",
                            expiresAt: new Date(payload.exp * 1000).toISOString()
                        });
                    }, msUntilWarn);
                    _expiryWarnTimer.unref();
                }
            }
        }
    } catch { /* non-critical — never crash SSE setup for this */ }

    // ── Cleanup on disconnect ────────────────────────────────────
    let _cleaned = false;

    function cleanup() {
        if (_cleaned) return;
        _cleaned = true;
        clearInterval(pingRef);
        clearTimeout(_expiryWarnTimer);
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
