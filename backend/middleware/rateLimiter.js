"use strict";
/**
 * Per-IP, per-route in-memory rate limiter middleware factory.
 *
 * Usage:
 *   const rateLimiter = require("./middleware/rateLimiter");
 *   router.post("/jarvis",      rateLimiter(60, 60_000));            // 60 req/min
 *   router.post("/auth/login",  rateLimiter(10, 60_000, "login"));   // 10 req/min, isolated bucket
 *
 * Key: `${ip}:${routeId}:${windowMs}` — each route+IP pair gets its own bucket
 * so bursting on /auth/login cannot consume /runtime/dispatch quota.
 *
 * Response headers:
 *   X-RateLimit-Limit     — max requests allowed in the window
 *   X-RateLimit-Remaining — requests left in current window
 *   X-RateLimit-Reset     — Unix timestamp (seconds) when window resets
 *   Retry-After           — seconds until reset (only on 429)
 */

const _rateMap = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _rateMap) {
        if (now - entry.start > entry.windowMs + 15_000) _rateMap.delete(key);
    }
}, 300_000).unref();

/**
 * @param {number} limit    — max requests per window (default 60)
 * @param {number} windowMs — window size in ms (default 60 000)
 * @param {string} routeId  — optional explicit bucket ID; defaults to req.path
 */
module.exports = function rateLimiter(limit = 60, windowMs = 60_000, routeId) {
    return (req, res, next) => {
        const ip     = req.ip || "unknown";
        const bucket = routeId || req.path || "default";
        const key    = `${ip}:${bucket}:${windowMs}`;
        const now    = Date.now();

        const entry  = _rateMap.get(key) || { count: 0, start: now, windowMs };
        if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
        entry.count++;
        _rateMap.set(key, entry);

        const remaining = Math.max(0, limit - entry.count);
        const resetAt   = Math.ceil((entry.start + windowMs) / 1000);

        res.setHeader("X-RateLimit-Limit",     limit);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset",     resetAt);

        if (entry.count > limit) {
            const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
            res.setHeader("Retry-After", Math.max(1, retryAfter));
            return res.status(429).json({
                success: false,
                error:   "Too many requests. Slow down.",
                retryAfterSeconds: Math.max(1, retryAfter),
            });
        }
        next();
    };
};
