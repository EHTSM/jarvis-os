# C.7 — OFFLINE CAPABILITY MATRIX

Date: 2026-08-14 · Branch: `security/reality-completion`

Every row traces to a live measurement or an explicit NOT SUPPORTED / NOT MEASURED classification.

---

## Offline test matrix (mission Step 3)

| # | State | Result |
|---|---|---|
| A | Online normal state | PASS — measured baseline, auth verified before every test |
| B | Network disconnected | Detected within one 8s poll cycle; UI shows "Offline" |
| C | Network restored | Detected within one 8s poll cycle; UI shows "Live"; 1 health request fired (no retry storm) |
| D | API server unavailable | Same detection path as B (health poll fails identically whether DNS/network or API itself is down) |
| E | Slow network | NOT SEPARATELY MEASURED — Playwright's `setOffline()` is a hard cut, not throttling; would require a separate network-throttling harness (out of C.7's budget; not a C.3 repeat) |
| F | Reload while offline | **Blank page** — `bodyLen: 0`, no cached shell (no service worker exists) |
| G | Navigate while offline | **Works** for already-visited, in-memory-rendered tabs (client-side React re-render, no network round-trip needed) |
| H | Read existing cached state | Previously-loaded data remains visible and unchanged; correctly marked "Offline", not silently presented as live |
| I | Attempt mutation offline | **Honestly rejected** — "Failed to fetch" surfaced to the user; zero fake success |
| J | Reconnect after failed mutation | No automatic retry/replay exists (consistent with the dead-code retry queue finding); the failed state remains visible, not silently cleared |

---

## Application shell

| Scenario | Result |
|---|---|
| Full reload while offline | **UNAVAILABLE** — blank page, `document.body.innerText.length === 0` |
| In-memory navigation while offline (no reload) | **AVAILABLE** — SPA state already in memory, no network needed for already-visited tabs |
| Product contract promise | **Not claimed anywhere** — no manifest/marketing text promises offline shell access; this is accurately a gap, not a broken promise |

**Classification: PARTIAL AVAILABILITY**, precisely bounded — shell survives offline only if the tab was already loaded and the browser process wasn't reloaded/restarted.

---

## Navigation offline

| Surface | Result |
|---|---|
| Dashboard (previously visited) | PASS — content persists, ~unchanged length |
| Contacts (previously visited) | PASS — content persists |
| Org/workspace switcher | Not separately tested offline (dropdown mechanics are a C.5/C.6 concern; not re-tested here) |
| Unvisited tab (never loaded) | NOT MEASURED — would require a fresh route the SPA hasn't yet fetched data for; not separately probed |

No blank page or infinite loading was observed for **already-visited** surfaces. No claim is made about surfaces never visited before going offline.

---

## Cached reads

| Data | Classification |
|---|---|
| Dashboard summary (already loaded) | **CACHED** — remains visible, UI honestly shows "Offline" alongside it, not presented as live |
| Contacts list (already loaded) | **CACHED** — same |
| Any surface not yet loaded before disconnect | **UNAVAILABLE** — no fetch can succeed, no cache layer exists to serve it |

**The UI does not present stale data as live data** — the "Offline" status indicator is visible in the same view as the cached content throughout the disconnected period.

---

## Mutations offline

**Classification: NOT SUPPORTED, correctly and honestly reported (Step 7, option B).**

```
attempted: fill Payments form, submit while offline
result: "Failed to fetch" shown inline via the form's existing error UI
        0 fake success, 0 silent data loss, 0 misleading confirmation
```

