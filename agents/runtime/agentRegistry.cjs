"use strict";
/**
 * agentRegistry — catalog of available agents with capability mapping
 * and per-agent circuit breakers.
 *
 * Circuit breaker states: closed (normal) → open (failing) → half-open (probing)
 * Opens after CB_FAIL_THRESHOLD consecutive failures.
 * Half-opens after CB_OPEN_MS ms, allows one probe request.
 *
 * Phase 2 (Agent Identity, Missions 121-124): every field below this point
 * is OPTIONAL and additive. Every existing production caller (bootstrapRuntime.cjs)
 * registers only {id, capabilities, maxConcurrent, handler} — none of these new
 * fields — so every existing agent gets the safe defaults (permissions: null =
 * unrestricted, matching today's actual behavior; lifecycleState: "active").
 * This does not change dispatch/circuit-breaker/preferenceWeight behavior.
 */

const logger = require("../../backend/utils/logger");

const CB_FAIL_THRESHOLD = 5;
const CB_OPEN_MS        = 60_000;  // 1 minute cooldown
const VALID_LIFECYCLE_STATES = new Set(["active", "paused", "retired"]);

class AgentRecord {
    constructor({
        id, capabilities, handler, maxConcurrent = 3,
        role = null,
        purpose = null,
        allowedTools = null,       // null = unrestricted (existing behavior); array = explicit allowlist
        credentialScope = [],      // named credential/connector scopes this agent may use — never actual secret values
        workspaceScope = null,     // orgId/workspaceId this agent instance is confined to, or null = platform-internal
        lifecycleState = "active", // active | paused | retired
        provenance = null,         // { registeredBy, registeredAt, source } — where/how this agent came to exist
    }) {
        this.id             = id;
        this.capabilities   = new Set(capabilities || []);
        this.handler        = handler;   // async fn(task, context) → result
        this.maxConcurrent  = maxConcurrent;

        // ── Identity (Phase 2, Missions 121-124) ────────────────────────
        this.role            = role;
        this.purpose         = purpose;
        this.allowedTools    = allowedTools ? new Set(allowedTools) : null;
        this.credentialScope = new Set(credentialScope || []);
        this.workspaceScope  = workspaceScope;
        this.lifecycleState  = VALID_LIFECYCLE_STATES.has(lifecycleState) ? lifecycleState : "active";
        this.provenance      = provenance || { registeredBy: "unknown", registeredAt: new Date().toISOString(), source: "unspecified" };

        // Circuit breaker
        this._cbState       = "closed";  // closed | open | half-open
        this._cbFailures    = 0;
        this._cbOpenedAt    = 0;

        // Concurrency tracking
        this._active        = 0;

        // Lifetime stats
        this.stats = { success: 0, failure: 0, totalMs: 0 };
        this.lastActivity = Date.now();

        // Universal Composition Engine Phase 12 (Learning Loop) — an
        // additive, operational-learning-only tie-breaking nudge. Neutral
        // (0) by default, meaning zero behavior change from before this
        // field existed. Only ever set via
        // continuousLearningEngine.applyLearningRecord() after an
        // explicit human approval — never written by any automatic
        // process on its own. Range [-1, 1]; findForCapability() below
        // uses it only to break ties among otherwise-equal-load agents,
        // never to override circuit-breaker/availability/capability
        // matching.
        this.preferenceWeight = 0;
    }

    /** Returns true if this agent can accept a new task right now. */
    isAvailable() {
        if (this.lifecycleState !== "active") return false;
        if (this._active >= this.maxConcurrent) return false;
        if (this._cbState === "open") {
            if (Date.now() - this._cbOpenedAt >= CB_OPEN_MS) {
                this._cbState = "half-open";
                logger.info(`[AgentRegistry] ${this.id} circuit half-open — probing`);
            } else {
                return false;
            }
        }
        return true;
    }

    /**
     * Phase 2 (Agent Identity): can this agent invoke the given tool?
     * allowedTools === null means unrestricted — the pre-Phase-2 default,
     * so every agent registered before this field existed keeps working
     * exactly as before. An explicit allowedTools list makes this a real
     * gate, enforced by toolExecutionLayer.execute() (see there).
     */
    canUseTool(toolId) {
        if (this.lifecycleState === "retired") return false;
        if (!this.allowedTools) return true;
        return this.allowedTools.has(toolId);
    }

