"use strict";
/**
 * businessDataService.cjs — Phase B1: Business OS Data Layer
 *
 * JSON-file storage for business entities:
 *   data/biz-leads.json        — leads (full CRM schema)
 *   data/biz-contacts.json     — contacts
 *   data/biz-opportunities.json — sales pipeline deals
 *   data/biz-campaigns.json    — marketing campaigns
 *   data/biz-revenue.json      — revenue records
 *
 * Same pattern as missionMemory.cjs — no new runtime, no new DB.
 * Each entity store is: { version: 1, items: [], updatedAt }
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "../../data");

// OOPLIX V1 MASTER AUDIT (2026-08-16, load-test coverage audit): unlike
// every other JSON-file store already fixed for atomicity this session
// (taskQueue.cjs, missionMemory.cjs, authMiddleware.js's revoked-tokens
// ledger, crmService.js), _writeStore() called fs.writeFileSync() directly
// on the real target file with no atomic tmp+rename step. A live 100-
// concurrent-write test (50 POST /business/leads per tenant, 2 real
// tenants, real HTTP against :5050) was run to check for the lost-update
// race this shape of code invites; all 100 writes were independently
// confirmed to have persisted correctly (verified via `total` and a raised
// query limit — an earlier measurement using the default-paginated GET
// response length looked like data loss but was a read-side pagination
// artifact, not a real gap, and was corrected before concluding anything).
// The write path itself showed no measured defect. This fix is still
// applied as a genuine hardening against the class of risk every sibling
// store in this codebase was already fixed for (a crash or external file
// replacement mid-write, not concurrency) — matching the proven
// per-call-unique-tmp-filename pattern used throughout, no new
// architecture — but is not, itself, closing a live-reproduced defect.

function _uid(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

// ── Generic store I/O ─────────────────────────────────────────────────────────

function _readStore(file) {
    const p = path.join(DATA_DIR, file);
    try {
        if (!fs.existsSync(p)) return { version: 1, items: [] };
        const raw = fs.readFileSync(p, "utf-8").trim();
        const d   = raw ? JSON.parse(raw) : { version: 1, items: [] };
        if (!Array.isArray(d.items)) d.items = [];
        return d;
    } catch { return { version: 1, items: [] }; }
}

function _writeStore(file, store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    store.updatedAt = new Date().toISOString();
    const target = path.join(DATA_DIR, file);
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, target);
}

// ERA-1 Phase 2A (2026-08-28) — orphaned tmp sweep, same pattern already
// applied to missionMemory.cjs and agents/taskQueue.cjs. _writeStore()'s
// per-call-unique tmp filename correctly prevents cross-process collision/
// ENOENT, but a process SIGKILLed between writeFileSync and renameSync
// leaves that one tmp file behind with no code path that ever removes it —
// reproduced live via tests/runtime/10-c10-cross-system-closure.test.cjs's
// "138" block (a real subprocess calling createLead() in a loop, SIGKILLed
// mid-burst; the same commit that closed Mission 63's other blockers left
// this one explicitly UNKNOWN, "no safe fix identified" — this is that fix).
// No correctness impact on any of the 5 biz-*.json stores this file writes
// (renameSync only ever swaps in a COMPLETE file), but unbounded disk growth
// across repeated crash cycles. One regex covers all 5 stores sharing this
// write helper; swept once at module load, with a grace window so a
// genuinely in-flight concurrent write is never touched.
const _TMP_RE = /^biz-[a-z]+\.json\.\d+\.[0-9a-f]+\.tmp$/;
const _TMP_GRACE_MS = 5 * 60 * 1000;

function _sweepOrphanedTmp() {
    try {
        let removed = 0, bytes = 0;
        const now = Date.now();
        for (const name of fs.readdirSync(DATA_DIR)) {
            if (!_TMP_RE.test(name)) continue;
            const full = path.join(DATA_DIR, name);
            try {
                const st = fs.statSync(full);
                if (now - st.mtimeMs < _TMP_GRACE_MS) continue; // possibly an in-flight write
                bytes += st.size;
                fs.unlinkSync(full);
                removed++;
            } catch { /* raced with another sweep or a rename — fine either way */ }
        }
        if (removed) {
            logger.warn(`[BusinessData] Swept ${removed} orphaned tmp file(s) (${Math.round(bytes / 1024)} KB) left by an interrupted write.`);
        }
    } catch { /* directory unreadable — never block startup on cleanup */ }
}

