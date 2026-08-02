"use strict";
/**
 * Social Posting Service — real X (Twitter) API v2 posting.
 *
 * Capability Reuse Verification mission: confirmed genuinely absent —
 * agents/internet/socialMediaAgent.cjs only reads public feeds (Reddit/HN),
 * socialContentEngine.cjs generates caption text but never publishes it
 * anywhere. This is the missing "actually post" half.
 *
 * Reuses, does not duplicate:
 *   - secretVault.cjs for org-scoped credential storage/resolution, same
 *     pattern as whatsappService.js/paymentService.js (vault-first, then
 *     global env fallback — omitting orgId preserves single-tenant use).
 *   - socialContentEngine.cjs for caption/content generation — this file
 *     only publishes text that's already been generated/approved elsewhere,
 *     it does not generate content itself.
 *
 * Scope: X (Twitter) API v2 only. Chosen over LinkedIn/Facebook/Instagram
 * because it has the simplest, most stable API (single bearer token, one
 * real HTTP call to publish text) — the smallest genuinely-complete
 * implementation rather than a half-built multi-platform stub. The same
 * vault-lookup + real-HTTP-call pattern extends cleanly to another
 * platform later without new architecture.
 *
 * Without real credentials (vault-stored or TWITTER_BEARER_TOKEN env var),
 * post() returns a real, honest "not configured" failure — never a
 * fabricated success.
 */

const axios  = require("axios");
const logger = require("../utils/logger");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

const X_API_BASE = "https://api.twitter.com/2";
const CONNECTOR_ID = "social:twitter";

function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (v) return v;
    }
    return process.env.TWITTER_BEARER_TOKEN || process.env.X_BEARER_TOKEN || "";
}

function isEnabled(orgId = null) {
    return !!_token(orgId);
}

/**
 * Publish a text post to X (Twitter).
 * @param {string} text - post body, max 280 chars (X's real limit)
 * @param {string|null} orgId - org-scoped credential lookup, see _token()
 * @returns {Promise<{success:boolean, postId?:string, url?:string, error?:string}>}
 */
async function post(text, orgId = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (typeof text !== "string" || !text.trim()) {
        return { success: false, error: "text required" };
    }
    if (text.length > 280) {
        return { success: false, error: `text exceeds X's 280 character limit (${text.length} chars)` };
    }

    const token = _token(orgId);
    if (!token) {
        return { success: false, error: "X (Twitter) not configured — set TWITTER_BEARER_TOKEN in .env, or connect via /my-connectors/twitter" };
    }

    try {
        const res = await axios.post(
            `${X_API_BASE}/tweets`,
            { text },
            { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 12000 }
        );
        const postId = res.data?.data?.id || null;
        logger.info(`[SocialPosting] Posted to X${postId ? ` (${postId})` : ""}`);
        return { success: true, postId, url: postId ? `https://x.com/i/web/status/${postId}` : null };
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.title || err.message;
        const status = err.response?.status;
        logger.error(`[SocialPosting] X post failed (${status || "network"}): ${detail}`);
        return { success: false, error: detail, status };
    }
}

/**
 * Delete a previously-created post (real API call, for undo/moderation).
 */
async function deletePost(postId, orgId = null) {
    const token = _token(orgId);
    if (!token) return { success: false, error: "X (Twitter) not configured" };
    if (!postId) return { success: false, error: "postId required" };

    try {
        const res = await axios.delete(`${X_API_BASE}/tweets/${postId}`, {
            headers: { Authorization: `Bearer ${token}` }, timeout: 12000,
        });
        return { success: true, deleted: res.data?.data?.deleted === true };
    } catch (err) {
        return { success: false, error: err.response?.data?.detail || err.message };
    }
}

module.exports = { post, deletePost, isEnabled };
