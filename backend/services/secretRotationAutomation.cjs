"use strict";
/**
 * SecretRotationAutomation
 *
 * Capabilities:
 *   - Rotation schedules (per-secret TTL in days)
 *   - Rotation reminders (overdue / due-soon detection)
 *   - Rotation validation (format + entropy checks)
 *   - Secret health scoring (per-secret + aggregate)
 *
 * Persistence: data/secret-rotation.json
 * Note: stores metadata only — never stores the actual secret values.
 */

const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");

const STORE_PATH = path.join(__dirname, "../../data/secret-rotation.json");

// ── Default rotation TTLs (days) ──────────────────────────────────────────────
const DEFAULT_TTLS = {
    JWT_SECRET:             90,
    OPERATOR_PASSWORD_HASH: 180,
    RAZORPAY_KEY_ID:        365,
    RAZORPAY_KEY_SECRET:    365,
    GROQ_API_KEY:           180,
    OPENAI_API_KEY:         180,
    ANTHROPIC_API_KEY:      180,
    TELEGRAM_TOKEN:         365,
    FIREBASE_PROJECT_ID:    730,
    DEFAULT:                90,
};

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
    catch { return { schedules: {}, rotations: [], reminders: [], seq: 0 }; }
}
function _save(d) { fs.writeFileSync(STORE_PATH, JSON.stringify(d, null, 2)); }

// ── Schedule management ───────────────────────────────────────────────────────

function setSchedule(secretName, opts = {}) {
    const store  = _load();
    const ttlDays = opts.ttlDays || DEFAULT_TTLS[secretName] || DEFAULT_TTLS.DEFAULT;
    const lastRotated = opts.lastRotated || null;
    const nextDue = _nextDueDate(lastRotated, ttlDays);

    store.schedules[secretName] = {
        secretName,
        ttlDays,
        lastRotated:  lastRotated,
        nextDue,
        owner:        opts.owner    || null,
        reminder:     opts.reminder || 7,     // days before nextDue to send reminder
        enabled:      opts.enabled !== false,
        createdAt:    store.schedules[secretName]?.createdAt || new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
    };
    _save(store);
    return store.schedules[secretName];
}

function getSchedule(secretName) {
    const s = _load().schedules[secretName];
    if (!s) throw new Error(`No schedule for ${secretName}`);
    return s;
}

function listSchedules() {
    return Object.values(_load().schedules);
}

function removeSchedule(secretName) {
    const store = _load();
    delete store.schedules[secretName];
    _save(store);
    return { removed: secretName };
}

function _nextDueDate(lastRotated, ttlDays) {
    const base = lastRotated ? new Date(lastRotated) : new Date();
    base.setDate(base.getDate() + ttlDays);
    return base.toISOString();
}

// ── Rotation recording ────────────────────────────────────────────────────────

function recordRotation(secretName, opts = {}) {
    const store  = _load();
    const rotatedAt = new Date().toISOString();
    const sched    = store.schedules[secretName];
    const ttlDays  = sched?.ttlDays || DEFAULT_TTLS[secretName] || DEFAULT_TTLS.DEFAULT;

    const record = {
        id:          `rot-${Date.now()}`,
        secretName,
        rotatedAt,
        rotatedBy:   opts.rotatedBy   || "manual",
        method:      opts.method      || "manual",
        validated:   opts.validated   || false,
        notes:       opts.notes       || "",
    };

    if (!store.rotations) store.rotations = [];
    store.rotations.push(record);

    // update schedule
    if (sched) {
        sched.lastRotated = rotatedAt;
        sched.nextDue     = _nextDueDate(rotatedAt, ttlDays);
        sched.updatedAt   = rotatedAt;
    } else {
        setSchedule(secretName, { lastRotated: rotatedAt, ttlDays });
        // reload to reflect the new schedule
        return _load().rotations.slice(-1)[0];
    }

    _save(store);
    return record;
}

function getRotationHistory(secretName, limit = 20) {
    const rotations = _load().rotations || [];
    const filtered  = secretName ? rotations.filter(r => r.secretName === secretName) : rotations;
    return filtered.slice(-limit);
}

// ── Reminder engine ───────────────────────────────────────────────────────────

