"use strict";
const { load, flush, uid, NOW, securityLog, scoreThreat, ok, fail, blocked, alert_ } = require("./_securityStore.cjs");
const AGENT = "threatDetectionSystem";

const KNOWN_THREAT_PATTERNS = [
    { name:"SQL Injection",      pattern:/('|--|;|DROP\s+TABLE|UNION\s+SELECT|1=1|OR\s+'1'='1)/i,   category:"injection",    severity:"CRITICAL" },
    { name:"XSS Attempt",        pattern:/<script[\s\S]*?>|javascript:|on\w+\s*=/i,                  category:"xss",          severity:"HIGH" },
    { name:"Path Traversal",     pattern:/\.\.[\/\\]/,                                               category:"traversal",    severity:"HIGH" },
    { name:"Command Injection",  pattern:/;\s*(ls|cat|rm|wget|curl|bash|sh|python|nc)\b/i,           category:"injection",    severity:"CRITICAL" },
    { name:"LDAP Injection",     pattern:/[*()\\&|]/,                                                category:"injection",    severity:"HIGH" },
    { name:"XXE Attack",         pattern:/<!ENTITY|SYSTEM\s+"file:|<!DOCTYPE.*\[/i,                  category:"xxe",          severity:"HIGH" },
    { name:"Open Redirect",      pattern:/\?.*(?:url|redirect|return|next)=https?:\/\//i,            category:"redirect",     severity:"MEDIUM" },
    { name:"SSRF Pattern",       pattern:/169\.254\.|127\.0\.|localhost|internal\.|\.local/i,         category:"ssrf",         severity:"HIGH" },
    { name:"Brute Force Indicator",pattern:/^(password|123456|admin|root|letmein|qwerty)$/i,         category:"brute_force",  severity:"MEDIUM" }
];

const SUSPICIOUS_IP_RANGES = ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"];

function analyzeInput({ userId, inputData, context = "api", sourceIP }) {
    if (!userId) return fail(AGENT, "userId required");

    const input   = String(inputData || "");
    const threats = KNOWN_THREAT_PATTERNS.filter(p => p.pattern.test(input));

    if (!threats.length) {
        securityLog(AGENT, userId, "input_scanned", { context, length: input.length, threatCount: 0 }, "INFO");
        return ok(AGENT, { safe: true, threats: [], context });
    }

    const indicators = threats.map(t => t.category);
    const score      = scoreThreat(indicators.map(i => i === "injection" ? "sqlInjection" : i === "xss" ? "xss" : "suspiciousScript"));
    const logId      = securityLog(AGENT, userId, "threat_detected", { threats: threats.map(t => t.name), context, sourceIP, score }, score.level);

    if (score.block) {
        return blocked(AGENT, `${threats.length} threat pattern(s) detected: ${threats.map(t => t.name).join(", ")}`, score.level);
    }

    return alert_(AGENT, `Security warning: ${threats.map(t => t.name).join(", ")} detected in input`, score.level);
}

function scanPayload({ userId, payload, context }) {
    if (!userId || !payload) return fail(AGENT, "userId and payload required");
    const results = Object.entries(payload).map(([key, val]) => ({
        field:  key,
        result: analyzeInput({ userId, inputData: String(val), context: `${context}.${key}` })
    }));

    const anyBlocked = results.some(r => r.result.blocked);
    const alerts     = results.filter(r => r.result.alert);

    if (anyBlocked) {
        return blocked(AGENT, `Malicious content in fields: ${results.filter(r => r.result.blocked).map(r => r.field).join(", ")}`, "HIGH");
    }

    return ok(AGENT, { allSafe: !alerts.length, fieldResults: results, alertCount: alerts.length });
}

function getThreatPatterns() { return ok(AGENT, KNOWN_THREAT_PATTERNS.map(p => ({ name: p.name, category: p.category, severity: p.severity }))); }

module.exports = { analyzeInput, scanPayload, getThreatPatterns };
