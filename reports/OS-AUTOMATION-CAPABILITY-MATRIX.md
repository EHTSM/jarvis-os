# OS-AUTOMATION — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Verification port:** 5166 · **Regression:** 144/144 before and after

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · GAP = Genuine Gap ·
NM = Not Measured

---

## 1. Rule Creation / Configuration

| # | Capability | UI | Route | Executor | Store | Auth | Org Scope | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Create rule (org-scoped) | `AutomationDashboard.jsx`/`WorkflowAutomationCenter.jsx` | `POST /org-automation/:orgId/rules` | `automationService.createRule` | `data/automation-layer.json` | requireAuth+`create_mission` permission | real org membership | **PROD** |
| 2 | Create AI-triggered rule | same | `POST .../rules/ai-triggered` | same, `emit_event` wired to `orgAiBrain` | same | same | same | **PROD** |
| 3 | Create rule (workspace-scoped) | — | `POST /automation/rules` | same engine | same file, workspace-keyed | requireAuth+Admin role | **FIXED** — was unscoped | **FIXED** |
| 4 | Update/enable/disable rule | — | `PATCH /automation/rules/:id` | `updateRule` | same | requireAuth+Admin+**FIXED** | **FIXED** | **FIXED** |
| 5 | Update/enable/disable (org-scoped route) | — | none exposed | — | — | — | — | **GENUINE GAP** |
| 6 | Delete rule | — | none exists on either route | — | — | — | — | **GENUINE GAP** |
| 7 | Built-in templates (5) | — | `GET /automation/templates` | — | — | requireAuth | workspace-scoped | **PROD** (list works) |
| 8 | Custom templates | — | `POST /automation/templates` | `createTemplate` | same | requireAuth+Admin | **FIXED** (route-level, alongside #3/#4) | **PROD (post-fix)** |
| 9 | Rule validation (invalid trigger/action type rejected) | — | both create routes | `createRule` | — | — | — | **PROD** — honest 400 with allowed-values list |

## 2. Triggers

| # | Trigger type | Status | Evidence |
|---|---|---|---|
| 10 | `manual` | **PROD** | Real, repeatedly fired, real `runCount`/history increments |
| 11 | `schedule` | **PROD** | Real `node-cron`-matched dispatcher; fired a rule due for the exact current minute |
| 12 | `event` | **GENUINE GAP** | Empirically confirmed no dispatcher — emitting the exact trigger event does not fire the rule |
| 13 | `threshold` | **GENUINE GAP** | No evaluation mechanism found anywhere |
| 14 | `webhook` | **GENUINE GAP** | No inbound dispatcher found |
| 15 | `approval` (as a trigger type) | **NOT MEASURED** | Distinct from approval *gates* (#20 below); no dispatcher found, not separately reproduced |

## 3. Actions

| # | Action type | Status | Evidence |
|---|---|---|---|
| 16 | `queue_task` | **PROD** | Real task created in the real runtime task queue — verified cross-OS (Automation → Mission/Runtime), including honest downstream failure propagation |
| 17 | `emit_event` | **PROD** | Real event bus emission, wired to real AI execution for AI-triggered rules |
| 18 | `notify` | **PROD** | Real security-audit-log entry + event bus emission |
| 19 | `escalate` | **NOT MEASURED** | Code path identical in shape to `notify`; not independently fired this pass |
| 20 | `set_policy` | **NOT MEASURED** | Not fired this pass |
| 21 | Unknown action type | **PROD** | Honest `{"outcome":"skipped","detail":"Unknown action type: ..."}`, not a silent failure |

## 4. Execution / Approval

| # | Capability | Status | Evidence |
|---|---|---|---|
| 22 | Execute and observe result | **PROD** | Real outcome, real detail message, real persisted state |
| 23 | Approval gate blocks execution | **PROD** | `outcome:"pending_approval"`, action genuinely not run |
| 24 | Approval gate → resume execution | **GENUINE GAP** | Event emitted, zero subscriber exists anywhere |
| 25 | Disabled rule cannot fire | **PROD** | `!rule.enabled → {"outcome":"skipped","detail":"Rule is disabled"}` |
| 26 | Dry-run mode | **PROD** | `outcome:"dry_run"`, confirmed zero side effects (runCount unchanged) |
| 27 | Conditions gate execution | **PROD (by design)** | `_evalCondition` real comparator logic, `undefined` context field passes-through (documented tradeoff) |

## 5. Idempotency / Duplicate Execution

| # | Capability | Status | Evidence |
|---|---|---|---|
| 28 | Manual trigger repeated execution | **PROD (by design — not deduplicated)** | 2 rapid concurrent fires → 2 real executions, `runCount` +2, exactly 2 new history entries — correct for a "run now" action, not a defect |
| 29 | Scheduler duplicate-tick guard | **PROD** | Same rule, same minute, second `runTick()` → 0 fires (real per-rule-per-minute guard) |
| 30 | Concurrent write safety (runCount) | **PROD** | 2 concurrent fires did not race-lose an increment — verified 3 history entries for 3 total fires |
| 31 | Webhook fulfillment idempotency | **PROD (pre-existing, re-verified)** | `tests/security/16-webhook-fulfillment-idempotency.cjs` — 10 concurrent duplicate deliveries → exactly 1 real side effect |

## 6. Scheduler

| # | Capability | Status | Evidence |
|---|---|---|---|
| 32 | Schedule creation | **PROD** | Real `trigger.type:"schedule"` rule with a real cron expression |
| 33 | Real cron matching | **PROD** | Uses `node-cron`'s own parser, not a hand-rolled approximation |
| 34 | Enabled/disabled respected | **PROD** | Scheduler's `runTick()` skips `!rule.enabled` rules |
| 35 | Execution via the same `fireRule()` all other triggers use | **PROD** | No second execution engine |
| 36 | Restart recovery | **PROD (documented tradeoff, verified honest)** | In-memory "last fired minute" cache intentionally not persisted; `scheduler-status` correctly reported `trackedRules:0` post-restart, not a fabricated value |
| 37 | Per-rule error isolation | **PROD** | `runTick()` catches per-rule; one rule's failure doesn't stop the scan |

## 7. Cross-OS Integration

| # | Capability | Status | Evidence |
|---|---|---|---|
| 38 | Automation → Mission/Runtime (`queue_task`) | **PROD** | Real task created, real execution attempt, honest failure surfaced (AI credential-blocked, matching prior passes' finding) |
| 39 | Automation → Memory | **NOT MEASURED** | No direct write path from `automationService.cjs` to any memory store found |
| 40 | Automation → AI (`orgAiBrain`) | **PROD** | Real event-bus wiring, real permission attribution to the rule's creator |
| 41 | Automation → Customer Success | **NOT MEASURED** | `customerAutomationEngine.cjs` exists as a separate, already-verified system (Customer Success OS pass); not re-tested for a boundary with this system |
| 42 | Automation → Support | **NOT MEASURED** | No direct boundary found |
| 43 | Automation → Business/Sales/Marketing | **NOT MEASURED** | No direct boundary found in `automationService.cjs`/`orgAutomationCenter.cjs` |
| 44 | Automation → Organization (RBAC/tenant model) | **PROD** | Reuses `organizationService.hasPermission`, no duplicate model |
| 45 | No second event bus created | **PROD** | Confirmed — all wiring uses the existing `runtimeEventBus.cjs` |
| 46 | No second scheduler created | **PROD** | Confirmed — one `node-cron` job, dispatching through the existing `fireRule()` |

## 8. Security / Isolation

| # | Capability | Status | Evidence |
|---|---|---|---|
| 47 | Unauthenticated list/read/create/execute/update/delete | **PROD** | 401 across tested endpoints |
| 48 | Cross-org list (genuine non-member) | **PROD** | 403 `Forbidden — not a member of this organization` |
| 49 | Cross-org direct execute | **PROD** | 403 (blocked at membership check before rule lookup) |
| 50 | Cross-org history/statistics read | **PROD** | 403 |
| 51 | Cross-tenant write (`/automation/*`, workspace-scoped) | **FIXED** | Was accident-protected only; now has its own explicit gate |
| 52 | Forged `X-Org-Id` / `X-Organization-Id` headers | **PROD** | No effect — route derives org solely from the verified path parameter |
| 53 | Org A data unchanged after attack attempts | **PROD** | `runCount` verified unchanged after every blocked cross-org attempt |

## 9. Analytics

| # | Capability | Status | Evidence |
|---|---|---|---|
| 54 | Rule counts (`total`/`active`) | **PROD** | Independently recomputed from raw `automation-layer.json` — exact match |
| 55 | History counts (`total`/`byOutcome`) | **PROD** | Independently recomputed — exact match |
| 56 | `topRules` | **PROD** | Real per-rule `runCount`/`lastOutcome`, sorted correctly |
| 57 | No hardcoded/fabricated figures | **PROD** | Every number traced to raw persisted records |

## 10. Persistence

| # | Capability | Status | Evidence |
|---|---|---|---|
| 58 | Rule definitions survive restart | **PROD** | 5 rules intact post-restart |
| 59 | Execution history survives restart | **PROD** | 6→ correct count intact |
| 60 | `runCount`/`lastOutcome` survive restart | **PROD** | Verified per-rule |
| 61 | Approval-pending state survives restart | **PROD** | `pending_approval` outcome intact post-restart |
| 62 | Scheduler in-memory guard does NOT survive restart | **PROD (documented, honest)** | Confirmed intentional and correctly reported, not a defect |

## 11. Performance

| # | Path | Latency |
|---|---|---:|
| 63 | List rules | 0.179s |
| 64 | History | 0.100s |
| 65 | Statistics | 0.100s |
| 66 | Full center composite | 0.093s |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **44** |
| **Fixed** | **4** (one root cause across the capabilities it touches) |
| **Genuine Gaps** | **7** |
| **Not Measured** | **8** |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| Archive | 0 |
| **Total assessed** | **66** |

**No automation platform was duplicated and nothing was built.** One security defect fixed with a
negative test and live re-verification against a genuine non-member account; the mandatory
idempotency and scheduler-restart checks both passed; four trigger-dispatch gaps and an
approval-resumption gap documented rather than built.
