# 12 — Roadmap

**Status of this document:** Mixed and labeled per-item. **A note on methodology**: the requested template for this document was "P1–P40." This repository's actual history uses different phase-naming conventions per era (V4/V5 capability phases, POST-Ω sprints P1–P20, RC1–RC8 release candidates, and the current unnamed "reality completion" work) — inventing a uniform P1–P40 sequence that doesn't correspond to anything real would violate this documentation project's own core rule ("never invent implementation"). Instead, this document presents: (A) what has already shipped, drawn from real git/CHANGELOG history, and (B) what remains, drawn directly from the verified blocker and gap lists in prior documents — organized as a forward roadmap, numbered sequentially for planning purposes.

---

## A. What Has Already Shipped (VERIFIED, historical)

Per `CHANGELOG.md` and git tag history:

| Milestone | Date | What shipped |
|---|---|---|
| 3.0.0 — Public Beta | 2026-06-18 | First external release. Known limitations documented at the time: macOS arm64-only build, SQLite shadow-write disabled on arch mismatch, CRM JSON race-condition risk. |
| v1.0.0-rc1 — Production Freeze | 2026-07-02 | Version reset/rebrand from the 3.x line. Closed-beta ops (invite revocation, DAU/WAU/MAU tracking), org/workspace limits, billing downgrade path, payment-retry queue. 514/514 regression tests passing at the time. CONDITIONAL GO. |
| v1.0.0-rc2 | 2026-07-16 | 35 commits: billing usage metering, marketplace connector submission workflow, vault rotation staging, real tool-calling bridge for AI agents, CPU/latency fixes. |
| v1.0.0-rc3 – rc6 | 2026-07-17 | A rapid sequence fixing the **same underlying problem** (native module compilation for desktop builds) across macOS/Windows CI runners — typescript pin, lockfile resync, node-gyp version pin (twice). This problem (B17) remains unresolved as of rc6/rc7/rc8 — see below. |
| Security/Reality Completion pass | 2026-07-17 | The audit this entire documentation set is grounded in: 14 fake/broken frontend pages removed from nav, path-traversal vulnerability fixed, SSRF partially addressed, dead auth-guard code fixed across multiple modules, Company Factory and Creative Studio surfaced to navigation, connector registry rebuilt on the real 54-connector vault. |

Beyond the CHANGELOG, the project's own persistent memory system records a very long history of "Phase"/"Sprint"/"Level" feature work (V4/V5 capability phases, POST-Ω sprints P1 through P20, "Level 2" through "Level Ω" organizational subsystems, ODI design-intelligence versions, and more) — dozens of large feature efforts, each historically claimed at 100% test pass rates. **This documentation set does not re-verify each of those historical claims individually** — the 2026-07-17 reality audit is the most recent and most rigorous cross-cutting verification available, and it supersedes earlier self-reported completion claims wherever they conflict (see [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md)).

## B. Forward Roadmap — Numbered by Priority, Drawn From Verified Gaps

Each item below traces to a specific, cited gap in [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md), [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md), [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md), or [19_RISK_REGISTER.md](19_RISK_REGISTER.md). "Estimated effort" uses the same discipline the source audit used — concrete units of work, not invented time estimates, unless a real estimate exists in source material.

### P1 — Fix the SSRF Finding (R1 / B1)
**Purpose**: Close a real, live-confirmed vulnerability where an authenticated user can direct the server's browser to internal network addresses via 3 ODI routes.
**Dependencies**: None — self-contained.
**Current status**: A subsequent commit (`06e50b2`) on the `security/reality-completion` branch appears to address this; verify it closes the exact 3 routes cited (`/odi/interactions/analyze`, `/odi/editor/start`, `/odi/observer/cycle`) before considering it done.
**Priority**: P0 (highest).
**Estimated effort**: Small — one shared validation utility or 3-4 duplicated guard checks.

### P2 — Provision Email Delivery (R5 / B5)
**Purpose**: Make email verification and password reset functional — currently non-functional, blocking any real user signup flow.
**Dependencies**: A Resend account (or equivalent) — external, not code.
**Current status**: Route code is real and wired; only the credential is missing.
**Priority**: P0 for any launch beyond a fully-trusted internal team.
**Estimated effort**: Credential provisioning only, no code.

### P3 — Correct the WhatsApp Phone-Number ID (R6 / B6)
**Purpose**: Fix the WhatsApp connector's live 400 error.
**Dependencies**: Operator action — fetch the correct value from Meta's Graph API (`{WABA_ID}/phone_numbers`).
**Priority**: P2 (narrow blast radius, WhatsApp-only).
**Estimated effort**: One environment-variable value change.

### P4 — Provision Razorpay Subscription Plan IDs (R7 / B7)
**Purpose**: Enable paid plan upgrades to complete.
**Dependencies**: Razorpay dashboard configuration — external, not code.
**Priority**: P1 (blocks revenue).
**Estimated effort**: Credential/config provisioning only.

### P5 — Fix the Billing Cancellation Discrepancy
**Purpose**: `POST /billing/cancel`'s user-facing message claims access continues until period-end, but `checkAccess()` blocks immediately. Resolve in favor of one or the other.
**Dependencies**: None.
**Priority**: P2 — a real but narrow correctness bug found during this documentation effort (see [09_SAAS_MODEL.md](09_SAAS_MODEL.md)).
**Estimated effort**: Small — either add period-end deferral logic, or correct the message.