function checkReminders() {
    const store    = _load();
    const now      = Date.now();
    const upcoming = [];
    const overdue  = [];

    for (const s of Object.values(store.schedules)) {
        if (!s.enabled) continue;
        const dueMs     = new Date(s.nextDue).getTime();
        const daysLeft  = Math.round((dueMs - now) / 86400000);
        const reminderWindowMs = (s.reminder || 7) * 86400000;

        if (daysLeft < 0) {
            overdue.push({ secretName: s.secretName, daysOverdue: Math.abs(daysLeft), nextDue: s.nextDue, owner: s.owner });
        } else if ((dueMs - now) <= reminderWindowMs) {
            upcoming.push({ secretName: s.secretName, daysLeft, nextDue: s.nextDue, owner: s.owner });
        }
    }

    // persist reminder check
    if (!store.reminders) store.reminders = [];
    store.reminders.push({ checkedAt: new Date().toISOString(), overdue: overdue.length, upcoming: upcoming.length });
    if (store.reminders.length > 100) store.reminders = store.reminders.slice(-100);
    _save(store);

    return { overdue, upcoming, checkedAt: new Date().toISOString() };
}

// ── Rotation validation ───────────────────────────────────────────────────────

function validateSecret(secretName, secretValue) {
    if (!secretValue) return { valid: false, score: 0, issues: ["Secret is empty"] };

    const issues = [];
    let score    = 100;

    // Entropy check
    const entropy = _shannonEntropy(secretValue);
    if (entropy < 3.5) { issues.push("Low entropy — secret may be too simple"); score -= 30; }

    // Length check
    if (secretValue.length < 16) { issues.push("Too short — minimum 16 chars recommended"); score -= 20; }
    if (secretValue.length < 32 && secretName.includes("SECRET")) { issues.push("For secrets, 32+ chars recommended"); score -= 10; }

    // Pattern checks
    if (/^(.)\1+$/.test(secretValue)) { issues.push("Repeating character pattern detected"); score -= 40; }
    if (/^(password|secret|admin|test|123|abc)/i.test(secretValue)) { issues.push("Common prefix pattern — not secure"); score -= 50; }

    // Format checks per known key types
    if (secretName.includes("JWT") && secretValue.length < 32) {
        issues.push("JWT secret should be 32+ chars"); score -= 15;
    }
    if (secretName.startsWith("GROQ_") || secretName.startsWith("OPENAI_")) {
        if (!secretValue.startsWith("sk-") && !secretValue.startsWith("gsk_")) {
            issues.push("Unexpected API key format"); score -= 5;
        }
    }

    score = Math.max(0, score);
    return {
        valid:   score >= 60,
        score,
        entropy: Math.round(entropy * 100) / 100,
        length:  secretValue.length,
        issues,
        grade:   score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F",
    };
}

function _shannonEntropy(str) {
    const freq = {};
    for (const c of str) freq[c] = (freq[c] || 0) + 1;
    const len = str.length;
    return -Object.values(freq).reduce((sum, f) => {
        const p = f / len;
        return sum + p * Math.log2(p);
    }, 0);
}

// ── Secret health scoring ─────────────────────────────────────────────────────

function scoreHealth(envPath) {
    const store    = _load();
    const now      = Date.now();
    const secrets  = Object.values(store.schedules);
    if (!secrets.length) return { score: 0, grade: "N/A", details: [], message: "No schedules configured" };

    let totalScore = 0;
    const details  = [];

    for (const s of secrets) {
        const dueMs   = new Date(s.nextDue).getTime();
        const daysLeft = Math.round((dueMs - now) / 86400000);
        let   itemScore = 100;

        if (daysLeft < 0)       itemScore = Math.max(0, 30 + daysLeft * 2);  // overdue decays
        else if (daysLeft < 7)  itemScore = 50;
        else if (daysLeft < 30) itemScore = 75;

        details.push({
            secretName: s.secretName,
            daysLeft,
            status: daysLeft < 0 ? "overdue" : daysLeft < 7 ? "due-soon" : "ok",
            score:  itemScore,
        });
        totalScore += itemScore;
    }

    const avg   = Math.round(totalScore / secrets.length);
    const grade = avg >= 90 ? "A" : avg >= 75 ? "B" : avg >= 60 ? "C" : avg >= 40 ? "D" : "F";

    return {
        score:       avg,
        grade,
        details:     details.sort((a, b) => a.daysLeft - b.daysLeft),
        totalSecrets: secrets.length,
        overdue:     details.filter(d => d.status === "overdue").length,
        dueSoon:     details.filter(d => d.status === "due-soon").length,
        scoredAt:    new Date().toISOString(),
    };
}

// ── Bootstrap default schedules ───────────────────────────────────────────────

function bootstrapSchedules() {
    const store = _load();
    let added = 0;
    for (const [key, ttl] of Object.entries(DEFAULT_TTLS)) {
        if (key === "DEFAULT") continue;
        if (!store.schedules[key]) {
            setSchedule(key, { ttlDays: ttl });
            added++;
        }
    }
    return { added, total: Object.keys(_load().schedules).length };
}

module.exports = {
    setSchedule, getSchedule, listSchedules, removeSchedule,
    recordRotation, getRotationHistory,
    checkReminders, validateSecret, scoreHealth,
    bootstrapSchedules,
};