_sweepOrphanedTmp();

// Mission 76 (2026-08-29) — cross-process read-modify-write lock.
//
// Live-reproduced (Micro-Mission 06, 3/3 runs): 10 real child processes each
// calling createLead() once against the same file lost 5-7 of 10 records
// every run, with valid JSON and no corruption throughout. Root cause: the
// atomic tmp+rename write in _writeStore() only protects against a crash
// mid-write (a reader never sees a partial file) — it does nothing to stop
// two processes from both reading the same pre-write snapshot, both
// appending their own record in memory, and the second renameSync() silently
// discarding the first process's addition. This is the identical class of
// gap organizationService.cjs's own _write() comment already documents and
// explicitly deferred as "a larger architectural change out of scope" —
// scoped here to businessDataService.cjs only, per this mission's explicit
// instruction not to touch unrelated services.
//
// Fix: a simple, dependency-free, per-store-file exclusive lock using
// fs.openSync(lockPath, "wx") — "wx" atomically fails with EEXIST if the
// lock file already exists, which is the same cross-platform primitive
// Node's own fs module guarantees, no new dependency needed. Every mutating
// operation (_create/_update/_remove) now acquires this lock BEFORE
// _readStore() and releases it AFTER _writeStore() completes (or on any
// thrown error, via try/finally), so the entire read-modify-write-rename
// transaction is now a single critical section across ALL processes
// sharing the file, not just serialized within one process.
//
// Stale-lock recovery: a lock file older than LOCK_STALE_MS is treated as
// abandoned (the holder crashed/was SIGKILLed before releasing it) and is
// forcibly removed before retrying acquisition — this is the same
// grace-window design already used by _sweepOrphanedTmp() above, applied to
// locks instead of tmp files, so a crashed writer can never cause a
// permanent deadlock for every future caller.
//
// This does not change the on-disk JSON format, the written data shape, or
// any function's public signature/return value — every existing caller
// (business.js, businessOrgWorkflow.cjs, etc.) is unaffected.
const LOCK_STALE_MS   = 10_000; // a real write completes in low single-digit ms; 10s is a generous crash-only threshold
const LOCK_RETRY_MS   = 5;
const LOCK_TIMEOUT_MS = 5_000;  // fail loudly rather than hang forever if something is deeply wrong

function _lockPathFor(file) {
    return path.join(DATA_DIR, `${file}.lock`);
}

function _acquireLock(file) {
    const lockPath = _lockPathFor(file);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, "wx");
            fs.closeSync(fd);
            return lockPath;
        } catch (err) {
            if (err.code !== "EEXIST") throw err;
            try {
                const st = fs.statSync(lockPath);
                if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                    // Abandoned lock (holder crashed before releasing) — remove and retry immediately.
                    try { fs.unlinkSync(lockPath); } catch { /* raced with another releaser/sweeper — fine */ }
                    continue;
                }
            } catch { /* lock vanished between openSync and statSync — another holder just released it, retry */ }
            if (Date.now() > deadline) {
                throw new Error(`businessDataService: timed out waiting for lock on ${file} after ${LOCK_TIMEOUT_MS}ms`);
            }
            // Busy-wait with a short synchronous sleep — this module's entire API is
            // synchronous by design (matches every other store in this file), so a
            // real async wait would require a much larger refactor than this fix
            // is scoped for. LOCK_RETRY_MS is short enough that real contention
            // (a write normally takes low single-digit ms) resolves in 1-2 iterations.
            const until = Date.now() + LOCK_RETRY_MS;
            while (Date.now() < until) { /* spin */ }
        }
    }
}

function _releaseLock(lockPath) {
    try { fs.unlinkSync(lockPath); } catch { /* already gone — fine, matches _sweepOrphanedTmp()'s own tolerance */ }
}

function _withLock(file, fn) {
    const lockPath = _acquireLock(file);
    try {
        return fn();
    } finally {
        _releaseLock(lockPath);
    }
}

