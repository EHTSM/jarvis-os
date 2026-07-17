# V1_LAUNCH_SEQUENCE.md — Ooplix Public Release

**Date:** 2026-07-17

The ordered sequence of steps to actually launch, given the verified state of the repository as of this mission. Each step names its exact prerequisite from `V1_SHIP_CHECKLIST.md` and states what must be true before moving to the next step.

## Step 1 — Decide the launch channel

Per `V1_GO_NO_GO.md`: web/server deployment is GO (conditional); desktop distribution is NO-GO (blocked on B17 + B10 + B11); public multi-tenant SaaS is NO-GO (blocked on B2, architectural). **This sequence assumes a web/server, single-tenant-or-closed-beta launch** — the only channel with a real path to GO from this mission's findings.

## Step 2 — Provision required credentials

In order of what actually blocks core functionality:

1. `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — blocks email verification/password reset, which blocks real signup completion. Do this first; nothing else matters if users can't verify their accounts.
2. `WA_PHONE_ID` correction — only if WhatsApp is part of the initial feature set.
3. Razorpay plan IDs — only if paid upgrades are part of the initial feature set. A trial-only launch can skip this and add it later without a code change.

Verify each with the live test already established in this mission's `phase7-business-readiness.md` methodology: real signup → real login → hit the dependent feature → confirm real (not stubbed) behavior.

## Step 3 — Deploy to real infrastructure

1. Provision a real host with a real domain (not `localhost`).
2. Set `BASE_URL`, `ALLOWED_ORIGINS`, `NODE_ENV=production`, `JWT_SECRET`, `OPERATOR_PASSWORD_HASH` to real production values — this mission confirmed the current `.env` already has real, non-placeholder values for all of these, but re-verify on the actual target host, not this development environment.
3. Deploy via PM2-direct (the method this mission could actually verify works) or Docker (not provable in this sandboxed session — test on the real host before relying on it).
4. Confirm `/health` and `/api/status` return real 200s from the real deployed instance, not just from a local test server.

## Step 4 — Run the same validation this mission ran, against the real deployment

Every check in this mission's `phase7-business-readiness.md`, `phase6-security-verification.md`, and `phase4-5-stability-load.md` was run against a local instance. Re-run the same class of checks (signup/login/workspace/billing/AI/mission flows; JWT/CORS/rate-limit/header checks; a real load test) against the actual production deployment before announcing the launch. A local pass does not guarantee a production pass — different network path, different `.env` values, different real load.

## Step 5 — Launch to a closed/beta audience first

Given the unresolved items — no database-enforced tenant isolation (B2), unverified real concurrency (B15), unverified multi-day stability (B14) — launch to a small, known, closed-beta audience before any open/public signup. This is not a suggestion invented by this mission; it matches the repo's own existing `BETA_MAX_USERS` cap and closed-beta invite-code gate, both confirmed real and enforced server-side in prior sessions' audits.

## Step 6 — Monitor the items this mission could not fully verify

During the closed-beta window, specifically watch for:
- Memory growth over days (this mission only verified 5 minutes of stability).
- Behavior under real concurrent user load as the beta cohort grows (this mission only verified 10-100 concurrent synthetic connections).
- Any tenant-isolation-adjacent bug reports, given there is no database-level backstop (B2) — the application-layer RBAC is real and tested, but a bug here would not be caught by a lower layer.

## Step 7 — Desktop distribution (separate track, do not block the web launch on this)

Desktop distribution is a parallel, independently-blocked track (B17 build failure + B10/B11 missing signing credentials). It does not need to be resolved before a web/server launch, and should not be treated as a prerequisite for Step 1-6. Pick it up separately once:
1. The `node-pty` rebuild hang (B17) is resolved — start with the Node-version bump documented in `V1_RELEASE_BLOCKERS.md`.
2. Apple and Windows signing credentials are provisioned (B10, B11).

## What this sequence deliberately does not include

- Multi-tenant public SaaS launch steps — not sequenced here because it is NO-GO per `V1_GO_NO_GO.md`, blocked on an architectural item (B2) this mission does not scope or estimate.
- Any step that depends on infrastructure this mission could not access (a running Docker daemon, nginx, a multi-day monitored host, distributed load generators) — those are named as prerequisites in `V1_SHIP_CHECKLIST.md`, not sequenced as if they're already available.
