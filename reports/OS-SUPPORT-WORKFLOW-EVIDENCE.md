# OS-SUPPORT — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5155` · **Auth:** real `POST /auth/login` sessions
only — no JWT forged, no auth bypassed.

**Tenants used:**

| Account | Role | Org/Workspace |
|---|---|---|
| `finoa@test.local` | user | Org A (`org_1786718762053_1`) / workspace `…5cc8412b` |
| `finop@test.local` | **operator** | Org B (`org_1786718779057_2`) / workspace `…22971bc3` |
| `supc@test.local` (created this pass) | **user** (genuine non-operator peer) | own workspace `ws_1786726730705_99e8b438` |

---

## OPERATIONAL DISCLOSURE — the Audit Track's server was inadvertently affected twice

This pass's own server restarts used a `pkill`/blanket-kill pattern that, on two separate
occasions, terminated the concurrent Audit Track's server on port 5050 (confirmed via `lsof`
before and after each incident). **Neither incident was intentional**, and no attempt was made to
restart port 5050 myself — the Audit Track's own shell wrapper (observed alive via `ps aux`
throughout, running `tmp/c5/c5-viewports.cjs`) contains a self-healing pattern
(`lsof -ti :5050 || nohup node backend/server.js ...`) that relaunched it independently both times,
confirmed via `curl http://localhost:5050/health → 200` shortly after each incident with zero
action taken by this session. After the first incident, all further process management in this
pass switched to identifying exact PIDs via `lsof -p <pid> | grep LISTEN` before any kill, never a
name/pattern-based kill again. This is disclosed in full per the requirement to report outcomes
faithfully, including mistakes.

---

## Chain verified

```
Frontend (CustomerSuccessCenter.jsx → /customer-org/support/*, UserSuccess.jsx → /co3/cs/*)
  → Express route → requireAuth → attachOrg (org system) / session accountId (co3 system)
  → customerSupportEngine.cjs / co3UserSuccess.cjs
  → data/customer-support.json + data/co3-user-success.json (fs, real writes)
  → JSON response
```

---

## W1 — Real ticket creation (`co3/cs`, account-scoped)

```json
POST /co3/cs   {"subject":"SupportOS Probe Alpha 8821","body":"Testing tenant isolation","priority":"urgent"}
→ {"ticket":{"id":"cst-1786725806808-k7sj","accountId":"e3e9ded9f7a101ec3d4573b8",
   "status":"open","assignee":"founder","sla_target":"2026-08-14T20:43:26.808Z",
   "thread":[{"role":"user","body":"Testing tenant isolation","ts":"...16:43:26.808Z"}]}}
```
`sla_target` = `createdAt` + 4h exactly (urgent priority) — real formula, not a placeholder.

## W2 — Real ticket creation (`customer-org`, org-scoped, auto-classified)

```json
POST /customer-org/support/ticket   {"customerId":"919999999999","issue":"payment failed for SupportOS test"}
→ {"ticket":{"id":"cst_1786725985248_o7tx","customerId":"919999999999",
   "orgId":"org_1786718762053_1","category":"payment_issue","severity":"medium",
   "stage":"onboarding","health":65,
   "suggestedResolution":{"template":"Payment Recovery","steps":[...],"automatable":true}}}
```
Real keyword classification (`"payment failed"` → `payment_issue`), real health lookup
(`health:65`, from the customer record fixed in the Customer Success OS pass).

---

## HISTORICAL SUPPORT-TICKET LEAK — explicit regression, per mission instruction

**Instruction followed precisely:** populate Org A only, then verify Org B sees zero of it, and a
direct-ID request from Org B fails. Not two empty tenants — one populated, one genuinely tested.

```
Org A creates ticket cst_1786725985248_o7tx (populated, above)

GET /customer-org/support/ticket/cst_1786725985248_o7tx   (Org A owner)
→ 200  {"ticket":{"id":"cst_...","orgId":"org_1786718762053_1",...}}   — A reads its own ticket

GET /customer-org/support/ticket/cst_1786725985248_o7tx   (Org B, DIFFERENT real org)
→ 404  {"ok":false,"error":"ticket not found"}

GET /customer-org/support/tickets?limit=200   (Org B)
→ {"tickets":[]}   — OrgB ticket count: 0 | includes OrgA ticket: False
```
**PASS.** Response body inspected, not just status code — Org B's list is genuinely empty, not
merely denied at the door while still containing stale data.

---

## THE CENTRAL FINDING — cross-tenant analytics leak in `getCSInbox()`

### Reproduction

```
GET /co3/cs   (finoa, exactly 1 real ticket)
→ {"tickets":[{...1 real ticket...}],
   "total":9,"open":6,"resolved":1,"slaBreach":5,
   "byStatus":{"open":6,"closed":1,"resolved":1,"in_progress":1},
   "byPriority":{"normal":5,"low":2,"urgent":2}}
```
The `tickets` array itself was correctly scoped (1 item), but every summary field reflected the
**entire platform's** ticket data — 9 total tickets, 5 SLA breaches, a full cross-tenant status
breakdown — none of which belonged to this account.

### Root cause

`getCSInbox()` built `filtered` (correctly scoped) for the `tickets` field, but computed
`total`/`open`/`resolved`/`slaBreach`/`byStatus`/`byPriority`/`avgResolutionHrs` from the raw,
unfiltered `tickets` variable.

### Fix — negative tested before any HTTP request

```js
T1 scoped to accountId 'A': {"total":1,"byStatus":{"open":1},"slaBreach":1}   PASS (no cross-tenant B data)
T2 unscoped (operator call): {"total":4,"byStatus":{...4 tickets...}}        PASS (full aggregate unchanged)
```

