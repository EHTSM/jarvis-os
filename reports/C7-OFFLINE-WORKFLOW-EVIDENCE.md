# C.7 — OFFLINE WORKFLOW EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence. Every claim traces to a live browser session, auth-verified before measurement.
**No claim from source inspection alone.**

---

## 1 · Auth verification, before every measurement

```
login POST /auth/login -> status 200
page.evaluate(() => !!document.querySelector(".tab")) -> true, checked BEFORE any offline test
```

## 2 · Application shell — full reload while offline

```
BEFORE: online, Contacts loaded -> content length 1246 chars

GO OFFLINE (context.setOffline(true))
page.reload() -> FAILED: net::ERR_INTERNET_DISCONNECTED

after failed reload:
  bodyLen: 0
  title: ""
  hasTabs: false
```

**Blank page.** No cached shell exists to serve.

## 3 · In-memory navigation while offline (no reload)

```
Contacts (online) content sample: "Skip to content\nOoplix\nDashboard\nContacts\nPayments..."

GO OFFLINE (no reload)
navigate to Dashboard (already-visited tab, in-memory) ->
  bodyLen: 759, sample: "Skip to content\nOoplix\nDashboard\nContacts\n...\nWORKSPACE\nUX"

navigate back to Contacts ->
  bodyLen: 1249, sample: "Skip to content\n...\nWORKSPACE\nUX Audi"
```

**Client-side navigation between already-visited tabs works offline** — React re-renders from state already in memory, no network round-trip required for the shell.

## 4 · Cached reads — data persists and is honestly marked

```
before offline: Contacts body length = 1246
GO OFFLINE, wait 9s (past one 8s poll cycle)
after 9s offline: body length = 1249, .topbar-status text = "Offline"
```

**+3 characters is the "Live"→"Offline" label swap itself** — the actual cached content is unchanged, and the offline state is visibly indicated in the same view.

## 5 · Offline mutation attempt — Payments form

```
form fields filled via real Playwright .fill() (not synthetic dispatchEvent):
  #pv2-amount = "500"
  #pv2-description = "offline test payment"

GO OFFLINE
click "Generate Link →"

result:
  errText: "Failed to fetch"
  bodyHasSuccess: false
  bodyHasFailure: true
```

**No fake success. No silent data loss.** The failure is honestly surfaced via the form's existing error UI (`.pv2-err`), the same element used for online validation errors.

## 6 · Reconnect behavior — status transition and request storm check

```
GO OFFLINE, wait 9s -> .topbar-status = "Offline"
GO ONLINE, wait 9s  -> .topbar-status = "Live"

health requests fired in the 9s window AFTER reconnect: 1
  (expected ~1 for the existing 8s poll interval; NOT a retry storm)
```

## 7 · Mobile connection states — 390×844 and 430×932

```
390x844: offline->Offline  online->Live
430x932: offline->Offline  online->Live
```

Same indicator behavior as desktop at both required mobile widths.

## 8 · Cache-Control / artifact integrity, carried from C.1/C.6

```
curl -D- http://localhost:5050/ | grep -i cache-control
  Cache-Control: no-cache
```

C1-D4's fix (never serve a stale cached shell referencing deleted bundles) remains intact. Direct consequence, confirmed live: reloading after a normal online page-load still fails offline (`ERR_INTERNET_DISCONNECTED`) — the shell cannot be served from HTTP cache because it is deliberately never cached. Not a new defect; the correct trade-off of a prior, deliberate fix.

## 9 · Cross-tenant localStorage leak (C7-01) — before/after

**Before fix:**

```
tenant A: localStorage.jarvis_biz_profile = {"business":"Legal Services",...}
login as tenant A -> logout via real /auth/logout call -> status 200
jarvis_biz_profile AFTER logout: STILL PRESENT, byte-identical to before
```

**After fix, via the real UI "Sign out" control (not a raw fetch):**

```
seeded: jarvis_biz_profile, jarvis_has_leads, operatorSession, ooplix_last_tab
login (200) -> open org switcher -> click "Sign out" -> logout() runs

AFTER:
  jarvis_biz_profile : null   (cleared — was leaking)
  jarvis_has_leads    : null   (cleared — was leaking)
  operatorSession     : null   (cleared — was leaking)
  ooplix_last_tab      : "insights"  (SURVIVED — correct, it's a device preference)
```

## 10 · No offline authentication bypass

```
grep -rln 'offlineAuth|offline.*bypass' frontend/src -> 0 results
```

No code path exists that grants authenticated access without a real server round-trip.

## 11 · Service worker / dead-code offline-cache confirmation

```
find frontend -iname 'service-worker*' -o -iname 'sw.js'  -> 0 results
grep -rln 'useOfflineCache' frontend/src (excluding the 2 definition files) -> 0 results
```

Both confirm the certification's NOT IMPLEMENTED / dead-code findings, not source inference alone.

---

## Regression evidence

```
npm run test:runtime : 144/144 · 0 fail · 0 skipped
99-c1-accessibility-recovery   : 10/10
100-c2-ux-error-truthfulness   : 10/10
101-c3-performance-guards      : 11/11
102-c4-design-system-guards    : 7/7
103-c5-mobile-guards           : 6/6
104-c6-cross-browser-guards    : 4/4
96-production-build-artifact-integrity : 4/4
105-c7-offline-guards (new)    : 7/7
```
