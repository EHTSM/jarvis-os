/**
 * Content Scheduler — queue posts for future publishing.
 * Persists to data/content-schedule.json.
 * Connects to marketingAgent for WhatsApp distribution when posts come due.
 *
 * Status flow: pending → ready → sent | failed
 */

const fs   = require("fs");
const path = require("path");

const FILE    = path.join(__dirname, "../../data/content-schedule.json");
const STATUSES = ["pending", "ready", "sent", "failed", "cancelled"];

function _load() {
    try {
        if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch { /* start fresh */ }
    return { posts: [] };
}

function _flush(data) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

let _cache = null;
function _store() {
    if (!_cache) _cache = _load();
    return _cache;
}

/**
 * Add a post to the schedule.
 * @param {object} post  { platform, content, caption, hashtags, scheduledAt (ISO string), type }
 * @returns {object} saved post with id
 */
function add(post) {
    const store = _store();
    const now   = new Date().toISOString();

    if (!post.content && !post.caption) throw new Error("content or caption required");
    if (!post.scheduledAt) throw new Error("scheduledAt (ISO string) required");

    const record = {
        id:          `sched_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        platform:    post.platform    || "instagram",
        type:        post.type        || "post",
        content:     post.content     || post.caption || "",
        caption:     post.caption     || post.content || "",
        hashtags:    post.hashtags    || [],
        imagePrompt: post.imagePrompt || null,
        videoUrl:    post.videoUrl    || null,
        scheduledAt: post.scheduledAt,
        status:      "pending",
        createdAt:   now,
        updatedAt:   now,
        sentAt:      null,
        error:       null,
        meta:        post.meta || {}
    };

    store.posts.push(record);
    _flush(store);
    return record;
}

/** Get all posts, optionally filtered by status or platform. */
function list({ status, platform, limit = 50 } = {}) {
    let posts = [..._store().posts];
    if (status)   posts = posts.filter(p => p.status === status);
    if (platform) posts = posts.filter(p => p.platform === platform);
    return posts
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
        .slice(0, limit);
}

/** Get posts that are due (scheduledAt ≤ now and status = pending). */
function getDue() {
    const now = new Date();
    return _store().posts.filter(p =>
        p.status === "pending" && new Date(p.scheduledAt) <= now
    );
}

/** Mark a post as sent. */
function markSent(id, meta = {}) {
    return _updateStatus(id, "sent", { sentAt: new Date().toISOString(), ...meta });
}

/** Mark a post as failed. */
function markFailed(id, error = "") {
    return _updateStatus(id, "failed", { error });
}

/** Cancel a pending post. */
function cancel(id) {
    return _updateStatus(id, "cancelled");
}

function _updateStatus(id, status, extra = {}) {
    const store = _store();
    const post  = store.posts.find(p => p.id === id);
    if (!post) return null;
    Object.assign(post, { status, updatedAt: new Date().toISOString(), ...extra });
    _flush(store);
    return post;
}

/** Remove a post by id. */
function remove(id) {
    const store = _store();
    const idx   = store.posts.findIndex(p => p.id === id);
    if (idx < 0) return false;
    store.posts.splice(idx, 1);
    _flush(store);
    _cache = store;
    return true;
}

/** Stats about the schedule queue. */
function stats() {
    const posts = _store().posts;
    const byStatus = {};
    for (const p of posts) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    return {
        total:    posts.length,
        byStatus,
        dueNow:   getDue().length,
        upcoming: posts.filter(p => p.status === "pending").length
    };
}

// Scheduler Reliability & Recovery Audit (2026-08-16): processDue() was
// real and fully built, but confirmed via grep that nothing anywhere in
// the codebase ever called it automatically — a post scheduled for a
// future time sat at "pending" forever unless a human/agent explicitly
// dispatched a "process_due" task. In-flight guard here (mirroring
// browserScheduler.cjs's _inFlight Set — the established pattern for this
// exact class of problem) closes the real overlap window it otherwise has:
// getDue() reads status==="pending" before this loop updates any status,
// so two genuinely concurrent processDue() calls (a scheduled tick racing
// a manual "process_due" task dispatch) could both select the same due
// post before either one's _updateStatus("ready") lands.
const _processingIds = new Set();

/**
 * Process due posts — mark ready and optionally trigger marketingAgent.
 * Returns list of posts that were marked ready.
 */
async function processDue() {
    const due     = getDue().filter(p => !_processingIds.has(p.id));
    const ready   = [];

    for (const post of due) {
        _processingIds.add(post.id);
        _updateStatus(post.id, "ready");

        // Optional: trigger WhatsApp distribution via marketingAgent
        if (post.platform === "whatsapp" && post.content) {
            try {
                const marketingAgent = require("../business/marketingAgent.cjs");
                await marketingAgent.broadcastToAll(post.content);
                markSent(post.id, { via: "whatsapp_broadcast" });
            } catch (err) {
                markFailed(post.id, err.message);
            }
        }
        _processingIds.delete(post.id);

        ready.push(post);
    }

    return { processed: ready.length, posts: ready };
}

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "schedule_post":
        case "content_schedule": {
            try {
                const saved = add(p);
                return { success: true, type: "content", agent: "contentScheduler", data: { scheduled: saved, message: `Post scheduled for ${saved.scheduledAt}` } };
            } catch (err) {
                return { success: false, type: "content", agent: "contentScheduler", data: { error: err.message } };
            }
        }
        case "list_scheduled":
            return { success: true, type: "content", agent: "contentScheduler", data: { posts: list(p), stats: stats() } };

        case "get_due_posts":
            return { success: true, type: "content", agent: "contentScheduler", data: { due: getDue() } };

        case "process_due": {
            const result = await processDue();
            return { success: true, type: "content", agent: "contentScheduler", data: result };
        }
        case "cancel_post": {
            const post = cancel(p.id);
            return post
                ? { success: true,  type: "content", agent: "contentScheduler", data: { cancelled: post } }
                : { success: false, type: "content", agent: "contentScheduler", data: { error: "Post not found" } };
        }
        case "schedule_stats":
            return { success: true, type: "content", agent: "contentScheduler", data: stats() };

        default:
            return { success: false, type: "content", agent: "contentScheduler", data: { error: "Unknown contentScheduler task type" } };
    }
}

// ── Autonomous tick ──────────────────────────────────────────────────────
// 60s interval, matching browserScheduler.cjs's own TICK_MS — this queue's
// due-time resolution is per-post scheduledAt, not cron-field granularity,
// so a 1-minute check is more than tight enough without adding load.
const TICK_MS = 60_000;
let _interval = null;
let _active   = false;

function start() {
    if (_active) return { ok: true, alreadyRunning: true };
    _active = true;
    processDue().catch(() => {}); // immediate first check, non-blocking
    _interval = setInterval(() => { processDue().catch(() => {}); }, TICK_MS);
    if (typeof _interval.unref === "function") _interval.unref();
    return { ok: true, alreadyRunning: false };
}

function stop() {
    if (_interval) { clearInterval(_interval); _interval = null; }
    const wasRunning = _active;
    _active = false;
    return { ok: true, wasRunning };
}

function getStatus() {
    return { active: _active };
}

module.exports = { add, list, getDue, markSent, markFailed, cancel, remove, stats, processDue, run, start, stop, getStatus };
