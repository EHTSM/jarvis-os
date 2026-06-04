"use strict";
/**
 * AgentFactoryAutomation — programmatically create, clone, configure
 * and register agents with tools, permissions and memory links.
 *
 * Integrates with:
 *   toolExecutionLayer.cjs     — validates tool assignments
 *   memoryPersistenceLayer.cjs — registers memory links per agent
 *   agentExecutionEngine.cjs   — runtime dispatch
 *   data/agent-registry.json   — persistent agent catalog (this module owns it)
 *
 * Public API:
 *   createAgent(spec)               → AgentRecord
 *   cloneAgent(sourceId, overrides) → AgentRecord
 *   assignTools(agentId, toolIds)   → AgentRecord
 *   setPermissions(agentId, perms)  → AgentRecord
 *   registerMemory(agentId, nodeIds)→ AgentRecord
 *   retireAgent(agentId)            → AgentRecord
 *   getAgent(agentId)               → AgentRecord | null
 *   listAgents(opts)                → { agents[], stats }
 *   getRegistry()                   → full registry snapshot
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");

const REGISTRY_FILE = path.join(__dirname, "../../data/agent-registry.json");

// ── I/O ──────────────────────────────────────────────────────────────────
function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function _wj(f, d) {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = f + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

let _registry = _rj(REGISTRY_FILE, []);  // Array<AgentRecord>
let _seq = _registry.length;
function _aid() { return `agt_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(REGISTRY_FILE, _registry); } catch { /* non-fatal */ } }

// ── Tool catalog reference (lightweight — validates tool IDs) ────────────
const KNOWN_TOOLS = new Set(["github","gmail","slack","notion","gdrive","telegram","openrouter","ollama"]);

// ── Default capability → tool mapping ───────────────────────────────────
const CAP_TOOL_MAP = {
    email_send:         ["gmail"],
    email_draft:        ["gmail"],
    social_post:        ["slack","telegram"],
    ticket_reply:       ["gmail","slack","telegram"],
    code_write:         ["github"],
    pr_create:          ["github"],
    web_search:         ["openrouter"],
    brief_generate:     ["openrouter","ollama"],
    blog_write:         ["openrouter","ollama"],
    newsletter_draft:   ["openrouter","ollama"],
    keyword_research:   ["openrouter"],
    meta_generate:      ["openrouter","ollama"],
    report_generate:    ["openrouter","ollama"],
    task_dispatch:      ["openrouter"],
    deploy:             ["github"],
    campaign_schedule:  ["slack","gmail"],
};

// ── AgentRecord schema ───────────────────────────────────────────────────
/**
 * {
 *   agentId, name, type, description,
 *   capabilities: string[],
 *   tools: string[],                  — assigned tool IDs
 *   permissions: { [toolId]: { [action]: bool } },
 *   memoryNodeIds: string[],          — memory nodes accessible to this agent
 *   model: string,
 *   status: "active"|"idle"|"retired",
 *   createdAt, updatedAt,
 *   clonedFrom: string|null,
 *   metadata: {}
 * }
 */

function _defaults(spec) {
    const now = new Date().toISOString();
    // Auto-derive tools from capabilities if not specified
    let tools = spec.tools || [];
    if (!tools.length && spec.capabilities) {
        const derived = new Set();
        for (const cap of spec.capabilities) {
            for (const t of (CAP_TOOL_MAP[cap] || [])) derived.add(t);
        }
        tools = Array.from(derived);
    }
    return {
        agentId:       spec.agentId    || _aid(),
        name:          spec.name       || "New Agent",
        type:          spec.type       || "general",
        description:   spec.description|| "",
        capabilities:  spec.capabilities || [],
        tools:         tools.filter(t => KNOWN_TOOLS.has(t)),
        permissions:   spec.permissions  || _defaultPermissions(tools),
        memoryNodeIds: spec.memoryNodeIds|| [],
        model:         spec.model        || "claude-sonnet-4-6",
        status:        spec.status       || "active",
        clonedFrom:    spec.clonedFrom   || null,
        createdAt:     spec.createdAt    || now,
        updatedAt:     now,
        metadata:      spec.metadata     || {},
    };
}

