/**
 * Feedback Loop Agent — tracks success/failure rates, computes improvement signals.
 * Persists to data/feedback-loop.json.
 */

const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/feedback-loop.json");

function _load() {
    try {
        if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch { /* start fresh */ }
    return { records: [], byTaskType: {} };
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

/**
 * Record feedback for an interaction.
 * @param {object} params { input, response, taskType, success, rating (1-5), correction }
 */
function record({ input = "", response = "", taskType = "unknown", success = true, rating = null, correction = null }) {
    const store = _store();
    const entry = {
        id:        `fb_${Date.now()}`,
        timestamp: new Date().toISOString(),
        taskType,
        success,
        rating,     // optional explicit rating
        correction  // optional human correction
    };

    store.records.push(entry);
    if (store.records.length > 1000) store.records.splice(0, store.records.length - 1000);

    // Update per-task-type aggregates
    if (!store.byTaskType[taskType]) {
        store.byTaskType[taskType] = { total: 0, successes: 0, failures: 0, avgRating: null, corrections: 0 };
    }
    const agg = store.byTaskType[taskType];
    agg.total++;
    success ? agg.successes++ : agg.failures++;
    if (rating !== null) {
        agg.avgRating = agg.avgRating === null
            ? rating
            : Math.round((agg.avgRating * (agg.total - 1) + rating) / agg.total * 10) / 10;
    }
    if (correction) agg.corrections++;

    _flush(store);
}

/**
 * Get improvement signals — task types with low success rate or many corrections.
 */
function analyze() {
    const store = _store();
    const signals = [];

    for (const [taskType, agg] of Object.entries(store.byTaskType)) {
        const rate = agg.total > 0 ? (agg.successes / agg.total) * 100 : 100;
        if (rate < 60)        signals.push({ taskType, issue: "low_success_rate", rate: Math.round(rate), priority: "high" });
        if (agg.corrections > 3) signals.push({ taskType, issue: "frequent_corrections", corrections: agg.corrections, priority: "medium" });
        if (agg.avgRating !== null && agg.avgRating < 3) signals.push({ taskType, issue: "low_rating", avgRating: agg.avgRating, priority: "medium" });
    }

    return {
        signals,
        summary: {
            totalRecorded: store.records.length,
            taskTypesTracked: Object.keys(store.byTaskType).length,
            overallSuccessRate: _overallRate(store)
        }
    };
}

function _overallRate(store) {
    const total    = Object.values(store.byTaskType).reduce((s, a) => s + a.total, 0);
    const successes = Object.values(store.byTaskType).reduce((s, a) => s + a.successes, 0);
    return total > 0 ? Math.round((successes / total) * 100) : 100;
}

function getStats(taskType) {
    const store = _store();
    if (taskType) return store.byTaskType[taskType] || null;
    return { ...store.byTaskType };
}

module.exports = { record, analyze, getStats };
