# RELEASE_BLOCKERS.md — Ooplix V1 Public Release

**Date:** 2026-07-17
**Branch:** `security/reality-completion`
**Source:** Synthesized from `docs/current/production-risk-register.md`, `docs/current/v1-production-checklist.json`, `docs/current/launch-readiness.md`, `docs/current/phase6-security-verification.md`, `docs/current/production-credential-verification.md`, `docs/current/production-env-checklist.md`, `docs/current/phase4-6-connectors-electron.md`, `docs/current/phase3-deployment-rehearsal.md`, `docs/current/phase4-5-stability-load.md`. No new repository-wide audit was performed — this list re-verifies time-sensitive facts (Docker/nginx availability) and reclassifies existing, already-evidenced findings into the CODE / CONFIGURATION / CREDENTIAL / INFRASTRUCTURE / EXTERNAL taxonomy this document requires.

| ID | Blocker | Type | Severity | Owner | Evidence |
|---|---|---|---|---|---|
| B1 | SSRF via 3 ODI browser-automation routes (`/odi/interactions/analyze`, `/odi/editor/start`, `/odi/observer/cycle`) — no internal/private-IP validation on client-supplied `url` | CODE | P0 | **FIXABLE NOW** | `phase6-security-verification.md` §11 |
| B2 | No database-enforced tenant isolation — all state in flat `data/*.json` | CODE (architectural) | P0 for multi-tenant / not a blocker for single-operator or closed-beta | **NOT FIXABLE NOW** — architectural redesign, explicitly out of scope for this mission | `v1-production-checklist.json` B1 |
| B3 | Rate limiting covers 7 of 126 route files | CODE | P1 | **PARTIALLY FIXABLE NOW** — see Phase 2 | `phase2-route-audit.md` |
| B4 | No CSRF-token layer (mitigated by `sameSite:strict`, not eliminated) | CODE | P2 | **NOT FIXABLE NOW** — larger change than a targeted fix, real but bounded risk | `phase6-security-verification.md` §8 |
| B5 | `RESEND_API_KEY`/`RESEND_FROM_EMAIL` absent — email verification and password reset non-functional | CREDENTIAL | P0 for any real user signup flow | **NEEDS CREDENTIALS** | `production-env-checklist.md` |
| B6 | `WA_PHONE_ID` holds a WhatsApp Business Account ID, not a phone-number-id — WhatsApp connector reports BROKEN | CONFIGURATION | P2 (only blocks WhatsApp specifically) | **NEEDS CREDENTIALS** (operator must fetch the correct value from Meta's Graph API — not a code fix, not obtainable by this agent) | `production-credential-verification.md` |
| B7 | `RAZORPAY_PLAN_ID_STARTER/GROWTH/ENTERPRISE` absent — paid plan upgrades cannot complete | CREDENTIAL | P1 (blocks revenue, not signup/core use) | **NEEDS CREDENTIALS** | `production-env-checklist.md` |
| B8 | 11 connectors code-ready, no credential in `.env` (GitHub, Google secret, Slack, Discord, Stripe, Notion, Anthropic, Gemini, Cloudflare, AWS, Supabase) | CREDENTIAL | P2 each (app degrades honestly to "not configured") | **NEEDS CREDENTIALS** | `production-credential-verification.md` |
| B9 | No Stripe webhook route exists in the codebase | CODE | P2 (Stripe not required if Razorpay is the primary processor) | **NOT FIXABLE NOW without a credential to test against** — new route would be untestable without a real Stripe account regardless | `phase4-6-connectors-electron.md` |
| B10 | Apple code signing (Developer Program, Team ID, `.p8`/cert) entirely absent | CREDENTIAL / EXTERNAL | P0 for mac distribution / not a blocker for Linux or a non-signed internal build | **NEEDS EXTERNAL SERVICE** (Apple Developer Program membership — a paid, identity-verified external account this agent cannot create) | `production-credential-verification.md` |
| B11 | Windows code signing certificate entirely absent | CREDENTIAL / EXTERNAL | P0 for Windows distribution / not a blocker for Linux or a non-signed internal build | **NEEDS EXTERNAL SERVICE** (purchased code-signing cert from a CA or Microsoft Trusted Signing — external procurement) | `production-credential-verification.md` |
| B12 | Docker daemon not running in this environment — image build never proven by an actual run | INFRASTRUCTURE | P1 (Docker path is one of several deployment options; PM2-direct deployment is proven working) | **NEEDS INFRASTRUCTURE** (a machine with Docker Desktop/daemon actually running — outside this sandboxed session's control) | `phase3-deployment-rehearsal.md`, re-confirmed this session |
| B13 | nginx not installed in this environment — reverse-proxy config never syntax-checked with a real `nginx -t` | INFRASTRUCTURE | P2 (config is static-reviewed and structurally sound; only the live syntax check is unproven) | **NEEDS INFRASTRUCTURE** | `phase5-7-runtime-production.md`, re-confirmed this session |
| B14 | True 24-hour+ stability unverified (only a 5-minute window measured) | INFRASTRUCTURE | P1 | **NEEDS INFRASTRUCTURE** (a real staging host monitored over days — cannot be produced inside one sandboxed session) | `phase4-5-stability-load.md` |
| B15 | Real production concurrency (250/500/1000 users) unverified | INFRASTRUCTURE | P1 | **NEEDS INFRASTRUCTURE** (distributed load-generation infra against a real staging deployment) | `phase4-5-stability-load.md` |
| B16 | `/queue/status` deep metrics endpoint degraded (references an archived module not in the live tree) | CODE | P2 (narrow blast radius — `/scheduler/status` unaffected) | **NOT FIXABLE NOW** — reason for archival unknown; resurrecting unreviewed code is itself a risk | `v1-production-checklist.json` |
| B17 | Electron installer (DMG/EXE/AppImage) — `node-pty`'s native module rebuild hangs indefinitely during `electron-builder`'s packaging step, on all 3 platforms, both in real GitHub Actions CI and reproduced locally on this machine. No installer has ever been successfully produced by the real release pipeline. | INFRASTRUCTURE (confirmed external — see evidence below) | P0 | **NEEDS INFRASTRUCTURE / EXTERNAL INVESTIGATION** — reproducible on 2 independent environments (GitHub-hosted runners x3 platforms, and this local machine), ruling out a GitHub-runner-specific cause; the hang is in `node-gyp`'s native compile/link step for `node-pty` itself | Real `gh run view` logs from runs `29578115175` (rc7) and `29582661689` (rc8); local `npx electron-builder --mac`/`--linux` reproduction this session |

---

## Severity legend

- **P0:** blocks a core V1 user-facing capability outright (email verification, mac/win distribution) or is an exploitable security hole.
- **P1:** blocks a specific, real feature (paid upgrades, WhatsApp) or leaves a real gap in confidence (untested scale/duration) without blocking core usage.
- **P2:** narrow, optional-feature, or already-mitigated-to-an-acceptable-degree.

## Owner legend

- **FIXABLE NOW:** code-only, provably correct, low-risk, no new credentials or architecture required — will be addressed in Phase 2 of this mission.
- **NEEDS CREDENTIALS:** blocked purely on a real API key/certificate/account that this agent cannot obtain.
- **NEEDS EXTERNAL SERVICE:** blocked on a real-world business/legal/procurement step (a developer program membership, a purchased certificate) beyond a simple credential.
- **NEEDS INFRASTRUCTURE:** blocked on compute/runtime resources this sandboxed session does not have (a running Docker daemon, nginx binary, multi-day uptime, distributed load generators).
- **NOT FIXABLE NOW:** real, evidenced blocker, but out of this mission's explicit scope (architecture redesign) or requires a deliberate decision beyond a mechanical fix.

Phase 2 below addresses every **FIXABLE NOW** item. Phase 4 resolves B17. All other items remain exactly as classified — this mission does not attempt to manufacture credentials, infrastructure, or architecture changes it does not have.
