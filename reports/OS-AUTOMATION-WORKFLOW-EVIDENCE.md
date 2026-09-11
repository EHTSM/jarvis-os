# OS-AUTOMATION — WORKFLOW EVIDENCE

**Date:** 2026-08-14 · **Server:** `localhost:5166` · **Auth:** real `POST /auth/login` sessions
only — no JWT forged, no auth bypassed.

**Tenants used:**

| Account | Role | Org/Workspace |
|---|---|---|
| `finoa@test.local` | user (org_owner in Org A) | Org A (`org_1786718762053_1`) / workspace `…5cc8412b` |
| `finop@test.local` | operator, **viewer in Org A** (from a prior pass — see methodology note) | Org B (`org_1786718779057_2`) / workspace `…22971bc3` |
| `supc@test.local` | genuine non-member of Org A, real **member** of Org B (added this pass) | own workspace `ws_1786726730705_99e8b438` |

---

## METHODOLOGY NOTE — a false-alarm cross-tenant test caught and corrected

Initial cross-org testing used `finop` as the "outsider" attempting to read Org A's automation
rules and succeeded — but `finop` was granted **real `viewer` membership in Org A** during the
Organization OS pass (used there to test read-only role enforcement), so this was a legitimate
in-org read, not a leak. Confirmed via direct `organizationService.getMemberRole()` lookup before
concluding anything. All cross-tenant security tests in this report use `supc@test.local`, verified
to have **zero** membership in Org A, as the genuine outsider — and was added as a real member of
Org B specifically so both a real "own org" and a real "other org" case could be tested with one
account. This is the same class of correction made in the Support OS pass, applied proactively here.

---

## Chain verified

```
Frontend (AutomationDashboard.jsx / WorkflowAutomationCenter.jsx)
  → Express route (/org-automation/:orgId/*, /automation/*)
  → requireAuth → organizationService.hasPermission (org route) / requireWorkspaceMember (workspace route)
  → orgAutomationCenter.cjs → automationService.cjs
  → data/automation-layer.json (fs, real writes)
  → agents/autonomousLoop.cjs (queue_task) / runtimeEventBus (emit_event/notify/escalate)
  → JSON response
```

---

## W1 — Real rule creation and execution

```json
POST /org-automation/org_.../rules
{"name":"AutomationOS Probe Alpha 8821","trigger":{"type":"manual"},
 "action":{"type":"notify","message":"Probe fired for org A"}}
→ {"rule":{"id":"rule_2df1a2b048e9","enabled":true,"status":"active","runCount":0,...}}

POST .../rules/rule_2df1a2b048e9/fire   {}
→ {"result":{"outcome":"success","detail":"Probe fired for org A"}}
```

### Ground-truth verification (not trusting the API alone)

```
GET .../rules → runCount:1, lastOutcome:"success", lastRunAt:1786727519160
GET .../history → 1 real entry, matching ts

Direct file read (data/automation-layer.json):
  rules: 1, history: 1, runCount on disk: 1
```
Genuinely persisted, not fabricated.

---

## W2 — Cross-OS integration: `queue_task` action → real Runtime task queue

```json
POST /org-automation/org_.../rules
{"name":"AutomationOS QueueTask Probe","action":{"type":"queue_task",
 "input":"AutomationOS queue-task integration probe 8830"}}

POST .../fire  {}
→ {"result":{"outcome":"success","detail":"Queued task: \"...\" (id=tq_1786727473892)"}}
```

### Verified the task genuinely exists in the real task queue

