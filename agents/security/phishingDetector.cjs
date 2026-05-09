"use strict";
const { uid, NOW, securityLog, scoreThreat, ok, fail, blocked } = require("./_securityStore.cjs");
const AGENT = "phishingDetector";

const PHISHING_INDICATORS = [
    { test:(url) => /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url),    weight:3, reason:"IP address used instead of domain name" },
    { test:(url) => url.length > 200,                                                 weight:2, reason:"Unusually long URL" },
    { test:(url) => (url.match(/-/g) || []).length > 4,                              weight:2, reason:"Multiple hyphens — possible domain spoofing" },
    { test:(url) => /login|account|secure|verify|update|banking|paypal|amazon|google|microsoft|apple/.test(url.toLowerCase()) && !_isTrustedDomain(url), weight:3, reason:"Sensitive keyword in untrusted domain" },
    { test:(url) => /bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly/.test(url), weight:2, reason:"URL shortener — destination unknown" },
    { test:(url) => url.includes("@"),                                                weight:3, reason:"@ symbol in URL — real domain after @" },
    { test:(url) => /\.tk$|\.ml$|\.ga$|\.cf$|\.gq$/.test(url),                      weight:2, reason:"Free TLD commonly used in phishing" },
    { test:(url) => /https?:\/\/[^/]*paypal\.[^/]*\.com|apple\.[^/]*\.com|microsoft\.[^/]*\.com/.test(url), weight:4, reason:"Homograph/subdomain spoofing of trusted brand" }
];

const SUSPICIOUS_EMAIL_PATTERNS = [
    { pattern:/urgent|immediate action required|account suspended|verify now|click below/i, weight:2, reason:"Urgency language" },
    { pattern:/dear customer|dear user|dear account holder/i,                               weight:1, reason:"Generic salutation — not personalised" },
    { pattern:/\$[\d,]+\s*(reward|prize|won|lottery|gift card)/i,                          weight:4, reason:"Financial reward lure" },
    { pattern:/password.*expire|account.*suspend|verify.*24\s*hours/i,                      weight:3, reason:"Account threat language" },
    { pattern:/kindly|please do the needful|revert back|attached herewith/i,                weight:1, reason:"Unusual phrasing pattern" }
];

const TRUSTED_DOMAINS = new Set(["google.com","paypal.com","amazon.com","apple.com","microsoft.com","facebook.com","twitter.com","linkedin.com","github.com"]);

function _isTrustedDomain(url) {
    try {
        const host = new URL(url).hostname.replace("www.","");
        return TRUSTED_DOMAINS.has(host);
    } catch { return false; }
}

function analyzeURL({ userId, url }) {
    if (!userId || !url) return fail(AGENT, "userId and url required");

    const hits    = PHISHING_INDICATORS.filter(i => i.test(url));
    const score   = hits.reduce((s, i) => s + i.weight, 0);
    const threat  = score >= 6 ? "CRITICAL" : score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
    const isPhish = score >= 4;

    securityLog(AGENT, userId, isPhish ? "phishing_url_detected" : "url_scanned", { url, score, threat }, threat);

    if (isPhish) return blocked(AGENT, `Likely phishing URL detected (score: ${score}): ${hits.map(h => h.reason).join("; ")}`, threat);

    return ok(AGENT, { url, score, threatLevel: threat, indicators: hits.map(h => h.reason), safe: score < 2, recommendation: score >= 2 ? "Proceed with caution — verify the URL manually" : "URL appears safe" });
}

function analyzeEmail({ userId, subject, body, senderEmail, senderName }) {
    if (!userId) return fail(AGENT, "userId required");

    const text  = `${subject || ""} ${body || ""}`;
    const hits  = SUSPICIOUS_EMAIL_PATTERNS.filter(p => p.pattern.test(text));
    const score = hits.reduce((s, p) => s + p.weight, 0);
    const domainMismatch = senderEmail && senderName && !senderEmail.toLowerCase().includes(senderName.toLowerCase().split(" ")[0].slice(0,3));
    if (domainMismatch) hits.push({ reason:"Sender name doesn't match email domain" });

    const threat = score >= 5 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW";
    securityLog(AGENT, userId, "email_analyzed", { senderEmail, score, threat }, threat);

    return ok(AGENT, {
        score, threatLevel: threat,
        indicators: hits.map(h => h.reason),
        isLikelyPhishing: score >= 4,
        recommendation: score >= 4 ? "⚠️ Do NOT click any links or provide information" : score >= 2 ? "Be cautious — verify sender identity independently" : "Email appears legitimate"
    });
}

module.exports = { analyzeURL, analyzeEmail };
