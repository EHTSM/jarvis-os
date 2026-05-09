"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "lifeLoggerAgent";

const LOG_CATEGORIES = ["activity","health","social","work","learning","travel","milestone","reflection"];
const PRIVACY_LEVELS = { public:0, friends:1, private:2, encrypted:3 };

function logEvent({ userId, consent, category, title, description, tags = [], privacyLevel = "private", metadata = {} }) {
    const gate = requireConsent(consent, "life event logging");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!LOG_CATEGORIES.includes(category)) return fail(AGENT, `category must be: ${LOG_CATEGORIES.join(", ")}`);
    if (PRIVACY_LEVELS[privacyLevel] === undefined) return fail(AGENT, `privacyLevel must be: ${Object.keys(PRIVACY_LEVELS).join(", ")}`);
    if (!title) return fail(AGENT, "title required");

    const entry = {
        id:           uid("ll"),
        category,
        title,
        description:  description ? String(description).slice(0,1000) : null,
        tags,
        privacyLevel,
        privacyCode:  PRIVACY_LEVELS[privacyLevel],
        metadata,
        loggedAt:     NOW(),
        ...watermark(AGENT)
    };

    const log = load(userId, "life_log", []);
    log.push({ id: entry.id, category, title, privacyLevel, tags, loggedAt: entry.loggedAt });
    flush(userId, "life_log", log.slice(-50000));

    humanAILog(AGENT, userId, "life_event_logged", { category, title, privacyLevel }, "INFO");
    return ok(AGENT, entry);
}

function queryLog({ userId, consent, category, tags = [], startDate, endDate, limit = 50 }) {
    const gate = requireConsent(consent, "life log query");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    let log = load(userId, "life_log", []);
    if (category) log = log.filter(e => e.category === category);
    if (tags.length) log = log.filter(e => tags.some(t => e.tags.includes(t)));
    if (startDate) log = log.filter(e => e.loggedAt >= startDate);
    if (endDate)   log = log.filter(e => e.loggedAt <= endDate);

    humanAILog(AGENT, userId, "life_log_queried", { category, tagCount: tags.length, found: log.length }, "INFO");
    return ok(AGENT, { total: log.length, entries: log.slice(-limit).reverse() });
}

function getLifeSummary({ userId, consent }) {
    const gate = requireConsent(consent, "life summary");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const log = load(userId, "life_log", []);
    const byCategory = {};
    LOG_CATEGORIES.forEach(c => { byCategory[c] = log.filter(e => e.category === c).length; });
    const byPrivacy = {};
    Object.keys(PRIVACY_LEVELS).forEach(p => { byPrivacy[p] = log.filter(e => e.privacyLevel === p).length; });

    humanAILog(AGENT, userId, "life_summary_accessed", { total: log.length }, "INFO");
    return ok(AGENT, { totalEvents: log.length, byCategory, byPrivacy, earliest: log[0]?.loggedAt || null, latest: log[log.length-1]?.loggedAt || null });
}

function deleteEvent({ userId, consent, eventId, confirm }) {
    const gate = requireConsent(consent, "life event deletion");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !eventId) return fail(AGENT, "userId and eventId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete a life log entry");

    let log = load(userId, "life_log", []);
    const before = log.length;
    log = log.filter(e => e.id !== eventId);
    if (log.length === before) return fail(AGENT, `eventId ${eventId} not found`);
    flush(userId, "life_log", log);

    humanAILog(AGENT, userId, "life_event_deleted", { eventId }, "WARN");
    return ok(AGENT, { deleted: eventId });
}

module.exports = { logEvent, queryLog, getLifeSummary, deleteEvent };
