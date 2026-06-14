"use strict";
/**
 * D5 — Plugin SDK, Capability Registry, and API Manifest
 *
 * Section 1 — Plugin SDK
 *   registerPlugin(plugin)          → { pluginId, registered: true }
 *   unregisterPlugin(pluginId)      → { pluginId, unregistered: true }
 *   getPlugin(pluginId)             → plugin | null
 *   listPlugins(opts)               → { plugins[], total }
 *   executeHook(hookName, ...args)  → results[]
 *   getPluginRoutes()               → routeDef[]
 *
 * Section 2 — Capability Registry
 *   registerCapability(id, meta)    → { capId }
 *   getCapability(capId)            → meta | null
 *   listCapabilities(opts)          → { capabilities[], total }
 *   findByCapability(capabilityName)→ { agents[], plugins[] }
 *   getCapabilityMap()              → { [capabilityName]: [providerId, ...] }
 *
 * Section 3 — API Manifest
 *   generateManifest()              → { version, generatedAt, endpoints[] }
 *   getManifest()                   → cached manifest (TTL 1h)
 *   getEndpoint(method, path)       → endpoint | null
 *   searchEndpoints(query)          → { endpoints[] }
 *
 * Section 4 — Template System Extension
 *   registerTemplate(template)      → { templateId }
 *   listTemplates(category)         → template[]
 *   instantiateTemplate(id, vars)   → filledTemplate
 *
 * Persistence:
 *   data/plugin-registry.json
 *   data/capability-registry.json
 *   data/api-manifest.json
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Paths ─────────────────────────────────────────────────────────────────────

const DATA_DIR        = path.join(__dirname, "../../data");
const PLUGIN_FILE     = path.join(DATA_DIR, "plugin-registry.json");
const CAP_FILE        = path.join(DATA_DIR, "capability-registry.json");
const MANIFEST_FILE   = path.join(DATA_DIR, "api-manifest.json");

function _ensureData() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Generic persistence helpers ───────────────────────────────────────────────

function _loadJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return fallback; }
}

function _saveJson(file, data) {
    _ensureData();
    const tmp = file + ".tmp";
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.unlinkSync(tmp); } catch {}
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — PLUGIN SDK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory plugin store: id → { meta, hooks, routes }
 * meta mirrors the JSON-serialisable subset stored on disk.
 */
const _plugins = new Map(); // pluginId → full plugin object (with functions)

const VALID_HOOKS = [
    "onLoad", "onUnload", "onAgentTask", "onRecommendation", "onMemorySave",
];

/**
 * Validate a plugin object shape. Returns { valid, errors[] }.
 */
function _validatePlugin(p) {
    const errors = [];
    if (!p || typeof p !== "object") { errors.push("plugin must be an object"); return { valid: false, errors }; }
    if (!p.id || typeof p.id !== "string")          errors.push("id (string) required");
    if (!p.name || typeof p.name !== "string")      errors.push("name (string) required");
    if (!p.version || typeof p.version !== "string") errors.push("version (string) required");
    if (!p.description || typeof p.description !== "string") errors.push("description (string) required");
    if (!p.author || typeof p.author !== "string")  errors.push("author (string) required");
    if (!Array.isArray(p.capabilities))             errors.push("capabilities (string[]) required");
    if (p.hooks && typeof p.hooks !== "object")     errors.push("hooks must be an object if provided");
    if (p.routes) {
        if (!Array.isArray(p.routes)) {
            errors.push("routes must be an array if provided");
        } else {
            p.routes.forEach((r, i) => {
                if (!r.method) errors.push(`routes[${i}].method required`);
                if (!r.path)   errors.push(`routes[${i}].path required`);
                if (typeof r.handler !== "function") errors.push(`routes[${i}].handler must be a function`);
            });
        }
    }
    if (!p.meta || typeof p.meta !== "object")      errors.push("meta (object) required");
    return { valid: errors.length === 0, errors };
}

/**
 * Return the serialisable (no-function) subset of a plugin for disk storage.
 */
function _serializePlugin(p) {
    return {
        id:          p.id,
        name:        p.name,
        version:     p.version,
        description: p.description,
        author:      p.author,
        capabilities: p.capabilities,
        meta:        p.meta,
        registeredAt: p._registeredAt || new Date().toISOString(),
    };
}

/**
 * Persist all registered plugins to disk (serialisable form only).
 */
function _savePlugins() {
    const list = [];
    for (const [, plugin] of _plugins) {
        list.push(_serializePlugin(plugin));
    }
    _saveJson(PLUGIN_FILE, { plugins: list, updatedAt: new Date().toISOString() });
}

/**
 * registerPlugin(plugin) → { pluginId, registered: true }
 *
 * Validates schema, calls onLoad(), stores in the in-memory registry,
 * and persists the serialisable meta to disk.
 */
function registerPlugin(plugin) {
    const { valid, errors } = _validatePlugin(plugin);
    if (!valid) throw new Error(`Invalid plugin: ${errors.join("; ")}`);

    if (_plugins.has(plugin.id)) {
        throw new Error(`Plugin "${plugin.id}" is already registered. Unregister it first.`);
    }

    // Stamp registration time
    plugin._registeredAt = new Date().toISOString();

    // Call onLoad lifecycle hook synchronously (errors bubble to caller)
    if (plugin.hooks && typeof plugin.hooks.onLoad === "function") {
        plugin.hooks.onLoad(plugin);
    }

    _plugins.set(plugin.id, plugin);

    // Register capabilities provided by this plugin
    for (const cap of (plugin.capabilities || [])) {
        const capId = `${plugin.id}:${cap}`;
        if (!_capabilities.has(capId)) {
            _capabilities.set(capId, {
                id:          capId,
                name:        cap,
                description: `Capability "${cap}" provided by plugin "${plugin.id}"`,
                providedBy:  plugin.id,
                providerType: "plugin",
                category:    plugin.meta.category || "general",
                inputSchema:  null,
                outputSchema: null,
            });
        }
    }

    _savePlugins();
    _saveCapabilities();

    return { pluginId: plugin.id, registered: true };
}

/**
 * unregisterPlugin(pluginId) → { pluginId, unregistered: true }
 */
function unregisterPlugin(pluginId) {
    const plugin = _plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);

    // Call onUnload lifecycle hook
    if (plugin.hooks && typeof plugin.hooks.onUnload === "function") {
        try { plugin.hooks.onUnload(plugin); } catch (e) { /* best-effort */ }
    }

    _plugins.delete(pluginId);

    // Remove capabilities that were provided exclusively by this plugin
    for (const [capId, cap] of _capabilities) {
        if (cap.providedBy === pluginId && cap.providerType === "plugin") {
            _capabilities.delete(capId);
        }
    }

    _savePlugins();
    _saveCapabilities();

    return { pluginId, unregistered: true };
}

/**
 * getPlugin(pluginId) → full plugin object | null
 */
function getPlugin(pluginId) {
    return _plugins.get(pluginId) || null;
}

/**
 * listPlugins(opts) → { plugins[], total }
 * opts: { category, tag, limit, offset }
 */
function listPlugins({ category, tag, limit = 100, offset = 0 } = {}) {
    let list = [];
    for (const [, p] of _plugins) {
        if (category && p.meta?.category !== category) continue;
        if (tag && !p.meta?.tags?.includes(tag)) continue;
        list.push(_serializePlugin(p));
    }
    const total = list.length;
    list = list.slice(offset, offset + limit);
    return { plugins: list, total, limit, offset };
}

/**
 * executeHook(hookName, ...args) → array of results
 *
 * Iterates all registered plugins in insertion order.
 * Awaits async hooks. Errors from individual plugins are caught and
 * included in the result as { pluginId, error }.
 */
async function executeHook(hookName, ...args) {
    if (!VALID_HOOKS.includes(hookName)) {
        throw new Error(`Unknown hook "${hookName}". Valid hooks: ${VALID_HOOKS.join(", ")}`);
    }

    const results = [];
    for (const [pluginId, plugin] of _plugins) {
        const hook = plugin.hooks && plugin.hooks[hookName];
        if (typeof hook !== "function") continue;
        try {
            const result = await hook(...args);
            results.push({ pluginId, result });
        } catch (e) {
            results.push({ pluginId, error: e.message });
        }
    }
    return results;
}

/**
 * getPluginRoutes() → flat array of { pluginId, method, path, handler }
 */
