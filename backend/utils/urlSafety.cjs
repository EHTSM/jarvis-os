"use strict";
/**
 * Rejects URLs that would let a real headless-browser navigation reach
 * internal network addresses or a cloud metadata endpoint. Client-supplied
 * `url` values reach page.goto() across the ODI browser-automation family
 * (interactionIntelligence, liveDesignEditor, accessibilityAuditor,
 * domAnalyzerService, liveDesignInspector, responsiveSimulator,
 * visualRegressionEngine, visualCaptureService, visionQA,
 * selfHealingFrontend, agents/browser/actionEngine) with no prior
 * validation — this is the single shared choke point for all of them.
 */
const dns = require("dns").promises;
const net = require("net");

// RFC 1918 / loopback / link-local (incl. the 169.254.169.254 cloud metadata
// endpoint) / IPv6 unique-local and loopback ranges.
const BLOCKED_IPV4_PREFIXES = [
  /^127\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
];
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

function _isBlockedIPv4(ip) {
  return BLOCKED_IPV4_PREFIXES.some((re) => re.test(ip));
}

function _isBlockedIPv6(ip) {
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
}

/**
 * Resolves the URL's hostname and rejects it if the URL scheme isn't
 * http(s), the hostname is a blocked literal, or any resolved address
 * falls in a private/loopback/link-local/metadata range. Does not block on
 * DNS resolution failure (lets the caller's own request fail naturally) —
 * only blocks on a confirmed unsafe target.
 */
async function assertSafeNavigationTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `blocked scheme: ${parsed.protocol}` };
  }

  // ERA-1 forensic closure (2026-08-29): URL.hostname keeps the [...]
  // brackets for an IPv6 literal (per the WHATWG URL spec), but net.isIP()
  // never accepts them — net.isIP("[::1]") returns 0, so this whole block
  // was silently skipped for EVERY bracketed IPv6 literal (the only valid
  // way to put one in a URL), falling through to the DNS-lookup path, which
  // fails resolution on the literal string "[::1]" and returns {safe:true}
  // by design for DNS failures. Live-verified: http://[::1]/,
  // http://[fe80::1]/, http://[fc00::1]/, http://[fd00::1]/ all bypassed
  // the entire IPv6 blocklist, and a real Node http.get() to
  // http://[::1]:PORT/ genuinely resolves and attempts the TCP connection —
  // not just a validator quirk. Stripping the brackets before net.isIP()
  // is the minimal fix; IPv4 hostnames never carry brackets so this is a
  // no-op for that branch.
  const hostname = parsed.hostname.toLowerCase();
  const ipLiteral = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `blocked hostname: ${hostname}` };
  }
  if (net.isIP(ipLiteral)) {
    if (net.isIP(ipLiteral) === 4 && _isBlockedIPv4(ipLiteral)) return { safe: false, reason: `blocked IP: ${ipLiteral}` };
    if (net.isIP(ipLiteral) === 6 && _isBlockedIPv6(ipLiteral)) return { safe: false, reason: `blocked IP: ${ipLiteral}` };
    return { safe: true };
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const { address, family } of records) {
      if (family === 4 && _isBlockedIPv4(address)) return { safe: false, reason: `hostname resolves to blocked IP: ${address}` };
      if (family === 6 && _isBlockedIPv6(address)) return { safe: false, reason: `hostname resolves to blocked IP: ${address}` };
    }
  } catch {
    // DNS failure — not our concern to block; the navigation will fail on its own.
  }

  return { safe: true };
}

module.exports = { assertSafeNavigationTarget };
