/**
 * BusinessPro shared file-store utility.
 * Each domain gets its own JSON file under data/businesspro/.
 */

const fs   = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "../../data/businesspro");

function _file(name) { return path.join(BASE, `${name}.json`); }

function load(name, defaultVal = []) {
    try {
        const f = _file(name);
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch { /* corrupt — start fresh */ }
    return defaultVal;
}

function flush(name, data) {
    fs.mkdirSync(BASE, { recursive: true });
    fs.writeFileSync(_file(name), JSON.stringify(data, null, 2));
}

function uid(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

const MAX_BATCH  = 50;
const MAX_RETRY  = 3;
const NOW        = () => new Date().toISOString();

module.exports = { load, flush, uid, MAX_BATCH, MAX_RETRY, NOW };
