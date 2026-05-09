/**
 * Emotion Detection — detects user tone from text.
 * Pure keyword-based; fast and offline.
 */

const EMOTION_KEYWORDS = {
    excited: [
        "amazing", "great", "awesome", "love it", "perfect", "yes", "yes!",
        "excited", "fantastic", "excellent", "brilliant", "🔥", "🚀", "💯",
        "let's go", "ready", "absolutely", "definitely", "sure"
    ],
    confused: [
        "confused", "not sure", "don't understand", "what do you mean",
        "huh", "unclear", "lost", "idk", "i don't know", "explain",
        "what exactly", "how does", "don't get it", "?"
    ],
    angry: [
        "angry", "frustrated", "terrible", "worst", "bad", "hate",
        "useless", "waste", "scam", "fraud", "cheated", "lied",
        "disappointed", "unacceptable", "ridiculous", "horrible"
    ],
    urgent: [
        "urgent", "asap", "immediately", "right now", "hurry", "fast",
        "quickly", "emergency", "critical", "today", "deadline"
    ]
};

function detect(text) {
    const lower = text.toLowerCase();
    const scores = {};

    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        scores[emotion] = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [top, topScore] = sorted[0];

    return {
        emotion: topScore > 0 ? top : "neutral",
        scores
    };
}

module.exports = { detect };
