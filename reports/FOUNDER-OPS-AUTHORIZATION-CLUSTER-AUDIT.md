# FOUNDER / OPS AUTHORIZATION CLUSTER AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-20 · **Branch:** `security/reality-completion`

---

## Scope

The ~15-file MEDIUM-priority cluster of `requireAuth`-only founder/platform-internal tooling explicitly
deferred by the prior Endpoint Authorization Sweep (2026-08-16): `founderTwin.js`, `founderJournal.js`,
`founderIdentityOS.js`, `workforceOS.js`, `companyFactory.js`, `pcsCredentials.js`,
`pcs2ExternalPlatforms.js`, `productionWiring.js`, `productionWiring2.js`, `dop1.js`, `productionInfra.js`,
`co2FounderOps.js`, `betaReadiness.js`, `alphaProgram.js`, `phase22.js`.

## Method

For each file: identified every mounted route, checked the backing service for any orgId/accountId
concept, searched the frontend for a real consumer (and, where found, traced whether that consumer's own
tab/render path carries an operator role check), and — for every file classified as a genuine gap —
live-tested with a fresh, newly-registered ordinary (`role:"user"`) customer account against the real
running server. Per the mission's explicit instruction, did not assume "founder" in a filename implies
operator-only, and did not force `operatorOnly` onto anything with confirmed genuine customer usage.

## CLEAN — 2 files, correctly left untouched

