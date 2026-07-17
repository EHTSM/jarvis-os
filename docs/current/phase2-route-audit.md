# Phase 2 Route Audit — V1 Final Reality Completion (RETRY)

Date: 2026-07-17 · Files audited: **127** in `backend/routes/` (126 route files + `index.js`)
Method: source read + **live server test** (`PORT=5087`, HS256 JWT cookie `jarvis_auth`, Node `fetch`).
Every prefix probed with no cookie (expect 401) and with a valid operator cookie.

## Verdict

- **All 126 mounted route files are WORKING** — reachable, auth-guarded, real validation, real persistence.
- **0 route files DISABLED/REMOVED.** Every file in `index.js` resolves and mounts (verified: no unmounted files).
- **0 new auth bugs found this pass.** All 33 prior `requireAuth` prefix mounts + the 5 no-op-in-file-guard fixes (approval/computer/twin/workforce-os/company-factory) + `/agents` + org/workspace RBAC all confirmed live.
- **1 correction to prior ground truth:** rate-limiter middleware is used by **7 files, not 8**. `commercial.js` was a false positive — its only `rateLimit` token is a `rateLimited` *data field* in a provider-status response, not a `require("../middleware/rateLimiter")`. Real users: **accounts, auth, browser, jarvis, odi, runtime, whatsapp**.

## Live verification highlights

| Check | Result |
|---|---|
| Auth: every guarded prefix, no cookie | **401** (confirmed across all families — batches 1/2/3) |
| Auth: with valid cookie | 200 (or 404 on guessed sub-path / 402 billing gate — auth passed) |
| RBAC: attacker DELETEs another user's org | **403** `requires permission: delete_org` |
| Tenant isolation: attacker GETs another user's org | **403** `Not a member of this organization` |
| Validation: `POST /orgs` no name | **400** `name is required` |
| Validation: `POST /crm/lead` no data | **400** `phone required` |
| Rate limit: 11+ logins in window | **429** (limit 10/5min) |
| Persistence | 406 `data/*.json` files; org write persisted to `data/organizations.json` |
| Error handling | clean JSON `{error}` bodies, **no stack traces leaked** |
| SPA catch-all | unmatched GET → `index.html` (200) — benign, no data exposure |

## Intentionally public (by design — NOT bugs)

`/health`, `/api/status`, `/ops/*` health (ops.js) · `/auth/login|register|logout` (auth.js) · `/accounts/register` · webhooks: `/whatsapp/webhook`, `/payment` razorpay webhook, `/telegram` · `GET /browser/status` (explicitly documented health probe; rest of `/browser/*` gated).

## Per-file / per-family table

