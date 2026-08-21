# C.6 — CROSS-BROWSER FINDINGS

Date: 2026-08-14 · Branch: `security/reality-completion`

Every finding classified: FIXED · DEFERRED · NOT MEASURED · INTENTIONAL · UNKNOWN · GENUINE GAP · CREDENTIAL BLOCKED · ENVIRONMENT BLOCKED.

---

## Summary

| Rank | Count |
|---|---:|
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 1 (ENVIRONMENT BLOCKED — not a code defect) |
| **P3** | 0 |

**No fix was applied in C.6.** The one substantive finding is that the product's existing code is already correct, and no change was needed — see below.

---

## C6-01 · WebKit cannot authenticate over local plain HTTP — ENVIRONMENT BLOCKED

**Not classified as P0/P1 despite blocking WebKit's entire authenticated journey**, because root-cause investigation proved it is not a product defect:

```
COOKIE_OPTS.secure = process.env.NODE_ENV === "production"   (backend/routes/auth.js)
```

This repo's `.env` has `NODE_ENV=production`, so the login response correctly sets `Secure; SameSite=Strict` on the session cookie — required, correct behavior for a production deployment. `Secure` cookies cannot be stored over plain HTTP per spec. Chromium and Firefox both special-case `localhost` as a secure context and store the cookie anyway (documented, common browser behavior); WebKit does not extend that exception to the cookie `Secure` attribute and correctly refuses it.

**Verified this is not a WebKit-specific rendering or JS defect:** the same page, unauthenticated, loads cleanly in WebKit with 0 JS errors and full modern-CSS feature support (flex, grid, sticky, backdrop-filter, custom properties, gap) — all confirmed via `CSS.supports()` live in the actual WebKit engine.

**Verified this is not fixable without weakening production security:** the code is already environment-conditional. The only way to make WebKit pass this specific local test would be to hardcode `secure: false`, which would ship an insecure cookie to production — exactly the trade-off the mission's fix policy forbids ("avoid ... weakening tests" / never trade correctness for a passing test).

**No local HTTPS tooling was available to work around this** (`mkcert`, `local-ssl-proxy` both absent; no certs anywhere in the repo). Installing new local infrastructure mid-audit to manufacture a passing result was judged out of scope — it would test a proxy, not the actual product.

**Classification: ENVIRONMENT BLOCKED.** In real production (HTTPS), this defect does not exist in any of the three engines.

---

## What was checked and found to have no cross-browser defect

| Area | Result |
|---|---|
| Navigation (tabs, dropdowns, palette) | Identical behavior, Chromium vs Firefox |
| Command palette search results | Identical result counts ("payments" → 2, both engines) |
| Form validation | Identical error message, both engines |
| CSS Grid/Flexbox/sticky/backdrop-filter/custom-properties/gap | Supported in all 3 engines (WebKit confirmed on public shell) |
| JS runtime errors | **0 in all 3 engines** |
| Unauthenticated route rejection | **401 in all 3 engines** — no bypass anywhere |
| Build artifact loading | 0 failed requests, both authenticated engines tested |
| C.5's mobile overflow | 123px (Chromium) vs 124px (Firefox) — 1px rounding, not a regression |

**Console-log verbosity differs between engines** (Chromium/WebKit log the expected pre-login 401 as a console error; Firefox does not) — noted as a benign engine-logging difference, not a functional defect, and not fixed (nothing to fix — no code change would eliminate a browser's own devtools logging choice without altering the app's actual request pattern).

---

## Pre-existing items observed, not introduced by C.6

`/coding/context` returning `404` was observed in the Chromium console-error capture. This is a known, pre-existing route gap noted in earlier audit context, unrelated to browser compatibility (would 404 identically in any engine), and out of C.6's scope to fix.

---

## Edge — NOT MEASURED, stated plainly

No separate Edge binary exists on this system (`/Applications/Microsoft Edge.app` absent; `msedge` Playwright channel fails to launch). **No Edge result is claimed, inferred, or extrapolated from the Chromium measurement**, even though they share an engine — per the mission's explicit instruction not to do so.

---

## Genuine Gaps

**None found that require a code fix.** The one blocking issue (C6-01) traces to environment infrastructure (no local HTTPS), not application code, and the application code was verified to already handle the underlying condition correctly.