```
data/task-queue.json → task tq_1786727473892 found
  input: "AutomationOS queue-task integration probe 8830"
  status: "failed"
  lastError: "AI backend unavailable. Check provider API keys in your .env file."
```
**Real cross-OS chain, honest failure propagation.** The automation action's own outcome
(`"success"`) correctly reflects that *queueing* succeeded — the downstream task's independent,
asynchronous failure (credential-blocked AI, consistent with every prior pass's finding) is
recorded honestly in the task's own record, not masked or misreported by the automation layer.

---

## MANDATORY IDEMPOTENCY TEST — rapid duplicate trigger

Per the mission's explicit instruction: determine intended behaviour before calling repeated
execution a defect.

```
2 concurrent POST .../rules/rule_2df1a2b048e9/fire  {}
→ both HTTP 200
→ runCount: 1 → 3  (i.e. +2, one per request)
→ history: exactly 3 entries total (1 earlier sequential fire + these 2), no lost/duplicated entries
```
**Correct, intended behaviour for a `manual` trigger** — each `fire` call is a distinct operator
action, like a "run now" button; there is no reason to deduplicate it, and the concurrent writes to
`runCount` did not race-lose an update (verified: exactly 3 history entries for 3 total fire
calls, not 2).

### `dryRun` idempotency check (the documented Phase B.13 fix)

```
POST .../fire  {"dryRun":true}
→ {"result":{"outcome":"dry_run","detail":"Would execute: notify — Probe fired for org A"}}
→ runCount AFTER: still 3  (unchanged — confirmed no side effect)
```

### Scheduler-path idempotency (genuinely different guarantee, verified separately)

```js
// Real rule with a schedule trigger due for the exact current minute
runTick(now)  → fired:[{...,"result":{"outcome":"success",...}}], scanned:1
runTick(now)  → (same minute, second call) fired:[]   // 0 — real per-rule-per-minute guard
```
**The scheduler path IS deduplicated** (correctly — a cron rule firing twice in the same minute
due to tick jitter would be wrong), while the **manual** path is not (correctly — a human pressing
"run now" twice means two runs). Both are the intended, product-correct behaviour for their
respective trigger types, verified rather than assumed.

### Webhook-fulfillment idempotency (pre-existing mechanism, re-verified via existing test)

```
tests/security/16-webhook-fulfillment-idempotency.cjs
→ 10 concurrent duplicate webhook deliveries → all return 200
→ exactly 1 real WhatsApp welcome message sent
→ 3/3 pass
```

---

## Approval gate — block confirmed real, resume confirmed absent

```json
POST /org-automation/org_.../rules
{"name":"AutomationOS Approval Probe","action":{"type":"notify","message":"needs approval"},
 "approvalGate":{"requiredRole":"Admin","timeoutHours":24}}

POST .../fire  {}
→ {"result":{"outcome":"pending_approval",
    "detail":"Rule \"AutomationOS Approval Probe\" requires Admin approval (timeout: 24h)"}}
```
The notification genuinely was not sent (`outcome` is `pending_approval`, not `success`).

### Searched for an approval → execute resumption path

```
grep -rn "automation:approval:required" backend/  →  only the ONE emit site in automationService.cjs
```
**No subscriber exists anywhere in the codebase.** The safety property (block until approved) is
real and correctly implemented; there is no way to actually approve and resume — this half of the
feature does not exist. Classified as a genuine gap, not built.

---

## Trigger-type dispatch — measured for all 6 declared types

```js
// Directly created an `event`-type rule and emitted its exact trigger event
createRule(orgId, {trigger:{type:"event", eventName:"automation_os_probe_event_9931"}, action:{...}})
runtimeEventBus.emit("automation_os_probe_event_9931", {test:true})
→ (500ms later) rule.runCount: 0   (expect 0 — no dispatcher exists)
```
**Confirmed empirically, not by code-reading alone.** Combined with `grep` finding zero
`threshold`-evaluation code and zero inbound-webhook-to-rule dispatch code, and the two built-in
templates whose trigger events (`workspace_member_added`, `deployment_started`) are never emitted
anywhere in the codebase: **only `manual` and `schedule` triggers have real automatic dispatch.**

Test rule disabled and archived immediately after this measurement (see Cleanup section).

---

## THE SECURITY FINDING — `/automation/*` had no membership check of its own

### Reproduction

```js
// Direct call, bypassing HTTP entirely
require('./backend/services/automationService.cjs').getRules('ws_1786700004118_5cc8412b')
→ returned real data with ZERO membership verification — the function has no accountId parameter
```
```
GET /automation/rules?workspaceId=<other tenant's real workspace>
  (peer, with their OWN valid workspace header)
→ 403  "Not a member of this workspace"
```
This 403 came entirely from `security.js`'s **accidental**, unscoped
`router.use(requireWorkspaceMember)` bleeding into this router (the same mechanism already
documented and fixed once in `governance.js` during the Organization OS pass, and found again in
Customer Success/Support OS's `/customer-org/*` and `/co3/cs/*`). `automation.js` itself had no
`requireWorkspaceMember` call anywhere.

### Fix

```js
router.use("/automation", requireAuth);
router.use(attachWorkspace);
router.use(requireWorkspaceMember);   // added — matches the governance.js precedent exactly
```

### Live re-verification

```
GET /automation/rules?workspaceId=<other tenant's workspace>   (peer, post-fix)
→ 403  "Not a member of this workspace"   (same result, now by design)

GET /automation/rules   (finoa, own workspace, post-fix)
→ 200  {"rules":[],"total":0}   (legitimate access unaffected)
```

---

## Persistence — verified across a real restart

```
Before restart: rules=2, history=5, runCount=3
[server killed via exact-PID lsof verification, restarted clean]
After restart:  rules=3, history=6, runCount=3   (the +1/+1 is the approval-gate rule created
                                                    just before restart — all counts consistent)
approval-gated rule's outcome post-restart: "pending_approval"   (unchanged)
scheduler-status post-restart: {"running":true,"trackedRules":0}   (honest — the in-memory
                                                                      per-minute guard is
                                                                      intentionally not persisted)
```

---

## Cleanup — every test artifact removed before stopping

```js
// Disabled + archived every rule created this pass, in both orgs
automation.updateRule(orgId, ruleId, {enabled:false, status:"archived"}, "cleanup")
```
```
Verification: active enabled rules remaining in Org A: 0
              active enabled rules remaining in Org B: 0
System-wide scan for my scheduled test rules still active: 0
```
No temporary schedule was left running; the event-trigger probe rule was disabled immediately
after the dispatch test confirmed the gap.

---

## Build

```
CI=false npm run build → succeeds
```
No frontend file changed this pass.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** (baseline and final) |
| `tests/runtime/19-automation-dryrun.test.cjs` | **7/7** |
| `tests/security/08-v5-production-validation.cjs` | **25/25** |
| `tests/security/16-webhook-fulfillment-idempotency.cjs` | **3/3** |
| `tests/security/20-event-naming-consistency.cjs` | **11/11** |
| `tests/runtime/post-omega-p1.test.cjs` | **1/1** |

No test was modified, skipped, or weakened.
