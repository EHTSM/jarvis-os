"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "personalHistoryAI";

const ERA_TAGS = ["childhood","education","career","relationships","travel","health","achievements","losses","turning_points"];

function addChapter({ userId, consent, eraTag, title, narrative, year, emotionalWeight = 5, tags = [] }) {
    const gate = requireConsent(consent, "personal history recording");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!ERA_TAGS.includes(eraTag)) return fail(AGENT, `eraTag must be: ${ERA_TAGS.join(", ")}`);
    if (!title || !narrative) return fail(AGENT, "title and narrative required");
    if (typeof emotionalWeight !== "number" || emotionalWeight < 1 || emotionalWeight > 10) return fail(AGENT, "emotionalWeight must be 1-10");

    const chapter = {
        id:             uid("ph"),
        eraTag,
        title,
        narrative:      String(narrative).slice(0, 5000),
        year:           year || null,
        emotionalWeight,
        tags,
        recordedAt:     NOW(),
        ...watermark(AGENT)
    };

    const history = load(userId, "personal_history", []);
    history.push({ id: chapter.id, eraTag, title, year, emotionalWeight, recordedAt: chapter.recordedAt });
    flush(userId, "personal_history", history.slice(-10000));

    humanAILog(AGENT, userId, "history_chapter_added", { eraTag, title, year }, "INFO");
    return ok(AGENT, chapter);
}

function getTimeline({ userId, consent, eraTag, startYear, endYear }) {
    const gate = requireConsent(consent, "personal timeline access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    let history = load(userId, "personal_history", []);
    if (eraTag) history = history.filter(c => c.eraTag === eraTag);
    if (startYear) history = history.filter(c => c.year && c.year >= startYear);
    if (endYear)   history = history.filter(c => c.year && c.year <= endYear);
    history.sort((a, b) => (a.year || 9999) - (b.year || 9999));

    humanAILog(AGENT, userId, "timeline_accessed", { chapters: history.length }, "INFO");
    return ok(AGENT, { total: history.length, timeline: history });
}

function generateBiography({ userId, consent }) {
    const gate = requireConsent(consent, "biography generation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const history = load(userId, "personal_history", []);
    if (!history.length) return fail(AGENT, "No history chapters found — add chapters first");

    const sorted = [...history].sort((a,b) => (a.year||9999)-(b.year||9999));
    const highImpact = history.filter(c => c.emotionalWeight >= 8);
    const eras = [...new Set(history.map(c => c.eraTag))];

    const bio = {
        id:          uid("bio"),
        totalChapters: history.length,
        eras,
        highImpactMoments: highImpact.length,
        chronologicalSummary: sorted.map(c => `${c.year||"?"}: [${c.eraTag}] ${c.title}`).join(" → "),
        generatedAt: NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "biography_generated", { chapters: history.length }, "INFO");
    return ok(AGENT, bio);
}

function deleteChapter({ userId, consent, chapterId, confirm }) {
    const gate = requireConsent(consent, "history chapter deletion");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !chapterId) return fail(AGENT, "userId and chapterId required");
    if (!confirm) return fail(AGENT, "confirm:true required to delete history");

    let history = load(userId, "personal_history", []);
    const before = history.length;
    history = history.filter(c => c.id !== chapterId);
    if (history.length === before) return fail(AGENT, `chapterId ${chapterId} not found`);
    flush(userId, "personal_history", history);

    humanAILog(AGENT, userId, "history_chapter_deleted", { chapterId }, "WARN");
    return ok(AGENT, { deleted: chapterId });
}

module.exports = { addChapter, getTimeline, generateBiography, deleteChapter };
