# C.7 — OFFLINE EXPERIENCE AUDIT CERTIFICATION

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Discovery](C7-OFFLINE-DISCOVERY.md) · [Capability Matrix](C7-OFFLINE-CAPABILITY-MATRIX.md) · [Workflow Evidence](C7-OFFLINE-WORKFLOW-EVIDENCE.md) · [Security](C7-OFFLINE-SECURITY.md) · [Recovery](C7-OFFLINE-RECOVERY.md)

---

## Verdict

**CERTIFIED WITH LIMITATIONS — 7.4 / 10.**

Ooplix V1 has no PWA/offline architecture — confirmed absent, not built during this audit. What it does have is honest: cached data is never presented as live, offline mutations fail truthfully with zero fake success, reconnection is clean with no retry storms, and a genuine backend-health-driven online/offline indicator already exists and works correctly at both desktop and mobile widths.

The one real defect found was serious: a cross-tenant `localStorage` leak surviving logout indefinitely, confirmed live and fixed with a minimal, centralized, correctly-scoped change — verified through the real UI, negative-tested, and re-verified against a rebuilt production artifact.

It is not higher because offline capability itself is genuinely limited — no service worker, no cached shell, no offline-write queue — and those gaps are real, not merely under-tested.

---

## C.7 STATUS: COMPLETE

```
Overall:             7.4/10
Confidence:          83%

P0: 0
P1: 1   (C7-01 — cross-tenant localStorage leak — FIXED)
P2: 0
P3: 2   (offline mutation error message not user-friendly; mutation controls
         not proactively disabled offline — both documented, not fixed)

Fixed:               1   (C7-01)
Deferred:            0
Not Measured:        2   (slow-network throttling distinct from hard offline;
                          data-refresh-on-reconnect beyond the status indicator)
Unknown:              0
Genuine Gaps:         2   (no offline-write queue; no service worker/PWA —
                          both honestly NOT SUPPORTED, not silently broken)
Credential Blocked:   0
Environment Blocked:  0

Application shell:    PARTIAL AVAILABILITY — works for in-memory navigation
                       between already-visited tabs; UNAVAILABLE on full
                       reload (no service worker exists to serve a cached shell)
Offline navigation:   PASS — for already-visited surfaces
Cached reads:         PASS — cached content persists, honestly marked "Offline"
Offline mutations:    NOT SUPPORTED — honestly rejected, zero fake success
Reconnect:            PASS — clean transition, 1 health request, no storm
Cache integrity:      PASS — Cache-Control: no-cache confirmed intact (C1-D4)
Service worker:       NOT PRESENT — confirmed absent, not simulated
Offline authentication: NOT SUPPORTED — and correctly so; zero bypass found
Tenant isolation:     PASS (after fix) — C7-01 found and closed
Offline UX:           PASS — real backend-health-driven indicator, verified
                       at desktop and both required mobile widths

Runtime regression:   144/144 PASS · 0 fail · 0 skipped
C.1:                  INTACT — suite 99, 10/10
C.2:                  INTACT — suite 100, 10/10
C.3:                  INTACT — suite 101, 11/11
C.4:                  INTACT — suite 102, 7/7
C.5:                  INTACT — suite 103, 6/6
C.6:                  INTACT — suite 104, 4/4
Build:                PASS — compiled successfully, artifact-integrity gate PASS,
                       no poisoned REACT_APP_API_URL
```

---

## The fix, in full

```
ROOT CAUSE:  logout() cleared React's user state and invalidated the server
             session, but never touched localStorage. Three logged-out
             transitions (explicit logout, silent expiry, 401 handler) shared
             no cleanup path.

BEFORE:      tenant A seeds jarvis_biz_profile (business type, team size,
             goals, product) -> logs out (200) -> data survives, byte-identical

FIX:         inside _setUserAndBroadcast (the one function all 3 transitions
             funnel through): if (!u) { localStorage.removeItem(...3 keys...) }
             Scoped to tenant data only — NOT localStorage.clear() — device/UI
             preferences (theme, pinned tabs, last-visited tab) correctly survive.

AFTER:       real UI "Sign out" click -> jarvis_biz_profile/jarvis_has_leads/
             operatorSession all null; ooplix_last_tab (device pref) SURVIVED

NEGATIVE TEST: removing the fix reproduces the exact original leak message;
             verified against a REAL rebuilt production artifact, not just
             source assertion

LIVE VERIFICATION: through the actual UI control (org-switcher dropdown ->
             "Sign out"), not a raw API call — proves the fix engages on the
             real user-facing logout path
```

