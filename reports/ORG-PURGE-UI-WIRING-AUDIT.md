# ORG PURGE UI WIRING — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after Memory OS Fake-Success Masking
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior findings referenced:** Org Deletion Lifecycle Audit, C10-006, C10-010, C10-013, C10-025,
C10-026, C10-030 (`reports/C10-FINAL-CLOSURE-INVENTORY.md`).

---

## Why this item

The prior mission's own documented candidate — ordinary authenticated users able to reach
`/memory/*`/`/memory-index/*`/`/p18/memory/*` platform-engineering data — was explicitly flagged as
requiring a product security-policy decision, not a narrow evidence-driven fix, and correctly **not**
auto-fixed this pass. It remains open and documented for a future mission.

Reconciled the register and C.10's closure inventory against current code before selecting elsewhere:

- **C10-006** (is `/org-executive/:orgId/*` the real fix for org-level executive reporting?) —
  **already resolved**. Live-verified: a real org owner with real revenue data gets a genuine,
  correctly tenant-scoped executive summary; an unrelated account is correctly denied `403`.
- **C10-010** (legacy `enterpriseOS.cjs` engine has its own independent membership model, risk of
  drift from `organizationService.cjs`) — **already resolved**. The route file's own header comment
  ("OS-ENTERPRISE RECONCILIATION, 2026-08-15") shows this engine was already found completely
  unauthenticated and fixed with `operatorOnly` gating. Live re-verified: an ordinary customer gets
  `403 Forbidden — operator access required`; unauthenticated gets `401`. Since ordinary tenants can
  never reach this engine at all, the "two membership models could diverge" risk is moot — divergence
  only matters if a tenant could reach both, and now only operators can reach either.
- **C10-013** (no RBAC/permission-assignment step in company factory) — **already resolved**.
  Live-verified: creating a real company via `POST /company-factory/create` grants the creator a
  genuine, enforced `org_owner` role (confirmed via `/orgs/me/context`) with 9 real composed
  departments, each carrying real, persisted `permissions` arrays on the department record. RBAC is
  inherited for free from the pre-existing, already-audited `organizationService.createOrg()` — there
  was never a missing "step", just no separate explicit call, which isn't a defect.
- **C10-026** (Enterprise CRM frontend is a pure client-side mock) — investigated and found to be
  **completely dead code**: zero imports or references to `EnterpriseCRM.jsx` anywhere in the
  frontend, unreachable by any real user. Not selected — no live verification is possible against
  code nobody can ever open, and fixing unreachable code doesn't serve any real user.
- **C10-030** (social publishing implemented for X/Twitter only) — confirmed still genuinely true
  (`socialPostingService.cjs` is Twitter-only), but building LinkedIn/Facebook/Instagram integrations
  is substantial new architecture (multiple OAuth flows, new external API integrations) — correctly
  out of bounds for an audit-recovery pass, not merely a "wire the existing thing up" fix.
- **C10-025** (duplicate connector-probe code between two files) — real but P3/low-impact, and its
  original source document ("GAP-LIST #23") is not preserved anywhere in `reports/`, making it
  impossible to precisely locate the two files without speculative, potentially-wrong guessing.

Instead, noticed a concrete, repeated pattern across the last three consecutive backend-focused
missions this session (Org Deletion Lifecycle, RBAC Role Exercise, Invitation Flow): each explicitly
scoped out frontend investigation ("Frontend: not investigated this pass — out of scope"). Checked
whether those backend fixes actually have real, working frontend consumers:

- **Invitation flow**: `AcceptInvitePage.jsx` and `TeamWorkspace.jsx` are both real, correctly wired,
  and call exactly the routes fixed in that audit — the accept-invite page was, in fact, silently
  broken by that exact `business.js` interception bug before it was fixed, confirming the frontend
  audit gap was a real, live-relevant one, not merely theoretical.
- **RBAC role exercise**: out of scope for this pass — a broader frontend-role-gating sweep, not a
  single missing piece.
