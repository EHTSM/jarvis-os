"use strict";
/**
 * Discord Posting Service — real Discord channel message publishing.
 *
 * Mission 60-C (Batch C / Discord): M59 found Discord had only reachability
 * probes (`connectDiscord`/`connectDiscordAuth` in integrationConnectors.cjs)
 * — identity/OAuth-authorize checks, never a message-send path. This is the
 * missing "actually post" half. Discord in this repo is registered under
 * the "msg" (messaging) connector phase, alongside WhatsApp/Telegram/
 * Twilio/Slack/Teams — consistent with treating it as a community/
 * messaging channel rather than a feed-style social network, but "post a
 * message to a channel" is a real, in-scope publishing capability by the
 * same definition every other adapter in this mission uses (text content
 * reaching an audience via a provider API), so it is implemented here
 * rather than left as identity-only.
 *
 * Two real, independent send paths (a caller uses whichever credential
 * is configured — this is Discord's actual capability model, not an
 * invented choice):
 *   - Webhook send (DISCORD_WEBHOOK_URL): the simplest, most stable path —
 *     a single POST to a pre-created channel webhook URL. No bot-gateway
 *     connection, no guild/channel lookup needed — matches the same
 *     "smallest genuinely-complete implementation" reasoning
 *     socialPostingService.cjs's own docstring used to justify choosing
 *     X's simple bearer-token model over a more complex platform first.
 *   - Bot REST send (DISCORD_BOT_TOKEN): posts to an arbitrary channel ID
 *     the bot has access to, via POST /channels/{channel.id}/messages —
 *     more flexible (any channel, not just one pre-wired webhook) but
 *     requires the bot to already be a member of the target server.
 *
 * Reuses, does not duplicate:
 *   - secretVault.cjs org-scoped credential resolution ("msg:discord",
 *     same connectorId integrationConnectors.cjs already probes), same
 *     vault-then-env fallback pattern as every other adapter.
 *   - socialPublishSupport.cjs for retry/idempotency.
 */

const axios  = require("axios");
const logger = require("../utils/logger");
const { checkIdempotency, recordIdempotency, withRetry } = require("./socialPublishSupport.cjs");

const _try   = fn => { try { return fn(); } catch { return null; } };
const _vault = () => _try(() => require("./secretVault.cjs"));

const DISCORD_API_BASE = "https://discord.com/api/v10";
const CONNECTOR_ID = "msg:discord";
const MAX_CONTENT = 2000; // Discord's real message length limit

function _webhookUrl(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "webhook_secret", orgId));
        if (v) return v;
    }
    return process.env.DISCORD_WEBHOOK_URL || "";
}

function _botToken(orgId) {
    if (orgId) {
        const v = _try(() => _vault()?.getSecret?.(CONNECTOR_ID, "api_key", orgId));
        if (v) return v;
    }
    return process.env.DISCORD_BOT_TOKEN || "";
}

async function isEnabled(orgId = null) {
    return !!(_webhookUrl(orgId) || _botToken(orgId));
}

/**
 * Post a message to Discord — via webhook (if configured) or bot REST API
 * (if a channelId + bot token are supplied and no webhook is set).
 * @param {object} opts
 * @param {string} opts.content - message text, max 2000 chars
 * @param {string} [opts.channelId] - required for the bot-token path; ignored for webhook (the webhook URL already targets one fixed channel)
 * @param {string|null} orgId
 * @param {string|null} idempotencyKey
 * @returns {Promise<{success:boolean, messageId?:string, error?:string}>}
 */
async function post({ content, channelId = null } = {}, orgId = null, idempotencyKey = null) {
    if (process.env.DISABLE_SOCIAL_POSTING === "true") {
        return { success: false, error: "Social posting disabled (DISABLE_SOCIAL_POSTING=true)" };
    }
    if (typeof content !== "string" || !content.trim()) {
        return { success: false, error: "content required" };
    }
    if (content.length > MAX_CONTENT) {
        return { success: false, error: `content exceeds Discord's ${MAX_CONTENT} character limit (${content.length} chars)` };
    }

    const dedupKey = idempotencyKey ? `discord:${orgId || "global"}:${idempotencyKey}` : null;
    const cached = checkIdempotency(dedupKey);
    if (cached) return cached;

    const webhookUrl = _webhookUrl(orgId);
    const botToken   = _botToken(orgId);

    if (!webhookUrl && !botToken) {
        return { success: false, error: "Discord not configured — set DISCORD_WEBHOOK_URL or DISCORD_BOT_TOKEN in .env, or connect via /my-connectors/discord" };
    }
    if (!webhookUrl && botToken && !channelId) {
        return { success: false, error: "channelId required when posting via bot token (no webhook configured)" };
    }

    const result = await withRetry(async () => {
        try {
            if (webhookUrl) {
                const res = await axios.post(webhookUrl, { content }, {
                    params: { wait: true }, // ask Discord to return the created message object
                    timeout: 12000,
                });
                const messageId = res.data?.id || null;
                logger.info(`[DiscordPosting] Posted via webhook${messageId ? ` (${messageId})` : ""}`);
                return { success: true, messageId };
            }
            const res = await axios.post(
                `${DISCORD_API_BASE}/channels/${channelId}/messages`,
                { content },
                { headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" }, timeout: 12000 }
            );
            const messageId = res.data?.id || null;
            logger.info(`[DiscordPosting] Posted via bot to channel ${channelId}${messageId ? ` (${messageId})` : ""}`);
            return { success: true, messageId };
        } catch (err) {
            const detail = err.response?.data?.message || err.message;
            const status = err.response?.status;
            logger.error(`[DiscordPosting] Post failed (${status || "network"}): ${detail}`);
            return { success: false, error: detail, status };
        }
    });

    if (dedupKey) recordIdempotency(dedupKey, result);
    return result;
}

module.exports = { post, isEnabled };
