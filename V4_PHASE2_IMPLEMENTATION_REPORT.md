# V4 Phase 2 — Incident Detection Engine
## Implementation Report

**Date:** 2026-06-02  
**Branch:** cleanup/runtime-minimization  
**Status:** COMPLETE

---

## Mission

Convert operational telemetry into structured, deduplicated, lifecycle-managed incidents automatically. No new architecture. No agent army.

---

## What Was Built

### 1. Incident Detection Engine — `agents/runtime/incidentEngine.cjs`

Already existed and was complete. Verified it contains all required capabilities:

| Capability | Status |
|---|---|
| Detection rules | 10 rules |
| Severity scoring | INFO / LOW / MEDIUM / HIGH / CRITICAL |
| Disk-backed storage | `data/incidents.json`, max 500, atomic write |
| Incident history | `listIncidents()` with status/severity/ruleId filters |
| Deduplication | Fingerprint = ruleId\|blueprintId\|affectedResource, 30-min dedup window |
| Lifecycle | open → acknowledged → escalated → resolved / auto-resolved |
| Auto-resolve | Conditions that clear on next `detect()` run self-close |
| Auto-escalate | Incidents open > 60 min promoted to "escalated" |

### 2. Telemetry → Auto-Detection Wire — `agents/runtime/telemetryEngine.cjs`

Added to `_appendEvent()`: after every `deploy` or `api_error` event (or when health is non-healthy), fires `incidentEngine.detect()` asynchronously via `setImmediate`.

**Design choices:**
- Fire-and-forget — detection never blocks the telemetry write path
- Throttled to once per 60 seconds — prevents flood on API error bursts  
- Only triggers on high-signal event types (`deploy`, `api_error`) or degraded summary — idle healthy systems don't trigger detection

```
Telemetry write
  → _recomputeSummary()          [sync, ~1ms]
  → if (deploy or api_error or degraded) and (cooldown elapsed):
      setImmediate(() => incidentEngine.detect())   [async, non-blocking]
```

### 3. Incident HTTP API — `backend/routes/ops.js`

Six new authenticated routes added:

| Method | Path | Description |
|---|---|---|
| `POST` | `/incidents/detect` | Trigger manual detection run |
| `GET` | `/incidents` | List incidents (filter: status, severity, blueprintId, ruleId, limit) |
| `GET` | `/incidents/summary` | Counts by severity and status |
| `GET` | `/incidents/:id` | Single incident by ID |
| `POST` | `/incidents/:id/acknowledge` | Acknowledge with optional note |
| `POST` | `/incidents/:id/resolve` | Resolve with optional note |

All routes are behind `requireAuth` + `operatorAudit` middleware (inherited from the ops router gate at line 46).

---

## Detection Rules

| Rule ID | Trigger | Severity |
|---|---|---|
| `deploy_failed` | Deploy with ok:false or phase:"failed" | HIGH |
| `deploy_rollback` | Deploy with phase:"rolled-back" | HIGH |
| `api_error_spike` | errorRate > 25%, ≥3 requests | CRITICAL |
| `api_error_elevated` | errorRate 10–25%, ≥3 requests | MEDIUM |
| `api_repeated_error` | Same path+errorCode ≥3 times | MEDIUM |
| `health_critical` | summary.overall === "critical" | CRITICAL |
| `health_degraded` | summary.overall === "degraded" | LOW |
| `route_failure` | Single route 100% failure rate, ≥2 calls | HIGH |
| `slow_api` | p95 latency > 5000ms | LOW |
| `deploy_slow` | Average deploy > 30s over last 3 | INFO |

---

## Architecture

```
[deploy/api/page events]
        ↓
  telemetryEngine._appendEvent()
        ↓
  _recomputeSummary()  ←── updates data/telemetry-summary.json
        ↓ (async, throttled 60s)
  incidentEngine.detect()
        ↓
  [10 rules evaluated against summary + events]
        ↓
  data/incidents.json  (ring buffer, 500 max, atomic write)
        ↓
  HTTP routes → operator console
```

**Reuse:**
- `telemetryEngine.getHealthSummary()` — aggregate health signal fed to every rule
- `telemetryEngine.getHistory()` — raw events for per-event rules (route_failure, deploy_failed, repeated_error)
- No new storage primitives, no new agents, no AI calls

---

## Files Changed

| File | Change |
|---|---|
| `agents/runtime/incidentEngine.cjs` | Pre-existing — verified complete, no changes needed |
| `agents/runtime/telemetryEngine.cjs` | +19 lines — auto-detection wired into `_appendEvent` |
| `backend/routes/ops.js` | +64 lines — 6 incident HTTP routes |
| `tests/runtime/incident-detection.test.cjs` | New — 7 scenario verification test |
