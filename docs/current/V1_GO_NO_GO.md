# V1_GO_NO_GO.md — Ooplix Public Release Decision

**Date:** 2026-07-17
**Branch:** `security/reality-completion`

This document states only objective, verified blockers. No percentages. No assumptions. No marketing language. No feature requests.

---

## Decision, by distribution channel

### Web / server deployment (nginx + PM2 + Node backend)

**GO**, conditional on the following being true before real users are pointed at the deployment:

- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set (B5) — without these, account email verification and password reset do not function. Verified: these routes exist and are wired, they simply have no credential to send through.
- If WhatsApp automation is part of the launch feature set: `WA_PHONE_ID` is corrected to a real phone-number-id, not the currently-set Business Account ID (B6).
- If paid plan upgrades are part of the launch feature set: `RAZORPAY_PLAN_ID_STARTER`/`GROWTH`/`ENTERPRISE` are set (B7).

All other connectors (GitHub, Google, Slack, Discord, Stripe, Notion, Anthropic, Gemini, Cloudflare, AWS, Supabase) are verified to degrade honestly to "not configured" rather than failing silently or falsely reporting success — their absence does not block a launch, it only means those specific integrations are unavailable until credentials are added.

Verified working end-to-end this mission: signup, login, workspace creation, billing/trial status, AI-plan feature gating, AI chat request pipeline, mission creation and execution, connector status reporting.

### Desktop distribution (DMG / EXE / AppImage)

**NO-GO.**

- No installer has ever been successfully produced by the real release pipeline. Every recent CI run (`v1.0.0-rc5` through `v1.0.0-rc8`) has ended in `cancelled` or `failure` for all 3 desktop-build jobs.
- Root cause identified with reproducible, cross-environment evidence (B17, full detail in `V1_RELEASE_BLOCKERS.md`): `node-pty`'s native module rebuild hangs indefinitely during packaging, confirmed on macOS, Windows, and Linux CI runners and reproduced a fourth time on a local development machine.
- Independently, even if the build succeeded: Apple code signing (B10) and Windows code signing (B11) credentials are both completely absent from this repository and environment. An unsigned build would trigger OS-level security warnings on both platforms.

### Multi-tenant public SaaS (any channel, serving unrelated customers on shared infrastructure)

**NO-GO.**

- No database-enforced tenant isolation exists (B2). All application state — organizations, workspaces, missions, billing — lives in flat JSON files with no row- or schema-level isolation boundary. The application-layer isolation logic (org/workspace RBAC) is real and tested, but there is no independent backstop if that logic ever has a bug.
- Real production concurrency (250-1000 simultaneous users) has not been measured (B15). Verified: the application handles 10 and 100 concurrent connections cleanly with strong throughput and low latency. Behavior at public-SaaS scale is unverified, not disproven.
- True multi-day stability has not been measured (B14). Verified: a 5-minute live window showed no crashes, no unhandled promise rejections, and a memory pattern consistent with normal operation rather than a leak. A slow, multi-day leak cannot be ruled out by a 5-minute test.

---

## Blockers by fix status

| Status | Count | IDs |
|---|---|---|
| Fixed this mission | 2 | B1, B3 (partial) |
| Requires only a credential/config value (no code) | 5 | B5, B6, B7, B8, B16* |
| Requires external business/legal procurement | 2 | B10, B11 |
| Requires infrastructure this environment does not have | 5 | B12, B13, B14, B15, B17 |
| Architectural — explicitly out of scope for this mission | 1 | B2 |
| Real, evidenced, deliberately not fixed this pass (scope/risk tradeoff) | 3 | B4, B9, B16* |

*B16 counted twice: it needs a decision (resurrect vs. rebuild), not purely a credential.

## Zero fabricated or estimated blockers

Every blocker in this document is backed by one of: a live test run this session, a real `gh run view` log from an actual GitHub Actions run, a direct source-code citation, or a `.env`/credential presence check. No blocker was inferred, assumed, or extrapolated.
