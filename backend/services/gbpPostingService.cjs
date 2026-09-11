"use strict";
/**
 * Google Business Profile Posting Service — real Business Profile Local
 * Posts API publishing.
 *
 * Mission 60-C (Batch C / Google Business Profile, final social platform):
 * M59 found NO Google Business Profile adapter of any kind. This is a
 * from-scratch adapter, following the same shape as every other Batch A/B/
 * C adapter (org-scoped vault-then-OAuth resolution, honest not-configured
 * failure, shared retry/idempotency).
 *
 * REAL PROVIDER MODEL (not invented complexity): a Business Profile post
 * requires a specific Location under a specific Account — there is no
 * "default location." This adapter resolves accounts/locations via the
 * real Account Management API before a post can be created:
 *   1. GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts
 *      -> list of Business accounts the connected Google identity manages.
 *   2. GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
 *      -> list of locations under that account.
 *   3. POST https://mybusiness.googleapis.com/v4/{location}/localPosts
 *      -> create the actual post (the Local Posts API remains on the
 *      legacy v4 "mybusiness.googleapis.com" host — Google split account/
 *      location management into newer APIs but Local Posts itself was not
 *      migrated at time of writing; using the real, currently-documented
 *      endpoint, not a guessed one).
 *
 * KNOWN EXTERNAL BLOCKER: the Business Profile Performance/Posts APIs are
 * NOT self-service — Google requires a manual API-access request (a form
 * + review, historically days-to-weeks) before a Google Cloud project can
 * call them at all, even in testing. This is stricter than YouTube's
 * upload-scope verification and closer to Meta's App Review in effect,
 * but it is a distinct, separate external gate specific to this API.
 *
 * Reuses, does not duplicate:
 *   - oauthIntegrationLayer.cjs's new "gbp" provider entry (Google OAuth2,
 *     business.manage scope, separate from the shared "google"/"youtube"
 *     entries so Gmail/Drive/YouTube connections don't silently gain
 *     Business Profile access).
 *   - secretVault.cjs "social:gbp" connector for an org bringing its own
 *     access token + location id directly.
 *   - socialPublishSupport.cjs for retry/idempotency (single-call create,
 *     safely retryable like Pinterest/Reddit's).
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));
const _oauth = () => _try(() => require("./oauthIntegrationLayer.cjs"));

const ACCOUNT_MGMT_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LOCAL_POSTS_BASE = "https://mybusiness.googleapis.com/v4";
const CONNECTOR_ID = "social:gbp";
const MAX_SUMMARY = 1500; // Google Business Profile's real post summary limit

async function _token(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "oauth_token", orgId));
        if (v) return v;
    }
    const oauth = _oauth();
    if (!oauth) return null;
    try {
        const conns = oauth.listConnections().filter(c => c.provider === "gbp");
        if (!conns.length) return null;
        const rec = await oauth.getToken("gbp", conns[0].userId);
        return rec?.access_token || null;
    } catch {
        return null;
    }
}

async function isEnabled(orgId = null) {
    return !!(await _token(orgId));
}

/**
 * List the connected identity's Business accounts (step 1 of account/
 * location resolution — a caller must choose one before listing locations).
 */
async function listAccounts(orgId = null) {
    const token = await _token(orgId);
    if (!token) return { success: false, error: "Google Business Profile not configured" };
    try {
        const res = await axios.get(`${ACCOUNT_MGMT_BASE}/accounts`, {
            headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
        });
        return { success: true, accounts: (res.data?.accounts || []).map(a => ({ name: a.name, accountName: a.accountName, type: a.type })) };
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        return { success: false, error: detail };
    }
}

/**
 * List locations under a given account (step 2 — a post targets one
 * specific location, there is no "default location").
 */
async function listLocations(accountName, orgId = null) {
    if (!accountName) return { success: false, error: "accountName required (see listAccounts())" };
    const token = await _token(orgId);
    if (!token) return { success: false, error: "Google Business Profile not configured" };
    try {
        const res = await axios.get(`${BUSINESS_INFO_BASE}/${accountName}/locations`, {
            params: { readMask: "name,title" },
            headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
        });
        return { success: true, locations: (res.data?.locations || []).map(l => ({ name: l.name, title: l.title })) };
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        return { success: false, error: detail };
    }
}

/**
 * Create a Local Post on a specific location.
 * @param {object} opts
 * @param {string} opts.locationName - full resource name from listLocations(), e.g. "accounts/123/locations/456"
 * @param {string} opts.summary - post text, max 1500 chars
 * @param {string} [opts.actionUrl] - optional CTA link
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, postName?:string, error?:string}>}
 */
async function createPost({ locationName, summary, actionUrl = null } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (!locationName) return { success: false, error: "locationName required (see GET /creative/social/publish/gbp/locations)" };
    if (!summary || !summary.trim()) return { success: false, error: "summary required" };
    if (summary.length > MAX_SUMMARY) return { success: false, error: `summary exceeds Google Business Profile's ${MAX_SUMMARY} character limit (${summary.length} chars)` };

    const dedupKey = idempotencyKey ? `gbp:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const token = await _token(orgId);
    if (!token) {
        return { success: false, error: "Google Business Profile not configured — connect via GET /vault/oauth/gbp/authorize (requires business.manage scope + Google API access approval), or set an access token via /my-connectors/gbp" };
    }

    const result = await withRetry(async () => {
        try {
            const body = { languageCode: "en", summary, topicType: "STANDARD" };
            if (actionUrl) body.callToAction = { actionType: "LEARN_MORE", url: actionUrl };

            const res = await axios.post(`${LOCAL_POSTS_BASE}/${locationName}/localPosts`, body, {
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                timeout: 15000,
            });
            const postName = res.data?.name || null;
            logger.info(`[GBPPosting] Created post${postName ? ` (${postName})` : ""}`);
            return { success: true, postName };
        } catch (err) {
            const detail = err.response?.data?.error?.message || err.message;
            const status = err.response?.status;
            logger.error(`[GBPPosting] Post creation failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

module.exports = { createPost, listAccounts, listLocations, isEnabled };
