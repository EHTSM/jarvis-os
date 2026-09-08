# Mission 94 — Email Readiness Env-Name Drift Fix

**Type:** Focused, single-defect remediation. No `.env` file touched, no external provider contacted, no credential value read/printed/exposed, no deploy, no VPS action, no commit/push.

**Date:** 2026-09-08
**Branch:** `security/reality-completion`
**HEAD before and after:** `2376e500a2a7bb1e6a1be586981beb03bbfc0d92` (unchanged — no commit made)

---

## 1. Root Cause

`backend/services/launchReadiness.cjs`'s `email_service` readiness check (id: `email_service`) checked for the presence of `SENDGRID_KEY` and `RESEND_KEY`. These two names were used **nowhere else in the entire repository** — not in `emailService.cjs` (the actual email-sending implementation), not in `.env.example`, not in `envManager.cjs`'s canonical variable catalog, not in `integrationConnectors.cjs`'s connector registry, not in any of the 20+ docs/checklists (`CREDENTIAL_REGISTER`, `CONNECTOR_SETUP_GUIDE`, `PRODUCTION_GO_LIVE_CHECKLIST`, etc.) that reference the real email credential names.

`docs/audits/CREDENTIAL-CANONICAL-MAP.md` (line 107-108) explicitly lists `RESEND_API_KEY` and `SENDGRID_API_KEY` as the canonical keys for these two providers with an **"ALIASES FOUND: none"** column — confirming `SENDGRID_KEY`/`RESEND_KEY` were never an intentional alternate name, just a drift/typo introduced at some point in `launchReadiness.cjs` alone.

**Practical impact of the bug:** the Launch Readiness dashboard's "Email / Notification Service" check could report **email not configured** even when a real `SENDGRID_API_KEY` or `RESEND_API_KEY` was genuinely set and email was actually working — a false-negative on a go-live checklist item. It could not produce a false positive (there was no real-world scenario where `SENDGRID_KEY`/`RESEND_KEY` would ever be set, since nothing else in the app or its docs ever told an operator to set them).

## 2. Canonical Variable Names

Determined from repository-wide evidence (rule 3/4), not assumption:

- **`RESEND_API_KEY`** — canonical, first-priority provider per `emailService.cjs`'s own module docstring (`* 1. Resend — RESEND_API_KEY`) and `docs/audits/CREDENTIAL-CANONICAL-MAP.md`.
- **`SENDGRID_API_KEY`** — canonical, second-priority provider (`* 2. SendGrid — SENDGRID_API_KEY`), same source.
- `SMTP_HOST` — unrelated to this drift, already correct in both files, left unchanged.

**Repo-wide search performed (rule 4) before any change:**

