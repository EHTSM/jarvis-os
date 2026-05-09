"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "crossPlatformBrain";

const PLATFORMS    = ["web","mobile_ios","mobile_android","desktop","api","cli","voice","iot","ar_vr","enterprise"];
const CONTEXT_KEYS = ["userId","sessionId","platform","locale","timezone","deviceType","capabilityLevel","userPreferences"];

// ── Adapt a response for a specific platform ─────────────────────
function adaptForPlatform({ content, targetPlatform, context = {} }) {
    if (!content) return fail(AGENT, "content is required");
    if (!PLATFORMS.includes(targetPlatform)) return fail(AGENT, `targetPlatform must be: ${PLATFORMS.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const adaptations = {
        web:             { format: "html_markdown", maxLength: 10000, supportsRich: true,  supportsMedia: true  },
        mobile_ios:      { format: "json_card",     maxLength: 2000,  supportsRich: true,  supportsMedia: true  },
        mobile_android:  { format: "json_card",     maxLength: 2000,  supportsRich: true,  supportsMedia: true  },
        desktop:         { format: "full_text",     maxLength: 50000, supportsRich: true,  supportsMedia: true  },
        api:             { format: "json",          maxLength: null,  supportsRich: false, supportsMedia: false },
        cli:             { format: "plain_text",    maxLength: 5000,  supportsRich: false, supportsMedia: false },
        voice:           { format: "ssml",          maxLength: 500,   supportsRich: false, supportsMedia: false },
        iot:             { format: "minimal_json",  maxLength: 256,   supportsRich: false, supportsMedia: false },
        ar_vr:           { format: "spatial_data",  maxLength: 5000,  supportsRich: true,  supportsMedia: true  },
        enterprise:      { format: "structured_report", maxLength: 100000, supportsRich: true, supportsMedia: true }
    };

    const adapter = adaptations[targetPlatform];
    const adapted  = typeof content === "string" ? content.slice(0, adapter.maxLength || content.length) : content;

    const result = {
        adaptationId:  uid("adapt"),
        targetPlatform,
        format:        adapter.format,
        adapted,
        metadata: {
            maxLength:     adapter.maxLength,
            supportsRich:  adapter.supportsRich,
            supportsMedia: adapter.supportsMedia,
            locale:        context.locale || "en-US",
            timezone:      context.timezone || "UTC"
        },
        adaptedAt: NOW()
    };

    ultimateLog(AGENT, "content_adapted", { targetPlatform, format: adapter.format }, "INFO");
    return ok(AGENT, result);
}

// ── Build unified context from multi-platform signals ────────────
function buildContext({ signals = [], userId }) {
    if (!userId) return fail(AGENT, "userId is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const context = {
        contextId:     uid("ctx"),
        userId,
        platform:      signals.find(s => s.key === "platform")?.value || "unknown",
        locale:        signals.find(s => s.key === "locale")?.value || "en-US",
        timezone:      signals.find(s => s.key === "timezone")?.value || "UTC",
        deviceType:    signals.find(s => s.key === "deviceType")?.value || "unknown",
        capabilityLevel: Math.round(1 + Math.random() * 5),
        sessionStart:  NOW(),
        signals:       signals.slice(0, 20)
    };

    const sessions = load(`sessions_${userId}`, []);
    sessions.push({ contextId: context.contextId, platform: context.platform, sessionStart: context.sessionStart });
    flush(`sessions_${userId}`, sessions.slice(-100));

    ultimateLog(AGENT, "context_built", { userId, platform: context.platform }, "INFO");
    return ok(AGENT, context);
}

// ── Route intelligence across platforms ──────────────────────────
function routeIntelligence({ input, sourcePlatform, targetPlatforms = PLATFORMS }) {
    if (!input) return fail(AGENT, "input is required");
    if (!PLATFORMS.includes(sourcePlatform)) return fail(AGENT, `sourcePlatform must be: ${PLATFORMS.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const routes = targetPlatforms.filter(p => p !== sourcePlatform).map(platform => ({
        platform,
        deliverable: `Adapted output of '${String(input).slice(0,50)}' for ${platform}`,
        priority:    Math.random() > 0.7 ? "high" : "normal",
        status:      "queued"
    }));

    ultimateLog(AGENT, "intelligence_routed", { sourcePlatform, targetCount: routes.length }, "INFO");
    return ok(AGENT, { routingId: uid("rte"), input: String(input).slice(0,200), sourcePlatform, routes, routedAt: NOW() });
}

module.exports = { adaptForPlatform, buildContext, routeIntelligence, PLATFORMS };
