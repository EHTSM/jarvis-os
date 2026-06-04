"use strict";
/**
 * ToolExecutionLayer — permission-gated tool execution with usage tracking
 * and failure recovery.
 *
 * Tools are adapters: each tool wraps an external service call behind a
 * standardised execute(params) interface. All calls go through:
 *   1. Permission check   — per-tool, per-action allow/deny
 *   2. Rate-limit guard   — per-tool calls-per-minute cap
 *   3. Execution          — actual call (HTTP, local process, etc.)
 *   4. Usage record       — persisted to data/tool-usage.json
 *   5. Failure recovery   — exponential-backoff retry on transient errors
 *
 * Supported tools: github, gmail, slack, notion, gdrive, telegram, openrouter, ollama
 *
 * Public API:
 *   execute(toolId, action, params, opts)  → { callId, success, output, durationMs }
 *   getPermissions(toolId)                 → PermissionMap
 *   setPermission(toolId, action, allowed) → void
 *   getUsage(toolId, opts)                 → { calls[], stats }
 *   getFailures(opts)                      → { failures[], patterns[] }
 *   listTools()                            → ToolMeta[]
 *   toolStatus()                           → { [toolId]: { connected, callsToday, failRate } }
 */

const fs     = require("fs");
const path   = require("path");
const https  = require("https");
const http   = require("http");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");
const execLog  = require("../utils/execLog.cjs");

const USAGE_FILE   = path.join(__dirname, "../../data/tool-usage.json");
const PERM_FILE    = path.join(__dirname, "../../data/tool-permissions.json");
const FAILURE_FILE = path.join(__dirname, "../../data/tool-failures.json");

// ── Persistence helpers ──────────────────────────────────────────────────
function _rj(file, fb) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; }
}
function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _usage    = _rj(USAGE_FILE,   []);   // Array<UsageRecord>
let _failures = _rj(FAILURE_FILE, []);   // Array<FailureRecord>
let _perms    = _rj(PERM_FILE,    {});   // { [toolId]: { [action]: bool } }

function _saveUsage()    { try { _wj(USAGE_FILE,   _usage.slice(-5000));   } catch { /* non-fatal */ } }
function _saveFailures() { try { _wj(FAILURE_FILE, _failures.slice(-2000)); } catch { /* non-fatal */ } }
function _savePerms()    { try { _wj(PERM_FILE,    _perms);                } catch { /* non-fatal */ } }

