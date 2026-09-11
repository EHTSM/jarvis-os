# JARVIS/OOPLIX — BUSINESS ACTIVATION STATUS

**Date:** 2026-09-11

---

## CURRENT PRODUCT STATUS

Production (`api.ooplix.com`) is **actively crash-restart-looping** right now — confirmed
over a ~25-minute observation window with a consistent, repeating pattern: ~20-30 seconds
healthy (`/health` returns 200, `uptime_seconds` climbing normally), then ~10-15 seconds
of `502 Bad Gateway` / connection timeout, then the process comes back at `uptime_seconds`
near 0 and repeats. This directly contradicts the "production health PASS" fact stated in
this mission's brief — it is reported here as a live, current, ongoing P0, not a reopened
old finding. Nginx itself is healthy throughout (it correctly returns 502 when its
upstream is briefly gone); the Node backend process itself is what's cycling.

Separately: production is running **stale code**, confirmed independently of the crash
loop. `GET /p1/capabilities` and `GET /my-connectors` — both real, existing backend
routes — return the React SPA's `index.html` instead of their real JSON responses,
meaning nginx's catch-all is serving the frontend because the backend doesn't have these
routes registered. `backend/routes/myConnectors.js` was committed on **2026-09-01**, 28
commits behind the current `origin/main` tip — the deployed instance predates that commit
by an unknown but real margin. `backend/routes/capabilityCoverage.js` is from this
session's own work and was never expected to be live yet.

Production is also in **deliberate closed-beta mode**: self-registration returns
`403 {"error":"An invite code is required to join the closed beta."}` — confirmed
consistently, live, multiple times. This is an intentional business-state gate
(`betaReadiness.cjs`, 50-user hard cap), not a defect, but it is the actual current
first-customer entry point and must be accounted for in the customer journey.

---

## LIVE VERIFIED CAPABILITIES

Verified live against production during confirmed "up" windows (not source-inspection-only):

| Capability | Result |
|---|---|
| Frontend load (`app.ooplix.com`) | PASS — HTTP 200 continuously, unaffected by backend crash loop (served statically by nginx) |
| `/health` | PASS when up — real payload, `services:{ai,telegram,whatsapp,payments}` all `true` |
| Auth boundary (`/accounts/me` unauth) | PASS — 401 |
| Business/CRM routes (`/business/leads`, `/crm/leads` unauth) | PASS — 401, routes exist and are gated |
| Marketplace (`/marketplace` unauth) | PASS — 401, route exists and is gated |
| Payment webhook signature verification (`/webhook/razorpay`, bad signature) | PASS — 400 `{"error":"Invalid signature"}`, real HMAC check firing |
| Closed-beta invite gate (`/accounts/register`, no invite code) | PASS (working as designed) — 403, consistent across repeated attempts |
| `/p1/capabilities`, `/my-connectors` | **FAIL** — not reachable at all; SPA fallback served instead of the real route (stale deploy) |
| AI chat, tool execution, org-scoped usage ledger | **NOT RE-VERIFIED live on this production instance this session** — already proven end-to-end on a local instance of the current codebase in the prior ERA-1 session; could not be re-run against production because (a) self-registration is invite-gated and no invite code is available to this session, and (b) the crash loop makes any multi-step live sequence unreliable to attempt safely |

---

## CREDENTIAL/CONNECTOR MATRIX

Platform-level (global, founder-configured) connectors — status from production's own
`/health` payload, presence-only, no values exposed:

| CONNECTOR | CONFIGURED | LIVE VERIFIED | BLOCKER | PRIORITY |
|---|---|---|---|---|
| Groq (AI) | YES | YES (`services.ai:true`; model-fix from this session not yet deployed — see stale-deploy finding) | Needs redeploy of `main` to get the corrected model | P0 for reliable chat |
| WhatsApp Business | YES | YES (`services.whatsapp:true`) | None observed | P1 |
| Telegram | YES | YES (`services.telegram:true`) | None observed | P2 |
| Razorpay (payments) | YES | Webhook signature verification confirmed live; full payment-link creation not exercised (would create a real external side effect) | None observed for what was safely testable | P0 for monetization |
| Stripe | Unknown this session (deferred — per campaign scope, non-blocking, Razorpay is primary) | NOT VERIFIED | Intentionally deferred | P3 |
| SMTP/Email | Unknown this session | NOT VERIFIED | Not checked — out of this pass's scope | P2 |

