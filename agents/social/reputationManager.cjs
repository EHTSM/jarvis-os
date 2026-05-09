/**
 * Reputation Manager — monitors for negative sentiment, crisis signals,
 * and auto-generates measured responses.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a brand reputation manager. Draft calm, professional, empathetic responses to negative feedback.
Respond ONLY with valid JSON.`;

const STORE = "reputation-log";

const SEVERITY = {
    critical: { score: 4, patterns: [/scam|fraud|fake|lie|cheat|steal|lawsuit|illegal|abuse|harass/i], action: "escalate_immediately" },
    high:     { score: 3, patterns: [/terrible|worst|never again|refund|broken|false|mislead|hate|awful/i], action: "respond_within_1h" },
    medium:   { score: 2, patterns: [/bad|poor|disappointed|wrong|issue|problem|complaint|unhappy|slow/i], action: "respond_within_4h" },
    low:      { score: 1, patterns: [/not great|could be better|meh|okay i guess|average/i], action: "monitor" }
};

const RESPONSE_TEMPLATES = {
    critical: `Hi {name} — we take this very seriously. Our team has been notified and will reach out within 2 hours. Please DM us your contact details so we can resolve this immediately. We're sorry for the experience. 🙏`,
    high:     `Hi {name} — thank you for flagging this. We're sorry to hear about your experience. Can you DM us the details? We'd like to make this right personally. Our team will be in touch shortly. 💬`,
    medium:   `Hi {name} — thank you for the honest feedback. We hear you and we're working on improving this. Please DM us so we can understand your situation better and find a solution. 🙌`,
    low:      `Hi {name} — we appreciate you sharing that. We're always looking to improve. Feel free to DM us if you'd like to chat further! 😊`
};

function _detectSeverity(text) {
    const lower = text.toLowerCase();
    for (const [level, { score, patterns, action }] of Object.entries(SEVERITY)) {
        if (patterns.some(p => p.test(lower))) return { level, score, action };
    }
    return { level: "none", score: 0, action: "no_action" };
}

function _personalize(template, name) {
    return template.replace(/{name}/g, name || "there");
}

async function analyse({ text, authorName = "", platform = "instagram", generateResponse = true }) {
    if (!text) throw new Error("text required");

    const severity    = _detectSeverity(text);
    const sentimentMatch = text.match(/[😡😤😠💀🤬]/u);
    const hasNegEmoji = !!sentimentMatch;

    if (severity.level === "none" && !hasNegEmoji) {
        return { text: text.slice(0, 80), severity: "none", action: "no_action", noIssue: true };
    }

    let response = _personalize(RESPONSE_TEMPLATES[severity.level] || RESPONSE_TEMPLATES.low, authorName);

    if (generateResponse && severity.level !== "none") {
        try {
            const prompt = `Negative comment on ${platform}: "${text.slice(0, 200)}". Severity: ${severity.level}.
Draft a professional brand response (max 50 words). Stay calm, empathetic, offer help.
JSON: { "response": "...", "toneNotes": "..." }`;
            const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 200 });
            const ai  = groq.parseJson(raw);
            if (ai?.response) response = ai.response;
        } catch { /* use template */ }
    }

    const entry = {
        id:           uid("rep"),
        platform,
        authorName,
        text:         text.slice(0, 200),
        severity:     severity.level,
        severityScore: severity.score,
        action:       severity.action,
        suggestedResponse: response,
        status:       "pending",
        detectedAt:   NOW()
    };

    const log = load(STORE, []);
    log.push(entry);
    if (log.length > 200) log.splice(0, log.length - 200);
    flush(STORE, log);

    return entry;
}

async function batchAnalyse(comments = []) {
    const results = [];
    for (const c of comments) {
        const r = await analyse({ text: c.text, authorName: c.author || "", platform: c.platform || "instagram" });
        results.push(r);
    }
    const issues = results.filter(r => r.severity && r.severity !== "none");
    return { total: comments.length, issuesFound: issues.length, critical: issues.filter(r => r.severity === "critical").length, results };
}

function getLog(limit = 20) { return load(STORE, []).slice(-limit); }

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "reputation_check":  data = await analyse({ text: p.text || p.comment || "", authorName: p.author || "", platform: p.platform || "instagram", generateResponse: p.generateResponse !== false }); break;
            case "reputation_batch":  data = await batchAnalyse(p.comments || []); break;
            case "reputation_log":    data = { log: getLog(p.limit || 20) }; break;
            default:                  data = await analyse({ text: p.text || p.comment || "", authorName: p.author || "" });
        }
        return { success: true, type: "social", agent: "reputationManager", data };
    } catch (err) {
        return { success: false, type: "social", agent: "reputationManager", data: { error: err.message } };
    }
}

module.exports = { analyse, batchAnalyse, getLog, run };