let _seq = 0;
function _id() { return `tc_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Tool catalog ─────────────────────────────────────────────────────────
const TOOL_DEFS = {
    github: {
        name: "GitHub", icon: "🐙", type: "code",
        actions: {
            create_pr:   { rateLimit: 10, risk: "medium" },
            push_commit: { rateLimit: 20, risk: "medium" },
            merge_pr:    { rateLimit: 5,  risk: "high"   },
            read_repo:   { rateLimit: 60, risk: "low"    },
            list_issues: { rateLimit: 60, risk: "low"    },
            create_issue:{ rateLimit: 20, risk: "low"    },
        },
        envKey: "GITHUB_TOKEN",
        baseUrl: "https://api.github.com",
    },
    gmail: {
        name: "Gmail", icon: "📧", type: "email",
        actions: {
            send_email:  { rateLimit: 20, risk: "medium" },
            read_inbox:  { rateLimit: 60, risk: "low"    },
            search_mail: { rateLimit: 30, risk: "low"    },
            reply_email: { rateLimit: 20, risk: "medium" },
        },
        envKey: "GMAIL_API_KEY",
        baseUrl: "https://gmail.googleapis.com",
    },
    slack: {
        name: "Slack", icon: "💬", type: "comms",
        actions: {
            post_message:   { rateLimit: 30, risk: "low"    },
            read_channel:   { rateLimit: 60, risk: "low"    },
            create_channel: { rateLimit: 5,  risk: "medium" },
            upload_file:    { rateLimit: 10, risk: "low"    },
        },
        envKey: "SLACK_BOT_TOKEN",
        baseUrl: "https://slack.com/api",
    },
    notion: {
        name: "Notion", icon: "📝", type: "docs",
        actions: {
            create_page:  { rateLimit: 20, risk: "low"    },
            update_page:  { rateLimit: 30, risk: "low"    },
            read_page:    { rateLimit: 60, risk: "low"    },
            delete_page:  { rateLimit: 5,  risk: "high"   },
        },
        envKey: "NOTION_TOKEN",
        baseUrl: "https://api.notion.com/v1",
    },
    gdrive: {
        name: "Google Drive", icon: "📁", type: "storage",
        actions: {
            upload_file:  { rateLimit: 20, risk: "low"    },
            download_file:{ rateLimit: 30, risk: "low"    },
            list_files:   { rateLimit: 60, risk: "low"    },
            delete_file:  { rateLimit: 5,  risk: "high"   },
        },
        envKey: "GDRIVE_API_KEY",
        baseUrl: "https://www.googleapis.com/drive/v3",
    },
    telegram: {
        name: "Telegram", icon: "✈️", type: "comms",
        actions: {
            send_message:  { rateLimit: 30, risk: "low"  },
            send_document: { rateLimit: 10, risk: "low"  },
            read_updates:  { rateLimit: 60, risk: "low"  },
        },
        envKey: "TELEGRAM_TOKEN",
        baseUrl: "https://api.telegram.org",
    },
    openrouter: {
        name: "OpenRouter", icon: "🔀", type: "ai",
        actions: {
            chat_completion:   { rateLimit: 30, risk: "low"    },
            stream_completion: { rateLimit: 20, risk: "low"    },
            list_models:       { rateLimit: 60, risk: "low"    },
        },
        envKey: "OPENROUTER_API_KEY",
        baseUrl: "https://openrouter.ai/api/v1",
    },
    ollama: {
        name: "Ollama", icon: "🦙", type: "ai",
        actions: {
            generate:    { rateLimit: 10, risk: "low"  },
            chat:        { rateLimit: 15, risk: "low"  },
            list_models: { rateLimit: 60, risk: "low"  },
            pull_model:  { rateLimit: 2,  risk: "low"  },
        },
        envKey: null,   // local — no env key required
        baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    },
};

// Default permissions: low-risk read actions allowed; write/delete require explicit grant
function _defaultPerms(toolId) {
    const tool = TOOL_DEFS[toolId];
    if (!tool) return {};
    const out = {};
    for (const [action, def] of Object.entries(tool.actions)) {
        out[action] = def.risk === "low";   // low=allowed by default, medium/high=denied
    }
    return out;
}

function _getPerms(toolId) {
    if (!_perms[toolId]) {
        _perms[toolId] = _defaultPerms(toolId);
        _savePerms();
    }
    return _perms[toolId];
}

// ── Rate limiter (in-memory, per tool+action, per-minute) ────────────────
const _rateWindows = new Map();  // `${toolId}:${action}` → [timestamp, ...]
function _checkRate(toolId, action) {
    const def    = TOOL_DEFS[toolId]?.actions?.[action];
    const limit  = def?.rateLimit || 10;
    const key    = `${toolId}:${action}`;
    const now    = Date.now();
    const window = (_rateWindows.get(key) || []).filter(t => now - t < 60_000);
    if (window.length >= limit) {
        return { allowed: false, reason: `Rate limit ${limit}/min reached for ${toolId}.${action}` };
    }
    window.push(now);
    _rateWindows.set(key, window);
    return { allowed: true };
}

// ── Tool adapters ─────────────────────────────────────────────────────────
// Each adapter returns { success, output, rawResponse? }
// On missing credentials they return a graceful "not_configured" result
// instead of throwing — caller sees success:false with a clear reason.

function _httpJson(method, url, headers, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === "https:" ? https : http;
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search,
            method, headers: { "Content-Type": "application/json", ...headers, ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) },
        };
        const req = mod.request(opts, res => {
            let raw = "";
            res.on("data", d => raw += d);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

async function _runAdapter(toolId, action, params) {
    const token = TOOL_DEFS[toolId]?.envKey ? process.env[TOOL_DEFS[toolId].envKey] : "local";
    if (!token && TOOL_DEFS[toolId]?.envKey) {
        return { success: false, output: null, error: `not_configured: ${TOOL_DEFS[toolId].envKey} not set` };
    }

    try {
        switch (toolId) {
            // ── GitHub ──────────────────────────────────────────────────
            case "github": {
                const base    = TOOL_DEFS.github.baseUrl;
                const headers = { Authorization: `Bearer ${token}`, "User-Agent": "jarvis-os/1.0", Accept: "application/vnd.github+json" };
                if (action === "read_repo") {
                    const r = await _httpJson("GET", `${base}/repos/${params.owner}/${params.repo}`, headers);
                    return { success: r.status === 200, output: r.body?.full_name || r.body, error: r.status !== 200 ? JSON.stringify(r.body) : null };
                }
                if (action === "list_issues") {
                    const r = await _httpJson("GET", `${base}/repos/${params.owner}/${params.repo}/issues?state=${params.state||"open"}&per_page=20`, headers);
                    return { success: r.status === 200, output: Array.isArray(r.body) ? `${r.body.length} issues` : r.body, error: r.status !== 200 ? JSON.stringify(r.body) : null };
                }
                if (action === "create_pr") {
                    const r = await _httpJson("POST", `${base}/repos/${params.owner}/${params.repo}/pulls`, headers, { title: params.title, head: params.head, base: params.base || "main", body: params.body || "" });
                    return { success: r.status === 201, output: r.body?.html_url || r.body, error: r.status !== 201 ? JSON.stringify(r.body) : null };
                }
                if (action === "create_issue") {
                    const r = await _httpJson("POST", `${base}/repos/${params.owner}/${params.repo}/issues`, headers, { title: params.title, body: params.body || "" });
                    return { success: r.status === 201, output: r.body?.html_url || r.body, error: r.status !== 201 ? JSON.stringify(r.body) : null };
                }
                return { success: false, output: null, error: `unsupported github action: ${action}` };
            }

            // ── Slack ────────────────────────────────────────────────────
            case "slack": {
                const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" };
                if (action === "post_message") {
                    const r = await _httpJson("POST", `${TOOL_DEFS.slack.baseUrl}/chat.postMessage`, headers, { channel: params.channel, text: params.text });
                    return { success: !!r.body?.ok, output: r.body?.ts || null, error: r.body?.error || null };
                }
                if (action === "read_channel") {
                    const r = await _httpJson("GET", `${TOOL_DEFS.slack.baseUrl}/conversations.history?channel=${params.channel}&limit=${params.limit||10}`, headers);
                    return { success: !!r.body?.ok, output: r.body?.messages?.length || 0, error: r.body?.error || null };
                }
                return { success: false, output: null, error: `unsupported slack action: ${action}` };
            }

            // ── Telegram ─────────────────────────────────────────────────
            case "telegram": {
                if (action === "send_message") {
                    const r = await _httpJson("POST", `${TOOL_DEFS.telegram.baseUrl}/bot${token}/sendMessage`, {}, { chat_id: params.chat_id, text: params.text, parse_mode: params.parse_mode || "Markdown" });
                    return { success: !!r.body?.ok, output: r.body?.result?.message_id || null, error: r.body?.description || null };
                }
                if (action === "read_updates") {
                    const r = await _httpJson("GET", `${TOOL_DEFS.telegram.baseUrl}/bot${token}/getUpdates?limit=${params.limit||10}`, {});
                    return { success: !!r.body?.ok, output: r.body?.result?.length || 0, error: r.body?.description || null };
                }
                return { success: false, output: null, error: `unsupported telegram action: ${action}` };
            }

            // ── OpenRouter ───────────────────────────────────────────────
            case "openrouter": {
                const headers = { Authorization: `Bearer ${token}`, "HTTP-Referer": "https://ooplix.com", "X-Title": "Jarvis-OS" };
                if (action === "chat_completion") {
                    const r = await _httpJson("POST", `${TOOL_DEFS.openrouter.baseUrl}/chat/completions`, headers, {
                        model:    params.model || "anthropic/claude-haiku-4-5",
                        messages: params.messages || [{ role: "user", content: params.prompt || "Hello" }],
                        max_tokens: params.max_tokens || 512,
                    });
                    const content = r.body?.choices?.[0]?.message?.content || null;
                    return { success: !!content, output: content, error: r.body?.error?.message || (content ? null : "no response") };
                }
                if (action === "list_models") {
                    const r = await _httpJson("GET", `${TOOL_DEFS.openrouter.baseUrl}/models`, headers);
                    return { success: !!r.body?.data, output: `${r.body?.data?.length || 0} models available`, error: null };
                }
                return { success: false, output: null, error: `unsupported openrouter action: ${action}` };
            }

            // ── Ollama ────────────────────────────────────────────────────
            case "ollama": {
                if (action === "list_models") {
                    const r = await _httpJson("GET", `${TOOL_DEFS.ollama.baseUrl}/api/tags`, {});
                    return { success: !!r.body?.models, output: `${r.body?.models?.length || 0} local models`, error: null };
                }
                if (action === "generate") {
                    const r = await _httpJson("POST", `${TOOL_DEFS.ollama.baseUrl}/api/generate`, {}, { model: params.model || "llama3", prompt: params.prompt || "", stream: false });
                    return { success: !!r.body?.response, output: (r.body?.response || "").slice(0, 500), error: r.body?.error || null };
                }
                if (action === "chat") {
                    const r = await _httpJson("POST", `${TOOL_DEFS.ollama.baseUrl}/api/chat`, {}, { model: params.model || "llama3", messages: params.messages || [{ role: "user", content: params.prompt || "" }], stream: false });
                    const content = r.body?.message?.content || null;
                    return { success: !!content, output: (content || "").slice(0, 500), error: r.body?.error || null };
                }
                return { success: false, output: null, error: `unsupported ollama action: ${action}` };
            }

            // ── Notion / GDrive / Gmail ───────────────────────────────────
            // These require OAuth flows not available server-side without per-user
            // token storage. Scaffold returns not_configured until OAuth is wired.
            case "notion":
            case "gdrive":
            case "gmail":
                return { success: false, output: null, error: `not_configured: ${toolId} requires OAuth token — set ${TOOL_DEFS[toolId].envKey}` };

            default:
                return { success: false, output: null, error: `unknown tool: ${toolId}` };
        }
    } catch (err) {
        return { success: false, output: null, error: err.message };
    }
}

// ── Retry with exponential backoff ───────────────────────────────────────
async function _withRetry(fn, maxRetries = 2, baseDelayMs = 500) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            if (result.success) return { result, attempts: attempt + 1 };
            // Non-transient errors: don't retry permission/not_configured failures
            if (result.error && (result.error.includes("not_configured") || result.error.includes("unsupported"))) {
                return { result, attempts: attempt + 1 };
            }
            lastErr = result.error;
        } catch (e) { lastErr = e.message; }
        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        }
    }
    return { result: { success: false, output: null, error: lastErr }, attempts: maxRetries + 1 };
}

// ── Main execute ─────────────────────────────────────────────────────────
async function execute(toolId, action, params = {}, opts = {}) {
    const callId    = _id();
    const startedAt = new Date().toISOString();
    const start     = Date.now();

    // Validate tool + action exist
    if (!TOOL_DEFS[toolId]) return { callId, success: false, error: `Unknown tool: ${toolId}`, durationMs: 0 };
    if (!TOOL_DEFS[toolId].actions[action]) return { callId, success: false, error: `Unknown action: ${toolId}.${action}`, durationMs: 0 };

    // Permission check
    const perms = _getPerms(toolId);
    if (perms[action] === false) {
        const rec = { callId, toolId, action, success: false, error: "permission_denied", startedAt, durationMs: 0, params: _sanitizeParams(params) };
        _usage.push(rec); _saveUsage();
        auditLog.append({ type: "tool_denied", callId, toolId, action });
        return { callId, success: false, error: `permission_denied: ${toolId}.${action} is not allowed`, durationMs: 0 };
    }

    // Rate limit check
    const rate = _checkRate(toolId, action);
    if (!rate.allowed) {
        return { callId, success: false, error: rate.reason, durationMs: 0 };
    }

    // Execute with retry
    const maxRetries = opts.maxRetries ?? (TOOL_DEFS[toolId].actions[action].risk === "high" ? 0 : 2);
    const { result, attempts } = await _withRetry(() => _runAdapter(toolId, action, params), maxRetries);
    const durationMs = Date.now() - start;

    // Record usage
    const usageRec = {
        callId, toolId, action, success: result.success,
        error:     result.error  || null,
        output:    typeof result.output === "string" ? result.output.slice(0, 200) : JSON.stringify(result.output || "").slice(0, 200),
        startedAt, durationMs, attempts,
        params:    _sanitizeParams(params),
        agentId:   opts.agentId || null,
        cycleId:   opts.cycleId || null,
    };
    _usage.push(usageRec);
    _saveUsage();

    // Record failure
    if (!result.success) {
        _failures.push({ ...usageRec, ts: new Date().toISOString() });
        _saveFailures();
        logger.warn(`[ToolExec] FAIL ${toolId}.${action} — ${result.error}`);
    }

    execLog.append({ agentId: opts.agentId || "tool_layer", taskType: `tool:${toolId}.${action}`, taskId: callId, success: result.success, durationMs, error: result.error });
    auditLog.append({ type: result.success ? "tool_success" : "tool_failure", callId, toolId, action, durationMs, attempts });

    return { callId, success: result.success, output: result.output, error: result.error, durationMs, attempts };
}

function _sanitizeParams(params) {
    // Strip any credential-like keys before storing
    const safe = { ...params };
    for (const k of Object.keys(safe)) {
        if (/token|secret|key|password|auth/i.test(k)) safe[k] = "[redacted]";
    }
    return safe;
}

// ── Permission management ────────────────────────────────────────────────
function getPermissions(toolId) {
    return { toolId, permissions: _getPerms(toolId), defaults: _defaultPerms(toolId) };
}

function setPermission(toolId, action, allowed) {
    if (!TOOL_DEFS[toolId]) throw new Error(`Unknown tool: ${toolId}`);
    if (!_perms[toolId]) _perms[toolId] = _defaultPerms(toolId);
    _perms[toolId][action] = !!allowed;
    _savePerms();
    auditLog.append({ type: "permission_change", toolId, action, allowed });
}

// ── Usage / failure queries ──────────────────────────────────────────────
function getUsage(toolId, { limit = 100, action } = {}) {
    let rows = toolId ? _usage.filter(u => u.toolId === toolId) : _usage;
    if (action) rows = rows.filter(u => u.action === action);
    rows = [...rows].reverse().slice(0, limit);
    const success = rows.filter(u => u.success).length;
    return { calls: rows, stats: { total: rows.length, success, failed: rows.length - success, successRate: rows.length ? Math.round(success / rows.length * 100) : 0 } };
}

function getFailures({ toolId, limit = 100 } = {}) {
    let rows = toolId ? _failures.filter(f => f.toolId === toolId) : _failures;
    rows = [...rows].reverse().slice(0, limit);
    // Cluster by error prefix
    const patterns = new Map();
    for (const f of rows) {
        const key = (f.error || "unknown").slice(0, 60);
        const p = patterns.get(key) || { error: key, count: 0, tools: new Set(), lastSeen: null };
        p.count++; p.tools.add(f.toolId); p.lastSeen = f.ts;
        patterns.set(key, p);
    }
    return {
        failures: rows,
        patterns: Array.from(patterns.values()).map(p => ({ ...p, tools: Array.from(p.tools) })).sort((a, b) => b.count - a.count),
        total: rows.length,
    };
}

function listTools() {
    return Object.entries(TOOL_DEFS).map(([id, def]) => {
        const calls    = _usage.filter(u => u.toolId === id);
        const today    = calls.filter(u => u.startedAt >= new Date(Date.now() - 86400_000).toISOString());
        const failed   = calls.filter(u => !u.success);
        const configured = def.envKey ? !!process.env[def.envKey] : true;
        return {
            id, name: def.name, icon: def.icon, type: def.type,
            configured, actionCount: Object.keys(def.actions).length,
            totalCalls: calls.length, callsToday: today.length,
            failRate: calls.length ? `${Math.round(failed.length / calls.length * 100)}%` : "0%",
        };
    });
}

function toolStatus() {
    const out = {};
    for (const [id] of Object.entries(TOOL_DEFS)) {
        const calls  = _usage.filter(u => u.toolId === id);
        const today  = calls.filter(u => u.startedAt >= new Date(Date.now() - 86400_000).toISOString());
        const failed = calls.filter(u => !u.success);
        out[id] = {
            configured:  TOOL_DEFS[id].envKey ? !!process.env[TOOL_DEFS[id].envKey] : true,
            callsToday:  today.length,
            totalCalls:  calls.length,
            failRate:    calls.length ? Math.round(failed.length / calls.length * 100) : 0,
        };
    }
    return out;
}

module.exports = { execute, getPermissions, setPermission, getUsage, getFailures, listTools, toolStatus };
