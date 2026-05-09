/**
 * Input Validator — sanitizes and validates all incoming Jarvis requests.
 * Called before any routing logic. Returns { valid, sanitized, errors }.
 */

const MAX_INPUT_LENGTH = 5000;
const MIN_INPUT_LENGTH = 1;

// Patterns that indicate injection attempts
const BLOCKED_PATTERNS = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /javascript\s*:/gi,
    /on\w+\s*=\s*["'][^"']*["']/gi,
    /\beval\s*\(/gi,
    /\bexec\s*\(/gi,
    /;\s*DROP\s+TABLE/gi,
    /UNION\s+SELECT/gi,
    /--\s*$/gm,
    /\/\*[\s\S]*?\*\//g
];

function _stripHtml(str) {
    return str.replace(/<[^>]+>/g, "").trim();
}

function _sanitizeString(val) {
    if (typeof val !== "string") return val;
    let s = val.trim();
    s = _stripHtml(s);
    // Collapse multiple whitespace
    s = s.replace(/\s+/g, " ");
    return s;
}

function _deepSanitize(obj, depth = 0) {
    if (depth > 5) return obj;
    if (typeof obj === "string") return _sanitizeString(obj);
    if (Array.isArray(obj))     return obj.slice(0, 100).map(v => _deepSanitize(v, depth + 1));
    if (obj && typeof obj === "object") {
        const out = {};
        for (const [k, v] of Object.entries(obj).slice(0, 50)) {
            out[_sanitizeString(k)] = _deepSanitize(v, depth + 1);
        }
        return out;
    }
    return obj;
}

function _hasBlockedPattern(text) {
    return BLOCKED_PATTERNS.some(p => { p.lastIndex = 0; return p.test(text); });
}

function validate(body) {
    const errors = [];

    if (!body || typeof body !== "object") {
        return { valid: false, errors: ["Request body must be a JSON object"], sanitized: null };
    }

    const input = body.input || body.command || "";

    // Length checks
    if (typeof input === "string") {
        if (input.trim().length < MIN_INPUT_LENGTH) errors.push("Input is empty");
        if (input.length > MAX_INPUT_LENGTH)        errors.push(`Input exceeds ${MAX_INPUT_LENGTH} character limit`);
    }

    // Injection check
    const rawStr = JSON.stringify(body);
    if (_hasBlockedPattern(rawStr)) {
        return { valid: false, errors: ["Blocked: input contains disallowed pattern"], sanitized: null };
    }

    if (errors.length) return { valid: false, errors, sanitized: null };

    return { valid: true, errors: [], sanitized: _deepSanitize(body) };
}

function validateField(value, rules = {}) {
    const errors = [];
    if (rules.required && (value === undefined || value === null || value === "")) {
        errors.push("Field is required");
    }
    if (rules.type === "number" && isNaN(Number(value)))  errors.push("Must be a number");
    if (rules.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push("Invalid email");
    if (rules.type === "phone" && !/^\+?[\d\s\-]{7,15}$/.test(value))        errors.push("Invalid phone number");
    if (rules.min !== undefined && Number(value) < rules.min)  errors.push(`Minimum value is ${rules.min}`);
    if (rules.max !== undefined && Number(value) > rules.max)  errors.push(`Maximum value is ${rules.max}`);
    if (rules.maxLen && String(value).length > rules.maxLen)   errors.push(`Max length is ${rules.maxLen}`);
    return { valid: errors.length === 0, errors };
}

module.exports = { validate, validateField };
