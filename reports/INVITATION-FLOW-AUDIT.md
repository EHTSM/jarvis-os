# INVITATION FLOW — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after RBAC Role Exercise
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior finding:** B.24 (`reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`) — "invitation flow" listed
among `NOT MEASURED` items, never live-tested end-to-end.

---

## Why this item

Reconciled the register: org deletion, B23-03, GG-1, SENTRY_DSN, and RBAC role exercise are all
correctly closed, per each prior mission's own instructions. Of the remaining `NOT MEASURED` items
(load test, real backup restore drill, invitation flow, automation), "automation" was reconciled first
and found stale — `automationService.cjs`'s real event-triggered execution loop
(`startEventLoop()`, wired at `backend/server.js:966`) is confirmed live-running at server boot
(`[Automation] event-triggered rule execution started` present in the runtime log), independently
fixed and verified earlier this session (C10-007). No further action needed; not re-audited. That left
invitation flow as the only remaining genuinely actionable item testable via real HTTP requests
against the running server without infrastructure this pass can't safely provide.

## Discovery

`backend/routes/workspace.js` implements a real, complete invitation lifecycle:
`POST /workspace/invite` (Admin+/Owner only, creates a token record then best-effort emails it —
already fixed for async-email-await correctness in an earlier A.6 pass), `GET /invite-preview/:token`
(deliberately public, no auth, so an invitee without an account yet can see "You've been invited to
join X" before signing up), and `POST /workspace/accept-invite` (requires auth, consumes the token,
adds real membership). `workspaceService.cjs`'s backing implementation (`createInvitation`,
`sendInvitationEmail`, `acceptInvitation`, `getInvitationByToken`) is a real, well-designed 6-role
(`Owner > Admin > Operator > Developer > Viewer`) system with expiry, single-use tokens, and honest
delivery-failure reporting.

## Live test — real accounts, real end-to-end flow

1. Registered a real "inviter" account (auto-provisioned as `Owner` of its own workspace at
   registration, confirming — same as the org-track finding from the RBAC mission — every account
   gets a real workspace automatically, not just an org).
2. `POST /workspace/invite` for a not-yet-registered email, role `Developer`.
3. **Found the defect**: `GET /invite-preview/:token` — unauthenticated, using the real token from
   step 2 — returned `401 Unauthorized`, despite the route's own header comment explicitly stating
   it is "Deliberately public (no requireAuth...)".

## The defect

`backend/routes/business.js` mounts a router-wide gate:

```js
router.use((req, res, next) => {
    if (req.path.startsWith("/business/webhook/")) return next();
    return requireAuth(req, res, () => attachOrg(req, res, next));
});
```

with **no path prefix** — and `business.js` itself is mounted with no prefix at `/` in
`routes/index.js` (`router.use(require("./business"))`), roughly 20 route files ahead of
`workspace.js`. Express processes middleware/routes in mount order across the whole composed router;
any request that falls through unmatched to this point in the stack — regardless of which later file
it actually belongs to — hits this gate. Live-reproduced and confirmed by direct stack-trace
instrumentation (patched `requireAuth` to print its call stack): `GET /invite-preview/xyz` showed
`requireAuth` invoked from `backend/routes/business.js:99`, not from `workspace.js` (which never calls
`requireAuth` on that route at all). This is the same class of bug this codebase's own `server.js`
comments already document as a known failure mode (a bare, unprefixed `router.use()` mounted at `/`
intercepting unrelated paths) — a fresh, previously-undiscovered instance of it, with a real, live
security-relevant consequence: a route deliberately designed to be reachable without a session was
silently unreachable without one.

## Fix

Scoped the gate to `/business`:

```js
router.use("/business", (req, res, next) => {
    if (req.path.startsWith("/webhook/")) return next();
    return requireAuth(req, res, () => attachOrg(req, res, next));
});
```

