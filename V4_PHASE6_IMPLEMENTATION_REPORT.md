# V4 Phase 6 — Learning Memory Engine
## Implementation Report

**Date:** 2026-06-02  
**Branch:** cleanup/runtime-minimization  
**Status:** COMPLETE — 68/68 assertions pass, first run

---

## Mission

Jarvis remembers what problems occurred and what fixes actually worked. Every healing run outcome updates a persistent memory. Repeated incidents trigger alerts. Successful and failed approaches are tracked. Context-aware recommendations are generated from real history.

---

## What Was Built

### `agents/runtime/learningMemoryEngine.cjs`

Single file. All memory operations are synchronous, deterministic, and file-backed.

| Entry Point | Purpose |
|---|---|
| `ingest(opts)` | Record one healing outcome into all three pattern stores |
| `ingestFromRun(runId)` | Load a HealingRun + Plan + RCA + Incident, then call `ingest()` |
| `getMemory()` | Return the full memory state |
| `getSummary()` | Counts, trends, top patterns — aggregate view |
| `getPatterns(opts)` | Filtered view of incident/RCA/fix patterns |
| `getRecommendations(ctx)` | Context-aware recommendations from learned history |
| `detectRepeated(opts)` | Check if a ruleId/cause is a known repeat |

**Reuses (all fail-safe):**
- `selfHealingPipeline.getHealingRun()` — load run by ID for `ingestFromRun`
- `autoFixPlanner.getPlan()` — enrich with strategy, confidence, taskCount
- `rootCauseAnalyzer.getReport()` — enrich with causeCategory, routes, files, errorCodes
- `incidentEngine.getIncident()` — enrich with ruleId, severity

**Storage:** `data/learning-memory.json` — single atomic file, no ring buffer (patterns are aggregated, not appended)

---

## Memory Model

Three pattern stores, one alert list, one ingest log — all in `learning-memory.json`:

### `incidentPatterns[fingerprint]`
Keyed by `ruleId|causeCategory|severity`. Tracks:
- `count` — how many times this exact pattern occurred
- `outcomes` — `{ success, failed, rolled_back, pending }`
- `bestFix` — approach with highest success rate across all outcomes
- `worstFix` — approach with highest failure rate
- `affectedRoutes[]`, `affectedFiles[]` — union across all occurrences

### `rcaPatterns[causeCategory]`
Keyed by cause category. Tracks:
- `topErrorCodes` — frequency map of error codes that led to this cause
- `topRoutes` — frequency map of affected routes
- `avgConfidence` — running average of RCA confidence scores
- `_approachStats` — per-approach success/attempt counts
- `bestApproach` — highest success rate approach for this cause

### `fixPatterns[approach]`
Keyed by fix strategy approach name. Tracks:
- `successRate` — `successes / attempts`
- `avgTaskCount`, `avgConfidence` — running averages
- `examplePlanIds[]` — up to 3 recent plan IDs (for operator reference)

### `repeatAlerts[]`
Generated when `incidentPattern.count >= 3`. Contains:
- `recommendation` — a generated string based on success rate and bestFix
- Three flavors: "apply bestFix", "escalate (chronic)", "review root cause"

### `ingestLog[]`
Ring buffer (max 200) of what was ingested — useful for audit and debugging.

---

## Auto-Wire into Self-Healing Pipeline

`selfHealingPipeline.cjs` now calls `_learnFromRun(run)` at all four terminal outcome points:

| Outcome path | Where wired |
|---|---|
| `success` (main path) | After `_persistRun` at end of `_executeplan` |
| `rolled-back` (stage failure) | After `_persistRun` inside failure branch |
| `recommend-only` | After `_persistRun` |
| `success` (_resumeRun path) | After `_persistRun` in `_resumeRun` |

`_learnFromRun` uses `setImmediate` — fire-and-forget, never blocks the healing pipeline.

---

## Repeat Alert Threshold

`REPEAT_THRESHOLD = 3` — an alert fires on the 3rd occurrence of the same incident pattern. The recommendation generated depends on the success history:
- `successRate >= 70%` → "Apply bestFix approach immediately"
- `count >= 5 && successRate < 30%` → "Escalate — fixes aren't working"
- Otherwise → "Review root cause to prevent recurrence"

---

## Recommendation Types

| Type | When Generated |
|---|---|
| `recurring_issue` | Pattern count ≥ 3 |
| `best_fix` | `bestFix.successRate >= 60%` or `rcaPattern.bestApproach` set |
| `avoid_fix` | `worstFix.failureRate >= 50%` |
| `escalate` | Count ≥ 5 and success rate < 30% |

Deduplicated by `type:source`, sorted by confidence descending, capped at 8.

---

## HTTP Routes Added — `backend/routes/ops.js`

| Method | Path | Description |
|---|---|---|
| `POST` | `/learning/ingest` | Manual ingest (body: `{ runId }` or full ingest opts) |
| `GET` | `/learning/summary` | Aggregate counts, trends, top patterns |
| `GET` | `/learning/patterns` | Filter: type, causeCategory, ruleId, minCount, limit |
| `GET` | `/learning/recommendations` | Context: ruleId, causeCategory, severity |
| `GET` | `/learning/repeated` | Check: ruleId, causeCategory, severity |

---

## Files Changed

| File | Change |
|---|---|
| `agents/runtime/learningMemoryEngine.cjs` | New — ~420 lines |
| `agents/runtime/selfHealingPipeline.cjs` | +14 lines — `_learnFromRun` accessor + 4 call sites |
| `backend/routes/ops.js` | +55 lines — 5 learning HTTP routes |
| `tests/runtime/learning-memory-engine.test.cjs` | New — 10-scenario verification test |
