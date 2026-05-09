/**
 * Mood Analyzer Agent — detect mood from text and track emotional patterns.
 * NOT therapy. General emotional wellness only.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const STORE = "mood-log";

const MOOD_KEYWORDS = {
    happy:     ["happy", "joy", "excited", "great", "amazing", "wonderful", "love", "fantastic", "thrilled", "elated"],
    calm:      ["calm", "peaceful", "relaxed", "content", "serene", "fine", "okay", "balanced", "centered"],
    anxious:   ["anxious", "worried", "nervous", "stressed", "overwhelmed", "tense", "panic", "uneasy", "scared"],
    sad:       ["sad", "depressed", "unhappy", "miserable", "down", "heartbroken", "grief", "lonely", "hopeless"],
    angry:     ["angry", "furious", "frustrated", "annoyed", "irritated", "rage", "mad", "upset", "resentful"],
    tired:     ["tired", "exhausted", "drained", "fatigue", "sleepy", "burnout", "worn out", "depleted"],
    motivated: ["motivated", "inspired", "driven", "focused", "productive", "energized", "determined", "goal"],
    confused:  ["confused", "lost", "unsure", "uncertain", "unclear", "overwhelmed", "stuck", "blank"]
};

const MOOD_RESPONSES = {
    happy:     { message: "You're in a great headspace! Great time to tackle your hardest task.", color: "green",  suggestions: ["Channel this energy into a creative project", "Connect with someone and spread the positivity"] },
    calm:      { message: "A calm mind is a powerful mind. Perfect for deep work.", color: "blue",   suggestions: ["Good time for planning or strategic thinking", "Practice gratitude journaling"] },
    anxious:   { message: "Anxiety is your body's alert system — acknowledge it gently.", color: "orange", suggestions: ["Try box breathing: 4s in, 4s hold, 4s out", "Write down your worries — externalizing reduces their power", "Limit caffeine and social media"] },
    sad:       { message: "It's okay to not be okay. Be gentle with yourself.", color: "gray",   suggestions: ["Talk to someone you trust", "Go for a 20-min walk — even small movement helps", "If persistent, consider speaking to a counselor"] },
    angry:     { message: "Your feelings are valid. Channel this energy constructively.", color: "red",    suggestions: ["Take 10 deep breaths before responding", "Physical exercise releases anger hormones", "Journal what triggered this"] },
    tired:     { message: "Your body is asking for rest. Listen to it.", color: "purple", suggestions: ["Take a 20-min nap if possible", "Avoid caffeine after 2pm", "Tonight: no screens 1hr before bed"] },
    motivated: { message: "You're in the zone! Make the most of this momentum.", color: "yellow", suggestions: ["Work on your highest-priority task now", "Set a timer for 90-min deep work"] },
    confused:  { message: "Clarity comes from action, not more thinking.", color: "teal",   suggestions: ["Write down the options and pick any one", "Talk it through with a trusted person", "Give yourself a 24hr deadline to decide"] }
};

function _detect(text = "") {
    const lower  = text.toLowerCase();
    const scores = {};
    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
        scores[mood] = keywords.filter(kw => lower.includes(kw)).length;
    }
    const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return top[1] > 0 ? top[0] : "calm";
}

function logMood({ userId = "default", text = "", mood = null, rating = null, notes = "" }) {
    const detectedMood = mood || _detect(text);
    const response     = MOOD_RESPONSES[detectedMood] || MOOD_RESPONSES.calm;

    const entry = {
        id:           uid("mood"),
        userId,
        text:         text.slice(0, 500),
        mood:         detectedMood,
        rating:       rating || null,
        notes,
        response:     response.message,
        suggestions:  response.suggestions,
        color:        response.color,
        loggedAt:     NOW()
    };

    const all = load(STORE, {});
    if (!all[userId]) all[userId] = [];
    all[userId].push(entry);
    flush(STORE, all);
    logToMemory("moodAnalyzerAgent", `${userId}:${detectedMood}`, { mood: detectedMood, rating });
    return entry;
}

function getMoodReport(userId = "default", days = 14) {
    const since   = Date.now() - days * 86_400_000;
    const all     = load(STORE, {});
    const entries = (all[userId] || []).filter(e => new Date(e.loggedAt).getTime() >= since);

    if (!entries.length) return { userId, message: "No mood data. Start logging how you feel.", empty: true };

    const moodCounts = {};
    for (const e of entries) moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;

    const dominant  = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0][0];
    const positive  = ["happy", "calm", "motivated"].reduce((s, m) => s + (moodCounts[m] || 0), 0);
    const negative  = ["anxious", "sad", "angry", "tired"].reduce((s, m) => s + (moodCounts[m] || 0), 0);
    const wellbeing = Math.round((positive / entries.length) * 100);

    return {
        userId,
        period:     `${days} days`,
        entries:    entries.length,
        dominant,
        moodCounts,
        wellbeing:  wellbeing + "%",
        trend:      wellbeing >= 60 ? "Positive" : wellbeing >= 40 ? "Mixed" : "Needs attention",
        suggestions: [
            wellbeing < 40 ? "Consider speaking to a mental health professional." : null,
            negative > positive ? "Stress is high — prioritize sleep, exercise, and social connection." : "Your emotional balance looks good.",
            "Track mood daily for 30 days to spot patterns."
        ].filter(Boolean),
        disclaimer: HEALTH_DISCLAIMER
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "mood_report") {
            data = getMoodReport(p.userId || "default", p.days || 14);
        } else {
            data = logMood({ userId: p.userId || "default", text: p.text || p.message || "", mood: p.mood, rating: p.rating, notes: p.notes || "" });
        }
        return ok("moodAnalyzerAgent", data, ["Name it to tame it — labeling emotions reduces their intensity", "Track mood for 30 days to spot patterns"]);
    } catch (err) { return fail("moodAnalyzerAgent", err.message); }
}

module.exports = { logMood, getMoodReport, _detect, run };
