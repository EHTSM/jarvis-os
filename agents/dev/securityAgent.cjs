/**
 * Security Agent — static vulnerability scan + AI security review.
 */

const groq   = require("../core/groqClient.cjs");
const fsUtil = require("../core/fileSystem.cjs");

const SYSTEM = `You are an application security expert. Scan the code and respond ONLY with JSON:
{
  "vulnerabilities": [{ "type": "...", "severity": "critical|high|medium|low", "location": "...", "fix": "..." }],
  "securityScore": 0-100,
  "recommendations": ["..."],
  "sanitizedCode": null
}
Check: eval/exec injection, hardcoded secrets, XSS, CORS misconfig, NoSQL injection, missing auth, path traversal.`;

const PATTERNS = [
    { rx: /eval\s*\(/g,                       type: "Code Injection",    severity: "critical" },
    { rx: /exec\s*\(\s*req\./g,               type: "Command Injection", severity: "critical" },
    { rx: /password\s*[:=]\s*["'][^"']{4,}/gi, type: "Hardcoded Secret", severity: "high"     },
    { rx: /api[_-]?key\s*[:=]\s*["'][^"']{4,}/gi, type: "Hardcoded Key", severity: "high"    },
    { rx: /innerHTML\s*=/g,                   type: "XSS Risk",          severity: "high"     },
    { rx: /\.find\(\s*req\./g,                type: "NoSQL Injection",   severity: "high"     },
    { rx: /cors\(\)/g,                        type: "Open CORS",         severity: "medium"   },
    { rx: /console\.log\(.*(?:pass|token|secret)/gi, type: "Credential Leak", severity: "medium" }
];

function staticScan(src) {
    const found = [];
    for (const { rx, type, severity } of PATTERNS) {
        for (const m of src.matchAll(rx)) {
            const line = src.slice(0, m.index).split("\n").length;
            found.push({ type, severity, location: `line ${line}`, source: "static" });
        }
    }
    return found;
}

function sanitize(input) {
    if (typeof input !== "string") return input;
    return input.replace(/[<>]/g, "").replace(/javascript:/gi, "").replace(/on\w+\s*=/gi, "").trim();
}

async function run(task) {
    const p  = task.payload || {};
    let   src = p.code || null;

    if (!src && p.file) {
        src = await fsUtil.readFile(p.file);
        if (!src) return { success: false, error: `File not found: ${p.file}` };
    }
    if (!src) return { success: false, error: "Provide code or file in payload" };

    const staticVulns = staticScan(src);

    let ai = { vulnerabilities: [], recommendations: [], securityScore: 100 };
    if ((p.scanType || "full") === "full") {
        const raw = await groq.chat(SYSTEM, `Scan:\n${src.slice(0, 6000)}`);
        try { ai = groq.parseJson(raw); } catch { ai.recommendations = [raw]; }
    }

    const all      = [...staticVulns, ...(ai.vulnerabilities || []).map(v => ({ ...v, source: "ai" }))];
    const critical = all.filter(v => v.severity === "critical").length;
    const high     = all.filter(v => v.severity === "high").length;
    const score    = Math.max(0, 100 - critical * 20 - high * 10 - (all.length - critical - high) * 3);

    return {
        success:         true,
        file:            p.file || null,
        vulnerabilities: all,
        totalFound:      all.length,
        securityScore:   ai.securityScore ?? score,
        recommendations: ai.recommendations || []
    };
}

module.exports = { run, sanitize };
