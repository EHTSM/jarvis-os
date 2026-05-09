/**
 * Audit Logger Pro — immutable, tenant-isolated audit trail for all enterprise actions.
 */

const { load, flush, requireAuth, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };

const ACTION_SEVERITY = {
    login:            "low",     logout:           "low",
    view_data:        "low",     export_data:      "medium",
    create_record:    "low",     update_record:    "medium",
    delete_record:    "high",    bulk_delete:      "critical",
    role_assigned:    "high",    role_revoked:     "high",
    billing_changed:  "high",    tenant_suspended: "critical",
    data_export:      "high",    api_key_created:  "high",
    permission_denied:"medium",  login_failed:     "medium"
};

function log(tenantId, userId, action, details = {}, ip = "") {
    const severity = ACTION_SEVERITY[action] || "low";
    const entry    = {
        id:        uid("aud"),
        tenantId,
        userId,
        action,
        severity,
        severityLevel: SEVERITY[severity] || 1,
        details,
        ip:        ip || "internal",
        timestamp: NOW()
    };

    const logs = load(tenantId, "audit-log", []);
    logs.push(entry);
    flush(tenantId, "audit-log", logs.slice(-10000));

    // Mirror critical events to global alert log
    if (severity === "critical") {
        const { loadGlobal, flushGlobal } = require("./_enterpriseStore.cjs");
        const alerts = loadGlobal("critical-alerts", []);
        alerts.push(entry);
        flushGlobal("critical-alerts", alerts.slice(-1000));
    }

    return entry;
}

function queryLogs({ tenantId, requesterId, action, userId: filterUser, severity: filterSeverity, since, limit = 100 }) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("auditLoggerPro", auth.error);

    let logs = load(tenantId, "audit-log", []);

    if (filterUser)     logs = logs.filter(l => l.userId === filterUser);
    if (action)         logs = logs.filter(l => l.action === action);
    if (filterSeverity) logs = logs.filter(l => l.severity === filterSeverity);
    if (since)          logs = logs.filter(l => new Date(l.timestamp) >= new Date(since));

    return {
        tenantId,
        logs:  logs.slice(-limit).reverse(), // most recent first
        total: logs.length,
        filters: { action, filterUser, filterSeverity, since }
    };
}

function getSecurityAlerts(tenantId, requesterId, days = 7) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("auditLoggerPro", auth.error);

    const since = Date.now() - days * 86_400_000;
    const logs  = load(tenantId, "audit-log", []).filter(l =>
        new Date(l.timestamp).getTime() >= since && l.severityLevel >= 3
    );

    return {
        tenantId,
        period:    `${days} days`,
        highAlerts: logs.filter(l => l.severity === "high").length,
        critical:   logs.filter(l => l.severity === "critical").length,
        events:     logs.slice(-50)
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "query_logs")       data = queryLogs(p);
        else if (task.type === "security_alerts") data = getSecurityAlerts(p.tenantId, p.userId, p.days || 7);
        else {
            data = log(p.tenantId, p.userId, p.action || "manual_log", p.details || {}, p.ip);
        }
        if (data?.code === 403) return data;
        return ok("auditLoggerPro", data);
    } catch (err) { return fail("auditLoggerPro", err.message); }
}

module.exports = { log, queryLogs, getSecurityAlerts, ACTION_SEVERITY, run };
