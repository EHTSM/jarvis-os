"use strict";
/**
 * Pinterest Posting Service — real Pinterest API v5 pin creation.
 *
 * Mission 60-B (Batch B / Pinterest): M59 found no Pinterest adapter —
 * content generation (pin copy) only. Pinterest's real Pin creation is a
 * SINGLE-CALL API (unlike Instagram/Threads/YouTube/TikTok's two-step
 * container flows) — POST /v5/pins with board_id, a media_source (image
 * URL), title, description, and an optional link — closer in shape to
 * X/LinkedIn's adapters.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's new "pinterest" provider entry (standard
 *     OAuth2, Basic-auth token exchange — see tokenAuthMode in _cfg()).
 *   - secretVault.cjs "social:pinterest" connector for an org bringing its
 *     own access token + default board id.
 *   - socialPublishSupport.cjs for retry/idempotency (this IS safely
 *     auto-retryable end-to-end, unlike the two-step container flows,
 *     since a single POST either fully succeeds or fully fails — no
 *     partial-container state to worry about).
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const PIN_API_BASE = "https://api.pinterest.com/v5";
const CONNECTOR_ID = "social:pinterest";
const MAX_TITLE = 100;       // Pinterest's real pin title limit
const MAX_DESCRIPTION = 500; // Pinterest's real pin description limit

async function _account(orgId) {
    if (orgId) {
        const token = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (token) return { token };
    }
    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "pinterest");
        if (!conns.length) return null;
        const rec = await oauth.getToken("pinterest", conns[0].userId);
        if (!rec?.access_token) return null;
        return { token: rec.access_token };
    } catch {
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _account(orgId));
}

/**
 * List the connected account's boards — needed since a pin requires a
 * board_id the caller must choose (Pinterest has no "default board").
 */
async function listBoards(orgId = null) {
    const account = await _account(orgId);
    if (!account) return { success: false, error: "Pinterest not configured" };
    try {
        const res = await axios.get(`${PIN_API_BASE}/boards`, {
            headers: { Authorization: `Bearer ${account.token}` }, timeout: 10000,
        });
        return { success: true, boards: (res.data?.items || []).map(b => ({ id: b.id, name: b.name })) };
    } catch (err) {
        const detail = err.response?.data?.message || err.message;
        return { success: false, error: detail };
    }
}

/**
 * Create a pin.
 * @param {object} opts
 * @param {string} opts.boardId - target board (see listBoards())
 * @param {string} opts.imageUrl - publicly reachable image URL (Pinterest fetches it server-side)
 * @param {string} [opts.title] - max 100 chars
 * @param {string} [opts.description] - max 500 chars
 * @param {string} [opts.link] - destination URL the pin links out to
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, pinId?:string, url?:string, error?:string}>}
 */
async function createPin({ boardId, imageUrl, title = "", description = "", link = "" } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (!boardId) return { success: false, error: "boardId required (see GET /creative/social/publish/pinterest/boards)" };
    if (!imageUrl) return { success: false, error: "imageUrl required" };
    if (!/^https:\/\//.test(imageUrl)) return { success: false, error: "imageUrl must be an https:// URL Pinterest's servers can fetch" };
    if (title.length > MAX_TITLE) return { success: false, error: `title exceeds Pinterest's ${MAX_TITLE} character limit (${title.length} chars)` };
    if (description.length > MAX_DESCRIPTION) return { success: false, error: `description exceeds Pinterest's ${MAX_DESCRIPTION} character limit (${description.length} chars)` };

    const dedupKey = idempotencyKey ? `pinterest:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const account = await _account(orgId);
    if (!account) {
        return { success: false, error: "Pinterest not configured — connect via GET /vault/oauth/pinterest/authorize (requires pins:write scope), or set an access token via /my-connectors/pinterest" };
    }

    const result = await withRetry(async () => {
        try {
            const body = {
                board_id: boardId,
                media_source: { source_type: "image_url", url: imageUrl },
            };
            if (title) body.title = title;
            if (description) body.description = description;
            if (link) body.link = link;

            const res = await axios.post(`${PIN_API_BASE}/pins`, body, {
                headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
                timeout: 15000,
            });
            const pinId = res.data?.id || null;
            logger.info(`[PinterestPosting] Created pin${pinId ? ` (${pinId})` : ""}`);
            return { success: true, pinId, url: pinId ? `https://www.pinterest.com/pin/${pinId}/` : null };
        } catch (err) {
            const detail = err.response?.data?.message || err.message;
            const status = err.response?.status;
            logger.error(`[PinterestPosting] Pin creation failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

async function deletePin(pinId, orgId = null) {
    const account = await _account(orgId);
    if (!account) return { success: false, error: "Pinterest not configured" };
    if (!pinId) return { success: false, error: "pinId required" };

    try {
        await axios.delete(`${PIN_API_BASE}/pins/${pinId}`, {
            headers: { Authorization: `Bearer ${account.token}` }, timeout: 12000,
        });
        logger.info(`[PinterestPosting] Deleted pin ${pinId}`);
        return { success: true, deleted: true };
    } catch (err) {
        const detail = err.response?.data?.message || err.message;
        logger.error(`[PinterestPosting] Delete failed for ${pinId}: ${detail}`);
        return { success: false, error: detail };
    }
}

module.exports = { createPin, deletePin, listBoards, isEnabled };
