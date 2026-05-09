/**
 * Memory Store — persists conversations + actions to disk.
 * Ring buffer: keeps last MAX_ENTRIES (500) entries.
 */

const fs   = require("fs");
const path = require("path");

const FILE       = path.join(__dirname, "../../data/memory-store.json");
const MAX_ENTRIES = 500;

function _load() {
    try {
        if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch { /* corrupt file — start fresh */ }
    return [];
}

function _flush(entries) {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(entries, null, 2));
    } catch (err) {
        console.error("[memoryStore] flush error:", err.message);
    }
}

let _cache = null;

function _entries() {
    if (!_cache) _cache = _load();
    return _cache;
}

/**
 * Save a new memory entry.
 * @param {object} entry  { input, response, context, tags, taskType, success }
 * @returns {object} saved entry with id + timestamp
 */
function save(entry) {
    const input    = (entry.input || "").trim();
    const response = (entry.response || "").trim();

    // Quality gate: reject entries that would pollute RAG retrieval.
    // - Input too short to be meaningful
    // - Internal/test keys like "sleep:demo", "demo2:", "demo3:"
    // - No response and unknown task type (nothing useful to retrieve)
    if (input.length < 4) return null;
    if (/^(sleep:|demo\d?:|test:|debug:)/i.test(input)) return null;
    if (!response && (entry.taskType || "unknown") === "unknown") return null;

    const entries = _entries();
    const record = {
        id:        `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        input,
        response,
        context:   entry.context   || [],
        tags:      entry.tags      || [],
        taskType:  entry.taskType  || "unknown",
        success:   entry.success   !== false
    };
    entries.push(record);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    _flush(entries);
    return record;
}

/** Get most recent N entries. */
function recent(limit = 20) {
    return _entries().slice(-limit).reverse();
}

/** Get all entries. */
function all() {
    return [..._entries()];
}

/** Simple text filter (full semantic done by vectorSearchAgent). */
function filter(query, limit = 10) {
    const q = query.toLowerCase();
    return _entries()
        .filter(e => e.input.toLowerCase().includes(q) || e.response.toLowerCase().includes(q))
        .slice(-limit)
        .reverse();
}

/** Clear all stored memory. */
function clear() {
    _cache = [];
    _flush([]);
    return { cleared: true };
}

/** Stats about the store. */
function stats() {
    const e = _entries();
    return {
        total:      e.length,
        max:        MAX_ENTRIES,
        oldest:     e[0]?.timestamp || null,
        newest:     e[e.length - 1]?.timestamp || null,
        successRate: e.length ? Math.round((e.filter(x => x.success).length / e.length) * 100) : 0
    };
}

module.exports = { save, recent, all, filter, clear, stats };