Every individual `/business/*` route already declares its own `requireAuth`/`_requireOrg` inline —
this wrapper's only unique purpose (per its own existing comment) is running `attachOrg` before that
per-route `requireAuth` so `attachOrg`'s auto-resolve path has `req.user` available. Scoping it to
`/business` changes nothing for any real `/business/*` request.

**Regression found and fixed within this same pass**: scoping to `/business` makes Express strip that
matched prefix from `req.path` inside the handler (confirmed live in an isolated harness: `req.path`
became `/webhook/form`, not `/business/webhook/form`, for a request to `/business/webhook/form`), so
the original `req.path.startsWith("/business/webhook/")` exclusion check silently stopped matching
anything at all — which would have re-broken the public webhook ingestion endpoints
(form/email/whatsapp/telegram/payment/calendar) while fixing the interception bug. **Fixed**: changed
the check to the mount-relative `req.path.startsWith("/webhook/")`.

## Live re-verification of the corrected fix

- `GET /invite-preview/:token` (real valid token) → `200`, real invitation details, no auth needed.
- `GET /invite-preview/:token` (bogus token) → `404 Invitation not found` (correctly reachable, not
  masked by a 401).
- `GET /business/leads` (unauthenticated) → still correctly `401`.
- `POST /business/webhook/form` (unauthenticated) → still correctly `200`, creates a real CRM lead +
  mission (`eventId`, `entityId`, `missionId` all real, non-fabricated).
- Full accept flow: real invitee registers → logs in → `POST /workspace/accept-invite` → `200`, real
  membership + `Developer` role added, confirmed via `GET /workspace/:id/members` as the inviter.
- Token re-use: re-accepting the same (now-used) token → `400 Invalid or expired invitation token`.
- Re-preview after acceptance → `used:true`, honestly reflecting real consumed state.
- Authorization boundaries: `Developer`-role member denied `POST /workspace/invite` (`403 Insufficient
  role`); a completely unrelated third account denied inviting into someone else's workspace by ID
  (`403`); unrelated account denied `GET /workspace/:id/members` (`403 Not a member of this
  workspace`); `Developer` denied removing the `Owner` (`403 Insufficient role`); invalid role name
  rejected (`400 Invalid role: SuperAdmin`).
- Persistence: `data/workspaces.json`'s invitation record shows the real `usedAt` timestamp,
  survived a full server restart.
- Both fixes (the scoping fix and the webhook-path correction) re-confirmed correct on a fresh server
  process after a real restart.

## Regression

