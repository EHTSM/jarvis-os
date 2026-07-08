/**
 * Shared rate limiter — max 5 requests per domain per minute.
 * All internet agents use this before making outbound calls.
 */

const WINDOW_MS = 60_000;
const MAX_REQS  = 5;

const _counters = new Map();

/**
 * Check if a request to `domain` is allowed.
 * Increments counter if allowed; returns false if rate limit exceeded.
 */
function allow(domain) {
    const now = Date.now();
    if (!_counters.has(domain)) {
        _counters.set(domain, { count: 0, resetAt: now + WINDOW_MS });
    }
    const c = _counters.get(domain);
    if (now > c.resetAt) { c.count = 0; c.resetAt = now + WINDOW_MS; }
    if (c.count >= MAX_REQS) return false;
    c.count++;
    return true;
}

/** Extract hostname from a URL string. */
function domainOf(url) {
    try { return new URL(url).hostname; } catch { return url; }
}

/**
 * Gate an async fetch behind the rate limiter.
 * @param {string} url
 * @param {Function} fetchFn  async () => result
 * @returns result or throws { rateLimited: true }
 */
async function gate(url, fetchFn) {
    const domain = domainOf(url);
    if (!allow(domain)) {
        throw Object.assign(new Error(`Rate limit exceeded for ${domain}`), { rateLimited: true });
    }
    return fetchFn();
}

/** Current state (for debugging). */
function status() {
    const out = {};
    for (const [domain, c] of _counters) {
        out[domain] = { count: c.count, resetsIn: Math.max(0, Math.round((c.resetAt - Date.now()) / 1000)) + "s" };
    }
    return out;
}

module.exports = { allow, domainOf, gate, status };
