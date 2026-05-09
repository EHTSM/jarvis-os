/**
 * Auth Checker — API key validation and basic rate-limiting guard.
 * Pluggable: extend with JWT or OAuth without touching core gateway.
 */

const crypto = require("crypto");

// In-memory request tracking (reset on restart; use Redis for production)
const _requestLog = new Map(); // key → [timestamps]
const WINDOW_MS   = 60_000;   // 1 minute sliding window
const MAX_RPM     = parseInt(process.env.JARVIS_RATE_LIMIT || "120", 10);

// Internal API keys — add via env: JARVIS_API_KEYS=key1,key2
function _getAuthorizedKeys() {
    const envKeys = (process.env.JARVIS_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
    const devKey  = "jarvis-dev-key"; // always allowed in dev
    return new Set([...envKeys, ...(process.env.NODE_ENV !== "production" ? [devKey] : [])]);
}

function _isRateLimited(identifier) {
    const now  = Date.now();
    const hits  = (_requestLog.get(identifier) || []).filter(t => now - t < WINDOW_MS);
    hits.push(now);
    _requestLog.set(identifier, hits);
    // Cleanup old keys occasionally
    if (_requestLog.size > 10_000) {
        for (const [k, ts] of _requestLog) {
            if (!ts.some(t => now - t < WINDOW_MS)) _requestLog.delete(k);
        }
    }
    return hits.length > MAX_RPM;
}

function check(req) {
    const apiKey    = req.headers?.["x-api-key"] || req.body?.apiKey || null;
    const ip        = req.ip || req.connection?.remoteAddress || "unknown";
    const identifier = apiKey || ip;

    // Rate limit check
    if (_isRateLimited(identifier)) {
        return {
            authorized: false,
            code:       429,
            error:      "Rate limit exceeded. Try again in a minute.",
            retryAfter: Math.ceil(WINDOW_MS / 1000)
        };
    }

    // If no API keys configured, allow all (open mode — useful for local dev)
    const keys = _getAuthorizedKeys();
    if (keys.size === 1 && keys.has("jarvis-dev-key") && !apiKey) {
        return { authorized: true, mode: "open", identifier: ip };
    }

    // Key validation
    if (!apiKey) {
        return { authorized: false, code: 401, error: "API key required (x-api-key header)" };
    }

    if (!keys.has(apiKey)) {
        return { authorized: false, code: 403, error: "Invalid API key" };
    }

    return { authorized: true, mode: "api_key", identifier: apiKey.slice(0, 8) + "..." };
}

function generateKey() {
    return "jv_" + crypto.randomBytes(24).toString("hex");
}

module.exports = { check, generateKey };
