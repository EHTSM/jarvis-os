# ORG DELETION LIFECYCLE — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after B23-03/GG-1/SENTRY_DSN
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior finding:** B.24/B.25 (`reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`) — "org deletion" listed
among 11 `NOT MEASURED` items, never live-tested end-to-end.

---

## Why this item

Reconciled the register: B23-03, GG-1, SENTRY_DSN, and B23-04 (JWT revocation, confirmed stale) are
all correctly closed/blocked, per the prior mission's own instruction. Of the remaining `NOT
MEASURED` items (load test, restore drill, invitation flow, org deletion, 3 roles, automation),
org deletion is the only one genuinely actionable via real HTTP requests against the running server
without requiring infrastructure this pass can't safely provide (a load-test harness, a real backup
restore drill) or credentials. It is also directly V1-production-relevant: a founder or org admin
needs org deletion to work correctly and safely.

## Discovery

`backend/routes/organizations.js` already implements a real, well-designed 3-tier deletion model:
`DELETE /orgs/:orgId` (soft-delete/archive, restorable), `POST /orgs/:orgId/restore`, and
`POST /orgs/:orgId/purge` (irreversible, requires the org already archived AND a `{confirm: slug}`
body as an explicit extra safeguard). `purgeOrg()`'s own code comment already honestly discloses that
underlying CRM/mission records are not cascade-deleted, only orphaned under the freed `orgId`.

## Live end-to-end test (real data, not empty-vs-empty)

1. Created a real test org, added a real lead (`DELETION-TEST-SECRET-LEAD`).
2. **Authorization**: an unrelated account (Org B) correctly denied `403` on `DELETE /orgs/:orgId`.
3. Archived the org (`200`, real `cascade` counts returned).
4. **Found the defect**: the archived org's owner could still freely **read AND write** real tenant
   data (`GET`/`POST /business/leads` both succeeded, `200`) — "archive" had no actual access effect,
   only hiding the org from `listOrgs()`'s default (non-`includeArchived`) view.
5. Restored the org — confirmed access genuinely restored.
6. Re-archived, attempted purge with a wrong confirmation token — correctly rejected (`400`).
7. Purged with the correct slug — succeeded, honestly reported `orphaned: {crmRecords: N}`.
8. **Confirmed the orphaned data is NOT actually exposed**: after purge, both the org record itself
   and any attempt to access its data via `X-Org-Id` correctly `404` — `attachOrg` requires a real,
   resolvable org record before granting any access, and there is none after purge. The orphaned CRM
   rows remain as inert JSON with a dangling `orgId`, unreachable through the normal tenant-scoped API
   surface. `_id()`'s timestamp+monotonic-sequence scheme makes ID reuse (a freed `orgId` being
   reassigned to a new org) effectively impossible to reproduce in practice.

## Fix — the archived-but-writable defect

Added an archived-org check to `requireOrgMember` (`backend/middleware/orgMiddleware.cjs`) — the
shared gate used by `business.js`'s `_requireOrg` and every other tenant-*data* route across the
codebase (19 route files). An archived org is now correctly treated as not-found (`404`, matching
this codebase's established "don't distinguish exists-but-forbidden from doesn't-exist" convention)
for ordinary tenant-data access.

**Regression found and fixed within this same pass**: the first version of this fix broke
`GET /orgs/:orgId` (the org's own detail/metadata route), since it also composes `requireOrgMember`.
This is a real, distinct concern from tenant-*data* access — a member legitimately needs to view
their own archived org's metadata (including its slug) to complete the restore/purge workflow itself;
without this, a user would have no practical way to retrieve the confirmation token `purge` requires.
**Fixed**: added a narrower `_requireOrgMemberIncludingArchived` check used only by
`GET /orgs/:orgId`, omitting the archived-org block; every other route composing `requireOrgMember`
is unaffected. `requireOrgPermission` (used by `archive`/`restore`/`purge` themselves) was
deliberately left untouched — both `restore()` and `purge()` require the org to already be archived,
so gating that function would break them entirely.

## Live re-verification of the corrected fix

Full lifecycle re-run end-to-end: archive → tenant data access `404` → org metadata still viewable
(`200`, real slug) → unrelated org still `403`'d on the metadata route too → purge using the
metadata-retrieved slug → succeeds → org and its data both `404` afterward. Re-confirmed on a fresh
server process after a real restart.

## Regression

- Added 3 tests (describe block `119-master-audit-org-deletion-lifecycle`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. 2 of the 3 negative-tested (reverted,
  confirmed each failed with the expected message, restored); the third (a static assertion that
  `requireOrgPermission` never gained the archived check) is self-verifying by construction.
- `npm run test:runtime`: **227/227** (was 224/224 at phase start).
- `tests/security/97-enterprise-isolation-integrity.cjs`: unaffected, still passing.
- Production build: clean.
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: Org Deletion Lifecycle (archive/restore/purge)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.1/10
**CONFIDENCE:** 88%

## V1 SURFACE

- **Backend:** `organizationService.cjs` (`archiveOrg`/`restoreOrg`/`purgeOrg`, all real, pre-existing); `orgMiddleware.cjs` (1 new check); `organizations.js` (1 new narrower membership helper for the detail route).
- **Routes:** `DELETE /orgs/:orgId`, `POST /orgs/:orgId/restore`, `POST /orgs/:orgId/purge`, `GET /orgs/:orgId` — all real, all live-tested this pass.
- **Frontend:** not touched or investigated this pass — out of scope (no frontend consumer of these routes was inventoried; this pass focused on the backend lifecycle correctness the register flagged as unmeasured).
- **Persistence:** PASS — full lifecycle (create→populate→archive→restore→archive→purge) confirmed correct across a real server restart.
- **Authentication:** PASS — unaffected.
- **Authorization:** PASS — non-owner correctly denied at every stage (`403` on archive attempt, `403` on metadata view of an unrelated org).
- **Tenant Isolation:** PASS — orphaned post-purge data confirmed genuinely unreachable via the normal API, not merely hidden.
- **Cross-OS:** N/A — this fix is in the shared org-middleware layer, not a cross-OS composition.
- **Failure Honesty:** PASS — `cascade`/`orphaned` counts are real, not fabricated; purge without the correct confirmation token is honestly rejected.
- **Live Verification:** every claim backed by real HTTP requests with real created/populated/archived/purged data, including a real restart.
- **Regression:** 227/227 (224/224 baseline + 3 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — an archived organization remained fully readable AND writable, meaning "delete" had no actual access-restriction effect until the irreversible purge step. A user could unknowingly continue generating real, un-tracked-as-deleted data in an org they believed was already gone.
- **V1-critical P2:** 0
- **Other:** the fix's own first version introduced a real regression (blocking the org's own metadata view, needed for the purge workflow itself) — found and corrected within this same pass before considering the fix complete.

## FIXES

- `backend/middleware/orgMiddleware.cjs`: `requireOrgMember` now treats an archived org as not-found for ordinary tenant-data access.
- `backend/routes/organizations.js`: added `_requireOrgMemberIncludingArchived`, used only by `GET /orgs/:orgId`, so the legitimate metadata-view/slug-retrieval workflow remains intact.
- 3 new regression tests, 2 negative-tested.

## LIMITATIONS

- Frontend reachability of the archive/restore/purge UI flow was not inventoried or tested this pass — this audit focused on backend lifecycle correctness only, matching the register's own framing of the gap ("org deletion — NOT MEASURED").
- A real backup/restore drill (distinct from this app-level archive/restore feature) remains genuinely NOT MEASURED and out of this pass's scope — it requires real infrastructure-level backup tooling, not exercised here.
- ID-reuse-based orphan exposure was assessed via code-level reasoning about `_id()`'s collision-resistant scheme, not reproduced by actually forcing a collision (which would require manipulating the system clock or the in-process sequence counter in a way this pass judged unsafe/unnecessary given the scheme's actual design).

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the "org deletion" item from B.24/B.25's `NOT MEASURED` list with real evidence, and finds
and fixes a genuine, previously-undiscovered defect in the process (archived orgs remained fully
operational). Combined with the prior 3 items closed this session, the register's remaining open
items are now: `SENTRY_DSN` (credential-blocked), screen-reader certification (environment-blocked),
C.5's mobile overflow (deliberately not force-fixed, documented), G1-B193's 415 unlabelled controls
(explicitly scoped as a design-change project, not an audit recovery), and the remaining genuinely
infrastructure-dependent `NOT MEASURED` items (load test, real backup restore drill, invitation flow,
3-role exercise, automation). No OS-track record altered.

## REGRESSION RESULT: 227/227 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean, no frontend file changed)
