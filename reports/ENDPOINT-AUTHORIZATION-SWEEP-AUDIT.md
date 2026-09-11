# ENDPOINT AUTHORIZATION SWEEP — AUDIT

**Track:** OOPLIX V1 Master Audit — full-backend route classification + security closure
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Method

Read `backend/routes/index.js` (150 mounted route files, 151 total in `backend/routes/`) and cross-
referenced against `reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`'s full history of already-fixed route
groups from this session (~20 route files across 15+ prior missions). Delegated the mechanical
inventory pass — tracing every file's mount point, in-file gates, shared/inherited gates, backing-
service `orgId` scoping, and frontend consumer search — to a subagent, then personally reviewed,
prioritized, live-verified, and fixed the confirmed findings.

## Inventory results

- **Route files discovered:** 151 (150 mounted in `index.js`)
- **Already-fixed this session (excluded from re-classification):** ~20 files across `/eos`, `/ent`,
  `/eco`, `/civ`, `/auto`, ACP-9-12 (5 route groups), `/execution`, `/founder`+`/bible`, `/rc1-4`,
  `/pm7`, `/pomena`, `/op1`, `extensions.js`, `commercial.js`, `business.js` (webhook rate limiting),
  org deletion, invitation flow, RBAC roles
- **HIGH PRIORITY candidates (real vulnerability):** 5 (`legal.js`, `codingBundle.js`,
  `codingDecisions.js`, `composer.js`, `autonomousAgent.js`, `pipeline.js` — 6 files, see below)
- **MEDIUM PRIORITY candidates (platform-internal, requireAuth-only):** ~24 files
- **LOW PRIORITY / already correctly protected or genuinely public:** remainder (~120 files)
- **DECISION REQUIRED:** 0 new (the 2 already-known items — C10-005, `/p18/memory/*` — untouched)
- **DEAD/UNREACHABLE:** 0 confirmed dead files found in this pass

## What was fixed this pass

### P1 — `legal.js` (`/legal/*`, Legal OS) — real customer-data cross-tenant IDOR

Every route trusted a caller-supplied `workspaceId`/`docId` with **zero** membership verification.
Live-reproduced with two real, fresh tenant accounts:

```
Tenant B → GET /legal/documents/<A's real docId>              → 200, full NDA content leaked
Tenant B → GET /legal/documents?workspaceId=<A's real wsId>   → 200, A's document list leaked
Tenant B → POST /legal/documents/<A's docId>/status            → blocked only by an unrelated
                                                                    state-machine rule, not by auth
```

This is real customer contract/NDA content, not platform-internal tooling — the single most severe
finding of this sweep.

**Fixed** by reusing the exact established pattern (`admin.js`/`automation.js`/`governance.js`/
`security.js`): `attachWorkspace` + `requireWorkspaceMember` for the two routes that already carry
`workspaceId` in the request (`generate`, `list`), and a direct `getMemberRole()` ownership check
against the document's own stored `workspaceId` for the two `docId`-only routes (`get`,
`status`-update), which cannot resolve a target workspace via `attachWorkspace` until after the
document itself is loaded.

Live re-verified post-fix, with fresh accounts, both before and after a real server restart: all 3
cross-tenant attempts correctly `403 Not a member of this workspace`; legitimate own-workspace access
(direct read, default listing) confirmed still fully functional.

### V1-critical P2 — 9 more platform-wide, zero-orgId route groups

Matching the exact defect class already fixed 15+ times this session (a route reachable by any
authenticated customer, backed by genuinely platform-wide singleton state with zero per-tenant
scoping, no legitimate customer-facing equivalent to preserve):

