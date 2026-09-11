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

// Phase 7 (test fixture concurrency reliability) — see the identical
// comment in agentInstanceRegistry.cjs. JARVIS_TEST_DATA_SUFFIX isolates
// these 3 files per test process; unset means the real, unchanged paths.
const _testSuffix = process.env.JARVIS_TEST_DATA_SUFFIX ? `.${process.env.JARVIS_TEST_DATA_SUFFIX}` : "";
const USAGE_FILE   = path.join(__dirname, `../../data/tool-usage${_testSuffix}.json`);
const PERM_FILE    = path.join(__dirname, `../../data/tool-permissions${_testSuffix}.json`);
const FAILURE_FILE = path.join(__dirname, `../../data/tool-failures${_testSuffix}.json`);

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
    // Universal Composition Engine Phase 6 (Tool Fabric): wraps the
    // existing backend/core/safe-exec.js allowlisted OS-command execution
    // primitive as a first-class tool, instead of the 4+ separate ad hoc
    // wrappers previously scattered across agents/terminalAgent.cjs,
    // agents/runtime/adapters/terminalExecutionAdapter.cjs, and
    // engineeringCapabilities.cjs's own local _exec helper. Does not
    // replace safe-exec.js's allowlist/validation — this is a single,
    // shared entry point in front of it. High risk by construction (raw
    // OS command execution): denied by default, exactly like every other
    // high-risk action here.
    "system:exec": {
        name: "System Exec (safe-exec)", icon: "🖥️", type: "system",
        actions: {
            run: { rateLimit: 30, risk: "high" },
        },
        envKey: null,
        baseUrl: null,
    },
    // Project Management Ecosystem mission: Jira/Linear already had real
    // identity probes (integrationConnectors.cjs's connectJira/connectLinear)
    // and vault credential mappings (secretVault.cjs's issue:jira/issue:linear)
    // wired by an earlier mission, and this repo's own product-strategy docs
    // (docs/ooplix/23_PRODUCT_REPLACEMENT_MATRIX.md) explicitly conclude real
    // Jira/Linear sync — not an internal Kanban board — is the correct
    // direction, citing CLAUDE.md §16's caution against duplicate
    // architecture. Unlike Notion, neither had a TOOL_DEFS entry yet; both
    // are added here following the exact same static-envKey shape GitHub
    // already uses (simple token auth, no OAuth complexity for either
    // provider). Scope kept to the well-established issue-CRUD core the
    // mission brief names — no sprints/boards/cycles/JQL search invented.
    jira: {
        name: "Jira", icon: "📋", type: "issues",
        actions: {
            create_issue: { rateLimit: 20, risk: "low"    },
            read_issue:   { rateLimit: 60, risk: "low"    },
            update_issue: { rateLimit: 30, risk: "low"    },
            add_comment:  { rateLimit: 30, risk: "low"    },
        },
        envKey: "JIRA_API_TOKEN",
        baseUrl: null, // per-site: https://{JIRA_HOST}/rest/api/3
    },
    linear: {
        name: "Linear", icon: "📐", type: "issues",
        actions: {
            create_issue: { rateLimit: 20, risk: "low" },
            read_issue:   { rateLimit: 60, risk: "low" },
            update_issue: { rateLimit: 30, risk: "low" },
            list_issues:  { rateLimit: 60, risk: "low" },
        },
        envKey: "LINEAR_API_KEY",
        baseUrl: "https://api.linear.app/graphql",
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

// ── Org/agent-scoped permission overlay (Universal Composition Engine
// Phase 6). Additive: the existing _perms map above stays the platform-
// wide default exactly as before (unchanged for any caller that doesn't
// pass a scope). A scoped grant, when present, takes precedence over the
// global default for that (orgId, agentInstanceId) pair — this is what
// lets an AgentInstance (agentInstanceRegistry.cjs) get only the tools
// its own company/org has been granted, rather than every agent
// inheriting the same platform-wide toggle. ─────────────────────────────
function _scopeKey(orgId, agentInstanceId) {
    return `${orgId || "*"}::${agentInstanceId || "*"}`;
}

function _getScopedPerm(toolId, action, orgId, agentInstanceId) {
    if (!orgId && !agentInstanceId) return undefined; // no scope requested
    const scoped = _perms.__scoped?.[toolId]?.[_scopeKey(orgId, agentInstanceId)];
    return scoped ? scoped[action] : undefined;
}

/**
 * Grant/deny a tool action for a specific org/agent instance, without
 * touching the platform-wide default. Pass agentInstanceId:null to scope
 * to the whole org.
 */
function setScopedPermission(toolId, action, allowed, { orgId, agentInstanceId } = {}) {
    if (!TOOL_DEFS[toolId]) throw new Error(`Unknown tool: ${toolId}`);
    if (!orgId) throw new Error("orgId is required for a scoped permission");
    if (!_perms.__scoped) _perms.__scoped = {};
    if (!_perms.__scoped[toolId]) _perms.__scoped[toolId] = {};
    const key = _scopeKey(orgId, agentInstanceId);
    if (!_perms.__scoped[toolId][key]) _perms.__scoped[toolId][key] = {};
    _perms.__scoped[toolId][key][action] = !!allowed;
    _savePerms();
    auditLog.append({ type: "scoped_permission_change", toolId, action, allowed, orgId, agentInstanceId: agentInstanceId || null });
}

/**
 * Resolves whether (orgId, agentInstanceId) may perform toolId.action.
 * Precedence: agent-instance-specific grant > org-wide grant > platform
 * default (_getPerms). Returns a boolean, never throws for an unknown
 * scope — absence of a scoped grant simply falls through to the default.
 */
function resolvePermission(toolId, action, { orgId, agentInstanceId } = {}) {
    if (!TOOL_DEFS[toolId]) return false;
    if (agentInstanceId) {
        const instanceGrant = _getScopedPerm(toolId, action, orgId, agentInstanceId);
        if (instanceGrant !== undefined) return instanceGrant;
    }
    if (orgId) {
        const orgGrant = _getScopedPerm(toolId, action, orgId, null);
        if (orgGrant !== undefined) return orgGrant;
    }
    return !!_getPerms(toolId)[action];
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

// Project Management Ecosystem mission: this is the single shared HTTP
// function every real tool in this file uses (GitHub, Slack, Telegram,
// OpenRouter, Notion, Gmail, GDrive, and now Jira/Linear — 34 call sites)
// and it had NO timeout at all — confirmed live while writing this
// mission's own Jira test: a request to an unresponsive/nonexistent host
// hung for over a minute on the underlying TCP connection attempt before
// the OS-level timeout finally surfaced a real (but very slow) rejection.
// Added a bounded timeout at this one shared choke point, matching the
// pattern already established in storageService.cjs's _httpsReq
// (req.setTimeout + destroy with a real Error) rather than inventing a new
// timeout convention — fixes this gap for every one of the 34 call sites
// at once, not just the 2 new ones this mission added.
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
function _httpJson(method, url, headers, body, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
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
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

// Google Ecosystem mission: Gmail/GDrive resolve their token via the
// existing real "google" OAuth2 connection in oauthIntegrationLayer.cjs
// (gmail.readonly/drive.readonly scopes were already being requested —
// nothing redeemed them until now) instead of the single envKey/global
// token every other tool here uses, since Gmail/Drive are genuinely
// per-user OAuth, not a single bot/PAT. userId defaults to "founder",
// the same single-tenant identity convention founderVault.js's own
// GET /vault/oauth/:provider/authorize route already uses.
async function _googleToken(userId = "founder") {
    try {
        const oauth = require("./oauthIntegrationLayer.cjs");
        const rec = await oauth.getToken("google", userId);
        return rec?.access_token || null;
    } catch {
        return null;
    }
}

// Productivity Ecosystem mission: matches integrationConnectors.cjs's
// connectNotion() token-resolution order exactly (direct integration token
// first, OAuth as fallback) rather than inventing a narrower single-path
// helper — Notion genuinely supports both an internal-integration API key
// and a real user-facing OAuth connection, unlike Gmail/Drive which are
// OAuth-only, so _googleToken()'s single-path shape doesn't fit here.
async function _notionToken() {
    const direct = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
    if (direct) return direct;
    try {
        const oauth = require("./oauthIntegrationLayer.cjs");
        const conns = oauth.listConnections().filter(c => c.provider === "notion");
        if (conns.length === 0) return null;
        const rec = await oauth.getToken("notion", conns[0].userId);
        return rec?.access_token || null;
    } catch {
        return null;
    }
}

async function _runAdapter(toolId, action, params, opts = {}) {
    const token = TOOL_DEFS[toolId]?.envKey ? process.env[TOOL_DEFS[toolId].envKey] : "local";
    // gmail/gdrive/notion intentionally skip the single-envKey precheck
    // below — their real credential check happens per-adapter (via
    // _googleToken()/_notionToken()) once execution reaches their case,
    // since their token can be resolved from a stored OAuth connection, not
    // only a static process.env value. Notion additionally accepts
    // NOTION_API_KEY as a direct-token alternative to NOTION_TOKEN (see
    // _notionToken()) — the single static envKey precheck can't express
    // either fallback, so it would wrongly reject a caller who has a real
    // OAuth connection or set NOTION_API_KEY instead of NOTION_TOKEN.
    if (!token && TOOL_DEFS[toolId]?.envKey && toolId !== "gmail" && toolId !== "gdrive" && toolId !== "notion") {
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

            // ── Notion (real api.notion.com/v1 calls) ─────────────────────
            // Productivity Ecosystem mission: the prior Google-ecosystem
            // mission correctly deferred this as out of its own scope,
            // leaving the pre-existing stub in place rather than building
            // unrelated scope. Notion's OAuth (with matched
            // read_content/update_content/insert_content scopes) already
            // exists in oauthIntegrationLayer.cjs, and TOOL_DEFS.notion
            // above already declares the exact 4 actions (create/update/
            // read/delete_page) with correct risk levels and the real
            // api.notion.com/v1 baseUrl — this pass completes the one piece
            // that was missing: the actual HTTP calls. Notion has no true
            // delete API; "delete_page" archives the page (archived:true),
            // Notion's own documented equivalent, reversible via the same
            // endpoint — never silently reinterpreted as a permanent
            // destructive call.
            case "notion": {
                const nToken = await _notionToken();
                if (!nToken) return { success: false, output: null, error: "not_configured: notion requires a connected account — GET /vault/oauth/notion/authorize, or set NOTION_API_KEY" };
                const headers = { Authorization: `Bearer ${nToken}`, "Notion-Version": "2022-06-28" };
                const base = TOOL_DEFS.notion.baseUrl;

                if (action === "read_page") {
                    if (!params.pageId) return { success: false, output: null, error: "pageId required" };
                    const r = await _httpJson("GET", `${base}/pages/${params.pageId}`, headers);
                    return { success: r.status === 200, output: r.status === 200 ? r.body : null, error: r.status !== 200 ? (r.body?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "create_page") {
                    if (!params.parentId) return { success: false, output: null, error: "parentId required (a database or page id)" };
                    const parent = params.parentType === "page_id" ? { page_id: params.parentId } : { database_id: params.parentId };
                    const properties = params.properties || { title: { title: [{ text: { content: params.title || "Untitled" } }] } };
                    const r = await _httpJson("POST", `${base}/pages`, headers, { parent, properties });
                    return { success: r.status === 200, output: r.body?.id || r.body, error: r.status !== 200 ? (r.body?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "update_page") {
                    if (!params.pageId) return { success: false, output: null, error: "pageId required" };
                    if (!params.properties) return { success: false, output: null, error: "properties required" };
                    const r = await _httpJson("PATCH", `${base}/pages/${params.pageId}`, headers, { properties: params.properties });
                    return { success: r.status === 200, output: r.body?.id || r.body, error: r.status !== 200 ? (r.body?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "delete_page") {
                    if (!params.pageId) return { success: false, output: null, error: "pageId required" };
                    const r = await _httpJson("PATCH", `${base}/pages/${params.pageId}`, headers, { archived: true });
                    return { success: r.status === 200, output: r.status === 200 ? "archived" : r.body, error: r.status !== 200 ? (r.body?.message || JSON.stringify(r.body)) : null };
                }
                return { success: false, output: null, error: `unsupported notion action: ${action}` };
            }

            // ── Gmail (real gmail.googleapis.com calls) ───────────────────
            case "gmail": {
                const gToken = await _googleToken(opts.userId);
                if (!gToken) return { success: false, output: null, error: "not_configured: gmail requires a connected Google account — GET /vault/oauth/google/authorize, or set GMAIL_API_KEY is not sufficient (Gmail requires OAuth, not an API key)" };
                const headers = { Authorization: `Bearer ${gToken}` };
                const base = TOOL_DEFS.gmail.baseUrl;

                if (action === "send_email") {
                    if (!params.to || !params.subject) return { success: false, output: null, error: "to and subject required" };
                    const raw = Buffer.from(
                        `To: ${params.to}\r\nSubject: ${params.subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${params.body || ""}`
                    ).toString("base64url");
                    const r = await _httpJson("POST", `${base}/gmail/v1/users/me/messages/send`, headers, { raw });
                    return { success: r.status === 200, output: r.body?.id || r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "read_inbox") {
                    const r = await _httpJson("GET", `${base}/gmail/v1/users/me/messages?maxResults=${params.limit || 10}`, headers);
                    return { success: r.status === 200, output: Array.isArray(r.body?.messages) ? `${r.body.messages.length} messages` : r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "search_mail") {
                    if (!params.query) return { success: false, output: null, error: "query required" };
                    const r = await _httpJson("GET", `${base}/gmail/v1/users/me/messages?q=${encodeURIComponent(params.query)}&maxResults=${params.limit || 10}`, headers);
                    return { success: r.status === 200, output: Array.isArray(r.body?.messages) ? `${r.body.messages.length} messages` : r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "reply_email") {
                    if (!params.messageId || !params.body) return { success: false, output: null, error: "messageId and body required" };
                    const raw = Buffer.from(`In-Reply-To: ${params.messageId}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${params.body}`).toString("base64url");
                    const r = await _httpJson("POST", `${base}/gmail/v1/users/me/messages/send`, headers, { raw, threadId: params.threadId });
                    return { success: r.status === 200, output: r.body?.id || r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                return { success: false, output: null, error: `unsupported gmail action: ${action}` };
            }

            // ── Google Drive (real googleapis.com/drive/v3 calls) ─────────
            case "gdrive": {
                const gToken = await _googleToken(opts.userId);
                if (!gToken) return { success: false, output: null, error: "not_configured: gdrive requires a connected Google account — GET /vault/oauth/google/authorize" };
                const headers = { Authorization: `Bearer ${gToken}` };
                const base = TOOL_DEFS.gdrive.baseUrl;

                if (action === "list_files") {
                    const q = params.query ? `&q=${encodeURIComponent(params.query)}` : "";
                    const r = await _httpJson("GET", `${base}/files?pageSize=${params.limit || 20}&fields=files(id,name,mimeType)${q}`, headers);
                    return { success: r.status === 200, output: Array.isArray(r.body?.files) ? `${r.body.files.length} files` : r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "download_file") {
                    if (!params.fileId) return { success: false, output: null, error: "fileId required" };
                    const r = await _httpJson("GET", `${base}/files/${params.fileId}?alt=media`, headers);
                    return { success: r.status === 200, output: typeof r.body === "string" ? `${r.body.length} bytes` : r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "upload_file") {
                    // Metadata-only create (real API, real file object) — a
                    // full resumable multipart upload with real file bytes
                    // is a genuinely larger feature (same "smallest adapter"
                    // scoping used throughout this mission's social batches);
                    // this creates a real Drive file record callers can then
                    // populate, not a fabricated success.
                    if (!params.name) return { success: false, output: null, error: "name required" };
                    const r = await _httpJson("POST", `${base}/files`, headers, { name: params.name, mimeType: params.mimeType || "text/plain" });
                    return { success: r.status === 200, output: r.body?.id || r.body, error: r.status !== 200 ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "delete_file") {
                    if (!params.fileId) return { success: false, output: null, error: "fileId required" };
                    const r = await _httpJson("DELETE", `${base}/files/${params.fileId}`, headers);
                    return { success: r.status === 204 || r.status === 200, output: r.status === 204 ? "deleted" : r.body, error: (r.status !== 204 && r.status !== 200) ? (r.body?.error?.message || JSON.stringify(r.body)) : null };
                }
                return { success: false, output: null, error: `unsupported gdrive action: ${action}` };
            }

            // ── System Exec (wraps backend/core/safe-exec.js) ─────────────
            case "system:exec": {
                if (action !== "run") return { success: false, output: null, error: `unsupported system:exec action: ${action}` };
                const safeExec = require("../core/safe-exec.js");
                const result = await safeExec.run(params.cmd, params.args || [], { cwd: params.cwd, timeoutMs: params.timeoutMs });
                if (result.blocked) return { success: false, output: null, error: `blocked: ${result.reason}` };
                return { success: result.exitCode === 0, output: result.stdout || result.stderr, error: result.exitCode !== 0 ? (result.stderr || `exit code ${result.exitCode}`) : null };
            }

            // ── Jira (real {JIRA_HOST}/rest/api/3 calls) ──────────────────
            // Jira Cloud uses HTTP Basic auth with email + API token, not a
            // bearer token — matches connectJira()'s existing auth shape in
            // integrationConnectors.cjs exactly, reusing the same 3 env vars
            // rather than inventing a second credential convention. JIRA_HOST
            // is per-site (not a single global baseUrl like GitHub's), so it
            // is read directly here rather than baked into TOOL_DEFS.
            case "jira": {
                const host  = process.env.JIRA_HOST;
                const email = process.env.JIRA_EMAIL;
                if (!host || !email || !token) return { success: false, output: null, error: "not_configured: JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN must all be set" };
                const authHeader = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
                const base = `https://${host}/rest/api/3`;

                if (action === "read_issue") {
                    if (!params.issueKey) return { success: false, output: null, error: "issueKey required" };
                    const r = await _httpJson("GET", `${base}/issue/${params.issueKey}`, authHeader);
                    return { success: r.status === 200, output: r.status === 200 ? r.body : null, error: r.status !== 200 ? (r.body?.errorMessages?.[0] || JSON.stringify(r.body)) : null };
                }
                if (action === "create_issue") {
                    if (!params.projectKey || !params.summary) return { success: false, output: null, error: "projectKey and summary required" };
                    const fields = {
                        project: { key: params.projectKey },
                        summary: params.summary,
                        issuetype: { name: params.issueType || "Task" },
                        ...(params.description ? { description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: params.description }] }] } } : {}),
                    };
                    const r = await _httpJson("POST", `${base}/issue`, authHeader, { fields });
                    return { success: r.status === 201, output: r.body?.key || r.body, error: r.status !== 201 ? (r.body?.errorMessages?.[0] || JSON.stringify(r.body)) : null };
                }
                if (action === "update_issue") {
                    if (!params.issueKey) return { success: false, output: null, error: "issueKey required" };
                    if (!params.fields) return { success: false, output: null, error: "fields required" };
                    const r = await _httpJson("PUT", `${base}/issue/${params.issueKey}`, authHeader, { fields: params.fields });
                    return { success: r.status === 204, output: r.status === 204 ? "updated" : r.body, error: r.status !== 204 ? (r.body?.errorMessages?.[0] || JSON.stringify(r.body)) : null };
                }
                if (action === "add_comment") {
                    if (!params.issueKey || !params.body) return { success: false, output: null, error: "issueKey and body required" };
                    const r = await _httpJson("POST", `${base}/issue/${params.issueKey}/comment`, authHeader, {
                        body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: params.body }] }] },
                    });
                    return { success: r.status === 201, output: r.body?.id || r.body, error: r.status !== 201 ? (r.body?.errorMessages?.[0] || JSON.stringify(r.body)) : null };
                }
                return { success: false, output: null, error: `unsupported jira action: ${action}` };
            }

            // ── Linear (real api.linear.app/graphql calls) ────────────────
            // Linear's API is GraphQL-only — matches connectLinear()'s
            // existing probe shape (a single POST with a query/mutation
            // string), same auth header convention (raw API key, not
            // "Bearer "-prefixed, per Linear's own documented API contract).
            case "linear": {
                const headers = { Authorization: token, "Content-Type": "application/json" };
                const base = TOOL_DEFS.linear.baseUrl;

                if (action === "read_issue") {
                    if (!params.issueId) return { success: false, output: null, error: "issueId required" };
                    const r = await _httpJson("POST", base, headers, {
                        query: `query($id: String!) { issue(id: $id) { id identifier title state { name } } }`,
                        variables: { id: params.issueId },
                    });
                    const issue = r.body?.data?.issue;
                    return { success: !!issue, output: issue || null, error: !issue ? (r.body?.errors?.[0]?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "create_issue") {
                    if (!params.teamId || !params.title) return { success: false, output: null, error: "teamId and title required" };
                    const r = await _httpJson("POST", base, headers, {
                        query: `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier } } }`,
                        variables: { input: { teamId: params.teamId, title: params.title, description: params.description || undefined } },
                    });
                    const result = r.body?.data?.issueCreate;
                    return { success: !!result?.success, output: result?.issue || null, error: !result?.success ? (r.body?.errors?.[0]?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "update_issue") {
                    if (!params.issueId) return { success: false, output: null, error: "issueId required" };
                    if (!params.input) return { success: false, output: null, error: "input required" };
                    const r = await _httpJson("POST", base, headers, {
                        query: `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
                        variables: { id: params.issueId, input: params.input },
                    });
                    const result = r.body?.data?.issueUpdate;
                    return { success: !!result?.success, output: result || null, error: !result?.success ? (r.body?.errors?.[0]?.message || JSON.stringify(r.body)) : null };
                }
                if (action === "list_issues") {
                    const r = await _httpJson("POST", base, headers, {
                        query: `query($first: Int) { issues(first: $first) { nodes { id identifier title state { name } } } }`,
                        variables: { first: params.limit || 20 },
                    });
                    const nodes = r.body?.data?.issues?.nodes;
                    return { success: Array.isArray(nodes), output: Array.isArray(nodes) ? `${nodes.length} issues` : r.body, error: !Array.isArray(nodes) ? (r.body?.errors?.[0]?.message || JSON.stringify(r.body)) : null };
                }
                return { success: false, output: null, error: `unsupported linear action: ${action}` };
            }

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

    // Permission check — org/agent-instance scoped grant takes precedence
    // over the platform-wide default when opts.orgId/opts.agentInstanceId
    // are provided (Phase 6); unscoped callers behave exactly as before.
    const allowed = (opts.orgId || opts.agentInstanceId)
        ? resolvePermission(toolId, action, { orgId: opts.orgId, agentInstanceId: opts.agentInstanceId })
        : _getPerms(toolId)[action] !== false;
    if (!allowed) {
        const rec = { callId, toolId, action, success: false, error: "permission_denied", startedAt, durationMs: 0, params: _sanitizeParams(params), orgId: opts.orgId || null, agentInstanceId: opts.agentInstanceId || null };
        _usage.push(rec); _saveUsage();
        auditLog.append({ type: "tool_denied", callId, toolId, action, orgId: opts.orgId || null, agentInstanceId: opts.agentInstanceId || null });
        return { callId, success: false, error: `permission_denied: ${toolId}.${action} is not allowed`, durationMs: 0 };
    }

    // Phase 2 (Agent Identity, Mission 121-124): opts.agentId was already
    // threaded through this function for audit/logging (usageRec.agentId,
    // execLog) but never checked against the agent's own allowlist — any
    // agentId could invoke any tool the platform-wide/org grant above
    // allowed. agentRegistry.AgentRecord.allowedTools defaults to null
    // (unrestricted) for every agent that doesn't set it, so this is a
    // no-op for all current production agents (see bootstrapRuntime.cjs)
    // and only takes effect once an agent is explicitly given a
    // restricted allowlist. Lazy require avoids a hard dependency from
    // backend/services on agents/runtime at module-load time.
    if (opts.agentId) {
        let registryAgent = null;
        try { registryAgent = require("../../agents/runtime/agentRegistry.cjs").get(opts.agentId); } catch { /* registry not loaded in this process */ }
        if (registryAgent && !registryAgent.canUseTool(toolId)) {
            const rec = { callId, toolId, action, success: false, error: "agent_not_allowed", startedAt, durationMs: 0, params: _sanitizeParams(params), agentId: opts.agentId };
            _usage.push(rec); _saveUsage();
            auditLog.append({ type: "tool_denied_agent_identity", callId, toolId, action, agentId: opts.agentId });
            return { callId, success: false, error: `agent_not_allowed: agent "${opts.agentId}" is not permitted to use ${toolId}`, durationMs: 0 };
        }
    }

    // Rate limit check
    const rate = _checkRate(toolId, action);
    if (!rate.allowed) {
        return { callId, success: false, error: rate.reason, durationMs: 0 };
    }

    // Execute with retry
    const maxRetries = opts.maxRetries ?? (TOOL_DEFS[toolId].actions[action].risk === "high" ? 0 : 2);
    const { result, attempts } = await _withRetry(() => _runAdapter(toolId, action, params, opts), maxRetries);
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

module.exports = {
    execute, getPermissions, setPermission, getUsage, getFailures, listTools, toolStatus,
    // Phase 6 additions (org/agent-scoped permission overlay)
    setScopedPermission, resolvePermission,
};
