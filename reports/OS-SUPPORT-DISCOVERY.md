# OS-SUPPORT — DISCOVERY REPORT

**Track:** OOPLIX OS #11 — Support OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new help desk was built.**
**Isolation:** Verification server on **port 5155**. The Audit Track's own concurrent server
(port 5050) was observed and — per an operational error disclosed in full in the Workflow Evidence
report — was inadvertently killed twice by this session's process management and self-healed both
times via the Audit Track's own tooling, without further action from this session.

---

## 1. Method

Traced actual route mounts rather than guessing. No dedicated `support.js` route file exists —
ticket capability is served through two separate, real systems mounted under other route files.

---

## 2. Two real ticketing systems — not duplicates

| System | Route prefix | Tenant model | Role |
|---|---|---|---|
| **`customerSupportEngine.cjs`** | `/customer-org/support/*` (6 endpoints, via `customerOrg.js`) | **Organization** (`orgId`) | Auto-classified, CLE-suggested resolutions, health-aware severity escalation |
| **`co3UserSuccess.cjs`**'s CS module | `/co3/cs/*` (4 endpoints) | **Account** (`accountId`) | Real 5-status lifecycle, real SLA targets, real reply threads, operator-wide visibility |

These are genuinely different tools for different purposes, not a duplicate: the `customer-org`
engine is an **automation/triage** layer (auto-classifies issue text, suggests resolution
templates, escalates severity from customer health); the `co3` CS inbox is the **agent-facing
ticketing desk** (real conversation threads, real SLA due times, real status workflow). Both are
real and both were exercised.

## 3. Backend Inventory

| File | Lines | Role |
|---|---:|---|
| `backend/services/customerSupportEngine.cjs` | 249 | Ticket creation with auto-classification, CLE-hinted resolution suggestion, resolve |
| `backend/services/co3UserSuccess.cjs` (CS module) | ~350 of a larger file | Full ticket CRUD, 5-status lifecycle, SLA targets, reply threads, KB |
| `backend/routes/customerOrg.js` (support section) | 6 routes (+2 lines this pass's fix) | `attachOrg`-gated |
| `backend/routes/co3UserSuccess.js` (cs section) | 4 routes | `requireAuth`-gated, account-ownership enforced in-route |

Both route files were already touched once by prior hardening: `customerOrg.js`'s support routes
carry a documented "B.21" fix (tickets previously had no `orgId` at all — the exact historical leak
this pass was instructed to regression-test); `co3UserSuccess.js`'s ticket routes carry a
documented "Phase B.15" fix (invalid status values previously stored verbatim, corrupting
`getCSInbox()`'s status buckets).

## 4. Real lifecycle states — verified, not assumed

`co3UserSuccess.cjs` declares (and this pass live-verified all five, in order):
```
CS_TICKET_STATUS = ["open", "in_progress", "waiting_user", "resolved", "closed"]
CS_TICKET_PRIORITY = ["urgent", "high", "normal", "low"]
```
`customerSupportEngine.cjs` has only two states (`open`, `resolved`) — a simpler, automation-focused
model, not a defect; it is not the primary human-agent ticketing surface.

## 5. Real SLA implementation found

`co3UserSuccess.cjs`'s `createCSTicket()` computes a real due time:
```js
const slaHours = { urgent: 4, high: 24, normal: 48, low: 72 };
ticket.sla_target = new Date(Date.now() + slaHours[priority] * 3600_000).toISOString();
```
`getCSInbox()` computes real breach detection (`sla_target < now` for any non-terminal ticket).
Verified live: an `urgent` ticket created at 16:43 UTC received `sla_target: "...20:43:26..."` —
exactly +4h, not a fabricated placeholder.

## 6. Genuine defects found

1. **Cross-tenant analytics leak in `getCSInbox()`** — every summary field (`total`, `open`,
   `resolved`, `slaBreach`, `byStatus`, `byPriority`, `avgResolutionHrs`) was computed over the
   **unfiltered global ticket set**, even when the caller was correctly scoped to their own
   `accountId` in the `tickets` array itself. A non-operator with exactly 1 real ticket received
   `total:9, slaBreach:5`, and a full platform-wide status/priority breakdown. **Fixed.**
2. **Cross-tenant write IDOR on `/customer-org/support/ticket/:id/resolve`** — the sibling GET
   route already carried a B.21 ownership check; the resolve mutation route did not. A member of
   an unrelated organization successfully resolved another organization's ticket — confirmed
   persisted to disk (`status: "resolved"`). **Fixed.**

## 7. Genuine gaps (not fixed — documented)

3. No dedicated ticket search (by ID/customer/subject/status/priority/assignee) exists —
   `getCSInbox()`'s `status`/`priority`/`accountId` filters are the closest equivalent; there is no
   free-text subject search and no assignee filter.
4. No dedicated escalation engine — `customerSupportEngine.cjs`'s health-aware severity bump
   (critical health → forces critical severity) is the only escalation-adjacent logic found.
5. `AutonomousSupportCenter.jsx` (frontend) is a confirmed orphan — no import anywhere.
6. The accidental `security.js` cross-file middleware leak (documented in the Organization OS and
   Customer Success OS passes) affects `/co3/cs/*` and `/customer-org/support/*` identically to
   the other affected surfaces — a real org/account member without a matching *workspace*
   membership cannot reach either system. Confirmed fail-closed, not a security hole.

---

**Outcome:** Support OS is a recovery/verification target. Two defects found (one analytics leak,
one write-IDOR), root-caused, fixed, negative-tested, and live-verified against real tenants.
**0 systems built.**
