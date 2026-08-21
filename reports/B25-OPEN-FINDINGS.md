# B.25 — OPEN FINDINGS RECONCILIATION

Date: 2026-08-14 · Branch: `security/reality-completion`

Every carried-forward item from B.19.x–B.24, reconciled against **live B.25 measurement**.
No historical finding was deleted. Where a prior classification was wrong, the original is shown alongside the correction.

Classifications: `STILL OPEN` · `FIXED SINCE LAST EVIDENCE` · `NOW MEASURABLE` · `CREDENTIAL BLOCKED` · `GENUINE GAP` · `OUT OF SCOPE`

---

## Summary

| Status | Count |
|---|---:|
| FIXED SINCE LAST EVIDENCE | 2 |
| NOW MEASURABLE | 2 |
| STILL OPEN | 4 |
| CREDENTIAL BLOCKED | 5 |
| GENUINE GAP | 2 |
| OUT OF SCOPE | 1 |
| **Prior findings corrected** | **1** |

---

## 1. G1-B193 — unlabelled form controls

**Origin:** B.19.3 — "763 form controls have no visible labels", Form labelling scored 3/10 (WCAG 3.3.2 / 1.3.1).

**B.25 status: STILL OPEN.**

Re-measured live against current source:

```
components scanned             : 252
form controls                  : 834
aria-label / labelledby / title:   4
placeholder only               : 414   ← not an accessible name (WCAG 3.3.2)
id= only                       :   1
NO name signal at all          : 415
```

The B.19.3 figure (763) and this figure (829 unlabelled-or-weak) are **the same defect measured with a different tag regex** — not a regression and not an improvement.

Worst offenders: `EnterpriseOS.jsx` 63 · `DeveloperOS.jsx` 39 · `BrowserAutomationPanel.jsx` 24 · `GrowthOS.jsx` 21 · `DistributionOS.jsx` 15.

**Not fixed, deliberately.** Labelling 415+ controls across ten product families is a design change requiring per-control copy decisions and re-verification — not an audit recovery. Mechanically injecting `aria-label` would produce unverifiable labels and a false accessibility claim.

**Consequence:** B.19.3's **NOT CERTIFIED for screen-reader accessibility** stands. V1 must not be marketed as accessible.

---

## 2. G2-B195 — palette pin button is an invalid listbox child

**Origin:** B.19.5 — Name/role/value (4.1.2) scored 7/10; "remains open with a proven remedy".

**B.25 status: FIXED SINCE LAST EVIDENCE.**

Reproduced exactly as described in [CommandPalette.jsx](../frontend/src/components/CommandPalette.jsx): a pin `<button>` sat inside `div.cp-row` inside `role="listbox"`. ARIA permits only `option`, `group`, or presentational children.

Fix: `role="presentation"` on `div.cp-row`. Layout unchanged; the `option` remains valid; the pin button becomes an ordinary labelled button (it already carried `aria-label`).

Verified in the **shipped production bundle**:

```
4395.3309985e.chunk.js:  jsxs("div",{className:"cp-row",role:"presentation",...
```

No test depended on the prior markup (suite 88 selects `.cp-row` by class; CSS targets the class).

---

## 3. Screen-reader certification limitation

**Origin:** B.19.3 — "**NOT CERTIFIED for screen-reader accessibility**", 7.5/10.

**B.25 status: STILL OPEN.**

One of its two named blockers (G2-B195) is now fixed; the dominant one (G1-B193) is not. A screen-reader certification cannot be granted while 415 controls are unnamed.

**The verdict is carried forward unchanged.** Accessibility scored 4/10 in B.25.

---

## 4. JWT logout revocation

**Origin:** B.23 → B.24-05, PRE-EXISTING LIMITATION.

**B.25 status: STILL OPEN** — re-measured live.

```
before logout : /accounts/me = 200
POST /auth/logout            = 200
AFTER logout, SAME token     = 200   ← still valid
```

Stateless JWT (HS256, 8h `TOKEN_EXPIRY`) with no denylist. Logout clears the cookie; it cannot invalidate a captured token.

**Impact:** a token captured before logout remains usable for up to 8 hours. Acceptable for V1's single-operator scope; not acceptable under enterprise security review. Fixing it requires a revocation store — a V2 architectural change.

---

## 5. SENTRY_DSN / crash reporting

**Origin:** B.23, B.24-9.6 — CREDENTIAL BLOCKED.

**B.25 status: CREDENTIAL BLOCKED** (confirmed).

```
SENTRY_DSN in .env : UNSET
```

The **code is fully wired** — `integrationConnectors.cjs:1210` and `productionWiring2.cjs:604` both read `SENTRY_DSN` and report `READY / "SENTRY_DSN not set"` honestly. Only the value is missing.

`.env` was not modified, per standing instruction.

**This is the highest-priority pre-launch item.** It is not a code gap — it is a five-minute provisioning step, and without it production is blind to crashes.

---

## 6. IP allow/deny controls — PRIOR FINDING CORRECTED

