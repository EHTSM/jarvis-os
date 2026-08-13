# OOPLIX REAL RECOVERY QUEUE
**Phase C.1 — ranked by runtime evidence**

Date: 2026-08-13
**Stop condition honoured: no OS development started. No merge. No push.**

---

## 1. QUICK RECOVERY — done or near-zero risk

### 1.1 ✅ Search alias coverage — COMPLETE (82/82)
All 82 `MORE_TABS` surfaces now carry search vocabulary (was 22/82). Three previously zero-coverage groups closed: AI & Agents 11/11, Intelligence 16/16, Org Levels 6/6.
Verified: exact-label search non-regressed (82/82), every surface reachable via its own alias, 16/16 founder-vocabulary probes resolve correctly.
Locked by [tests/security/90-phase-c1-search-alias-coverage.cjs](tests/security/90-phase-c1-search-alias-coverage.cjs) — 8/8 passing.

**Attribution note:** these aliases reached HEAD via commit `d779ff84` (Phase A.11), which landed *during* this session and captured the working tree. The alias strings are byte-identical to those written in Part 1. Recorded plainly because the deliverable is now committed and the diff attribution is ambiguous — the outcome is verified either way.

### 1.2 SPA catch-all returns 200 for missing API routes — **highest-value remaining quick fix**
```
GET /enterprise/orgs → 200 + SPA HTML   (route does not exist)
GET /dev/projects    → 200 + SPA HTML   (route does not exist)
```
A client cannot distinguish "missing" from "working" by status. This actively corrupted two measurements in this phase — it made orphaned components look plausible, and it produced a false cross-tenant leak signal.

**Fix:** return JSON 404 for unmatched paths under known API prefixes *before* the SPA fallback in [backend/server.js:101](backend/server.js#L101). Ordering change, ~5 lines. **Not applied — no build authorized.**

---

## 2. WIRING REQUIRED

**Nothing.** All 150 route files mounted, all 405 services referenced, navigation coverage 100%, search coverage 100%, zero broken frontend↔backend chains across 82 navigable surfaces.

This is the phase's most consequential negative result: **there is no hidden-but-working capability left to expose.** The C.0 recovery thesis is now closed.

---

## 3. CREDENTIAL PROVISIONING — largest single blocker

7 of 9 integration credentials unset. No code change can substitute.

| Credential | Status | Blocks |
|---|---|---|
| `SMTP_HOST` | MISSING | Email delivery (`/growth/email`) |
| `WHATSAPP_TOKEN` | MISSING | WhatsApp (`/growth/whatsapp`, `/whatsapp/*`) |
| `TELEGRAM_BOT_TOKEN` | MISSING | Telegram (`/telegram/*`) |
| `FIREBASE_PROJECT_ID` | MISSING | Push (`/push/*`) |
| `STRIPE_SECRET_KEY` | MISSING | Stripe billing |
| `ANTHROPIC_API_KEY` | MISSING | Claude provider |
| `GITHUB_TOKEN` | MISSING | Repo integrations |
| `SENTRY_DSN` | MISSING | **Production crash reporting is OFF** — `sentryService.cjs` is built, wired, correctly no-opping |
| `RAZORPAY_KEY` | SET | — |
| `OPENAI_API_KEY` | SET | — |

**Communication OS's 8.3% working rate is a credential problem, not a code problem.** Its code lives under `/growth/*` (Marketing OS, 66.7% working — the best-performing OS).

---

## 4. BUG FIX REQUIRED — 4 defects, all runtime-confirmed

### 4.1 `GET /launch/onboarding/all` → 500, 100% failure — **root cause identified**
[onboardingEngine.cjs:195](backend/services/onboardingEngine.cjs#L195) calls `s.steps.filter(...)` on every stored record. **All 4 records in `data/onboarding-state.json` are arrays keyed `0,1,2…`, not objects with `.steps`.** Reader expects a shape the writer never produced.
*Fix: guard with `Array.isArray(s.steps)` + repair or migrate the store. Small, but needs the store's intended shape confirmed first.*

### 4.2 `GET /computer/dashboard` → 500, reproducible
[computerController.js:35](backend/routes/computerController.js#L35) — optional chaining masks the missing controller, but something inside the resolved call throws. Needs a stack trace.

### 4.3 `GET /coding/smells` → 35 s, 1.4 MB payload
Scans the whole repo synchronously; no limit, pagination, or cache. Returns 200, so status-only monitoring will never flag it. Unusable from a UI and blocks a Node worker for 35 s.

### 4.4 `GET /collab/active` → 13.2 s (serial, uncontended)
Correct data, far outside interactive latency.

### 4.5 Platform-wide latency — **p50 1,098 ms**, p95 2,711 ms, 116 endpoints > 2 s
Not one bug; a systemic characteristic invisible to static analysis.

---

## 5. CLEANUP REQUIRED — ~10,400 LOC, no deletion authorized

| Action | Components | LOC |
|---|---:|---:|
| ARCHIVE — API-bound, backend never built (`EnterpriseOS`, `DeveloperOS`, `PersonalOS`) | 3 | 3,052 |
| ARCHIVE — static mockups, hardcoded arrays, zero network calls | 11 | ~3,100 |
| DELETE — superseded duplicates (6 × `WorkspaceSettings*` = 2,289 LOC) | 15 | ~4,200 |
| KEEP pending investigation — `EmergencyModeBanner.jsx` | 1 | 51 |

**Ongoing cost:** sweeping refactors edited Category-1 components on 2026-08-12 and 2026-08-13. The repo is paying a11y and lint tax on 3,052 lines that can never execute.

**Explicitly rejected:** building `/dev/*` or `/enterprise/orgs` to make these render. Forbidden by the brief, and unnecessary — `/engineering/*`, `/coding/*` and `/orgs/*` already serve those domains.

---

## 6. GENUINELY NEW DEVELOPMENT — smaller than expected

Only one backend capability gap of consequence:

**`/enterprise/orgs|depts|teams|roles|permissions|policies` CRUD.** Called by `EnterpriseOS.jsx`; does not exist.
**This should be a delete-vs-build decision, not an automatic build** — `/orgs/*` (34 endpoints, live, tenant-isolated) and `/org-*` already provide org/department/team/role management. The likely correct answer is **archive the component**, not build the API.

**No other genuinely missing capability was identified across the eight OSes.**

---

## Recommended sequence

| # | Action | Risk | Value |
|---|---|---|---|
| 1 | SPA catch-all → JSON 404 under API prefixes | Low | High — unblocks all future auditing |
| 2 | Provision `SENTRY_DSN` | None | High — production crash reporting is currently off |
| 3 | Fix `/launch/onboarding/all` (root cause known) | Low | Medium |
| 4 | Investigate `/computer/dashboard` 500 | Low | Medium |
| 5 | Paginate `/coding/smells` | Low | Medium |
| 6 | Decide archive-vs-build on the 3 OS components | None (decision) | High — removes a persistent false signal |
| 7 | Provision communication credentials | None | High — unblocks Communication OS |
| 8 | Investigate p50 1.1 s latency | Medium | High — affects every surface |

**Not started. Awaiting authorization.**
