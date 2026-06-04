"use strict";
/**
 * SecretManagementLayer — validates, audits and tracks rotation metadata
 * for all secrets required by Jarvis-OS.
 *
 * Does NOT read or store secret values — only validates presence,
 * strength and rotation schedule. Never logs secret values.
 *
 * Secret catalog: each entry defines
 *   key         — env var name
 *   required    — bool: missing = blocker
 *   minLength   — minimum character length for strength check
 *   rotationDays— recommended rotation interval (null = no requirement)
 *   validator   — optional fn(value) → { ok, detail }
 *   category    — "auth" | "ai" | "oauth" | "payment" | "comms"
 *
 * Rotation metadata persisted to data/secret-rotation.json:
 *   { [key]: { lastRotatedAt: ISO, rotatedBy: string, notes: string } }
 *
 * Public API:
 *   validate(key?)              → SecretReport | SecretReport[]
 *   audit()                     → AuditReport (full environment audit)
 *   detectMissing()             → { critical[], optional[], total }
 *   markRotated(key, opts)      → RotationRecord
 *   getRotationStatus(key?)     → RotationStatus[]
 *   getAuditHistory(opts)       → { history[] }
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");
const execLog  = require("../utils/execLog.cjs");

const ROTATION_FILE = path.join(__dirname, "../../data/secret-rotation.json");
const AUDIT_LOG_FILE = path.join(__dirname, "../../data/secret-audit-history.json");

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _rotation = _rj(ROTATION_FILE, {});
let _auditHistory = _rj(AUDIT_LOG_FILE, []);

function _saveRotation()  { try { _wj(ROTATION_FILE, _rotation);              } catch { /* non-fatal */ } }
function _saveAuditHist() { try { _wj(AUDIT_LOG_FILE, _auditHistory.slice(-200)); } catch { /* non-fatal */ } }

// ── Secret catalog ────────────────────────────────────────────────────────
const SECRET_CATALOG = [
    // Auth
    {
        key: "JWT_SECRET", required: true, minLength: 32, rotationDays: 90, category: "auth",
        validator: v => {
            if (v.length < 32) return { ok: false, detail: "Too short — minimum 32 chars, recommend 64+" };
            if (v.length < 64) return { ok: true,  detail: `Length ${v.length} — recommend 64+ chars for stronger security` };
            // Check entropy: reject common patterns
            if (/^(.)\1+$/.test(v)) return { ok: false, detail: "Low entropy — all same character" };
            return { ok: true, detail: `Length ${v.length}, entropy looks sufficient` };
        },
    },
    {
        key: "OPERATOR_PASSWORD_HASH", required: true, minLength: 100, rotationDays: 180, category: "auth",
        validator: v => {
            if (!v.includes(":")) return { ok: false, detail: "Must be in format salt:hash (use generate-password-hash.cjs)" };
            const [salt, hash] = v.split(":");
            if (salt.length < 16) return { ok: false, detail: "Salt too short" };
            if (hash.length < 64) return { ok: false, detail: "Hash too short — regenerate with scrypt" };
            return { ok: true, detail: "Format valid (salt:scrypt_hash)" };
        },
    },
    // AI
    { key: "GROQ_API_KEY",       required: false, minLength: 20, rotationDays: 365, category: "ai",
      validator: v => ({ ok: v.startsWith("gsk_"), detail: v.startsWith("gsk_") ? "Prefix gsk_ valid" : "Expected prefix gsk_" }) },
    { key: "OPENROUTER_API_KEY", required: false, minLength: 20, rotationDays: 365, category: "ai",
      validator: v => ({ ok: v.startsWith("sk-or-"), detail: v.startsWith("sk-or-") ? "Prefix sk-or- valid" : "Expected prefix sk-or-" }) },
    { key: "ANTHROPIC_API_KEY",  required: false, minLength: 20, rotationDays: 365, category: "ai",
      validator: v => ({ ok: v.startsWith("sk-ant-"), detail: v.startsWith("sk-ant-") ? "Prefix sk-ant- valid" : "Expected prefix sk-ant-" }) },
    // OAuth
    { key: "GOOGLE_CLIENT_SECRET", required: false, minLength: 10, rotationDays: null, category: "oauth",
      validator: v => ({ ok: v.length >= 10, detail: `Length ${v.length}` }) },
    { key: "GITHUB_CLIENT_SECRET", required: false, minLength: 20, rotationDays: null, category: "oauth",
      validator: v => ({ ok: v.length >= 20, detail: `Length ${v.length}` }) },
    { key: "SLACK_CLIENT_SECRET",  required: false, minLength: 20, rotationDays: null, category: "oauth",
      validator: v => ({ ok: v.length >= 20, detail: `Length ${v.length}` }) },
    { key: "NOTION_CLIENT_SECRET", required: false, minLength: 20, rotationDays: null, category: "oauth",
      validator: v => ({ ok: v.length >= 20, detail: `Length ${v.length}` }) },
    // Payment
    { key: "RAZORPAY_KEY_ID",     required: false, minLength: 10, rotationDays: null, category: "payment",
      validator: v => ({ ok: v.startsWith("rzp_"), detail: v.startsWith("rzp_") ? "Prefix rzp_ valid" : "Expected prefix rzp_" }) },
    { key: "RAZORPAY_KEY_SECRET", required: false, minLength: 20, rotationDays: null, category: "payment",
      validator: v => ({ ok: v.length >= 20, detail: `Length ${v.length}` }) },
    // Comms
    { key: "TELEGRAM_TOKEN",  required: false, minLength: 30, rotationDays: null, category: "comms",
      validator: v => ({ ok: /^\d+:[A-Za-z0-9_-]+$/.test(v), detail: /^\d+:[A-Za-z0-9_-]+$/.test(v) ? "Format BOTID:TOKEN valid" : "Expected format BOTID:TOKEN" }) },
    { key: "WA_TOKEN",        required: false, minLength: 20, rotationDays: null, category: "comms",
      validator: v => ({ ok: v.length >= 20, detail: `Length ${v.length}` }) },
];

