# Ooplix Changelog

## [1.0.0-rc7] — 2026-07-17 — Release Candidate 7

Fixes the release CI pipeline (continued): v1.0.0-rc6's desktop builds got
further than any previous attempt — no more lockfile or node-gyp-version
errors — but "Install dependencies" then hung for 5+ hours on all three
platforms simultaneously with no failure, timeout, or output. Log evidence
(macOS run) shows the last line printed was `preparing moduleName=node-pty
arch=arm64` from `@electron/rebuild`, then silence — `better-sqlite3`'s
rebuild in the same step completed in under a second just before it, so
the stall is specific to node-pty's rebuild-for-Electron-ABI step, most
likely an unbounded network fetch inside node-gyp (no verified root cause
found; this is a known gap in node-gyp's own HTTP client, not something
introduced by this repo's changes). Retried once identically — same hang,
same step, confirming it's reproducible, not a one-off blip.

Did not attempt to patch node-gyp's fetch behavior itself (out of scope,
unverified root cause). Instead added `timeout-minutes: 30` to the desktop
job and `timeout-minutes: 15` to its "Install dependencies" step, so a
future hang fails within a bounded window instead of silently consuming
hours, and can be retried automatically/promptly. v1.0.0-rc6 is left in
place as a record of this attempt.

## [1.0.0-rc6] — 2026-07-17 — Release Candidate 6

Fixes the release CI pipeline (continued): v1.0.0-rc5's node-gyp@^10.3.1 pin
got past the macOS distutils failure but Windows still failed — node-gyp's
`find-visualstudio.js` maps VS major-version numbers to release years
(15→2017, 16→2019, 17→2022), and windows-latest now ships VS "18" (2026),
which node-gyp@10.3.1 doesn't recognize ("unknown version 'undefined'").
Confirmed via bisection that VS2026 (major 18) support was added between
node-gyp 12.0.0 and 12.4.0. Bumped the `overrides` pin to `^12.4.0`.
v1.0.0-rc5 is left in place as a record of this attempt.

## [1.0.0-rc5] — 2026-07-17 — Release Candidate 5

