/**
 * Shared store for the Enterprise Layer.
 * All data is namespaced by tenantId — strict isolation enforced here.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/enterprise");

function _ensure(tenantId) {
    const dir = tenantId ? path.join(DATA_DIR, tenantId) : DATA_DIR;
    fs.mkdirSync(dir, { recursive: true });
}

// ── Tenant-isolated load/flush ──────────────────────────────────────
function load(tenantId, key, def = {}) {
    _ensure(tenantId);
    const file = path.join(DATA_DIR, tenantId, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* fresh */ }
    return def instanceof Array ? [] : { ...def };
}

function flush(tenantId, key, data) {
    _ensure(tenantId);
    fs.writeFileSync(path.join(DATA_DIR, tenantId, `${key}.json`), JSON.stringify(data, null, 2));
}

// Global (cross-tenant) store — only for tenant registry itself
function loadGlobal(key, def = {}) {
    _ensure(null);
    const file = path.join(DATA_DIR, `_global_${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* fresh */ }
    return def instanceof Array ? [] : { ...def };
}
function flushGlobal(key, data) {
    _ensure(null);
    fs.writeFileSync(path.join(DATA_DIR, `_global_${key}.json`), JSON.stringify(data, null, 2));
}

function uid(p = "ent") { return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`; }
function NOW()           { return new Date().toISOString(); }

// ── RBAC ─────────────────────────────────────────────────────────────
const ROLE_LEVELS = { viewer: 1, employee: 2, manager: 3, admin: 4, superadmin: 5 };

function hasRole(tenantId, userId, minRole) {
    const members = loadGlobal("members", {});
    const key     = `${tenantId}::${userId}`;
    const member  = members[key];
    if (!member) return false;
    return (ROLE_LEVELS[member.role] || 0) >= (ROLE_LEVELS[minRole] || 99);
}

function getMember(tenantId, userId) {
    const members = loadGlobal("members", {});
    return members[`${tenantId}::${userId}`] || null;
}

function setMember(tenantId, userId, role, meta = {}) {
    const members  = loadGlobal("members", {});
    const key      = `${tenantId}::${userId}`;
    members[key]   = { tenantId, userId, role, ...meta, updatedAt: NOW() };
    flushGlobal("members", members);
    return members[key];
}

// ── Tenant validation ────────────────────────────────────────────────
function getTenant(tenantId) {
    const tenants = loadGlobal("tenants", {});
    return tenants[tenantId] || null;
}

function requireAuth(tenantId, userId, minRole = "employee") {
    if (!tenantId) return { ok: false, error: "tenantId required" };
    if (!userId)   return { ok: false, error: "userId required" };
    const tenant = getTenant(tenantId);
    if (!tenant)   return { ok: false, error: `Tenant "${tenantId}" not found` };
    if (tenant.status !== "active") return { ok: false, error: `Tenant "${tenantId}" is ${tenant.status}` };
    if (!hasRole(tenantId, userId, minRole)) {
        return { ok: false, error: `User "${userId}" lacks role "${minRole}" in tenant "${tenantId}"` };
    }
    return { ok: true, tenant, member: getMember(tenantId, userId) };
}

// ── Audit logging ─────────────────────────────────────────────────────
function auditLog(tenantId, userId, action, details = {}) {
    try {
        const logs = load(tenantId, "audit-log", []);
        logs.push({ id: uid("aud"), tenantId, userId, action, details, timestamp: NOW() });
        flush(tenantId, "audit-log", logs.slice(-10000)); // keep last 10k entries per tenant
    } catch { /* non-critical */ }
}

// ── Metering ──────────────────────────────────────────────────────────
function meter(tenantId, userId, feature, count = 1) {
    try {
        const key   = new Date().toISOString().slice(0, 7); // YYYY-MM
        const usage = load(tenantId, `usage-${key}`, {});
        if (!usage[userId]) usage[userId] = {};
        usage[userId][feature] = (usage[userId][feature] || 0) + count;
        flush(tenantId, `usage-${key}`, usage);
    } catch { /* non-critical */ }
}

// ── Standard response shapes ──────────────────────────────────────────
function ok(agent, data, meta = {}) {
    return { success: true, type: "enterprise", agent, data, ...meta };
}
function fail(agent, error, code = 400) {
    return { success: false, type: "enterprise", agent, error: String(error), code };
}
function forbidden(agent, reason) {
    return { success: false, type: "enterprise", agent, error: reason, code: 403 };
}

module.exports = {
    load, flush, loadGlobal, flushGlobal,
    uid, NOW,
    hasRole, getMember, setMember, getTenant, ROLE_LEVELS,
    requireAuth, auditLog, meter,
    ok, fail, forbidden
};
