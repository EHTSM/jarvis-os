# C.7 — OFFLINE EXPERIENCE DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Capability Matrix](C7-OFFLINE-CAPABILITY-MATRIX.md) · [Workflow Evidence](C7-OFFLINE-WORKFLOW-EVIDENCE.md) · [Security](C7-OFFLINE-SECURITY.md) · [Recovery](C7-OFFLINE-RECOVERY.md) · [Certification](C7-OFFLINE-CERTIFICATION.md)

---

## Baseline

```
git status           : 139 uncommitted files (carried from C.1-C.6, not C.7's own)
branch                : security/reality-completion
npm run test:runtime  : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0
.env changes          : 0
```

---

## Service worker — traced, not assumed

```
find frontend -iname 'service-worker*' -o -iname 'sw.js'  -> 0 results
grep -rn 'serviceWorker' frontend/src                       -> 0 results
```

**No service worker exists anywhere in the codebase — not registered, not present as a file, not referenced.** CRA's default `serviceWorkerRegistration.js` scaffold is entirely absent.

## PWA manifest — present, but investigated for what it actually does

```
frontend/public/manifest.json — exists, valid JSON
  short_name, name, icons, theme_color, display:"standalone"
```

Per the mission's explicit warning not to assume PWA support merely because a manifest exists: **a manifest alone controls only the browser's "Add to Home Screen" / install-prompt metadata.** It grants zero offline capability without a service worker to intercept `fetch` and serve cached responses. **Confirmed: PWA offline capability is NOT IMPLEMENTED**, despite the manifest's presence.

## Offline-cache infrastructure — found, then found to be dead code

Two independent, real implementations of a hook literally named `useOfflineCache` exist in source:

1. **`frontend/src/hooks/useOfflineCache.js`** — a genuinely well-engineered cache-first hook: `sessionStorage`-backed reads with TTL, an exponential-backoff retry queue (`RetryQueue` class), automatic flush on the browser's `online` event, and correct `isStale` tracking.
2. **`frontend/src/hooks/useElectron.js`** (a *separate*, same-named `useOfflineCache` function) — a thinner Electron-only wrapper around `window.electronAPI.cacheGet/cacheSet`.

**Neither is imported by any real page or component.** Verified by direct search:

```
grep -rln 'useOfflineCache' frontend/src | grep -v the-two-definition-files
  -> 0 results
```

**This is dead code.** A well-built offline mechanism exists in the repository but does not reach the running application. It is not credited to the product's actual offline capability anywhere in this audit.

## The real, actually-used data layer — has zero offline handling

`frontend/src/_client.js`'s `_fetch()` is the shared HTTP client every domain API file imports. Read in full: it has execution-tracking, duplicate-request guards, a 401 broadcast handler, and structured logging — but **no cache, no retry queue, no offline branch of any kind**. A failed request throws directly to the caller. This is the code path every real component actually uses.

## localStorage — 268 references, 31 keys genuinely written

A broader scan found 268 `localStorage` references across the codebase; narrowing to keys that are actually **written** (not merely read, and not duplicate matches of the same key) produced 31 distinct keys. Most are harmless device/UI preferences (`ooplix_last_tab`, `ew-sidebar-w`, `jarvis_telemetry_off`) that are correct to persist across logins.

**Two keys investigated as tenant-data risks, per Step 13:**

- **`jarvis_biz_profile`** (set by `Onboarding.jsx`; read by `App.jsx`, `PaymentPanel.jsx`, `Chat.jsx`) — real onboarding data (business type, team size, goals, product). **Confirmed a genuine cross-tenant leak** — see Security report.
- **`jarvis_org_id`** (set by `useEnterpriseOrganization.js`) — investigated and found to be a **synthetic, purely client-side identifier** for a dead-code demo feature (header comment: "No external calls. No autonomous execution. All state: localStorage-only"), confirmed unused by any real component (`grep` for consumers returned zero results). **Not a real tenant-isolation risk** — it never touches the backend's actual multi-tenant org system.

## IndexedDB, Cache Storage API — confirmed absent

```
grep -rl 'indexedDB' frontend/src        -> 0 results
grep -rl 'caches.open' frontend/src      -> 0 results
```

Neither storage mechanism is used anywhere.

## Online/offline detection — a real, working mechanism found

```js
// App.jsx — active polling, not merely navigator.onLine
const poll = async () => {
  const healthy = await checkHealth();
  ...
  setOnline(healthy);
};
```

The topbar's `.topbar-status` button ("Live" / "Offline") is driven by an **actual backend health poll**, not just the browser's `navigator.onLine` (which only detects OS-level network state, not "is our API actually reachable"). This is more accurate and was found to work correctly live — see Workflow Evidence.
