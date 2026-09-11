# C.7 — OFFLINE SECURITY

Date: 2026-08-14 · Branch: `security/reality-completion`

Security-critical findings per the mission's Step 13/14. Every claim traces to live evidence, not inference.

---

## C7-01 · Cross-tenant `localStorage` leak via logout — FOUND AND FIXED

**Severity: P1** (data leak — mission's classification: fake success/data corruption category, here specifically a cross-account data-boundary failure).

### Discovery

`frontend/src/contexts/AuthContext.jsx`'s `logout()` called only `logoutOperator()` (the server-side session invalidation) and cleared React's `user` state. **It never touched `localStorage`.**

Three keys, written by real, live-imported components, persisted indefinitely across logout:

| Key | Written by | Read by | Content |
|---|---|---|---|
| `jarvis_biz_profile` | `Onboarding.jsx` | `App.jsx`, `PaymentPanel.jsx`, `Chat.jsx` | business type, team size, goals, product name |
| `jarvis_has_leads` | `ContactsV2.jsx`, `AddClientForm.jsx` | `AddClientForm.jsx` | boolean, low sensitivity |
| `operatorSession` | `OperatorConsole.jsx` | `OperatorConsole.jsx` | pending operator command, last-check timestamp |

### Reproduction — proven live, not inferred

```
tenant A seeds jarvis_biz_profile = {business:"Legal Services", teamSize:"10-50",
                                      goals:["automate intake"], product:"Contract review"}
tenant A logs in                    -> 200
tenant A logs out (/auth/logout)    -> 200
jarvis_biz_profile after logout     -> STILL PRESENT, byte-identical
```

### Real functional impact — traced, not assumed

```jsx
// PaymentPanel.jsx — pre-fills the payment-link form
const p = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
return { name: "", phone: "", amount: p?.price... , description: p?.product || "" };

// Chat.jsx — builds quick-action suggestions
const p = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
```

**If a second, different tenant logs into the same browser after tenant A logs out**, `PaymentPanel.jsx` would silently pre-fill the new payment link's description with tenant A's product name, and `Chat`'s quick actions would be built from tenant A's stated business goals. This is a genuine cross-tenant information disclosure, not a cosmetic issue — one tenant's real onboarding answers become visible in another tenant's UI without either party being aware.

### Root cause

Three separate code paths transition the app to a logged-out state — explicit `logout()`, silent session-expiry (`silentCheck`), and the global 401 handler — and **none** of them cleared tenant-scoped storage.

### Fix — minimal, centralized, scoped

```diff
  const _setUserAndBroadcast = useCallback((u, event = "state") => {
+   if (!u) {
+     try {
+       localStorage.removeItem("jarvis_biz_profile");
+       localStorage.removeItem("jarvis_has_leads");
+       localStorage.removeItem("operatorSession");
+     } catch { /* localStorage unavailable — nothing to clean up */ }
+   }
    setUser(u);
    _bc?.postMessage({ event, user: u });
  }, []);
```

Placed inside the **one function all three logged-out transitions already funnel through**, so the fix covers explicit logout, silent expiry, and the 401 handler uniformly — not duplicated per call-site where a future one could be missed.

**Deliberately scoped, not `localStorage.clear()`.** Device/UI preferences (`ooplix_last_tab`, theme, sidebar width, telemetry opt-out) are not tenant data and must survive a normal logout/login cycle — clearing everything would be a worse regression than the leak itself.

### Live verification — through the real UI, not a raw API call

```
seeded jarvis_biz_profile, jarvis_has_leads, operatorSession, ooplix_last_tab
real UI: open org switcher dropdown -> click "Sign out" -> logout() executes

AFTER:
  jarvis_biz_profile : null    ✓ cleared
  jarvis_has_leads    : null    ✓ cleared
  operatorSession     : null    ✓ cleared
  ooplix_last_tab      : "insights"  ✓ SURVIVED (correct — not tenant data)
```

### Negative test

```
remove the jarvis_biz_profile removeItem call
  -> FAILED: jarvis_biz_profile must be cleared on logout — PaymentPanel.jsx and
             Chat.jsx both read it back and would silently use a PREVIOUS
             tenant's business profile
restored -> 7 passed, 0 failed
```

---

## `jarvis_org_id` / `jarvis_enterprise_org` — investigated, found NOT a real risk

`useEnterpriseOrganization.js` generates and stores a synthetic `jarvis_org_id` purely client-side (`org_${Date.now()}_${random}`). The file's own header states: **"No external calls. No autonomous execution. All state: localStorage-only."**

**Confirmed via direct search that zero real components import this hook.** It never reaches the running application, and it never intersects with the server's real multi-tenant organization system (which is scoped server-side via the authenticated session, not client localStorage — confirmed by every prior C-phase's tenant-isolation testing, e.g., C.4/C.6's `.org-switcher-trigger` work, which reads the org from the authenticated API response, not this key).

**Not fixed — nothing to fix.** Documented as an investigated false alarm, not silently dropped.

---

## Cache Storage / Service Worker isolation — N/A

Neither mechanism exists (confirmed in Discovery), so there is no service-worker-cache or Cache-Storage-API tenant-isolation surface to test. Not a gap — genuinely inapplicable.

---

## sessionStorage — lower risk by construction, not separately exploited

`useOfflineCache.js`'s dead-code cache backend uses `sessionStorage`, which is per-tab and cleared on tab close — even if this hook were wired up in the future, it would not carry the same cross-session leak risk `localStorage` does. No live exploitation test was needed since the hook is confirmed unreachable.

---

## Offline authentication — no bypass found

```
grep -rln 'offlineAuth|offline.*bypass' frontend/src -> 0 results
```

No code path grants authenticated access without a genuine server round-trip. Session validity while offline is standard JWT behavior (the token remains valid client-side until its real expiry or a server-side check fails on reconnect) — not a bypass, not weakened, and not altered by this audit.

---

## Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** |
| No auth bypass created | **HELD** — fix touches only `localStorage` cleanup, not auth logic |
| No secure cookie behavior weakened | **HELD** — `logoutOperator()` (server-side) untouched |
| No credentials forged | **HELD** |
| Tenant private data not exposed to another tenant offline | **FIXED** — the one real leak found is closed |
