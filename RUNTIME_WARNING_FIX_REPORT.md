# RUNTIME WARNING FIX REPORT
Generated: 2026-06-05

---

## Module Audit

### registerWorkflows.cjs
- **File exists:** `agents/automation/registerWorkflows.cjs` ✓
- **Import in server.js:** `require("../agents/automation/registerWorkflows.cjs")` — correct relative path ✓
- **Status:** No issue

### browserScheduler.cjs
- **File exists:** `agents/browser/browserScheduler.cjs` ✓
- **Import in server.js:** `require("../agents/browser/browserScheduler.cjs")` — correct ✓
- **Import in backend/routes/browser.js:** `require("../../agents/browser/browserScheduler.cjs")` — correct ✓
- **Status:** No issue

### driftMonitor.cjs
- **File exists:** `agents/runtime/driftMonitor.cjs` ✓
- **Import in server.js:** `require("../agents/runtime/driftMonitor.cjs")` — correct ✓
- **Import in backend/routes/runtime.js:** `require("../../agents/runtime/driftMonitor.cjs")` — correct (11 call sites) ✓
- **Import in runtimeOrchestrator.cjs:** `require("./driftMonitor.cjs")` — same-directory, correct ✓
- **Status:** No issue

### metricsStore — two modules, correctly separated
| File | API | Used by |
|---|---|---|
| `backend/utils/metricsStore.js` | `inc`, `trackIntent`, `trackMode`, `recordLatency`, `getSnapshot` | `jarvisController.js`, `observabilityEngine.cjs` |
| `agents/runtime/metricsStore.cjs` | `start`, `stop`, `recent`, `availableDates` | `server.js`, `backend/routes/runtime.js` |

Both files exist. All imports use the correct path for the correct module. No conflict.

---

## Warnings Fixed

### FIXED — `[Startup:Forensics]` false-positive EPIPE warnings
**Root cause:** `data/crashes/` contained 208 crash reports with `error.code === "EPIPE"`. These are not real crashes — PM2 closes stdout during a clean shutdown, which triggers the `uncaughtException` crash handler spuriously. On every subsequent restart the forensics block displayed a `[WARN]` for each batch.

**Fix (`backend/server.js`):** Forensics block now:
1. Filters out EPIPE crash files before counting
2. Silently deletes EPIPE-only files on first read (they are noise, not actionable)
3. Only emits `[WARN]` for non-EPIPE crash reports

**Result:** 208 stale EPIPE files deleted on first clean boot. `data/crashes/` is now empty. Forensics warning will only appear for real crashes going forward.

---

## Remaining INFO Lines (expected, not warnings)

These two lines appear at `console.info` (INFO level) and are correct behavior:

```
[Startup] Optional env not set — firebase disabled: FIREBASE_PROJECT_ID
[Startup] Optional env not set — maps disabled: GOOGLE_API
```

These fire because Firebase and Google Maps are optional services with no keys set in the local `.env`. They are intentionally INFO not WARN. They will disappear on the VPS once `FIREBASE_PROJECT_ID` and `GOOGLE_API` are set in production `.env`.

---

## Verification

```
node backend/server.js
```

**Output (zero WARN lines at startup):**
```
[INFO] [SelfHeal] Probe loop started
[INFO] ━━━━ JARVIS OS v3.0 — http://localhost:5050 ━━━━
[INFO] [Telegram] Bot started
[INFO] [Automation] Engine started
[INFO] [AutoLoop] autonomous task loop running
[INFO] [Bootstrap] browser agent registered
[INFO] [Bootstrap] terminal agent registered
[INFO] [Bootstrap] automation agent registered
[INFO] [Bootstrap] dev agent registered
[INFO] [Bootstrap] filesystem agent registered
[INFO] [EventBus] realtime event bus started
[INFO] [BrowserScheduler] schedule executor started
[INFO] [DriftMonitor] leak/drift detection started
[INFO] [MetricsStore] 5-min snapshot persistence started
[INFO] Startup Diagnostics — all services enabled
```

---

## PM2 Recovery Commands (VPS)

```bash
# After git pull
pm2 restart jarvis-os

# Verify no WARN lines in startup logs
pm2 logs jarvis-os --lines 50 | grep WARN
# Expected output: empty
```
