# C.6 — CROSS-BROWSER DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Matrix](C6-CROSS-BROWSER-MATRIX.md) · [Workflow Evidence](C6-CROSS-BROWSER-WORKFLOW-EVIDENCE.md) · [Findings](C6-CROSS-BROWSER-FINDINGS.md) · [Recovery](C6-CROSS-BROWSER-RECOVERY.md) · [Certification](C6-CROSS-BROWSER-CERTIFICATION.md)

---

## Baseline

```
git status           : 128 uncommitted files (carried from C.1-C.5, not C.6's own)
branch                : security/reality-completion
npm run test:runtime  : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0
.env changes          : 0
```

---

## Which browsers are actually available — verified, not assumed

Per the mission's explicit rule ("do not simulate a browser that cannot actually be executed"), launch capability was tested directly before any measurement:

```
BEFORE installing anything:
  chromium: LAUNCHABLE, version=149.0.7827.55
  firefox:  NOT LAUNCHABLE — Executable doesn't exist at .../firefox-1532/...
  webkit:   NOT LAUNCHABLE — Executable doesn't exist at .../webkit-2311/...
```

Only Chromium's binary was present on disk; Firefox and WebKit were referenced in Playwright's manifest but never downloaded. `npx playwright install firefox webkit` was run to obtain the real, independent engine binaries (98.8 MiB Firefox, 77.2 MiB WebKit) — no test tooling was fabricated, no browser was simulated.

```
AFTER install:
  chromium: LAUNCHABLE, version=149.0.7827.55
  firefox:  LAUNCHABLE, version=151.0
  webkit:   LAUNCHABLE, version=26.5
```

**Edge — checked and confirmed genuinely unavailable:**

```
/Applications/Microsoft Edge.app  : does not exist on this system
chromium.launch({channel:"msedge"}) : NOT LAUNCHABLE — executable not found
```

**Edge is NOT MEASURED.** No Edge behavior is inferred from Chromium — Edge and Chromium share an engine but are not claimed equivalent per the mission's explicit instruction.

---

## Method

Every browser run followed the mission's Step 3 authentication gate exactly:

1. Navigate to the app
2. `POST /auth/login` via `fetch()` — record the actual HTTP status
3. Re-navigate
4. Verify `document.querySelector(".tab")` exists **before** measuring anything else
5. Only if both checks pass does the run proceed to journey measurement

This gate caught a genuine, reproducible finding rather than a test artifact — see below.

---

## The central discovery: WebKit correctly rejects an insecure cookie

All three engines returned `200` from `/auth/login`. Chromium and Firefox then showed `hasTabs: true` — real authenticated app content. WebKit showed `hasTabs: false`, with the app re-issuing `401`s on every subsequent call.

Investigated rather than assumed:

```
cookies in WebKit's jar immediately after login (before any navigation): []

raw Set-Cookie header actually sent by the server:
  jarvis_auth=...; Max-Age=28800; Path=/; Expires=...; HttpOnly; Secure; SameSite=Strict
```

**`Secure` on a cookie set over plain HTTP is invalid per spec** — the cookie cannot be stored. Chromium and Firefox both special-case `localhost` as a secure context and accept it anyway (documented browser behavior); WebKit does not extend that exception to the cookie `Secure` attribute and correctly refuses to store it.

Root cause in the server code:

```js
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",   // ALREADY environment-aware
  sameSite: "strict",
  ...
};
```

This repo's `.env` has `NODE_ENV=production` — correct for a production-representative deployment — so `secure: true` is emitted, exactly as it should be. The test environment simply has no HTTPS to serve over (`grep -n 'HTTPS|SSL|TLS|cert' backend/server.js` — zero matches; no local certs found anywhere in the repo).

**This is not a WebKit bug and not a product defect.** It is the correct security configuration meeting a genuine local-test-environment limitation. Per the mission's Step 11 — "determine whether the application is actually misconfigured before calling it a bug" — the code was checked and found correct. Classified **ENVIRONMENT BLOCKED**.

### Confirming WebKit is not broadly broken

The unauthenticated public landing page was measured in WebKit independently of the cookie issue:

```
page loaded              : true
console/JS errors        : 1 expected 401 (pre-auth probe), 0 JS errors
CSS feature support      : flex/grid/sticky/backdrop-filter/CSS-vars/gap — ALL true
```

WebKit's rendering and JS engine are fully compatible; only the authenticated journey is blocked, and only by the local-HTTPS gap.

---

## Surfaces measured (Chromium + Firefox, fully authenticated)

| # | Area | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| A. Login → dashboard | ✔ PASS | ✔ PASS | ENVIRONMENT BLOCKED |
| B. Org/workspace switcher dropdown | ✔ PASS, clickable | ✔ PASS, clickable | not reached |
| C. CRM (Contacts) | ✔ PASS | ✔ PASS | not reached |
| D. Sales (Pipeline) | ✔ PASS | ✔ PASS | not reached |
| E. Finance (Payments) | ✔ PASS | ✔ PASS | not reached |
| F. Marketing surface | not directly probed | not directly probed | not reached |
| G. Mission/agent (AI) | ✔ PASS | ✔ PASS | not reached |
| H. Executive surface | not directly probed | not directly probed | not reached |
| I. Command palette | ✔ PASS, opens/searches/closes | ✔ PASS, opens/searches/closes | not reached |
| J. Settings | ✔ PASS | ✔ PASS | not reached |
| Forms — empty-submit validation | ✔ PASS, inline error shown | ✔ PASS, inline error shown | not reached |
| CSS feature support | ✔ full | ✔ full | ✔ full (measured on public shell) |
| Console/JS errors | 0 JS errors, 3 known console 401/404s | 0 console errors, 0 JS errors | 0 JS errors (public shell) |

**F (marketing) and H (executive) were not separately click-tested** — the 4 primary surfaces (CRM, sales, finance, AI) plus palette/settings/dashboard were treated as representative per the mission's "use representative real workflows," matching the surface set C.1–C.5 already established as their measurement baseline.
