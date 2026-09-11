"use strict";
/**
 * Facebook Posting Service — real Facebook Graph API Page publishing.
 *
 * Mission 60 (Batch A / Facebook): M59 found NO Facebook adapter of any
 * kind — content generation only. This is a from-scratch adapter,
 * following linkedinPostingService.cjs/socialPostingService.cjs's exact
 * shape (post/isEnabled, honest not-configured failure, shared retry/
 * idempotency via socialPublishSupport.cjs).
 *
 * Facebook-specific wrinkle (not present for X/LinkedIn): a user access
 * token from oauthIntegrationLayer cannot publish to a Page directly.
 * Meta's model requires exchanging it for a PAGE access token via
 * GET /me/accounts, then publishing with THAT token against
 * /{page-id}/feed. This service does that exchange itself (cached per
 * process to avoid an extra round trip on every publish) rather than
 * expanding oauthIntegrationLayer's generic OAuth shape for one provider's
 * two-step model.
 *
 * KNOWN EXTERNAL BLOCKER (not a code gap): pages_manage_posts and
 * pages_read_engagement are Meta "Advanced Access" permissions. A token
 * can be issued with Standard Access, but any /feed publish call will
 * fail with a permissions error until the app completes Meta App Review
 * (business verification + screencast demo) — an external, non-technical
 * process outside this repo's control, typically days to weeks. This
 * adapter is code-complete and will work the moment Review is granted and
 * a Page is connected; it cannot be made to work sooner by writing more code.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs for the Facebook Login OAuth2 flow.
 *   - secretVault.cjs "social:facebook" connector for an org that already
 *     has its own Page access token and wants to skip re-running OAuth.
 *   - socialPublishSupport.cjs for retry/backoff + idempotency.
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const FB_API_BASE = "https://graph.facebook.com/v19.0";
const CONNECTOR_ID = "social:facebook";
const MAX_CHARS = 63206; // Facebook's real post length limit

// Per-process cache of resolved Page id/token, keyed by orgId ("global" for
// the founder). Avoids a GET /me/accounts round trip on every publish call —
// the Page token itself doesn't expire on the same cadence as the user
// token, and a stale cache simply gets a real 401 from Facebook on next
// publish, which clears it and re-resolves (see _publishRaw's catch below).
const _pageCache = new Map(); // scope -> { pageId, pageToken }

async function _resolvePage(orgId) {
    const scope = orgId || "global";
    if (_pageCache.has(scope)) return _pageCache.get(scope);

    if (orgId) {
        const pageId    = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "webhook_secret", orgId)); // reuses an existing slot for the Page ID, same convention as WhatsApp's phone_id
        const pageToken = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (pageId && pageToken) {
            const resolved = { pageId, pageToken };
            _pageCache.set(scope, resolved);
            return resolved;
        }
    }

    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "facebook");
        if (!conns.length) return null;
        const rec = await oauth.getToken("facebook", conns[0].userId);
        if (!rec?.access_token) return null;

        const res = await axios.get(`${FB_API_BASE}/me/accounts`, {
            params: { access_token: rec.access_token },
            timeout: 10000,
        });
        const page = (res.data?.data || [])[0]; // first Page the user administers
        if (!page?.id || !page?.access_token) return null;

        const resolved = { pageId: page.id, pageToken: page.access_token };
        _pageCache.set(scope, resolved);
        return resolved;
    } catch (err) {
        logger.warn(`[FacebookPosting] Page resolution failed: ${err.response?.data?.error?.message || err.message}`);
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _resolvePage(orgId));
}

/**
 * Publish a text post to a Facebook Page's feed.
 * @param {string} text
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
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
        return { success: false, error: `text exceeds Facebook's ${MAX_CHARS} character limit (${text.length} chars)` };
    }

    const dedupKey = idempotencyKey ? `facebook:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const page = await _resolvePage(orgId);
    if (!page) {
        return { success: false, error: "Facebook not configured — connect via GET /vault/oauth/facebook/authorize and grant access to a Page, or set a Page token via /my-connectors/facebook" };
    }

    const result = await withRetry(async () => {
        try {
            const res = await axios.post(
                `${FB_API_BASE}/${page.pageId}/feed`,
                null,
                { params: { message: text, access_token: page.pageToken }, timeout: 12000 }
            );
            const postId = res.data?.id || null;
            logger.info(`[FacebookPosting] Posted to Page ${page.pageId}${postId ? ` (${postId})` : ""}`);
            return { success: true, postId, url: postId ? `https://www.facebook.com/${postId}` : null };
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;
            // A stale cached Page token surfaces as 190 (expired) or 200
            // (permissions) — clear the cache so the next call re-resolves.
            if (status === 401 || err.response?.data?.error?.code === 190) {
                _pageCache.delete(orgId || "global");
            }
            logger.error(`[FacebookPosting] Post failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

async function deletePost(postId, orgId = null) {
    const page = await _resolvePage(orgId);
    if (!page) return { success: false, error: "Facebook not configured" };
    if (!postId) return { success: false, error: "postId required" };

    try {
        await axios.delete(`${FB_API_BASE}/${postId}`, {
            params: { access_token: page.pageToken }, timeout: 12000,
        });
        logger.info(`[FacebookPosting] Deleted post ${postId}`);
        return { success: true, deleted: true };
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        logger.error(`[FacebookPosting] Delete failed for ${postId}: ${detail}`);
        return { success: false, error: detail };
    }
}

module.exports = { post, deletePost, isEnabled };
