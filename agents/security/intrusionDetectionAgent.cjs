"use strict";
const { load, flush, uid, NOW, securityLog, scoreThreat, ok, fail, blocked, alert_ } = require("./_securityStore.cjs");
const AGENT = "intrusionDetectionAgent";

const RATE_LIMITS = { loginAttempts: { window:300000, max:5 }, apiRequests: { window:60000, max:100 }, passwordReset: { window:3600000, max:3 } };

function checkLoginAttempt({ userId, targetUserId, ipAddress, success, userAgent, geoLocation }) {
    if (!userId || !targetUserId) return fail(AGENT, "userId and targetUserId required");

    const key      = `login_${targetUserId}`;
    const history  = load(userId, key, []);
    const now      = Date.now();
    const window   = history.filter(h => now - h.ts < RATE_LIMITS.loginAttempts.window);

    const indicators = [];
    if (!success)                                         indicators.push("multipleFailedLogins");
    if (window.filter(h => !h.success).length >= 3)      indicators.push("bruteForce");
    if (geoLocation && _isUnusualGeo(history, geoLocation)) indicators.push("unusualGeoLocation");
    if (_isSuspiciousUA(userAgent))                       indicators.push("suspiciousScript");

    const threat = scoreThreat(indicators);
    const entry  = { id: uid("ida"), ts: now, success, ipAddress, userAgent, geoLocation, indicators, threatLevel: threat.level };

    history.push(entry);
    flush(userId, key, history.slice(-200));
    securityLog(AGENT, userId, success ? "login_success" : "login_failed", { targetUserId, ipAddress, threatLevel: threat.level }, threat.level);

    if (threat.block) {
        return blocked(AGENT, `Account access blocked — ${indicators.join(", ")} detected. IP: ${ipAddress}`, threat.level);
    }
    if (indicators.length) {
        return alert_(AGENT, `Suspicious login activity for ${targetUserId}: ${indicators.join(", ")}`, threat.level);
    }
    return ok(AGENT, { allowed: true, threatLevel: "LOW", indicators: [] });
}

function _isUnusualGeo(history, currentGeo) {
    const recent = history.filter(h => h.success).slice(-5);
    return recent.length >= 2 && !recent.some(h => h.geoLocation === currentGeo);
}

function _isSuspiciousUA(ua) {
    if (!ua) return false;
    return /sqlmap|nikto|nmap|masscan|nuclei|burpsuite|python-requests\/[12]/i.test(ua);
}

function checkRateLimit({ userId, resourceType, requestorId }) {
    if (!userId || !resourceType) return fail(AGENT, "userId and resourceType required");

    const config  = RATE_LIMITS[resourceType] || RATE_LIMITS.apiRequests;
    const key     = `rate_${resourceType}_${requestorId || "global"}`;
    const history = load(userId, key, []);
    const now     = Date.now();
    const window  = history.filter(h => now - h.ts < config.window);

    if (window.length >= config.max) {
        securityLog(AGENT, userId, "rate_limit_exceeded", { resourceType, requestorId, count: window.length }, "HIGH");
        return blocked(AGENT, `Rate limit exceeded for ${resourceType}: ${window.length}/${config.max} in window`, "HIGH");
    }

    history.push({ ts: now, requestorId });
    flush(userId, key, history.slice(-500));

    return ok(AGENT, { allowed: true, count: window.length + 1, limit: config.max, remainingInWindow: config.max - window.length - 1 });
}

function getIntrusionLogs({ userId, threatLevel, limit = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    let logs = load(userId, "intrusion_logs", []);
    if (threatLevel) logs = logs.filter(l => l.threatLevel === threatLevel);
    return ok(AGENT, logs.slice(-limit).reverse());
}

module.exports = { checkLoginAttempt, checkRateLimit, getIntrusionLogs };
