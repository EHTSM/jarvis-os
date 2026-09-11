"use strict";
/**
 * LinkedIn Posting Service — real LinkedIn UGC Posts API (v2) publishing.
 *
 * Mission 60 (Batch A / LinkedIn): M59 found only an OAuth-discovery
 * reachability probe (integrationConnectors.cjs's connectLinkedInAuth) —
 * no publish adapter existed. This is the missing "actually post" half,
 * following socialPostingService.cjs's exact shape (post/isEnabled,
 * honest not-configured failure, no fabricated success) but sourcing its
 * token from oauthIntegrationLayer.cjs instead of a static bearer token,
 * because LinkedIn's Share API requires a real OAuth2 authorization-code
 * flow (w_member_social scope) rather than a single app-issued token.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs for the LinkedIn OAuth2 flow (authorize/
 *     callback/token storage/refresh) — already wired for identity before
 *     this mission; w_member_social was added to its defaultScopes here.
 *   - Same single-tenant-with-org-fallback pattern socialPostingService.cjs
 *     and whatsappService.js already document: org-scoped lookup first
 *     (secretVault "social:linkedin"/"oauth_token", for an org that
 *     connected its own LinkedIn app-level token directly), falling back
 *     to the founder's own oauthIntegrationLayer connection (userId
 *     "founder", matching founderVault.js's existing convention) when no
 *     org-specific credential exists.
 *
 * Without a real token (vault-stored or a completed OAuth connection),
 * post() returns a real, honest "not configured" failure — never a
 * fabricated success.
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const LI_API_BASE = "https://api.linkedin.com/v2";
const CONNECTOR_ID = "social:linkedin";
const MAX_CHARS = 3000; // LinkedIn's real UGC post text limit

async function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (v) return { token: v, authorUrn: null };
    }
    const oauth = _oauth();
    if (!oauth) return { token: null, authorUrn: null };
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "linkedin");
        if (!conns.length) return { token: null, authorUrn: null };
        const rec = await oauth.getToken("linkedin", conns[0].userId);
        if (!rec?.access_token) return { token: null, authorUrn: null };
        // LinkedIn UGC Posts requires the author's URN (urn:li:person:{id}),
        // which handleCallback() already captured into userInfo via the
        // userinfo endpoint (the "sub" claim on OpenID Connect responses).
        const sub = rec.userInfo?.sub;
        return { token: rec.access_token, authorUrn: sub ? `urn:li:person:${sub}` : null };
    } catch {
        return { token: null, authorUrn: null };
    }
}

async function isEnabled(orgId = null) {
    const { token } = await _token(orgId);
    return !!token;
}

/**
 * Publish a text post to LinkedIn (personal profile share, UGC Posts API).
 * @param {string} text - post body, max 3000 chars (LinkedIn's real limit)
 * @param {string|null} orgId - org-scoped credential lookup, see _token()
 * @param {string|null} idempotencyKey - when supplied, a repeated call with
 *   the same key within 24h returns the original result instead of posting
 *   again (e.g. a client retry after a dropped response) — reuses
 *   socialPublishSupport.cjs's shared TTL-map dedup, same pattern
 *   whatsappService.js already uses for webhook replay.
 * @returns {Promise<{success:boolean, postId?:string, url?:string, error?:string}>}
 */
async function post(text, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (typeof text !== "string" || !text.trim()) {
        return { success: false, error: "text required" };
    }
    if (text.length > MAX_CHARS) {
        return { success: false, error: `text exceeds LinkedIn's ${MAX_CHARS} character limit (${text.length} chars)` };
    }

    const dedupKey = idempotencyKey ? `linkedin:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const { token, authorUrn } = await _token(orgId);
    if (!token) {
        return { success: false, error: "LinkedIn not configured — connect via GET /vault/oauth/linkedin/authorize (requires w_member_social scope), or set a vault credential via /my-connectors/linkedin" };
    }
    if (!authorUrn) {
        return { success: false, error: "LinkedIn connected but author identity (urn:li:person:*) is unavailable — reconnect via /vault/oauth/linkedin/authorize" };
    }

    const result = await withRetry(async () => {
        try {
            const res = await axios.post(
                `${LI_API_BASE}/ugcPosts`,
                {
                    author: authorUrn,
                    lifecycleState: "PUBLISHED",
                    specificContent: {
                        "com.linkedin.ugc.ShareContent": {
                            shareCommentary: { text },
                            shareMediaCategory: "NONE",
                        },
                    },
                    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "X-Restli-Protocol-Version": "2.0.0",
                    },
                    timeout: 12000,
                }
            );
            const postId = res.headers?.["x-restli-id"] || res.data?.id || null;
            logger.info(`[LinkedInPosting] Posted${postId ? ` (${postId})` : ""}`);
            return { success: true, postId, url: postId ? `https://www.linkedin.com/feed/update/${postId}/` : null };
        } catch (err) {
            const detail = err.response?.data?.message || err.message;
            const status = err.response?.status;
            logger.error(`[LinkedInPosting] Post failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

/**
 * Delete a previously-created post (real API call, for undo/moderation).
 */
async function deletePost(postId, orgId = null) {
    const { token } = await _token(orgId);
    if (!token) return { success: false, error: "LinkedIn not configured" };
    if (!postId) return { success: false, error: "postId required" };

    try {
        await axios.delete(`${LI_API_BASE}/ugcPosts/${encodeURIComponent(postId)}`, {
            headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" },
            timeout: 12000,
        });
        logger.info(`[LinkedInPosting] Deleted post ${postId}`);
        return { success: true, deleted: true };
    } catch (err) {
        const detail = err.response?.data?.message || err.message;
        logger.error(`[LinkedInPosting] Delete failed for ${postId}: ${detail}`);
        return { success: false, error: detail };
    }
}

module.exports = { post, deletePost, isEnabled };
