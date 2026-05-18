/**
 * Learning Agent — observes input/output pairs and saves patterns.
 * Identifies which task types succeed most and what phrasing triggers them.
 * Persists to data/learning-patterns.json.
 */

const fs   = require("fs");
const path = require("path");

const FILE     = path.join(__dirname, "../../data/learning-patterns.json");
const MAX_HIST = 300;

function _load() {
    try {
        if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch { /* start fresh */ }
    return { patterns: {}, history: [], meta: { totalLearned: 0, lastUpdated: null } };
}

function _flush(data) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

let _data = null;
function _store() {
    if (!_data) _data = _load();
    return _data;
}

function _extractTokens(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2);
}

/**
 * Learn from an interaction.
 * @param {object} params { input, response, taskType, success, duration }
 */
function learn({ input, response, taskType = "unknown", success = true, duration = 0 }) {
    const store    = _store();
    const tokens   = _extractTokens(input);
    const key      = taskType;
    const now      = new Date().toISOString();

    // Update per-task-type pattern
    if (!store.patterns[key]) {
        store.patterns[key] = {
            taskType: key,
            totalCalls:   0,
            successCount: 0,
            failCount:    0,
            avgDurationMs: 0,
            triggerPhrases: {},
            lastSeen: null
        };
    }
    const pat = store.patterns[key];
    pat.totalCalls++;
    success ? pat.successCount++ : pat.failCount++;
    pat.avgDurationMs = Math.round((pat.avgDurationMs * (pat.totalCalls - 1) + duration) / pat.totalCalls);
    pat.lastSeen = now;

    // Track which tokens frequently trigger this task type
    for (const token of tokens) {
        pat.triggerPhrases[token] = (pat.triggerPhrases[token] || 0) + 1;
    }
    // Keep only top-50 trigger phrases per pattern
    const topTokens = Object.entries(pat.triggerPhrases)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50);
    pat.triggerPhrases = Object.fromEntries(topTokens);

    // Append to history ring buffer
    store.history.push({ timestamp: now, input: input.slice(0, 100), taskType, success, duration });
    if (store.history.length > MAX_HIST) store.history.splice(0, store.history.length - MAX_HIST);

    store.meta.totalLearned++;
    store.meta.lastUpdated = now;

    _flush(store);
}

/**
 * Get the best matching pattern for an input string.
 * Scores each pattern by token overlap with its trigger phrases.
 */
function getPattern(input) {
    const store  = _store();
    const tokens = new Set(_extractTokens(input));
    let best = null, bestScore = 0;

    for (const [taskType, pat] of Object.entries(store.patterns)) {
        let score = 0;
        for (const token of tokens) {
            score += pat.triggerPhrases[token] || 0;
        }
        // Normalize by totalCalls to avoid high-volume bias
        const normalized = score / Math.max(pat.totalCalls, 1);
        if (normalized > bestScore) { bestScore = normalized; best = { taskType, ...pat, score: normalized }; }
    }
    return best;
}

function allPatterns() {
    return Object.values(_store().patterns);
}

function stats() {
    const s = _store();
    return {
        totalLearned: s.meta.totalLearned,
        lastUpdated:  s.meta.lastUpdated,
        patternCount: Object.keys(s.patterns).length,
        historyCount: s.history.length
    };
}

module.exports = { learn, getPattern, allPatterns, stats };
