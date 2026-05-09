"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "streamModerator";

const VIOLATION_TYPES = {
    hate_speech:    { severity:"HIGH",   action:"remove",  description:"Hateful or discriminatory language" },
    harassment:     { severity:"HIGH",   action:"remove",  description:"Personal attacks or targeted harassment" },
    nudity:         { severity:"HIGH",   action:"remove",  description:"Nudity or explicit sexual content" },
    violence:       { severity:"HIGH",   action:"remove",  description:"Graphic violence or gore" },
    spam:           { severity:"MEDIUM", action:"mute",    description:"Spam or repetitive messages" },
    self_harm:      { severity:"HIGH",   action:"remove",  description:"Self-harm or suicide content" },
    misinformation: { severity:"MEDIUM", action:"flag",    description:"Potentially false or misleading information" },
    profanity:      { severity:"LOW",    action:"filter",  description:"Profanity or offensive language" },
    off_topic:      { severity:"LOW",    action:"warn",    description:"Content off-topic for the stream" },
    doxxing:        { severity:"HIGH",   action:"remove",  description:"Sharing personal/private information of others" }
};

const TOXIC_PATTERNS = [
    /\b(kill yourself|kys)\b/i,
    /\b(n[i1!]gg[ae3]r|f[a4]gg[o0]t)\b/i,
    /\b(hate|kill|murder)\s+(all|every)\s+(jew|muslim|christian|hindu|black|white)/i,
    /\b(go die|drop dead|you should die)\b/i,
    /\b(buy followers|click here|free money|dm for promo)\b/i
];

const SPAM_WINDOW_MS = 10000;
const SPAM_THRESHOLD = 5;

function moderateMessage({ userId, streamId, message, authorId, authorName }) {
    if (!userId || !streamId || !message) return fail(AGENT, "userId, streamId, message required");
    trackEvent("stream_moderate", { userId, streamId });

    const violations = [];

    for (const pattern of TOXIC_PATTERNS) {
        if (pattern.test(message)) {
            const type = pattern.source.includes("kill yourself") || pattern.source.includes("go die")
                ? "self_harm" : pattern.source.includes("buy followers") ? "spam" : "hate_speech";
            violations.push(VIOLATION_TYPES[type]);
        }
    }

    const history = load(userId, `stream_${streamId}_messages`, []);
    const recent  = history.filter(m => m.authorId === authorId && Date.now() - new Date(m.at).getTime() < SPAM_WINDOW_MS);
    if (recent.length >= SPAM_THRESHOLD) violations.push({ ...VIOLATION_TYPES.spam, reason: "Rate limit exceeded" });

    const entry = { id: uid("sm"), streamId, message, authorId, authorName, violations: violations.map(v => v.action), at: NOW() };
    history.push(entry);
    flush(userId, `stream_${streamId}_messages`, history.slice(-2000));

    const highestSeverity = violations.find(v => v.severity === "HIGH") || violations.find(v => v.severity === "MEDIUM");
    const decision = highestSeverity ? highestSeverity.action : "allow";

    return ok(AGENT, {
        messageId: entry.id,
        decision,
        violations: violations.map(v => ({ type: v.description, severity: v.severity, action: v.action })),
        safe: violations.length === 0
    });
}

function getStreamReport({ userId, streamId }) {
    if (!userId || !streamId) return fail(AGENT, "userId and streamId required");
    const history   = load(userId, `stream_${streamId}_messages`, []);
    const removed   = history.filter(m => m.violations.includes("remove")).length;
    const muted     = history.filter(m => m.violations.includes("mute")).length;
    const flagged   = history.filter(m => m.violations.includes("flag")).length;
    const total     = history.length;
    const safeRate  = total ? Math.round((total - removed - muted) / total * 100) : 100;

    return ok(AGENT, { streamId, totalMessages: total, removed, muted, flagged, safeRate: safeRate + "%" });
}

function banUser({ userId, streamId, targetUserId, reason }) {
    if (!userId || !streamId || !targetUserId) return fail(AGENT, "userId, streamId, targetUserId required");
    const bans = load(userId, `stream_${streamId}_bans`, []);
    if (!bans.find(b => b.userId === targetUserId)) {
        bans.push({ userId: targetUserId, reason: reason || "Community guidelines violation", bannedAt: NOW(), bannedBy: userId });
        flush(userId, `stream_${streamId}_bans`, bans);
    }
    return ok(AGENT, { banned: targetUserId, streamId, reason });
}

module.exports = { moderateMessage, getStreamReport, banUser };