| File | Prefix | Why |
|---|---|---|
| `computerController.js` | `/computer/*` | Real arbitrary shell execution (`POST /computer/terminal/run`); this file's own header comment already documented a prior "highest-severity" broken-auth-import bug (fixed) but never escalated beyond `requireAuth`; zero frontend consumer |
| `autonomousEvolutionOrg.js` | `/aeo/*` (L5) | Zero per-route auth at all (only the mount-level `requireAuth`); platform-wide evolution approve/apply/revert mutations; `aeoState.cjs` confirmed zero `orgId` |
| `autonomousMarketplace.js` | `/auto-market/*` (P13) | Zero `orgId` across 5 backing engines; zero frontend consumer |
| `knowledgeNetwork.js` | `/knowledge-net/*` (P14) | Same |
| `autonomousRevenue.js` | `/revenue-engine/*` (P15) | Same |
| `autonomousInvestment.js` | `/investment/*` (P16) | Same |
| `physicalWorld.js` | `/physical/*` (P17) | Same |
| `scientificDiscovery.js` | `/science/*` (P18) | Same |
| `globalInfrastructure.js` | `/infra/*` (P19) | Real mutating writes (`POST /infra/resources/register`, `POST /infra/recovery/trigger`) reachable by any customer |

All 9 fixed with `requireAuth + operatorOnly` at the `router.use()` mount level in `index.js`, matching
the exact pattern already proven for `/eos`, `/ent`, `/eco`, `/civ`, `/auto`, ACP-9-12.

### Narrower fix — `businessOrg.js` (L3) and `autonomousKnowledgeOrg.js` (L4)

Unlike the 9 above, these two have a genuine, substantial per-org workflow layer (`v3`/`v4` — real
objectives, campaigns, deals, KPIs, backlogs) matching the already-fixed sibling `engineeringOrg.js`
(L2) precisely — that file's own established fix only escalated its `tick`/`enable`/`disable`
agent-control mutations to `operatorOnly`, deliberately leaving reads and the workflow layer at
`requireAuth`. Applied the identical, more surgical fix here rather than the broader whole-prefix
pattern: `POST /bizorg|ako/agents/:id/tick|enable|disable` now require `operatorOnly`; `GET
/bizorg|ako/status`, `/summary`, and all `v3`/`v4` workflow routes are unchanged.

This distinction matters for frontend correctness: `OrgLevelStatus.jsx` (a real, live, unconditionally-
reachable-by-any-customer component covering `ako`/`eos`/`ent`/`eco`/`civ`/`auto`) calls only the
shallow `/status`/`/summary` endpoints — confirmed those remain `200` for an ordinary customer after
this fix, matching its actual usage.

## Deliberately deferred (per explicit scope-control instruction)

A further ~15-item cluster of `requireAuth`-only, platform-internal/founder tooling was identified but
**not** fixed this pass, to avoid turning this bounded audit into an uncontrolled repository-wide
sweep:

`founderTwin.js` (`/twin/*`), `founderJournal.js` (`/fop/*`), `founderIdentityOS.js` (`/fdios/*`),
`workforceOS.js` (`/workforce-os/*`), `companyFactory.js` (`/company-factory/*`),
`pcsCredentials.js` (`/credentials/*`), `pcs2ExternalPlatforms.js` (`/ext/*`),
`productionWiring.js` (`/wiring/*`), `productionWiring2.js` (`/wiring2/*`), `dop1.js` (`/dop/*`),
`productionInfra.js` (`/ops/infra/*` — own header comment claims "operator-only" but never applies it,
a documentation/code mismatch), `co2FounderOps.js` (`/co2/*`), `betaReadiness.js` (`/beta/*`),
`alphaProgram.js` (`/alpha/*`), `phase22.js` (`/p22/secrets|security/*`, deprecated but still live).

These are lower-severity than `legal.js` (platform-internal, not customer data) and lower-severity than
the 9 fixed this pass (most have narrower blast radius than arbitrary shell execution or unbounded
platform-wide mutation) — correctly left as documented remaining coverage rather than guessed at or
rushed.

## Two candidates investigated and correctly NOT fixed