// ── Core validation ───────────────────────────────────────────────────────
function _validateOne(entry) {
    const value = process.env[entry.key];
    const rotation = _rotation[entry.key] || null;
    const now      = Date.now();

    const result = {
        key:       entry.key,
        category:  entry.category,
        required:  entry.required,
        present:   !!value,
        status:    "unknown",   // present | missing | weak | valid | overdue
        detail:    null,
        strength:  null,
        rotationDays: entry.rotationDays,
        lastRotatedAt: rotation?.lastRotatedAt || null,
        daysUntilRotation: null,
        rotationOverdue:   false,
    };

    if (!value) {
        result.status = entry.required ? "missing_critical" : "missing_optional";
        result.detail = `${entry.key} not set in environment`;
        return result;
    }

    // Length check
    if (entry.minLength && value.length < entry.minLength) {
        result.status  = "weak";
        result.detail  = `Value present but too short (${value.length} < ${entry.minLength} required)`;
        result.strength = "weak";
        return result;
    }

    // Custom validator
    if (entry.validator) {
        const v = entry.validator(value);
        result.strength = v.ok ? "strong" : "weak";
        result.detail   = v.detail;
        if (!v.ok) { result.status = "weak"; return result; }
    }

    result.status = "valid";

    // Rotation check
    if (entry.rotationDays && rotation?.lastRotatedAt) {
        const ageMs    = now - new Date(rotation.lastRotatedAt).getTime();
        const ageDays  = ageMs / 86_400_000;
        const daysLeft = Math.round(entry.rotationDays - ageDays);
        result.daysUntilRotation = daysLeft;
        result.rotationOverdue   = daysLeft < 0;
        if (daysLeft < 0)  result.status = "rotation_overdue";
        else if (daysLeft < 14) result.status = "rotation_soon";
    } else if (entry.rotationDays && !rotation?.lastRotatedAt) {
        result.daysUntilRotation = null;
        result.detail = (result.detail ? result.detail + ". " : "") + "No rotation record — mark initial rotation date";
    }

    return result;
}

