"use strict";
const { load, flush, uid, NOW, securityLog, scoreThreat, ok, fail, blocked } = require("./_securityStore.cjs");
const AGENT = "firewallAI";

const BLOCKED_PORTS   = [22, 23, 3389, 4444, 5900, 6666, 31337]; // SSH, Telnet, RDP, Metasploit, VNC, backdoors
const ALLOWED_PORTS   = [80, 443, 8080, 8443, 3000, 5000];
const BLOCKED_COUNTRIES = ["KP"]; // North Korea (sanctioned)
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB

const IP_BLOCKLIST = new Set(["0.0.0.0","255.255.255.255"]);

function inspectRequest({ userId, sourceIP, destinationPort, payloadSizeBytes, method, path, headers = {} }) {
    if (!userId) return fail(AGENT, "userId required");

    const indicators = [];
    const rules      = [];

    if (BLOCKED_PORTS.includes(destinationPort)) {
        rules.push(`Port ${destinationPort} blocked (high-risk port)`);
        indicators.push("knownMaliciousIP");
    }

    if (IP_BLOCKLIST.has(sourceIP)) {
        rules.push(`IP ${sourceIP} is blocklisted`);
        indicators.push("knownMaliciousIP");
    }

    if (payloadSizeBytes > MAX_PAYLOAD_BYTES) {
        rules.push(`Payload size ${payloadSizeBytes} exceeds ${MAX_PAYLOAD_BYTES} bytes`);
        indicators.push("largeDataExfiltration");
    }

    if (headers["x-forwarded-for"] && headers["x-forwarded-for"].split(",").length > 5) {
        rules.push("Suspicious proxy chain detected");
        indicators.push("vpnTor");
    }

    if (path && /(\.\.|%2e%2e|%252e)/i.test(path)) {
        rules.push("Path traversal attempt");
        indicators.push("sqlInjection");
    }

    const threat = scoreThreat(indicators);
    const logId  = securityLog(AGENT, userId, indicators.length ? "request_blocked" : "request_allowed", { sourceIP, destinationPort, path, threatLevel: threat.level }, threat.level);

    if (threat.block || rules.length) {
        return blocked(AGENT, `Request blocked by firewall rules: ${rules.join("; ")}`, threat.level);
    }

    return ok(AGENT, { allowed: true, sourceIP, destinationPort, threatLevel: "LOW", rules: [] });
}

function addToBlocklist({ userId, ip, reason, duration = "permanent" }) {
    if (!userId || !ip) return fail(AGENT, "userId and ip required");
    securityLog(AGENT, userId, "ip_blocklisted", { ip, reason }, "HIGH");
    IP_BLOCKLIST.add(ip);

    const list = load(userId, "firewall_blocklist", []);
    list.push({ ip, reason, duration, addedAt: NOW(), addedBy: userId });
    flush(userId, "firewall_blocklist", list.slice(-10000));

    return ok(AGENT, { blocked: true, ip, reason });
}

function getFirewallRules({ userId }) {
    if (!userId) return fail(AGENT, "userId required");
    return ok(AGENT, {
        blockedPorts:    BLOCKED_PORTS,
        allowedPorts:    ALLOWED_PORTS,
        blockedCountries:BLOCKED_COUNTRIES,
        maxPayloadMB:    MAX_PAYLOAD_BYTES / 1024 / 1024,
        blocklist:       load(userId, "firewall_blocklist", []).slice(-20)
    });
}

module.exports = { inspectRequest, addToBlocklist, getFirewallRules };
