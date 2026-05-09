"use strict";
const crypto = require("crypto");
const { load, flush, loadGlobal, flushGlobal, uid, NOW, govAudit, ok, fail, blocked, GOV_DISCLAIMER } = require("./_governanceStore.cjs");
const AGENT = "auditTrailGenerator";

const AUDIT_CATEGORIES = {
    financial:   { name:"Financial",    retentionYears: 7,  sensitivity:"HIGH" },
    legal:       { name:"Legal",        retentionYears: 10, sensitivity:"HIGH" },
    operational: { name:"Operational",  retentionYears: 5,  sensitivity:"MEDIUM" },
    security:    { name:"Security",     retentionYears: 3,  sensitivity:"HIGH" },
    governance:  { name:"Governance",   retentionYears: 7,  sensitivity:"HIGH" },
    hr:          { name:"HR/Personnel", retentionYears: 7,  sensitivity:"HIGH" },
    compliance:  { name:"Compliance",   retentionYears: 10, sensitivity:"HIGH" }
};

const EXPORT_FORMATS = ["json", "csv", "pdf_manifest"];

function _hashEntry(entry) {
    return crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

function _buildChain(entries) {
    let prevHash = "GENESIS";
    return entries.map(e => {
        const node = { ...e, prevHash };
        node.entryHash = _hashEntry(node);
        prevHash = node.entryHash;
        return node;
    });
}

function recordAuditEvent({ userId, organizationId, category, action, actor, affectedEntity, details = {}, severity = "INFO" }) {
    if (!userId || !category || !action || !actor) {
        return fail(AGENT, "userId, category, action, and actor required");
    }
    if (!AUDIT_CATEGORIES[category]) {
        return fail(AGENT, `Unknown category. Valid: ${Object.keys(AUDIT_CATEGORIES).join(", ")}`);
    }

    const trailKey = organizationId ? `org_${organizationId}` : `user_${userId}`;
    const trail    = loadGlobal(`audit_trail_${trailKey}`, []);

    const entry = {
        id:             uid("aud"),
        timestamp:      NOW(),
        category,
        action,
        actor,
        affectedEntity: affectedEntity || null,
        details,
        severity,
        retention:      AUDIT_CATEGORIES[category].retentionYears,
        immutable:      true
    };

    trail.push(entry);
    flushGlobal(`audit_trail_${trailKey}`, trail);

    govAudit(AGENT, userId, "audit_event_recorded", { id: entry.id, category, action, actor }, severity);

    return ok(AGENT, { id: entry.id, recorded: true, category, action, timestamp: entry.timestamp, retentionYears: entry.retention });
}

function queryAuditTrail({ userId, organizationId, category, actor, fromDate, toDate, limit = 100 }) {
    if (!userId) return fail(AGENT, "userId required");

    const trailKey = organizationId ? `org_${organizationId}` : `user_${userId}`;
    let trail      = loadGlobal(`audit_trail_${trailKey}`, []);

    if (category)  trail = trail.filter(e => e.category === category);
    if (actor)     trail = trail.filter(e => e.actor === actor);
    if (fromDate)  trail = trail.filter(e => new Date(e.timestamp) >= new Date(fromDate));
    if (toDate)    trail = trail.filter(e => new Date(e.timestamp) <= new Date(toDate));

    const results = trail.slice(-limit).reverse();
    govAudit(AGENT, userId, "audit_trail_queried", { trailKey, resultCount: results.length }, "INFO");

    return ok(AGENT, { total: trail.length, returned: results.length, entries: results });
}

function verifyAuditIntegrity({ userId, organizationId }) {
    if (!userId) return fail(AGENT, "userId required");

    const trailKey = organizationId ? `org_${organizationId}` : `user_${userId}`;
    const trail    = loadGlobal(`audit_trail_${trailKey}`, []);
    if (!trail.length) return ok(AGENT, { verified: true, totalEntries: 0, note: "Empty trail — nothing to verify" });

    const chained  = _buildChain(trail);
    const tampered = [];

    for (let i = 0; i < chained.length; i++) {
        const expected = _hashEntry({ ...trail[i], prevHash: chained[i].prevHash });
        if (expected !== chained[i].entryHash) tampered.push(trail[i].id);
    }

    govAudit(AGENT, userId, "integrity_check", { trailKey, totalEntries: trail.length, tamperedCount: tampered.length }, tampered.length ? "CRITICAL" : "INFO");

    if (tampered.length) {
        return blocked(AGENT, `Audit trail integrity VIOLATION — ${tampered.length} tampered entries detected: ${tampered.join(", ")}`, "CRITICAL");
    }

    return ok(AGENT, { verified: true, totalEntries: trail.length, integrityHash: chained[chained.length - 1].entryHash, checkedAt: NOW() });
}

function exportAuditTrail({ userId, organizationId, format = "json", fromDate, toDate }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!EXPORT_FORMATS.includes(format)) return fail(AGENT, `Unsupported format. Valid: ${EXPORT_FORMATS.join(", ")}`);

    const trailKey = organizationId ? `org_${organizationId}` : `user_${userId}`;
    let   trail    = loadGlobal(`audit_trail_${trailKey}`, []);

    if (fromDate) trail = trail.filter(e => new Date(e.timestamp) >= new Date(fromDate));
    if (toDate)   trail = trail.filter(e => new Date(e.timestamp) <= new Date(toDate));

    govAudit(AGENT, userId, "audit_exported", { trailKey, format, count: trail.length }, "HIGH");

    if (format === "csv") {
        const header = "id,timestamp,category,action,actor,severity,affectedEntity";
        const rows   = trail.map(e => [e.id, e.timestamp, e.category, e.action, e.actor, e.severity, e.affectedEntity || ""].join(","));
        return ok(AGENT, { format:"csv", rows: trail.length, content: [header, ...rows].join("\n") });
    }

    return ok(AGENT, {
        format,
        rows:      trail.length,
        exportedAt: NOW(),
        disclaimer: GOV_DISCLAIMER,
        data:      trail
    });
}

module.exports = { recordAuditEvent, queryAuditTrail, verifyAuditIntegrity, exportAuditTrail };
