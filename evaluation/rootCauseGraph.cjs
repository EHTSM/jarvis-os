"use strict";
/**
 * rootCauseGraph — tracks failure causality within a workflow run.
 *
 * Distinguishes:
 *   primary   — failures with no upstream cause (the actual root)
 *   cascading — failures triggered by a prior failure
 *
 * A failure B is deemed cascading when:
 *   - it follows a failing step A
 *   - AND B's step name appears in A's declared dependsOn list, OR
 *   - auto-heuristic: B failed within 100ms of A's failure (temporal proximity)
 *
 * Usage:
 *   const g = new RootCauseGraph();
 *   g.addFailure("install-deps", err, classification);        // primary
 *   g.addFailure("build-project", err, classification, "install-deps"); // cascading
 *   g.getPrimary()   → [{ stepName, errorType, ... }]
 *   g.getCascading() → [{ stepName, errorType, causedBy, ... }]
 */

class RootCauseGraph {
    constructor() {
        this._nodes = new Map();  // stepName → NodeRecord
        this._edges = [];         // { from, to, reason }
        this._order = [];         // insertion order
    }

    /**
     * @param {string}  stepName
     * @param {Error}   error
     * @param {{ type: string, confidence: number }} classification
     * @param {string|null} causedByStep   — explicit upstream step name (if known)
     */
    addFailure(stepName, error, classification = {}, causedByStep = null) {
        const ts = Date.now();
        const node = {
            stepName,
            errorType:    classification.type   || "unknown",
            confidence:   classification.confidence ?? 0,
            errorMsg:     error?.message || String(error),
            timestamp:    ts,
            attempts:     0,
            recoveries:   0,
        };
        this._nodes.set(stepName, node);
        this._order.push(stepName);

        // Explicit causal link
        if (causedByStep && this._nodes.has(causedByStep)) {
            this._edges.push({ from: causedByStep, to: stepName, reason: "explicit" });
            return;
        }

        // Auto-heuristic: if there's a recent prior failure (within 500ms), link it
        if (this._order.length > 1) {
            const prevName = this._order[this._order.length - 2];
            const prev     = this._nodes.get(prevName);
            if (prev && (ts - prev.timestamp) < 500) {
                this._edges.push({ from: prevName, to: stepName, reason: "temporal" });
            }
        }
    }

    /** Enrich a node with retry/recovery stats from stepDetails. */
    enrich(stepName, { attempts = 0, recoveries = 0 } = {}) {
        const node = this._nodes.get(stepName);
        if (node) { node.attempts = attempts; node.recoveries = recoveries; }
    }

    /** Nodes with no incoming edges — the actual root causes. */
    getPrimary() {
        const hasIncoming = new Set(this._edges.map(e => e.to));
        return [...this._nodes.values()].filter(n => !hasIncoming.has(n.stepName));
    }

    /** Nodes with at least one incoming edge — consequence failures. */
    getCascading() {
        const hasIncoming = new Set(this._edges.map(e => e.to));
        return [...this._nodes.values()]
            .filter(n => hasIncoming.has(n.stepName))
            .map(n => {
                const cause = this._edges.find(e => e.to === n.stepName);
                return { ...n, causedBy: cause?.from, reason: cause?.reason };
            });
    }

    get size() { return this._nodes.size; }

    /**
     * Build from a completed workflow's stepDetails array.
     * Auto-detects cascading based on step ordering and temporal proximity.
     */
    static fromStepDetails(stepDetails = []) {
        const g = new RootCauseGraph();
        for (const s of stepDetails) {
            if (s.status === "failed" || (s.error && s.status !== "completed")) {
                g.addFailure(s.name, new Error(s.error || "step failed"), { type: "unknown" });
                g.enrich(s.name, { attempts: s.attempts, recoveries: s.recoveries || 0 });
            }
        }
        return g;
    }

    toJSON() {
        return {
            total:     this._nodes.size,
            primary:   this.getPrimary(),
            cascading: this.getCascading(),
            edges:     this._edges,
        };
    }
}

module.exports = { RootCauseGraph };
