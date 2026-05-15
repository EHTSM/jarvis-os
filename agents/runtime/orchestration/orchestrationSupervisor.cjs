"use strict";
/**
 * orchestrationSupervisor — central coordinator for the orchestration layer.
 * Wires all orchestration modules and provides a unified admission pipeline:
 *   backpressure check → policy check → concurrency check → queue admission
 *
 * configure(config)              → { configured, modules }
 * admitExecution(spec)           → AdmissionResult
 * completeExecution(spec)        → { completed, freed }
 * getOrchestrationStatus()       → OrchestrationStatus
 * detectDegradation()            → DegradedIndicator[]
 * getOrchestratorMetrics()       → OrchestratorMetrics
 * reset()
 *
 * Integration modules (all optional, injected via configure()):
 *   priorityEngine, queueCoordinator, dependencyPlanner, loadBalancer,
 *   schedulingEngine, concurrencyManager, backpressureController,
 *   policyResolver, fairnessManager
 */

const DEFAULT_DEGRADATION_THRESHOLDS = {
    queueDepth:       800,   // items
    concurrencyRatio: 0.9,   // 90% of global limit
    errorRate:        0.3,   // 30% failures in window
    rejectionRate:    0.2,   // 20% of admissions rejected
};

let _config    = null;
let _counter   = 0;
let _admitted  = 0;
let _rejected  = 0;
let _completed = 0;
let _slotMap   = new Map();   // executionId → { slotId, adapterId }

// ── configure ─────────────────────────────────────────────────────────

function configure(config = {}) {
    _config = {
        priorityEngine:       config.priorityEngine       ?? null,
        queueCoordinator:     config.queueCoordinator     ?? null,
        dependencyPlanner:    config.dependencyPlanner    ?? null,
        loadBalancer:         config.loadBalancer         ?? null,
        schedulingEngine:     config.schedulingEngine     ?? null,
        concurrencyManager:   config.concurrencyManager   ?? null,
        backpressureController: config.backpressureController ?? null,
        policyResolver:       config.policyResolver       ?? null,
        fairnessManager:      config.fairnessManager      ?? null,
    };
    const wired = Object.keys(_config).filter(k => _config[k] !== null);
    return { configured: true, modules: wired };
}

// ── admitExecution ─────────────────────────────────────────────────────

function admitExecution(spec = {}) {
    const {
        executionId    = null,
        workflowId     = null,
        subsystem      = null,
        adapterType    = null,
        capability     = null,
        authorityLevel = "operator",
        urgency        = "normal",
        riskScore      = 0,
        retryCount     = 0,
        recovery       = false,
        priorityScore  = null,
        payload        = null,
    } = spec;

    if (!executionId) return { admitted: false, reason: "executionId_required" };

    const c = _config;

    // 1. Compute priority
    let score = priorityScore;
    let priorityClass = "normal";
    if (c?.priorityEngine) {
        const p = c.priorityEngine.computePriority({ authorityLevel, urgency, riskScore, retryCount, recovery });
        score         = p.score;
        priorityClass = p.priorityClass;
    } else {
        score = priorityScore ?? 50;
    }

    // 2. Backpressure check
    if (c?.backpressureController) {
        const bp = c.backpressureController.shouldAdmit({ priorityClass, authorityLevel, recovery, retryCount });
        if (!bp.admitted) {
            _rejected++;
            return { admitted: false, reason: bp.reason, stage: "backpressure", pressureState: bp.pressureState };
        }
    }

    // 3. Policy check
    if (c?.policyResolver) {
        const pa = c.policyResolver.evaluateAdmission({ subsystem, adapterType, authorityLevel, priorityScore: score, retryCount, recovery });
        if (!pa.admitted) {
            _rejected++;
            return { admitted: false, reason: pa.reason, stage: "policy", policyId: pa.policyId };
        }
    }

    // 4. Concurrency check + acquire slot
    let slotId = null;
    if (c?.concurrencyManager) {
        const ca = c.concurrencyManager.acquire({ executionId, adapterType, subsystem, authorityLevel, workflowId });
        if (!ca.acquired) {
            _rejected++;
            return { admitted: false, reason: ca.reason, stage: "concurrency", active: ca.active, limit: ca.limit };
        }
        slotId = ca.slotId;
    }

    // 5. Load balancer: select adapter
    let selectedAdapter = null;
    if (c?.loadBalancer && capability) {
        const lb = c.loadBalancer.selectAdapter({ capability, adapterType });
        if (lb.selected) {
            selectedAdapter = lb.adapterId;
            c.loadBalancer.recordUtilization({ adapterId: lb.adapterId, delta: 1 });
        }
    }

    // 6. Enqueue
    if (c?.queueCoordinator) {
        const eq = c.queueCoordinator.enqueue({
            executionId, workflowId, subsystem, adapterType, capability,
            priorityScore: score, priorityClass, recovery, retryCount, authorityLevel, payload,
        });
        if (!eq.enqueued) {
            // Release concurrency slot if queue is full
            if (slotId && c?.concurrencyManager) c.concurrencyManager.release(slotId);
            _rejected++;
            return { admitted: false, reason: eq.reason, stage: "queue" };
        }
    }

    // 7. Fairness record
    if (c?.fairnessManager) {
        c.fairnessManager.recordExecution({ executionId, subsystem, workflowId, adapterType });
    }

    if (slotId) _slotMap.set(executionId, { slotId, adapterId: selectedAdapter });
    _admitted++;
    _counter++;

    return {
        admitted: true, executionId, workflowId,
        priorityScore: score, priorityClass,
        slotId, selectedAdapter,
    };
}