function getPluginRoutes() {
    const routes = [];
    for (const [pluginId, plugin] of _plugins) {
        if (!Array.isArray(plugin.routes)) continue;
        for (const r of plugin.routes) {
            routes.push({ pluginId, method: r.method.toUpperCase(), path: r.path, handler: r.handler });
        }
    }
    return routes;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — CAPABILITY REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory capability store: capId → meta
 */
const _capabilities = new Map();

function _saveCapabilities() {
    const list = [];
    for (const [, cap] of _capabilities) {
        list.push(cap);
    }
    _saveJson(CAP_FILE, { capabilities: list, updatedAt: new Date().toISOString() });
}

/**
 * registerCapability(id, meta) → { capId }
 *
 * meta: { name, description, providedBy, providerType, inputSchema, outputSchema, category }
 */
function registerCapability(id, meta = {}) {
    if (!id || typeof id !== "string") throw new Error("capability id (string) required");
    const cap = {
        id,
        name:         meta.name         || id,
        description:  meta.description  || "",
        providedBy:   meta.providedBy   || null,
        providerType: meta.providerType || "agent", // "agent" | "plugin"
        inputSchema:  meta.inputSchema  || null,
        outputSchema: meta.outputSchema || null,
        category:     meta.category     || "general",
        registeredAt: new Date().toISOString(),
    };
    _capabilities.set(id, cap);
    _saveCapabilities();
    return { capId: id };
}

/**
 * getCapability(capId) → meta | null
 */
function getCapability(capId) {
    return _capabilities.get(capId) || null;
}

/**
 * listCapabilities(opts) → { capabilities[], total }
 * opts: { category, providedBy, limit, offset }
 */
function listCapabilities({ category, providedBy, limit = 200, offset = 0 } = {}) {
    let list = [];
    for (const [, cap] of _capabilities) {
        if (category   && cap.category  !== category)   continue;
        if (providedBy && cap.providedBy !== providedBy) continue;
        list.push(cap);
    }
    const total = list.length;
    list = list.slice(offset, offset + limit);
    return { capabilities: list, total, limit, offset };
}

/**
 * findByCapability(capabilityName) → { agents[], plugins[] }
 *
 * Searches for all providers that expose the named capability.
 * capabilityName is matched against the `name` field (case-insensitive).
 */
function findByCapability(capabilityName) {
    const needle = (capabilityName || "").toLowerCase();
    const agents  = [];
    const plugins = [];

    for (const [, cap] of _capabilities) {
        if (cap.name.toLowerCase() === needle) {
            if (cap.providerType === "plugin") {
                plugins.push({ pluginId: cap.providedBy, capId: cap.id });
            } else {
                agents.push({ agentId: cap.providedBy, capId: cap.id });
            }
        }
    }
    return { agents, plugins };
}

/**
 * getCapabilityMap() → { [capabilityName]: [providerId, ...] }
 */
function getCapabilityMap() {
    const map = {};
    for (const [, cap] of _capabilities) {
        if (!map[cap.name]) map[cap.name] = [];
        if (cap.providedBy && !map[cap.name].includes(cap.providedBy)) {
            map[cap.name].push(cap.providedBy);
        }
    }
    return map;
}

// ── Bootstrap: register capabilities from BUILTIN_AGENTS ─────────────────────
//
// agentExecutionEngine.cjs does NOT export BUILTIN_AGENTS directly.
// It exports listAgents() → { agents: [{ agentId, name, capabilities, ... }] }.
// We keep a hard-coded snapshot as a fallback so bootstrap never silently
// produces zero capabilities when the engine module has side-effect issues.

const _BUILTIN_AGENT_SNAPSHOT = [
    { id: "sales",     name: "Sales Agent",      capabilities: ["lead_qualify","email_send","crm_write"] },
    { id: "marketing", name: "Marketing Agent",  capabilities: ["email_draft","social_post","campaign_schedule"] },
    { id: "seo",       name: "SEO Agent",        capabilities: ["keyword_research","meta_generate","rank_track"] },
    { id: "support",   name: "Support Agent",    capabilities: ["ticket_read","ticket_reply","escalate"] },
    { id: "research",  name: "Research Agent",   capabilities: ["web_search","brief_generate","summarize"] },
    { id: "dev",       name: "Dev Agent",        capabilities: ["code_write","pr_create","test_run"] },
    { id: "devops",    name: "DevOps Agent",     capabilities: ["deploy","monitor","incident_resolve"] },
    { id: "analytics", name: "Analytics Agent",  capabilities: ["report_generate","anomaly_detect","kpi_track"] },
    { id: "content",   name: "Content Agent",    capabilities: ["blog_write","newsletter_draft","brand_voice"] },
    { id: "runtime",   name: "Runtime Agent",    capabilities: ["task_dispatch","queue_drain","tool_call"] },
];

function _bootstrapBuiltinCapabilities() {
    let agents = _BUILTIN_AGENT_SNAPSHOT;
    try {
        const aee = require("./agentExecutionEngine.cjs");
        if (typeof aee.listAgents === "function") {
            const result = aee.listAgents();
            // listAgents() returns { agents: [{ agentId, name, capabilities }] }
            const listed = (result.agents || []).map(a => ({
                id:           a.agentId || a.id,
                name:         a.name    || a.agentId || a.id,
                capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
            })).filter(a => a.id);
            if (listed.length > 0) agents = listed;
        }
    } catch { /* fall back to hard-coded snapshot */ }

    for (const agent of agents) {
        for (const cap of (agent.capabilities || [])) {
            const capId = `agent:${agent.id}:${cap}`;
            if (!_capabilities.has(capId)) {
                _capabilities.set(capId, {
                    id:           capId,
                    name:         cap,
                    description:  `Capability "${cap}" provided by built-in agent "${agent.name || agent.id}"`,
                    providedBy:   agent.id,
                    providerType: "agent",
                    category:     "builtin",
                    inputSchema:  null,
                    outputSchema: null,
                    registeredAt: new Date().toISOString(),
                });
            }
        }
    }
    _saveCapabilities();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — API MANIFEST
// ─────────────────────────────────────────────────────────────────────────────

const MANIFEST_VERSION = "1.0.0";
const MANIFEST_TTL_MS  = 60 * 60 * 1000; // 1 hour

let _manifestCache      = null;
let _manifestGeneratedAt = 0;

/**
 * Hard-coded endpoint catalogue for route groups p18–p25.
 * Each entry: { method, path, description, auth, rateLimit, tags[], example }
 */
const ENDPOINT_CATALOGUE = [
    // ── P18 Runtime Execution Layer ───────────────────────────────────────────
    { method: "POST",   path: "/p18/actions/execute",          description: "Execute an action immediately",              auth: true,  rateLimit: "60/min", tags: ["p18","actions","execute"],  example: { body: { input: "run health check" } } },
    { method: "POST",   path: "/p18/actions/queue",            description: "Queue an action for async execution",        auth: true,  rateLimit: "120/min", tags: ["p18","actions","queue"],   example: { body: { input: "send report", scheduledFor: "2026-06-15T09:00:00Z" } } },
    { method: "POST",   path: "/p18/actions/:id/retry",        description: "Retry a previously queued action",           auth: true,  rateLimit: "30/min", tags: ["p18","actions","retry"],   example: { params: { id: "act_abc" } } },
    { method: "DELETE", path: "/p18/actions/:id",              description: "Cancel a queued or running action",          auth: true,  rateLimit: "30/min", tags: ["p18","actions","cancel"],  example: { params: { id: "act_abc" } } },
    { method: "GET",    path: "/p18/actions",                  description: "List all actions with status",               auth: true,  rateLimit: "120/min", tags: ["p18","actions","list"],   example: { query: { limit: 50 } } },
    { method: "GET",    path: "/p18/actions/:id",              description: "Get a single action record",                 auth: true,  rateLimit: "120/min", tags: ["p18","actions","get"],    example: { params: { id: "act_abc" } } },
    { method: "GET",    path: "/p18/actions/audit",            description: "Get execution audit trail",                  auth: true,  rateLimit: "60/min", tags: ["p18","actions","audit"],   example: { query: { limit: 100 } } },

    { method: "POST",   path: "/p18/agents/:agentId/execute",  description: "Execute task for specific agent",            auth: true,  rateLimit: "60/min", tags: ["p18","agents","execute"],  example: { params: { agentId: "sales" }, body: { input: "qualify lead" } } },
    { method: "POST",   path: "/p18/agents/runs/:runId/retry", description: "Retry a failed agent run",                   auth: true,  rateLimit: "30/min", tags: ["p18","agents","retry"],    example: { params: { runId: "run_abc" } } },
    { method: "GET",    path: "/p18/agents",                   description: "List all agents with stats",                 auth: true,  rateLimit: "120/min", tags: ["p18","agents","list"],    example: {} },
    { method: "GET",    path: "/p18/agents/:agentId",          description: "Get agent profile and recent history",       auth: true,  rateLimit: "120/min", tags: ["p18","agents","get"],     example: { params: { agentId: "dev" } } },
    { method: "GET",    path: "/p18/agents/:agentId/history",  description: "Get run history for an agent",               auth: true,  rateLimit: "120/min", tags: ["p18","agents","history"], example: { params: { agentId: "dev" }, query: { limit: 20 } } },
    { method: "GET",    path: "/p18/agents/failures",          description: "List all agent failure records",             auth: true,  rateLimit: "60/min", tags: ["p18","agents","failures"], example: {} },

    { method: "POST",   path: "/p18/memory",                   description: "Save a memory node",                         auth: true,  rateLimit: "120/min", tags: ["p18","memory","write"],   example: { body: { content: "API is healthy", type: "observation" } } },
    { method: "GET",    path: "/p18/memory",                   description: "List memory nodes",                          auth: true,  rateLimit: "120/min", tags: ["p18","memory","list"],    example: { query: { agentId: "dev", limit: 50 } } },
    { method: "GET",    path: "/p18/memory/stats",             description: "Memory store statistics",                    auth: true,  rateLimit: "60/min", tags: ["p18","memory","stats"],    example: {} },
    { method: "GET",    path: "/p18/memory/search",            description: "Keyword search across memory nodes",         auth: true,  rateLimit: "60/min", tags: ["p18","memory","search"],   example: { query: { q: "deployment" } } },
    { method: "GET",    path: "/p18/memory/recall",            description: "Recall contextual memory for an agent",      auth: true,  rateLimit: "60/min", tags: ["p18","memory","recall"],   example: { query: { agentId: "dev", context: "recent errors" } } },
    { method: "GET",    path: "/p18/memory/:nodeId",           description: "Get a single memory node",                   auth: true,  rateLimit: "120/min", tags: ["p18","memory","get"],     example: { params: { nodeId: "mem_abc" } } },
    { method: "PATCH",  path: "/p18/memory/:nodeId",           description: "Update a memory node",                       auth: true,  rateLimit: "60/min", tags: ["p18","memory","update"],   example: { params: { nodeId: "mem_abc" }, body: { content: "updated text" } } },
    { method: "DELETE", path: "/p18/memory/:nodeId",           description: "Archive a memory node",                      auth: true,  rateLimit: "30/min", tags: ["p18","memory","delete"],   example: { params: { nodeId: "mem_abc" } } },

    { method: "POST",   path: "/p18/cycles",                   description: "Start an autonomous execution cycle",        auth: true,  rateLimit: "20/min", tags: ["p18","cycles","start"],    example: { body: { goal: "run daily health checks" } } },
    { method: "GET",    path: "/p18/cycles",                   description: "List all autonomous cycles",                 auth: true,  rateLimit: "60/min", tags: ["p18","cycles","list"],     example: {} },
    { method: "GET",    path: "/p18/cycles/stats",             description: "Cycle run statistics",                       auth: true,  rateLimit: "60/min", tags: ["p18","cycles","stats"],    example: {} },
    { method: "GET",    path: "/p18/cycles/learning",          description: "Learning log from all cycles",               auth: true,  rateLimit: "60/min", tags: ["p18","cycles","learning"], example: {} },
    { method: "GET",    path: "/p18/cycles/:cycleId",          description: "Get a single cycle record",                  auth: true,  rateLimit: "60/min", tags: ["p18","cycles","get"],      example: { params: { cycleId: "cyc_abc" } } },
    { method: "DELETE", path: "/p18/cycles/:cycleId",          description: "Cancel a running cycle",                     auth: true,  rateLimit: "20/min", tags: ["p18","cycles","cancel"],   example: { params: { cycleId: "cyc_abc" } } },

    // ── P19 Autonomy Execution Layer ──────────────────────────────────────────
    { method: "GET",    path: "/p19/tools",                              description: "List all tools with status",              auth: true, rateLimit: "120/min", tags: ["p19","tools","list"],        example: {} },
    { method: "GET",    path: "/p19/tools/status",                       description: "Live tool status snapshot",               auth: true, rateLimit: "120/min", tags: ["p19","tools","status"],      example: {} },
    { method: "POST",   path: "/p19/tools/:toolId/execute",              description: "Execute a tool action",                   auth: true, rateLimit: "60/min",  tags: ["p19","tools","execute"],     example: { params: { toolId: "web_search" }, body: { action: "search", params: { q: "query" } } } },
    { method: "GET",    path: "/p19/tools/:toolId/permissions",          description: "Get permissions for a tool",              auth: true, rateLimit: "120/min", tags: ["p19","tools","permissions"], example: { params: { toolId: "web_search" } } },
    { method: "PUT",    path: "/p19/tools/:toolId/permissions/:action",  description: "Set permission for a tool action",        auth: true, rateLimit: "30/min",  tags: ["p19","tools","permissions"], example: { params: { toolId: "web_search", action: "search" }, body: { allowed: true } } },
    { method: "GET",    path: "/p19/tools/:toolId/usage",               description: "Tool usage history",                      auth: true, rateLimit: "60/min",  tags: ["p19","tools","usage"],       example: { params: { toolId: "web_search" } } },
    { method: "GET",    path: "/p19/tools/failures",                     description: "Tool failure records and patterns",       auth: true, rateLimit: "60/min",  tags: ["p19","tools","failures"],    example: {} },

    { method: "POST",   path: "/p19/coord/handoff",                      description: "Hand off task to another agent",          auth: true, rateLimit: "60/min",  tags: ["p19","coord","handoff"],     example: { body: { fromAgent: "sales", toAgent: "support", task: "escalate ticket" } } },
    { method: "POST",   path: "/p19/coord/delegate",                     description: "Delegate task via orchestrator",          auth: true, rateLimit: "60/min",  tags: ["p19","coord","delegate"],    example: { body: { task: "generate report", agents: ["analytics"] } } },
    { method: "POST",   path: "/p19/coord/collaborate",                  description: "Start parallel multi-agent collaboration", auth: true, rateLimit: "30/min",  tags: ["p19","coord","collaborate"], example: { body: { task: "research + write blog post" } } },
    { method: "GET",    path: "/p19/coord/sessions",                     description: "List coordination sessions",              auth: true, rateLimit: "120/min", tags: ["p19","coord","list"],        example: {} },
    { method: "GET",    path: "/p19/coord/sessions/stats",               description: "Coordination session statistics",         auth: true, rateLimit: "60/min",  tags: ["p19","coord","stats"],       example: {} },
    { method: "GET",    path: "/p19/coord/sessions/:sessionId",          description: "Get a coordination session",              auth: true, rateLimit: "120/min", tags: ["p19","coord","get"],         example: { params: { sessionId: "sess_abc" } } },

    { method: "POST",   path: "/p19/heal/probe",                         description: "Manually trigger a self-healing probe",   auth: true, rateLimit: "20/min",  tags: ["p19","heal","probe"],        example: {} },
    { method: "POST",   path: "/p19/heal/task/:taskId",                  description: "Heal a specific failed task",             auth: true, rateLimit: "30/min",  tags: ["p19","heal","task"],         example: { params: { taskId: "task_abc" } } },
    { method: "POST",   path: "/p19/heal/cycle/:cycleId",                description: "Heal a specific failed cycle",            auth: true, rateLimit: "30/min",  tags: ["p19","heal","cycle"],        example: { params: { cycleId: "cyc_abc" } } },
    { method: "POST",   path: "/p19/heal/circuit-break",                 description: "Circuit-break a target",                  auth: true, rateLimit: "20/min",  tags: ["p19","heal","circuit"],      example: { body: { target: "agent:dev" } } },
    { method: "GET",    path: "/p19/heal/history",                       description: "Self-healing recovery history",           auth: true, rateLimit: "60/min",  tags: ["p19","heal","history"],      example: {} },
    { method: "GET",    path: "/p19/heal/status",                        description: "Current probe status",                    auth: true, rateLimit: "60/min",  tags: ["p19","heal","status"],       example: {} },

    { method: "POST",   path: "/p19/learn/analyze",                      description: "Run full continuous learning analysis",   auth: true, rateLimit: "20/min",  tags: ["p19","learn","analyze"],     example: {} },
    { method: "POST",   path: "/p19/learn/analyze/failures",             description: "Analyze failures only",                   auth: true, rateLimit: "20/min",  tags: ["p19","learn","analyze"],     example: {} },
    { method: "POST",   path: "/p19/learn/analyze/successes",            description: "Analyze successes only",                  auth: true, rateLimit: "20/min",  tags: ["p19","learn","analyze"],     example: {} },
    { method: "POST",   path: "/p19/learn/lessons",                      description: "Create a manual learning lesson",         auth: true, rateLimit: "30/min",  tags: ["p19","learn","lessons"],     example: { body: { title: "Always validate env before deploy", agentId: "devops" } } },
    { method: "GET",    path: "/p19/learn/lessons",                      description: "List learning lessons",                   auth: true, rateLimit: "120/min", tags: ["p19","learn","lessons"],     example: {} },
    { method: "GET",    path: "/p19/learn/recommendations",              description: "List active recommendations",             auth: true, rateLimit: "120/min", tags: ["p19","learn","recs"],        example: {} },
    { method: "PATCH",  path: "/p19/learn/recommendations/:recId",       description: "Update a recommendation",                 auth: true, rateLimit: "30/min",  tags: ["p19","learn","recs"],        example: { params: { recId: "rec_abc" }, body: { status: "applied" } } },
    { method: "GET",    path: "/p19/learn/stats",                        description: "Learning engine statistics",              auth: true, rateLimit: "60/min",  tags: ["p19","learn","stats"],       example: {} },

    // ── P20 Agent Factory, Memory Intelligence, Improvement Loop, Ooplix ──────
    { method: "POST",   path: "/p20/agents",                      description: "Create a new agent",                        auth: true, rateLimit: "20/min",  tags: ["p20","agents","create"],      example: { body: { id: "my-agent", capabilities: ["report_generate"] } } },
    { method: "POST",   path: "/p20/agents/:agentId/clone",       description: "Clone an existing agent",                   auth: true, rateLimit: "20/min",  tags: ["p20","agents","clone"],       example: { params: { agentId: "analytics" } } },
    { method: "PUT",    path: "/p20/agents/:agentId/tools",       description: "Assign tools to an agent",                  auth: true, rateLimit: "30/min",  tags: ["p20","agents","tools"],       example: { params: { agentId: "dev" }, body: { tools: ["code_write", "pr_create"] } } },
    { method: "PUT",    path: "/p20/agents/:agentId/permissions", description: "Set permissions for an agent",              auth: true, rateLimit: "30/min",  tags: ["p20","agents","permissions"], example: { params: { agentId: "dev" }, body: { permissions: { deploy: true } } } },
    { method: "PUT",    path: "/p20/agents/:agentId/memory",      description: "Register memory nodes for an agent",        auth: true, rateLimit: "30/min",  tags: ["p20","agents","memory"],      example: { params: { agentId: "dev" } } },
    { method: "DELETE", path: "/p20/agents/:agentId",             description: "Retire an agent",                           auth: true, rateLimit: "10/min",  tags: ["p20","agents","retire"],      example: { params: { agentId: "my-agent" } } },
    { method: "GET",    path: "/p20/agents/:agentId",             description: "Get agent profile",                         auth: true, rateLimit: "120/min", tags: ["p20","agents","get"],         example: { params: { agentId: "dev" } } },
    { method: "GET",    path: "/p20/agents",                      description: "List all agents in factory",                auth: true, rateLimit: "120/min", tags: ["p20","agents","list"],        example: {} },
    { method: "GET",    path: "/p20/agents/registry",             description: "Full agent registry dump",                  auth: true, rateLimit: "60/min",  tags: ["p20","agents","registry"],    example: {} },

    { method: "GET",    path: "/p20/memory/rank",                 description: "Rank memories by intelligence score",       auth: true, rateLimit: "60/min",  tags: ["p20","memory","rank"],        example: {} },
    { method: "POST",   path: "/p20/memory/merge",                description: "Merge duplicate memory nodes",              auth: true, rateLimit: "20/min",  tags: ["p20","memory","merge"],       example: {} },
    { method: "GET",    path: "/p20/memory/conflicts",            description: "Detect conflicting memory nodes",           auth: true, rateLimit: "60/min",  tags: ["p20","memory","conflicts"],   example: {} },
    { method: "POST",   path: "/p20/memory/archive-stale",        description: "Archive stale memory nodes",                auth: true, rateLimit: "10/min",  tags: ["p20","memory","archive"],     example: {} },
    { method: "POST",   path: "/p20/memory/improve-recall",       description: "Improve recall for an agent + query",       auth: true, rateLimit: "20/min",  tags: ["p20","memory","recall"],      example: { body: { agentId: "dev", query: "recent failures" } } },
    { method: "POST",   path: "/p20/memory/maintenance",          description: "Run full memory maintenance cycle",         auth: true, rateLimit: "5/min",   tags: ["p20","memory","maintenance"], example: {} },
    { method: "GET",    path: "/p20/memory/report",               description: "Last memory intelligence report",           auth: true, rateLimit: "60/min",  tags: ["p20","memory","report"],      example: {} },

    { method: "POST",   path: "/p20/improve/apply",               description: "Apply a change trial",                      auth: true, rateLimit: "20/min",  tags: ["p20","improve","apply"],      example: { body: { change: "increase timeout", agentId: "runtime" } } },
    { method: "POST",   path: "/p20/improve/:trialId/measure",    description: "Measure outcome of a trial",                auth: true, rateLimit: "30/min",  tags: ["p20","improve","measure"],    example: { params: { trialId: "trial_abc" } } },
    { method: "POST",   path: "/p20/improve/:trialId/keep",       description: "Keep a trial change permanently",           auth: true, rateLimit: "20/min",  tags: ["p20","improve","keep"],       example: { params: { trialId: "trial_abc" } } },
    { method: "POST",   path: "/p20/improve/:trialId/revert",     description: "Revert a trial change",                     auth: true, rateLimit: "20/min",  tags: ["p20","improve","revert"],     example: { params: { trialId: "trial_abc" } } },
    { method: "POST",   path: "/p20/improve/:trialId/record",     description: "Add a learning note to a trial",            auth: true, rateLimit: "30/min",  tags: ["p20","improve","record"],     example: { params: { trialId: "trial_abc" }, body: { note: "worked well" } } },
    { method: "GET",    path: "/p20/improve/:trialId",            description: "Get a trial record",                        auth: true, rateLimit: "120/min", tags: ["p20","improve","get"],        example: { params: { trialId: "trial_abc" } } },
    { method: "GET",    path: "/p20/improve",                     description: "List all improvement trials",               auth: true, rateLimit: "120/min", tags: ["p20","improve","list"],       example: {} },
    { method: "GET",    path: "/p20/improve/stats",               description: "Improvement loop statistics",               auth: true, rateLimit: "60/min",  tags: ["p20","improve","stats"],      example: {} },

    { method: "POST",   path: "/p20/ooplix/tasks",                description: "Create an Ooplix autonomous task",          auth: true, rateLimit: "30/min",  tags: ["p20","ooplix","tasks"],       example: { body: { goal: "grow MRR by 10%" } } },
    { method: "POST",   path: "/p20/ooplix/dispatch",             description: "Dispatch all pending Ooplix tasks",         auth: true, rateLimit: "10/min",  tags: ["p20","ooplix","dispatch"],    example: {} },
    { method: "POST",   path: "/p20/ooplix/schedule",             description: "Schedule recurring Ooplix tasks",           auth: true, rateLimit: "10/min",  tags: ["p20","ooplix","schedule"],    example: {} },
    { method: "POST",   path: "/p20/ooplix/cycle",                description: "Run full Ooplix autonomous cycle",          auth: true, rateLimit: "5/min",   tags: ["p20","ooplix","cycle"],       example: {} },
    { method: "POST",   path: "/p20/ooplix/tasks/:taskId/influence", description: "Record influence on a task",             auth: true, rateLimit: "30/min",  tags: ["p20","ooplix","influence"],   example: { params: { taskId: "task_abc" } } },
    { method: "GET",    path: "/p20/ooplix/tasks/:taskId",        description: "Get a single Ooplix task",                  auth: true, rateLimit: "120/min", tags: ["p20","ooplix","get"],         example: { params: { taskId: "task_abc" } } },
    { method: "GET",    path: "/p20/ooplix/tasks",                description: "List all Ooplix tasks",                     auth: true, rateLimit: "120/min", tags: ["p20","ooplix","list"],        example: {} },
    { method: "GET",    path: "/p20/ooplix/influence",            description: "Ooplix influence report",                   auth: true, rateLimit: "60/min",  tags: ["p20","ooplix","report"],      example: {} },
    { method: "GET",    path: "/p20/ooplix/templates",            description: "Available Ooplix task templates",           auth: true, rateLimit: "120/min", tags: ["p20","ooplix","templates"],   example: {} },

    // ── P21 OAuth, Observability, Live Mode, Production Readiness ─────────────
    { method: "GET",    path: "/oauth/:provider/url",             description: "Get OAuth authorization URL",               auth: true,  rateLimit: "30/min",  tags: ["p21","oauth","url"],          example: { params: { provider: "github" } } },
    { method: "GET",    path: "/oauth/:provider/callback",        description: "Handle OAuth redirect callback",            auth: false, rateLimit: "60/min",  tags: ["p21","oauth","callback"],     example: { params: { provider: "github" }, query: { code: "abc", state: "xyz" } } },
    { method: "POST",   path: "/oauth/:provider/refresh",         description: "Refresh an OAuth token",                   auth: true,  rateLimit: "20/min",  tags: ["p21","oauth","refresh"],      example: { params: { provider: "github" } } },
    { method: "DELETE", path: "/oauth/:provider/revoke",          description: "Revoke an OAuth token",                    auth: true,  rateLimit: "10/min",  tags: ["p21","oauth","revoke"],       example: { params: { provider: "github" } } },
    { method: "GET",    path: "/oauth/connections",               description: "List all OAuth connections",               auth: true,  rateLimit: "120/min", tags: ["p21","oauth","list"],         example: {} },
    { method: "GET",    path: "/oauth/status",                    description: "Provider configuration status",            auth: true,  rateLimit: "120/min", tags: ["p21","oauth","status"],       example: {} },

    { method: "POST",   path: "/p21/obs/metrics",                 description: "Record a custom observability metric",     auth: true,  rateLimit: "300/min", tags: ["p21","obs","metrics"],        example: { body: { name: "api_latency_ms", value: 42 } } },
    { method: "GET",    path: "/p21/obs/metrics/:name",           description: "Query metric values and stats",            auth: true,  rateLimit: "120/min", tags: ["p21","obs","metrics"],        example: { params: { name: "api_latency_ms" } } },
    { method: "GET",    path: "/p21/obs/metrics",                 description: "List all registered metrics",             auth: true,  rateLimit: "120/min", tags: ["p21","obs","metrics"],        example: {} },
    { method: "POST",   path: "/p21/obs/alerts",                  description: "Register an alert rule",                  auth: true,  rateLimit: "30/min",  tags: ["p21","obs","alerts"],         example: { body: { metric: "error_rate", threshold: 5, op: ">" } } },
    { method: "POST",   path: "/p21/obs/alerts/evaluate",         description: "Evaluate all alert rules now",            auth: true,  rateLimit: "20/min",  tags: ["p21","obs","alerts"],         example: {} },
    { method: "GET",    path: "/p21/obs/alerts",                  description: "Active alerts and rules",                 auth: true,  rateLimit: "120/min", tags: ["p21","obs","alerts"],         example: {} },
    { method: "POST",   path: "/p21/obs/log",                     description: "Write a structured log entry",            auth: true,  rateLimit: "300/min", tags: ["p21","obs","logs"],           example: { body: { level: "info", message: "deploy complete", service: "backend" } } },
    { method: "GET",    path: "/p21/obs/logs",                    description: "Query structured logs",                   auth: true,  rateLimit: "120/min", tags: ["p21","obs","logs"],           example: { query: { service: "backend", level: "error", limit: 50 } } },
    { method: "GET",    path: "/p21/obs/health",                  description: "Synthetic health probe results",          auth: true,  rateLimit: "60/min",  tags: ["p21","obs","health"],         example: {} },
    { method: "GET",    path: "/p21/obs/snapshot",                description: "Full telemetry snapshot",                 auth: true,  rateLimit: "30/min",  tags: ["p21","obs","snapshot"],       example: {} },

    { method: "POST",   path: "/p21/live/start",                  description: "Start autonomous company live mode",      auth: true,  rateLimit: "5/min",   tags: ["p21","live","control"],       example: {} },
    { method: "POST",   path: "/p21/live/stop",                   description: "Stop autonomous live mode",               auth: true,  rateLimit: "5/min",   tags: ["p21","live","control"],       example: {} },
    { method: "POST",   path: "/p21/live/tick",                   description: "Manually trigger a single live tick",     auth: true,  rateLimit: "10/min",  tags: ["p21","live","tick"],          example: {} },
    { method: "GET",    path: "/p21/live/state",                  description: "Current live mode state",                 auth: true,  rateLimit: "120/min", tags: ["p21","live","state"],         example: {} },
    { method: "GET",    path: "/p21/live/sessions",               description: "Live mode session history",               auth: true,  rateLimit: "60/min",  tags: ["p21","live","sessions"],      example: {} },

    { method: "POST",   path: "/p21/readiness/check",             description: "Run full production readiness check",     auth: true,  rateLimit: "10/min",  tags: ["p21","readiness","check"],    example: {} },
    { method: "GET",    path: "/p21/readiness/report",            description: "Last persisted readiness report",         auth: true,  rateLimit: "60/min",  tags: ["p21","readiness","report"],   example: {} },
    { method: "GET",    path: "/p21/readiness/history",           description: "Readiness check history",                 auth: true,  rateLimit: "60/min",  tags: ["p21","readiness","history"],  example: {} },
    { method: "GET",    path: "/p21/readiness/deployment",        description: "Deployment readiness checks only",        auth: true,  rateLimit: "60/min",  tags: ["p21","readiness","deploy"],   example: {} },
    { method: "GET",    path: "/p21/readiness/config",            description: "Config readiness checks only",            auth: true,  rateLimit: "60/min",  tags: ["p21","readiness","config"],   example: {} },
    { method: "GET",    path: "/p21/readiness/security",          description: "Security readiness checks only",          auth: true,  rateLimit: "60/min",  tags: ["p21","readiness","security"], example: {} },
    { method: "GET",    path: "/p21/readiness/dependencies",      description: "Dependency readiness checks only",        auth: true,  rateLimit: "60/min",  tags: ["p21","readiness","deps"],     example: {} },

    // ── P22 Secrets, Security, Deployment Validation, Ops Alerting ───────────
    { method: "POST",   path: "/p22/secrets/audit",               description: "Run full environment secret audit",       auth: true,  rateLimit: "10/min",  tags: ["p22","secrets","audit"],      example: {} },
    { method: "GET",    path: "/p22/secrets/validate",            description: "Validate all secrets",                    auth: true,  rateLimit: "30/min",  tags: ["p22","secrets","validate"],   example: {} },
    { method: "GET",    path: "/p22/secrets/validate/:key",       description: "Validate a single secret by key",         auth: true,  rateLimit: "60/min",  tags: ["p22","secrets","validate"],   example: { params: { key: "JWT_SECRET" } } },
    { method: "GET",    path: "/p22/secrets/missing",             description: "Detect missing required secrets",         auth: true,  rateLimit: "30/min",  tags: ["p22","secrets","missing"],    example: {} },
    { method: "POST",   path: "/p22/secrets/:key/rotated",        description: "Mark a secret as rotated",                auth: true,  rateLimit: "20/min",  tags: ["p22","secrets","rotation"],   example: { params: { key: "API_KEY" } } },
    { method: "GET",    path: "/p22/secrets/rotation",            description: "Rotation status for all timed secrets",   auth: true,  rateLimit: "60/min",  tags: ["p22","secrets","rotation"],   example: {} },
    { method: "GET",    path: "/p22/secrets/rotation/:key",       description: "Rotation status for one secret",          auth: true,  rateLimit: "60/min",  tags: ["p22","secrets","rotation"],   example: { params: { key: "API_KEY" } } },
    { method: "GET",    path: "/p22/secrets/audit/history",       description: "Audit run history",                       auth: true,  rateLimit: "60/min",  tags: ["p22","secrets","history"],    example: {} },

    { method: "POST",   path: "/p22/security/check",              description: "Run full security hardening check",       auth: true,  rateLimit: "10/min",  tags: ["p22","security","check"],     example: {} },
    { method: "GET",    path: "/p22/security/report",             description: "Last security hardening report",          auth: true,  rateLimit: "60/min",  tags: ["p22","security","report"],    example: {} },
    { method: "GET",    path: "/p22/security/history",            description: "Security check history",                  auth: true,  rateLimit: "60/min",  tags: ["p22","security","history"],   example: {} },
    { method: "GET",    path: "/p22/security/jwt",                description: "JWT security checks only",                auth: true,  rateLimit: "60/min",  tags: ["p22","security","jwt"],       example: {} },
    { method: "GET",    path: "/p22/security/cookies",            description: "Cookie security checks only",             auth: true,  rateLimit: "60/min",  tags: ["p22","security","cookies"],   example: {} },
    { method: "GET",    path: "/p22/security/csp",                description: "CSP checks only",                         auth: true,  rateLimit: "60/min",  tags: ["p22","security","csp"],       example: {} },
    { method: "GET",    path: "/p22/security/rate-limiting",      description: "Rate limiting checks only",               auth: true,  rateLimit: "60/min",  tags: ["p22","security","ratelimit"], example: {} },
    { method: "GET",    path: "/p22/security/auth",               description: "Auth protection checks only",             auth: true,  rateLimit: "60/min",  tags: ["p22","security","auth"],      example: {} },
    { method: "GET",    path: "/p22/security/headers",            description: "Security header checks only",             auth: true,  rateLimit: "60/min",  tags: ["p22","security","headers"],   example: {} },

    { method: "POST",   path: "/p22/deploy/check",                description: "Run full deployment validation check",    auth: true,  rateLimit: "10/min",  tags: ["p22","deploy","check"],       example: {} },
    { method: "GET",    path: "/p22/deploy/report",               description: "Last deployment validation report",       auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","report"],      example: {} },
    { method: "GET",    path: "/p22/deploy/history",              description: "Deployment validation history",           auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","history"],     example: {} },
    { method: "GET",    path: "/p22/deploy/environment",          description: "Environment checks only",                 auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","env"],         example: {} },
    { method: "GET",    path: "/p22/deploy/build",                description: "Build artifact checks only",              auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","build"],       example: {} },
    { method: "GET",    path: "/p22/deploy/process",              description: "Process management checks only",          auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","process"],     example: {} },
    { method: "GET",    path: "/p22/deploy/nginx",                description: "Nginx checks only",                       auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","nginx"],       example: {} },
    { method: "GET",    path: "/p22/deploy/ssl",                  description: "SSL checks only",                         auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","ssl"],         example: {} },
    { method: "GET",    path: "/p22/deploy/domain",               description: "Domain checks only",                      auth: true,  rateLimit: "60/min",  tags: ["p22","deploy","domain"],      example: {} },

    { method: "POST",   path: "/p22/alerts/fire",                 description: "Fire a manual operations alert",          auth: true,  rateLimit: "20/min",  tags: ["p22","alerts","fire"],        example: { body: { severity: "critical", message: "disk full" } } },
    { method: "POST",   path: "/p22/alerts/probe",                description: "Run system monitor probe",                auth: true,  rateLimit: "10/min",  tags: ["p22","alerts","probe"],       example: {} },
    { method: "POST",   path: "/p22/alerts/:alertId/resolve",     description: "Resolve an active alert",                 auth: true,  rateLimit: "30/min",  tags: ["p22","alerts","resolve"],     example: { params: { alertId: "alert_abc" } } },
    { method: "POST",   path: "/p22/alerts/:alertId/suppress",    description: "Suppress an alert for a duration",        auth: true,  rateLimit: "20/min",  tags: ["p22","alerts","suppress"],    example: { params: { alertId: "alert_abc" }, body: { durationMs: 3600000 } } },
    { method: "POST",   path: "/p22/alerts/:alertId/escalate",    description: "Escalate an alert to critical",           auth: true,  rateLimit: "10/min",  tags: ["p22","alerts","escalate"],    example: { params: { alertId: "alert_abc" } } },
    { method: "GET",    path: "/p22/alerts/:alertId",             description: "Get a specific alert",                    auth: true,  rateLimit: "120/min", tags: ["p22","alerts","get"],         example: { params: { alertId: "alert_abc" } } },
    { method: "GET",    path: "/p22/alerts",                      description: "List active alerts",                      auth: true,  rateLimit: "120/min", tags: ["p22","alerts","list"],        example: {} },
    { method: "GET",    path: "/p22/alerts/history",              description: "Alert history",                           auth: true,  rateLimit: "60/min",  tags: ["p22","alerts","history"],     example: {} },
    { method: "GET",    path: "/p22/alerts/channels",             description: "Notification channel status",             auth: true,  rateLimit: "60/min",  tags: ["p22","alerts","channels"],    example: {} },
    { method: "PUT",    path: "/p22/alerts/channels/:channel",    description: "Configure a notification channel",        auth: true,  rateLimit: "10/min",  tags: ["p22","alerts","channels"],    example: { params: { channel: "slack" }, body: { webhookUrl: "https://hooks.slack.com/..." } } },

    // ── P23 Engineering Automation ────────────────────────────────────────────
    { method: "GET",    path: "/p23/github/:owner/:repo",                   description: "Read GitHub repo info",                  auth: true, rateLimit: "60/min",  tags: ["p23","github","repo"],    example: { params: { owner: "acme", repo: "api" } } },
    { method: "GET",    path: "/p23/github/:owner/:repo/issues",            description: "List GitHub repo issues",                auth: true, rateLimit: "60/min",  tags: ["p23","github","issues"],  example: { params: { owner: "acme", repo: "api" }, query: { state: "open" } } },
    { method: "POST",   path: "/p23/github/:owner/:repo/issues/analyze",    description: "Analyze repo issues with AI",            auth: true, rateLimit: "20/min",  tags: ["p23","github","issues"],  example: { params: { owner: "acme", repo: "api" } } },
    { method: "POST",   path: "/p23/github/:owner/:repo/issues",            description: "Create a GitHub issue",                  auth: true, rateLimit: "20/min",  tags: ["p23","github","issues"],  example: { params: { owner: "acme", repo: "api" }, body: { title: "Bug: 500 on /health" } } },
    { method: "POST",   path: "/p23/github/:owner/:repo/pulls",             description: "Create a pull request",                  auth: true, rateLimit: "20/min",  tags: ["p23","github","prs"],     example: { params: { owner: "acme", repo: "api" }, body: { title: "Fix: health endpoint" } } },
    { method: "POST",   path: "/p23/github/:owner/:repo/pulls/:number/review", description: "Review a PR with AI",                auth: true, rateLimit: "10/min",  tags: ["p23","github","review"],  example: { params: { owner: "acme", repo: "api", number: 42 } } },
    { method: "GET",    path: "/p23/github/:owner/:repo/changelog",         description: "Generate repository changelog",          auth: true, rateLimit: "20/min",  tags: ["p23","github","changelog"], example: { params: { owner: "acme", repo: "api" } } },
    { method: "GET",    path: "/p23/github/activity",                       description: "Engineering activity log",               auth: true, rateLimit: "60/min",  tags: ["p23","github","activity"],  example: {} },
    { method: "GET",    path: "/p23/github/stats",                          description: "Engineering activity statistics",        auth: true, rateLimit: "60/min",  tags: ["p23","github","stats"],     example: {} },

    { method: "POST",   path: "/p23/review/code",                           description: "Review raw code with AI",                auth: true, rateLimit: "20/min",  tags: ["p23","review","code"],      example: { body: { code: "function foo() {}", language: "js" } } },
    { method: "POST",   path: "/p23/review/file",                           description: "Review a server-side file path",         auth: true, rateLimit: "20/min",  tags: ["p23","review","file"],      example: { body: { filePath: "/opt/app/backend/index.js" } } },
    { method: "POST",   path: "/p23/review/diff",                           description: "Review a unified diff",                  auth: true, rateLimit: "20/min",  tags: ["p23","review","diff"],      example: { body: { diff: "--- a/file.js\n+++ b/file.js" } } },
    { method: "GET",    path: "/p23/review/:reviewId/summary",              description: "Get a review summary",                   auth: true, rateLimit: "60/min",  tags: ["p23","review","get"],       example: { params: { reviewId: "rev_abc" } } },
    { method: "GET",    path: "/p23/review/:reviewId",                      description: "Get full review",                        auth: true, rateLimit: "60/min",  tags: ["p23","review","get"],       example: { params: { reviewId: "rev_abc" } } },
    { method: "GET",    path: "/p23/review",                                description: "List all code reviews",                  auth: true, rateLimit: "120/min", tags: ["p23","review","list"],      example: {} },
    { method: "GET",    path: "/p23/review/stats",                          description: "Aggregate review statistics",            auth: true, rateLimit: "60/min",  tags: ["p23","review","stats"],     example: {} },

    { method: "GET",    path: "/p23/release/version",                       description: "Get current release version",            auth: true, rateLimit: "120/min", tags: ["p23","release","version"],  example: {} },
    { method: "POST",   path: "/p23/release/version/bump",                  description: "Bump the release version",               auth: true, rateLimit: "10/min",  tags: ["p23","release","version"],  example: { body: { type: "minor" } } },
    { method: "GET",    path: "/p23/release/build/validate",                description: "Validate the current build",             auth: true, rateLimit: "20/min",  tags: ["p23","release","build"],    example: {} },
    { method: "POST",   path: "/p23/release/checklist",                     description: "Run release checklist",                  auth: true, rateLimit: "10/min",  tags: ["p23","release","checklist"],example: {} },
    { method: "POST",   path: "/p23/release/notes",                         description: "Generate release notes",                 auth: true, rateLimit: "10/min",  tags: ["p23","release","notes"],    example: {} },
    { method: "GET",    path: "/p23/release/readiness",                     description: "Deployment readiness summary",           auth: true, rateLimit: "30/min",  tags: ["p23","release","readiness"],example: {} },
    { method: "POST",   path: "/p23/release",                               description: "Create a release record",                auth: true, rateLimit: "10/min",  tags: ["p23","release","create"],   example: { body: { version: "1.2.0" } } },
    { method: "GET",    path: "/p23/release/:releaseId",                    description: "Get a release record",                   auth: true, rateLimit: "60/min",  tags: ["p23","release","get"],      example: { params: { releaseId: "rel_abc" } } },
    { method: "GET",    path: "/p23/release",                               description: "List all releases",                      auth: true, rateLimit: "120/min", tags: ["p23","release","list"],     example: {} },

    { method: "POST",   path: "/p23/autopilot/missions",                    description: "Run an engineering autopilot mission",   auth: true, rateLimit: "10/min",  tags: ["p23","autopilot","run"],    example: { body: { goal: "identify and fix top 3 bugs" } } },
    { method: "GET",    path: "/p23/autopilot/missions/:missionId/chain",   description: "Get mission execution chain",            auth: true, rateLimit: "60/min",  tags: ["p23","autopilot","chain"],  example: { params: { missionId: "mis_abc" } } },
    { method: "DELETE", path: "/p23/autopilot/missions/:missionId",         description: "Cancel an autopilot mission",            auth: true, rateLimit: "20/min",  tags: ["p23","autopilot","cancel"], example: { params: { missionId: "mis_abc" } } },
    { method: "GET",    path: "/p23/autopilot/missions/:missionId",         description: "Get an autopilot mission",               auth: true, rateLimit: "60/min",  tags: ["p23","autopilot","get"],    example: { params: { missionId: "mis_abc" } } },
    { method: "GET",    path: "/p23/autopilot/missions",                    description: "List all autopilot missions",            auth: true, rateLimit: "120/min", tags: ["p23","autopilot","list"],   example: {} },
    { method: "GET",    path: "/p23/autopilot/stats",                       description: "Autopilot aggregate statistics",         auth: true, rateLimit: "60/min",  tags: ["p23","autopilot","stats"],  example: {} },

    // ── P24 VS Code, Repo Intelligence, Refactor, Multi-Repo ──────────────────
    { method: "POST",   path: "/p24/vscode/chat",             description: "Multi-provider AI chat from VS Code",          auth: true, rateLimit: "60/min",  tags: ["p24","vscode","chat"],      example: { body: { prompt: "explain this code" } } },
    { method: "POST",   path: "/p24/vscode/explain",          description: "Explain selected code",                        auth: true, rateLimit: "60/min",  tags: ["p24","vscode","explain"],   example: { body: { code: "function foo() {}" } } },
    { method: "POST",   path: "/p24/vscode/generate",         description: "Generate code from prompt",                    auth: true, rateLimit: "30/min",  tags: ["p24","vscode","generate"],  example: { body: { prompt: "generate a REST handler for /users" } } },
    { method: "POST",   path: "/p24/vscode/refactor",         description: "Refactor code",                                auth: true, rateLimit: "30/min",  tags: ["p24","vscode","refactor"],  example: { body: { code: "function foo() {}", instruction: "extract to helper" } } },
    { method: "POST",   path: "/p24/vscode/fix",              description: "Fix diagnostics errors",                       auth: true, rateLimit: "30/min",  tags: ["p24","vscode","fix"],       example: { body: { code: "fn foo() {", diagnostics: ["expected }" ] } } },
    { method: "POST",   path: "/p24/vscode/task",             description: "Create a task from VS Code",                   auth: true, rateLimit: "30/min",  tags: ["p24","vscode","task"],      example: { body: { title: "Fix build error" } } },
    { method: "GET",    path: "/p24/vscode/providers",        description: "List supported AI providers",                  auth: true, rateLimit: "120/min", tags: ["p24","vscode","providers"], example: {} },

    { method: "POST",   path: "/p24/repo/index",              description: "Index a repository for intelligence",          auth: true, rateLimit: "5/min",   tags: ["p24","repo","index"],       example: { body: { path: "/opt/app" } } },
    { method: "GET",    path: "/p24/repo/status",             description: "Repo intelligence index status",               auth: true, rateLimit: "120/min", tags: ["p24","repo","status"],      example: {} },
    { method: "GET",    path: "/p24/repo/symbol/:name",       description: "Find a symbol across the repo",               auth: true, rateLimit: "60/min",  tags: ["p24","repo","symbol"],      example: { params: { name: "executeTask" } } },
    { method: "POST",   path: "/p24/repo/search",             description: "Semantic code search",                         auth: true, rateLimit: "30/min",  tags: ["p24","repo","search"],      example: { body: { query: "circuit breaker logic" } } },
    { method: "GET",    path: "/p24/repo/deps",               description: "Dependency graph for a file",                 auth: true, rateLimit: "60/min",  tags: ["p24","repo","deps"],        example: { query: { file: "backend/services/agentExecutionEngine.cjs" } } },
    { method: "GET",    path: "/p24/repo/xrefs/:symbol",      description: "Cross-file references for a symbol",          auth: true, rateLimit: "60/min",  tags: ["p24","repo","xrefs"],       example: { params: { symbol: "executeTask" } } },

    { method: "POST",   path: "/p24/refactor/plan",           description: "Generate full automated refactor plan",        auth: true, rateLimit: "10/min",  tags: ["p24","refactor","plan"],    example: {} },
    { method: "POST",   path: "/p24/refactor/detect/dup",     description: "Detect code duplication",                     auth: true, rateLimit: "20/min",  tags: ["p24","refactor","detect"],  example: {} },
    { method: "POST",   path: "/p24/refactor/detect/oversized", description: "Detect oversized files",                    auth: true, rateLimit: "20/min",  tags: ["p24","refactor","detect"],  example: {} },
    { method: "POST",   path: "/p24/refactor/detect/smells",  description: "Detect architecture smells",                  auth: true, rateLimit: "20/min",  tags: ["p24","refactor","detect"],  example: {} },
    { method: "POST",   path: "/p24/refactor/apply",          description: "Apply a safe automated refactor",             auth: true, rateLimit: "10/min",  tags: ["p24","refactor","apply"],   example: { body: { planId: "plan_abc", step: 0 } } },
    { method: "GET",    path: "/p24/refactor/plans",          description: "List refactor plans",                         auth: true, rateLimit: "120/min", tags: ["p24","refactor","list"],    example: {} },
    { method: "GET",    path: "/p24/refactor/plans/:planId",  description: "Get a refactor plan",                         auth: true, rateLimit: "60/min",  tags: ["p24","refactor","get"],     example: { params: { planId: "plan_abc" } } },
    { method: "GET",    path: "/p24/refactor/applied",        description: "Applied refactor log",                        auth: true, rateLimit: "60/min",  tags: ["p24","refactor","applied"],  example: {} },

    { method: "POST",   path: "/p24/multirepo/repos",          description: "Register a repository",                      auth: true, rateLimit: "20/min",  tags: ["p24","multirepo","repos"],  example: { body: { path: "/opt/services/auth", name: "auth-svc" } } },
    { method: "DELETE", path: "/p24/multirepo/repos/:repoId",  description: "Unregister a repository",                    auth: true, rateLimit: "10/min",  tags: ["p24","multirepo","repos"],  example: { params: { repoId: "repo_abc" } } },
    { method: "GET",    path: "/p24/multirepo/repos/:repoId",  description: "Get repository info",                        auth: true, rateLimit: "120/min", tags: ["p24","multirepo","repos"],  example: { params: { repoId: "repo_abc" } } },
    { method: "GET",    path: "/p24/multirepo/repos",          description: "List all registered repositories",           auth: true, rateLimit: "120/min", tags: ["p24","multirepo","repos"],  example: {} },
    { method: "POST",   path: "/p24/multirepo/tasks",          description: "Create a shared cross-repo task",            auth: true, rateLimit: "30/min",  tags: ["p24","multirepo","tasks"],  example: { body: { title: "Bump shared lib to v2", repos: ["repo_a", "repo_b"] } } },
    { method: "PATCH",  path: "/p24/multirepo/tasks/:taskId",  description: "Update a cross-repo task status",            auth: true, rateLimit: "30/min",  tags: ["p24","multirepo","tasks"],  example: { params: { taskId: "task_abc" }, body: { status: "done" } } },
    { method: "GET",    path: "/p24/multirepo/tasks/:taskId",  description: "Get a cross-repo task",                      auth: true, rateLimit: "120/min", tags: ["p24","multirepo","tasks"],  example: { params: { taskId: "task_abc" } } },
    { method: "GET",    path: "/p24/multirepo/tasks",          description: "List all cross-repo tasks",                  auth: true, rateLimit: "120/min", tags: ["p24","multirepo","tasks"],  example: {} },
    { method: "POST",   path: "/p24/multirepo/deps",           description: "Add a cross-repo dependency",                auth: true, rateLimit: "20/min",  tags: ["p24","multirepo","deps"],   example: { body: { from: "repo_a", to: "repo_b", type: "imports" } } },
    { method: "DELETE", path: "/p24/multirepo/deps/:depId",    description: "Remove a cross-repo dependency",             auth: true, rateLimit: "10/min",  tags: ["p24","multirepo","deps"],   example: { params: { depId: "dep_abc" } } },
    { method: "GET",    path: "/p24/multirepo/deps",           description: "Cross-repo dependency graph",                auth: true, rateLimit: "60/min",  tags: ["p24","multirepo","deps"],   example: {} },
    { method: "GET",    path: "/p24/multirepo/deps/:repoId/dependents", description: "Who depends on a repository",      auth: true, rateLimit: "60/min",  tags: ["p24","multirepo","deps"],   example: { params: { repoId: "repo_abc" } } },
    { method: "POST",   path: "/p24/multirepo/releases",       description: "Plan a cross-repo release",                  auth: true, rateLimit: "10/min",  tags: ["p24","multirepo","releases"],example: { body: { version: "2.0.0", repos: ["repo_a", "repo_b"] } } },
    { method: "PATCH",  path: "/p24/multirepo/releases/:id",   description: "Update a cross-repo release",                auth: true, rateLimit: "20/min",  tags: ["p24","multirepo","releases"],example: { params: { id: "rel_abc" } } },
    { method: "GET",    path: "/p24/multirepo/releases/:id",   description: "Get a cross-repo release",                   auth: true, rateLimit: "60/min",  tags: ["p24","multirepo","releases"],example: { params: { id: "rel_abc" } } },
    { method: "GET",    path: "/p24/multirepo/releases",       description: "List cross-repo releases",                   auth: true, rateLimit: "120/min", tags: ["p24","multirepo","releases"],example: {} },

    // ── P25 Deployment Autopilot, Secret Rotation, Enterprise Obs, Code Search ─
    { method: "POST",   path: "/p25/deploy/canary",              description: "Start a canary deployment",                auth: true, rateLimit: "10/min",  tags: ["p25","deploy","canary"],     example: { body: { service: "backend", trafficPct: 10 } } },
    { method: "POST",   path: "/p25/deploy/canary/:id/promote",  description: "Promote canary traffic percentage",        auth: true, rateLimit: "10/min",  tags: ["p25","deploy","canary"],     example: { params: { id: "dep_abc" }, body: { trafficPct: 50 } } },
    { method: "POST",   path: "/p25/deploy/canary/:id/rollback", description: "Rollback a canary deployment",             auth: true, rateLimit: "10/min",  tags: ["p25","deploy","canary"],     example: { params: { id: "dep_abc" } } },
    { method: "POST",   path: "/p25/deploy/bluegreen",           description: "Start a blue/green deployment",            auth: true, rateLimit: "10/min",  tags: ["p25","deploy","bluegreen"],  example: { body: { service: "backend" } } },
    { method: "POST",   path: "/p25/deploy/bluegreen/:id/switch", description: "Switch blue/green traffic",              auth: true, rateLimit: "10/min",  tags: ["p25","deploy","bluegreen"],  example: { params: { id: "dep_abc" } } },
    { method: "POST",   path: "/p25/deploy/bluegreen/:id/rollback", description: "Rollback a blue/green deployment",     auth: true, rateLimit: "10/min",  tags: ["p25","deploy","bluegreen"],  example: { params: { id: "dep_abc" } } },
    { method: "POST",   path: "/p25/deploy/pipeline",            description: "Run multi-environment pipeline deployment", auth: true, rateLimit: "5/min",   tags: ["p25","deploy","pipeline"],   example: { body: { envs: ["staging", "production"] } } },
    { method: "POST",   path: "/p25/deploy/validate",            description: "Run release validation",                   auth: true, rateLimit: "10/min",  tags: ["p25","deploy","validate"],   example: {} },
    { method: "POST",   path: "/p25/deploy/:id/rollback",        description: "Rollback any deployment by id",            auth: true, rateLimit: "10/min",  tags: ["p25","deploy","rollback"],   example: { params: { id: "dep_abc" } } },
    { method: "GET",    path: "/p25/deploy/:id",                 description: "Get deployment status",                    auth: true, rateLimit: "120/min", tags: ["p25","deploy","get"],        example: { params: { id: "dep_abc" } } },
    { method: "GET",    path: "/p25/deploy",                     description: "List all deployments",                     auth: true, rateLimit: "120/min", tags: ["p25","deploy","list"],       example: {} },
    { method: "GET",    path: "/p25/deploy/history",             description: "Deployment history",                       auth: true, rateLimit: "60/min",  tags: ["p25","deploy","history"],    example: {} },

    { method: "POST",   path: "/p25/secrets/schedules",          description: "Set a secret rotation schedule",           auth: true, rateLimit: "20/min",  tags: ["p25","secrets","schedule"],  example: { body: { name: "API_KEY", intervalDays: 90 } } },
    { method: "DELETE", path: "/p25/secrets/schedules/:name",    description: "Remove a secret rotation schedule",        auth: true, rateLimit: "10/min",  tags: ["p25","secrets","schedule"],  example: { params: { name: "API_KEY" } } },
    { method: "GET",    path: "/p25/secrets/schedules/:name",    description: "Get a rotation schedule",                  auth: true, rateLimit: "60/min",  tags: ["p25","secrets","schedule"],  example: { params: { name: "API_KEY" } } },
    { method: "GET",    path: "/p25/secrets/schedules",          description: "List all rotation schedules",              auth: true, rateLimit: "120/min", tags: ["p25","secrets","schedule"],  example: {} },
    { method: "POST",   path: "/p25/secrets/:name/rotated",      description: "Record a secret rotation event",           auth: true, rateLimit: "20/min",  tags: ["p25","secrets","rotate"],    example: { params: { name: "API_KEY" } } },
    { method: "GET",    path: "/p25/secrets/:name/history",      description: "Rotation history for a secret",            auth: true, rateLimit: "60/min",  tags: ["p25","secrets","history"],   example: { params: { name: "API_KEY" } } },
    { method: "GET",    path: "/p25/secrets/reminders",          description: "Check rotation reminders",                 auth: true, rateLimit: "60/min",  tags: ["p25","secrets","reminders"], example: {} },
    { method: "POST",   path: "/p25/secrets/validate",           description: "Validate a secret value",                  auth: true, rateLimit: "30/min",  tags: ["p25","secrets","validate"],  example: { body: { name: "API_KEY", value: "sk-..." } } },
    { method: "GET",    path: "/p25/secrets/health",             description: "Aggregate secret health score",            auth: true, rateLimit: "60/min",  tags: ["p25","secrets","health"],    example: {} },
    { method: "POST",   path: "/p25/secrets/bootstrap",          description: "Bootstrap default rotation schedules",     auth: true, rateLimit: "5/min",   tags: ["p25","secrets","bootstrap"], example: {} },

    { method: "POST",   path: "/p25/obs/metrics",                description: "Record an enterprise metric",              auth: true, rateLimit: "300/min", tags: ["p25","obs","metrics"],       example: { body: { service: "backend", name: "req_count", value: 1 } } },
    { method: "GET",    path: "/p25/obs/metrics",                description: "Get metrics (all or by service)",          auth: true, rateLimit: "120/min", tags: ["p25","obs","metrics"],       example: { query: { service: "backend" } } },
    { method: "GET",    path: "/p25/obs/metrics/system",         description: "System and process metrics",               auth: true, rateLimit: "60/min",  tags: ["p25","obs","metrics"],       example: {} },
    { method: "POST",   path: "/p25/obs/traces/span/start",      description: "Start a distributed trace span",           auth: true, rateLimit: "300/min", tags: ["p25","obs","traces"],        example: { body: { traceId: "tr_abc", name: "process-order" } } },
    { method: "POST",   path: "/p25/obs/traces/span/:spanId/end", description: "End a trace span",                        auth: true, rateLimit: "300/min", tags: ["p25","obs","traces"],        example: { params: { spanId: "sp_abc" } } },
    { method: "POST",   path: "/p25/obs/traces/span/:spanId/event", description: "Add event to a trace span",            auth: true, rateLimit: "300/min", tags: ["p25","obs","traces"],        example: { params: { spanId: "sp_abc" }, body: { name: "cache-hit" } } },
    { method: "GET",    path: "/p25/obs/traces/:traceId",        description: "Get a full distributed trace",             auth: true, rateLimit: "120/min", tags: ["p25","obs","traces"],        example: { params: { traceId: "tr_abc" } } },
    { method: "GET",    path: "/p25/obs/traces",                 description: "List traces by service",                   auth: true, rateLimit: "120/min", tags: ["p25","obs","traces"],        example: { query: { service: "backend" } } },
    { method: "GET",    path: "/p25/obs/servicemap",             description: "Service dependency map",                   auth: true, rateLimit: "30/min",  tags: ["p25","obs","servicemap"],    example: {} },
    { method: "POST",   path: "/p25/obs/alerts/rules",           description: "Set an alert rule",                        auth: true, rateLimit: "20/min",  tags: ["p25","obs","alerts"],        example: { body: { metric: "error_rate", threshold: 5 } } },
    { method: "GET",    path: "/p25/obs/alerts/rules",           description: "List alert rules",                         auth: true, rateLimit: "60/min",  tags: ["p25","obs","alerts"],        example: {} },
    { method: "POST",   path: "/p25/obs/alerts/fire",            description: "Fire a manual alert",                      auth: true, rateLimit: "10/min",  tags: ["p25","obs","alerts"],        example: { body: { message: "latency spike" } } },
    { method: "POST",   path: "/p25/obs/alerts/:alertId/resolve", description: "Resolve an enterprise alert",            auth: true, rateLimit: "20/min",  tags: ["p25","obs","alerts"],        example: { params: { alertId: "alert_abc" } } },
    { method: "GET",    path: "/p25/obs/alerts",                 description: "List active enterprise alerts",            auth: true, rateLimit: "120/min", tags: ["p25","obs","alerts"],        example: {} },
    { method: "PUT",    path: "/p25/obs/channels/:channelId",    description: "Configure an alert notification channel",  auth: true, rateLimit: "10/min",  tags: ["p25","obs","channels"],      example: { params: { channelId: "slack" } } },
    { method: "GET",    path: "/p25/obs/channels",               description: "List all notification channels",           auth: true, rateLimit: "60/min",  tags: ["p25","obs","channels"],      example: {} },
    { method: "POST",   path: "/p25/obs/slos",                   description: "Create a Service Level Objective",         auth: true, rateLimit: "10/min",  tags: ["p25","obs","slos"],          example: { body: { name: "api-availability", target: 99.9 } } },
    { method: "POST",   path: "/p25/obs/slos/:sloId/event",      description: "Record an SLO event",                     auth: true, rateLimit: "300/min", tags: ["p25","obs","slos"],          example: { params: { sloId: "slo_abc" }, body: { success: true } } },
    { method: "GET",    path: "/p25/obs/slos/:sloId",            description: "Get SLO status",                           auth: true, rateLimit: "60/min",  tags: ["p25","obs","slos"],          example: { params: { sloId: "slo_abc" } } },
    { method: "GET",    path: "/p25/obs/slos",                   description: "List all SLOs",                            auth: true, rateLimit: "60/min",  tags: ["p25","obs","slos"],          example: {} },

    { method: "POST",   path: "/p25/search",                     description: "Full large-context code search",           auth: true, rateLimit: "30/min",  tags: ["p25","search","code"],       example: { body: { query: "circuit breaker", ext: ".cjs" } } },
    { method: "GET",    path: "/p25/search/related",             description: "Related files for a given file path",      auth: true, rateLimit: "30/min",  tags: ["p25","search","related"],    example: { query: { file: "backend/services/agentExecutionEngine.cjs" } } },
    { method: "GET",    path: "/p25/search/context",             description: "Extract context around a line",            auth: true, rateLimit: "60/min",  tags: ["p25","search","context"],    example: { query: { file: "backend/index.js", line: 42 } } },
    { method: "GET",    path: "/p25/search/stats",               description: "Large-context repo statistics",            auth: true, rateLimit: "60/min",  tags: ["p25","search","stats"],      example: {} },
];

/**
 * generateManifest() → { version, generatedAt, endpoints[], totalEndpoints }
 */
function generateManifest() {
    const manifest = {
        version:        MANIFEST_VERSION,
        generatedAt:    new Date().toISOString(),
        endpoints:      ENDPOINT_CATALOGUE,
        totalEndpoints: ENDPOINT_CATALOGUE.length,
    };
    _saveJson(MANIFEST_FILE, manifest);
    return manifest;
}

/**
 * getManifest() → cached manifest (regenerates if >1h old)
 */
function getManifest() {
    const now = Date.now();
    if (_manifestCache && (now - _manifestGeneratedAt) < MANIFEST_TTL_MS) {
        return _manifestCache;
    }

    // Try loading from disk first
    const persisted = _loadJson(MANIFEST_FILE, null);
    if (persisted && persisted.generatedAt) {
        const age = now - new Date(persisted.generatedAt).getTime();
        if (age < MANIFEST_TTL_MS) {
            _manifestCache      = persisted;
            _manifestGeneratedAt = new Date(persisted.generatedAt).getTime();
            return _manifestCache;
        }
    }

    _manifestCache      = generateManifest();
    _manifestGeneratedAt = now;
    return _manifestCache;
}

/**
 * getEndpoint(method, path) → endpoint definition | null
 */
function getEndpoint(method, endpointPath) {
    const m = (method || "").toUpperCase();
    const p = (endpointPath || "").toLowerCase();
    return ENDPOINT_CATALOGUE.find(e => e.method === m && e.path.toLowerCase() === p) || null;
}

/**
 * searchEndpoints(query) → { endpoints[] }
 * Searches path, description, and tags.
 */
function searchEndpoints(query) {
    if (!query || !query.trim()) return { endpoints: ENDPOINT_CATALOGUE };
    const tokens = query.toLowerCase().split(/\s+/);
    const results = ENDPOINT_CATALOGUE.filter(e => {
        const haystack = [e.path, e.description, ...(e.tags || [])].join(" ").toLowerCase();
        return tokens.every(t => haystack.includes(t));
    });
    return { endpoints: results, total: results.length, query };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — TEMPLATE SYSTEM EXTENSION
// ─────────────────────────────────────────────────────────────────────────────

/** Local template store (fallback when workflowLibrary is unavailable). */
const _localTemplates = new Map();

/**
 * Alias map: caller-supplied id → library-assigned id.
 * workflowLibrary.createWorkflow() ignores opts.id and generates its own.
 * We track the mapping here so instantiateTemplate can resolve aliases.
 */
const _templateAliases = new Map(); // callerId → libraryId

/**
 * registerTemplate(template) → { templateId }
 *
 * Forwards to workflowLibrary.createWorkflow() if available (storing the
 * library's generated id in _templateAliases keyed by template.id),
 * otherwise stores locally.
 */
function registerTemplate(template) {
    if (!template || !template.id) throw new Error("template.id required");

    const lib = _tryRequire("../../agents/runtime/workflowLibrary.cjs");
    if (lib && typeof lib.createWorkflow === "function") {
        try {
            const result = lib.createWorkflow({
                name:       template.name       || template.id,
                category:   template.category   || "general",
                tags:       template.tags        || [],
                goal:       template.goal        || template.description || "",
                steps:      template.steps       || [],
                replayable: template.replayable  !== false,
                exportable: template.exportable  !== false,
            });
            if (result && result.created && result.workflow) {
                const libraryId = result.workflow.id;
                // Register the caller-supplied id as an alias
                _templateAliases.set(template.id, libraryId);
                // Also store locally so instantiateTemplate can resolve by caller id
                _localTemplates.set(template.id, {
                    ...result.workflow,
                    id: template.id,   // keep caller's id in the local record
                    _libraryId: libraryId,
                    registeredAt: new Date().toISOString(),
                });
                return { templateId: template.id, source: "workflowLibrary" };
            }
            // createWorkflow returned { created: false } — fall through
        } catch { /* fall through to local store */ }
    }

    _localTemplates.set(template.id, {
        ...template,
        registeredAt: new Date().toISOString(),
    });
    return { templateId: template.id, source: "local" };
}

/**
 * listTemplates(category) → template[]
 *
 * Merges results from workflowLibrary (if available) and local store.
 */
function listTemplates(category) {
    const results = [];

    const lib = _tryRequire("../../agents/runtime/workflowLibrary.cjs");
    if (lib && typeof lib.listWorkflows === "function") {
        const { workflows } = lib.listWorkflows(category ? { category } : {});
        for (const wf of (workflows || [])) {
            results.push({ ...wf, source: "workflowLibrary" });
        }
    }

    for (const [, t] of _localTemplates) {
        if (!category || t.category === category) {
            if (!results.find(r => r.id === t.id)) {
                results.push({ ...t, source: "local" });
            }
        }
    }

    return results;
}

/**
 * instantiateTemplate(templateId, vars) → filled template ready to dispatch
 *
 * vars is a plain { key: value } map. Values are interpolated into
 * `goal` and step `cmd` / `label` strings via {{ key }} placeholders.
 */
function instantiateTemplate(templateId, vars = {}) {
    // Fetch base template
    let template = null;

    const lib = _tryRequire("../../agents/runtime/workflowLibrary.cjs");
    if (lib && typeof lib.getWorkflow === "function") {
        const wf = lib.getWorkflow(templateId);
        if (wf) template = { ...wf };
    }

    if (!template) {
        const local = _localTemplates.get(templateId);
        if (local) template = { ...local };
    }

    if (!template) throw new Error(`Template "${templateId}" not found`);

    function _interpolate(str) {
        if (typeof str !== "string") return str;
        return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) =>
            Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{{${key}}}`
        );
    }

    const filled = {
        ...template,
        goal:  _interpolate(template.goal),
        steps: (template.steps || []).map(step => ({
            ...step,
            label: _interpolate(step.label),
            cmd:   _interpolate(step.cmd),
        })),
        vars,
        instantiatedAt: new Date().toISOString(),
    };

    return filled;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

(function _init() {
    // Restore persisted plugins (meta only; functions not stored)
    const persisted = _loadJson(PLUGIN_FILE, { plugins: [] });
    for (const meta of (persisted.plugins || [])) {
        if (!_plugins.has(meta.id)) {
            // Restore as a meta-only shell (hooks will be absent)
            _plugins.set(meta.id, { ...meta, hooks: {}, routes: [] });
        }
    }

    // Restore persisted capabilities
    const caps = _loadJson(CAP_FILE, { capabilities: [] });
    for (const cap of (caps.capabilities || [])) {
        if (!_capabilities.has(cap.id)) {
            _capabilities.set(cap.id, cap);
        }
    }

    // Bootstrap built-in agent capabilities
    _bootstrapBuiltinCapabilities();
})();

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    // Plugin SDK
    registerPlugin,
    unregisterPlugin,
    getPlugin,
    listPlugins,
    executeHook,
    getPluginRoutes,

    // Capability Registry
    registerCapability,
    getCapability,
    listCapabilities,
    findByCapability,
    getCapabilityMap,

    // API Manifest
    generateManifest,
    getManifest,
    getEndpoint,
    searchEndpoints,

    // Template System
    registerTemplate,
    listTemplates,
    instantiateTemplate,

    // Exposed for testing / introspection
    ENDPOINT_CATALOGUE,
    MANIFEST_VERSION,
};
