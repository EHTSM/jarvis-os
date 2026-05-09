/**
 * Tenant Security Agent — enforces cross-tenant isolation and detects anomalies.
 */

const { load, loadGlobal, requireAuth, auditLog, uid, NOW, ok, fail, forbidden } = require("./_enterpriseStore.cjs");

const THREAT_PATTERNS = [
    { id: "cross_tenant_probe",  pattern: "userId attempting access to multiple tenants rapidly", severity: "critical" },
    { id: "brute_force",         pattern: "5+ failed auth attempts in 10 minutes",                severity: "high"     },
    { id: "excessive_export",    pattern: "data export > 10MB in 1 hour",                        severity: "high"     },
    { id: "unusual_hours",       pattern: "admin access outside business hours",                  severity: "medium"   },
    { id: "bulk_delete",         pattern: "delete operations on > 20 records",                   severity: "critical" }
];

// Isolation check — verify a resource belongs to the requesting tenant
function verifyIsolation({ requestingTenantId, resourceTenantId, resourceId }) {
    const isolated = requestingTenantId === resourceTenantId;
    if (!isolated) {
        auditLog(requestingTenantId, "SYSTEM", "cross_tenant_access_attempt", { resourceTenantId, resourceId });
    }
    return {
        isolated,
        allowed:   isolated,
        violation: !isolated,
        message:   isolated ? "Access permitted — same tenant" : `🚨 Cross-tenant access BLOCKED: tenant "${requestingTenantId}" cannot access tenant "${resourceTenantId}" data`
    };
}

// Rate-based anomaly detector using in-memory counters (production would use Redis)
const _actionCounters = {};
function detectAnomaly(tenantId, userId, action) {
    const key    = `${tenantId}::${userId}::${action}`;
    const now    = Date.now();
    const window = 600_000; // 10 minutes

    if (!_actionCounters[key]) _actionCounters[key] = [];
    _actionCounters[key] = _actionCounters[key].filter(t => now - t < window);
    _actionCounters[key].push(now);

    const count    = _actionCounters[key].length;
    const isAnomaly = (action === "login_failed" && count >= 5) ||
                      (action === "delete_record" && count >= 20) ||
                      (action === "data_export"   && count >= 3);

    if (isAnomaly) {
        auditLog(tenantId, userId, "anomaly_detected", { action, count, window: "10min" });
    }

    return { anomaly: isAnomaly, action, count, threshold: action === "login_failed" ? 5 : 20 };
}

function getSecurityScore(tenantId, requesterId) {
    const auth = requireAuth(tenantId, requesterId, "admin");
    if (!auth.ok) return forbidden("tenantSecurityAgent", auth.error);

    const logs    = load(tenantId, "audit-log", []);
    const recent  = logs.filter(l => new Date(l.timestamp).getTime() > Date.now() - 7 * 86_400_000);
    const highEvents = recent.filter(l => l.severityLevel >= 3).length;

    let score     = 100;
    score -= highEvents * 5;
    score  = Math.max(0, Math.min(100, score));

    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return {
        tenantId,
        securityScore: score,
        grade,
        recommendations: [
            score < 80 ? "Review high-severity audit events immediately" : null,
            "Enable 2FA for all admin accounts",
            "Review member access list quarterly",
            "Set up IP allowlist for admin access"
        ].filter(Boolean),
        threats: THREAT_PATTERNS.slice(0, 3),
        checkedAt: NOW()
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "verify_isolation") {
            data = verifyIsolation(p);
        } else if (task.type === "detect_anomaly") {
            data = detectAnomaly(p.tenantId, p.userId, p.action);
        } else {
            data = getSecurityScore(p.tenantId, p.userId);
        }
        if (data?.code === 403) return data;
        return ok("tenantSecurityAgent", data);
    } catch (err) { return fail("tenantSecurityAgent", err.message); }
}

module.exports = { verifyIsolation, detectAnomaly, getSecurityScore, run };