// ── Generic CRUD helpers ──────────────────────────────────────────────────────
//
// Org scoping is additive and opt-in, matching secretVault.cjs's approach:
// every record MAY carry an `orgId` field, but nothing before this change
// wrote one, so pre-existing CRM data (leads/contacts/opps/campaigns/revenue
// created before multi-tenancy) has no orgId at all. Passing an `orgId` to
// _create stamps it on new records going forward; passing one to _list/_get/
// _update/_remove scopes the operation to that org's records only. Omitting
// orgId anywhere (the default, and the only thing every existing call site in
// business.js does today) preserves the exact pre-org-scoping behavior:
// every record is visible/writable, regardless of orgId field. This means
// existing single-tenant installs and already-created CRM records are
// completely unaffected; org isolation only activates for callers that
// explicitly pass an orgId.

function _list(file, filterFn, limit = 100, orgId = null) {
    const { items } = _readStore(file);
    let scoped = orgId ? items.filter(i => i.orgId === orgId) : items;
    const filtered = filterFn ? scoped.filter(filterFn) : scoped;
    return { items: filtered.slice(0, limit), total: filtered.length };
}

function _get(file, id, orgId = null) {
    const { items } = _readStore(file);
    const rec = items.find(i => i.id === id) || null;
    if (!rec) return null;
    if (orgId && rec.orgId !== orgId) return null; // exists, but not in this org's scope
    return rec;
}

function _create(file, data, orgId = null) {
    return _withLock(file, () => {
        const store = _readStore(file);
        const record = { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (orgId) record.orgId = orgId;
        store.items.push(record);
        _writeStore(file, store);
        return record;
    });
}

function _update(file, id, patch, orgId = null) {
    return _withLock(file, () => {
        const store = _readStore(file);
        const idx   = store.items.findIndex(i => i.id === id);
        if (idx === -1) throw new Error(`Not found: ${id}`);
        if (orgId && store.items[idx].orgId !== orgId) throw Object.assign(new Error(`Not found: ${id}`), { status: 404 });
        store.items[idx] = { ...store.items[idx], ...patch, updatedAt: new Date().toISOString() };
        _writeStore(file, store);
        return store.items[idx];
    });
}

function _remove(file, id, orgId = null) {
    return _withLock(file, () => {
        const store = _readStore(file);
        const target = store.items.find(i => i.id === id);
        if (!target) throw new Error(`Not found: ${id}`);
        if (orgId && target.orgId !== orgId) throw Object.assign(new Error(`Not found: ${id}`), { status: 404 });
        store.items = store.items.filter(i => i.id !== id);
        _writeStore(file, store);
        return { deleted: true, id };
    });
}

// ── Files ─────────────────────────────────────────────────────────────────────
//
// Mission 69: same JARVIS_TEST_DATA_SUFFIX convention already used by
// agentInstanceRegistry.cjs/skillRegistry.cjs/repositoryEditingEngine.cjs/
// toolExecutionLayer.cjs — unset (all real server/dev/production usage)
// means zero behavior change; a test process that sets it gets its own
// isolated biz-*.<suffix>.json files instead of the real shared ones.
//
// Root cause this closes: businessOrgWorkflow.cjs's subscribeWorkflowEvents()
// wires a real event cascade (COO plan -> Marketing campaign -> ... ->
// Analytics report -> BI scan) that, once triggered, calls
// businessIntelligenceEngine.cjs's scan() with no orgId — the correct,
// documented behavior for a background/internal caller that intentionally
// scans across all orgs (see businessIntelligenceEngine.cjs's own comment
// above its scan* functions). orgId scoping cannot fix this: it scopes
// tenants within ONE shared store, it does not give a test process its own
// separate store, and both the test's own fixtures and the real production
// leads/deals alike have no orgId. businessOrgState.cjs (a separate module,
// separate data family — see its own DIR constant) had the identical gap,
// fixed the same way in the same mission. Neither file had any isolation
// mechanism before this, so a BI scan triggered mid-test read the real,
// large, shared data/biz-leads.json and created real missions from it,
// which is what caused tests/runtime/business-org-v3.test.cjs to
// intermittently hang.
const F_LEADS    = process.env.JARVIS_TEST_DATA_SUFFIX ? `biz-leads.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`         : "biz-leads.json";
const F_CONTACTS = process.env.JARVIS_TEST_DATA_SUFFIX ? `biz-contacts.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`     : "biz-contacts.json";
const F_OPPS     = process.env.JARVIS_TEST_DATA_SUFFIX ? `biz-opportunities.${process.env.JARVIS_TEST_DATA_SUFFIX}.json` : "biz-opportunities.json";
const F_CAMPS    = process.env.JARVIS_TEST_DATA_SUFFIX ? `biz-campaigns.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`    : "biz-campaigns.json";
const F_REV      = process.env.JARVIS_TEST_DATA_SUFFIX ? `biz-revenue.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`     : "biz-revenue.json";

// ── LEADS ─────────────────────────────────────────────────────────────────────

const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "disqualified", "converted"]);

