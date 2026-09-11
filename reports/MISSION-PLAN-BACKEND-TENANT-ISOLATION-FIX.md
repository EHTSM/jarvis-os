# MISSION PLAN — Backend Tenant-Isolation & Authorization-Gate Fix

**Status: PLAN ONLY — not yet executed.** No code has been changed. This
document is for review before any implementation begins.

**Working name:** deliberately left unnumbered pending user sign-off, to
avoid colliding with the already-registered "Mission 43B" (a separate,
unrelated frontend gap-discovery mission appended to the register by
another session). Suggested register name once approved: **Mission 43D —
Backend Tenant-Isolation & Authorization-Gate Remediation**.

**Source:** consolidates all 9 confirmed defects from:
- `reports/MISSION-43A-BACKEND-ROUTE-GAP-DISCOVERY.md` (§4: `mission.js`,
  `collaboration.js`, `plan-management.js`)
- `reports/MISSION-43A-FOLLOWUP-DEEP-VERIFICATION.md` (§2.1–2.6:
  `browserPlatform.js`, `workspaceMesh.js`, `obi-x.js`, `pipeline.js`,
  `engineering.js`, `autonomousAgent.js`)

## 1. Goal

Close every confirmed cross-tenant/authorization gap from Mission 43A using
**only patterns already established elsewhere in this codebase** — no new
architecture, no new middleware library, per CLAUDE.md §16/§22. Each fix
below cites the exact existing pattern it reuses.

## 2. Critical design constraint discovered during planning

`missionMemory.cjs`'s own header comment documents that `orgId` is
**optional by design**, and the vast majority of existing missions (created
via `codingAssistant.js`, `phase27.js`, and most autonomous/engineering
flows) are created with **no orgId at all** — they are legitimately shared,
operator-visible, non-tenant-owned resources. `getMission(missionId)` has
no orgId filter; only `listMissions(opts.orgId)` does.

**This means a naive "reject unless resource.orgId === caller.orgId" check
would be wrong** — it would break every existing orgId-less mission
(the majority of production data) for every user, including the operator.

