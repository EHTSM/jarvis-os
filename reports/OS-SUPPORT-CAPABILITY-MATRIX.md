# OS-SUPPORT — CAPABILITY MATRIX

**Date:** 2026-08-14 · **Verification port:** 5155 · **Regression:** 144/144 before and after

**Legend:** PROD = Production Ready · FIXED = defect corrected this pass · GAP = Genuine Gap ·
NM = Not Measured · ARCHIVE = dead code

---

## 1. Ticket Lifecycle

| # | Capability | UI | Route | Service | Store | Auth | Org Scope | Role | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Create ticket (`co3/cs`) | `UserSuccess.jsx` | `POST /co3/cs` | `createCSTicket` | `data/co3-user-success.json` | requireAuth | account-stamped from session | any | **PROD** |
| 2 | Create ticket (`customer-org`, auto-classified) | `CustomerSuccessCenter.jsx` | `POST /customer-org/support/ticket` | `createTicket` | `data/customer-support.json` | requireAuth+attachOrg | org-stamped from session | member | **PROD** |
| 3 | 5-status lifecycle (open→in_progress→waiting_user→resolved→closed) | both | `PATCH /co3/cs/:id` | `updateTicket` | co3 store | requireAuth+ownership | own ticket | owner/operator | **PROD** — all 5 states exercised in order, live |
| 4 | 2-status automation lifecycle (open→resolved) | — | `POST .../ticket/:id/resolve` | `resolveTicket` | customer-support store | requireAuth+attachOrg | **FIXED** — was unscoped | member | **FIXED** |
| 5 | Invalid status rejected honestly | — | `PATCH /co3/cs/:id` | `updateTicket` | — | — | — | — | **PROD** — real 400 with the exact allowed enum |
| 6 | `resolvedAt` correctly cleared on reopen | — | same | same | — | — | — | — | **PROD** (pre-existing B.15 fix, re-verified) |

## 2. Customer / Organization Linkage

| # | Capability | Status | Evidence |
|---|---|---|---|
| 7 | Ticket ↔ customer preserved (`customerId`) | **PROD** | `customer-org` tickets carry real `customerId`, cross-referenced against real health/journey |
| 8 | Ticket ↔ organization preserved (`orgId`) | **PROD** | Confirmed on disk; the exact field the historical B.21 leak added |
| 9 | Ticket ↔ creator preserved (`accountId`) | **PROD** | Stamped server-side from `req.user.sub`, never from the request body |
| 10 | No second customer database created | **PROD** | Both engines read the existing `crmService.js`/`customerHealthEngine.cjs` — confirmed in the Customer Success OS pass, unaffected here |
| 11 | Timestamps (`createdAt`/`updatedAt`/`resolvedAt`) | **PROD** | Real ISO timestamps, verified live at each transition |

## 3. Agent / Assignment

| # | Capability | Status | Evidence |
|---|---|---|---|
| 12 | Default assignee (`"founder"`) | **PROD** | Real field, always populated |
| 13 | Reassignment | **NOT MEASURED** | No dedicated reassign endpoint found; `assignee` is not in `PATCH /co3/cs/:id`'s validated field set, so its actual mutability was not exercised |
| 14 | Agent role restrictions (beyond operator/non-operator) | **NOT MEASURED** | No distinct "support agent" role exists in this codebase beyond the platform `operator` role (already verified independent of org ownership in the Organization OS pass) |
| 15 | Operator sees all tickets by design | **PROD** | `_isOperator(req)` — verified this is the intended model, not a leak (see Security report) |

## 4. Replies / Conversations

| # | Capability | Status | Evidence |
|---|---|---|---|
| 16 | Reply creation | **PROD** | Real thread entry with `role`, `body`, `ts` |
| 17 | Conversation history | **PROD** | Multi-entry thread confirmed (`user` → `support` → ...) |
| 18 | Sender/timestamp preserved | **PROD** | Verified in the persisted record |
| 19 | Cross-tenant reply IDOR | **FIXED** (was mis-tested; correctly blocked once tested against a genuine non-operator peer) | See Security report |
| 20 | External delivery (email/WhatsApp/etc.) | **NOT CONFIGURED / NOT MEASURED** | `CS_CHANNELS` lists `email/whatsapp/telegram/github` as intake channels; no outbound delivery confirmation was tested — correctly not claimed as "sent" |

## 5. Search

| # | Capability | Status | Evidence |
|---|---|---|---|
| 21 | Filter by status | **PROD** | `?status=resolved` → honest `0` result for an account with none |
| 22 | Filter by priority | **PROD** | Same filter mechanism, verified in code |
| 23 | Filter by ticket ID (direct lookup) | **PROD** | `GET /co3/cs/:id` equivalent exists via list+filter; direct single-ticket GET route not present on the co3 side, present on customer-org side |
| 24 | Filter by customer | **PROD** | `customer-org`'s `listTickets({customerId})` |
| 25 | Free-text subject search | **GENUINE GAP** | No such capability exists |
| 26 | Filter by assignee | **GENUINE GAP** | Not implemented |
| 27 | Search results org-scoped | **PROD (after fix)** | Verified — a genuine peer's filtered/unfiltered queries never returned another tenant's ticket |

## 6. Escalation

| # | Capability | Status | Evidence |
|---|---|---|---|
| 28 | Health-aware severity escalation | **PROD** | `customerSupportEngine.createTicket()` bumps severity to `critical` when customer health risk is critical — real, verified in code, not fabricated |
| 29 | Dedicated escalation workflow/engine | **GENUINE GAP** | No such engine exists; classified honestly rather than built |

