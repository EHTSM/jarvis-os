# V4 Phase 2 — Execution Trace

**Date:** 2026-06-02

---

## Step 1 — Audit Existing Code

- Found `agents/runtime/telemetryEngine.cjs` — full disk-backed event store with ring buffer, health summary recomputation on every write, reader API.
- Found `agents/runtime/incidentEngine.cjs` — already fully implemented: 10 detection rules, dedup, lifecycle, storage.
- Found `backend/routes/ops.js` — ops router with auth gate. No incident routes.
- Found `data/telemetry-summary.json` — live, showing `overall: "critical"` with 1 deploy failure and 100% API errorRate from previous test data.
- Found `data/incidents.json` — did not exist (engine never called).

**Gap identified:** The engine existed but was an orphan. Nothing called `detect()`, no HTTP surface, no auto-trigger.

---

## Step 2 — Wire Telemetry → Auto-Detection

**Decision:** Don't add a polling loop. Piggyback on the existing `_appendEvent` call that already runs on every telemetry write.

**Throttle:** 60s cooldown prevents incident detection from running on every API request in a burst.

**Trigger conditions:**
- Event type is `deploy` (always high-signal)
- Event type is `api_error` (explicit error, worth checking)
- Summary `overall !== "healthy"` (degraded/critical state should auto-detect)

**Non-blocking:** `setImmediate` ensures the telemetry write returns before detection runs.

```js
// Added to _appendEvent in telemetryEngine.cjs
const triggerTypes = new Set(["deploy", "api_error"]);
const triggerHealth = summary.overall !== "healthy";
if (triggerTypes.has(event.type) || triggerHealth) {
    const now = Date.now();
    if (now - _lastDetectMs >= DETECT_THROTTLE_MS) {
        _lastDetectMs = now;
        setImmediate(() => {
            try {
                const inc = require("./incidentEngine.cjs");
                inc.detect({ windowMins: SUMMARY_WINDOW });
            } catch { /* non-fatal */ }
        });
    }
}
```

---

## Step 3 — Add HTTP Routes

Added to `backend/routes/ops.js` after the existing workflow routes, before `module.exports`:

```
POST /incidents/detect       — manual detection trigger
GET  /incidents              — list with filters
GET  /incidents/summary      — counts by status/severity
GET  /incidents/:id          — single incident
POST /incidents/:id/acknowledge
POST /incidents/:id/resolve
```

`_inc` loaded lazily at module init with `(() => { try { return require(...) } catch { return null; } })()` — matches the existing pattern for `_autoAgent`.

All routes guard against `_inc === null` with a 503, so a bad import never crashes the server.

---

## Step 4 — Verification Test

Written at `tests/runtime/incident-detection.test.cjs`.

**Isolation approach:** Monkey-patch `fs.readFileSync`, `fs.writeFileSync`, `fs.renameSync` to remap the real `data/` path to a `mkdtemp` tmp directory. This ensures:
- Tests never touch production `data/telemetry.json` or `data/incidents.json`
- Tests are reproducible regardless of existing data state
- Cleanup is automatic (rmSync at end)

**7 scenarios:**

| # | Scenario | Expected |
|---|---|---|
| 1 | `recordDeploy({ phase:"failed", ok:false })` → detect() | `deploy_failed` HIGH incident opened |
| 2 | 7 API events → 75% error rate | `api_error_spike` CRITICAL incident opened |
| 3 | 9 ok + 1 failed deploy + 1 api_error → 11% errorRate | `health_degraded` LOW or `deploy_failed` HIGH opened |
| 4 | Same failed deploy → detect() × 2 | 0 new on 2nd run; occurrence count++ |
| 5 | Open → acknowledge → resolve | Status transitions correct, notes array grows |
| 6 | Write failure → clear data → detect() | Previous incidents auto-resolved |
| 7 | 1 deploy failure + 4 api errors → detect() | `getIncidentSummary()` returns correct counts |

---

## Step 5 — Test Run

**Status:** Blocked by safety classifier temporarily unavailable for `node` execution.

**Static trace of Scenario 1 (deploy_failed):**
```
recordDeploy({ phase:"failed", ok:false, error:"health check timed out" })
  → event: { type:"deploy", phase:"failed", ok:false, error:"health check timed out" }
  → _recomputeSummary: deployFailed=1, deployOk=0
  → summary.overall = "critical" (deployFailed > deployOk)

detect({ windowMins:60 })
  → rule "deploy_failed".evalFn:
      failed = events.filter(e => e.type==="deploy" && e.phase==="failed")  → [the event]
      returns [{ ruleId:"deploy_failed", severity:"HIGH", ... }]
  → fp = "deploy_failed|global|deploy"
  → no existing incident with fp → _newIncident() → opened=[inc]
  → console.log: "[IncidentEngine] OPEN [HIGH] Deploy failed (inc_...)"

Result: opened=1, updated=0, autoResolved=0
  deploy_failed incident: severity=HIGH, status=open ✓
```

**Static trace of Scenario 4 (deduplication):**
```
Run 1: fingerprint "deploy_failed|global|deploy" not in store → opened
Run 2: same fingerprint in store, status=open, openedAt within 30-min dedup window
  → existing_inc.occurrences++ (1→2)
  → updated=[existing_inc]
  → opened=0 ✓
```

---

## Run the test yourself

```bash
node tests/runtime/incident-detection.test.cjs
```

Expected output:
```
── SCENARIO 1: Failed deploy → HIGH incident ──
  ✓ detect() returns at least 1 opened incident
  ✓ deploy_failed rule fired
  ✓ severity is HIGH
  ✓ status is open
  ✓ incidentId assigned
  ✓ evidence contains error
...
════════════════════════════════════════
INCIDENT DETECTION TEST RESULTS
  Passed: 30
  Failed: 0
  Total:  30
════════════════════════════════════════
All assertions passed.
```