Per-organization (customer-connected) connectors — via `/my-connectors` (currently
unreachable on production due to the stale-deploy finding above; the following is from
this session's earlier local-instance verification of the same code, not production):

| CONNECTOR | CONFIGURED (platform default) | LIVE VERIFIED (mechanism) | BLOCKER | PRIORITY |
|---|---|---|---|---|
| WhatsApp, Razorpay, Stripe, SMTP, Teams, Notion, Jira, Linear, Twitter/X, LinkedIn, Facebook, YouTube, TikTok, Instagram, Threads, Pinterest, Reddit, Discord, Google Business Profile (19 total) | N/A — customer-supplied, none pre-configured by design | Mechanism verified: correct 401 unauth, correct per-org `connected:false` reporting, no fake "connected" status, no secret-value leakage | Route currently unreachable on production (stale deploy) | P1 — this is the actual customer self-service connector UI; must be reachable for any customer to connect their own tools |

---

## CUSTOMER JOURNEY STATUS

```
signup/login → workspace → JARVIS → capability selection → execution → result → usage/billing → history/memory
```

| Step | Status |
|---|---|
| Signup | **BLOCKED for a genuinely new customer right now** — closed-beta invite code required, and this session has no operator credential to mint one on production (the exact fix applied this session — gating invite creation to operatorOnly — makes this correctly founder-controlled, but means only the founder can currently onboard a first customer) |
| Login | Not independently re-verified against production this session (would need an already-existing account) |
| Workspace | Code-level: real, auto-created on registration (verified locally, matches CLAUDE.md's org/workspace model) |
| JARVIS chat | Code-level: proven working end-to-end locally (prior session); production reliability currently undermined by the crash loop |
| Capability selection | `/p1/capabilities` currently unreachable on production (stale deploy) |
| Execution | Code-level: proven working locally (note/tool execution, real result, real audit trail) |
| Usage/billing | Code-level: real quota enforcement, real trial defaults, confirmed locally |
| History/memory | Not independently re-verified this session |

**Genuine current blocker for a first real customer:** even with a valid invite code, a
customer hitting the API during one of the ~10-15 second down windows (which recur every
~30-40 seconds) would see failures on login, chat, or any action — this is the dominant,
immediate blocker to a trustworthy first-customer experience.

---

## FRONTEND

`app.ooplix.com`'s public marketing page (verified live) clearly states what the product
is ("Ooplix is an AI Operating System... Not a chatbot. Not a CRM."), what it does
(WhatsApp follow-ups, payment collection, workflow execution), and how to start (7-day
free trial messaging, no credit card). This layer is fine for a first-time visitor
understanding the pitch. The actual in-app experience (post-login capability discovery,
workspace/settings/billing navigation) was **not independently re-verified in a browser
this session** — no browser-driven UI test was run; this is disclosed as a real scope gap
rather than assumed fine. Given the invite-gate and crash-loop findings above, no
in-app UX fixes were attempted this pass (nothing UX-shaped was found to be a
launch-blocker from what could be checked).

---

## SECURITY

Verified this session (launch-critical items only, no broad re-audit):

- **Payment webhook verification**: real HMAC-SHA256, live-confirmed rejecting a bad
  signature (400) on production.
- **Auth boundaries**: `/accounts/me`, `/business/leads`, `/crm/leads`, `/marketplace`
  all correctly return 401 unauthenticated, live-confirmed on production.
- **A real authorization gap found and fixed** (not previously known — discovered while
  tracing the actual first-customer signup path for this mission, not from a broad
  re-audit): `POST /co3/invites/create` and `/bulk`, and `GET /co3/invites`, had only
  `requireAuth`, not `operatorOnly` — any authenticated customer account could mint
  closed-beta invite codes or list every outstanding one, completely bypassing the
  invite gate and the 50-user beta cap. Reproduced live with a normal `role:"user"`
  account locally, fixed with the exact `operatorOnly` pattern this repo's sibling
  `closedBeta.js` already uses, re-verified live (create/list now 403, `validate`/`use`
  correctly still open to any customer for their own redemption). Committed
  (`7522badd`) and pushed to `main`. **Not yet deployed** — same stale-deploy gap as
  above; this fix has no effect until the VPS pulls current `main`.
- **Dangerous tool/action safeguards, secret handling**: not re-audited this pass beyond
  what the prior ERA-1 session already verified (secretVault AES-256-GCM/HKDF, no
  secrets in committed diffs) — no new evidence needed or gathered.

---

## AUTOMATION / WORKER

- **PM2**: cannot be inspected directly (no SSH — unchanged blocker from before). The
  crash-loop pattern observed externally is consistent with PM2's `uncaughtException`
  → deliberate `process.exit(1)` → `autorestart` cycle (a real, existing, documented
  pattern in `backend/server.js`), repeatedly hitting the same fault on every restart —
  but the exact fault cannot be identified without VPS log access.
- **Backup scheduler**: the 12h-RPO cron fix (`0 2,14 * * *`) is committed and merged
  into `main`, validated locally (real PM2 schedule acceptance + a real backup cycle
  completing under it) — per this mission's own stated facts, the founder has already
  activated it on the VPS directly. Not independently re-verified from this session
  (no SSH).
- **Mission/task execution, queues/workers**: not independently re-verified against
  production this pass — code-level correctness for these was already established in
  the prior ERA-1 session and not re-litigated here.

---

## BLOCKERS

1. **P0 — Production backend is actively crash-restart-looping right now.** Confirmed
   live over a ~25-minute window, ongoing, not resolved during this session. Root cause
   not diagnosable without VPS log access (no SSH). This alone makes any first-customer
   experience unreliable regardless of every other finding below.
2. **P0 — Production is running stale code**, confirmed independently of the crash loop
   (`/p1/capabilities`, `/my-connectors` unreachable; `myConnectors.js`'s commit is 28
   commits behind current `main`). Deploying current `main` would bring in this
   session's AI-model fix, the RPO backup-cron fix, the invite-authorization fix, and
   the Phase 1-6 capability-discovery work — none of which are live yet.
3. **P1 — No operator credential available to this session** to mint a real invite code,
   so the full authenticated customer journey could not be re-exercised against
   production itself this pass (it was already proven end-to-end against a local
   instance of the current code in the prior session).
4. **P1 (already fixed, not yet deployed)** — the `/co3/invites` authorization gap
   (§Security) is fixed in `main` but has no effect on production until deployed.

---

## FIXES COMPLETED

1. **`/co3/invites/create`, `/co3/invites/bulk`, `GET /co3/invites` now require
   `operatorOnly`**, not just `requireAuth` — closes a real closed-beta-gate bypass.
   Committed `7522badd`, pushed to `main`. Verified live locally (403 for a normal
   account, 200 for `validate`/`use` which correctly stay open to any customer).

No other blockers were safe to fix from this session without VPS access — the crash
loop and stale-deploy findings both require VPS-side action (log inspection, a real
deploy) that this session cannot perform.

---

## EXACT NEXT BUSINESS ACTION

**Founder must, in this order:**
1. SSH into the VPS directly (or grant this session working access) and run
   `pm2 logs jarvis-os --lines 200` to capture the actual crash reason — this is the
   single highest-priority action, since it blocks everything else.
2. Once the crash cause is identified and resolved, deploy current `origin/main`
   (`88e772a9`+ — includes commit `7522badd`, the invite-authorization fix) to the VPS,
   restart via `pm2 restart jarvis-os` (per this repo's own documented convention, never
   a bare `node backend/server.js`), and confirm `git rev-parse HEAD` on the VPS matches
   `origin/main`.
3. After a stable, current deploy is confirmed (`/health` returns 200 consistently over
   at least a 5-minute window, `/p1/capabilities` returns real JSON not the SPA shell),
   mint one real invite code via the now-correctly-gated `POST /co3/invites/create` (as
   the operator) and hand it to the first real customer.

---

## FINAL VERDICT

```
C) NOT READY
```

Not because of missing features or unverified capabilities in isolation — the
underlying product code (AI chat, tool execution, tenant isolation, billing, connector
framework) has been repeatedly proven sound in prior sessions and again referenced here.
The blocker is purely operational: **the live production instance is currently
unstable (active crash-restart loop, confirmed ongoing) and running code that is weeks
stale**, missing this session's own fixes including a real authorization gap that was
just closed but not yet deployed. Handing this to a first real customer *right now*
would mean intermittent failures roughly every 30-40 seconds. This is a "deploy and
stabilize," not a "build more," problem — the exact next action in §above is short and
concrete.