// ── completeExecution ──────────────────────────────────────────────────

function completeExecution(spec = {}) {
    const { executionId = null, outcome = "completed" } = spec;
    if (!executionId) return { completed: false, reason: "executionId_required" };

    const c   = _config;
    const rec = _slotMap.get(executionId);
    let freed = {};

    // Release concurrency slot
    if (rec?.slotId && c?.concurrencyManager) {
        c.concurrencyManager.release(rec.slotId);
        freed.slotReleased = true;
    }

    // Release load balancer slot
    if (rec?.adapterId && c?.loadBalancer) {
        c.loadBalancer.releaseSlot({ adapterId: rec.adapterId, outcome });
        freed.adapterReleased = true;
    }

    // Record backpressure signal
    if (c?.backpressureController) {
        const bpOutcome = (outcome === "completed") ? "success" : "failure";
        c.backpressureController.recordSignal({ outcome: bpOutcome });
    }

    // Dependency planner completion
    if (c?.dependencyPlanner) {
        outcome === "failed"
            ? c.dependencyPlanner.markFailed(executionId)
            : c.dependencyPlanner.markCompleted(executionId);
    }

    _slotMap.delete(executionId);
    _completed++;

    return { completed: true, executionId, outcome, freed };
}

// ── getOrchestrationStatus ─────────────────────────────────────────────

function getOrchestrationStatus() {
    const c      = _config;
    const status = {
        configuredModules: c ? Object.keys(c).filter(k => c[k] !== null) : [],
        admitted:  _admitted,
        rejected:  _rejected,
        completed: _completed,
        activeExecutions: _slotMap.size,
    };

    if (c?.backpressureController)
        status.pressureState = c.backpressureController.getPressureState().state;
    if (c?.concurrencyManager)
        status.concurrency = c.concurrencyManager.getConcurrencyState();
    if (c?.queueCoordinator)
        status.queues = c.queueCoordinator.getQueueHealth();

    return status;
}

// ── detectDegradation ─────────────────────────────────────────────────

function detectDegradation() {
    const c          = _config;
    const indicators = [];
    const T          = DEFAULT_DEGRADATION_THRESHOLDS;

    if (c?.queueCoordinator) {
        const depth = c.queueCoordinator.getQueueDepth();
        if (depth >= T.queueDepth)
            indicators.push({ type: "queue_depth", value: depth, threshold: T.queueDepth });
    }

    if (c?.concurrencyManager) {
        const cs = c.concurrencyManager.getConcurrencyState();
        if (cs.utilization >= T.concurrencyRatio)
            indicators.push({ type: "concurrency_saturation", value: cs.utilization, threshold: T.concurrencyRatio });
    }

    if (c?.backpressureController) {
        const ps = c.backpressureController.getPressureState();
        if (ps.errorRate >= T.errorRate)
            indicators.push({ type: "high_error_rate", value: ps.errorRate, threshold: T.errorRate });
        if (ps.state === "critical" || ps.state === "active")
            indicators.push({ type: "pressure_state", value: ps.state });
    }

    const total = _admitted + _rejected;
    if (total > 0) {
        const rejectionRate = _rejected / total;
        if (rejectionRate >= T.rejectionRate)
            indicators.push({ type: "high_rejection_rate", value: Math.round(rejectionRate * 1000) / 1000, threshold: T.rejectionRate });
    }

    return indicators;
}

// ── getOrchestratorMetrics ─────────────────────────────────────────────

function getOrchestratorMetrics() {
    return {
        totalAdmitted:   _admitted,
        totalRejected:   _rejected,
        totalCompleted:  _completed,
        activeExecutions: _slotMap.size,
        admissionRate:   (_admitted + _rejected) > 0
            ? Math.round(_admitted / (_admitted + _rejected) * 1000) / 1000
            : 1,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _config    = null;
    _counter   = 0;
    _admitted  = 0;
    _rejected  = 0;
    _completed = 0;
    _slotMap   = new Map();
}

module.exports = {
    DEFAULT_DEGRADATION_THRESHOLDS,
    configure, admitExecution, completeExecution,
    getOrchestrationStatus, detectDegradation,
    getOrchestratorMetrics, reset,
};
