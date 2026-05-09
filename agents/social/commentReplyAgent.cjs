/**
 * Comment Reply Agent — auto-reply to comments using intent-aware templates.
 * Max 20 replies/hour with 15-45s human-like delays.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, randomDelay, CAPS, canComment, recordComment } = require("./_socialStore.cjs");

const SYSTEM = `You are a friendly social media manager. Reply to comments naturally and engagingly.
Keep replies under 20 words. No hashtags. Respond ONLY with valid JSON: { "reply": "..." }`;

const LOG_STORE = "comment-replies";

const REPLY_TEMPLATES = {
    love:       ["Thank you so much! 🙏 Means the world!", "So glad you loved it! ❤️", "This made my day! Thanks! 😊"],
    question:   ["Great question! Check my bio link for the full answer!", "DM me — I'll send you the details!", "I'm actually covering this in my next post! Stay tuned 👀"],
    negative:   ["Thanks for the honest feedback! I hear you 🙌", "Really appreciate you sharing that — noted for improvement!", "DM me and let's sort this out properly 💬"],
    spam:       null, // do not reply
    generic:    ["Thanks for watching! 🙌", "Appreciate you! ❤️", "Glad you're here! 🔥"],
    collab:     ["Love this! DM me 👇", "Amazing! Let's connect in DMs 🤝"],
    purchase:   ["Link in bio! 🛒 Check it out", "DM me for a special offer! 💰"]
};

function _detectIntent(comment) {
    const c = comment.toLowerCase();
    if (/\?/.test(c) || /how|what|where|when|why|which/.test(c)) return "question";
    if (/love|great|amazing|awesome|fire|🔥|❤️|💯/.test(c)) return "love";
    if (/bad|terrible|worst|hate|scam|fake/.test(c)) return "negative";
    if (/buy|price|cost|how much|order|shop/.test(c)) return "purchase";
    if (/collab|partner|feature|shoutout/.test(c)) return "collab";
    if (/follow|check|link|click|visit/.test(c)) return "spam";
    return "generic";
}

function _pickTemplate(intent) {
    const options = REPLY_TEMPLATES[intent];
    if (!options) return null;
    return options[Math.floor(Math.random() * options.length)];
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function replyToComment({ commentId, commentText, platform = "instagram", postContext = "", useAI = false }) {
    if (!commentText) throw new Error("commentText required");
    if (!canComment()) return { skipped: true, reason: `Reply cap reached (max ${CAPS.maxCommentsPerHour}/hour)` };

    const intent  = _detectIntent(commentText);
    if (intent === "spam") return { skipped: true, reason: "Spam comment — not replying" };

    let reply;
    if (useAI) {
        try {
            const prompt = `Comment on a ${platform} post about "${postContext}": "${commentText}". Reply naturally in under 20 words.`;
            const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 60 });
            reply        = groq.parseJson(raw)?.reply || _pickTemplate(intent);
        } catch { reply = _pickTemplate(intent); }
    } else {
        reply = _pickTemplate(intent);
    }

    const delay = randomDelay(CAPS.commentDelayMin, CAPS.commentDelayMax);
    await _sleep(delay);

    recordComment();
    const entry = { id: uid("cr"), commentId: commentId || uid("cmt"), commentText: commentText.slice(0, 100), intent, reply, platform, delayMs: delay, repliedAt: NOW() };
    const log = load(LOG_STORE, []);
    log.push(entry);
    if (log.length > 300) log.splice(0, log.length - 300);
    flush(LOG_STORE, log);

    return { commentId: entry.commentId, intent, reply, platform, delayMs: delay };
}

async function batchReply(comments = [], options = {}) {
    const results = [];
    for (const c of comments) {
        const r = await replyToComment({ ...c, ...options });
        results.push(r);
        if (r.skipped && r.reason?.includes("cap")) break;
    }
    return { total: comments.length, replied: results.filter(r => r.reply).length, skipped: results.filter(r => r.skipped).length, results };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "batch_reply") {
            data = await batchReply(p.comments || [], { platform: p.platform, useAI: p.useAI });
        } else {
            data = await replyToComment({ commentId: p.commentId, commentText: p.comment || p.commentText, platform: p.platform || "instagram", postContext: p.postContext || "", useAI: p.useAI || false });
        }
        return { success: true, type: "social", agent: "commentReplyAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "commentReplyAgent", data: { error: err.message } };
    }
}

module.exports = { replyToComment, batchReply, run };
