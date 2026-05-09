"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "emotionSyncEngine";

// ⚠️ SIMULATION ONLY — no real biometric or physiological data is processed

const EMOTION_DIMENSIONS = {
    valence:  { range:[-1,1],   description:"Negative to positive affect" },
    arousal:  { range:[0,1],    description:"Calm to excited activation level" },
    dominance:{ range:[0,1],    description:"Submissive to dominant control feeling" }
};

const PRIMARY_EMOTIONS = {
    joy:       { valence:0.9,  arousal:0.7, dominance:0.7, color:"#FFD700" },
    sadness:   { valence:-0.7, arousal:0.2, dominance:0.2, color:"#4682B4" },
    anger:     { valence:-0.6, arousal:0.9, dominance:0.8, color:"#FF4500" },
    fear:      { valence:-0.8, arousal:0.85,dominance:0.1, color:"#800080" },
    surprise:  { valence:0.3,  arousal:0.8, dominance:0.4, color:"#FF69B4" },
    disgust:   { valence:-0.7, arousal:0.5, dominance:0.6, color:"#808000" },
    anticipation:{ valence:0.5,arousal:0.6, dominance:0.6, color:"#FFA500" },
    trust:     { valence:0.7,  arousal:0.3, dominance:0.6, color:"#32CD32" }
};

const SYNC_TARGETS = ["interface","music","lighting","haptic","avatar"];

function detectEmotion({ userId, consent, inputText, contextTags = [] }) {
    const gate = requireConsent(consent, "emotion detection simulation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const emotionKeys = Object.keys(PRIMARY_EMOTIONS);
    const primary = emotionKeys[Math.floor(Math.random() * emotionKeys.length)];
    const secondary = emotionKeys.filter(k => k !== primary)[Math.floor(Math.random() * (emotionKeys.length - 1))];
    const base = PRIMARY_EMOTIONS[primary];
    const jitter = () => parseFloat(((Math.random() - 0.5) * 0.2).toFixed(3));

    const detection = {
        id:            uid("em"),
        primaryEmotion: primary,
        secondaryEmotion: secondary,
        dimensions: {
            valence:   parseFloat((base.valence   + jitter()).toFixed(3)),
            arousal:   parseFloat((base.arousal   + jitter()).toFixed(3)),
            dominance: parseFloat((base.dominance + jitter()).toFixed(3))
        },
        confidence:    Math.round(60 + Math.random() * 35),
        contextTags,
        inputProvided: !!inputText,
        detectedAt:    NOW(),
        ...watermark(AGENT)
    };

    const log = load(userId, "emotion_log", []);
    log.push({ id: detection.id, emotion: primary, confidence: detection.confidence, ts: detection.detectedAt });
    flush(userId, "emotion_log", log.slice(-5000));

    humanAILog(AGENT, userId, "emotion_detected", { primary, confidence: detection.confidence }, "INFO");
    return ok(AGENT, detection);
}

function syncEmotionToTarget({ userId, consent, emotionId, targets = ["interface"] }) {
    const gate = requireConsent(consent, "emotion sync");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId || !emotionId) return fail(AGENT, "userId and emotionId required");

    const invalidTargets = targets.filter(t => !SYNC_TARGETS.includes(t));
    if (invalidTargets.length) return fail(AGENT, `invalid sync targets: ${invalidTargets.join(",")}. Valid: ${SYNC_TARGETS.join(", ")}`);

    const syncResult = {
        id:         uid("sync"),
        emotionId,
        targets,
        adaptations: targets.map(t => ({
            target: t,
            applied: true,
            setting: `[SIMULATED ${t.toUpperCase()} adaptation applied]`
        })),
        syncedAt:   NOW(),
        ...watermark(AGENT)
    };

    humanAILog(AGENT, userId, "emotion_synced", { emotionId, targets }, "INFO");
    return ok(AGENT, syncResult);
}

function getEmotionHistory({ userId, consent, limit = 30 }) {
    const gate = requireConsent(consent, "emotion history access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const log = load(userId, "emotion_log", []);
    humanAILog(AGENT, userId, "emotion_history_accessed", { count: log.length }, "INFO");
    return ok(AGENT, { total: log.length, recent: log.slice(-limit).reverse(), availableEmotions: Object.keys(PRIMARY_EMOTIONS) });
}

function getSupportedEmotions() {
    return ok(AGENT, {
        emotions: Object.entries(PRIMARY_EMOTIONS).map(([k,v]) => ({ key:k,...v })),
        dimensions: EMOTION_DIMENSIONS,
        syncTargets: SYNC_TARGETS
    });
}

module.exports = { detectEmotion, syncEmotionToTarget, getEmotionHistory, getSupportedEmotions };
