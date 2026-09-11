# C.7 — OFFLINE RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What changed, why it was minimal, and what was investigated and correctly left as a documented gap rather than built.

---

## Fix policy applied

| Priority (mission order) | Applied? |
|---|---|
| P0 — data loss/security | **C7-01 applied** — cross-tenant data leak, closed |
| P1 — fake success/data corruption | None found — the one mutation-offline test correctly failed honestly |
| P2 — major offline workflow defect | None found requiring a fix (the shell-unavailable-offline gap is a documented limitation, not a defect — see below) |
| P3 — UX polish | 2 identified, not fixed (see below) |

**No sync architecture, no new database, no duplicated persistence, no service worker was built.** The mission explicitly forbids constructing offline infrastructure during this audit; C.7 found and fixed one security defect in existing code and documented the rest.

---

## Files changed — 1 source file, 1 test added

```
M frontend/src/contexts/AuthContext.jsx          C7-01 tenant-data cleanup on logout
+ tests/security/105-c7-offline-guards.cjs        7 assertions, negative-tested
```

**No existing test modified.** `.env` untouched. No offline architecture, service worker, or sync engine was created.

---

## C7-01 — the fix in full

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

See [C7-OFFLINE-SECURITY.md](C7-OFFLINE-SECURITY.md) for the full root-cause analysis, reproduction, and live verification. Summarized here for the recovery record:

- **Root cause:** `logout()` never cleared `localStorage`; three separate logged-out transitions (explicit logout, silent expiry, 401 handler) shared no cleanup.
- **Fix location:** the one function all three transitions already funnel through — no per-call-site duplication.
- **Scope:** three specific tenant-data keys, not `localStorage.clear()` — device/UI preferences correctly survive.
- **Verified live** through the real UI "Sign out" control, not a raw API call.
- **Negative-tested:** removing the fix reproduces the exact original failure message.

---

## What was investigated and correctly NOT built

### No offline-write queue

A well-engineered retry queue (`useOfflineCache.js`'s `RetryQueue`) already exists in the codebase but is dead code — never imported by any component. **Wiring it up was explicitly considered and rejected** for this audit:

1. The mission's Step 7 explicitly says "Do not build a sync engine during this audit."
2. Wiring up an existing-but-unused mechanism to every mutation surface (Payments, Contacts, Settings, etc.) is a scope of work far beyond a "minimal recovery" — it would touch every form in the product.
3. The current behavior (honest rejection, "Failed to fetch") is **already correct** per the mission's Step 7 classification B ("rejects it honestly") — there is no dishonesty to fix, only a capability gap to document.

**Classified: GENUINE GAP — offline writes are NOT SUPPORTED, and this is honestly reported to the user, not silently or falsely handled.**

### No service worker built

Confirmed absent in Discovery. Building one would be new offline architecture — explicitly forbidden ("Do not build one unless explicitly required by the existing product contract"). No such requirement exists anywhere in the manifest, marketing copy, or product documentation reviewed across this entire audit programme.

**Classified: PWA/OFFLINE CAPABILITY = NOT IMPLEMENTED**, stated accurately.

### `jarvis_org_id` — investigated, no fix needed

Confirmed dead code (see Security report) — no real tenant-isolation exposure exists to fix.

---

## What was NOT fixed — P3 UX polish, correctly deprioritized

| Item | Why not fixed |
|---|---|
| "Failed to fetch" is a raw, technical error message on offline mutation failure | Honest (not fake success), just not friendly. Lower priority than the P1 security fix; a UX-copy change across every mutation surface is a broader change than this audit's minimal-recovery mandate for a non-critical issue. |
| Mutation controls are not proactively disabled while offline (they fail on submit instead) | Same reasoning — correct, honest behavior; disabling controls is a UX enhancement, not a defect fix. |

Both are documented in the Capability Matrix and Certification as open items, not silently dropped.

---

## Regression — no test weakened

| Gate | Before C.7 | After C.7 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| `99-c1-accessibility-recovery` | 10/10 | **10/10 — C.1 intact** |
| `100-c2-ux-error-truthfulness` | 10/10 | **10/10 — C.2 intact** |
| `101-c3-performance-guards` | 11/11 | **11/11 — C.3 intact** |
| `102-c4-design-system-guards` | 7/7 | **7/7 — C.4 intact** |
| `103-c5-mobile-guards` | 6/6 | **6/6 — C.5 intact** |
| `104-c6-cross-browser-guards` | 4/4 | **4/4 — C.6 intact** |
| `90-phase-c1-search-alias-coverage` | 8/8 | **8/8** |
| `91-api-404-boundary` | 5/5 | **5/5** |
| `96-production-build-artifact-integrity` | 4/4 | **4/4** |
| `105-c7-offline-guards` *(new)* | — | **7/7** |
| Production build | PASS | **PASS** — no poisoned `REACT_APP_API_URL` |

---

## Negative tests — the guard provably fails when reverted

```
remove the jarvis_biz_profile removeItem call
  -> FAILED: jarvis_biz_profile must be cleared on logout — PaymentPanel.jsx and
             Chat.jsx both read it back and would silently use a PREVIOUS
             tenant's business profile

(also verified against a REAL rebuilt artifact — not just source assertion —
 by removing the fix, rebuilding, restarting the server, and re-running: same
 failure reproduced against the actual shipped bundle)

restored -> 7 passed, 0 failed
```

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Build a service worker | Explicitly forbidden absent a product-contract requirement; none found |
| Wire up the dead-code retry queue | Would constitute building a sync engine — explicitly forbidden this audit |
| Call `localStorage.clear()` | Would destroy legitimate device preferences — a worse regression than the leak |
| "Fix" `jarvis_org_id` | Confirmed dead code, no real risk exists |
| Re-open C1-D4 to enable an offline-cacheable shell | Would contradict a deliberate, already-certified prior fix; out of C.7's scope |
| Repeat C.3's performance audit | Only offline-specific symptoms (retry storm, reconnect delay) were checked, per the mission's explicit limit |
| Repeat C.5's full mobile audit | Only offline-indicator behavior was checked at 390/430px, per the mission's explicit limit |
| Improve "Failed to fetch" copy | P3 UX polish, correctly deprioritized behind the P1 security fix |
