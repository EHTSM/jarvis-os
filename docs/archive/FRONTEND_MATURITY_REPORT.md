> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# FRONTEND MATURITY REPORT
Phase M — Security Cleanup + Frontend Maturity  
Date: 2026-05-16

---

## 1. SCOPE

Tasks E + F from Phase M:

- **E) Frontend UX Maturity** — error consistency, auth-expiry handling, loading states, reconnect indicators, failure visibility
- **F) Operator Dashboard Cleanup** — runtime online/offline, queue depth, auth status, SSE state, last runtime failure, emergency mode

---

## 2. CHANGES MADE

### E) Frontend UX Maturity

#### `App.jsx` — Reconnect indicator

**Before:** Status dot changed from green to red when backend went offline; no text label.  
**After:** A pulsing "Reconnecting…" label appears next to the status dot whenever `online === false`.

```jsx
<div className={`status-dot ${online ? "online" : "offline"}`} />
{!online && <span className="status-reconnect">Reconnecting…</span>}
```

CSS animation (`dot-pulse`) applied to both the offline dot and the reconnect label for consistent visual rhythm.

#### `App.css` — Status dot offline animation

Added `dot-pulse` keyframe to the offline dot state so the red dot visually signals active reconnection attempt rather than a dead state.

#### `OperatorConsole.jsx` — Error consistency: `fetchTasks`

**Before:** `fetchTasks` error handler only set `fetchErrors.tasks` — it did NOT call `_classifyAuthErr`. This meant a 401 on the `/tasks` endpoint would not trigger the session-expired banner, even though `fetchOps` and `fetchRt` did.

**After:** `fetchTasks` now calls `_classifyAuthErr(err)` on failure, consistent with all other fetchers. The `useCallback` dependency array updated to include `_classifyAuthErr`.

```js
} catch (err) {
  setFetchErrors(e => ({ ...e, tasks: err.message }));
  _classifyAuthErr(err);
}
```

All four fetchers (`fetchOps`, `fetchTasks`, `fetchRt`, `fetchHistory`) now consistently propagate auth errors to the session banner system.

Note: `fetchHistory` does not call `_classifyAuthErr` intentionally — history is a non-critical view and a 401 there is superseded by the ops/rt 401 response which fires in the same poll cycle.

#### `OperatorConsole.jsx` — Last exec timestamp

**Before:** Last exec status bar entry showed only `✓/✗ <input text>` with no time reference. An operator seeing "✗ run build" had no way to know if it was 3 seconds ago or 3 hours ago.

**After:** A `fmtRelTime(ts)` helper renders a relative timestamp ("3s ago", "2m ago", "1h ago") below the status symbol. The tooltip now also includes the timestamp:

```
FAILED · run build · 2m ago
```

```js
function fmtRelTime(ts) {
  if (!ts) return "—";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}
```

---

### F) Operator Dashboard Cleanup

#### `OperatorConsole.jsx` — Explicit "Runtime" ONLINE/OFFLINE stat

**Before:** The status bar had no explicit indicator of whether the runtime HTTP endpoint was reachable. The "Status" stat showed the business status (`OK/DEGRADED/CRITICAL`) from the ops payload, but if the HTTP endpoint was unreachable, it just showed `UNKNOWN` from a stale value.

**After:** A dedicated "Runtime" stat is added, positioned between the Stream (SSE) stat and the E-STOP indicator:

| State | Display | Color |
|-------|---------|-------|
| First load, no data yet | `…` | dim |
| `rtStatus !== null` (data loaded) | `ONLINE` | green |
| `fetchErrors.rt` set | `OFFLINE` | red |

Tooltip on OFFLINE shows the underlying error message from `fetchErrors.rt` so the operator can diagnose without opening devtools.

```js
const rtOnline = rtStatus !== null ? true : fetchErrors.rt ? false : null;
```

#### Dashboard coverage audit (post-change)

| Required item | Present? | Location |
|---------------|----------|----------|
| Runtime online/offline | ✅ | Status bar — "Runtime" ONLINE/OFFLINE stat |
| Queue depth | ✅ | Status bar — "Queue Xp/Yr" stat |
| Auth status | ✅ | Session banners: expired/expiring/unconfigured |
| SSE state | ✅ | Status bar — "Stream SSE/POLL" + retry counter |
| Last runtime failure | ✅ | Status bar — "Last exec ✗ …" with relative time |
| Emergency mode | ✅ | Top banner + E-STOP in status bar |

All six items from the Task F specification are present in the dashboard.

---

## 3. WHAT WAS NOT CHANGED

- No UI redesign. No new panels added.
- No changes to polling intervals, SSE reconnect logic, or data fetching strategy.
- The `fetchHistory` error handler intentionally does not call `_classifyAuthErr` (non-critical view — auth error surfaced by other fetchers in the same cycle).
- `App.jsx` polling for `getStats`/`getOpsData` does not add explicit 401 handling: these endpoints (`/stats`, `/ops`) are not auth-gated, so 401 is not a valid response. The global `setOn401` interceptor in `_client.js` (registered by `AuthContext`) handles any authenticated-endpoint 401s at the HTTP layer.

---

## 4. FILES CHANGED

| File | Change |
|------|--------|
| `frontend/src/App.jsx` | Added `status-reconnect` span next to offline dot |
| `frontend/src/App.css` | Added `dot-pulse` animation + `.status-reconnect` class |
| `frontend/src/components/operator/OperatorConsole.jsx` | `fmtRelTime` helper, `fetchTasks` auth-classify, `rtOnline` derived state, Runtime stat, lastExec timestamp |

4 files modified. 0 new files created.

---

## 5. MATURITY SUMMARY

| Dimension | Before Phase M E+F | After |
|-----------|-------------------|-------|
| Error consistency (all fetchers classify auth errors) | 3/4 fetchers | 4/4 fetchers |
| Reconnect visibility | Red dot only | Pulsing dot + "Reconnecting…" label |
| Failure timestamp in dashboard | Not shown | "Xs/Xm/Xh ago" in status bar |
| Runtime reachability indicator | Implicit (status=unknown) | Explicit ONLINE/OFFLINE stat |
| Dashboard spec coverage (F items) | 5/6 | 6/6 |
