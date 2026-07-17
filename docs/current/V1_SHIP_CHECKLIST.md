# V1_SHIP_CHECKLIST.md — Ooplix Public Release

**Date:** 2026-07-17

Concrete, actionable items in the order they should be completed. Each item states exactly what "done" means and how to verify it. No item here duplicates a decision already made in `V1_GO_NO_GO.md` — this is the execution list for the "GO, conditional on" items.

## Before web/server launch (required)

- [ ] **Provision Resend.** Sign up at resend.com, create an API key, set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in production `.env`. Verify: register a real test account and confirm the verification email arrives.
- [ ] **If WhatsApp is in scope:** fetch the real phone-number-id via Meta Graph API's `{WABA_ID}/phone_numbers` endpoint (the WABA ID is already correctly set as `WA_BUSINESS_ACCOUNT_ID`). Set the correct value as `WA_PHONE_ID`/`PHONE_NUMBER_ID`. Verify: `GET /integrations/{id}/status` for the WhatsApp connector reports `CONNECTED`, not `BROKEN`.
- [ ] **If paid plans are in scope:** create the Starter/Growth/Enterprise plans in the real Razorpay dashboard, set `RAZORPAY_PLAN_ID_STARTER`/`GROWTH`/`ENTERPRISE`. Verify: a real (or Razorpay test-mode) upgrade flow completes.
- [ ] **Deploy to a real host with a real domain**, not `localhost`. `BASE_URL` and `ALLOWED_ORIGINS` must point at the real production domain — Razorpay webhooks cannot reach `localhost`.
- [ ] **Confirm Docker or PM2-direct deployment actually runs on the target host.** This mission verified PM2-direct works locally; Docker was never provable in this sandboxed environment (B12) — test the actual deployment method on the actual target infrastructure before relying on it.
- [ ] **Set up real monitoring/alerting on the production host** for the items this mission could only test in a 5-minute window (B14): memory growth, crash/restart count, error rate, over the first real days of operation.

## Before desktop distribution (blocked — do not attempt until B17 is resolved)

- [ ] **Resolve the `node-pty` native-rebuild hang (B17).** Start with the documented next step in `V1_RELEASE_BLOCKERS.md`: bump the desktop build jobs' Node version from 20 to 22+ in `.github/workflows/release.yml`, push, and observe a real workflow run. This requires push access this mission does not have.
- [ ] **Acquire Apple Developer Program membership** (B10) — Team ID, a Developer ID Application certificate, and (for notarization) an app-specific password. Set `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` as GitHub repo secrets — the workflow already reads these correctly (confirmed via source read), they are simply unset (confirmed via `gh secret list` returning empty).
- [ ] **Acquire a Windows code-signing certificate** (B11) — from a CA or Microsoft Trusted Signing. Set `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` as GitHub repo secrets — same situation, workflow-ready, credential-absent.
- [ ] **Do not attempt to ship an unsigned desktop build to real users** — even once B17 is resolved, an unsigned DMG/EXE will trigger OS security warnings that will look like malware to a real user.

## Before public multi-tenant SaaS launch (architectural — not a short checklist item)

- [ ] **Design and implement database-enforced tenant isolation** (B2). This is a scoped engineering project, not a checklist item — it requires choosing a real database, a migration strategy from the current flat-JSON state store, and a tenant-isolation model (row-level security, per-tenant schema, or per-tenant database). Out of scope for this mission to design or estimate further.
- [ ] **Run real load tests at 250/500/1000 concurrent users** (B15) against a real staging deployment, using real distributed load-generation infrastructure (not a single local process).
- [ ] **Run a real multi-day stability soak test** (B14) on a real staging deployment with real monitoring.

## Verified already — no action needed

- [x] Core authentication, authorization, workspace isolation — live-tested, real 403s against a second identity.
- [x] SSRF vulnerability in ODI browser-automation routes — fixed and live-verified this mission (B1).
- [x] Rate limiting on the 4 highest-cost AI-bearing route files — fixed and live-verified this mission (B3, partial).
- [x] Path traversal in patch-generation services — fixed in a prior session, re-confirmed still in place this mission.
- [x] JWT tampering/expiry rejection, CORS enforcement, security headers, XSS, command injection, prototype pollution — all verified clean.
- [x] Backup and disaster-recovery restore — both run for real, both pass.
- [x] Deploy script syntax — all valid.
- [x] Electron process hardening (contextIsolation, nodeIntegration, sandboxing) — 22/22 smoke checks passing.
- [x] Regression suite — 144/144 passing, confirmed after every fix in this mission.
