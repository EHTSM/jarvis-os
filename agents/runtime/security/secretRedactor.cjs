"use strict";
/**
 * secretRedactor — detect and redact secrets in strings.
 *
 * redact(text)              → text with secrets replaced by masked values
 * scan(text)                → [{ type, match, position }]
 * addPattern(name, regex)   — register a custom secret pattern
 * reset()                   — clear custom patterns
 */

const BUILTIN_PATTERNS = [
    { name: "bearer-token",     pattern: /Bearer\s+([A-Za-z0-9\-._~+/]{20,})/g },
    { name: "aws-access-key",   pattern: /AKIA[0-9A-Z]{16}/g },
    { name: "aws-secret-key",   pattern: /(?:aws[_-]?secret[_-]?(?:access[_-]?)?key)\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})/gi },
    { name: "github-token",     pattern: /gh[pousr]_[A-Za-z0-9]{36}/g },
    { name: "jwt",              pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
    { name: "slack-token",      pattern: /xox[baprs]-[0-9]{8,12}-[0-9]{8,12}-[A-Za-z0-9]{16,}/g },
    { name: "api-key-generic",  pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?([A-Za-z0-9_\-]{20,})/gi },
    { name: "password-assign",  pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]([^'"]{4,})['"]/gi },
    { name: "private-key-header", pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/g },
    { name: "hex-secret",       pattern: /(?:secret|token|key)\s*[=:]\s*['"]?([a-f0-9]{32,64})/gi },
];

const _customPatterns = [];

function redact(text) {
    if (typeof text !== "string") return text;
    let out = text;
    for (const { pattern } of [...BUILTIN_PATTERNS, ..._customPatterns]) {
        out = out.replace(new RegExp(pattern.source, pattern.flags), (m) => {
            const keep = Math.min(4, Math.floor(m.length / 4));
            return m.slice(0, keep) + "*".repeat(Math.max(4, m.length - keep));
        });
    }
    return out;
}

function scan(text) {
    if (typeof text !== "string") return [];
    const found = [];
    for (const { name, pattern } of [...BUILTIN_PATTERNS, ..._customPatterns]) {
        const rx = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = rx.exec(text)) !== null) {
            found.push({
                type:     name,
                match:    match[0].slice(0, 6) + "…",
                position: match.index,
            });
        }
    }
    return found;
}

function addPattern(name, regex) {
    _customPatterns.push({
        name,
        pattern: regex instanceof RegExp ? regex : new RegExp(regex, "g"),
    });
}

function reset() { _customPatterns.length = 0; }

module.exports = { redact, scan, addPattern, reset, BUILTIN_PATTERNS };
