"use strict";
/**
 * Per-IP in-memory rate limiter middleware factory.
 * Extracted from jarvisController — now reusable across any route.
 *
 * Usage:
 *   const rateLimiter = require("./middleware/rateLimiter");
 *   router.post("/jarvis", rateLimiter(60, 60_000), handler);
 */

// Key: `${ip}:${windowMs}` — separate counters per route window so a 5-min
// login window and a 1-min jarvis window don't share state or purge each other.
const _rateMap = new Map();

// Purge entries whose window has fully expired. Runs every 5 minutes.
// Uses windowMs stored on each entry so long-window limiters (login at 5 min)
// are not evicted prematurely by a hardcoded short cutoff.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _rateMap) {
        if (now - entry.start > entry.windowMs + 15_000) _rateMap.delete(key);
    }
}, 300_000).unref();

/**
 * @param {number} limit    — max requests per window (default 60)
 * @param {number} windowMs — window size in ms (default 60 000)
 */
module.exports = function rateLimiter(limit = 60, windowMs = 60_000) {
    return (req, res, next) => {
        const ip    = req.ip || "unknown";
        const key   = `${ip}:${windowMs}`;
        const now   = Date.now();
        const entry = _rateMap.get(key) || { count: 0, start: now, windowMs };
        if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
        entry.count++;
        _rateMap.set(key, entry);
        if (entry.count > limit) {
            return res.status(429).json({ success: false, reply: "Too many requests. Slow down." });
        }
        next();
    };
};