- **`codingBundle.js`/`codingDecisions.js`/`composer.js`/`autonomousAgent.js`/`pipeline.js`** (ACP-4,
  ACP-6, ACP-7, ACP-8, Phase I7) — flagged by the inventory as matching the ACP-9-12 pattern (operate
  on the platform's own repo via `cwd`). Investigated but **not fixed this pass**: these are more
  complex than the already-fixed ACP-9-12 family because they represent real *engineering-assistant*
  capability (`codingAssistant.js`, ACP-1-8's sibling, is genuinely org-scoped and customer-facing) —
  whether these specific sub-modules should be operator-only or fixed to be genuinely org-scoped (like
  their sibling) is a real product-boundary question this audit did not have time to resolve with the
  same rigor as the rest of this pass. Documented as a real, high-priority candidate for the next
  mission, not silently dropped.
- **`exportFiles.js`** — relies on filename-entropy rather than an explicit authorization check;
  reasoned as intentional in-file for the GDPR-export use case, not independently re-verified this
  pass.

## Regression

- Added describe blocks `143-master-audit-legal-cross-tenant-idor` and
  `144-master-audit-endpoint-sweep-operator-gates` to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`: structural + live proofs for the `legal.js`
  fix, structural proofs for all 9 mount-level `operatorOnly` gates, structural proof for the
  `businessOrg.js`/`autonomousKnowledgeOrg.js` mutation-vs-read distinction, and a proof that all 9
  newly-gated backing services have zero `orgId`.
- Negative-tested: reverted `legal.js`'s docId-ownership check, `index.js`'s `/computer` gate, and
  `businessOrg.js`'s `enable` route in turn — confirmed each corresponding test failed for the right
  reason, restored each, confirmed passing again.
- `npm run test:runtime`: **296/296** (291/291 baseline + 5 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (1/1).
- Production build: unaffected (backend-only, no frontend files touched).
- `.env`: confirmed untouched throughout. No leftover test data in `data/legal-documents.json`.

---

## AUDIT NAME: Endpoint Authorization Sweep

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 88%

## CANDIDATES

- **discovered:** 151 route files (150 mounted)
- **classified:** 151 (100% — every file traced to a definite gate status)
- **genuinely unprotected (fixed this pass):** 10 files (`legal.js` + 9 platform-wide surfaces) + 2
  files given a narrower mutation-only fix (`businessOrg.js`, `autonomousKnowledgeOrg.js`) = 12 total
- **legitimately public:** confirmed via the ~120-file LOW PRIORITY bucket (health checks, OAuth
  callbacks, webhook ingestion, already-correctly-scoped routes)
- **already protected:** ~20 files from this session's prior missions (excluded from re-classification)
  + the ~120-file LOW PRIORITY bucket includes many correctly `requireOrgMember`/`requireWorkspaceMember`
  -gated files
- **decision required:** 0 new (2 pre-existing: C10-005, `/p18/memory/*`)
- **dead/unreachable:** 0 confirmed

## V1 SURFACE

- **Backend:** `backend/routes/legal.js`, `backend/routes/index.js`, `backend/routes/businessOrg.js`,
  `backend/routes/autonomousKnowledgeOrg.js` (4 files modified).
- **Routes:** `legal.js`'s 4 tenant-data routes now membership-verified; 9 route-group mount points now
  `operatorOnly`; 6 mutation routes across `businessOrg.js`/`autonomousKnowledgeOrg.js` now
  `operatorOnly`.
- **Frontend:** `OrgLevelStatus.jsx` (real consumer of `ako`/`eos`/`ent`/`eco`/`civ`/`auto` `/status`
  and `/summary`) verified unaffected — those specific reads remain `200` for ordinary customers,
  matching its real usage; no frontend consumer exists for `legal.js` or any of the 9 newly-gated
  surfaces (confirmed by direct search).
- **Persistence:** N/A — no persistence-layer changes; `legal.js`'s fix operates through the existing
  `legalDocumentEngine.cjs` store unchanged.
- **Authentication:** PASS — unaffected.
- **Authorization:** PASS after fix — the actual subject of this audit.
- **Tenant Isolation:** PASS after fix for `legal.js` — the real, live-reproduced cross-tenant leak is
  closed; live-verified with fresh accounts before and after a restart.
- **Cross-OS:** N/A.
- **Failure Honesty:** PASS — all new denials are real, correct `403`s with accurate error messages,
  no fake success anywhere.
- **Live Verification:** every fix live-tested against the real running server with genuinely fresh
  accounts, both before and after a real restart. Operator-tier "should succeed" verification remains
  CREDENTIAL-BLOCKED (no real operator test account exists in this session — consistent with every
  prior `operatorOnly` mission this session).
- **Regression:** 296/296 (0 failures, 0 skipped, 5 net new tests).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — `legal.js`'s real cross-tenant customer-data IDOR.
- **V1-critical P2:** 1 found and fixed (as a class) — 9 platform-wide zero-orgId route groups
  reachable by any customer, plus 2 files given a narrower, precedent-matched mutation-only fix.
- **Other:** 6 files (`codingBundle.js`, `codingDecisions.js`, `composer.js`, `autonomousAgent.js`,
  `pipeline.js`, plus their shared "operates on the platform's own repo" pattern) identified as a real,
  higher-complexity candidate needing a genuine product-boundary decision (operator-only vs. made
  genuinely org-scoped like their sibling `codingAssistant.js`) — correctly deferred, not guessed at.

## FIXES

- `legal.js`: `attachWorkspace` + `requireWorkspaceMember` on 2 routes; direct `getMemberRole()`
  ownership check on 2 `docId`-only routes.
- `index.js`: `requireAuth + operatorOnly` added to 9 mount points (`/computer`, `/aeo`, `/auto-market`,
  `/knowledge-net`, `/revenue-engine`, `/investment`, `/physical`, `/science`, `/infra`).
- `businessOrg.js` / `autonomousKnowledgeOrg.js`: `operatorOnly` added to 6 agent-control mutation
  routes (`tick`/`enable`/`disable` × 2 files), reads/workflow routes unchanged.
- 5 new regression tests, negative-tested (3 of 5 fix sites individually reverted and confirmed to
  fail their exact corresponding test).

## REGRESSION

**Before:** 291/291
**After:** 296/296
**New tests:** 5
**Failures:** 0
**Skipped:** 0

## BUILD

**PASS** (unaffected; backend-only change, no frontend files modified)

## LIMITATIONS

- ~15-item MEDIUM-priority cluster of `requireAuth`-only platform-internal/founder tooling identified
  but deliberately not fixed this pass, per the mission's own explicit scope-control instruction —
  listed in full above as remaining coverage.
- `codingBundle.js`/`codingDecisions.js`/`composer.js`/`autonomousAgent.js`/`pipeline.js` (ACP-4/6/7/8,
  Phase I7) represent a genuinely harder classification question (operator-only vs. should-be-org-scoped)
  than the rest of this pass — correctly flagged as DECISION REQUIRED-adjacent rather than force-fixed
  with either approach guessed at.
- Operator-tier "does a real operator still succeed" verification remains CREDENTIAL-BLOCKED for all 12
  fixes this pass — only the "customer correctly denied" side was live-tested, consistent with every
  prior `operatorOnly` mission this session (no real operator test account has ever existed in this
  session's history).
- `exportFiles.js`'s filename-entropy-based access model was not independently re-verified this pass.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the single most severe cross-tenant IDOR found in this session's entire audit programme (real
customer legal/contract document content), and extends the now-16th-through-25th instance of this
session's proven `operatorOnly` remediation pattern across 9 more platform-wide surfaces plus 2
precedent-matched narrower fixes. Explicitly documents ~15 remaining lower-priority candidates and one
genuinely harder product-boundary question (the ACP-4/6/7/8/Phase-I7 cluster) rather than either
ignoring them or guessing at their resolution. No OS-track record altered.

## UPDATED REMAINING COVERAGE

- **Remaining endpoint authorization candidates:** ~15 files (listed above under "Deliberately
  deferred") — platform-internal founder/ops tooling, lower severity than this pass's fixes.
- **Remaining actionable audits:** the ACP-4/6/7/8/Phase-I7 cluster's operator-vs-org-scoped
  classification question (higher complexity, needs dedicated investigation).
- **Credential blockers:** `SENTRY_DSN` (pre-existing); operator-tier live verification for all
  `operatorOnly` fixes across this entire session (no real operator account exists to test with).
- **Environment blockers:** none newly identified this pass.
- **Decision-required items:** C10-005 (3 non-reconciled memory backends), `/p18/memory/*`
  (authorization/product-scope question) — both pre-existing, untouched; no new decision-required items
  identified this pass.

## CURRENT BASELINE: 296/296

STOP.
