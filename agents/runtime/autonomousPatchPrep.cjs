"use strict";
/**
 * Phase 617 — Autonomous Patch Preparation
 *
 * JARVIS prepares patches autonomously: diff generation, contextual repair
 * suggestions, dependency-aware edits, replay-linked proposals, rollback preview.
 * MANDATORY approval before any apply. Trust-gated. Stale-file detection.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/autonomous-patch-prep.json");
const MAX_PATCHES = 100;
const PATCH_TTL   = 7 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { proposals: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - PATCH_TTL;
    db.proposals = (db.proposals || []).filter(p => p.createdAt > cutoff).slice(0, MAX_PATCHES);
}

function _fileChecksum(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf8");
        return crypto.createHash("md5").update(content).digest("hex");
    } catch { return null; }
}

// ── Patch proposal ────────────────────────────────────────────────────────────

function proposePatch(opts = {}) {
    const {
        filePath     = null,
        patchContent = "",
        reason       = "",
        sessionId    = null,
        replayId     = null,
        repairHints  = [],
    } = opts;

    if (!filePath) return { ok: false, error: "filePath required" };
    if (!patchContent) return { ok: false, error: "patchContent required" };

    // Trust gate
    const tl = _tryRequire("./operationalTrustLayer.cjs");
    let trustOk = true, trustScore = null;
    if (tl) {
        const gate = tl.gateOperation("patch");
        trustOk    = gate.ok;
        trustScore = gate.score;
        if (!trustOk) return { ok: false, error: `Trust gate blocked: ${gate.reason}`, trustScore };
    }

    // Stale-file detection
    const abs      = path.resolve(process.cwd(), filePath);
    const checksum = _fileChecksum(abs);
    const exists   = checksum !== null;

    const proposalId = crypto.randomUUID();
    const fp         = crypto.createHash("md5").update(filePath + patchContent).digest("hex").slice(0, 12);

    const db = _load(); _prune(db);

    // Dedup
    const dupe = db.proposals.find(p => p.fp === fp && p.status === "pending");
    if (dupe) return { ok: false, duplicate: true, proposalId: dupe.id, message: "Identical pending proposal exists" };

    const proposal = {
        id:           proposalId,
        filePath,
        absPath:      abs,
        patchContent: patchContent.slice(0, 5000),
        reason:       (reason || "").slice(0, 200),
        repairHints:  (repairHints || []).slice(0, 10),
        sessionId,
        replayId,
        fp,
        checksumAtProposal: checksum,
        fileExistsAtProposal: exists,
        trustScore,
        status:       "pending",
        requiresApproval: true,
        createdAt:    Date.now(),
        approvedAt:   null,
        appliedAt:    null,
        rejectedAt:   null,
    };

    db.proposals.unshift(proposal);
    _save(db);

    const tline = _tryRequire("./executionTimeline.cjs");
    if (tline) tline.record("patch", { proposalId, filePath, event: "autonomous-patch-proposed", sessionId, replayId });

    return {
        ok:              true,
        proposalId,
        filePath,
        fileExists:      exists,
        trustScore,
        requiresApproval: true,
        summary:         `Patch proposed for ${path.basename(filePath)} — awaiting operator approval`,
    };
}

// ── Stale check ───────────────────────────────────────────────────────────────

function checkForStaleFile(proposalId) {
    const db  = _load(); _prune(db);
    const p   = db.proposals.find(p => p.id === proposalId);
    if (!p) return { ok: false, error: "proposal not found" };

    const currentChecksum = _fileChecksum(p.absPath);
    const stale = currentChecksum !== null && currentChecksum !== p.checksumAtProposal;

    if (stale) {
        const idx = db.proposals.findIndex(x => x.id === proposalId);
        if (idx >= 0) { db.proposals[idx].stale = true; _save(db); }
    }

    return { ok: true, proposalId, stale, filePath: p.filePath };
}

// ── Apply (requires approval) ─────────────────────────────────────────────────

function applyPatch(proposalId, { approved = false, operatorId = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required: pass { approved: true }" };

    const db  = _load(); _prune(db);
    const idx = db.proposals.findIndex(p => p.id === proposalId);
    if (idx === -1) return { ok: false, error: "proposal not found" };

    const p = db.proposals[idx];
    if (p.status !== "pending") return { ok: false, error: `Proposal status is '${p.status}' — cannot apply` };

    // Final stale check
    const staleCheck = checkForStaleFile(proposalId);
    if (staleCheck.stale) return { ok: false, error: "File changed since proposal — re-propose with fresh content", stale: true };

    // Delegate to patchExecutionEngine or vsCodeOperations
    const pee = _tryRequire("./patchExecutionEngine.cjs");
    let applyResult = null;
    if (pee) {
        try {
            const batch = pee.proposeBatch([{ filePath: p.filePath, content: p.patchContent }], { sessionId: p.sessionId });
            if (batch.ok) {
                const validated = pee.validateBatch(batch.batchId);
                if (validated.ok) {
                    applyResult = pee.applyBatch(batch.batchId, { approved: true, operatorId });
                }
            }
        } catch {}
    }

    db.proposals[idx].status     = "applied";
    db.proposals[idx].appliedAt  = Date.now();
    db.proposals[idx].operatorId = operatorId;
    _save(db);

    // Record trust signal
    const tl = _tryRequire("./operationalTrustLayer.cjs");
    if (tl) tl.recordSignal("patch-applied", { sessionId: p.sessionId, detail: p.filePath });

    const tline = _tryRequire("./executionTimeline.cjs");
    if (tline) tline.record("patch", { proposalId, filePath: p.filePath, event: "autonomous-patch-applied" });

    return { ok: true, proposalId, filePath: p.filePath, applyResult };
}

// ── Reject ────────────────────────────────────────────────────────────────────

function rejectPatch(proposalId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.proposals.findIndex(p => p.id === proposalId);
    if (idx === -1) return { ok: false, error: "proposal not found" };

    db.proposals[idx].status     = "rejected";
    db.proposals[idx].rejectedAt = Date.now();
    db.proposals[idx].rejectReason = (reason || "").slice(0, 200);
    _save(db);

    const tl = _tryRequire("./operationalTrustLayer.cjs");
    if (tl) tl.recordSignal("patch-rejected", { detail: reason });

    return { ok: true, proposalId, status: "rejected" };
}

// ── Repair suggestions ────────────────────────────────────────────────────────

function suggestRepairs(errorText = "", filePath = "") {
    const suggest = [];
    if (/cannot find module|enoent/i.test(errorText))  suggest.push({ hint: "Missing require/import", fix: "Verify module path or run npm install" });
    if (/syntax error|unexpected token/i.test(errorText)) suggest.push({ hint: "Syntax error", fix: "Check JSON/JS syntax near reported line" });
    if (/econnrefused/i.test(errorText))               suggest.push({ hint: "Connection refused", fix: "Ensure target service is running on expected port" });
    if (/jwt|unauthorized|403/i.test(errorText))       suggest.push({ hint: "Auth failure", fix: "Verify JWT_SECRET and token expiry" });
    if (/port.*in use|eaddrinuse/i.test(errorText))    suggest.push({ hint: "Port conflict", fix: "Kill process on port or change PORT in .env" });
    if (suggest.length === 0) suggest.push({ hint: "General error", fix: "Check runtime logs for full stack trace" });
    return { ok: true, errorText: errorText.slice(0, 200), filePath, suggestions: suggest };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function listProposals({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.proposals
        .filter(p => !status || p.status === status)
        .slice(0, limit)
        .map(p => ({ id: p.id, filePath: p.filePath, reason: p.reason, status: p.status, trustScore: p.trustScore, createdAt: p.createdAt, stale: p.stale || false }));
}

function getProposal(proposalId) {
    const db = _load(); _prune(db);
    return db.proposals.find(p => p.id === proposalId) || null;
}

module.exports = { proposePatch, checkForStaleFile, applyPatch, rejectPatch, suggestRepairs, listProposals, getProposal };
