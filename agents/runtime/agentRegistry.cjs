"use strict";
/**
 * agentRegistry — catalog of available agents with capability mapping
 * and per-agent circuit breakers.
 *
 * Circuit breaker states: closed (normal) → open (failing) → half-open (probing)
 * Opens after CB_FAIL_THRESHOLD consecutive failures.
 * Half-opens after CB_OPEN_MS ms, allows one probe request.
 */

const logger = require("../../backend/utils/logger");

const CB_FAIL_THRESHOLD = 5;
const CB_OPEN_MS        = 60_000;  // 1 minute cooldown

class AgentRecord {
    constructor({ id, capabilities, handler, maxConcurrent = 3 }) {
        this.id             = id;
        this.capabilities   = new Set(capabilities || []);
        this.handler        = handler;   // async fn(task, context) → result
        this.maxConcurrent  = maxConcurrent;

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

module.exports = { register, get, findForCapability, listAll, setPreferenceWeight, AgentRecord };
