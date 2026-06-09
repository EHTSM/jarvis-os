# V4 Phase 2 — Capability Matrix

**Date:** 2026-06-02

---

## Incident Detection Engine

| Capability | Implemented | Notes |
|---|---|---|
| **Detection rules** | ✓ | 10 rules |
| — Failed deploys | ✓ | `deploy_failed` — phase:failed or ok:false → HIGH |
| — Rolled-back deploys | ✓ | `deploy_rollback` → HIGH |
| — API error spikes | ✓ | `api_error_spike` — errorRate > 25%, ≥3 reqs → CRITICAL |
| — API error elevated | ✓ | `api_error_elevated` — 10–25% errorRate → MEDIUM |
| — Repeated errors | ✓ | `api_repeated_error` — same path+code ≥3 times → MEDIUM |
| — Unhealthy products | ✓ | `health_critical` / `health_degraded` → CRITICAL / LOW |
| — Route failures | ✓ | `route_failure` — 100% error rate on a path, ≥2 calls → HIGH |
| — Slow API | ✓ | `slow_api` — p95 > 5000ms → LOW |
| — Slow deploys | ✓ | `deploy_slow` — avg > 30s over 3 deploys → INFO |
| **Severity scoring** | ✓ | INFO / LOW / MEDIUM / HIGH / CRITICAL |
| **Incident storage** | ✓ | `data/incidents.json`, ring buffer 500, atomic write |
| **Incident history** | ✓ | `listIncidents({ status, severity, blueprintId, ruleId, limit })` |
| **Deduplication** | ✓ | Fingerprint = ruleId\|blueprintId\|affectedResource, 30-min window |
| **Lifecycle: open** | ✓ | `detect()` opens new incidents |
| **Lifecycle: acknowledge** | ✓ | `acknowledge(id, note)` → status: acknowledged |
| **Lifecycle: escalate** | ✓ | Auto-escalates after 60 min open |
| **Lifecycle: resolve** | ✓ | `resolve(id, note)` → status: resolved |
| **Lifecycle: auto-resolve** | ✓ | Condition cleared on next `detect()` → auto-resolved |
| **Auto-trigger from telemetry** | ✓ | `_appendEvent` fires `detect()` async on deploy/error events |
| **Throttling** | ✓ | 60s cooldown prevents detect() flood |
| **HTTP: trigger detect** | ✓ | `POST /incidents/detect` |
| **HTTP: list incidents** | ✓ | `GET /incidents?status=&severity=&ruleId=&limit=` |
| **HTTP: summary** | ✓ | `GET /incidents/summary` |
| **HTTP: single incident** | ✓ | `GET /incidents/:id` |
| **HTTP: acknowledge** | ✓ | `POST /incidents/:id/acknowledge` |
| **HTTP: resolve** | ✓ | `POST /incidents/:id/resolve` |
| **Auth guard** | ✓ | All routes behind `requireAuth` + `operatorAudit` |
| **Reuses telemetryEngine** | ✓ | `getHealthSummary()`, `getHistory()` — no new storage |
| **No new architecture** | ✓ | piggybacks on `_appendEvent`, no new agents or services |
| **No agent army** | ✓ | Single module, no spawning |

---

## Verification Test Coverage

| Scenario | Rule(s) Tested | Assertions |
|---|---|---|
| Failed deploy | `deploy_failed` | 6 |
| API error spike | `api_error_spike` | 4 |
| Degraded health | `health_degraded` / `deploy_failed` | 4 |
| Duplicate suppression | all | 3 |
| Lifecycle (ack → resolve) | all | 7 |
| Auto-resolve on clear | all | 3 |
| Summary counts | all | 4 |
| **Total** | | **~31 assertions** |

---

## Data Flow

```
recordDeploy() / recordApiError() / recordApiRequest() / recordPageView()
       │
       ▼
 _appendEvent()
       │
       ├── _recomputeSummary()  →  data/telemetry-summary.json
       │
       └── [deploy or api_error or degraded] and [cooldown ok]
                   │
                   ▼ (setImmediate — non-blocking)
             incidentEngine.detect()
                   │
                   ├── RULES[0..9].evalFn({ summary, events })
                   ├── deduplicate by fingerprint
                   ├── open / update / auto-resolve
                   └── data/incidents.json
```

---

## Incident Schema

```json
{
  "incidentId":       "inc_1748864123456",
  "fingerprint":      "deploy_failed|global|deploy",
  "ruleId":          "deploy_failed",
  "title":           "Deploy failed",
  "description":     "1 deploy failure(s) detected. Last error: health check timed out",
  "severity":        "HIGH",
  "status":          "open",
  "blueprintId":     null,
  "productName":     null,
  "affectedResource": "deploy",
  "evidence":        [{ "ts": "...", "error": "health check timed out", "elapsedMs": 45000 }],
  "occurrences":     1,
  "openedAt":        "2026-06-02T10:00:00.000Z",
  "updatedAt":       "2026-06-02T10:00:00.000Z",
  "acknowledgedAt":  null,
  "resolvedAt":      null,
  "notes":           []
}
```

---

## Phase Completion

| Phase requirement | Done |
|---|---|
| Incident detection rules | ✓ |
| Incident severity scoring | ✓ |
| Incident storage | ✓ |
| Incident history | ✓ |
| Incident deduplication | ✓ |
| Incident lifecycle | ✓ |
| Detect: failed deploys | ✓ |
| Detect: API error spikes | ✓ |
| Detect: unhealthy products | ✓ |
| Detect: route failures | ✓ |
| Detect: repeated failures | ✓ |
| Verify: failed deploy incident | ✓ test scenario 1 |
| Verify: API error incident | ✓ test scenario 2 |
| Verify: degraded health incident | ✓ test scenario 3 |
| Verify: duplicate suppression | ✓ test scenario 4 |
| Implementation Report | ✓ `V4_PHASE2_IMPLEMENTATION_REPORT.md` |
| Execution Trace | ✓ `V4_PHASE2_EXECUTION_TRACE.md` |
| Updated Capability Matrix | ✓ this file |
