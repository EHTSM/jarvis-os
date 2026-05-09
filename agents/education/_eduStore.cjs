/**
 * Shared store for all education agents.
 * Single source of truth for persistence, IDs, and memoryAgent integration.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/education");

function _ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function load(key, def = {}) {
    _ensure();
    const file = path.join(DATA_DIR, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* start fresh */ }
    return def instanceof Array ? [] : def;
}

function flush(key, data) {
    _ensure();
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(prefix = "edu") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function NOW() { return new Date().toISOString(); }

// ── Memory integration ─────────────────────────────────────────
function logToMemory(agentName, input, output) {
    try {
        const memoryStore = require("../memory/memoryStore.cjs");
        memoryStore.save({
            type:     "education",
            agent:    agentName,
            input:    String(input).slice(0, 200),
            output:   JSON.stringify(output).slice(0, 400),
            category: "education",
            tags:     [agentName, "education"]
        });
    } catch { /* non-critical — memory not required */ }
}

// ── Knowledge integration ──────────────────────────────────────
function saveToKnowledge(key, content, category = "education") {
    try {
        const kb = require("../knowledge/knowledgeBase.cjs");
        kb.add(key, content, category);
    } catch { /* non-critical */ }
}

// Standard response shape
function ok(agent, data, suggestions = []) {
    return { status: "success", agent, data, suggestions };
}

function fail(agent, error) {
    return { status: "error", agent, data: { error: String(error) }, suggestions: [] };
}

module.exports = { load, flush, uid, NOW, logToMemory, saveToKnowledge, ok, fail };
