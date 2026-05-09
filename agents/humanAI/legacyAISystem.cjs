"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "legacyAISystem";

// ⚠️ SIMULATION ONLY — ethical safeguards apply; no real posthumous identity is created

const LEGACY_TYPES = ["values_statement","letter_to_future","wisdom_archive","creative_works","life_lessons","wishes_and_hopes"];
const AUDIENCE_TYPES = ["family","friends","colleagues","public","descendants","unspecified"];

const ETHICAL_DISCLAIMER = "⚠️ LEGACY SIMULATION — This system archives user-authored content only. It does NOT generate autonomous AI representations of deceased persons or simulate their consciousness.";

function addLegacyEntry({ userId, consent, legacyType, audience = "family", content, title, scheduledReleaseDate }) {
    const gate = requireConsent(consent, "legacy entry creation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!LEGACY_TYPES.includes(legacyType)) return fail(AGENT, `legacyType must be: ${LEGACY_TYPES.join(", ")}`);
    if (!AUDIENCE_TYPES.includes(audience)) return fail(AGENT, `audience must be: ${AUDIENCE_TYPES.join(", ")}`);
    if (!content || !title) return fail(AGENT, "content and title required");

    const entry = {
        id:                  uid("leg"),
        legacyType,
        audience,
        title,
        content:             String(content).slice(0, 10000),
        scheduledReleaseDate: scheduledReleaseDate || null,
        status:              "stored",
        createdAt:           NOW(),
        ...watermark(AGENT)
    };

    const archive = load(userId, "legacy_archive", []);
    archive.push({ id: entry.id, legacyType, audience, title, status: entry.status, createdAt: entry.createdAt });
    flush(userId, "legacy_archive", archive.slice(-1000));

    humanAILog(AGENT, userId, "legacy_entry_added", { legacyType, audience, title }, "INFO");
    return ok(AGENT, entry, { ethicalDisclaimer: ETHICAL_DISCLAIMER });
}

function getLegacyArchive({ userId, consent, legacyType, audience }) {
    const gate = requireConsent(consent, "legacy archive access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    let archive = load(userId, "legacy_archive", []);
    if (legacyType) archive = archive.filter(e => e.legacyType === legacyType);
    if (audience)   archive = archive.filter(e => e.audience === audience);

    humanAILog(AGENT, userId, "legacy_archive_accessed", { count: archive.length }, "INFO");
    return ok(AGENT, { total: archive.length, entries: archive, ethicalDisclaimer: ETHICAL_DISCLAIMER });
}

function generateLegacySummary({ userId, consent }) {
    const gate = requireConsent(consent, "legacy summary");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const archive = load(userId, "legacy_archive", []);
    const byType = {};
    LEGACY_TYPES.forEach(t => { byType[t] = archive.filter(e => e.legacyType === t).length; });
    const byAudience = {};
    AUDIENCE_TYPES.forEach(a => { byAudience[a] = archive.filter(e => e.audience === a).length; });

    humanAILog(AGENT, userId, "legacy_summary_generated", { total: archive.length }, "INFO");
    return ok(AGENT, { totalEntries: archive.length, byType, byAudience, ethicalDisclaimer: ETHICAL_DISCLAIMER });
}

function deleteEntry({ userId, consent, entryId, confirm }) {
    const gate = requireConsent(consent, "legacy entry deletion");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !entryId) return fail(AGENT, "userId and entryId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete a legacy entry");

    let archive = load(userId, "legacy_archive", []);
    const before = archive.length;
    archive = archive.filter(e => e.id !== entryId);
    if (archive.length === before) return fail(AGENT, `entryId ${entryId} not found`);
    flush(userId, "legacy_archive", archive);

    humanAILog(AGENT, userId, "legacy_entry_deleted", { entryId }, "WARN");
    return ok(AGENT, { deleted: entryId });
}

module.exports = { addLegacyEntry, getLegacyArchive, generateLegacySummary, deleteEntry };
