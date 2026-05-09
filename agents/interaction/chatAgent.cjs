/**
 * Chat Agent — formats AI response for display in UI/chat.
 * Adds emotion-aware opener, cleans up raw text, ensures proper structure.
 */

const EMOTION_OPENERS = {
    confused: "Let me explain that clearly 👍\n\n",
    angry:    "I hear you, and I want to help 🤝\n\n",
    urgent:   "On it right away ⚡\n\n",
    excited:  "",   // no prefix — keep the energy going
    neutral:  ""
};

function format(text, meta = {}) {
    if (!text) return { text: "", formatted: "" };

    let out = text.trim();

    // Strip internal context tags (added by personalization)
    out = out.replace(/^\[(?:EXISTING_CUSTOMER|RETURNING_HOT_LEAD|RETURNING_USER):[^\]]+\]\s*/i, "");

    // Add emotion-aware opener
    const opener = EMOTION_OPENERS[meta.emotion] ?? "";
    if (opener && !out.startsWith(opener.trim())) {
        out = opener + out;
    }

    // Ensure message ends with a newline
    out = out.trimEnd();

    return { text: out, formatted: out };
}

module.exports = { format };