### P6 — Extend Rate-Limiting Coverage (R3 / B3)
**Purpose**: Close the gap where 119 of 126 route files have no per-account request throttle.
**Dependencies**: None — self-contained, but touches many files.
**Priority**: P1.
**Estimated effort**: Medium — apply `rateLimiter(...)` per-prefix in the route barrel for the expensive families (org-ladder, POST-Ω domains, coding-assistant, production-tooling routes), or introduce an API-gateway-level limit in front of the whole app.

### P7 — Resolve the Electron Desktop Build Blocker (B17)
**Purpose**: `node-pty`'s native module rebuild hangs indefinitely during `electron-builder` packaging on all 3 platforms, both in real CI and locally. No installer has ever been successfully produced.
**Dependencies**: External investigation — reproducible on 2 independent environment types, ruling out a GitHub-runner-specific cause. May require an upstream `node-pty`/`node-gyp` fix, a different native-module packaging strategy, or replacing `node-pty` with an alternative.
**Priority**: P0 for any desktop distribution.
**Estimated effort**: Unknown — this is the most technically uncertain item on this roadmap; treat as a dedicated investigation, not a quick fix.

### P8 — Acquire Code-Signing Credentials (B10, B11)
**Purpose**: Enable trusted, unsigned-warning-free desktop installers for macOS and Windows.
**Dependencies**: Apple Developer Program membership (paid, identity-verified) + Windows code-signing certificate (purchased from a CA or Microsoft Trusted Signing). External business steps, sequenced after P7 (no point signing a build that can't be produced).
**Priority**: P0 for mac/Windows distribution specifically; not a blocker for Linux or internal unsigned builds.
**Estimated effort**: External procurement — days to weeks depending on identity verification turnaround.

### P9 — Provision Remaining Connector Credentials (B8)
**Purpose**: Move GitHub, Google, Slack, Discord, Stripe, Notion, Anthropic, Gemini, Cloudflare, AWS, Supabase from WAITING FOR CREDS to live-CONNECTED.
**Dependencies**: Per-provider account/API-key acquisition — external, not code, prioritize by which the actual beta users need.
**Priority**: P2 each (the app degrades honestly to "not configured" — this is additive, not blocking).
**Estimated effort**: Credential provisioning only, no code changes required per the audit.

### P10 — Design and Build a Stripe Webhook Route
**Purpose**: `STRIPE_WEBHOOK_SECRET` is documented but no route exists — Stripe cannot function as a payment processor even with a key.
**Dependencies**: A decision on whether Stripe is actually needed (Razorpay is the primary, fully-working processor) and a real Stripe account to test against.
**Priority**: P2 — only relevant if international/non-India payment processing becomes a priority.
**Estimated effort**: Medium — new route + webhook signature verification, following the existing Razorpay pattern.

### P11 — Rebuild the 3 Disabled OS Namespaces (`/dev/*`, `/personal/*`, `/enterprise/*`)
**Purpose**: Make the DeveloperOS/PersonalOS/EnterpriseOS frontend tabs real rather than permanently hidden.
**Dependencies**: A product decision on whether these are still wanted — they were built once but never connected to a backend.
**Priority**: P2 — nothing currently depends on these being restored.
**Estimated effort**: Medium-large per namespace — real backend service logic plus route wiring, roughly comparable to the Company Factory surfacing effort.

### P12 — Database-Backed Tenant Isolation
**Purpose**: Close the single largest architectural gap — real, schema/row-level isolation for organizations/workspaces/billing, replacing flat JSON files as the source of truth.
**Dependencies**: A dedicated architecture project — explicitly out of scope for every incremental "fixes-only" mission this repository's audit history has run.
**Priority**: P0 for any multi-tenant SaaS launch at scale; not a blocker for single-operator or closed-beta use.
**Estimated effort**: Large — this is a genuine multi-week-or-more architecture effort (data-model design, migration path for 408 existing JSON stores, likely a real database engine choice, and re-verification of every route's authorization logic against the new boundary). See [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R2 and [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md) for why this is also the top blocker to the 17-company vision.

### P13 — Wire Real External Triggers/Actions Into the `*Org` Engine Family
**Purpose**: Make the "autonomous business operation" subsystems genuinely autonomous (real external triggers, real external actions) rather than self-referential scaffolding — or make a deliberate decision to stop describing them that way in customer-facing material.
**Dependencies**: Product decision first (which of the 14 duplicate `*Org` engines are worth investing in vs. consolidating/retiring), then real integration work per engine.
**Priority**: P2 (marketing/reputational risk today, mitigated by disclosure — see [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R9) — but P1 if any customer-facing claim of "autonomous business operation" is planned.
**Estimated effort**: Large and open-ended — 14 engines, each needing its own real integration surface.

### P14 — Extended Stability & Load Verification (R12, R13)
**Purpose**: Prove real 24-hour+ stability and real 250-1000 concurrent-user load — both explicitly unverifiable in the sandboxed audit environments used so far.
**Dependencies**: A real staging deployment monitored over days, plus distributed load-generation infrastructure.
**Priority**: P1 — genuinely unknown risk, not a known defect.
**Estimated effort**: Requires real infrastructure this repository's development environment has not had access to; not a code task.

---

*Next: [13_UI_UX_STRATEGY.md](13_UI_UX_STRATEGY.md) for the design system underpinning all of the above.*
