/**
 * Brand Voice Manager — maintains consistent tone, language, and messaging
 * across all social content. Store brand profile, audit content alignment.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a brand strategist. Analyse content for brand voice consistency and suggest improvements.
Respond ONLY with valid JSON.`;

const STORE = "brand-voice";

const VOICE_PRESETS = {
    professional: { tones: ["confident", "clear", "authoritative"], avoid: ["slang", "excessive emoji", "ambiguity"], cta: "direct" },
    friendly:     { tones: ["warm", "conversational", "encouraging"], avoid: ["jargon", "corporate speak"], cta: "inviting" },
    bold:         { tones: ["assertive", "provocative", "direct"], avoid: ["hedging", "passive voice", "filler words"], cta: "urgent" },
    educational:  { tones: ["informative", "patient", "structured"], avoid: ["overwhelm", "jargon without definition"], cta: "guiding" },
    playful:      { tones: ["humorous", "light", "relatable"], avoid: ["serious jargon", "overly formal language"], cta: "fun" }
};

function saveBrandProfile({ name, voice = "professional", tagline = "", keywords = [], banned = [], emoji = true, hashtags = [] }) {
    const profile = {
        id:         uid("brand"),
        name:       name || "My Brand",
        voice,
        voiceConfig: VOICE_PRESETS[voice] || VOICE_PRESETS.professional,
        tagline,
        keywords,
        bannedWords:  banned,
        useEmoji:     emoji,
        brandHashtags: hashtags,
        savedAt:      NOW()
    };
    flush(STORE, profile);
    return profile;
}

function getProfile() { return load(STORE, null); }

function _checkContent(content, profile) {
    if (!profile) return { score: 50, note: "No brand profile saved — run save_brand_profile first" };
    const lower   = content.toLowerCase();
    const issues  = [];
    const passes  = [];

    // Check banned words
    for (const word of profile.bannedWords || []) {
        if (lower.includes(word.toLowerCase())) issues.push(`Contains banned word: "${word}"`);
    }

    // Check brand keywords
    const keywordHits = (profile.keywords || []).filter(k => lower.includes(k.toLowerCase()));
    if (keywordHits.length) passes.push(`Uses brand keywords: ${keywordHits.join(", ")}`);
    else issues.push("Missing brand keywords");

    // Emoji check
    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(content);
    if (profile.useEmoji && !hasEmoji) issues.push("Brand uses emoji — consider adding 1-2");
    if (!profile.useEmoji && hasEmoji) issues.push("Brand avoids emoji — remove them");

    // Voice alignment (basic)
    const voiceConfig = VOICE_PRESETS[profile.voice] || VOICE_PRESETS.professional;
    for (const avoidWord of voiceConfig.avoid) {
        if (lower.includes(avoidWord)) issues.push(`Voice mismatch: avoid "${avoidWord}" for ${profile.voice} tone`);
    }

    const score = Math.max(0, Math.min(100, 70 + passes.length * 10 - issues.length * 15));
    return { score, issues, passes, verdict: score >= 80 ? "✅ On-brand" : score >= 60 ? "⚠️ Minor adjustments" : "❌ Needs rework" };
}

async function auditContent({ content, rewrite = false }) {
    const profile = getProfile();
    const audit   = _checkContent(content, profile);

    if (rewrite && audit.score < 80) {
        try {
            const voiceDesc = profile ? `${profile.voice} tone. Brand: ${profile.name}. Keywords: ${(profile.keywords || []).join(", ")}` : "professional tone";
            const prompt    = `Rewrite this social media post to match ${voiceDesc}: "${content.slice(0, 300)}".
JSON: { "rewritten": "...", "changes": ["..."], "voiceScore": N }`;
            const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
            const ai     = groq.parseJson(raw);
            audit.rewritten = ai?.rewritten;
            audit.changes   = ai?.changes || [];
        } catch { /* no rewrite */ }
    }

    return { content: content.slice(0, 100), audit, brandProfile: profile?.name || "none" };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "save_brand_profile": data = saveBrandProfile(p); break;
            case "get_brand_profile":  data = getProfile() || { message: "No profile saved" }; break;
            case "audit_brand_voice":  data = await auditContent({ content: p.content || p.text || "", rewrite: p.rewrite || false }); break;
            default:                   data = await auditContent({ content: p.content || p.text || "", rewrite: p.rewrite || false });
        }
        return { success: true, type: "social", agent: "brandVoiceManager", data };
    } catch (err) {
        return { success: false, type: "social", agent: "brandVoiceManager", data: { error: err.message } };
    }
}

module.exports = { saveBrandProfile, getProfile, auditContent, VOICE_PRESETS, run };