function listLeads({ status, source, assignee, minScore, limit = 50, orgId } = {}) {
    return _list(F_LEADS, l => {
        if (status && l.status !== status) return false;
        if (source && l.source !== source) return false;
        if (assignee && l.assignee !== assignee) return false;
        if (minScore && (l.score || 0) < Number(minScore)) return false;
        return true;
    }, limit, orgId || null);
}

function getLead(id, orgId = null) {
    return _get(F_LEADS, id, orgId);
}

function createLead({ name, email, phone, company, source, score, assignee, tags, notes, orgId } = {}) {
    if (!name && !email && !phone) throw new Error("name, email, or phone required");
    const lead = {
        id:         _uid("lead"),
        name:       name || null,
        email:      email || null,
        phone:      phone || null,
        company:    company || null,
        source:     source || "manual",
        score:      score || 0,
        status:     "new",
        assignee:   assignee || null,
        tags:       tags || [],
        notes:      notes || null,
        missionId:  null,
    };
    return _create(F_LEADS, lead, orgId || null);
}

function updateLead(id, patch, orgId = null) {
    if (patch.status && !LEAD_STATUSES.has(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
    return _update(F_LEADS, id, patch, orgId);
}

function qualifyLead(id, opts = {}, orgId = null) {
    return _update(F_LEADS, id, { status: "qualified", qualifiedAt: new Date().toISOString(), ...opts }, orgId);
}

function disqualifyLead(id, reason = "", orgId = null) {
    return _update(F_LEADS, id, { status: "disqualified", disqualifyReason: reason, disqualifiedAt: new Date().toISOString() }, orgId);
}

function deleteLead(id, orgId = null) {
    return _remove(F_LEADS, id, orgId);
}

// ── CONTACTS ──────────────────────────────────────────────────────────────────

function listContacts({ company, search, limit = 50, orgId } = {}) {
    const q = search?.toLowerCase();
    return _list(F_CONTACTS, c => {
        if (company && c.company !== company) return false;
        if (q && !`${c.name} ${c.email} ${c.company}`.toLowerCase().includes(q)) return false;
        return true;
    }, limit, orgId || null);
}

function getContact(id, orgId = null) { return _get(F_CONTACTS, id, orgId); }

function createContact({ name, email, phone, company, title, tags, notes, leadId, orgId } = {}) {
    if (!name && !email) throw new Error("name or email required");
    const contact = {
        id:      _uid("cnt"),
        name:    name || null,
        email:   email || null,
        phone:   phone || null,
        company: company || null,
        title:   title || null,
        tags:    tags || [],
        notes:   notes || null,
        leadId:  leadId || null,
    };
    return _create(F_CONTACTS, contact, orgId || null);
}

function updateContact(id, patch, orgId = null) { return _update(F_CONTACTS, id, patch, orgId); }
function deleteContact(id, orgId = null)        { return _remove(F_CONTACTS, id, orgId); }

// ── OPPORTUNITIES ─────────────────────────────────────────────────────────────

const OPP_STAGES = ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"];

function listOpportunities({ stage, assignee, minValue, limit = 50, orgId } = {}) {
    return _list(F_OPPS, o => {
        if (stage && o.stage !== stage) return false;
        if (assignee && o.assignee !== assignee) return false;
        if (minValue && (o.value || 0) < Number(minValue)) return false;
        return true;
    }, limit, orgId || null);
}

function getOpportunity(id, orgId = null) { return _get(F_OPPS, id, orgId); }

function createOpportunity({ title, value, currency, stage, contactId, leadId, company, assignee, campaignId, tags, notes, orgId } = {}) {
    if (!title) throw new Error("title required");
    const opp = {
        id:         _uid("opp"),
        title,
        value:      value || 0,
        currency:   currency || "USD",
        stage:      stage || "prospect",
        contactId:  contactId || null,
        leadId:     leadId || null,
        company:    company || null,
        assignee:   assignee || null,
        campaignId: campaignId || null,
        tags:       tags || [],
        notes:      notes || null,
        missionId:  null,
        history:    [],
    };
    return _create(F_OPPS, opp, orgId || null);
}

function updateOpportunity(id, patch, orgId = null) { return _update(F_OPPS, id, patch, orgId); }

function advanceStage(id, stage, orgId = null) {
    if (!OPP_STAGES.includes(stage)) throw new Error(`Invalid stage: ${stage}. Must be one of: ${OPP_STAGES.join(", ")}`);
    const opp = _get(F_OPPS, id, orgId);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: stage, at: new Date().toISOString() };
    return _update(F_OPPS, id, { stage, history: [...(opp.history || []), entry] }, orgId);
}

function closeWon(id, opts = {}, orgId = null) {
    const opp = _get(F_OPPS, id, orgId);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: "closed-won", at: new Date().toISOString(), ...opts };
    const updated = _update(F_OPPS, id, { stage: "closed-won", closedAt: new Date().toISOString(), closedWonAt: new Date().toISOString(), history: [...(opp.history || []), entry] }, orgId);

    // Sales OS: closing a deal won recorded the stage change but never produced
    // revenue. Reproduced live — pipeline showed closed-won 1 / $72,000 while
    // GET /business/revenue returned {revenue: [], total: 0} and revenue/stats
    // reported count 0. The two views disagreed about the same closed deal.
    //
    // recordRevenue() already exists, is already exported, and already accepts
    // an `oppId` — the link was simply never made. No new ledger is introduced.
    // Guarded so a revenue failure can never roll back or mask a successful
    // close, and skipped when the deal has no value or was already recorded
    // (close-won is idempotent in the stage machine, so it must be here too).
    try {
        const amount = Number(opts.amount ?? updated.value ?? opp.value);
        if (amount && !isNaN(amount)) {
            // listRevenue returns { items, total } — NOT a bare array. A first
            // version of this guard checked `.length` on that object, which is
            // always undefined, so re-closing a won deal silently doubled the
            // revenue ($55,000 -> $110,000, reproduced live).
            const already = (listRevenue({ oppId: id, orgId, limit: 1 }).items || []).length > 0;
            if (!already) {
                recordRevenue({
                    amount,
                    currency:    opts.currency || updated.currency || "USD",
                    type:        opts.revenueType || "one-time",
                    source:      "opportunity-close-won",
                    description: `Closed won: ${updated.title || updated.name || id}`,
                    contactId:   updated.contactId || null,
                    oppId:       id,
                    orgId,
                });
            }
        }
    } catch {
        // Never let a revenue-write failure roll back or mask a successful
        // close. This module has no logger import, so the failure is contained
        // rather than reported here — the missing revenue row is itself visible
        // via GET /business/revenue, which is the check that found this bug.
    }

    return updated;
}

