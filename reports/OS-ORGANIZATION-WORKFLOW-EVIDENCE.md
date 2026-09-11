# OS-ORGANIZATION — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5133` (dedicated Organization verification instance)
**Auth:** real `POST /auth/login` sessions only — no JWT forged, no auth bypassed.
**Two real organizations**, created via real API calls by real authenticated accounts:

| Org | Creator | ID |
|---|---|---|
| A ("OrgOS Verify Alpha 8821") | `finoa@test.local` | `org_1786718762053_1` |
| B ("OrgOS Verify Bravo 8822") | `finop@test.local` | `org_1786718779057_2` |

---

## Chain verified

```
Frontend (not the focus this pass — see Not Measured items)
  → Express route (/orgs/*, /workspace/*, /governance/*, /enterprise/audit/*)
  → requireAuth (cookie JWT) → attachOrg/requireOrgMember/requireOrgPermission
  → organizationService.cjs
  → data/organizations.json  (fs, real writes)
  → auditLog.append() → data/logs/audit.ndjson
  → JSON response
```

---

## W1 — Real organization creation

```json
POST /orgs   {"name":"OrgOS Verify Alpha 8821"}
→ 200
{"ok":true,"id":"org_1786718762053_1","name":"OrgOS Verify Alpha 8821","slug":"orgos-verify-alpha-8821",
 "plan":"free","status":"active","memberCount":1,"deptCount":0,
 "members":[{"accountId":"e3e9ded9f7a101ec3d4573b8","orgRole":"org_owner","joinedAt":"..."}]}
```
Org B created identically by the operator account. Both confirmed genuinely on disk
(`grep` against `data/organizations.json`).

## W2 — Department creation

```json
POST /orgs/org_1786718762053_1/departments   {"name":"Engineering"}
→ 200
{"ok":true,"department":{"id":"dept_1786718799658_3","name":"Engineering","teams":[]}}
```

## W3 — Team creation (nested under department)

```json
POST /orgs/org_1786718762053_1/departments/dept_1786718799658_3/teams   {"name":"Backend Team"}
→ 200
{"ok":true,"team":{"id":"team_1786718813439_4","name":"Backend Team","memberIds":[]}}
```

## W4 — Member add + organization identification

```json
POST /orgs/org_1786718762053_1/members   {"accountId":"33c4fb52d35e1c41f00788ec","orgRole":"member"}
→ 200  {"ok":true,"added":true,"orgRole":"member"}

GET /orgs/me/context   (Org A owner)
→ 200
{"ok":true,"orgs":[{"orgId":"org_1786718762053_1","orgRole":"org_owner",
 "permissions":["delete_org","update_org","manage_members","view_members","manage_departments",...]}]}
```

## W5 — Organization switching

```json
POST /orgs/switch   {"orgId":"org_1786718779057_2"}   (operator)
→ 200  {"ok":true,"switched":true,"orgId":"org_1786718779057_2","context":{...}}
```

---

## Tenant isolation (Step 3) — every vector tested with real, non-forged sessions

| # | Test | Result |
|---|---|---|
| S1 | Org A reads Org B's departments (direct path, no forgery) | **403** `Forbidden — requires permission: view_departments` |
| S2 | Org A reads Org B's members | **403** `Forbidden — requires permission: view_members` |
| S3 | Org A + forged `X-Org-Id: <OrgA>` on Org B's path | **403** — path param wins, header ignored |
| S4 | Org A + forged `X-Org-Id: <OrgB>` on Org B's path (the exact historical regression scenario) | **403** — still correctly denied |
| S5 | Org A + forged `X-Org-Id: <OrgB>` on a headerless route (`/orgs/me/context`) | Returns **only Org A's real memberships** — header had zero effect |
| S10 | Org A adds a team member with forged `X-Org-Id: <OrgB>` | Member added **only to Org A** (path-addressed org); Org B's departments confirmed unaffected on disk |

