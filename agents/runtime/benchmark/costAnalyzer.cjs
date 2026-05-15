"use strict";
/**
 * costAnalyzer — execution cost estimation and tracking.
 *
 * Pricing reference (Claude Sonnet): ~$3/M input tokens, ~$15/M output tokens.
 * Token estimate: characters / 4  (rough but consistent approximation).
 *
 * estimateTokens(text)                     → number
 * estimateCost(inputTokens, outputTokens)  → { inputCost, outputCost, totalCost }
 *
 * record(id, inputText, outputText, durationMs, meta?)
 *   — record one execution event
 *
 * getCost(id)
 *   → { id, tokens, estimatedCost, durationMs, attempts }
 *
 * repairOverhead(type, repairAttempts)
 *   → { attempts, totalTokens, totalCost, avgCostPerAttempt }
 *
 * fullReport()
 *   → { totalRecords, totalTokens, totalCost, avgCostPerExecution, costByType, heaviestWorkflows[] }
 *
 * reset()
 */

const INPUT_COST_PER_TOKEN  = 3    / 1_000_000;   // $3 per 1M input  tokens
const OUTPUT_COST_PER_TOKEN = 15   / 1_000_000;   // $15 per 1M output tokens
const CHARS_PER_TOKEN       = 4;

let _records = [];
let _seq     = 0;

// ── estimation ────────────────────────────────────────────────────────

function estimateTokens(text) {
    if (typeof text !== "string") return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateCost(inputTokens, outputTokens = 0) {
    const inputCost  = inputTokens  * INPUT_COST_PER_TOKEN;
    const outputCost = outputTokens * OUTPUT_COST_PER_TOKEN;
    return {
        inputCost:   parseFloat(inputCost.toFixed(6)),
        outputCost:  parseFloat(outputCost.toFixed(6)),
        totalCost:   parseFloat((inputCost + outputCost).toFixed(6)),
    };
}

// ── recording ─────────────────────────────────────────────────────────

function record(id, inputText = "", outputText = "", durationMs = 0, meta = {}) {
    const inputTokens  = estimateTokens(inputText);
    const outputTokens = estimateTokens(outputText);
    const cost         = estimateCost(inputTokens, outputTokens);

    _records.push({
        seq:           ++_seq,
        id:            id || `exec-${_seq}`,
        type:          meta.type || "generic",
        ts:            new Date().toISOString(),
        inputTokens,
        outputTokens,
        tokens:        inputTokens + outputTokens,
        estimatedCost: cost.totalCost,
        durationMs,
        meta,
    });
}

// ── queries ───────────────────────────────────────────────────────────

function getCost(id) {
    const matching = _records.filter(r => r.id === id);
    if (matching.length === 0) return null;

    return {
        id,
        attempts:      matching.length,
        tokens:        matching.reduce((s, r) => s + r.tokens, 0),
        estimatedCost: parseFloat(matching.reduce((s, r) => s + r.estimatedCost, 0).toFixed(6)),
        durationMs:    matching.reduce((s, r) => s + r.durationMs, 0),
    };
}

function repairOverhead(type, repairAttempts = 1) {
    // Estimate cost of N repair attempts at the average cost for this type
    const byType      = _records.filter(r => r.type === type);
    const avgTokens   = byType.length > 0
        ? byType.reduce((s, r) => s + r.tokens, 0) / byType.length
        : 500;   // fallback: 500 tokens per attempt

    const totalTokens = Math.round(avgTokens * repairAttempts);
    const totalCost   = parseFloat((totalTokens * INPUT_COST_PER_TOKEN).toFixed(6));

    return {
        type,
        attempts:           repairAttempts,
        totalTokens,
        totalCost,
        avgCostPerAttempt:  parseFloat((totalCost / repairAttempts).toFixed(6)),
    };
}

function fullReport() {
    if (_records.length === 0) {
        return {
            totalRecords: 0, totalTokens: 0, totalCost: 0,
            avgCostPerExecution: 0, costByType: {}, heaviestWorkflows: [],
        };
    }

    const totalTokens = _records.reduce((s, r) => s + r.tokens, 0);
    const totalCost   = parseFloat(_records.reduce((s, r) => s + r.estimatedCost, 0).toFixed(6));

    // Cost by type
    const costByType  = {};
    for (const r of _records) {
        if (!costByType[r.type]) costByType[r.type] = { tokens: 0, cost: 0, count: 0 };
        costByType[r.type].tokens += r.tokens;
        costByType[r.type].cost   += r.estimatedCost;
        costByType[r.type].count++;
    }
    for (const v of Object.values(costByType)) {
        v.cost = parseFloat(v.cost.toFixed(6));
    }

    // Heaviest by cost
    const byId = {};
    for (const r of _records) {
        if (!byId[r.id]) byId[r.id] = { id: r.id, tokens: 0, cost: 0 };
        byId[r.id].tokens += r.tokens;
        byId[r.id].cost   += r.estimatedCost;
    }
    const heaviestWorkflows = Object.values(byId)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10)
        .map(v => ({ ...v, cost: parseFloat(v.cost.toFixed(6)) }));

    return {
        totalRecords:        _records.length,
        totalTokens,
        totalCost,
        avgCostPerExecution: parseFloat((totalCost / _records.length).toFixed(6)),
        costByType,
        heaviestWorkflows,
    };
}

function reset() { _records = []; _seq = 0; }

module.exports = {
    estimateTokens,
    estimateCost,
    record,
    getCost,
    repairOverhead,
    fullReport,
    reset,
    INPUT_COST_PER_TOKEN,
    OUTPUT_COST_PER_TOKEN,
    CHARS_PER_TOKEN,
};
