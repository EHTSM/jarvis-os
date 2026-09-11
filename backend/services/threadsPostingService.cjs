"use strict";
/**
 * Threads Posting Service — real Meta Threads API text/image/video publish.
 *
 * Mission 60-B (Batch B / Threads): M59 found no Threads adapter — content
 * generation (caption text) only. Threads has its own developer app and
 * OAuth flow (threads.net), genuinely distinct from Facebook Login/
 * Instagram Graph API despite being a Meta product — see the "threads"
 * provider entry added to oauthIntegrationLayer.cjs.
 *
 * Real two-step Threads Publishing API (same shape as Instagram's, a
 * deliberate Meta API-family convention, not a coincidence):
 *   1. POST /{threads-user-id}/threads with { media_type, text, image_url|
 *      video_url } -> returns a creation_id (container).
 *   2. POST /{threads-user-id}/threads_publish with { creation_id } ->
 *      publishes it.
 * Unlike Instagram, Threads supports a TEXT-only media_type — a caption
 * can be published with no image/video at all, so (unlike Instagram) this
 * adapter has a genuine text-only publish path requiring no public media
 * URL.
 *
 * KNOWN EXTERNAL BLOCKER: threads_content_publish requires the same kind
 * of Meta App Review as Facebook/Instagram's Advanced Access permissions
 * (business verification) before a non-admin/tester account can use it in
 * production.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's new "threads" provider entry.
 *   - secretVault.cjs "social:threads" connector for an org bringing its
 *     own access token + Threads user id.
 *   - socialPublishSupport.cjs for retry/idempotency (same reasoning as
 *     Instagram: the publish step is not auto-retried once a container
 *     exists, to avoid a duplicate post).
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const TH_API_BASE = "https://graph.threads.net/v1.0";
const CONNECTOR_ID = "social:threads";
const MAX_TEXT = 500; // Threads' real post length limit

async function _account(orgId) {
    if (orgId) {
        const userId = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "webhook_secret", orgId)); // reused slot, same convention as Facebook/Instagram's id fields
        const token  = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (userId && token) return { userId, token };
    }
    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "threads");
        if (!conns.length) return null;
        const rec = await oauth.getToken("threads", conns[0].userId);
        if (!rec?.access_token) return null;
        const userId = rec.userInfo?.id;
        if (!userId) return null;
        return { userId, token: rec.access_token };
    } catch {
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _account(orgId));
}

/**
 * Publish a Threads post — text-only, or with a public image/video URL.
 * @param {object} opts
 * @param {string} opts.text - max 500 chars
 * @param {string} [opts.mediaUrl] - publicly reachable image/video URL (optional — Threads supports text-only posts)
 * @param {"TEXT"|"IMAGE"|"VIDEO"} [opts.mediaType] - defaults to "TEXT" if no mediaUrl, else inferred is required explicitly
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, postId?:string, url?:string, error?:string}>}
 */
async function post({ text, mediaUrl = null, mediaType = null } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (typeof text !== "string" || !text.trim()) {
        return { success: false, error: "text required" };
    }
    if (text.length > MAX_TEXT) {
        return { success: false, error: `text exceeds Threads' ${MAX_TEXT} character limit (${text.length} chars)` };
    }
    const type = mediaType || (mediaUrl ? null : "TEXT");
    if (!type) return { success: false, error: "mediaType required when mediaUrl is supplied (\"IMAGE\" or \"VIDEO\")" };
    if (!["TEXT", "IMAGE", "VIDEO"].includes(type)) return { success: false, error: `invalid mediaType: ${type}` };
    if (type !== "TEXT" && !mediaUrl) return { success: false, error: `mediaUrl required for mediaType "${type}"` };
    if (mediaUrl && !/^https:\/\//.test(mediaUrl)) return { success: false, error: "mediaUrl must be an https:// URL Threads' servers can fetch" };

    const dedupKey = idempotencyKey ? `threads:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const account = await _account(orgId);
    if (!account) {
        return { success: false, error: "Threads not configured — connect via GET /vault/oauth/threads/authorize (requires threads_content_publish scope), or set an access token via /my-connectors/threads" };
    }

    const result = await (async () => {
        const containerResult = await withRetry(async () => {
            try {
                const params = { access_token: account.token, media_type: type, text };
                if (type === "IMAGE") params.image_url = mediaUrl;
                if (type === "VIDEO") params.video_url = mediaUrl;
                const res = await axios.post(`${TH_API_BASE}/${account.userId}/threads`, null, { params, timeout: 15000 });
                const creationId = res.data?.id;
                if (!creationId) return { success: false, error: "Threads did not return a creation_id" };
                return { success: true, creationId };
            } catch (err) {
                const detail = err.response?.data?.error?.message || err.message;
                const status = err.response?.status;
                logger.error(`[ThreadsPosting] Container creation failed (${status || "network"}): ${detail}`);
                return { success: false, error: detail, status };
            }
        });
        if (!containerResult.success) return containerResult;

        try {
            const res = await axios.post(`${TH_API_BASE}/${account.userId}/threads_publish`, null, {
                params: { creation_id: containerResult.creationId, access_token: account.token },
                timeout: 15000,
            });
            const postId = res.data?.id || null;
            logger.info(`[ThreadsPosting] Published${postId ? ` (${postId})` : ""}`);
            return { success: true, postId, url: postId ? `https://www.threads.net/t/${postId}` : null };
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;
            logger.error(`[ThreadsPosting] Publish failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    })();

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

module.exports = { post, isEnabled };
