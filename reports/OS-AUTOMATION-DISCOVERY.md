# OS-AUTOMATION — DISCOVERY REPORT

**Track:** OOPLIX OS #12 — Automation OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new automation platform was built.**
**Isolation:** Verification server on **port 5166**. The Audit Track's own concurrent server
(port 5050) was checked via `lsof` before and after every process action this pass — confirmed
untouched throughout, using the exact-PID discipline established after an incident in the prior
Support OS pass.

---

## 1. Method

Traced actual route mounts. Two genuinely different, complementary automation surfaces exist —
neither is a duplicate of the other.

---

## 2. Two real, complementary automation systems

| System | Route prefix | Tenant model | Role |
|---|---|---|---|
| **`automationService.cjs`** (K5 Enterprise Automation) | `/automation/*` (via `automation.js`) | Workspace | The real rules engine — 6 trigger types, 5 action types, approval gates, history, statistics |
| **`orgAutomationCenter.cjs`** (V5 Module 7) | `/org-automation/:orgId/*` | Organization | Org-scoped composition **over** the same `automationService.cjs` (orgId used directly as its workspaceId key — the same convention V5's other modules already use), plus a genuinely new scheduler and AI-execution wiring |

`orgAutomationCenter.cjs`'s own header comment is explicit about reuse: workflows/triggers reuse
`automationService.cjs` unchanged; scheduled jobs are the one genuinely new piece
(`orgAutomationScheduler.cjs`, because nothing previously read a rule's `trigger.cron` and fired
it); AI execution is wired through the *existing* `emit_event` action type and the *existing*
event bus, not a new action type — the file explicitly documents choosing this to avoid touching
`automationService.cjs`'s shared, closed action-type switch. This is real "extend, don't
duplicate" engineering, verified by reading the code, not assumed from the comment.

## 3. Backend Inventory

| File | Lines | Role |
|---|---:|---|
| `backend/services/automationService.cjs` | 389 | Rules engine: create/update/fire/dryRun/history/statistics, 6 trigger types, 5 action types, approval gates |
| `backend/services/orgAutomationCenter.cjs` | 212 | Org-scoped composition, AI-triggered rules, connector-policy gating |
| `backend/services/orgAutomationScheduler.cjs` | 131 | Real `node-cron`-driven dispatcher for `schedule`-type rules |
| `backend/routes/automation.js` | 108 (+9 this pass's fix) | Workspace-scoped CRUD, full rule lifecycle including update/enable-disable |
| `backend/routes/orgAutomationCenter.js` | 69 | Org-scoped subset: list/create/fire/history/statistics/scheduler-status/ai-runs — **no update, no delete exposed** |

Both route files carry documented prior hardening: `orgAutomationCenter.js`'s `fire` route
(Phase B.13 — a dropped `dryRun` flag silently converted every preview into a real execution).

## 4. Real trigger-type coverage — measured, not assumed

`automationService.cjs` declares 6 trigger types and validates rule creation against all of them.
**Live-tested dispatch for each:**

| Trigger type | Real dispatcher exists? | Evidence |
|---|---|---|
| `manual` | ✅ Yes | Direct `fireRule()` call via the `fire` API — tested repeatedly |
| `schedule` | ✅ Yes | `orgAutomationScheduler.cjs`'s real cron-matching dispatcher — tested with a rule due for the exact current minute, fired correctly |
| `event` | ❌ **No** | Empirically confirmed: created a rule with `trigger.type:"event"`, emitted its exact named event on the real event bus, `runCount` stayed `0` |
| `threshold` | ❌ **No** | No threshold-evaluation dispatcher found anywhere in the codebase |
| `webhook` | ❌ **No** | No inbound-webhook-to-rule dispatcher found |
| `approval` | ❌ **No** (as a *trigger* — approval as a *gate* on other rules is real and works, see §5) | No dispatcher fires a rule *because of* an approval decision |

**2 of 5 built-in templates reference event names that are never emitted anywhere else in the
codebase** (`workspace_member_added`, `deployment_started`) — confirmed by `grep` across the
entire repository. These templates would never fire in practice.

## 5. Approval gates — the block half works, the resume half does not exist

`_executeAction()`'s `approvalGate` handling is real: it correctly **prevents** the action from
running and emits `automation:approval:required`. Live-verified: a gated rule fired to
`outcome:"pending_approval"` with the notification genuinely not sent. **No subscriber to that
event exists anywhere in the codebase** — there is no "approve → execute" resumption path. The
safety property (block until approved) is real; the completion half (approve → actually runs) is a
genuine gap, not built.

## 6. Genuine defect found

**`automation.js` had no membership verification of its own.** `attachWorkspace` alone (no
`requireWorkspaceMember`) meant `automationService.cjs`'s functions — confirmed by direct call to
have zero internal membership checks — were reachable for any client-supplied `workspaceId`. The
route's only isolation was an accidental leak from `security.js`'s unscoped middleware (the same
root cause already documented in the Organization, Customer Success, and Support OS passes,
affecting `governance.js` and `/customer-org/*`/`/co3/cs/*` respectively). **Fixed** by adding the
same explicit `requireWorkspaceMember` gate the sibling `governance.js` fix already established as
the correct pattern — see Security report.

## 7. Genuine gaps (not fixed — documented)

1. `event`/`threshold`/`webhook` trigger types have no automatic dispatcher.
2. Approval-gate resumption (`approved → executed`) has no implementation.
3. `/org-automation/:orgId/*` exposes no update, enable/disable, or delete route — those
   capabilities exist in `automationService.cjs` and are reachable via the sibling
   `/automation/*` (workspace-scoped) route, but not through the org-scoped surface.
4. 2 of 5 built-in templates reference events that are never emitted.

---

**Outcome:** Automation OS is a recovery/verification target. One security defect found,
root-caused, fixed, negative-tested, and live-verified against real tenants. Four genuine gaps
documented rather than built. **0 systems built.**
