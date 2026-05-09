/**
 * Shared store for all Life OS agents.
 * Memory integration + safe output helpers.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/life");

function _ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function load(key, def = {}) {
    _ensure();
    const file = path.join(DATA_DIR, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* fresh */ }
    return def instanceof Array ? [] : def;
}

function flush(key, data) {
    _ensure();
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(p = "life") { return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`; }
function NOW()            { return new Date().toISOString(); }

function logToMemory(agent, input, output) {
    try {
        const ms = require("../memory/memoryStore.cjs");
        ms.save({ type: "life", agent, input: String(input).slice(0, 200), output: JSON.stringify(output).slice(0, 400), category: "life", tags: [agent, "life"] });
    } catch { /* non-critical */ }
}

function ok(agent, data, suggestions = [])  { return { success: true,  type: "life", agent, data, suggestions }; }
function fail(agent, error)                 { return { success: false, type: "life", agent, data: { error: String(error) }, suggestions: [] }; }

// Safety disclaimer — always prepended to health/finance outputs
const HEALTH_DISCLAIMER  = "⚠️ This is general wellness guidance only. Consult a qualified healthcare professional for medical advice.";
const FINANCE_DISCLAIMER = "⚠️ This is general financial information only. Consult a certified financial advisor before making investment decisions.";

module.exports = { load, flush, uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER, FINANCE_DISCLAIMER };