**Confused-deputy resistance (Phase B.7's documented prior fix) is genuinely intact.** The code
comment in `orgMiddleware.cjs` describes the exact vulnerability and its fix; S3/S4 reproduce the
documented regression scenario precisely and confirm it stays fixed.

## Privilege escalation (Step 4/13)

| # | Test | Result |
|---|---|---|
| S6 | `member` role attempts `DELETE` on a department | **403** `requires permission: manage_departments` |
| S7 | `member` role attempts to change their **own** role to `org_owner` | **403** `requires permission: manage_members` |
| S8 | Org A's `org_owner` attempts `/eos/v6/dashboard` (platform-operator-only) | **403** |
| S9 | Org A's `org_owner` attempts `/revenue/dashboard` (platform-operator-only) | **403** |

**Being an organization owner grants zero platform-operator privilege.** Both authorization layers
(org RBAC vs. platform `role:"operator"`) are confirmed independent.

## Viewer role read-only enforcement

```
PATCH /orgs/.../members/<accountId>   {"orgRole":"viewer"}   (owner) → 200
POST /orgs/.../departments   (as viewer)   → 403 "requires permission: manage_departments"
GET  /orgs/.../departments   (as viewer)   → 200, real data returned
```

---

## Audit trail (Step 9/10)

```
GET /enterprise/audit/org_1786718762053_1/permission-history   (Org A owner)
→ 200
{"entries":[
  {"seq":291,"ts":"2026-08-14T14:48:28.565Z","type":"permission.member_added",
   "orgId":"org_1786718762053_1","actorId":"e3e9ded9f7a101ec3d4573b8",
   "targetAccountId":"33c4fb52d35e1c41f00788ec","orgRole":"member","source":"invite"},
  {"seq":258,"ts":"2026-08-14T14:46:02.066Z","type":"permission.org_created",
   "orgId":"org_1786718762053_1","actorId":"e3e9ded9f7a101ec3d4573b8","orgRole":"org_owner"}
],"total":2}
```

### Ground-truth verification (not trusting the API's own report)

```
grep "org_1786718762053_1|org_1786718779057_2" data/logs/audit.ndjson
→ Org A real events: ['permission.org_created', 'permission.member_added']
→ Org B real events: ['permission.org_created']
```
**Exact match.** No fabricated audit entries.

### Cross-org audit denial

```
GET /enterprise/audit/org_1786718779057_2/permission-history   (Org A owner)
→ 403  {"ok":false,"error":"Forbidden — requires permission: view_audit_log"}
```

---

## THE CENTRAL FINDING — `governance.js` was only tenant-isolated by accident

### Reproduction

```
GET /governance/policies?workspaceId=<operator's real workspace, Org A owner is NOT a member>
→ 403  {"error":"Not a member of this workspace"}
```
This looked correct — until direct testing of `governanceService.getPolicies()` in isolation
proved it performs **no membership check whatsoever**:
```js
function _ws(workspaceId) {
  const all = _read();
  if (!all[workspaceId]) { all[workspaceId] = { policies: [], ... }; _write(all); }
  return { all, ws: all[workspaceId] };
}
```
Direct call: `governanceService.getPolicies('ws_1786660472626_22971bc3')` → **succeeded**, returning
the operator's real policy, with zero authorization applied. And `governance.js`'s own route file
never imports or calls `requireWorkspaceMember` — only the non-blocking `attachWorkspace`.

### Root cause — isolated, reproduced

`backend/routes/security.js` (mounted earlier in `routes/index.js`) registers:
```js
router.use("/security", requireAuth);
router.use(attachWorkspace);        // <-- NO path argument
router.use(requireWorkspaceMember); // <-- NO path argument
```
Express applies an unscoped `router.use(fn)` to **every** request that reaches past that router
instance — not just `/security/*`. Since every route file in `index.js` is mounted at the app root
with `router.use(require("./whatever"))`, this genuinely intercepts later-registered routers too.
Reproduced in a minimal isolated Express app:
```
r1.use('/security', ...)        // scoped
r1.use((req,res,next)=>{...})   // UNSCOPED — fires for r2's routes too
app.use(r1); app.use(r2);
→ GET /governance/test logs "r1 UNSCOPED middleware for /governance/test"
```

### Confirming the accident was load-bearing

```
GET /governance/policies?workspaceId=<Org A owner's OWN real workspace>
→ 200  {"policies":[],"total":0}   (marker-instrumented — confirmed governance.js's real handler ran)

GET /governance/policies?workspaceId=<a workspace Org A owner is NOT a member of>
→ 403  "Not a member of this workspace"   (blocked by security.js's leaked middleware, NOT governance.js's own logic)
```
Removing the accident (e.g. a future refactor scoping `security.js`'s middleware correctly to its
own path, or reordering `index.js`) would silently reopen full cross-tenant read/write access to
every workspace's governance policies.

### Fix

`governance.js` now has its own, intentional gate:
```js
router.use("/governance", requireAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceMember);   // added — no longer relying on security.js's accident
```

### Negative test + live re-verification

```
GET /governance/policies?workspaceId=<other tenant's real workspace>   (Org A owner, post-fix)
→ 403  {"error":"Not a member of this workspace"}

GET /governance/policies?workspaceId=<Org A owner's OWN real workspace>   (post-fix)
→ 200  {"policies":[],"total":0}
```
Both correct: cross-tenant blocked, own-tenant works.

---

## OPERATIONAL HAZARD — a genuinely broken server produced hours of false signal

While investigating the governance mystery, extensive process forensics revealed:

1. **`backend/routes/runtime.js` had a real duplicate `const _pipelineOrch` declaration**,
   causing `SyntaxError` and preventing the server from starting at all. This was fixed
   independently by a **concurrent session** (confirmed: the file's syntax was valid moments
   later, with no edit from this session) — but every server-start attempt in between produced
   an orphaned, non-listening process while an *older*, already-running process kept silently
   answering requests, making a real bug look like inconsistent, unreproducible behavior.
2. **A concurrent Audit Track session was independently running its own `backend/server.js` on
   port 5050**, launched via a background shell script (`tmp/c5/c5-surfaces.cjs`) performing its
   own automated browser testing. Confirmed via `ps aux` — this was not interfered with.
3. **One of my own background-launch attempts accidentally bound to port 5050** (the same port as
   the Audit Track's server) due to an environment-variable propagation issue in a `nohup`
   invocation. This was detected via `lsof -ti:5050` and the offending process was killed within
   the same tool call, before any request was made to that port. **No interference with the Audit
   Track's own server process occurred** — its port was free again immediately after.

**Remediation:** every server process was enumerated and precisely identified by port before any
further testing; only processes confirmed to be mine were terminated. The final governance
fix was verified on a server confirmed via `lsof` to be a single, correctly-isolated process on
port 5133.

---

## Persistence (Step 14) — verified across a real restart

```
Before restart: 1,337 orgs on disk
[server killed, restarted clean]
After restart:  1,337 orgs on disk
Org A: present, 1 department, 1 team, member roster intact
```

---

## Cross-OS integration (Step 11/12) — Executive carry-forward unaffected

```
GET /org-executive/<Org A's workspace>/insights   (correct member)
→ 200, real _assertMember-checked composition (unchanged from the Executive OS pass)

GET /eos/v6/dashboard   (Org A owner, non-operator)
→ 403  Forbidden — operator access required   (Executive OS's EOS-1 fix, unaffected by this pass)
```
Neither of Executive OS's prior fixes (operator gate on `/eos/v6/*`, MRR disclosure) was touched or
weakened by this pass's single-file change.

---

## Build (Step 19)

```
CI=false npm run build
→ succeeds
```
B.23 artifact-integrity guard (`deploy.sh`, from the Developer OS pass) confirmed still present
(3 references to the guard's error strings). No frontend file was changed this pass.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** (baseline and final) |
| `tests/security/73-cross-org-isolation-verified` | **2/2** |
| `tests/security/24-workforce-org-idor` | **7/7** |

No test was modified, skipped, or weakened.
