"use strict";
/**
 * YouTube Posting Service — real YouTube Data API v3 video upload.
 *
 * Mission 60 (Batch A / YouTube): M59 found NO YouTube adapter — content
 * generation (title/description text) only. Unlike every other Batch-A
 * platform built so far, YouTube has no text-only "post" primitive — its
 * actual publish surface is a VIDEO upload (resumable upload protocol,
 * Data API v3 videos.insert). This adapter takes a local video file path
 * as input (e.g. the real MP4 agents/content/videoGeneratorAgent.cjs
 * already writes to data/video/) rather than fabricating a text-post
 * capability YouTube's API doesn't actually offer.
 *
 * Upload protocol (real, per Google's documented resumable upload flow):
 *   1. POST .../upload/youtube/v3/videos?uploadType=resumable with the
 *      video metadata JSON body -> Google returns a Location header (a
 *      one-time upload session URL).
 *   2. PUT the raw video bytes to that Location URL.
 * This is NOT a single HTTP call like every other platform in this
 * mission — genuinely required by the provider, not invented complexity.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's new "youtube" provider entry (Google
 *     OAuth2, youtube.upload scope) for token storage/refresh.
 *   - secretVault.cjs "social:youtube" connector for an org bringing its
 *     own refresh token.
 *   - socialPublishSupport.cjs for idempotency (retry is deliberately NOT
 *     applied to the upload PUT itself — retrying a large partial upload
 *     blindly could double-upload; only the initiate-session POST uses
 *     transient retry).
 */

const fs     = require("fs");
const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const YT_UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos";
const CONNECTOR_ID = "social:youtube";
const MAX_TITLE = 100;        // YouTube's real title limit
const MAX_DESCRIPTION = 5000; // YouTube's real description limit

async function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (v) return v;
    }
    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "youtube");
        if (!conns.length) return null;
        const rec = await oauth.getToken("youtube", conns[0].userId);
        return rec?.access_token || null;
    } catch {
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _token(orgId));
}

/**
 * Upload a video to the connected YouTube channel.
 * @param {object} opts
 * @param {string} opts.filePath - absolute path to a local video file (mp4)
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string} [opts.privacyStatus] - "private" (default, safest) | "unlisted" | "public"
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, videoId?:string, url?:string, error?:string}>}
 */
async function uploadVideo({ filePath, title, description = "", privacyStatus = "private" } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (!filePath || typeof filePath !== "string") return { success: false, error: "filePath required" };
    if (!fs.existsSync(filePath)) return { success: false, error: `Video file not found: ${filePath}` };
    if (!title || !title.trim()) return { success: false, error: "title required" };
    if (title.length > MAX_TITLE) return { success: false, error: `title exceeds YouTube's ${MAX_TITLE} character limit (${title.length} chars)` };
    if (description.length > MAX_DESCRIPTION) return { success: false, error: `description exceeds YouTube's ${MAX_DESCRIPTION} character limit (${description.length} chars)` };
    if (!["private", "unlisted", "public"].includes(privacyStatus)) return { success: false, error: `invalid privacyStatus: ${privacyStatus}` };

    const dedupKey = idempotencyKey ? `youtube:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const token = await _token(orgId);
    if (!token) {
        return { success: false, error: "YouTube not configured — connect via GET /vault/oauth/youtube/authorize (requires youtube.upload scope), or set a refresh token via /my-connectors/youtube" };
    }

    const stat = fs.statSync(filePath);

    const result = await (async () => {
        // Step 1: initiate the resumable upload session (transient-retryable).
        const initResult = await withRetry(async () => {
            try {
                const res = await axios.post(
                    `${YT_UPLOAD_BASE}?uploadType=resumable&part=snippet,status`,
                    {
                        snippet: { title, description, categoryId: "22" }, // 22 = "People & Blogs", a safe generic default
                        status:  { privacyStatus },
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json; charset=UTF-8",
                            "X-Upload-Content-Type": "video/mp4",
                            "X-Upload-Content-Length": String(stat.size),
                        },
                        timeout: 15000,
                    }
                );
                const uploadUrl = res.headers?.location;
                if (!uploadUrl) return { success: false, error: "YouTube did not return an upload session URL" };
                return { success: true, uploadUrl };
            } catch (err) {
                const detail = err.response?.data?.error?.message || err.message;
                const status = err.response?.status;
                logger.error(`[YouTubePosting] Upload session init failed (${status || "network"}): ${detail}`);
                return { success: false, error: detail, status };
            }
        });
        if (!initResult.success) return initResult;

        // Step 2: PUT the actual video bytes — NOT retried automatically;
        // a failed large-body PUT should surface as a real error rather
        // than silently re-uploading (risk of duplicate/partial content).
        try {
            const buffer = fs.readFileSync(filePath);
            const putRes = await axios.put(initResult.uploadUrl, buffer, {
                headers: { "Content-Type": "video/mp4", "Content-Length": String(stat.size) },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120000,
            });
            const videoId = putRes.data?.id || null;
            logger.info(`[YouTubePosting] Uploaded${videoId ? ` (${videoId})` : ""}`);
            return { success: true, videoId, url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null };
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;
            logger.error(`[YouTubePosting] Video upload PUT failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    })();

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

async function deleteVideo(videoId, orgId = null) {
    const token = await _token(orgId);
    if (!token) return { success: false, error: "YouTube not configured" };
    if (!videoId) return { success: false, error: "videoId required" };

    try {
        await axios.delete("https://www.googleapis.com/youtube/v3/videos", {
            params: { id: videoId },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 12000,
        });
        logger.info(`[YouTubePosting] Deleted video ${videoId}`);
        return { success: true, deleted: true };
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        logger.error(`[YouTubePosting] Delete failed for ${videoId}: ${detail}`);
        return { success: false, error: detail };
    }
}

module.exports = { uploadVideo, deleteVideo, isEnabled };
