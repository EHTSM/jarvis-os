"use strict";
/**
 * agentInstanceRegistry.cjs — Universal Composition Engine, Phase 4
 * (Agent Factory: specialized agent instances from reusable archetypes).
 *
 * The real agent runtime (agents/runtime/agentRegistry.cjs) is a single,
 * process-wide Map of 38 stateless handler functions keyed by capability
 * — correct, since handlers are genuinely reusable code shared by every
 * org. What's missing is any way to say "Company X's CRM agent has these
 * goals/policies/memory scope/credential refs, distinct from Company Y's."
 *
 * This module does NOT duplicate or replace agentRegistry.cjs. It adds a
 * thin, additive overlay: an AgentInstance record that references an
 * archetype by capability id and layers org/company-specific config on
 * top. Dispatch (agents/runtime/executionEngine.cjs) still selects the
 * stateless handler by capability exactly as before; when a task carries
 * an orgId, the handler's ctx is additionally enriched with the matching
 * instance's config — see executeTask()'s _instReg() lookup.
 *
 * No credential VALUES are ever stored here — only credentialRefs
 * (strings resolved elsewhere through secretVault.cjs). Enforced
 * structurally via capabilityContract.cjs's Agent kind validation.
 *
 * Storage: data/agent-instances.json (self-initializing, matching the
 * organizationService.cjs _read()/_write() convention).
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const DATA_DIR  = path.join(__dirname, "../../data");
// Universal Composition Engine — Completion Gaps Phase 7 (test fixture
// concurrency reliability): tests/runtime/*.test.cjs files run as
// separate processes (Node's default test-isolation=process) but
// several of them share this ONE file with no locking — concurrent
// writes race and clobber each other, causing intermittent failures
// (confirmed and diagnosed in an earlier phase of this mission).
// JARVIS_TEST_DATA_SUFFIX gives each test process its own isolated file
// (e.g. "agent-instances.test-abc123.json") instead of the shared
// production path — unset (the default, real server/dev usage) means
// zero behavior change. This is preferred over forcing sequential test
// execution (which would hide the race rather than fix it) or a
// file-locking mechanism (architectural expansion this phase's own
// rule discourages when a simpler fix exists).
const INST_FILE = path.join(DATA_DIR, process.env.JARVIS_TEST_DATA_SUFFIX
    ? `agent-instances.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`
    : "agent-instances.json");

function _contract() { try { return require("./capabilityContract.cjs"); } catch { return null; } }

function _read() {
    try { return JSON.parse(fs.readFileSync(INST_FILE, "utf8")); }
    catch { return { instances: [] }; }
}
function _write(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INST_FILE, JSON.stringify(store, null, 2));
}

/**
 * Register a new agent instance — a company-scoped configuration overlay
 * on top of a real, already-registered archetype capability.
 *
 * @param {string} archetypeId   a capability id real in agentRegistry.cjs (e.g. "crm")
 * @param {string} orgId
 * @param {string} companyId
 * @param {object} config        { goals?, policies?, memoryScopeId?, kpiTargets?, departmentId?, credentialRefs?, permissions? }
 * @returns {object} the created instance record
 */
function register(archetypeId, orgId, companyId, config = {}) {
    if (!archetypeId?.trim()) throw new Error("archetypeId is required");
    if (!orgId?.trim()) throw new Error("orgId is required");
    if (!companyId?.trim()) throw new Error("companyId is required");

    const contract = _contract();
    const id = contract ? contract._id("agentinst") : `agentinst_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const instance = {
        id,
        orgId,
        companyId,
        departmentId: config.departmentId || null,
        archetypeId,
        config: {
            goals: config.goals || [],
            policies: config.policies || [],
            memoryScopeId: config.memoryScopeId || null,
            kpiTargets: config.kpiTargets || {},
        },
        credentialRefs: config.credentialRefs || [],
        permissions: config.permissions || [],
        createdAt: new Date().toISOString(),
        status: "active",
    };

    if (contract) {
        // Validate against the FULL raw config the caller passed in (not
        // just the picked-out fields above) so a stray raw-secret field
        // anywhere in the caller's input is genuinely rejected, not
        // silently dropped by only checking the fields this module chose
        // to copy out.
        const check = contract.validate("Agent", {
            id: instance.id, orgId: instance.orgId, archetypeId: instance.archetypeId,
            config: { ...config, ...instance.config },
            credentialRefs: instance.credentialRefs,
            permissions: instance.permissions,
        });
        if (!check.ok) throw new Error(`Invalid agent instance: ${check.errors.join("; ")}`);
    }

    const store = _read();
    if (!store.instances) store.instances = [];
    store.instances.push(instance);
    _write(store);
    logger.info(`[AgentInstanceRegistry] Registered instance ${instance.id} (archetype=${archetypeId}, org=${orgId})`);
    return { ...instance };
}

/**
 * Find the agent instance for a given org + archetype capability, if any.
 * Returns null when no instance is registered — callers must treat this
 * as "use today's global/stateless behavior", not an error.
 */
function findForOrgAndArchetype(orgId, archetypeId) {
    if (!orgId || !archetypeId) return null;
    const store = _read();
    const found = (store.instances || []).find(i => i.orgId === orgId && i.archetypeId === archetypeId && i.status === "active");
    return found ? { ...found } : null;
}

/**
 * List all agent instances for a given company.
 */
function listForCompany(companyId) {
    const store = _read();
    return (store.instances || []).filter(i => i.companyId === companyId).map(i => ({ ...i }));
}

/**
 * List all agent instances for a given org (across all its companies).
 */
function listForOrg(orgId) {
    const store = _read();
    return (store.instances || []).filter(i => i.orgId === orgId).map(i => ({ ...i }));
}

function deactivate(instanceId) {
    const store = _read();
    const inst = (store.instances || []).find(i => i.id === instanceId);
    if (!inst) return { ok: false, error: "instance not found" };
    inst.status = "inactive";
    _write(store);
    return { ok: true };
}

const MAX_OBSERVATIONS_PER_INSTANCE = 200;

/**
 * Universal Composition Engine Phase 11 — the "update memory/KPI" step
 * of the Execution Runtime chain. Appends a bounded execution
 * observation onto the instance's own record (distinct from
 * executionHistory.cjs's global, agent-wide log — this is the
 * per-company, per-instance view a future Learning Loop / Capability
 * Evolution consumer can read without scanning the entire global
 * history). Non-fatal: a missing instance is a no-op, never throws,
 * since this is telemetry, not a required step in the dispatch path.
 *
 * @param {string} instanceId
 * @param {{ success: boolean, durationMs?: number, taskType?: string, error?: string|null }} observation
 */
function recordObservation(instanceId, observation = {}) {
    if (!instanceId) return { ok: false, error: "instanceId required" };
    const store = _read();
    const inst = (store.instances || []).find(i => i.id === instanceId);
    if (!inst) return { ok: false, error: "instance not found" };

    if (!inst.observations) inst.observations = [];
    inst.observations.push({
        ts: new Date().toISOString(),
        success: !!observation.success,
        durationMs: observation.durationMs || 0,
        taskType: observation.taskType || null,
        error: observation.error || null,
    });
    if (inst.observations.length > MAX_OBSERVATIONS_PER_INSTANCE) {
        inst.observations = inst.observations.slice(-MAX_OBSERVATIONS_PER_INSTANCE);
    }
    _write(store);
    return { ok: true };
}

module.exports = {
    register,
    findForOrgAndArchetype,
    listForCompany,
    listForOrg,
    deactivate,
    recordObservation,
};