| Name | Files referencing it (excl. this mission's own new report/test) |
|---|---|
| `SENDGRID_KEY` | **1** — `backend/services/launchReadiness.cjs` only |
| `RESEND_KEY` | **1** — `backend/services/launchReadiness.cjs` only |
| `SENDGRID_API_KEY` | 20 — `.env.example`, `emailService.cjs`, `integrationConnectors.cjs`, `envManager.cjs`, `secretVault.cjs`, `pcsCredentials.cjs`, `productionWiring.cjs`/`productionWiring2.cjs`, `pipReport.cjs`, `workspaceService.cjs`, docs/audits, reports |
| `RESEND_API_KEY` | 34 — same set plus `rc1.cjs`/`rc2.cjs`/`rc4.cjs`, `closedBeta.cjs`, `betaReadiness.cjs`, and 10+ top-level launch/checklist docs |

No backward-compatibility shim was added (rule 5): the evidence shows the old names had zero real-world usage anywhere — a shim would preserve a name nothing legitimately depends on.

## 3. Files Changed

**Production code (1 file, 2 lines changed):**
- `backend/services/launchReadiness.cjs` — the `email_service` check's condition and its `detail` message string now read `SENDGRID_API_KEY`/`RESEND_API_KEY` instead of `SENDGRID_KEY`/`RESEND_KEY`. `SMTP_HOST` untouched. No other line in the file was touched.

**Test (1 new file):**
- `tests/security/100-launch-readiness-email-canonical-env-names.cjs` — new, focused regression test (11 assertions). Calls the `email_service` check function directly (`CHECKS.find(c => c.id === "email_service").check()`), never `runChecks()`, so `data/launch-readiness.json` is never written by this test (rule 13) — verified by an explicit mtime-equality/non-creation assertion inside the test itself, which passed.

**Report (1 new file):** this file.

No other file was created, modified, or deleted.

## 4. Tests

```
node --test tests/security/100-launch-readiness-email-canonical-env-names.cjs
→ 11 passed, 0 failed
```
Covers: stale names fully removed from source; check fails closed with nothing set; `RESEND_API_KEY` alone → pass; `SENDGRID_API_KEY` alone → pass; `SMTP_HOST` alone still passes (no regression on the unrelated branch); the *old* `SENDGRID_KEY`/`RESEND_KEY` alone now correctly do **not** flip the check to pass (proves the drift is actually closed, not just cosmetically edited); `data/launch-readiness.json` mtime unchanged.

**Relevant existing email regression tests re-run (focused, not full corpus, per instruction):**

```
node --test tests/security/145-email-mailgun-brevo-real-send-url-shadowing-fix.cjs
→ 25 passed, 0 failed

node --test tests/security/61-team-invite-false-success-email-not-sent.cjs
→ 3 passed, 0 failed

node --test tests/security/144-email-verify-password-reset-false-success.cjs
→ 6 passed, 0 failed
```

All pass unchanged — confirms `emailService.cjs` and its dependents were not touched and did not regress. No broad corpus run was performed, per instruction.

## 5. Security Considerations

- No credential value was read, logged, or printed at any point in this mission — only variable-**name** strings were searched and compared.
- The fix does not change which providers are *usable* (that logic lives entirely in `emailService.cjs`, untouched) — it only corrects which env-var names a **readiness dashboard check** looks for, i.e., an observability/reporting correctness fix, not a security-boundary change.
- No new environment variable name was invented (rule 2); no new attack surface introduced.
- `ALLOW_DEV_AUTH_BYPASS`, `.env`, and all other credential/security-relevant files were not touched.

## 6. Production Impact

- **Before:** an operator with `RESEND_API_KEY` or `SENDGRID_API_KEY` genuinely set (and email genuinely working) would see the Launch Readiness dashboard's "Email / Notification Service" check show **FAIL**, a false-negative that could wrongly block or discourage a go-live decision, or cause an operator to "fix" a non-problem by setting a nonexistent-elsewhere `SENDGRID_KEY`.
- **After:** the check accurately reflects real email-provider configuration, matching `emailService.cjs`'s actual, documented provider-detection logic exactly.
- No behavioral change to actual email sending — `emailService.cjs` was not modified.
- No runtime data (`data/launch-readiness.json` or any other file under `data/`) was modified by this mission.
- `agentRuntimeSupervisor.cjs` (P1-1) was not touched — confirmed below.

## 7. Final Status

**FIXED — verified by new and existing regression tests, code-complete, not yet committed.**

---

## Final State Confirmation

```
git status --short
```
```
 M backend/services/launchReadiness.cjs
?? reports/MISSION-90-PHASE-3-ISOLATION-CERTIFICATION.md
?? reports/MISSION-91-PRODUCTION-DEPLOYMENT-GATE.md
?? reports/MISSION-92-FULL-TECHNICAL-TEST-CORPUS-CERTIFICATION.md
?? reports/MISSION-93-PRODUCTION-READINESS-REMEDIATION-GATE.md
?? reports/PRODUCTION-ENV-PRESENCE-INVENTORY.md
?? tests/security/100-launch-readiness-email-canonical-env-names.cjs
?? reports/MISSION-94-EMAIL-READINESS-ENV-DRIFT.md
```

```
git diff --stat
```
```
 backend/services/launchReadiness.cjs | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

**HEAD:** `2376e500a2a7bb1e6a1be586981beb03bbfc0d92` — unchanged (no commit made).

**P1-1 verification:**
```
git diff 7c229a52 HEAD -- backend/services/agentRuntimeSupervisor.cjs | grep -c "^@@"
→ 10
```
Unchanged from every prior mission's verification.

**Confirmation: `.env` was not read, modified, or created.** No credential/secret value was ever read, printed, or exposed anywhere in this mission's tool output or in this report — only variable **names** were searched and compared. No external network call was made to SendGrid, Resend, or any other provider. No deploy, VPS action, commit, or push occurred.

**Confirmation: no runtime data was modified.** `data/launch-readiness.json` (pre-existing, mtime 2026-08-13) was verified byte-for-mtime unchanged by the new test's own explicit assertion, which passed.

**STOP.**