    recordSuccess(durationMs = 0) {
        this._active        = Math.max(0, this._active - 1);
        this._cbFailures    = 0;
        this._cbState       = "closed";
        this.stats.success++;
        this.stats.totalMs += durationMs;
        this.lastActivity = Date.now();
    }

    recordFailure() {
        this._active     = Math.max(0, this._active - 1);
        this._cbFailures++;
        this.stats.failure++;
        this.lastActivity = Date.now();
        if (this._cbFailures >= CB_FAIL_THRESHOLD) {
            if (this._cbState !== "open") {
                this._cbState    = "open";
                this._cbOpenedAt = Date.now();
                logger.warn(`[AgentRegistry] ${this.id} circuit OPEN after ${this._cbFailures} failures`);
            }
        }
    }

    acquireSlot() { 
        this._active++; 
        this.lastActivity = Date.now();
    }

    heartbeat() {
        this.lastActivity = Date.now();
    }

    toJSON() {
        const total = this.stats.success + this.stats.failure;
        return {
            id:           this.id,
            capabilities: [...this.capabilities],
            cbState:      this._cbState,
            active:       this._active,
            maxConcurrent: this.maxConcurrent,
            lastActivity:  this.lastActivity,
            preferenceWeight: this.preferenceWeight,
            // Identity (Phase 2, Missions 121-124) — audit/attribution fields.
            role:            this.role,
            purpose:         this.purpose,
            allowedTools:    this.allowedTools ? [...this.allowedTools] : null,
            credentialScope: [...this.credentialScope],
            workspaceScope:  this.workspaceScope,
            lifecycleState:  this.lifecycleState,
            provenance:      this.provenance,
            stats: {
                ...this.stats,
                successRate:   total ? this.stats.success / total : 1,
                avgDurationMs: this.stats.success ? Math.round(this.stats.totalMs / this.stats.success) : 0,
            },
        };
    }
}

// ── Registry map: id → AgentRecord ────────────────────────────────
const _registry = new Map();

function register(config) {
    const record = new AgentRecord(config);
    _registry.set(config.id, record);
    return record;
}

function get(id) { return _registry.get(id) || null; }

/**
 * Find the best available agent that has the given capability.
 * Prefers agents with fewer active slots and lower failure count.
 */
function findForCapability(capability) {
    let best = null;
    for (const agent of _registry.values()) {
        if (!agent.capabilities.has(capability)) continue;
        if (!agent.isAvailable())               continue;
        if (!best) { best = agent; continue; }
        // Prefer lower active concurrency, then lower failure rate
        const bestLoad = best._active / best.maxConcurrent;
        const candLoad = agent._active / agent.maxConcurrent;
        if (candLoad < bestLoad) { best = agent; continue; }
        // Universal Composition Engine Phase 12: only consults
        // preferenceWeight when load is otherwise EQUAL — this can never
        // override a genuinely lower-loaded agent, only break a tie.
        // Both weights default to 0 (neutral), so this branch is a no-op
        // unless a human-approved learning record has adjusted one of them.
        if (candLoad === bestLoad && agent.preferenceWeight > best.preferenceWeight) { best = agent; }
    }
    return best;
}

function listAll() {
    return [..._registry.values()].map(a => a.toJSON());
}

/**
 * Universal Composition Engine Phase 12 — sets an agent's tie-breaking
 * preferenceWeight. Never called automatically by this module; the only
 * intended caller is continuousLearningEngine.applyLearningRecord(),
 * itself gated on explicit human approval. Clamped to [-1, 1] so a
 * misconfigured caller cannot make preferenceWeight dominate over
 * genuine load-balancing.
 */
function setPreferenceWeight(id, weight) {
    const agent = _registry.get(id);
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    agent.preferenceWeight = Math.max(-1, Math.min(1, weight));
    return agent.preferenceWeight;
}

/**
 * Phase 2 (Agent Identity, Mission 121-124) — lifecycle control.
 * "retired" agents are excluded from findForCapability() (via isAvailable())
 * and canUseTool() always denies them, so a retired agent can neither be
 * dispatched to nor invoke tools even if some other code still holds a
 * reference to its handler.
 */
function setLifecycleState(id, state) {
    const agent = _registry.get(id);
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    if (!VALID_LIFECYCLE_STATES.has(state)) throw new Error(`Invalid lifecycle state: ${state}`);
    agent.lifecycleState = state;
    return agent.lifecycleState;
}

module.exports = { register, get, findForCapability, listAll, setPreferenceWeight, setLifecycleState, AgentRecord };