- Added 2 tests (describe block `121-master-audit-invitation-flow`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Negative-tested — reverted both fixes,
  confirmed each test failed with its exact expected assertion message, restored.
- `npm run test:runtime`: **231/231** (229/229 baseline + 2 new tests).
- `tests/security/97-enterprise-isolation-integrity.cjs`: 3/3, unaffected.
- `tests/security/110-ai-workspace-org-attribution-and-cache-isolation.cjs`: unaffected.
- `tests/security/05-injection-security.cjs`: unaffected.
- Production build: clean.
- `.env`: confirmed untouched throughout.
- Test data: only fresh, disposable accounts/workspaces created this pass (not the reused Org A/B
  test tenants) — no cleanup of persistent test fixtures required.

---

## AUDIT NAME: Invitation Flow (workspace invite/preview/accept)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.3/10
**CONFIDENCE:** 89%

## V1 SURFACE

- **Backend:** `workspaceService.cjs` (real, pre-existing — untouched, was correctly designed);
  `backend/routes/business.js` (1 router-wide gate scoped + 1 internal path-check correction).
- **Routes:** `POST /workspace/invite`, `GET /invite-preview/:token` (fixed), `POST
  /workspace/accept-invite`, `GET /workspace/:id/members`, `DELETE
  /workspace/:id/members/:accountId` — all real, all live-tested this pass. `POST
  /business/webhook/*` (6 routes) re-verified unaffected by the fix.
- **Frontend:** not investigated this pass — out of scope; this audit focused on the backend
  end-to-end flow the register flagged as unmeasured.
- **Persistence:** PASS — full lifecycle (invite→preview→accept→re-preview→reject-reuse) confirmed
  correct across a real server restart.
- **Authentication:** PASS — the core defect *was* an authentication-gate bug; now correctly resolved
  for the deliberately-public route while unrelated routes remain correctly gated.
- **Authorization:** PASS — 5 distinct role/ownership boundaries tested, all already correctly
  enforced by the pre-existing `_roleAtLeast()` checks in `workspaceService.cjs`.
- **Tenant Isolation:** PASS — an unrelated account cannot invite into or read members of a workspace
  it does not belong to.
- **Cross-OS:** N/A — this fix is in a shared route-mounting boundary (`business.js`'s router-wide
  gate), not a cross-OS composition; its blast radius was every later-mounted route file, not a
  specific OS integration.
- **Failure Honesty:** PASS — `emailSent:false`/real `emailError` correctly surfaced (no email
  provider configured in this environment, matching earlier A.6/A.10.5 findings); invalid
  role/expired/reused-token cases all return real, specific errors, never fake success.
- **Live Verification:** every claim backed by real HTTP requests with real accounts, a real
  restart, and direct stack-trace instrumentation to confirm root cause (not inferred from reading
  code alone).
- **Regression:** 231/231 (229/229 baseline + 2 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — a deliberately public, auth-free route
  (`GET /invite-preview/:token`) was silently gated by an unrelated file's router-wide,
  path-unscoped `requireAuth` middleware, due to Express route-mount ordering. Any other
  not-yet-matched path in any route file mounted after `business.js` in `routes/index.js` was
  equally exposed to this same unintended gate — this audit fixed the general case, not just the
  one symptom found.
- **V1-critical P2:** 0
- **Other:** the fix's own first version introduced a real regression (the webhook-path exclusion
  string stopped matching after path-scoping) — found and corrected within this same pass before
  considering the fix complete, mirroring the same fix-then-self-regression-then-correct pattern
  from the Org Deletion Lifecycle mission earlier this session.

## FIXES

- `backend/routes/business.js`: scoped the router-wide `requireAuth`+`attachOrg` gate to
  `"/business"`, eliminating cross-file interception of unrelated, later-mounted routes.
- `backend/routes/business.js`: corrected the webhook-path exclusion check from
  `req.path.startsWith("/business/webhook/")` to the mount-relative
  `req.path.startsWith("/webhook/")`, required by the scoping fix above.
- 2 new regression tests, both negative-tested.

## LIMITATIONS

- Frontend reachability of the invite/accept UI flow was not inventoried or tested this pass — this
  audit focused on backend end-to-end correctness, matching the register's own framing of the gap
  ("invitation flow — NOT MEASURED").
- Only a representative sample of role/ownership authorization boundaries was tested (5 real checks),
  not an exhaustive sweep of all 5 roles × all workspace actions.
- The blast radius of the underlying interception bug (every not-yet-matched path in every route file
  mounted after `business.js`) was reasoned about and the general fix applied, but not every single
  one of the ~20 affected route files' public/unauthenticated endpoints (if any others exist) was
  individually enumerated and re-tested this pass — `/invite-preview/:token` was the one concretely
  identified and confirmed instance.
- Email delivery itself remains genuinely untested end-to-end (no email provider credentials
  configured in this environment) — the honest `emailSent:false` failure path was verified, not an
  actual successful send.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the "invitation flow" item from B.24's `NOT MEASURED` list with real evidence, reconciles
"automation" as stale/already-resolved (closed by an earlier C10-007 fix this session, not
re-audited), and finds and fixes a genuine, previously-undiscovered P1 defect with a blast radius
extending beyond the invitation flow itself — any route in ~20 files mounted after `business.js` that
is deliberately meant to be reachable without authentication was silently unreachable without one.
This is a materially important structural finding, distinct in kind from this session's prior
route-specific fixes (missing checks on one route) — this was an *unintended* check silently applied
to routes that explicitly should not have had it. No OS-track record altered.

## REGRESSION RESULT: 231/231 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean)
