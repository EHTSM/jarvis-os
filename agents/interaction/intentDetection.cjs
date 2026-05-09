/**
 * Intent Detection — classifies user input into one of 4 intents.
 * Uses keyword scoring for speed; no external API needed.
 */

const INTENT_KEYWORDS = {
    sales: [
        "price", "cost", "how much", "buy", "purchase", "payment",
        "interested", "start", "join", "plan", "offer", "deal",
        "subscribe", "enroll", "sign up", "invest"
    ],
    automation: [
        "automate", "schedule", "loop", "run", "execute", "trigger",
        "workflow", "cron", "repeat", "every day", "every hour",
        "set up", "configure", "bot", "auto"
    ],
    task: [
        "create", "make", "build", "open", "set", "remind",
        "book", "send", "post", "write", "generate", "do",
        "search", "find", "get me", "show me"
    ],
    question: [
        "what", "how", "why", "when", "where", "who",
        "explain", "tell me", "can you", "is it", "does it",
        "help", "difference", "example", "meaning"
    ]
};

function detect(text) {
    const lower = text.toLowerCase();
    const scores = {};

    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
        scores[intent] = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topIntent, topScore] = sorted[0];
    const total = Object.values(scores).reduce((a, b) => a + b, 0);

    return {
        intent: topScore > 0 ? topIntent : "question",
        confidence: total > 0 ? parseFloat((topScore / total).toFixed(2)) : 0.5,
        scores
    };
}

module.exports = { detect };