**`founderTwin.js`** (`/twin/*`, POST-Ω P6 Digital Twin): `index.js`'s own outer gate is `requireAuth`
only, not `operatorOnly` — confirmed intentional, not an oversight. The Digital Twin tab
(`FounderTwinConsole.jsx`, `App.jsx`'s `"twin"` tab, alias text "my preferences decision style approve
like me") is genuinely per-account personal-preference/decision-history data, rendered with no role
condition in the main app shell — a real, live, customer-facing feature, not founder-only platform
tooling. Live-verified: `GET /twin/dashboard` returns 200 for an ordinary customer.

**`companyFactory.js`** (`/company-factory/*`, POST-Ω P8): already implements real, granular per-company
org-permission checks (`_requireCompanyOrgPermission()` using `organizationService.hasPermission()`
against `update_org`/`view_members`, `resolveContext()` for the dashboard's own-org scoping) — the
established, correct pattern already used elsewhere (`orgAiBrain.js`, `orgKnowledgeGraph.js`). Genuinely
customer-facing (`CompanyFactoryCenter.jsx`, `App.jsx`'s `"companies"` tab, no role gate needed since the
backend itself correctly scopes by org). Live-verified: `GET /company-factory/dashboard` returns 200 with
correctly own-org-scoped data (`totalCompanies: 0` for a fresh account with none).

## GENUINE AUTHORIZATION GAP — 13 files, fixed

All 13 share the identical shape already established and fixed for `founderAutomation.js`'s `/founder/*`
and `/bible/*` in the prior sweep: zero orgId/accountId concept in the backing service (grep-confirmed on
every one), platform-wide/singleton state (one founder, one platform), reachable by any signed-up customer
via a frontend tab with no role condition at its render point (mostly `ElectronWorkspace.jsx`'s
`operator-os/` directory of components — a naming convention, not a runtime enforcement boundary).

**Most severe — `founderIdentityOS.js` (`/fdios/*`)**: models a single, hardcoded `"founder:root"`
identity graph (real OAuth connections, `integrationConnectors.cjs`'s global connector status,
`process.env.FOUNDER_EMAIL`). Live-reproduced with a fresh ordinary customer account: `GET /fdios/identity`
returned the real founder's connected-provider graph (GitHub OAuth, Razorpay, Groq, Telegram, WhatsApp,
real connection status/timestamps); `GET /fdios/credential-intelligence` returned the real GitHub OAuth
**client ID**, credential expiry timing, and connector failure diagnostics. Fixed: `operatorOnly` added to
the file's existing `/fdios` mount gate.

**`founderJournal.js`** (`/fop/*`): single platform-wide daily journal (narrative, mood, frictions,
blockers). Reachable via `FounderJournal.jsx` inside `ElectronWorkspace.jsx`'s unguarded operator tab bar.
Fixed identically.

**`workforceOS.js`** (`/workforce-os/*`, surgical split, matching the `businessOrg.js`/
`autonomousKnowledgeOrg.js` precedent): real, mutable, platform-wide state (missions, team composition,
capacity assignments) with zero orgId. Live-reproduced: `POST /workforce-os/mission/run` reached the real
handler for an ordinary customer, rejected only on missing `title`, never on authorization. The **only**
confirmed real frontend consumer (`AgentRegistryCenter.jsx`) calls exactly one route,
`GET /workforce-os/agents` — every mutation (9 routes: `mission/run`, `reassign`, `teams/build`,
`teams/:id/replace`, `teams/:id/disband`, `capacity/rebalance`, `capacity/queue`, `capacity/assign`,
`capacity/complete`) has zero confirmed frontend usage even though `workforceOSApi.js` defines client
functions for them. Fixed: `operatorOnly` added to all 9 mutations; every read (including the confirmed-
used `/agents`, and the read/query `POST /agents/find`) deliberately left at `requireAuth` only.

**`pcsCredentials.js`** (`/credentials/*`) and **`pcs2ExternalPlatforms.js`** (`/ext/*`): env-var
credential manifests (key names, purposes, configured/unset status — no values). Live-reproduced:
`GET /credentials/env` returned the full real secret-key inventory for an ordinary customer. Reachable via
`CredentialDashboard.jsx`/`ExternalPlatformDashboard.jsx`, both inside the same unguarded operator tab
bar. Fixed at the barrel mount in `index.js`.

**`productionWiring.js`/`productionWiring2.js`** (`/wiring/*`, `/wiring2/*`): integration-wiring audit
tooling (AI/payments/email/OAuth/WhatsApp/browser status). Reachable via `ProductionWiring.jsx`/
`ProductionWiring2.jsx`. Fixed at the barrel mount.

**`dop1.js`** (`/dop/*`): infrastructure-validation reports (VPS/nginx/SSL/DNS/deploy/backup/monitor/
security/stress). Reachable via `DOP1Dashboard.jsx`. Fixed at the barrel mount.

**`productionInfra.js`** (`/ops/infra/*`): the file's **own header comment** already claimed "All routes
require auth (operator-only)" — but never actually called `operatorOnly` anywhere, a genuine
documentation/code mismatch confirmed by the prior sweep's own note. Fixed to match the file's stated
intent.

**`co2FounderOps.js`** (`/co2/*`): deploy config, AI-provider key status, billing, QA/bug tracking.
Reachable via `FounderOps.jsx` (same unguarded operator tab bar). Fixed at the barrel mount.

**`betaReadiness.js`** (`/beta/*`) and **`alphaProgram.js`** (`/alpha/*`): internal readiness-program
dashboards (onboarding funnel, support diagnostics, gate-check reports). Zero frontend consumer found
anywhere (confirmed via exhaustive grep — genuinely unused, not merely under-tested). Fixed at the barrel
mount regardless, since the backend gap is real independent of current frontend usage.

**`phase22.js`** (`/p22/secrets|security|deploy|alerts/*`, deprecated but still live): secret-rotation
status, JWT/CSP/security-header configuration checks, deploy-validation reports. Reachable via
`SystemHealthDashboard.jsx`'s `"systemhealth"` tab, no role gate. Fixed at the barrel mount.

## `founderIdentityOS.js` vs `founderAutomation.js` — explicit answer

Not intentionally different. Both model genuinely platform-internal, zero-orgId, founder-singleton data;
`founderAutomation.js` was already fixed to `operatorOnly` in the prior sweep for identical reasoning.
`founderIdentityOS.js`'s weaker `requireAuth`-only gate was simply the next item in the same already-
identified backlog, not a deliberate design choice — confirmed by the complete absence of any comment,
architecture note, or product distinction anywhere in either file that would explain a different intended
audience.

## Fixes

13 files. All reuse the exact `requireAuth, operatorOnly` mechanism already established and certified for
`founderAutomation.js` and the prior POST-Ω P13-P19/`autonomousEvolutionOrg.js` cluster — no new
authorization framework, no new middleware, no new concept.

## Live Verification

Registered a fresh, ordinary (`role:"user"`) customer account against the real running server, logged in
for a real session cookie, and confirmed all 13 previously-vulnerable route families now correctly return
403 (`GET /fdios/identity`, `/fop/journal`, `/wiring/report`, `/wiring2/report`, `/credentials/env`,
`/ext/report`, `/dop/report`, `/p22/security/report`, `/ops/infra/report`, `/co2/deploy`,
`/alpha/dashboard`, `/beta/dashboard`, and `POST /workforce-os/mission/run`), while the confirmed-
customer-facing `/twin/dashboard`, `/company-factory/dashboard`, and `/workforce-os/agents` all remain 200.
Server restarted once (route-registration changes require it); confirmed healthy immediately after, then
re-verified all fixes live against the restarted process.

## Limitations

`betaReadiness.js`'s and `alphaProgram.js`'s zero-frontend-consumer status means the fix, while correct
and matching the file's real authorization requirement, has no currently-observable UI regression risk to
verify against — confirmed via exhaustive grep rather than a frontend behavioral test.

## Regression

**Before:** 374/374. **After:** 379/379 (clean run; one transient flake on a pre-existing, unrelated
rate-limit test during the first pass under concurrent load, confirmed passing cleanly on isolated
re-run — same pattern observed throughout this program).
**New tests:** 5 (block 157) — 4 structural + 1 live, the live test independently registering and
logging in a fresh customer account against the real server and exercising all 13 fixes plus the 3
CLEAN-classification confirmations in one pass. **Negative-tested**: reverted `founderIdentityOS.js`'s
gate (representative of all 13, since every fix uses the identical mechanism verified by the same test
shape), confirmed the structural test failed for the exact expected reason, restored, confirmed the full
200-test block passed again. Production build: PASS. `tests/security/97-enterprise-isolation-
integrity.cjs`: 8/8 PASS. `.env` untouched. Server restarted once (required for route-registration
changes), confirmed healthy immediately after.

**No OS-track record altered.**
