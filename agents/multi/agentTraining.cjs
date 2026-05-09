/**
 * Agent Training — stores learning patterns and feedback to improve agents.
 * Patterns are persisted to disk and loaded on next boot.
 */

const fs   = require("fs");
const path = require("path");

const TRAINING_FILE = path.join(__dirname, "../../data/agent-training.json");

function _load() {
    try {
        if (!fs.existsSync(TRAINING_FILE)) return {};
        return JSON.parse(fs.readFileSync(TRAINING_FILE, "utf8"));
    } catch { return {}; }
}

function _save(data) {
    const dir = path.dirname(TRAINING_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TRAINING_FILE, JSON.stringify(data, null, 2));
}

// Record feedback on an agent's response
function recordFeedback(agentName, { input, output, rating, correction = null }) {
    const store = _load();
    if (!store[agentName]) store[agentName] = { patterns: [], feedback: [] };

    store[agentName].feedback.push({
        ts:         new Date().toISOString(),
        input,
        output,
        rating,     // 1-5
        correction
    });

    // Promote to pattern if highly rated
    if (rating >= 4) {
        store[agentName].patterns.push({ input, output, ts: new Date().toISOString() });
    }

    // Keep last 200 feedback entries
    if (store[agentName].feedback.length > 200) store[agentName].feedback.shift();

    _save(store);
    return { success: true, agentName, rating };
}

// Get learned patterns for an agent (used to build context for AI prompts)
function getPatterns(agentName, limit = 5) {
    const store = _load();
    const data  = store[agentName];
    if (!data) return [];
    return data.patterns.slice(-limit);
}

// Get average rating for an agent
function getStats(agentName) {
    const store = _load();
    const data  = store[agentName];
    if (!data || !data.feedback.length) return { agentName, avgRating: null, totalFeedback: 0 };
    const avg = data.feedback.reduce((s, f) => s + (f.rating || 0), 0) / data.feedback.length;
    return {
        agentName,
        avgRating:     avg.toFixed(2),
        totalFeedback: data.feedback.length,
        patterns:      data.patterns.length
    };
}

function allStats() {
    const store = _load();
    return Object.keys(store).map(getStats);
}

module.exports = { recordFeedback, getPatterns, getStats, allStats };
