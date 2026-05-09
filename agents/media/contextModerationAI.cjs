"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "contextModerationAI";

// SAFETY AGENT: Must run BEFORE publish for all media content.
// Returns { approved, flags, score } — only approved:true content may be published.

const CONTENT_CATEGORIES = {
    hate_speech:    { threshold: 0.3, action:"block",   severity:"HIGH" },
    harassment:     { threshold: 0.3, action:"block",   severity:"HIGH" },
    self_harm:      { threshold: 0.2, action:"block",   severity:"HIGH" },
    sexual_explicit:{ threshold: 0.4, action:"block",   severity:"HIGH" },
    violence_graphic:{ threshold:0.4, action:"block",   severity:"HIGH" },
    misinformation: { threshold: 0.6, action:"flag",    severity:"MEDIUM" },
    spam:           { threshold: 0.7, action:"flag",    severity:"MEDIUM" },
    copyright:      { threshold: 0.5, action:"flag",    severity:"MEDIUM" },
    profanity:      { threshold: 0.8, action:"warn",    severity:"LOW" },
    sensitive:      { threshold: 0.6, action:"warn",    severity:"LOW" }
};

const HIGH_RISK_PATTERNS = [
    { pattern:/\b(kill|murder|bomb|terrorist|genocide)\b/i,      category:"violence_graphic" },
    { pattern:/\b(kys|kill yourself|end your life)\b/i,          category:"self_harm" },
    { pattern:/\b(n[i1]gg|f[a4]gg[o0]t)\b/i,                    category:"hate_speech" },
    { pattern:/\b(free (?:robux|iphone|money)|click here now)\b/i,category:"spam" },
    { pattern:/\b(deepfake|fake (?:news|video) of [A-Z][a-z]+)\b/i, category:"misinformation" }
];

function moderate({ userId, contentId, contentType, title, description, tags = [], transcript }) {
    if (!userId || !contentId) return fail(AGENT, "userId and contentId required");
    trackEvent("content_moderate", { userId, contentType, contentId });

    const textToAnalyse = [title, description, tags.join(" "), transcript].filter(Boolean).join(" ");
    const flags         = [];
    let   overallScore  = 0;

    for (const { pattern, category } of HIGH_RISK_PATTERNS) {
        if (pattern.test(textToAnalyse)) {
            const cat = CONTENT_CATEGORIES[category];
            flags.push({ category, severity: cat.severity, action: cat.action, matched: true });
            overallScore = Math.max(overallScore, cat.severity === "HIGH" ? 0.9 : 0.6);
        }
    }

    const blockingFlags = flags.filter(f => f.action === "block");
    const approved      = blockingFlags.length === 0;

    const result = {
        id:           uid("mod"),
        userId,
        contentId,
        contentType,
        approved,
        score:        parseFloat(overallScore.toFixed(2)),
        flags,
        blockingFlags:blockingFlags.length,
        action:       approved ? "allow" : "block",
        reviewNote:   approved ? "Content passed automated moderation." : `Content BLOCKED — ${blockingFlags.map(f => f.category).join(", ")} detected.`,
        moderatedAt:  NOW()
    };

    const log = load(userId, "moderation_log", []);
    log.push(result);
    flush(userId, "moderation_log", log.slice(-2000));

    if (!approved) return blocked(AGENT, result.reviewNote);
    return ok(AGENT, result);
}

function getModerationLog({ userId, approved, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    let log = load(userId, "moderation_log", []);
    if (approved !== undefined) log = log.filter(r => r.approved === approved);
    return ok(AGENT, log.slice(-limit).reverse());
}

function appeal({ userId, moderationId, reason }) {
    if (!userId || !moderationId) return fail(AGENT, "userId and moderationId required");
    const log    = load(userId, "moderation_log", []);
    const record = log.find(r => r.id === moderationId);
    if (!record) return fail(AGENT, "Moderation record not found");

    record.appealed   = true;
    record.appealReason = reason;
    record.appealAt   = NOW();
    record.appealStatus = "under_review";
    flush(userId, "moderation_log", log);

    return ok(AGENT, { appeal: { moderationId, status: "under_review", notice: "Appeals are reviewed by human moderators within 48 hours." } });
}

module.exports = { moderate, getModerationLog, appeal };