function _defaultPermissions(tools) {
    const perms = {};
    for (const toolId of (tools || [])) {
        // Mirror the ToolExecutionLayer default: low-risk reads allowed, writes denied
        const defaults = {
            github:     { read_repo: true, list_issues: true, create_issue: true, create_pr: false, push_commit: false, merge_pr: false },
            gmail:      { read_inbox: true, search_mail: true, send_email: false, reply_email: false },
            slack:      { read_channel: true, post_message: true, upload_file: true, create_channel: false },
            notion:     { read_page: true, create_page: true, update_page: true, delete_page: false },
            gdrive:     { list_files: true, download_file: true, upload_file: false, delete_file: false },
            telegram:   { send_message: true, send_document: true, read_updates: true },
            openrouter: { chat_completion: true, stream_completion: true, list_models: true },
            ollama:     { generate: true, chat: true, list_models: true, pull_model: false },
        };
        if (defaults[toolId]) perms[toolId] = defaults[toolId];
    }
    return perms;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Create a new agent from a spec. */
function createAgent(spec) {
    if (!spec.name) throw new Error("name required");
    const agent = _defaults(spec);
    _registry.push(agent);
    _save();

    // Register memory links
    if (agent.memoryNodeIds.length) {
        try {
            const mpl = require("./memoryPersistenceLayer.cjs");
            for (const nid of agent.memoryNodeIds) {
                const node = mpl.load(nid);
                if (node && !node.agentIds.includes(agent.agentId)) {
                    mpl.update(nid, { agentIds: [...node.agentIds, agent.agentId] });
                }
            }
        } catch { /* non-critical */ }
    }

    auditLog.append({ type: "agent_create", agentId: agent.agentId, name: agent.name, tools: agent.tools });
    logger.info(`[AgentFactory] Created ${agent.agentId}: ${agent.name} (tools: ${agent.tools.join(",")||"none"})`);
    return { ...agent };
}

/** Clone an existing agent with optional overrides. */
function cloneAgent(sourceId, overrides = {}) {
    const source = _registry.find(a => a.agentId === sourceId);
    if (!source) throw new Error(`Agent ${sourceId} not found`);
    const cloned = _defaults({
        ...source,
        ...overrides,
        agentId:    undefined,      // force new ID
        name:       overrides.name || `${source.name} (clone)`,
        clonedFrom: sourceId,
        createdAt:  undefined,
    });
    _registry.push(cloned);
    _save();
    auditLog.append({ type: "agent_clone", sourceId, newAgentId: cloned.agentId });
    logger.info(`[AgentFactory] Cloned ${sourceId} → ${cloned.agentId}`);
    return { ...cloned };
}

/** Assign (replace) tool list for an agent. Auto-derives missing permissions. */
function assignTools(agentId, toolIds) {
    const idx = _registry.findIndex(a => a.agentId === agentId);
    if (idx < 0) throw new Error(`Agent ${agentId} not found`);
    const validTools = toolIds.filter(t => KNOWN_TOOLS.has(t));
    const agent = _registry[idx];
    // Merge new tool permissions into existing, don't overwrite already-set ones
    const newPerms = _defaultPermissions(validTools);
    for (const [tid, actions] of Object.entries(newPerms)) {
        if (!agent.permissions[tid]) agent.permissions[tid] = actions;
    }
    agent.tools     = validTools;
    agent.updatedAt = new Date().toISOString();
    _save();
    auditLog.append({ type: "agent_tools_assigned", agentId, tools: validTools });
    return { ...agent };
}

/** Set explicit permissions for an agent (merged with existing). */
function setPermissions(agentId, perms) {
    const idx = _registry.findIndex(a => a.agentId === agentId);
    if (idx < 0) throw new Error(`Agent ${agentId} not found`);
    const agent = _registry[idx];
    // Deep merge: perms = { toolId: { action: bool } }
    for (const [toolId, actions] of Object.entries(perms)) {
        if (!agent.permissions[toolId]) agent.permissions[toolId] = {};
        Object.assign(agent.permissions[toolId], actions);
    }
    agent.updatedAt = new Date().toISOString();
    _save();
    auditLog.append({ type: "agent_permissions_set", agentId });
    return { ...agent };
}

/** Associate memory node IDs with an agent. */
function registerMemory(agentId, nodeIds) {
    const idx = _registry.findIndex(a => a.agentId === agentId);
    if (idx < 0) throw new Error(`Agent ${agentId} not found`);
    const agent = _registry[idx];
    const merged = Array.from(new Set([...agent.memoryNodeIds, ...nodeIds]));
    agent.memoryNodeIds = merged;
    agent.updatedAt     = new Date().toISOString();
    _save();
    // Propagate back to memory store
    try {
        const mpl = require("./memoryPersistenceLayer.cjs");
        for (const nid of nodeIds) {
            const node = mpl.load(nid);
            if (node && !node.agentIds.includes(agentId)) {
                mpl.update(nid, { agentIds: [...node.agentIds, agentId] });
            }
        }
    } catch { /* non-critical */ }
    auditLog.append({ type: "agent_memory_registered", agentId, nodeIds });
    return { ...agent };
}

/** Retire an agent (soft-delete — keeps history). */
function retireAgent(agentId) {
    const idx = _registry.findIndex(a => a.agentId === agentId);
    if (idx < 0) throw new Error(`Agent ${agentId} not found`);
    _registry[idx].status    = "retired";
    _registry[idx].updatedAt = new Date().toISOString();
    _save();
    auditLog.append({ type: "agent_retire", agentId });
    return { ..._registry[idx] };
}

function getAgent(agentId) {
    return _registry.find(a => a.agentId === agentId) || null;
}

function listAgents({ status, type, limit = 100, offset = 0 } = {}) {
    let rows = [..._registry];
    if (status) rows = rows.filter(a => a.status === status);
    if (type)   rows = rows.filter(a => a.type   === type);
    const stats = {
        total:   _registry.length,
        active:  _registry.filter(a => a.status === "active").length,
        idle:    _registry.filter(a => a.status === "idle").length,
        retired: _registry.filter(a => a.status === "retired").length,
    };
    return { agents: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getRegistry() {
    return { agents: _registry, total: _registry.length, file: REGISTRY_FILE };
}

module.exports = { createAgent, cloneAgent, assignTools, setPermissions, registerMemory, retireAgent, getAgent, listAgents, getRegistry };
