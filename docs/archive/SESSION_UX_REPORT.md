> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# SESSION UX REPORT
Phase L — Daily Operator Readiness  
Date: 2026-05-16

---

## 1. PRE-FIX STATE

### Problem

Session expiry detection was local to `OperatorConsole.jsx` only. The `_classifyAuthErr()`
function listened for 401 errors from ops/runtime fetch calls and set `authError === "expired"`.
No other component in the app had this detection.

If the session expired while the user was on the Chat, Revenue, Automation, or Clients tab,
the individual API calls (e.g., `getLeads()`, `sendMessage()`) silently swallowed errors:

```js
// BEFORE: all callers in api.js
export async function getLeads() {
  try { return await _fetch("/crm"); }
  catch { return []; }   // 401 swallowed — returns empty array, no logout
}
```

The user would see a blank leads list or "Command executed." with no visible error,
until they navigated to the Runtime tab and the OperatorConsole detected the 401.

### Impact

- After 8-hour session expiry, the app continued to appear functional on all non-runtime tabs
- CRM, payment, and chat tabs silently failed on every API call
- User would not know to re-authenticate

---

## 2. FIX APPLIED

### 2.1 Global 401 handler in api.js

```js
// AFTER (api.js)
let _on401 = null;
export function setOn401(fn) { _on401 = fn; }

async function _fetch(path, options = {}) {
  // ...
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || `HTTP ${res.status}`;
    const e   = new Error(msg);
    e.status  = res.status;
    if (res.status === 401) _on401?.();   // ← fires global handler
    throw e;
  }
  // ...
}
```

One place in the fetch pipeline: any 401 fires the registered callback.

### 2.2 AuthContext registers the handler on mount

```js
// AFTER (AuthContext.jsx)
import { getAuthStatus, loginOperator, logoutOperator, setOn401 } from "../api";

// Inside AuthProvider:
useEffect(() => {
  setOn401(() => setUser(null));   // clear user → LoginPage renders
  return () => setOn401(null);     // cleanup on unmount
}, []);
```

`setUser(null)` triggers React re-render. `App.jsx`'s `useAuth()` returns `{ user: null }`,
which routes to `<LoginPage />` via the auth guard.

---

## 3. FLOW

```
Any API call returns 401
  → _fetch() detects res.status === 401
  → _on401() fires
  → AuthContext setUser(null)
  → React re-render on all tabs
  → LoginPage renders
  → User sees "Sign in to continue"
  → User re-authenticates → setUser(role)
  → App routes back to previous state
```

Coverage: all API calls through `_fetch()` — every `getLeads()`, `sendMessage()`,
`dispatchTask()`, `getRuntimeStatus()`, `getOpsData()`, etc. The only exemptions are:
- `checkHealth()` — uses raw `fetch()`, not `_fetch()`, because it's used before auth
- `loginOperator()` — should never return 401 (it IS the auth call)
- SSE stream — uses native `EventSource`; 401 manifests as connection failure, handled by
  the existing OperatorConsole auth error detection

---

## 4. BEHAVIOR NOTES

### 4.1 Rapid repeat calls on expiry

If 5 API calls fire within the same tick and all return 401, `_on401()` fires 5 times.
All calls `setUser(null)` on the same React state. React batches state updates — the user
sees one logout, not 5. No race condition.

### 4.2 Electron mode

Electron path uses `window.electronAPI.xxx()` calls, not `_fetch()`. The `_on401` handler
is not triggered in Electron mode. Acceptable — Electron IPC is not session-based.

### 4.3 Cookie auth only

`_fetch()` uses `credentials: "include"` — the `jarvis_auth` cookie is sent automatically.
The cookie has `secure: true` in production, meaning over plain HTTP (local dev), the cookie
is NOT sent and every request returns 401. This is expected behavior and the global 401
handler correctly redirects to login in local dev too.

---

## 5. SUMMARY

| Issue | Pre-fix | Post-fix |
|-------|---------|---------|
| 401 detection coverage | OperatorConsole only | All API calls via `_fetch()` |
| Non-runtime tab behavior on expiry | Silent failure (empty data) | Immediate redirect to login |
| SSE expiry | Timer-based warning in OperatorConsole | Unchanged — SSE handles independently |
| Implementation size | — | 7 lines added across 2 files |