function closeLost(id, reason = "", orgId = null) {
    const opp = _get(F_OPPS, id, orgId);
    if (!opp) throw new Error(`Opportunity not found: ${id}`);
    const entry = { from: opp.stage, to: "closed-lost", at: new Date().toISOString(), reason };
    return _update(F_OPPS, id, { stage: "closed-lost", closedAt: new Date().toISOString(), lostReason: reason, history: [...(opp.history || []), entry] }, orgId);
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────

function listCampaigns({ status, channel, limit = 20, orgId } = {}) {
    return _list(F_CAMPS, c => {
        if (status && c.status !== status) return false;
        if (channel && c.channel !== channel) return false;
        return true;
    }, limit, orgId || null);
}

function getCampaign(id, orgId = null) { return _get(F_CAMPS, id, orgId); }

function createCampaign({ name, channel, budget, startDate, endDate, goals, tags, notes, orgId } = {}) {
    if (!name) throw new Error("name required");
    const camp = {
        id:        _uid("camp"),
        name,
        channel:   channel || "email",
        budget:    budget || 0,
        startDate: startDate || null,
        endDate:   endDate || null,
        goals:     goals || [],
        tags:      tags || [],
        notes:     notes || null,
        status:    "active",
        events:    [],
        metrics:   { impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
    };
    return _create(F_CAMPS, camp, orgId || null);
}

function updateCampaign(id, patch, orgId = null) { return _update(F_CAMPS, id, patch, orgId); }

function recordCampaignEvent(id, { type, value = 1 } = {}, orgId = null) {
    const camp = _get(F_CAMPS, id, orgId);
    if (!camp) throw new Error(`Campaign not found: ${id}`);
    const event = { type, value, at: new Date().toISOString() };
    const metrics = { ...camp.metrics };
    if (type === "impression")  metrics.impressions  = (metrics.impressions  || 0) + value;
    if (type === "click")       metrics.clicks       = (metrics.clicks       || 0) + value;
    if (type === "conversion")  metrics.conversions  = (metrics.conversions  || 0) + value;
    if (type === "revenue")     metrics.revenue      = (metrics.revenue      || 0) + value;
    return _update(F_CAMPS, id, { events: [...(camp.events || []), event], metrics }, orgId);
}

function completeCampaign(id, opts = {}, orgId = null) {
    return _update(F_CAMPS, id, { status: "completed", completedAt: new Date().toISOString(), ...opts }, orgId);
}

// ── REVENUE ───────────────────────────────────────────────────────────────────

function listRevenue({ type, dateFrom, dateTo, oppId, limit = 50, orgId } = {}) {
    return _list(F_REV, r => {
        if (type && r.type !== type) return false;
        if (oppId && r.oppId !== oppId) return false;
        if (dateFrom && new Date(r.recordedAt) < new Date(dateFrom)) return false;
        if (dateTo && new Date(r.recordedAt) > new Date(dateTo)) return false;
        return true;
    }, limit, orgId || null);
}

function recordRevenue({ amount, currency, type, source, description, contactId, oppId, campaignId, recordedAt, orgId } = {}) {
    if (!amount || isNaN(amount)) throw new Error("amount (number) required");
    const rev = {
        id:          _uid("rev"),
        amount:      Number(amount),
        currency:    currency || "USD",
        type:        type || "one-time",
        source:      source || "manual",
        description: description || null,
        contactId:   contactId || null,
        oppId:       oppId || null,
        campaignId:  campaignId || null,
        recordedAt:  recordedAt || new Date().toISOString(),
    };
    return _create(F_REV, rev, orgId || null);
}

function getRevenueStats({ dateFrom, dateTo, currency, orgId } = {}) {
    const all = listRevenue({ dateFrom, dateTo, limit: 10000, orgId }).items;
    const cur = currency || "USD";
    const inCurrency = all.filter(r => !currency || r.currency === cur);
    const total      = inCurrency.reduce((s, r) => s + r.amount, 0);
    const byType     = {};
    const bySource   = {};
    const byMonth    = {};
    for (const r of inCurrency) {
        byType[r.type]     = (byType[r.type]   || 0) + r.amount;
        bySource[r.source] = (bySource[r.source] || 0) + r.amount;
        const mo = (r.recordedAt || "").slice(0, 7);
        byMonth[mo] = (byMonth[mo] || 0) + r.amount;
    }
    return { total, currency: cur, count: inCurrency.length, byType, bySource, byMonth };
}

// ── Dashboard aggregate ───────────────────────────────────────────────────────

// A.6 business-owner-journey finding: getDashboard() only ever counted
// leads from this file's own biz-leads.json store. The CRM UI a founder
// actually uses (ContactsV2.jsx → POST /crm/lead) writes to a completely
// separate store — crmService.js's data/leads.json — so a real lead added
// through the CRM never appeared in Reports/Executive Dashboard leads
// counts, confirmed live: added one real contact via Contacts → still
// showed "TOTAL LEADS: 0" while the same page's Pipeline Breakdown
// (a different, correctly-wired widget) showed "Hot: 1". Two independent
// lead stores already exist in this codebase; recovering crmService's own
// real getStats(orgId) here — additive, merged into the existing leads
// aggregate — is the minimal fix, not a data-model merge or new storage.
function _crmLeadStats(orgId) {
    try {
        const crm = require("./crmService.js");
        return crm.getStats(orgId);
    } catch { return { total: 0, new: 0, hot: 0 }; }
}

function getDashboard(orgId = null) {
    const leads = listLeads({ limit: 1000, orgId });
    const opps  = listOpportunities({ limit: 1000, orgId });
    const camps = listCampaigns({ limit: 100, orgId });
    const rev   = listRevenue({ limit: 1000, orgId });
    const crmLeads = _crmLeadStats(orgId);

    const totalRevenue    = rev.items.reduce((s, r) => s + r.amount, 0);
    const openOpps        = opps.items.filter(o => !["closed-won", "closed-lost"].includes(o.stage));
    const pipelineValue   = openOpps.reduce((s, o) => s + (o.value || 0), 0);
    const wonThisMonth    = opps.items.filter(o => o.stage === "closed-won" && (o.closedAt || "").startsWith(new Date().toISOString().slice(0, 7)));

    return {
        leads: {
            total:     leads.total + crmLeads.total,
            new:       leads.items.filter(l => l.status === "new").length + crmLeads.new,
            qualified: leads.items.filter(l => l.status === "qualified").length + (crmLeads.hot || 0),
        },
        opportunities: { total: opps.total, open: openOpps.length, pipelineValue, wonThisMonth: wonThisMonth.length },
        campaigns:     { total: camps.total, active: camps.items.filter(c => c.status === "active").length },
        revenue:       { total: totalRevenue + (crmLeads.revenue || 0), count: rev.total },
    };
}

function getPipelineSummary(orgId = null) {
    const opps = listOpportunities({ limit: 1000, orgId });
    const summary = {};
    for (const stage of ["prospect", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"]) {
        const stageOpps = opps.items.filter(o => o.stage === stage);
        summary[stage] = { count: stageOpps.length, value: stageOpps.reduce((s, o) => s + (o.value || 0), 0) };
    }
    return summary;
}

function getDailySummary(orgId = null) {
    const today = new Date().toISOString().slice(0, 10);
    const leads = listLeads({ limit: 1000, orgId }).items.filter(l => (l.createdAt || "").startsWith(today));
    const rev   = listRevenue({ dateFrom: today + "T00:00:00Z", limit: 1000, orgId });
    return {
        date:        today,
        newLeads:    leads.length,
        revenue:     rev.items.reduce((s, r) => s + r.amount, 0),
    };
}

function getWeeklySummary(orgId = null) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const leads   = listLeads({ limit: 1000, orgId }).items.filter(l => (l.createdAt || "") >= weekAgo);
    const won     = listOpportunities({ limit: 1000, orgId }).items.filter(o => o.stage === "closed-won" && (o.closedAt || "") >= weekAgo);
    const rev     = listRevenue({ dateFrom: weekAgo, limit: 1000, orgId });
    return {
        weekStart:    weekAgo.slice(0, 10),
        newLeads:     leads.length,
        dealsWon:     won.length,
        revenue:      rev.items.reduce((s, r) => s + r.amount, 0),
    };
}

function globalSearch(q, limit = 20, orgId = null) {
    const ql = (q || "").toLowerCase();
    if (!ql) return { results: [] };
    const hits = [];
    const push = (type, item, label) => hits.push({ type, id: item.id, label, createdAt: item.createdAt });

    for (const l of listLeads({ limit: 500, orgId }).items) {
        if (`${l.name} ${l.email} ${l.phone} ${l.company}`.toLowerCase().includes(ql)) push("lead", l, l.name || l.email);
    }
    for (const c of listContacts({ limit: 500, orgId }).items) {
        if (`${c.name} ${c.email} ${c.company}`.toLowerCase().includes(ql)) push("contact", c, c.name || c.email);
    }
    for (const o of listOpportunities({ limit: 500, orgId }).items) {
        if (`${o.title} ${o.company}`.toLowerCase().includes(ql)) push("opportunity", o, o.title);
    }
    for (const c of listCampaigns({ limit: 100, orgId }).items) {
        if (`${c.name} ${c.channel}`.toLowerCase().includes(ql)) push("campaign", c, c.name);
    }

    return { results: hits.slice(0, limit), total: hits.length };
}

module.exports = {
    // Leads
    listLeads, getLead, createLead, updateLead, qualifyLead, disqualifyLead, deleteLead,
    // Contacts
    listContacts, getContact, createContact, updateContact, deleteContact,
    // Opportunities
    listOpportunities, getOpportunity, createOpportunity, updateOpportunity, advanceStage, closeWon, closeLost,
    // Campaigns
    listCampaigns, getCampaign, createCampaign, updateCampaign, recordCampaignEvent, completeCampaign,
    // Revenue
    listRevenue, recordRevenue, getRevenueStats,
    // Aggregates
    getDashboard, getPipelineSummary, getDailySummary, getWeeklySummary, globalSearch,
};
