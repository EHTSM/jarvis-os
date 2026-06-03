"use strict";
/**
 * Account Service — per-user identity, stored in data/local-accounts.json.
 *
 * Schema: { [accountId]: Account }
 * Account: {
 *   id:           string (uuid-v4-style, generated on creation)
 *   email:        string (unique, lowercase)
 *   passwordHash: string (scrypt: salt:hash)
 *   name:         string
 *   role:         "operator" | "user"
 *   createdAt:    ISO string
 *   lastLoginAt:  ISO string | null
 *   active:       boolean
 * }
 *
 * Backwards-compatibility: the legacy single-operator password (OPERATOR_PASSWORD_HASH
 * in .env) continues to work. On first login via that hash, an account record is
 * created automatically so the operator exists in the identity system going forward.
 *
 * Email is the primary login identifier. The operator fallback uses "operator" as
 * both the login subject and the account ID.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

const ACCOUNTS_FILE = path.join(__dirname, "../../data/local-accounts.json");

// ── Persistence ───────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")); }
  catch { return {}; }
}

function _save(data) {
  try {
    fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { logger.error("[Account] persist failed:", e.message); }
}

// ── Password hashing (same algorithm as auth.js) ──────────────────

function hashPassword(password) {
  const salt   = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const colonIdx = stored.indexOf(":");
  if (colonIdx < 0) return false;
  const salt = stored.slice(0, colonIdx);
  const hash = stored.slice(colonIdx + 1);
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  } catch { return false; }
}

function _generateId() {
  return crypto.randomBytes(12).toString("hex");
}

// ── Account CRUD ──────────────────────────────────────────────────

/**
 * Create a new account. Returns { success, account } or { success: false, error }.
 */
function createAccount({ email, password, name = "", role = "user" }) {
  if (!email || !password) return { success: false, error: "email and password are required" };

  const normalEmail = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalEmail)) {
    return { success: false, error: "Invalid email address" };
  }
  if (password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }

  const accounts = _load();

  // Check uniqueness by email
  const exists = Object.values(accounts).find(a => a.email === normalEmail);
  if (exists) return { success: false, error: "An account with this email already exists" };

  const id = _generateId();
  const account = {
    id,
    email:        normalEmail,
    passwordHash: hashPassword(password),
    name:         name.trim().slice(0, 100),
    role,
    createdAt:    new Date().toISOString(),
    lastLoginAt:  null,
    active:       true,
  };

  accounts[id] = account;
  _save(accounts);

  // Create trial billing record for new account
  try {
    require("./billingService").createTrial(id);
  } catch { /* non-critical */ }

  logger.info(`[Account] Created: ${normalEmail} (${id})`);
  const { passwordHash: _, ...safe } = account;
  return { success: true, account: safe };
}

/**
 * Find account by email and verify password.
 * Returns { success, account, token_sub } or { success: false, error }.
 */
function loginByEmail(email, password) {
  const normalEmail = (email || "").toLowerCase().trim();
  const accounts    = _load();

  const account = Object.values(accounts).find(a => a.email === normalEmail && a.active);
  if (!account) return { success: false, error: "Invalid email or password" };

  if (!verifyPassword(password, account.passwordHash)) {
    return { success: false, error: "Invalid email or password" };
  }

  // Update last login
  accounts[account.id].lastLoginAt = new Date().toISOString();
  _save(accounts);

  const { passwordHash: _, ...safe } = account;
  return { success: true, account: safe, token_sub: account.id };
}

/**
 * Get account by ID (no password).
 */
function getById(id) {
  const accounts = _load();
  const a = accounts[id];
  if (!a) return null;
  const { passwordHash: _, ...safe } = a;
  return safe;
}

/**
 * Get account by email (no password).
 */
function getByEmail(email) {
  const normalEmail = (email || "").toLowerCase().trim();
  const accounts = _load();
  const a = Object.values(accounts).find(acc => acc.email === normalEmail);
  if (!a) return null;
  const { passwordHash: _, ...safe } = a;
  return safe;
}

/**
 * List all active accounts (no passwords).
 */
function listAccounts() {
  const accounts = _load();
  return Object.values(accounts)
    .filter(a => a.active)
    .map(({ passwordHash: _, ...safe }) => safe);
}

/**
 * Update account fields (name, role). Email/password change has separate flows.
 */
function updateAccount(id, updates) {
  const accounts = _load();
  if (!accounts[id]) return { success: false, error: "Account not found" };

  const allowed = ["name", "role", "active"];
  for (const k of allowed) {
    if (updates[k] !== undefined) accounts[id][k] = updates[k];
  }
  accounts[id].updatedAt = new Date().toISOString();
  _save(accounts);

  const { passwordHash: _, ...safe } = accounts[id];
  return { success: true, account: safe };
}

/**
 * Bootstrap the legacy "operator" account from OPERATOR_PASSWORD_HASH.
 * Creates a synthetic account record so the operator appears in the identity system.
 * Called once on server start.
 */
function bootstrapOperatorAccount() {
  const hash = process.env.OPERATOR_PASSWORD_HASH;
  if (!hash) return;

  const accounts = _load();
  if (accounts["operator"]) return; // already bootstrapped

  accounts["operator"] = {
    id:           "operator",
    email:        "operator@local",
    passwordHash: hash, // already in the correct salt:hash format
    name:         "Operator",
    role:         "operator",
    createdAt:    new Date().toISOString(),
    lastLoginAt:  null,
    active:       true,
    _legacy:      true,
  };
  _save(accounts);
  logger.info("[Account] Operator account bootstrapped from OPERATOR_PASSWORD_HASH");
}

module.exports = {
  createAccount,
  loginByEmail,
  getById,
  getByEmail,
  listAccounts,
  updateAccount,
  bootstrapOperatorAccount,
  hashPassword,
  verifyPassword,
};
