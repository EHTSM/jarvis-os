"use strict";
/**
 * Per-IP in-memory rate limiter middleware factory.
 * Extracted from jarvisController — now reusable across any route.
 *
 * Usage:
 *   const rateLimiter = require("./middleware/rateLimiter");
 *   router.post("/jarvis", rateLimiter(60, 60_000), handler);
 */

const _rateMap = new Map();

// Purge entries older than one window + 15s grace — runs every 5 minutes.
setInterval(() => {
    const cutoff = Date.now() - 75_000;
    for (const [ip, entry] of _rateMap) {
        if (entry.start < cutoff) _rateMap.delete(ip);
    }
}, 300_000).unref();

/**
 * @param {number} limit    — max requests per window (default 60)
 * @param {number} windowMs — window size in ms (default 60 000)
 */
module.exports = function rateLimiter(limit = 60, windowMs = 60_000) {
    return (req, res, next) => {
        const ip    = req.ip || "unknown";
        const now   = Date.now();
        const entry = _rateMap.get(ip) || { count: 0, start: now };
        if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
        entry.count++;
        _rateMap.set(ip, entry);
        if (entry.count > limit) {
            return res.status(429).json({ success: false, reply: "Too many requests. Slow down." });
        }
        next();
    };
};