function validate(key) {
    if (key) {
        const entry = SECRET_CATALOG.find(e => e.key === key);
        if (!entry) throw new Error(`Unknown secret key: ${key}`);
        return _validateOne(entry);
    }
    return SECRET_CATALOG.map(_validateOne);
}

function detectMissing() {
    const all = SECRET_CATALOG.map(_validateOne);
    return {
        critical: all.filter(r => r.status === "missing_critical").map(r => r.key),
        optional: all.filter(r => r.status === "missing_optional").map(r => r.key),
        weak:     all.filter(r => r.status === "weak").map(r => r.key),
        overdue:  all.filter(r => r.status === "rotation_overdue").map(r => r.key),
        total:    all.length,
        valid:    all.filter(r => r.status === "valid" || r.status === "rotation_soon").length,
    };
}

function audit() {
    const results  = SECRET_CATALOG.map(_validateOne);
    const missing  = results.filter(r => r.status === "missing_critical");
    const weak     = results.filter(r => r.status === "weak");
    const overdue  = results.filter(r => r.status === "rotation_overdue");
    const valid    = results.filter(r => ["valid","rotation_soon"].includes(r.status));
    const score    = Math.round(
        (valid.length * 10 - missing.length * 20 - weak.length * 10 - overdue.length * 5)
        / (SECRET_CATALOG.length * 10) * 100
    );

    const report = {
        ts:          new Date().toISOString(),
        score:       Math.max(0, Math.min(100, score)),
        total:       results.length,
        valid:       valid.length,
        missing:     missing.length,
        weak:        weak.length,
        overdue:     overdue.length,
        byCategory:  results.reduce((a, r) => { a[r.category] = a[r.category] || { valid: 0, issues: 0 }; r.status === "valid" || r.status === "rotation_soon" ? a[r.category].valid++ : a[r.category].issues++; return a; }, {}),
        secrets:     results,
        blockers:    [...missing.map(r => ({ key: r.key, issue: "missing_critical" })), ...weak.map(r => ({ key: r.key, issue: "weak" }))],
    };

    _auditHistory.push({ ts: report.ts, score: report.score, missing: report.missing, weak: report.weak });
    _saveAuditHist();
    execLog.append({ agentId: "SecretManagementLayer", taskType: "secret_audit", taskId: `sml_${Date.now()}`, success: report.missing === 0 && report.weak === 0, durationMs: 0 });
    return report;
}

function markRotated(key, opts = {}) {
    const entry = SECRET_CATALOG.find(e => e.key === key);
    if (!entry) throw new Error(`Unknown secret key: ${key}`);
    _rotation[key] = {
        lastRotatedAt: opts.rotatedAt || new Date().toISOString(),
        rotatedBy:     opts.rotatedBy || "operator",
        notes:         opts.notes     || "",
        method:        opts.method    || "manual",
    };
    _saveRotation();
    execLog.append({ agentId: "SecretManagementLayer", taskType: "secret_rotated", taskId: key, success: true, durationMs: 0 });
    logger.info(`[SecretMgmt] ${key} marked as rotated by ${_rotation[key].rotatedBy}`);
    return { key, ..._rotation[key] };
}

function getRotationStatus(key) {
    const entries = key ? SECRET_CATALOG.filter(e => e.key === key) : SECRET_CATALOG.filter(e => e.rotationDays);
    return entries.map(e => {
        const rot     = _rotation[e.key] || null;
        const ageDays = rot?.lastRotatedAt ? (Date.now() - new Date(rot.lastRotatedAt).getTime()) / 86_400_000 : null;
        return {
            key:           e.key,
            rotationDays:  e.rotationDays,
            lastRotatedAt: rot?.lastRotatedAt || null,
            ageDays:       ageDays ? Math.round(ageDays) : null,
            daysLeft:      ageDays ? Math.round(e.rotationDays - ageDays) : null,
            overdue:       ageDays ? ageDays > e.rotationDays : false,
            rotatedBy:     rot?.rotatedBy || null,
        };
    });
}

function getAuditHistory({ limit = 50 } = {}) {
    return { history: [..._auditHistory].reverse().slice(0, limit) };
}

module.exports = { validate, audit, detectMissing, markRotated, getRotationStatus, getAuditHistory };
