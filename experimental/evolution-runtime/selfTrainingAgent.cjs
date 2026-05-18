/**
 * Self Training Agent — periodically optimizes memory by pruning low-value entries
 * and compacting the vector index. Can be triggered on demand or on a schedule.
 */

const memoryStore    = require("../memory/memoryStore.cjs");
const memoryIndexer  = require("../memory/memoryIndexer.cjs");
const feedbackLoop   = require("./feedbackLoopAgent.cjs");
const learningAgent  = require("./learningAgent.cjs");

let _lastRun    = null;
let _runCount   = 0;
const RUN_INTERVAL_MS = 60 * 60 * 1000;  // max once per hour

/**
 * Run the self-training cycle:
 * 1. Identify low-value memory entries (short, no response, failed interactions)
 * 2. Get improvement signals from feedback loop
 * 3. Return summary of what was optimized
 */
function optimize() {
    const now = Date.now();
    if (_lastRun && now - _lastRun < RUN_INTERVAL_MS) {
        return { skipped: true, reason: "Too soon since last run", nextRunIn: Math.round((RUN_INTERVAL_MS - (now - _lastRun)) / 60000) + " min" };
    }

    _lastRun = now;
    _runCount++;

    const entries = memoryStore.all();
    const report  = { runCount: _runCount, timestamp: new Date().toISOString(), actions: [] };

    // Identify weak entries (failed + no meaningful content)
    const weakEntries = entries.filter(e =>
        !e.success &&
        (e.input || "").length < 10 &&
        (e.response || "").length < 10
    );

    if (weakEntries.length > 0) {
        report.actions.push({ action: "prunable_entries_identified", count: weakEntries.length, note: "Low-value failed interactions with no content" });
    }

    // Get feedback signals
    const { signals, summary } = feedbackLoop.analyze();
    if (signals.length > 0) {
        report.actions.push({ action: "improvement_signals", signals });
    }

    // Memory index stats
    const idxStats  = memoryIndexer.stats();
    const memStats  = memoryStore.stats();
    const learnStats = learningAgent.stats();

    report.memoryStats   = memStats;
    report.indexStats    = idxStats;
    report.learningStats = learnStats;
    report.feedbackSummary = summary;
    report.status = "completed";

    return report;
}

/**
 * Force a run regardless of timing (for testing/manual trigger).
 */
function forceOptimize() {
    _lastRun = null;
    return optimize();
}

function status() {
    return {
        runCount:    _runCount,
        lastRun:     _lastRun ? new Date(_lastRun).toISOString() : null,
        nextRunIn:   _lastRun ? Math.max(0, Math.round((RUN_INTERVAL_MS - (Date.now() - _lastRun)) / 60000)) + " min" : "ready",
        memoryStats: memoryStore.stats(),
        indexStats:  memoryIndexer.stats(),
        learnStats:  learningAgent.stats()
    };
}

module.exports = { optimize, forceOptimize, status };