**Correct rule, matching this file's own documented intent:**
> A resource with `orgId === null/undefined` remains accessible to any
> authenticated caller (current behavior, unchanged — these are shared/
> operator resources by design). A resource **with** a non-null `orgId`
> may only be accessed by a caller whose own resolved org membership
> includes that `orgId` (or who holds a cross-org grant / is an enterprise
> admin, matching `requireOrgMember`'s existing exception list).

This is a narrower, additive check — it changes behavior only for the
subset of resources that already carry a real `orgId`, which today is
mostly customer-created business missions (via `organizations.js`'s
`createMissionForOrg`), not the shared engineering/autonomous ones. This
avoids a regression sweep across every existing mission in `data/missions.json`.

## 3. Fix groups, in dependency/risk order

### Group A — Ownership-check helper (build once, reuse 4x)

Before touching any route, add one small shared helper, since 4 of the 9
fixes need the identical check (`mission.js`, `collaboration.js`,
`pipeline.js`, `autonomousAgent.js`). Following the existing convention of
small `services/` utility modules (CLAUDE.md §11), not a new abstraction
layer:

- **New file:** `backend/services/resourceOwnership.cjs` — one function,
  `assertOwnable(req, resource)`, that:
  1. If `resource` is null/undefined → let the caller's existing 404 logic
     handle it (no change).
  2. If `resource.orgId` is falsy → allow (matches current, intentional
     shared-resource behavior — see §2).
  3. Else, resolve `req.user.sub` via `organizationService.resolveContext()`
     (the exact function `attachOrg` already uses) and check
     `resolveContext(accountId).orgs` contains `resource.orgId`, OR
     `organizationService.isEnterpriseAdmin(accountId)`, OR
     `organizationService.listGrantsForAccount(accountId)` contains a grant
     for `resource.orgId` — the same three-way exception list
     `requireOrgMember` already uses (`backend/middleware/orgMiddleware.cjs:75-80`).
  4. Return boolean; callers throw/404 on `false` — matching this codebase's
     established "404, not 403" convention for cross-tenant access
     (`orgMiddleware.cjs`'s own comment: "not distinguishing 'exists but
     forbidden' from 'doesn't exist'").
- This is a genuinely new small utility, not a duplicate of `attachOrg`/
  `requireOrgMember` (those are path-param/header-driven; this is
  resource-instance-driven, for routes keyed by a bare resource ID rather
  than `:orgId` in the URL) — justified since 4 separate route files need
  the exact same check.

### Group B — IDOR fixes reusing Group A (4 files)

1. **`backend/routes/mission.js`** — `GET /mission/timeline/:id`,
   `/graph/:id`, `/replay/:id`, `/state/:id` (and, for symmetry, the
   `POST /mission/runtime/*` mutation routes) call `assertOwnable(req,
   memory.getMission(id))` before proceeding; 404 on failure. Uses the
   existing `_send`/`_sendAsync` error-status helper already in the file
   (`err.message.includes("not found") ? 404`), so the ownership check
   just throws `new Error("Mission not found: " + id)` to route through
   the same existing status-mapping path — no new error-handling code.

2. **`backend/routes/collaboration.js`** — needs one prerequisite: it uses
   `agents/runtime/collaborationLayer.cjs`, which has **zero** orgId
   concept today (unlike `missionMemory.cjs`). Rather than inventing a
   parallel orgId store for collaboration sessions, have
   `collaborationLayer.getSession/getHistory/performAction/etc.` resolve
   the underlying mission via `missionMemory.getMission(missionId)` (it
   already needs to look up the mission to operate on it) and reuse
   *that* mission's `orgId` for the ownership check via the same
   `assertOwnable` helper, applied in the route layer exactly like
   `mission.js`. No new persisted field — derives ownership transitively
   from the mission the collaboration session already belongs to.

3. **`backend/routes/pipeline.js`** — `GET/POST /pipeline/:id[/approve|cancel]`:
   same `assertOwnable(req, engineeringPipelineCoordinator.getPipeline(id))`
   pattern. Need to confirm at implementation time whether pipeline records
   carry an `orgId` field already (`engineeringPipelineCoordinator.cjs` was
   confirmed in the follow-up report to have zero orgId references) — if
   not, add `orgId: data.orgId ?? null` at pipeline-creation time,
   following the exact same "optional field, defaults to shared" pattern
   `missionMemory.cjs` already uses, not a required-field redesign.

4. **`backend/routes/autonomousAgent.js`** — same `assertOwnable` pattern
   against `autonomousEngineeringAgent.cjs`'s mission records; same
   optional-orgId-field addition if not already present.

### Group C — Unscoped-service-call fixes (orgId passthrough, 2 files)

5. **`backend/routes/plan-management.js`** — resolve `req.org?.id` (via
   the same `organizationService.resolveContext(req.user.sub).primaryOrg`
   used elsewhere) and pass it to `crm.getStats(orgId)` — the function
   already supports this correctly (confirmed in 43A §4.3); this is a
   one-line argument fix, not a service change. Separately: confirm with
   the user (per CLAUDE.md §12, don't leave a contract half-updated)
   whether any frontend code calls `POST /plan/upgrade` before deciding
   whether to wire it to `billingService` or remove it — flagged as a
   decision, not silently resolved either way.

6. **`backend/routes/obi-x.js`** — same fix as #5, applied to every
   unscoped call inside `businessReasoningEngine.analyze()`
   (`getAllKpis`, `getPipelineStats`, `listDeals`, `getOverview`,
   `crm.getStats`, `getRevenueDashboard`, `listChurnRisks`) — thread
   `req.org.id` through from the route (mount this file behind
   `attachOrg` + `requireOrgMember`, exactly like `business.js` already
   does at the same `/business` prefix — this is the most direct reuse
   of an existing pattern in the whole plan, since it's the literal
   sibling route). Also scope `GET /business/x/reasoning` (list) and the
   persisted `data/business-reasoning.json` reads by `orgId`.

### Group D — Authorization-gate fixes (2 files, no data-model change)

7. **`backend/routes/workspaceMesh.js`** — add `operatorOnly` at the
   mount point in `backend/routes/index.js`, identical to the existing
   `/computer/*` gate and its inline justification comment
   (`backend/routes/index.js:301-310`) — copy that comment's reasoning
   forward to explain why `/workspace-mesh` needs the same gate (it
   reaches the identical controller stack). Pure middleware addition, zero
   route-handler changes.

8. **`backend/routes/engineering.js`** — do **not** gate the whole file
   (most of it is legitimate broad-access analytics). Add `operatorOnly`
   as route-level middleware (not mount-level) on just
   `POST /engineering/scenario/run` and
   `POST /engineering/benchmark/run` / `/engineering/benchmark/scenario/:id`,
   matching the existing pattern of per-route `operatorOnly` already used
   in `deployment.js` and `dependencyAudit.js` per 43A §3. Additionally
   make the `/scenario/run` commit-approval flag operator-verified rather
   than trusting the caller-supplied `approved:true` body field — reuse
   the fact that `operatorOnly` has already run by that point, so the
   flag can simply be treated as "operator explicitly requested this,"
   which is the actual intent; no separate approval-service integration
   needed.

9. **`backend/routes/browserPlatform.js`** — two independent sub-fixes,
   both reusing existing in-file/sibling patterns:
   - **Ownership:** the file already has `_accountId(req)` and already
     uses it correctly on 3 routes (`:157,164,171`) — extend the same
     call to the 8 routes that currently skip it (`:176-224` — get/put/
     delete profile, cookies get/save/clear, storage save) by comparing
     `sessionManager.getProfile(id).accountId === _accountId(req)` before
     proceeding (404 on mismatch, matching this repo's IDOR convention).
     Also remove the `?all=true` bypass on the list route, or restrict it
     to `operatorOnly` callers only (needs a one-line decision: is "list
     everyone's sessions" a legitimate operator feature, or dead/
     accidental code? — flag for user confirmation, don't silently pick).
   - **Rate limiting:** add `rateLimiter(...)` to the control/session
     mutation routes, copying the exact limits `browser.js` already uses
     for equivalent actions (e.g. `rateLimiter(20, 60_000)` for navigate,
     `rateLimiter(10, 60_000)` for run/workflow) — not inventing new
     thresholds.

## 4. Order of implementation

1. Group A helper (foundation for B).
2. Group D (7, 8, 9) first — these are pure middleware/rate-limit
   additions with no data-model risk, lowest chance of breaking existing
   behavior, fastest to verify.
3. Group C (5, 6) next — one-argument passthrough fixes plus mounting
   `obi-x.js` behind existing `attachOrg`/`requireOrgMember`.
4. Group B (1–4) last — highest complexity (new ownership field on
   pipeline/autonomous-agent records, transitive lookup for
   collaboration), most similar to a real live-verified IDOR fix already
   in this repo's history, so budget the most negative-testing time here.

## 5. Verification plan (per CLAUDE.md §14/§22)

For each fix:
1. **Before:** live-reproduce the defect against a running server with two
   ordinary test accounts in different orgs (or, for the operator-gate
   fixes, one ordinary account vs. one operator account) — confirm the
   cross-tenant read/bypass actually succeeds pre-fix.
2. **Fix:** smallest existing-pattern change per §3.
3. **After:** re-run the same reproduction, confirm it now correctly
   404s/403s; confirm the legitimate same-org / orgId-less-resource case
   still works (regression check specific to §2's constraint — this is
   the one most likely to introduce a false-positive lockout).
4. **Negative-test:** revert the fix, confirm the defect reproduces again,
   restore it, reconfirm.
5. Run the real test corpus per CLAUDE.md §9
   (`node --test tests/security/*.cjs`, `tests/runtime/*.test.cjs`), not
   the stale `npm run test:runtime` subset, and report results honestly
   including any pre-existing unrelated failures separately.

## 6. Explicitly out of scope for this mission

- The `POST /plan/upgrade` dead-stub question (flagged for a decision,
  not a silent fix either way).
- The `browserPlatform.js` `?all=true` legitimate-use-or-not question
  (flagged for a decision).
- Any of the 3 files cleared with NO DEFECT
  (`researchInstitute.js`, `okb-x.js`, `ose-x.js`).
- Anything in the separately-tracked frontend "Mission 43B" or the
  infrastructure "Mission 43C" — different scope, different sessions.
- No `.env`/credentials/VPS changes; no package installs (all patterns
  reuse existing in-repo middleware/services).

## 7. Open questions for user sign-off before implementation starts

1. Confirm the mission should proceed under a new register entry name
   (suggested: "Mission 43D") to avoid the existing 43B collision.
2. Confirm the two flagged decisions in §6 (plan/upgrade stub,
   browserPlatform `?all=true`) — proceed with the plan's tentative
   recommendation (leave `/plan/upgrade` alone pending frontend check;
   restrict `?all=true` to operatorOnly) unless told otherwise.
3. Confirm whether to implement all 4 groups in one pass or land them as
   separate reviewable commits per group (recommended, given the
   dependency order in §4 and the differing risk profiles).
