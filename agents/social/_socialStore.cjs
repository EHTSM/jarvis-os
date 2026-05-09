/**
 * Shared store + rate-limiter for all social agents.
 * Single source of truth for platform caps.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/social");

// Safety caps (platform-safe)
const CAPS = {
    maxPostsPerDayPerPlatform: 5,
    maxDmsPerHour:             10,
    maxCommentsPerHour:        20,
    dmDelayMin:                30_000,   // 30 s
    dmDelayMax:                120_000,  // 120 s
    commentDelayMin:           15_000,
    commentDelayMax:           45_000
};

function _ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

function load(key, def = {}) {
    _ensure();
    const file = path.join(DATA_DIR, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* start fresh */ }
    return def;
}

function flush(key, data) {
    _ensure();
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(prefix = "s") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function NOW() { return new Date().toISOString(); }

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Daily post counter ────────────────────────────────────────────
function _getPostCount(platform) {
    const counts = load("post-counts", {});
    const today  = new Date().toDateString();
    if (counts.date !== today) return 0;
    return counts[platform] || 0;
}

function _incrementPostCount(platform) {
    const counts = load("post-counts", {});
    const today  = new Date().toDateString();
    if (counts.date !== today) { counts.date = today; }
    counts[platform] = (_getPostCount(platform)) + 1;
    flush("post-counts", counts);
}

function canPost(platform) {
    return _getPostCount(platform) < CAPS.maxPostsPerDayPerPlatform;
}

function recordPost(platform) {
    _incrementPostCount(platform);
}

// ── Hourly comment counter ────────────────────────────────────────
function canComment() {
    const log  = load("comment-log", { hour: -1, count: 0 });
    const hour = new Date().getHours();
    if (log.hour !== hour) return true;
    return log.count < CAPS.maxCommentsPerHour;
}

function recordComment() {
    const log  = load("comment-log", { hour: -1, count: 0 });
    const hour = new Date().getHours();
    if (log.hour !== hour) { log.hour = hour; log.count = 0; }
    log.count++;
    flush("comment-log", log);
}

module.exports = { load, flush, uid, NOW, CAPS, randomDelay, canPost, recordPost, canComment, recordComment };
