"use strict";
/**
 * Instagram Posting Service — real Instagram Graph API (Business/Creator)
 * publishing, image and video/reel.
 *
 * Mission 60 (Batch A / Instagram): M59 found NO Instagram adapter of any
 * kind. This is a from-scratch adapter. Instagram Business/Creator
 * publishing has NO separate developer app or OAuth flow — it rides the
 * exact same Facebook Login connection facebookPostingService.cjs already
 * resolves (Meta's real account model: an Instagram Business account must
 * be linked to a Facebook Page). This service reuses that one connection
 * rather than asking a founder to connect Meta twice.
 *
 * REAL PROVIDER CONSTRAINT (not a code gap, genuinely required by the
 * API): Instagram's Content Publishing API does not accept uploaded file
 * bytes. It works in two steps —
 *   1. POST /{ig-user-id}/media with { image_url | video_url, caption }
 *      -> Instagram's servers fetch that URL themselves and return a
 *      creation_id (a media container).
 *   2. POST /{ig-user-id}/media_publish with { creation_id } -> publishes it.
 * The media MUST already be reachable at a public, unauthenticated URL
 * before step 1 — this adapter cannot make a local file or an
 * auth-gated route (e.g. this repo's existing /creative/image/file/:id,
 * which requires requireAuth) usable as-is; the caller must supply a
 * URL Instagram's servers can actually fetch (e.g. a CDN/object-storage
 * URL). This is Instagram's real API contract, not a limitation invented
 * by this adapter.
 *
 * KNOWN EXTERNAL BLOCKER: instagram_content_publish is an Advanced Access
 * permission requiring Meta App Review — same gate documented in
 * facebookPostingService.cjs, and in fact the SAME review request (this
 * repo's Facebook OAuth scopes already include it, Mission 60).
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's "facebook" connection + Page resolution
 *     logic (mirrors facebookPostingService.cjs's _resolvePage, then
 *     additionally resolves the Page's linked Instagram Business account
 *     id via GET /{page-id}?fields=instagram_business_account).
 *   - secretVault.cjs "social:instagram" connector for an org bringing its
 *     own IG user id + Page token directly.
 *   - socialPublishSupport.cjs for idempotency (retry deliberately NOT
 *     applied to the publish step once a container exists, to avoid a
 *     duplicate post — only the container-creation call is retried).
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const FB_API_BASE = "https://graph.facebook.com/v19.0";
const CONNECTOR_ID = "social:instagram";
const MAX_CAPTION = 2200; // Instagram's real caption limit

const _igCache = new Map(); // scope -> { igUserId, pageToken }

async function _resolveIgAccount(orgId) {
    const scope = orgId || "global";
    if (_igCache.has(scope)) return _igCache.get(scope);

    if (orgId) {
        const igUserId  = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "webhook_secret", orgId)); // reused slot, same convention as Facebook's Page ID
        const pageToken = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (igUserId && pageToken) {
            const resolved = { igUserId, pageToken };
            _igCache.set(scope, resolved);
            return resolved;
        }
    }

    const oauth = _oauth();
    if (!oauth) return null;
    try {
        // Reuses the SAME "facebook" connection facebookPostingService.cjs
        // resolves from — Instagram Business publishing has no separate
        // OAuth provider in Meta's real model.
        const conns = oauth.listConnections().filter(c => c.provider === "facebook");
        if (!conns.length) return null;
        const rec = await oauth.getToken("facebook", conns[0].userId);
        if (!rec?.access_token) return null;

        const pagesRes = await axios.get(`${FB_API_BASE}/me/accounts`, {
            params: { access_token: rec.access_token }, timeout: 10000,
        });
        const page = (pagesRes.data?.data || [])[0];
        if (!page?.id || !page?.access_token) return null;

        const igRes = await axios.get(`${FB_API_BASE}/${page.id}`, {
            params: { fields: "instagram_business_account", access_token: page.access_token },
            timeout: 10000,
        });
        const igUserId = igRes.data?.instagram_business_account?.id;
        if (!igUserId) return null; // Page exists but has no linked Instagram Business/Creator account

        const resolved = { igUserId, pageToken: page.access_token };
        _igCache.set(scope, resolved);
        return resolved;
    } catch (err) {
        logger.warn(`[InstagramPosting] Account resolution failed: ${err.response?.data?.error?.message || err.message}`);
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _resolveIgAccount(orgId));
}

/**
 * Publish an image or video/reel to Instagram via the two-step Content
 * Publishing API. mediaUrl MUST be a publicly fetchable URL — see the
 * module docstring for why a local file path cannot be used directly.
 * @param {object} opts
 * @param {string} opts.mediaUrl - publicly reachable image or video URL
 * @param {"image"|"video"} [opts.mediaType]
 * @param {string} [opts.caption] - max 2200 chars
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, mediaId?:string, error?:string}>}
 */
async function post({ mediaUrl, mediaType = "image", caption = "" } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (!mediaUrl || typeof mediaUrl !== "string") return { success: false, error: "mediaUrl required — must be a publicly fetchable URL (Instagram's API does not accept uploaded file bytes)" };
    if (!/^https:\/\//.test(mediaUrl)) return { success: false, error: "mediaUrl must be an https:// URL Instagram's servers can fetch" };
    if (!["image", "video"].includes(mediaType)) return { success: false, error: `invalid mediaType: ${mediaType}` };
    if (caption.length > MAX_CAPTION) return { success: false, error: `caption exceeds Instagram's ${MAX_CAPTION} character limit (${caption.length} chars)` };

    const dedupKey = idempotencyKey ? `instagram:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const account = await _resolveIgAccount(orgId);
    if (!account) {
        return { success: false, error: "Instagram not configured — connect Facebook via GET /vault/oauth/facebook/authorize with a Page that has a linked Instagram Business/Creator account, or set one via /my-connectors/instagram" };
    }

    const result = await (async () => {
        const containerResult = await withRetry(async () => {
            try {
                const params = { access_token: account.pageToken, caption };
                params[mediaType === "video" ? "video_url" : "image_url"] = mediaUrl;
                const res = await axios.post(`${FB_API_BASE}/${account.igUserId}/media`, null, { params, timeout: 15000 });
                const creationId = res.data?.id;
                if (!creationId) return { success: false, error: "Instagram did not return a creation_id" };
                return { success: true, creationId };
            } catch (err) {
                const detail = err.response?.data?.error?.message || err.message;
                const status = err.response?.status;
                logger.error(`[InstagramPosting] Container creation failed (${status || "network"}): ${detail}`);
                return { success: false, error: detail, status };
            }
        });
        if (!containerResult.success) return containerResult;

        // Publish step — not auto-retried (a container can only be
        // published once; blindly retrying a network timeout here risks
        // ambiguity about whether the first attempt actually succeeded).
        try {
            const res = await axios.post(`${FB_API_BASE}/${account.igUserId}/media_publish`, null, {
                params: { creation_id: containerResult.creationId, access_token: account.pageToken },
                timeout: 15000,
            });
            const mediaId = res.data?.id || null;
            logger.info(`[InstagramPosting] Published${mediaId ? ` (${mediaId})` : ""}`);
            return { success: true, mediaId, url: mediaId ? `https://www.instagram.com/p/${mediaId}/` : null };
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;
            logger.error(`[InstagramPosting] Publish failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    })();

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

module.exports = { post, isEnabled };
