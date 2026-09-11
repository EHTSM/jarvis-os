"use strict";
/**
 * Social Publish Support — shared retry/backoff + idempotency helpers for
 * every platform's posting service (socialPostingService.cjs,
 * linkedinPostingService.cjs, and each platform added under Mission 60).
 *
 * Scope decision (Mission 60): a real time-delayed scheduler/queue for
 * social posts (platform, account, org, content, media, idempotency key,
 * retry state as persistent job fields) is deliberately deferred to a
 * follow-up mission — neither existing candidate (automationService.cjs's
 * rule/trigger engine, whose action types are free-text task/event/notify/
 * policy with no content/media fields; or creativeJobQueue.cjs, a
 * synchronous status tracker with no cron dispatch loop) is a drop-in fit,
 * and retrofitting 13 platforms onto an ad hoc queue shape each would
 * itself be the kind of inconsistent parallel architecture CLAUDE.md §16
 * warns against. This file instead covers the two things that ARE safely
 * scoped per-call, inside each existing synchronous publish path:
 *
 *   - withRetry(): transient-error (429/5xx/network) retry with backoff,
 *     for a single publish call — same shape as whatsappService.js's
 *     existing inline retry loop, factored out so every platform gets it
 *     without copy-pasting the loop 13 times.
 *   - checkIdempotency()/recordIdempotency(): a bounded in-memory TTL map
 *     keyed by an idempotency key the caller supplies (e.g. entryId from
 *     socialContentEngine's generation history), the same bounded
 *     Map+TTL dedup pattern whatsappService.js/backend/routes/whatsapp.js
 *     already use for webhook replay protection — not a new mechanism.
 */

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h — long enough to cover retried client requests, short enough not to leak memory
const _seenIdempotencyKeys = new Map(); // key -> { ts, result }

setInterval(() => {
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [key, v] of _seenIdempotencyKeys) {
        if (v.ts < cutoff) _seenIdempotencyKeys.delete(key);
    }
}, 60 * 60 * 1000).unref();

/**
 * Returns the previously-stored result for this idempotency key if the
 * same publish was already attempted within the TTL window, else null.
 * Callers should namespace keys per-platform (e.g. `x:${orgId}:${entryId}`)
 * so the same generation entry published to two platforms doesn't collide.
 */
function checkIdempotency(key) {
    if (!key) return null;
    const rec = _seenIdempotencyKeys.get(key);
    return rec ? rec.result : null;
}

function recordIdempotency(key, result) {
    if (!key) return;
    _seenIdempotencyKeys.set(key, { ts: Date.now(), result });
}

/**
 * Retry an async publish call on transient failure only (HTTP 429 or 5xx,
 * or a network-level error with no response at all). Permanent errors
 * (400/401/403/404/etc) are never retried — same transient/permanent
 * distinction whatsappService.js's cooldown logic already draws.
 *
 * @param {() => Promise<{success:boolean,status?:number}>} fn - one publish attempt
 * @param {number} retries - additional attempts after the first (default 2)
 * @param {number} baseDelayMs - backoff base (default 1000ms, doubles per attempt)
 */
async function withRetry(fn, retries = 2, baseDelayMs = 1000) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
        last = await fn();
        if (last?.success) return last;
        const status = last?.status;
        const transient = !status || status === 429 || (status >= 500 && status < 600);
        if (!transient || attempt === retries) return last;
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
    }
    return last;
}

module.exports = { checkIdempotency, recordIdempotency, withRetry };
