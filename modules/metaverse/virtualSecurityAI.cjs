"use strict";
const { loadGlobal, flushGlobal, loadUser, loadWorld, metaLog, uid, NOW, ok, fail, blocked } = require("./_metaverseStore.cjs");

const AGENT = "virtualSecurityAI";

const THREAT_TYPES = ["spam","griefing","impersonation","asset_theft","economy_exploit","unauthorized_access","cheat","dos_pattern","nsfw_content","ban_evasion"];
const ACTION_TYPES = ["warn","mute","kick","temp_ban","permanent_ban","asset_freeze","world_lock"];
const SEVERITY     = { LOW:1, MEDIUM:2, HIGH:3, CRITICAL:4 };

function reportThreat({ reporterId, targetId, worldId, threatType, evidence, severity = "MEDIUM" }) {
    if (!reporterId || !targetId || !threatType) return fail(AGENT, "reporterId, targetId, and threatType required");
    if (!THREAT_TYPES.includes(threatType))   return fail(AGENT, `threatType must be: ${THREAT_TYPES.join(", ")}`);
    if (!SEVERITY[severity])                  return fail(AGENT, `severity must be: ${Object.keys(SEVERITY).join(", ")}`);
    if (reporterId === targetId)               return fail(AGENT, "cannot report yourself");

    const report = {
        reportId:   uid("rpt"),
        reporterId,
        targetId,
        worldId:    worldId || null,
        threatType,
        severity,
        severityScore: SEVERITY[severity],
        evidence:   evidence ? String(evidence).slice(0,2000) : null,
        status:     "pending_review",
        autoAction: SEVERITY[severity] === 4 ? "temp_ban" : null,
        createdAt:  NOW()
    };

    const reports = loadGlobal("security_reports", []);
    reports.push(report);
    flushGlobal("security_reports", reports.slice(-100000));

    if (SEVERITY[severity] >= 4) {
        metaLog(AGENT, reporterId, "critical_threat_reported", { reportId:report.reportId, targetId, threatType }, "CRITICAL");
    } else {
        metaLog(AGENT, reporterId, "threat_reported", { reportId:report.reportId, targetId, threatType, severity }, "WARN");
    }

    return ok(AGENT, report, { note: severity === "CRITICAL" ? "Auto-moderation queued for critical threats" : "Report queued for review" });
}

function enforceAction({ moderatorId, targetId, worldId, action, durationMinutes, reason }) {
    if (!moderatorId || !targetId || !action) return fail(AGENT, "moderatorId, targetId, and action required");
    if (!ACTION_TYPES.includes(action)) return fail(AGENT, `action must be: ${ACTION_TYPES.join(", ")}`);
    if (!reason) return fail(AGENT, "reason required");

    const enforcement = {
        enforcementId: uid("enf"),
        moderatorId,
        targetId,
        worldId:       worldId || null,
        action,
        durationMinutes: durationMinutes || (action.includes("temp_ban") ? 60 : null),
        expiresAt:     durationMinutes ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null,
        reason:        String(reason).slice(0,500),
        status:        "active",
        issuedAt:      NOW()
    };

    const enforcements = loadGlobal("enforcements", []);
    enforcements.push(enforcement);
    flushGlobal("enforcements", enforcements.slice(-100000));

    metaLog(AGENT, moderatorId, "enforcement_issued", { enforcementId:enforcement.enforcementId, targetId, action }, "WARN");
    return ok(AGENT, enforcement);
}

function scanWorldForAnomalies({ worldId }) {
    if (!worldId) return fail(AGENT, "worldId required");
    const world = loadWorld(worldId);
    if (!world) return fail(AGENT, `worldId ${worldId} not found`);

    const issues = [];
    if (world.users.length > world.maxUsers * 0.95) issues.push({ type:"capacity_warning", detail:`World at ${Math.round(world.users.length/world.maxUsers*100)}% capacity` });
    if (world.interactions.length > 4000) issues.push({ type:"interaction_spike", detail:`${world.interactions.length} interactions logged — possible spam` });

    // duplicate userId check
    const userIds = world.users.map(u => u.userId);
    const dupes = userIds.filter((id, i) => userIds.indexOf(id) !== i);
    if (dupes.length) issues.push({ type:"duplicate_session", detail:`Duplicate users: ${[...new Set(dupes)].join(",")}` });

    const scan = { scanId:uid("scn"), worldId, issueCount:issues.length, issues, riskLevel: issues.length === 0 ? "CLEAR" : issues.length > 2 ? "HIGH" : "MEDIUM", scannedAt:NOW() };
    metaLog(AGENT, "system", "world_scanned", { worldId, issueCount:issues.length }, "INFO");
    return ok(AGENT, scan);
}

function getSecurityLog({ worldId, threatType, severity, limit = 50 }) {
    let reports = loadGlobal("security_reports", []);
    if (worldId)    reports = reports.filter(r => r.worldId === worldId);
    if (threatType) reports = reports.filter(r => r.threatType === threatType);
    if (severity)   reports = reports.filter(r => r.severity === severity);
    return ok(AGENT, { total:reports.length, reports:reports.slice(-limit).reverse(), threatTypes:THREAT_TYPES, actionTypes:ACTION_TYPES });
}

module.exports = { reportThreat, enforceAction, scanWorldForAnomalies, getSecurityLog };