**Origin:** B.24-01 — "**GENUINE GAP** — no surface located across routes, services or frontend."

**B.25 status: the original classification was WRONG. Reclassified as a fake-success defect — now FIXED (disclosure).**

The feature exists in full: `policyService.cjs` implements `isIpAllowed()`, a correct `requireIpAllowed` middleware, per-org storage, audit logging on denial, and a settable `ipAllowlist`. B.24's search missed it.

The truth is worse than a gap — proven end-to-end:

```
PUT /enterprise/policy/<org> {ipAllowlist:["203.0.113.9"]} -> 200
GET  policy                                                -> ["203.0.113.9"]  persisted
GET  /orgs/<org>/departments from 127.0.0.1 (not listed)   -> 200  NOT DENIED
requireIpAllowed mount sites                               -> ZERO
```

And the compliance dashboard **scored the inert control as passing**, inflating the org's compliance score.

**Fixed by disclosure** (see [B25-FINAL](B25-FINAL-OOPLIX-V1-REALITY-CERTIFICATION.md)): the check can never pass while unenforced, reports `enforced:false`, and `PUT` warns at configuration time. Locked by suite 98, negative-tested.

**The underlying enforcement gap remains — see [B25-REMAINING-GAPS.md](B25-REMAINING-GAPS.md).**

---

## 7. SSO / SCIM / MFA configuration

**Origin:** B.24-02, B.24-4.8/4.9/4.10 — NOT CONFIGURED.

**B.25 status: STILL OPEN — NOT CONFIGURED** (unchanged).

Endpoints are live and auth-guarded (`/security/sso`, `/security/scim`, `/security/mfa` all return `401` unauthenticated — correct). Each honestly reports its unconfigured state (`config:null`, `configured:false`, `enrolled:false`).

MFA enrollment is genuinely implemented (TOTP + hashed recovery codes, rate-limited) but no org requires it.

**Not a defect — an unprovisioned integration.** Blocks enterprise sale, not V1 operation.

---

## 8. Credential-blocked integrations

**B.25 status: CREDENTIAL BLOCKED** (unchanged).

| Integration | State |
|---|---|
| WhatsApp | real Meta API call, real permission error — BLOCKED BY PROVIDER |
| Email / SMS / Push | transport vars unset |
| Operator-tier integrations | `/integrations` → 403 (OS-4 parked) |
| Crash reporting | `SENTRY_DSN` unset |

All report their true state. **No connector fabricates success** — verified by suites 93 and 95.

---

## 9. AI provider credentials / quota

**Origin:** B.24-9.5 — Groq 429 + OpenAI 401.

**B.25 status: CREDENTIAL BLOCKED** — re-measured with a real authenticated session.

```
POST /ai/chat {prompt:"..."}  ->  502
{"error":"AI backend unavailable. Check provider API keys in your .env file."}
```

**This is the correct behaviour and a genuine strength.** The platform fails loudly and names the real cause rather than returning a fabricated completion. AI honesty scored 10/10.

---

## 10. Payment / Razorpay test credentials

**Origin:** B.24-9.4 — CREDENTIAL BLOCKED.

**B.25 status: CREDENTIAL BLOCKED** (unchanged).

```
RAZORPAY_KEY_ID     present
RAZORPAY_KEY_SECRET present
STRIPE_SECRET_KEY   absent
```

Keys exist but no test-mode environment is provisioned. **No real financial transaction was executed** — not authorized, per standing instruction.

---

## 11. NOT-MEASURED items from B.23 / B.24

| Item | B.24 | B.25 |
|---|---|---|
| Restore execution | NOT MEASURED | **NOW MEASURABLE (partial)** — 9 backups; latest archive **integrity VALID**, 18 entries, listable and uncorrupt. Full restore still not executed (destructive). |
| Backup availability | PRODUCTION READY | confirmed — 9 archives |
| Load / scale testing | NOT MEASURED | **STILL NOT MEASURED** — no load harness; no scalability claim made |
| Org deletion / archival | NOT MEASURED | **STILL NOT MEASURED** — destructive, not run |
| Member invitation flow | NOT MEASURED | **STILL NOT MEASURED** |
| Admin / Developer / Viewer roles | NOT MEASURED | **STILL NOT MEASURED** — no accounts with those roles exist |
| Automation status | NOT MEASURED | **STILL NOT MEASURED** in the enterprise surface |
| Role visibility in UI | NOT MEASURED | **STILL NOT MEASURED** |

**None of these were converted to a PASS.**

---

## 12. Operator access (OS-4 parked)

**B.25 status: OUT OF SCOPE for the audit track** — parked at OS-4.3 by explicit instruction.

Operator credentials were not guessed, enumerated, or forged. `/ops/*`, `/vault/*`, `/deployment/*`, `/integrations` correctly return `403` to the highest tenant role — a **verified privilege boundary**, and the 12 OS-4 UNKNOWNs remain UNKNOWN rather than being recorded as passes.
