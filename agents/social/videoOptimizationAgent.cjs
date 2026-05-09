/**
 * Video Optimization Agent — analyzes and suggests improvements for video content.
 * Works with videoGeneratorAgent output or manual video metadata.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a video content optimization expert. Analyse videos and give specific improvement recommendations.
Respond ONLY with valid JSON.`;

const PLATFORM_SPECS = {
    instagram_reel: { maxDuration: 90,  idealDuration: [15, 30], aspectRatio: "9:16", captionsRequired: true },
    tiktok:         { maxDuration: 180, idealDuration: [15, 60], aspectRatio: "9:16", captionsRequired: true },
    youtube_short:  { maxDuration: 60,  idealDuration: [30, 60], aspectRatio: "9:16", captionsRequired: false },
    youtube:        { maxDuration: null, idealDuration: [480, 900], aspectRatio: "16:9", captionsRequired: false },
    linkedin:       { maxDuration: 600, idealDuration: [60, 120], aspectRatio: "1:1",  captionsRequired: true },
    facebook:       { maxDuration: 240, idealDuration: [60, 180], aspectRatio: "16:9", captionsRequired: true }
};

const HOOK_SCORE_FACTORS = {
    hasQuestion:      15,
    hasNumber:        12,
    hasControversy:   14,
    hasPersonalStory: 10,
    hasPromise:       12,
    hasCuriosity:     13
};

function _scoreHook(hook = "") {
    const h = hook.toLowerCase();
    let score = 30;
    const triggers = [];
    if (/\?/.test(h))                                   { score += HOOK_SCORE_FACTORS.hasQuestion; triggers.push("question"); }
    if (/\d+/.test(h))                                   { score += HOOK_SCORE_FACTORS.hasNumber; triggers.push("number"); }
    if (/wrong|myth|truth|secret|nobody|stop/.test(h))  { score += HOOK_SCORE_FACTORS.hasControversy; triggers.push("controversy"); }
    if (/i |my |me /.test(h))                            { score += HOOK_SCORE_FACTORS.hasPersonalStory; triggers.push("personal"); }
    if (/will |how to|get |learn/.test(h))               { score += HOOK_SCORE_FACTORS.hasPromise; triggers.push("promise"); }
    if (/this|that|secret|hidden/.test(h))               { score += HOOK_SCORE_FACTORS.hasCuriosity; triggers.push("curiosity"); }
    return { score: Math.min(100, score), triggers };
}

function analyse({ platform = "instagram_reel", duration = 0, hook = "", hasSubtitles = false, hasCTA = false, pacing = "medium", thumbnailScore = 5 }) {
    const spec        = PLATFORM_SPECS[platform] || PLATFORM_SPECS.instagram_reel;
    const [minIdeal, maxIdeal] = spec.idealDuration;
    const durationOk  = duration >= minIdeal && duration <= maxIdeal;
    const hookAnalysis = _scoreHook(hook);
    const issues      = [];
    const fixes       = [];

    if (!durationOk) {
        issues.push(`Duration ${duration}s is outside ideal range ${minIdeal}-${maxIdeal}s`);
        fixes.push(duration > maxIdeal ? `Trim to under ${maxIdeal}s — retention drops 40% past this point` : `Extend to at least ${minIdeal}s for better algorithm distribution`);
    }
    if (spec.captionsRequired && !hasSubtitles) {
        issues.push("No subtitles/captions");
        fixes.push("Add captions — 85% of social video is watched without sound");
    }
    if (!hasCTA) {
        issues.push("No call-to-action");
        fixes.push("Add CTA in last 5 seconds: 'Follow for more', 'Comment your thoughts', or 'Save this'");
    }
    if (hookAnalysis.score < 60) {
        issues.push(`Weak hook (score: ${hookAnalysis.score}/100)`);
        fixes.push("Rewrite opening 3 seconds: use a question, bold claim, or surprising statement");
    }
    if (thumbnailScore < 7) {
        issues.push("Thumbnail score below 7/10");
        fixes.push("Improve thumbnail: add text overlay, use bold colours, show a face if possible");
    }

    const overallScore = Math.round((hookAnalysis.score * 0.3) + (durationOk ? 30 : 10) + (hasSubtitles ? 20 : 0) + (hasCTA ? 15 : 0) + (thumbnailScore * 0.5));

    return {
        id:           uid("vo"),
        platform,
        duration,
        durationOk,
        hookScore:    hookAnalysis,
        hasSubtitles,
        hasCTA,
        overallScore: Math.min(100, overallScore),
        issues,
        fixes,
        spec,
        verdict:      overallScore >= 80 ? "✅ Ready to publish" : overallScore >= 60 ? "📈 Needs minor improvements" : "⚠️ Significant work needed",
        analysedAt:   NOW()
    };
}

async function analyseWithAI(params) {
    const base = analyse(params);
    try {
        const prompt = `Video analysis for ${params.platform}: hook="${params.hook || "N/A"}", duration=${params.duration}s.
Current score: ${base.overallScore}. Issues: ${base.issues.join("; ") || "none"}.
JSON: { "rewrittenHook": "...", "retentionTip": "...", "editingAdvice": "...", "distributionTip": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        base.aiAdvice = groq.parseJson(raw);
    } catch { /* template only */ }
    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await analyseWithAI({ platform: p.platform || "instagram_reel", duration: p.duration || 0, hook: p.hook || "", hasSubtitles: p.hasSubtitles || false, hasCTA: p.hasCTA || false, pacing: p.pacing || "medium", thumbnailScore: p.thumbnailScore || 5 });
        return { success: true, type: "social", agent: "videoOptimizationAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "videoOptimizationAgent", data: { error: err.message } };
    }
}

module.exports = { analyse, analyseWithAI, PLATFORM_SPECS, run };