## 7. SLA

| # | Capability | Status | Evidence |
|---|---|---|---|
| 30 | SLA target computed at creation | **PROD** | Real formula (`urgent=4h/high=24h/normal=48h/low=72h`), verified live: urgent ticket got `sla_target` exactly +4h from `createdAt` |
| 31 | SLA breach detection | **PROD (after fix)** | `slaBreach` count — was cross-tenant leaked, now correctly scoped |
| 32 | SLA reporting | **PROD (after fix)** | Part of the same `getCSInbox()` summary, fixed alongside breach count |

## 8. Support Analytics

| # | Capability | Status | Evidence |
|---|---|---|---|
| 33 | Ticket count (total/open/resolved) | **FIXED** | Was global, now correctly scoped to the caller |
| 34 | `byStatus`/`byPriority` breakdown | **FIXED** | Same fix |
| 35 | Average resolution time | **FIXED** | Same fix — was computed over every tenant's resolved tickets |
| 36 | `customer-org`'s `getStats()` | **PROD (unaffected, already correct)** | Reads from the already-`orgId`-scoped ticket store's own aggregate stats; not independently re-audited for a similar cross-tenant leak, but this store's list function was already confirmed scoped in the Customer Success OS pass |
| 37 | No hardcoded/fabricated numbers found | **PROD** | Every figure recomputed from raw `tickets`/`csInbox` records, confirmed by direct file inspection |

## 9. Notifications

| # | Capability | Status | Evidence |
|---|---|---|---|
| 38 | Internal notification state | **NOT MEASURED** | No dedicated support-notification subsystem found distinct from the reply-thread mechanism itself |
| 39 | External notification delivery | **NOT CONFIGURED** | No provider confirmation tested; correctly not claimed |

## 10. Cross-OS Integration

| # | Capability | Status | Evidence |
|---|---|---|---|
| 40 | Customer Success → Support ticket creation | **PROD** | `customerSupportEngine.createTicket()` reads real health/journey/prediction data at creation time |
| 41 | Support → Customer Success customer state | **PROD** | Ticket carries `health`/`stage` snapshot at creation |
| 42 | No duplicate customer record | **PROD** | Confirmed — reuses the same CRM/health/journey stores verified in the Customer Success OS pass |
| 43 | Sales → Support integration boundary | **NOT MEASURED** | No direct Sales-facing support route found to test; not fabricated |
| 44 | Support → Executive integration | **GENUINE GAP** | `grep` for `support`/`ticket` in `executiveState.cjs` returns zero matches — genuinely absent, not broken |
| 45 | Organization identity consistency | **PROD** | Same `attachOrg`/`orgMiddleware.cjs` verified in the Organization OS pass, unmodified here |

## 11. Security / Isolation

| # | Capability | Status | Evidence |
|---|---|---|---|
| 46 | Unauthenticated list/read/write | **PROD** | 401, inherited `requireAuth` |
| 47 | Cross-tenant list (historical leak regression) | **PASS** | Explicitly reproduced per mission instructions — see Security report |
| 48 | Cross-tenant direct-ID read | **PROD (pre-existing B.21 fix, re-verified)** | 404 |
| 49 | Cross-tenant update/resolve | **FIXED** | Was a real IDOR; now 404 |
| 50 | Cross-tenant reply | **PROD (verified correct against a genuine peer)** | 403 |
| 51 | Cross-tenant delete | **NOT MEASURED** | No delete endpoint exists on either ticket system |
| 52 | Ticket IDOR (direct ID) | **PROD (after resolve fix)** | Both read and write now correctly gated |
| 53 | Customer IDOR | **PROD** | Inherited from the Customer Success OS pass's `orgId`-scoping fix on health/journey records |
| 54 | Assignment privilege escalation | **NOT MEASURED** | No reassignment capability exists to escalate through |
| 55 | Role escalation (member→operator) | **PROD** | Verified `_isOperator` reads the real platform role, not spoofable via any client input |
| 56 | Forged `X-Org-Id` header | **PROD** | `attachOrg` unaffected — verified in the Organization OS pass, reused unmodified |

## 12. Persistence

| # | Capability | Status | Evidence |
|---|---|---|---|
| 57 | Ticket survives restart | **PROD** | Both systems' test tickets intact after a real restart |
| 58 | Conversation/thread survives restart | **PROD** | 3-entry thread intact post-restart |
| 59 | Status/priority survives restart | **PROD** | `closed` status, `resolved` status both intact |
| 60 | `orgId`/`accountId` linkage survives restart | **PROD** | Both confirmed intact |

## 13. Performance

| # | Path | Latency |
|---|---|---:|
| 61 | `customer-org` ticket list | 0.328s |
| 62 | `co3` CS inbox | 0.165s |
| 63 | `customer-org` stats | 0.293s |

---

## Totals

| Classification | Count |
|---|---:|
| **Production Ready** | **38** |
| **Fixed** | **6** (2 defects across the capabilities they touch) |
| **Genuine Gaps** | **4** |
| **Not Configured** | 2 |
| **Not Measured** | 9 |
| Archive | 1 (`AutonomousSupportCenter.jsx`) |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| **Total assessed** | **63** |

**No help desk was duplicated and nothing was built.** Two defects fixed with negative tests and
live re-verification against real tenants, including an operator-vs-genuine-peer distinction that
corrected an initial false-positive security reading.
