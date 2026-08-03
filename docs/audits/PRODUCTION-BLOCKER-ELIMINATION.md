# Production Blocker Elimination — Fix Log

Execution-only pass against the confirmed findings from the 2026-08-04 parallel
audit (cross-tenant leaks, revenue leaks, auth/authz, billing, race conditions,
data corruption, dead code). Each module below is: reproduce → verify exploit →
fix → regression → security verification → telemetry → documentation, committed
independently. No new architecture, no roadmap features. Findings that don't
survive verification are documented, not "fixed."

---

## Module 1 — Cross-tenant IDOR in `/security/*` and `/admin/*` (CONFIRMED, FIXED)

**Severity:** Critical — any authenticated user, regardless of workspace
membership, could read and destructively mutate another organization's
security-sensitive data with zero authorization check.

### Reproduce / verify exploit

Both `backend/routes/security.js` and `backend/routes/admin.js` mounted
`attachWorkspace` (which is documented as **non-blocking by design** — see
`backend/middleware/workspaceMiddleware.cjs`) but never followed it with
`requireWorkspaceMember`. Each router additionally defined its own `_wsId(req)`
helper that read `req.query.workspaceId || req.body?.workspaceId || req.workspace?.id`
— i.e. it trusted the client-supplied `workspaceId` over the session's
validated membership.

Verified live against the real routers (Express app mounting the actual
`security.js`/`admin.js` modules, real `signJWT`-issued session cookies, real
`workspaceService`/`securityLayer` data):

```
GET /security/tokens?workspaceId=<victim-workspace-id>
  → 200 OK, returns victim's service token list (names, scopes, ids)

DELETE /security/tokens/:id?workspaceId=<victim-workspace-id>
  → 200 { ok: true } — victim's real token is revoked by a non-member

GET /admin/team?workspaceId=<victim-workspace-id>
  → 200 OK, returns victim's full member directory (emails, roles, titles)
```

No role or membership check gated any of the above — an attacker only needed
their own valid session and the victim's workspace id (workspace ids are not
secret; they appear in invite links and URLs elsewhere in the app).

### Fix

- `backend/routes/security.js`: added `router.use(requireWorkspaceMember)`
  after `attachWorkspace`; `_wsId(req)` now returns only `req.workspace.id`
  (already membership-validated by `requireWorkspaceMember` before any handler
  runs) — the client-supplied `workspaceId` is still used by `attachWorkspace`
  to *select* which workspace to resolve, but the request is rejected before
  any handler executes unless the authenticated account is actually a member
  of that resolved workspace.
- `backend/routes/admin.js`: identical fix.
- No change to `attachWorkspace` itself or to any other router — it is used
  correctly elsewhere (e.g. `myConnectors.js`, `workspace.js` resolve
  workspace/org from the session, not raw client input).

### Regression

- Legitimate same-workspace access verified unaffected in both the
  active-workspace-fallback path (no `workspaceId` param — the pattern every
  real frontend caller uses: `WorkspaceSettingsK2.jsx`, `WorkspaceSettingsK3.jsx`)
  and the explicit-own-`workspaceId` path.
- Full legacy suite (`node --test tests/legacy/*.test.cjs`): 83 pass / 72 fail
  both before and after this change — the 72 failures are pre-existing,
  unrelated module-resolution issues (confirmed via `git stash` A/B compare),
  not introduced by this fix.

### Security verification

New permanent regression test: `tests/security/09-workspace-isolation-security.cjs`
(10/10 pass). Covers: cross-tenant read blocked, cross-tenant destructive
revoke blocked, legitimate same-workspace read still works via both the
fallback and explicit-own-id paths, for both route files.

### Telemetry

`requireWorkspaceMember` (`backend/middleware/workspaceMiddleware.cjs`) now
emits a `workspace_access_denied` event (accountId, workspaceId, path, ts) via
`runtimeEventBus` whenever a resolved workspace exists but the requester holds
no membership in it — surfaces IDOR probing (repeated attempts against
workspace ids that aren't the caller's) to ops rather than failing silently.
This applies to any current or future route that adopts the correct
`attachWorkspace` → `requireWorkspaceMember` pattern.

### Notes

`security.js`'s `PATCH /security/policies` and `admin.js`'s member/department
mutation routes were already gated with `requireRole("Admin")` and were not
independently exploitable pre-fix (role is resolved server-side against
`req.workspace`, so an attacker without Admin in the target workspace was
already rejected there) — but they benefit from the same
`requireWorkspaceMember` gate now applying uniformly ahead of them.