Fixes the release CI pipeline (continued): v1.0.0-rc4 got "Package Server
Release" and the Linux desktop build passing, but macOS and Windows desktop
builds both failed compiling native modules (`better-sqlite3`, `node-pty`)
— neither has a prebuilt binary for the exact Node patch version
(`20.20.2`) GitHub's runners use, so npm falls back to compiling from
source via the old `node-gyp@9.4.1` pulled in transitively by
`@electron/rebuild`/`electron-rebuild`. That fails on macOS (Python 3.14
removed the `distutils` module `node-gyp@9.4.1` still imports) and on
Windows (it doesn't recognize the VS 2026 toolchain). Added an `overrides`
entry pinning `node-gyp` to `^10.3.1` everywhere it's pulled in, which
supports both. v1.0.0-rc4 is left in place as a record of this attempt.

## [1.0.0-rc4] — 2026-07-17 — Release Candidate 4

Fixes the release CI pipeline (continued): v1.0.0-rc3 fixed the frontend
lockfile drift, and "Build Frontend" passed for the first time — but all
three "Build Desktop" matrix jobs and "Package Server Release" then failed
on the same *class* of bug at the root `package-lock.json`: `electron-rebuild`
(and its transitive deps) was declared in `devDependencies` but never
present in the lockfile. Regenerated `package-lock.json` to resync it, which
in turn exposed a second, previously-masked issue — `postinstall` ran
`electron-builder install-app-deps` unconditionally, which fails when
`--omit=dev` (used by "Package Server Release") correctly excludes
electron-builder. Added `|| exit 0` so prod-only installs degrade
gracefully. v1.0.0-rc3 is left in place as a record of this attempt.

## [1.0.0-rc3] — 2026-07-17 — Release Candidate 3

Fixes the release CI pipeline: v1.0.0-rc2's tag push triggered the Release
workflow successfully (confirming the tag-glob fix), but the "Install
frontend deps" job failed — `frontend/package-lock.json` had drifted out of
sync (`typescript` was unpinned and had resolved to an incompatible major,
producing an invalid `yaml` dependency graph underneath it). Pinned
`typescript` to `^4.9.5` and regenerated the lockfile; verified a clean
`npm ci` + `npm run build:frontend` both succeed. v1.0.0-rc2 is left in
place as a record of the broken attempt — no working release was ever
published under it.

## [1.0.0-rc2] — 2026-07-16 — Release Candidate 2

35 commits since rc1: billing usage metering + plan quotas, marketplace connector
submission/review workflow, vault rotation-candidate staging, connector OAuth/data
fixes, benchmark/dedup fixes, real tool-calling bridge for AI agents, and CPU/latency
fixes (duplicate memory scan, unguarded local AI provider fallback). See commit log
between `v1.0.0-rc1` and `v1.0.0-rc2` for the full list.

## [1.0.0-rc1] — 2026-07-02 — Release Candidate 1

### RC-1 — Production Freeze

This is the first Release Candidate eligible for real-world deployment.
All critical and high-priority blockers resolved. Code surface frozen.

### What's New Since 3.0.0

**Closed Beta Operations (Production Mission 6 Extended)**
- Invite revocation: `POST /cbeta/invites/:code/revoke`
- First AI workflow tracking: 8 workflow types, per-account completion history
- Org deletion safeguards: member count + open mission gate before `deleteOrg()`
- DAU/WAU/MAU aggregation: 14-day daily breakdown, activity-type breakdown
- Per-connector usage tracking: calls, errors, latency, unique users
- Org limit (max 5 per account) + Workspace limit (max 10 per account)
- Multi-user beta scenario simulation: 25 users / 5 orgs / 50 projects / 100 workflows
- Billing downgrade path with plan hierarchy validation
- Payment failure + 3-attempt retry queue (1h / 24h / 72h)
- Invoices, credits, coupons (% and fixed discount)
- Unified ops dashboard composing 8 service sections
- End-of-day summary: DAU, platform health, AI workflows, connectors, billing
- Launch readiness report: top-20 issues, top-10 risks, top-10 pain points, confidence score

**Version Management (RC-1 Freeze)**
- Version frozen to `1.0.0-rc1` (package.json + data/version.json)
- Immutable version manifest: API surface, route count, env schema, Electron build spec
- Compatibility report: breaking changes, non-breaking additions, data preservation status
- Backup manifest: 16 critical data files tracked for RC-1
- SHA-256 checksums for all dist artifacts
- Release metadata JSON + latest-mac.yml for auto-update

**Environment Schema (RC-1)**
- Added: RESEND_API_KEY, RESEND_FROM_EMAIL — email verification + password reset
- Added: BETA_MAX_USERS — configurable beta user cap (default 50)
- Added: RAZORPAY_PLAN_ID_STARTER, RAZORPAY_PLAN_ID_GROWTH, RAZORPAY_PLAN_ID_ENTERPRISE
- Added: TELEGRAM_OPERATOR_CHAT_ID — crash alerts and EOD summaries

**Backup Coverage (RC-1)**
- safe-backup.cjs now includes all M6/M6b state files
- Vault index included in every backup

### Go/No-Go: CONDITIONAL GO
- Code surface frozen and verified
- 514/514 regression tests passing
- 2 FOUNDER_ACTION items remaining: rebuild DMG artifacts with new version

---



## [3.0.0] — 2026-06-18 — Public Beta

### First External Release

Ooplix is an AI-powered operating system for solo founders and small teams. This is the first version shipped to external beta users.

### What's Included

**Core Platform**
- AI runtime with task queue, agent registry, and self-healing loop
- Mission Control — create, track, and complete engineering goals end-to-end
- CRM — lead pipeline with WhatsApp and Telegram follow-up automation
- Billing integration — Razorpay payment links, webhooks, trial management

**Developer Workspace (Electron)**
- CodeMirror 6 editor with syntax highlighting for 20+ languages
- File Explorer with create/rename/delete via right-click context menu
- Integrated terminal (PTY)
- Visual Git — stage, commit, branch, diff, and rollback with mission tracking
- AI Pair Programming — explain, refactor, generate, review with right-click

**Engineering Pipeline (I7/I8)**
- Autonomous 11-stage engineering pipeline (goal → patch → build → test → review → commit)
- Autonomous deployment with health verification and auto-rollback
- 5 quality gates with operator approval workflow

**Business OS (B1–B5)**
- Entity model: Contacts, Companies, Deals, Tasks, Interactions
- 5 automation templates (lead nurture, deal pipeline, follow-up sequences)
- 11 intelligence rules with confidence scoring
- External integrations: WhatsApp, Telegram, Razorpay, email, calendar, webhooks

**Multi-Agent Collaboration (I4–I6)**
- 10 specialized agents (planner, reviewer, verifier, strategist, etc.)
- Handoff chains, parallel execution groups, approval gates
- Real-time collaboration dashboard

**Knowledge Graph (Q1–Q2)**
- 15 node types, 18 relation types
- Graph reasoning: impact simulation, dependency analysis, recommendations

### Known Limitations (Beta)

- macOS arm64 build only (Apple Silicon). Intel Mac and Windows builds available but untested externally.
- `better-sqlite3` shadow-write silently disabled on architecture mismatch — JSON queue remains authoritative.
- CRM uses JSON file storage — concurrent webhook traffic may cause race conditions under high load.
- Payment webhook HMAC requires `rawBody` middleware; falls back to re-serialized JSON if absent.

### Reporting Issues

Use the **Beta Checklist** tab → "Send Feedback" button, or email: altamashjauhar@gmail.com

---

## [2.x] — Internal Releases

See git log for internal development history.
