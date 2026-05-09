/**
 * Response Pipeline — processes raw gateway output for delivery.
 * chatAgent formatting → multilingual translateBack (if non-English input)
 */
const chatAgent    = require("./interaction/chatAgent.cjs");
const multilingual = require("./interaction/multilingual.cjs");

async function processResponse(rawReply, meta = {}) {
    if (!rawReply) return { text: "", formatted: "" };

    const text = typeof rawReply === "object" ? (rawReply.reply || rawReply.text || JSON.stringify(rawReply)) : rawReply;

    // Format with emotion-aware opener and strip context tags
    const { formatted } = chatAgent.format(text, { emotion: meta.emotion });

    // Translate back to user's language if input was not English
    let final = formatted;
    if (meta.lang && meta.lang !== "en") {
        try {
            final = await multilingual.translateBack(formatted, meta.lang);
        } catch {
            final = formatted; // fall back to English on translation error
        }
    }

    return { text: final, formatted: final };
}

module.exports = { processResponse };
