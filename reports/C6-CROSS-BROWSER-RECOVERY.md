# C.6 — CROSS-BROWSER RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What changed, and — more significantly — what was investigated and correctly left unchanged.

---

## Fix policy applied

| Priority (mission order) | Applied? |
|---|---|
| 1. standards-compliant CSS | N/A — no CSS defect found |
| 2. standards-compliant JS/API usage | N/A — no JS defect found |
| 5. minimal compatibility correction | **Not needed — the code was already correct** |

**No browser-specific hack, user-agent detection, arbitrary delay, error-hiding, or security-weakening was introduced.** The one candidate "fix" (hardcoding `secure: false` to make WebKit pass locally) was explicitly considered and rejected — see Findings, C6-01.

---

## Files changed — 0 product files, 1 test added

```
+ tests/security/104-c6-cross-browser-guards.cjs   4 assertions, negative-tested
```

**No product code was modified in C.6.** `backend/routes/auth.js` was read, investigated, and confirmed already correct — nothing in it needed to change. `.env` untouched.

---

## The decision not to "fix" WebKit

This is documented at length because *not* changing code is the substantive engineering decision this phase produced, and it deserves the same rigor as a fix would.

### What was considered

```diff
- secure: process.env.NODE_ENV === "production",
+ secure: false,
```

This single-line change would make the local test environment's WebKit run pass immediately.

### Why it was rejected

1. **It ships an insecure cookie to production.** `NODE_ENV=production` is this repo's actual configured environment (confirmed via `.env`); the conditional exists specifically so production gets `Secure` and local HTTP development does not need it. Hardcoding `false` defeats that distinction everywhere, including real production.
2. **The mission's fix policy explicitly lists this failure mode**: "avoid ... weakening tests," "disabling security." A cookie security attribute is a security control, not a test artifact.
3. **The defect is not reproducible in real production.** Production is served over HTTPS (confirmed by prior phases' CSP/domain-split evidence). All three engines correctly accept `Secure` cookies over HTTPS. There is no end-user-facing defect to fix.
4. **A safer alternative (local HTTPS via `mkcert`/`local-ssl-proxy`) was checked and found unavailable** in this environment, and installing new infrastructure mid-audit to manufacture a passing local test was judged disproportionate — it would test a proxy setup, not the product itself.

### What was done instead

The correct existing configuration was locked in with a regression guard (`104-c6-cross-browser-guards.cjs`), specifically asserting that `secure` stays conditional — **not** hardcoded to `true` (which would break every local HTTP dev workflow) **or** `false` (which would ship insecurely). This guard exists precisely to prevent a future well-intentioned "fix" for this exact WebKit-local-testing friction from silently weakening production security.

---

## Regression — no test weakened

| Gate | Before C.6 | After C.6 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| `99-c1-accessibility-recovery` | 10/10 | **10/10 — C.1 intact** |
| `100-c2-ux-error-truthfulness` | 10/10 | **10/10 — C.2 intact** |
| `101-c3-performance-guards` | 11/11 | **11/11 — C.3 intact** |
| `102-c4-design-system-guards` | 7/7 | **7/7 — C.4 intact** |
| `103-c5-mobile-guards` | 6/6 | **6/6 — C.5 intact** |
| `90-phase-c1-search-alias-coverage` | 8/8 | **8/8** |
| `91-api-404-boundary` | 5/5 | **5/5** |
| `96-production-build-artifact-integrity` | 4/4 | **4/4** |
| `104-c6-cross-browser-guards` *(new)* | — | **4/4** |
| Production build | PASS | **PASS** — no poisoned `REACT_APP_API_URL` |

---

## Negative tests — the guard provably fails when the tempting-but-wrong fix is applied

```
hardcode secure:false (the tempting local-test fix)
  -> FAILED: COOKIE_OPTS.secure must stay conditional on NODE_ENV === 'production'
             — hardcoding it to false would ship an insecure cookie to production

weaken SameSite to "lax"
  -> FAILED: SameSite=Strict must remain in place — this is correct CSRF
             protection and is unrelated to the WebKit-local-HTTP limitation

restored -> 4 passed, 0 failed
```

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Hardcode `secure: false` | Would ship an insecure cookie to production — the exact trade the mission forbids |
| Install local HTTPS tooling (mkcert, proxy) | Disproportionate for one local test limitation; would test a proxy, not the product |
| Add user-agent detection or WebKit-specific branching | No product defect exists to branch around |
| "Fix" the 1px overflow difference between Chromium/Firefox | Subpixel rounding, not a defect |
| Investigate `/coding/context` 404 | Pre-existing, unrelated to browser compatibility, out of C.6's scope |
| Claim Edge results from Chromium | Explicitly forbidden by the mission; Edge is genuinely NOT MEASURED |
