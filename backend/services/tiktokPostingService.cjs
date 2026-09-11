"use strict";
/**
 * TikTok Posting Service — real TikTok Content Posting API video publish.
 *
 * Mission 60 (Batch A / TikTok): M59 found NO TikTok adapter of any kind.
 * Like YouTube, TikTok's real publish primitive is a VIDEO, not text — this
 * takes a local video file path (e.g. the real MP4
 * agents/content/videoGeneratorAgent.cjs writes to data/video/) as input.
 *
 * Upload protocol (real, per TikTok's documented FILE_UPLOAD source flow):
 *   1. POST /v2/post/publish/video/init/ with video metadata + file size ->
 *      TikTok returns a publish_id and an upload_url.
 *   2. PUT the raw video bytes to that upload_url with a Content-Range
 *      header (TikTok requires this even for a single-chunk upload).
 *   3. (Optional) GET /v2/post/publish/status/fetch/ to confirm the post
 *      processed successfully — TikTok's init call succeeding does not by
 *      itself guarantee the video was accepted; done in getPostStatus().
 *
 * KNOWN EXTERNAL BLOCKER (not a code gap): video.publish is only usable in
 * production (public posts, arbitrary audience) once the TikTok Developer
 * app reaches "Audited" review status. An unaudited app can still call
 * this exact API in sandbox mode, but every post is forced private and
 * visible only to test users explicitly added in the Developer Portal —
 * this adapter is code-complete and will work in production the moment
 * audit is granted; it cannot be made to work sooner by writing more code.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's "tiktok" provider entry (client_key-based
 *     OAuth2, video.publish/video.upload scopes).
 *   - secretVault.cjs "social:tiktok" connector for an org bringing its
 *     own access token.
 *   - socialPublishSupport.cjs for idempotency (same reasoning as
 *     YouTube's adapter: the upload PUT itself is not blindly retried,
 *     only the init call is, to avoid a duplicate/partial upload).
 */

const fs     = require("fs");
const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const TT_API_BASE = "https://open.tiktokapis.com/v2";
const CONNECTOR_ID = "social:tiktok";
const MAX_TITLE = 2200; // TikTok's real caption/title limit

async function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (v) return v;
    }
    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "tiktok");
        if (!conns.length) return null;
        const rec = await oauth.getToken("tiktok", conns[0].userId);
        return rec?.access_token || null;
    } catch {
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _token(orgId));
}

/**
 * Upload and publish a video to the connected TikTok account.
 * @param {object} opts
 * @param {string} opts.filePath - absolute path to a local video file (mp4)
 * @param {string} opts.title - caption text, max 2200 chars
 * @param {string} [opts.privacyLevel] - "SELF_ONLY" (default, safest — required anyway for unaudited apps) | "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS"
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, publishId?:string, error?:string}>}
 */
async function uploadVideo({ filePath, title, privacyLevel = "SELF_ONLY" } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (!filePath || typeof filePath !== "string") return { success: false, error: "filePath required" };
    if (!fs.existsSync(filePath)) return { success: false, error: `Video file not found: ${filePath}` };
    if (!title || !title.trim()) return { success: false, error: "title required" };
    if (title.length > MAX_TITLE) return { success: false, error: `title exceeds TikTok's ${MAX_TITLE} character limit (${title.length} chars)` };
    const validPrivacy = ["SELF_ONLY", "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"];
    if (!validPrivacy.includes(privacyLevel)) return { success: false, error: `invalid privacyLevel: ${privacyLevel}` };

    const dedupKey = idempotencyKey ? `tiktok:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const token = await _token(orgId);
    if (!token) {
        return { success: false, error: "TikTok not configured — connect via GET /vault/oauth/tiktok/authorize (requires video.publish scope), or set an access token via /my-connectors/tiktok" };
    }

    const stat = fs.statSync(filePath);

    const result = await (async () => {
        const initResult = await withRetry(async () => {
            try {
                const res = await axios.post(
                    `${TT_API_BASE}/post/publish/video/init/`,
                    {
                        post_info: { title, privacy_level: privacyLevel },
                        source_info: {
                            source: "FILE_UPLOAD",
                            video_size: stat.size,
                            chunk_size: stat.size,
                            total_chunk_count: 1,
                        },
                    },
                    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
                );
                if (res.data?.error?.code && res.data.error.code !== "ok") {
                    return { success: false, error: res.data.error.message || res.data.error.code, status: res.status };
                }
                const publishId = res.data?.data?.publish_id;
                const uploadUrl = res.data?.data?.upload_url;
                if (!publishId || !uploadUrl) return { success: false, error: "TikTok did not return a publish_id/upload_url" };
                return { success: true, publishId, uploadUrl };
            } catch (err) {
                const detail = err.response?.data?.error?.message || err.message;
                const status = err.response?.status;
                logger.error(`[TikTokPosting] Publish init failed (${status || "network"}): ${detail}`);
                return { success: false, error: detail, status };
            }
        });
        if (!initResult.success) return initResult;

        // Upload the video bytes — not auto-retried (same reasoning as
        // YouTube's PUT step: avoid a duplicate/partial upload on retry).
        try {
            const buffer = fs.readFileSync(filePath);
            await axios.put(initResult.uploadUrl, buffer, {
                headers: {
                    "Content-Type": "video/mp4",
                    "Content-Range": `bytes 0-${stat.size - 1}/${stat.size}`,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120000,
            });
            logger.info(`[TikTokPosting] Uploaded (publish_id=${initResult.publishId})`);
            return { success: true, publishId: initResult.publishId };
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;
            logger.error(`[TikTokPosting] Video upload PUT failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    })();

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

/**
 * Check processing status of a previously-initiated publish (TikTok's
 * init succeeding does not itself guarantee the video was accepted).
 */
async function getPostStatus(publishId, orgId = null) {
    const token = await _token(orgId);
    if (!token) return { success: false, error: "TikTok not configured" };
    if (!publishId) return { success: false, error: "publishId required" };

    try {
        const res = await axios.post(
            `${TT_API_BASE}/post/publish/status/fetch/`,
            { publish_id: publishId },
            { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 10000 }
        );
        return { success: true, status: res.data?.data?.status, failReason: res.data?.data?.fail_reason || null };
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        return { success: false, error: detail };
    }
}

module.exports = { uploadVideo, getPostStatus, isEnabled };