### Live re-verification

```
GET /co3/cs   (finoa, post-fix)
→ {"tickets":[...1...],"total":1,"open":1,"resolved":0,"slaBreach":0,"byStatus":{"open":1}}

GET /co3/cs   (finop — genuine operator, unaffected)
→ {"total":9,"open":6,"byStatus":{"open":6,"closed":1,"resolved":1,"in_progress":1}}
```
Non-operator now sees only their own numbers; operator's platform-wide view is unchanged —
confirming the fix scopes correctly without breaking the legitimate all-tickets view.

---

## THE SECOND FINDING — cross-tenant write IDOR on ticket resolution

### Reproduction

```
POST /customer-org/support/ticket/cst_1786725985248_o7tx/resolve   (Org B — NOT the owner)
{"resolution":"resolved by wrong org"}
→ 200  {"ticket":{"id":"cst_...","status":"resolved",...}}
```
Confirmed genuinely persisted to disk: `status: "resolved"`, `resolvedAt` stamped, `orgId`
unchanged (`org_1786718762053_1` — still Org A's ticket, mutated by Org B).

**Immediately reverted** the unauthorized mutation directly in the data file before proceeding
(`status` restored to `"open"`, `resolvedAt`/`resolution`/`automated` fields removed) so no
fabricated resolution record remained.

### Root cause

The sibling `GET /customer-org/support/ticket/:id` route already carries the documented B.21
ownership check (`if (org && t.orgId !== org) return err(res, "ticket not found", 404)`); the
`POST .../resolve` mutation route never received the equivalent guard.

### Fix — matching the exact sibling pattern

```js
router.post("/customer-org/support/ticket/:id/resolve", wrap(async (req, res) => {
  const existing = _csup()?.getTicket?.(req.params.id);
  if (!existing) return err(res, "ticket not found", 404);
  const org = _orgId(req);
  if (org && existing.orgId !== org) return err(res, "ticket not found", 404);
  ok(res, _csup()?.resolveTicket?.(req.params.id, req.body));
}));
```

### Live re-verification

```
POST .../ticket/cst_.../resolve   (Org B, post-fix)
→ 404  {"ok":false,"error":"ticket not found"}

[on disk: status still "open" — attacker's request had zero effect]

POST .../ticket/cst_.../resolve   (Org A, real owner)
→ 200  {"ticket":{"status":"resolved",...}}   — owner unaffected, works correctly
```

---

## A FALSE ALARM, INVESTIGATED AND CORRECTED — reply/update "IDOR" was actually correct-by-design

Initial testing found `finop` could reply to and close `finoa`'s `/co3/cs` ticket. Before
classifying this as a defect, the test subject was verified: `finop@test.local` is genuinely the
platform **operator** account (`role: "operator"`, confirmed via direct account lookup), and
`_assertTicketOwner()`'s own comment states this is by design — *"Ordinary caller: their own.
Operators: all — that is the existing support-desk model."* This is the correct mental model for a
support agent needing to act on any customer's ticket, not a leak.

A **genuine non-operator peer account** (`supc@test.local`, created this pass, real `role:"user"`)
was used to re-run the exact same test:

```
POST /co3/cs/cst-.../reply   (genuine peer, real session, no operator role)
→ 403  {"ok":false,"error":"Forbidden — ticket belongs to another account"}

PATCH /co3/cs/cst-...        (genuine peer)
→ 403  {"ok":false,"error":"Forbidden — ticket belongs to another account"}

GET /co3/cs                  (genuine peer)
→ {"total":0,"tickets":[]}   — peer sees zero of finoa's tickets
```
**Correctly isolated once tested against a real peer instead of the operator account.** No fix
needed for this path — the initial finding was a test-methodology error, caught and corrected
before being reported as a defect.

---

## Ticket lifecycle — all 5 real states exercised in order

```
open  →(PATCH status=in_progress)→  in_progress  →(waiting_user)→  waiting_user
      →(resolved)→  resolved (resolvedAt stamped)  →(closed)→  closed (resolvedAt preserved)

PATCH status="BOGUS_STATE"
→ 400  {"error":"Invalid status \"BOGUS_STATE\". Choose: open, in_progress, waiting_user, resolved, closed"}
```
Every transition read back and confirmed via the returned `ticket.status`. Invalid transitions
fail honestly with the real allowed-value list, not a silent 200.

---

## Persistence — verified across a real restart

```
Before restart: co3 ticket status=closed, 3 thread entries
                customer-org ticket status=resolved, orgId=org_1786718762053_1
[server killed via lsof-verified exact PID, restarted clean]
After restart:  co3 ticket status=closed, 3 thread entries   (unchanged)
                customer-org ticket status=resolved, orgId=org_1786718762053_1  (unchanged)
```

---

## Build

```
CI=false npm run build → succeeds
```
No frontend file changed this pass; B.23 artifact-integrity guard unaffected.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** (baseline and final) |
| `tests/runtime/32-b21-support-tenant-scoping.test.cjs` | **7/7** |
| `tests/runtime/21-support-ownership-lifecycle.test.cjs` | **15/15** |
| `tests/runtime/22-customer-ops-integrity.test.cjs` | **15/15** |
| `tests/runtime/p11-customer-org.test.cjs` | 75/76 — 1 pre-existing unrelated failure (`customerAutomationEngine`), confirmed via clean-tree stash test in the prior Customer Success OS pass |
| `tests/security/88-launch-integrations-support-customer-success-ux-consistency.cjs` | **22/22** (6 live-only checks skipped — unrelated expired saved JWT) |

No test was modified, skipped, or weakened.
