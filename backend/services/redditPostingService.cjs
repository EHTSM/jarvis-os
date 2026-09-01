"use strict";
/**
 * Reddit Posting Service — real Reddit OAuth2 API submission (self/link posts).
 *
 * Mission 60-B (Batch B / Reddit): the existing Reddit integration
 * (agents/internet/socialMediaAgent.cjs) is explicitly read-only — public,
 * unauthenticated JSON endpoints only, and its own docstring states
 * submit/comment capability was deliberately never built. This is the
 * missing "actually submit" half, following the SAME architecture as
 * every other Batch A/B adapter (org-scoped vault-then-OAuth resolution,
 * honest not-configured failure, shared retry/idempotency) — a genuinely
 * new capability, not a rewrite of the existing read-only agent, which is
 * untouched.
 *
 * Real Reddit API rules honored here (not invented complexity):
 *   - Reddit REQUIRES a descriptive User-Agent on every API call
 *     (format: "platform:app-id:version (by /u/username)") — a generic
 *     axios/node User-Agent gets rate-limited or blocked outright. Built
 *     from REDDIT_CLIENT_ID (app-id) so it's real per-deployment, not a
 *     hardcoded placeholder string.
 *   - POST /api/submit needs kind="self" (text post, body in `text`) or
 *     kind="link" (link post, URL in `url`) — Reddit does not support a
 *     unified "media" post via this simple endpoint the way image-hosting
 *     platforms do; image/video posts require a separate, more complex
 *     media-upload lease flow not implemented here (see module scope note
 *     in createPost() below).
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's new "reddit" provider entry (OAuth2,
 *     Basic-auth token exchange, duration=permanent for a real refresh token).
 *   - secretVault.cjs "social:reddit" connector for an org bringing its
 *     own access token.
 *   - socialPublishSupport.cjs for retry/idempotency (single-call submit,
 *     safely retryable like Pinterest's).
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const REDDIT_API_BASE = "https://oauth.reddit.com";
const CONNECTOR_ID = "social:reddit";
const MAX_TITLE = 300; // Reddit's real post title limit

function _userAgent() {
    const appId = process.env.REDDIT_CLIENT_ID || "unknown-app";
    return `jarvis-os:${appId}:1.0 (by /u/ooplix)`;
}

async function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (v) return v;
    }
    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "reddit");
        if (!conns.length) return null;
        const rec = await oauth.getToken("reddit", conns[0].userId);
        return rec?.access_token || null;
    } catch {
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _token(orgId));
}

/**
 * Submit a post to a subreddit.
 * @param {object} opts
 * @param {string} opts.subreddit - without the "r/" prefix
 * @param {string} opts.title - max 300 chars
 * @param {string} [opts.text] - self-post body (kind="self") — mutually exclusive with url
 * @param {string} [opts.url] - link-post URL (kind="link") — mutually exclusive with text
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, postId?:string, url?:string, error?:string}>}
 *
 * SCOPE NOTE: image/video posts are NOT implemented — Reddit's media
 * submission is a separate multi-step lease/upload/websocket-confirmation
 * flow, not a field on this simple submit endpoint. A link post pointing
 * at an already-hosted image URL works today (kind="link"); direct native
 * image/video upload is a genuinely larger feature deferred out of this
 * mission's "smallest adapter, no speculative functionality" scope.
 */
async function createPost({ subreddit, title, text = null, url = null } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (!subreddit) return { success: false, error: "subreddit required" };
    if (!title || !title.trim()) return { success: false, error: "title required" };
    if (title.length > MAX_TITLE) return { success: false, error: `title exceeds Reddit's ${MAX_TITLE} character limit (${title.length} chars)` };
    if (!text && !url) return { success: false, error: "either text (self-post) or url (link-post) required" };
    if (text && url) return { success: false, error: "provide either text or url, not both" };

    const dedupKey = idempotencyKey ? `reddit:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const token = await _token(orgId);
    if (!token) {
        return { success: false, error: "Reddit not configured — connect via GET /vault/oauth/reddit/authorize (requires submit scope), or set an access token via /my-connectors/reddit" };
    }

    const result = await withRetry(async () => {
        try {
            const params = new URLSearchParams({
                sr: subreddit,
                title,
                kind: text ? "self" : "link",
                api_type: "json",
            });
            if (text) params.set("text", text);
            if (url)  params.set("url", url);

            const res = await axios.post(`${REDDIT_API_BASE}/api/submit`, params.toString(), {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": _userAgent(),
                },
                timeout: 15000,
            });

            const errors = res.data?.json?.errors;
            if (errors && errors.length > 0) {
                const detail = errors.map(e => e[1] || e[0]).join("; ");
                logger.error(`[RedditPosting] Submit rejected: ${detail}`);
                return { success: false, error: detail };
            }
            const postId  = res.data?.json?.data?.id || null;
            const postUrl = res.data?.json?.data?.url || null;
            logger.info(`[RedditPosting] Submitted to r/${subreddit}${postId ? ` (${postId})` : ""}`);
            return { success: true, postId, url: postUrl };
        } catch (err) {
            const detail = err.response?.data?.message || err.message;
            const status = err.response?.status;
            logger.error(`[RedditPosting] Submit failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

module.exports = { createPost, isEnabled };