- **Org deletion lifecycle**: `OrgAdminCenter.jsx` is the real, already-shipped UI for this feature —
  and it has archive and restore wired, but **no UI at all for the third lifecycle step, purge**.

## Discovery

`backend/routes/organizations.js`'s `POST /orgs/:orgId/purge` (already live-verified correct in the
Org Deletion Lifecycle audit — requires the org already archived, requires `{confirm: slug}` matching
the org's real slug, irreversible) has **zero frontend consumer anywhere in the product**. Confirmed
via `grep -c "purge" frontend/src/components/OrgAdminCenter.jsx` → `0`, and a repo-wide search
confirming no other component references this specific route. `OrgAdminCenter.jsx`'s `OverviewPanel`
has a complete `isArchived` branch offering "Restore organization" but nothing offering permanent
deletion — a founder who has archived an organization and genuinely wants it gone has no UI path to
finish that workflow; they would need to call the API directly.

## Fix

Added a purge control to `OrgAdminCenter.jsx`'s `OverviewPanel`, gated identically to the existing
archive control (`myRole === "org_owner"`) and additionally requiring `isArchived` (matching the
backend's own precondition — `purgeOrg()` throws `409` if the org isn't already archived, so gating
the UI the same way avoids offering a control guaranteed to fail).

`useConfirm()` (the app's existing yes/no confirmation dialog, already used by the archive button)
only supports a boolean choice — it cannot express the backend's type-to-confirm slug-match
requirement. Rather than build a new shared dialog component, the fix reuses this same file's own
established local-state form pattern (already used for "Add member" and "New department" —
`show*` boolean + local field state + a plain `<input className="oac-input">` + `<button
className="oac-btn">`) to add a minimal, self-contained, in-place text-confirmation control. The
confirm button is disabled until the typed value exactly equals `org.slug` (visible elsewhere on the
same page), mirroring the backend's own exact-match check — so a typo cannot submit a request destined
to fail, and, more importantly in a multi-org session, cannot accidentally submit the wrong org's
slug.

## Live re-verification

Full lifecycle exercised twice with real data, once before and once after a real server restart:

1. Created a real company via `POST /company-factory/create` (real `orgId`, real `org_owner`
   creator).
2. Archived it (`DELETE /orgs/:orgId` → `200`).
3. Fetched its real slug via `GET /orgs/:orgId` — exactly what the frontend's `org.slug` prop already
   carries.
4. Attempted purge with a wrong confirm value — correctly rejected `400 Confirmation token mismatch`.
5. Purged with the correct slug — `200`, `deleted: true`, honest `orphaned` counts.
6. Confirmed the org is genuinely gone — `GET /orgs/:orgId` → `404`.
7. Authorization: an unrelated account attempting purge on a second real archived org (with the
   correct slug) was correctly denied `403 Forbidden — requires permission: delete_org`.
8. Verified the fix is present in the actual built production bundle: `grep -rl "Permanently delete
   organization" frontend/build/static/js/*.js` locates the real served chunk.
9. Repeated the full create→archive→purge→verify-gone sequence after a real server restart —
   identical results.

## Regression

- Added 3 tests (describe block `123-master-audit-org-purge-ui`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Negative-tested — reverted the entire fix
  (state, handler, and JSX), confirmed all 3 failed, restored.
- `npm run test:runtime`: **236/236** (233/233 baseline + 3 new tests).
- Production build: clean, fix confirmed present in the served bundle.
- `.env`: confirmed untouched throughout.
- Test data: 3 disposable test orgs created and purged (as part of live verification, not left
  behind) — no persistent test fixtures touched.

---

## AUDIT NAME: Org Purge UI Wiring (OrgAdminCenter.jsx)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.3/10
**CONFIDENCE:** 87%

## V1 SURFACE

- **Backend:** none changed — `POST /orgs/:orgId/purge` was already correct and previously
  live-verified; investigated and re-confirmed, not modified.
- **Routes:** `POST /orgs/:orgId/purge`, `GET /orgs/:orgId`, `DELETE /orgs/:orgId` — all re-tested
  live, all correct and unaffected by this frontend-only fix.
- **Frontend:** `frontend/src/components/OrgAdminCenter.jsx` — 1 new danger-zone control (state +
  handler + JSX), reusing existing patterns from the same file.
- **Persistence:** PASS — real org creation, archival, and permanent deletion all confirmed correct
  across a real server restart.
- **Authentication:** PASS — unaffected.
- **Authorization:** PASS — the purge control is gated to `org_owner` in the UI, and independently
  enforced server-side (`requireOrgPermission("delete_org")`); an unrelated account was live-confirmed
  denied even with the correct slug.
- **Tenant Isolation:** PASS — purge only ever operates on the org the caller has `delete_org`
  permission for; live-confirmed an unrelated account cannot purge another org.
- **Cross-OS:** N/A — a single-component frontend fix over an already-audited backend route, not a
  cross-OS composition.
- **Failure Honesty:** PASS — wrong-slug attempts are honestly rejected with the backend's real error
  message; the UI's disabled-button guard mirrors, but does not replace, the backend's own
  enforcement.
- **Live Verification:** every claim backed by real HTTP requests with real created/archived/purged
  organizations, including a full re-run after a real server restart and direct confirmation the fix
  is present in the actual served production bundle.
- **Regression:** 236/236 (233/233 baseline + 3 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — a real, already-audited, irreversible backend capability
  (`POST /orgs/:orgId/purge`) had zero frontend consumer anywhere in the product, leaving a founder no
  way to complete the org-deletion lifecycle's final step through the UI.
- **V1-critical P2:** 0
- **Other:** 4 closure-inventory items (C10-006, C10-010, C10-013, and the memory-scoping candidate
  from the prior mission, left correctly undecided) reconciled without unnecessary re-audit work; 1
  item (C10-026) correctly declined as an audit target for being genuinely unreachable dead code; 2
  items (C10-030, C10-025) correctly declined as out of narrow-fix scope.

## FIXES

- `frontend/src/components/OrgAdminCenter.jsx`: added a purge danger-zone control to the archived-org
  section of `OverviewPanel` — local `showPurge`/`purgeSlug` state, a `handlePurge` function calling
  the real backend route with the exact `{confirm: slug}` contract, and a confirm button disabled
  until the typed value exactly matches `org.slug`.
- 3 new regression tests, all negative-tested together.

## LIMITATIONS

- This fix addresses `OrgAdminCenter.jsx` specifically; a broader sweep of every backend route fixed
  in the last several missions for a matching frontend consumer was not performed — only the
  concretely-identified purge gap was fixed.
- The memory-authorization-scoping question from the prior mission remains open by design — a product
  decision, not resolved here, per that mission's own explicit instruction.
- No real browser/Playwright test exercised the new UI end-to-end (click the button, type the slug,
  observe the toast) — verification was via direct backend HTTP requests replicating exactly what the
  new frontend code calls, plus confirming the fix's presence and correctness in the actual built,
  served JS bundle. This matches this session's established frontend-verification convention but is
  not the same as an observed real click-through.
- C10-025 (duplicate connector-probe code) remains genuinely unaddressed — its original source
  document is not preserved anywhere in the repo, making it unsafe to guess at without risking fixing
  the wrong files.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Reconciles 3 more closure-inventory items as already-resolved and 3 more as correctly out of a narrow
audit-fix's scope, without unnecessary re-audit work on any of them. Completes the org-deletion
lifecycle's frontend surface — a real, previously-invisible gap where a backend capability this
session's own earlier audit had certified as correct was nonetheless unreachable by any real user.
Directly validates the value of the "frontend not investigated" limitation pattern flagged across the
last three missions: in the one case checked (invitation flow), the gap was real and had already
caused a live defect (the accept-invite page silently broken by the `business.js` bug); in the case
fixed here (org deletion), the gap was a missing capability, not a defect in an existing one. No
OS-track record altered.

## REGRESSION RESULT: 236/236 (0 failures, 0 skipped, 3 net new tests)

## BUILD RESULT: PASS (clean, fix confirmed present in the actual served production bundle)