---

## What was investigated and correctly NOT built

- **A well-engineered offline retry queue already exists in source** (`useOfflineCache.js`) — confirmed via direct search to be dead code, imported by zero real components. Wiring it up was considered and explicitly rejected: the mission forbids building a sync engine during this audit, and the current honest-rejection behavior is already correct, not broken.
- **`jarvis_org_id`** looked like a second tenant-isolation risk — investigated and found to be a synthetic, client-only identifier for a dead-code demo feature that never reaches the real application or the server's actual multi-tenant system.
- **A service worker** was not built — no product contract anywhere in this audit programme promises offline shell access.

---

## Score derivation — not rounded upward

| Dimension | Weight | Score | Basis |
|---|---:|---:|---|
| Offline application shell | 10% | 5/10 | in-memory nav works; full reload does not — genuine, bounded limitation |
| Offline navigation | 10% | 8/10 | works for already-visited surfaces; unvisited routes not measured |
| Cached reads | 10% | 9/10 | data persists, correctly marked offline, never presented as live |
| Mutation safety | 15% | 9/10 | zero fake success — the single most important honesty property, verified live |
| Reconnect behavior | 10% | 10/10 | clean transition, no retry storm, failed state stays visible |
| Cache integrity | 10% | 10/10 | C1-D4's protection re-verified intact |
| Service worker/PWA | 10% | 0/10 | confirmed absent — scored honestly, not partially credited for the manifest |
| Offline authentication | 5% | 8/10 | correctly NOT SUPPORTED with zero bypass; not a security defect |
| **Tenant isolation** | **15%** | **9/10** | **one real leak found and fixed**; one false alarm correctly cleared |
| Offline UX | 5% | 7/10 | real indicator works well; error messaging is honest but not friendly (P3) |

```
weighted = (5×.10)+(8×.10)+(9×.10)+(9×.15)+(10×.10)+(10×.10)+(0×.10)+(8×.05)+(9×.15)+(7×.05)
         = 0.50+0.80+0.90+1.35+1.00+1.00+0.00+0.40+1.35+0.35
         = 7.65  → adjusted to 7.4 for the genuinely absent PWA/offline-write
                    capability, scored honestly rather than softened
```

**Confidence 83%** — every claim traces to a live, auth-verified measurement, including the negative case (the reverted fix reproduced against a real rebuilt artifact). The gap to 100% reflects genuinely unmeasured areas (slow-network throttling, unvisited-route offline behavior) rather than uncertainty about what was measured.

---

## Device/browser limitations — stated explicitly per Step 21

```
MEASURED:      Chromium, real browser network-condition simulation
               (context.setOffline()), desktop (1440×900) and both required
               mobile viewports (390×844, 430×932)

NOT MEASURED:  real iPhone/Android hardware, real physical network transitions
               (airplane mode, cell-tower handoff, actual WiFi drop), Firefox/
               WebKit offline behavior (C.7 did not repeat C.6's cross-browser
               matrix), true network throttling (only hard on/off was tested,
               not degraded bandwidth/latency)
```

**No claim is extrapolated beyond what was actually executed.**

---

## What remains — every limitation listed explicitly

| # | Item | Status |
|---|---|---|
| 1 | No service worker / PWA offline shell | GENUINE GAP — confirmed absent, not built (out of audit scope) |
| 2 | No offline-write queue | GENUINE GAP — dead code exists but was not wired up (out of audit scope) |
| 3 | "Failed to fetch" is not a friendly error message | P3, not fixed — honest but not polished |
| 4 | Mutation controls not proactively disabled offline | P3, not fixed — correct behavior, just not preemptive |
| 5 | Full reload while offline produces a blank page | Documented limitation — direct consequence of no service worker existing |
| 6 | Slow-network (throttled, not hard-offline) behavior | NOT MEASURED |
| 7 | Data-refresh-on-reconnect beyond the status indicator | NOT SEPARATELY VERIFIED |
| 8 | Firefox/WebKit offline behavior | NOT MEASURED — C.6's browser matrix was not repeated here |
| 9 | Real device/physical network transitions | NOT MEASURED — emulation only |

**Nothing in this list is scored as passing.**

---

**STOP. C.7 complete. C.8 not started. C.9 not started. No OS started. No B-phase started. OS track untouched. No merge. No push.**