No offline-write queue exists in the live application (the one that was built — `useOfflineCache.js`'s `RetryQueue` — is dead code, never imported). This is documented as a **genuine gap**, not fixed — building a sync engine during this audit is explicitly forbidden by the mission.

---

## Reconnect

| Check | Result |
|---|---|
| Connection state updates | PASS — "Offline" → "Live" within one poll cycle |
| Stale indicators clear appropriately | PASS — status resolves correctly |
| Reads refresh | Not separately re-verified beyond the status indicator (would require watching a specific data value change, not attempted this pass) |
| Queued writes execute | N/A — no genuine queue exists |
| Failed writes remain visible | PASS — the "Failed to fetch" error was not silently cleared |
| No duplicate writes | PASS — no retry mechanism exists to duplicate anything |
| No fake "synced" state | PASS — no synced/success state is ever shown for a write that failed |
| Retry storm | **PASS — 1 health request in the 9s window after reconnect**, not a flood |

---

## Cache integrity (mission Step 10 / carried from C.1/C.6)

```
Cache-Control on the SPA shell: no-cache   (C1-D4's fix, re-verified intact)
```

Because the shell is never HTTP-cached, there is **no stale-artifact risk from offline browsing** — the trade-off is that the shell also cannot be served from HTTP cache while offline (confirmed: reload after a normal online page-load still fails with `ERR_INTERNET_DISCONNECTED`). This is the direct, correctly-prioritized consequence of C1-D4's artifact-integrity fix, not a new defect — re-opening it to enable offline caching would contradict a deliberate prior decision and is out of C.7's scope.

---

## Service worker / PWA

| Item | Result |
|---|---|
| Service worker file | **NOT PRESENT** |
| Registration code | **NOT PRESENT** |
| Cache population | N/A — no service worker to populate a cache |
| Update / old-worker removal | N/A |
| Fetch interception / offline fallback | N/A |

**PWA/OFFLINE CAPABILITY = NOT IMPLEMENTED.** Stated plainly per the mission's explicit instruction, not built during this audit.

---

## Storage

| Mechanism | Used? | Verified |
|---|---|---|
| localStorage | Yes — 31 keys genuinely written | Data survives reload (confirmed by design — localStorage is reload-durable by spec); **1 genuine cross-tenant leak found and fixed (C7-01)** |
| sessionStorage | Yes — 2 files | Tab-scoped, lower risk by construction |
| IndexedDB | **No** | Confirmed absent |
| Cache Storage API | **No** | Confirmed absent |

---

## Tenant isolation offline — security-critical, per Step 13

**See [C7-OFFLINE-SECURITY.md](C7-OFFLINE-SECURITY.md) for full evidence.** Summary: one genuine leak found (`jarvis_biz_profile` + 2 related keys survived logout indefinitely) and fixed; one false-alarm investigated and cleared (`jarvis_org_id` — dead code, never reaches a real component).

---

## Offline authentication

| Check | Result |
|---|---|
| Authenticated session + network disappears | Session cookie remains valid (server-side JWT expiry unaffected by client connectivity) — correct, standard behavior |
| Session expires while offline | Silent expiry check cannot reach the server; no forced logout occurs until reconnect (server-side truth is deferred, not bypassed) |
| Browser reloads offline | **Blank page** — cannot even reach the login-check code, let alone bypass it |
| Offline authentication bypass | **Confirmed absent** — `grep` for any offline-auth code path returned zero results |

**Classification: NOT SUPPORTED (offline authenticated app use), and correctly so — no bypass exists.**

---

## Offline UX

| Signal | Present? |
|---|---|
| Offline indicator | **YES** — real, backend-health-driven "Offline"/"Live" status |
| Stale-data indicator | Partial — the offline indicator is visible alongside cached content, but content itself carries no per-field "last updated" timestamp |
| Retry (manual) | Available via the existing refresh patterns each surface already has (not offline-specific, general app behavior) |
| Reconnect behavior | PASS — automatic, no storm |
| Error messaging on failed mutation | Honest but technical (`"Failed to fetch"` — a raw JS error string, not a friendly message) |
| Disabled mutation controls while offline | **NOT PRESENT** — forms remain interactive and only fail on submit, rather than proactively disabling; not fixed (P3, UX polish, not incorrect) |

---

## Mobile connection states (390×844 / 430×932)

```
390×844  offline -> online transition: same "Offline"/"Live" indicator behavior as desktop
430×932  offline -> online transition: same
```

Not a repeat of the full C.5 audit — only the offline-specific indicator and reconnect behavior were checked at these two widths, per the mission's explicit scope limit. No mobile-specific offline defect found.
