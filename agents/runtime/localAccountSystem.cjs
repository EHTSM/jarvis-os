"use strict";
/**
 * Phase 466 — Local Account Foundation
 *
 * Local operator accounts: identity, isolated sessions, profile persistence,
 * preferences, workflow ownership. Lightweight, local-first, no cloud.
 *
 * Account storage: data/local-accounts.json
 * Each account has a deterministic ID derived from a display name.
 * NO passwords stored — authentication is handled by the existing auth layer.
 * This layer tracks operator identity and preferences only.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const ACCOUNTS_PATH = path.join(__dirname, "../../data/local-accounts.json");
const MAX_ACCOUNTS  = 20;

// ── Account schema ────────────────────────────────────────────────────────────
// {
//   id:          string (sha256 of name, first 16 hex chars)
//   name:        string (display name, max 60)
//   label:       string (short tag, max 20)
//   createdAt:   number
//   lastActiveAt: number
//   preferences: { theme, defaultProfile, defaultMode, notifyOnRecovery }
//   workflowOwnership: string[]  (session IDs owned by this account)
//   tags: string[]
// }

function _id(name) {
    return crypto.createHash("sha256").update(name.toLowerCase().trim()).digest("hex").slice(0, 16);
}

function _load() {
    try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8")); }
    catch { return {}; }
}

function _save(accounts) {
    try {
        const dir = path.dirname(ACCOUNTS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
    } catch {}
}

function _defaults() {
    return {
        preferences: {
            theme:             "system",
            defaultProfile:    "jarvis-os-dev",
            defaultMode:       "development",
            notifyOnRecovery:  true,
        },
        workflowOwnership: [],
        tags: [],
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create or upsert a local account.
 * @param {string} name — display name (unique, used to derive ID)
 * @param {object} opts — { label, tags, preferences }
 * @returns {{ account, created: boolean }}
 */
function upsertAccount(name, opts = {}) {
    if (!name || typeof name !== "string") throw new Error("name required");
    name = name.slice(0, 60).trim();
    const accounts = _load();
    const id       = _id(name);
    const created  = !accounts[id];

    if (created) {
        if (Object.keys(accounts).length >= MAX_ACCOUNTS) {
            // Evict least-recently-active
            const oldest = Object.values(accounts).sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
            if (oldest) delete accounts[oldest.id];
        }
        accounts[id] = {
            id,
            name,
            label:        (opts.label || name.slice(0, 20)).slice(0, 20),
            createdAt:    Date.now(),
            lastActiveAt: Date.now(),
            ..._defaults(),
            tags: opts.tags || [],
        };
    } else {
        accounts[id].lastActiveAt = Date.now();
        if (opts.label)       accounts[id].label       = opts.label.slice(0, 20);
        if (opts.tags)        accounts[id].tags         = opts.tags;
    }

    if (opts.preferences) {
        accounts[id].preferences = { ...accounts[id].preferences, ...opts.preferences };
    }

    _save(accounts);
    return { account: accounts[id], created };
}

/** Get account by name or ID. */
function getAccount(nameOrId) {
    const accounts = _load();
    // Try as ID first
    if (accounts[nameOrId]) return accounts[nameOrId];
    // Try as name
    const byName = Object.values(accounts).find(a => a.name.toLowerCase() === nameOrId.toLowerCase());
    return byName || null;
}

/** List all accounts (summaries). */
function listAccounts() {
    return Object.values(_load())
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .map(a => ({
            id:           a.id,
            name:         a.name,
            label:        a.label,
            lastActiveAt: a.lastActiveAt,
            sessionCount: a.workflowOwnership?.length ?? 0,
        }));
}

/** Update account preferences. */
function updatePreferences(nameOrId, prefs) {
    const a = getAccount(nameOrId);
    if (!a) return false;
    const accounts = _load();
    accounts[a.id].preferences = { ...accounts[a.id].preferences, ...prefs };
    accounts[a.id].lastActiveAt = Date.now();
    _save(accounts);
    return true;
}

/** Record a session/workflow as owned by this account. */
function claimSession(nameOrId, sessionId) {
    const a = getAccount(nameOrId);
    if (!a) return false;
    const accounts = _load();
    const ownership = accounts[a.id].workflowOwnership || [];
    if (!ownership.includes(sessionId)) {
        ownership.unshift(sessionId);
        accounts[a.id].workflowOwnership = ownership.slice(0, 50); // max 50
    }
    accounts[a.id].lastActiveAt = Date.now();
    _save(accounts);
    return true;
}

/** Delete an account. */
function deleteAccount(nameOrId) {
    const a = getAccount(nameOrId);
    if (!a) return false;
    const accounts = _load();
    delete accounts[a.id];
    _save(accounts);
    return true;
}

/** Touch lastActiveAt for an account. */
function touch(nameOrId) {
    const a = getAccount(nameOrId);
    if (!a) return false;
    const accounts = _load();
    accounts[a.id].lastActiveAt = Date.now();
    _save(accounts);
    return true;
}

module.exports = { upsertAccount, getAccount, listAccounts, updatePreferences, claimSession, deleteAccount, touch };