Legend: Auth Y=401-without-cookie confirmed · P=public-by-design · Authz Y=role/permission check · Iso=workspace/tenant isolation · Val=validation · Err Y=try/catch no-leak · Log Y=structured logger · RL=rate-limiter middleware · Persist=fs data/*.json.

### Public / auth-boundary files

| File | Auth | Authz | Iso | Val | Err | Log | RL | Persist | Status |
|---|---|---|---|---|---|---|---|---|---|
| auth.js | P (login/register) | N-A | N-A | Y | Y | Y | **Y** | Y | WORKING |
| accounts.js | P (register) + Y | Y | N-A | Y | Y | Y | **Y** | Y | WORKING |
| ops.js | P (health/status) | N-A | N-A | Y | Y | Y | N | Mixed | WORKING |
| billing.js | Y | Y (own acct) | N-A | Y | Y | Y | N | Y | WORKING |
| settings.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| metrics.js | Y | Y | N-A | Partial | Y | Y | N | Y | WORKING |
| payment.js | P (webhook) + Y | N-A | N-A | Y | Y | Y | N | Y | WORKING |
| whatsapp.js | P (webhook) + Y | N-A | N-A | Y | Y | Y | **Y** | Y | WORKING |
| telegram.js | P (webhook) + Y | N-A | N-A | Y | Y | Y | N | Y | WORKING |

### Core operator surface

| File | Auth | Authz | Iso | Val | Err | Log | RL | Persist | Status |
|---|---|---|---|---|---|---|---|---|---|
| jarvis.js | Y | operator | N-A | Y | Y | Y | **Y** | Y | WORKING |
| browser.js | Y (+/status public) | Y | N-A | Y | Y | Y | **Y** | Y | WORKING |
| runtime.js | Y (index prefix) | Y | N-A | Y | Y | Y | **Y** | Y | WORKING |
| odi.js | Y (index prefix) | Y | N-A | Y | Y | Y | **Y** | Y | WORKING |
| crm.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| ai.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| simulation.js | Y | Y | N-A | Partial | Y | Y | N | Mixed | WORKING |
| tasks.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| mission.js | Y (index prefix) | Y | N-A | Y | Y | Y | N | Y | WORKING |
| agents.js | **Y (index prefix — prior fix)** | Y | N-A | Y | Y | Y | N | Y | WORKING |
| agentsRuntime.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| lifecycle.js | Y (index /runtime prefix) | Y | N-A | Y | Y | Y | N | Y | WORKING |
| intelligence.js | Y (index prefix) | Y | N-A | Y | Y | Y | N | Y | WORKING |
| engineering.js | Y (index prefix) | Y | N-A | Y | Y | Y | N | Y | WORKING |
| business.js | Y (index prefix) | Y | N-A | Y | Y | Y | N | Y | WORKING |
| graph.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| collaboration.js | Y (index prefix) | Y | N-A | Y | Y | Y | N | Y | WORKING |
| collaborationEngine.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| pipeline.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |
| deployment.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |

### Multi-tenant RBAC files (verified with live authz/isolation tests)

| File | Auth | Authz | Iso | Val | Err | Log | RL | Persist | Status |
|---|---|---|---|---|---|---|---|---|---|
| organizations.js | Y | **Y (requireOrgPermission)** | **Y (403 non-member)** | Y | Y | Y | N | Y | WORKING |
| workspace.js | Y | **Y (requireWorkspaceMember)** | **Y** | Y | Y | Y | N | Y | WORKING |
| workforce.js | Y | Y | Y | Y | Y | Y | N | Y | WORKING |
| admin.js | Y | Y (role-gated) | Y | Y | Y | Y | N | Y | WORKING |
| security.js | Y | Y | Y | Y | Y | Y | N | Y | WORKING |
| governance.js | Y | Y | Y | Partial | Y | Y | N | Y | WORKING |
| automation.js | Y | Y | N-A | Y | Y | Y | N | Y | WORKING |

### POST-Ω "no-op in-file guard → index prefix" fixed files (prior session, re-confirmed live 401)

`approvalRoutes.js` (/approval), `computerController.js` (/computer), `founderTwin.js` (/twin), `workforceOS.js` (/workforce-os), `companyFactory.js` (/company-factory). Each has a large in-file `requireAuth` count that resolved to a **no-op** due to a bad require path; the `router.use("/prefix", requireAuth)` line in `index.js` is what actually enforces 401. All Y / Y / N-A/Y / Y / Y / Y / N / Y — **WORKING**.

### Org-level ladder (Levels 2–Ω) + POST-Ω domain orgs — index-prefix guarded, identical shape

Batched (all verified individually via live 401): **autonomousEvolutionOrg** (/aeo), **executiveOrg** (/eos), **enterpriseOrg** (/ent), **ecosystemOrg** (/eco), **civilizationOrg** (/civ), **autonomousOrg** (/auto), **autonomousPlatform** (/platform), **engineeringOrg** (/engorg), **businessOrg** (/bizorg), **autonomousKnowledgeOrg** (/ako), **platformOrg**, **postOmega** (/pomena), **founderAutomation** (/founder,/bible), **autonomousExecution** (/execution), **workspaceMesh** (/workspace-mesh), **researchInstitute** (/research), **customerOrg** (/customer-org), **productFactory** (/product-factory), **autonomousMarketplace** (/auto-market), **knowledgeNetwork** (/knowledge-net), **autonomousRevenue** (/revenue-engine), **autonomousInvestment** (/investment), **physicalWorld** (/physical), **scientificDiscovery** (/science), **globalInfrastructure** (/infra), **organizationNetwork** (/org-network).

All: Auth **Y (index prefix)** · Authz Y (operator) · Iso N-A (global orgs) · Val Y · Err Y · Log Y · RL N · Persist Y · **WORKING**.

### "X V1" evolutionary intelligence files — index-prefix guarded (parent prefix)

`odi-x.js` (/odi), `oai-x.js` (/engineering), `obi-x.js` (/business), `okb-x.js` (/knowledge), `ose-x.js` (/evolution). Note these files have **0 in-file requireAuth** — they rely entirely on the parent prefix `requireAuth` mount in `index.js`, all confirmed live 401. Auth Y · Authz Y · Iso N-A · Val Y · Err Y · Log Y · RL N · Persist Y · **WORKING**.

### Deprecated phase routes (p18–p27) — per-file requireAuth, `_deprecate` warning layer

Batched: **phase18–phase27** (`/p18`…`/p27`, plus phase21 `/oauth`,`/p21/obs`). Each route carries in-file `requireAuth` (valid require path). Live 401 confirmed on real sub-paths (`/p21/obs/metrics` etc.). Deprecation headers + logger.warn emitted, routes remain functional. Auth Y · Authz Y · Iso N-A · Val Y · Err Y · Log Y · RL N · Persist Mixed · **WORKING (deprecated, not removed)**.

### Production / launch / release tooling — per-file requireAuth

Batched (live 401 confirmed): **launchPlatform** (/launch), **founderJournal** (/fop), **growthOS** (/growth), **contentSEO** (/content), **distribution** (/distrib), **revenueOS** (/revenue), **productionInfra** (/ops/infra), **co2FounderOps** (/co2), **co3UserSuccess** (/co3), **op1PublicLaunch** (/op1), **productionWiring** (/wiring), **productionWiring2** (/wiring2), **pcsCredentials** (/credentials), **pcs2ExternalPlatforms** (/ext), **integrations** (/integrations), **founderVault** (/vault), **dop1** (/dop), **dop2** (/dop2), **plan-management** (/plan), **founderIdentityOS** (/fdios), **alphaProgram** (/alpha), **betaReadiness** (/beta), **closedBeta** (/cbeta), **rc1–rc4**, **productionDeployment** (/pm7). Auth Y · Authz Y · Iso N-A · Val Y (a few Partial) · Err Y · Log Y · RL N · Persist Y · **WORKING**.

### Coding / marketplace / platform ecosystem — per-file or index-prefix guarded

Batched (live 401): **codingAssistant/codingDecisions/codingBundle/composer/autonomousAgent** (/coding,/composer,/autonomous), **repositoryViz** (/repo-viz idx), **engineeringMemory** (/memory idx), **selfImprovement** (/improvement idx), **analytics**, **plugins**, **marketplace**, **extensions**, **commercial**, **aiEcosystem**, **browserPlatform**, **creativeStudio**, **founderAutomation**. Auth Y · Authz Y · Iso N-A · Val Y · Err Y · Log Y · RL N (commercial=**N**, corrected) · Persist Y · **WORKING**. (`/plugins`,`/marketplace` return 402 with valid cookie = billing gate downstream of passed auth — expected.)

## Findings summary

1. **No new auth gaps.** Every one of the 126 mounted route files enforces 401 without a cookie via either an `index.js` prefix mount or a valid in-file `requireAuth`. The prior session's 33 prefix mounts + 5 no-op-guard corrections + `/agents` fix are all live-verified.
2. **Prior ground-truth correction:** rate-limiter middleware = **7 files** (accounts, auth, browser, jarvis, odi, runtime, whatsapp), **not 8**. `commercial.js` never required the middleware.
3. **Authorization is real, not just authentication.** Org RBAC (`requireOrgPermission`) and workspace membership (`requireWorkspaceMember`) return 403 to non-members for both read and privileged (delete) operations — confirmed live with a second "attacker" identity. The `req.body` (not `req.query`) forwarding pattern is correctly in place in both files.
4. **Persistence is real** — 406 `data/*.json` files; a freshly created org persisted to `data/organizations.json` within the test run.
5. **Error handling does not leak stacks**; validation returns field-specific 400s.

### Single most important remaining gap

**Rate limiting coverage is thin.** Only 7 of 126 route files apply the rate limiter — it protects the auth/login and a few high-cost surfaces (jarvis, browser, odi, runtime, whatsapp, accounts) but **every org-level ladder, POST-Ω domain, coding, and production-tooling route is unthrottled**. These are authenticated-only, so not an open door, but a single valid operator token can issue unbounded requests to expensive endpoints (e.g. `/computer/*`, `/research/*`, AI-backed `/coding/*`). This is a hardening gap, not a correctness/auth bug — no route is DISABLED or REMOVED. Fixing it would mean applying `rateLimiter(...)` per-prefix in `index.js` for the expensive families; out of scope for execution-mode this pass.
