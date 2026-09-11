# Phase B.15 — Support Operations Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated as a real Customer Support organization. **Measured first, read source only after reproducing.** No new ticket engine, helpdesk, or storage.

**Test rig:** two accounts registered into two *separate* organizations — A (`org_1786268999285_3`) and B (`org_1786268999350_4`) — with unique markers (`B15SECRETALPHA`, `B15CSMARKERALPHA`, `B15OWNERSHIPALPHA`) so leakage was provable rather than inferred.

---

## Defects Reproduced and Recovered

### D1 — Support tickets had no ownership; any account could read and close another's (**CRITICAL**)

The CS inbox (`/co3/cs`) is the product's real helpdesk — `assignee`, `priority`, `sla_target`, `thread`, `channel`, `resolvedAt`. `createCSTicket()` has **always** accepted an `accountId`, and `getCSInbox()` has **always** supported an `accountId` filter. But the routes never forwarded `req.user.sub`, so every ticket stored `accountId: null` and the filter was unusable.

**Reproduced live, both directions:**

| Probe (account B against account A's ticket) | Before |
|---|---|
| B lists CS inbox | **sees A's ticket** |
| A's subject visible to B | `B15CSMARKERALPHA payout stuck` |
| A's full thread visible to B | including **`INTERNAL: customer is on trial`** |
| B `PATCH` A's ticket | **200** — `assignee → ORG_B_HIJACK`, `status → closed` |
| B injects into A's thread | **accepted** |
| Persisted to disk | **yes** — verified in `data/co3-user-success.json`, and survived a SIGKILL |

The legacy ticket store (`/customer-org/support/*`, 190 tickets) is worse still: `customerSupportEngine.cjs` contains **zero occurrences of `orgId`**, and `createTicket({customerId, issue, severity})` has no ownership parameter at all.

**Recovery (existing capability only):** stamped `accountId` from the verified session (`req.user.sub`, applied *after* the body spread so a client cannot forge ownership), pinned a non-operator's inbox view to their own tickets, and guarded `reply`/`PATCH` with an ownership assertion returning **403**. `accountId` is stripped from `PATCH` bodies — ownership is not a mutable field. Ownership is read through the existing `getCSInbox()` rather than a new accessor, so no service surface was added.

Two deliberate design decisions, both verified:
- **Operators keep the full desk view** (7/7 tickets) — that is the existing support-desk model, and the `accountId` filter still works for them to scope to one customer.
- **Legacy tickets (`accountId: null`) stay operable** — the check is conditional on `t.accountId`, so pre-existing support work is not stranded.

**Verified live after fix:** B sees **0** tickets, `PATCH` → **403**, `reply` → **403**, A's thread and internal note intact, A's own `PATCH` → **200**. In-process: operator 7, A 1, B 0.

### D2 — Invalid status/priority stored verbatim, silently deleting tickets from the backlog (**HIGH**)

`updateTicket()` wrote `status` and `priority` straight through with no check against the `CS_TICKET_STATUS` / `CS_TICKET_PRIORITY` enums this same module **already declares and already exports**.

**Reproduced:** `PATCH {"status":"DROP_TABLE"}` → **HTTP 200, stored verbatim**. So did `pending`, `bogus_status`, and `bogus_pri`.

**The measured consequence is what makes this severe:**

```
total = 3    open = 2    resolved = 0    slaBreach = 2
byStatus   = {'open': 2, 'DROP_TABLE': 1}
byPriority = {'normal': 2, 'bogus_pri': 1}
>>> open + resolved = 2  vs  total 3  →  1 ticket unaccounted
```

A ticket parked in an unrecognised state **vanishes from every operational bucket and from SLA-breach detection** — a support manager's backlog silently loses work, and the customer waits forever. The invalid `priority` also persisted across a restart, confirming durable corruption.

**Also reproduced (same function):** `resolvedAt` was set on `resolved` but **never cleared on reopen**, and `closed` never set it at all — inconsistent with `replyToTicket`, which treats both as terminal. Measured `resolve → reopen → close`: `resolvedAt` stayed pinned at the original timestamp through the reopen, so a reopened ticket **still counted as resolved** in `avgResolutionHrs`, understating real resolution time.

**Recovery:** validate against the constants that already exist (400 with the valid list named); stamp `resolvedAt` on both terminal states and **clear it on reopen**.

**Verified live:** `DROP_TABLE` → **400** `Invalid status "DROP_TABLE". Choose: open, in_progress, waiting_user, resolved, closed`; `pending` → **400**; `resolved` → **200**. Lifecycle now `resolved`→stamped, `open`→**null**, `closed`→stamped.

### D3 — Negative-limit cap bypass on the legacy ticket list (**MEDIUM**)

`/customer-org/support/tickets` used `parseInt(limit) || 50`, unclamped, so `?limit=-1` reached `Array.prototype.slice(0, -1)`.

**Measured:** `limit=-1` → **189 of 190** tickets; `limit=99999` → **190**. Exactly the negative-limit class recovered across 38 sites in Phase B.7; this site was missed because it lives in a customer route rather than a runtime one.

**Recovery:** the same clamp — `Math.max(1, Math.min(parseInt(limit) || 50, 500))`. Verified at both bounds: `-1 → 1`, `501 → 500`, `99999 → 500`, `abc → 50`.

**Regression (all three):** `tests/runtime/21-support-ownership-lifecycle.test.cjs` — **15 tests, 15/15 pass**. **Negative-tested: 13 fail** with all three fixes reverted. (The 2 that still pass assert pre-existing capability — the `accountId` filter and SLA derivation — and are correctly design-independent.)

---

## 1. Support Inventory Matrix

| Surface | Route prefix | Store | Live probe | Reality |
|---|---|---|---|---|
| **CS Inbox** (real helpdesk) | `/co3/cs` (4 routes) | `co3-user-success.json` → `csInbox` | **200** | assignee, priority, SLA, thread, channel, resolvedAt |
| **Legacy tickets** | `/customer-org/support/*` (6) | `customer-support.json` (197 KB) | **200** | 190 tickets, 43 resolved, category classifier |
| Customer Success plans | `/customer-org/success/*` (6) | same | **200** | 3 plans, health scores, churn prediction |
| Feedback (CO3) | `/co3/feedback` (3) | `csInbox` sibling | **200** | type/severity/status/votes |
| Feedback (Launch) | `/launch/feedback` (6) | `feedback.json` | **200** | voting + roadmap rollup |
| Knowledge Base | `/co3/kb` (5) | `kbArticles` | **200** | search + helpful/notHelpful rating |
| Crash intelligence | `/co3/crashes` (3) | `crashGroups` | **200** | grouping, regressions, affected users |
| Alpha support readiness | `/alpha/support` (2) | — | **200** | KB-article checks |
| Beta support readiness | `/beta/support` (2) | — | **200** | widget/bug-flow checks |
| Escalations | `/workforce/:id/escalations` | missionMemory | **200** | mission-step escalation |
| Revenue success health | `/revenue/success/*` (4) | — | **403** operator-gated | CREDENTIAL/PERMISSION scoped |
| **Total support-related routes** | **43** | — | **10/11 GET → 200, 1 → 403, 0 HTML** | — |

**Correction recorded:** my first inventory sweep reported only ~6 ticket routes because I keyword-searched `support|ticket|inbox`. The **primary helpdesk lives at `/co3/cs`** — the path says `cs`, not `support`. Re-running against the file's full route list found it. Every subsequent finding came from that surface.

## 2. Ticket Lifecycle Matrix

| Transition | CS Inbox (`/co3/cs`) | Legacy (`/customer-org/support`) |
|---|---|---|
| **Create** | ✅ 200, SLA + thread seeded | ✅ 200, category auto-classified |
| **Assign** | ✅ `assignee` at create (`founder` default) | ❌ no field |
| **Reassign** | ✅ `PATCH {assignee}` persisted | ❌ **404** no route |
| **Acknowledge** | ⚠️ via `status: in_progress` | ❌ **404** |
| **Investigate** | ✅ `waiting_user` / `in_progress` | ❌ **404** |
| **Reply / conversation** | ✅ thread appends, roles preserved | ❌ **404** |
| **Resolve** | ✅ `resolvedAt` stamped | ✅ 200 + resolution text |
| **Reopen** | ✅ `resolvedAt` now **cleared** (D2) | ⚠️ re-resolve only |
| **Close** | ✅ `resolvedAt` now stamped (D2) | ❌ no distinct state |
| **Archive** | ❌ **404** | ❌ **404** |
| **Single-ticket GET** | ❌ **HTML fallback** — no route | ✅ 200 JSON |
| **Status validation** | ✅ **400** on invalid (D2) | n/a |

**Correction recorded:** I first read `GET /co3/cs/:id` as **200** and nearly certified a single-ticket route. The body was the **SPA HTML fallback** (`content-type: text/html`) — the same trap as B.4. No such route exists.

Legacy lifecycle is `open → resolved` only; all 10 probed transitions returned `Cannot POST` (route-miss, confirmed by body).

## 3. SLA Matrix

| Control | Measured | Status |
|---|---|---|
| **SLA target derivation** | urgent **4h**, high 24h, normal 48h, low 72h | CERTIFIED |
| Verified live | `urgent` created 09:56:20 → `sla_target` 13:56:20 (**exactly 4h**) | CERTIFIED |
| **Breach detection** | `slaBreach = 2` — **matched my independent computation exactly** | CERTIFIED |
| Breach excludes terminal states | `status !== resolved && !== closed` | CERTIFIED |
| **Breach evasion via bad status** | An unrecognised status escaped breach detection | **Fixed (D2)** |
| SLA recalculated on priority change | ❌ `sla_target` unchanged when priority `urgent → high` | GENUINE CAPABILITY GAP |
| Response-time SLA (first reply) | ❌ only resolution-time targets exist | GENUINE CAPABILITY GAP |
| Automatic escalation on breach | ❌ breach is reported, never acted on | GENUINE CAPABILITY GAP |
| SLA on legacy tickets | ❌ no `sla_target` field | GENUINE CAPABILITY GAP |
| Business-hours / calendar | ❌ wall-clock only | GENUINE CAPABILITY GAP |

## 4. Assignment Matrix

| Capability | Result | Status |
|---|---|---|
| Default assignee | `founder` on every new ticket | CERTIFIED |
| Assign at create | `assignee` accepted | CERTIFIED |
| **Manual reassignment** | `PATCH {assignee:"eng-oncall"}` persisted and survived restart | CERTIFIED |
| Ownership transfer | Via `assignee`; `accountId` now immutable (D1) | CERTIFIED |
| **Cross-account reassignment** | Was **200 → `ORG_B_HIJACK`**; now **403** | CERTIFIED (after D1) |
| Assignee validation | ❌ any string accepted (no roster check) | GENUINE CAPABILITY GAP |
| Automatic / round-robin routing | ❌ none — always `founder` | GENUINE CAPABILITY GAP |
| Load balancing / capacity | ❌ none | GENUINE CAPABILITY GAP |
| Assignment history | ❌ overwritten in place, no trail | GENUINE CAPABILITY GAP |

## 5. AI Support Matrix

| Capability | Measured | Status |
|---|---|---|
| **Suggested resolution** | `POST /customer-org/support/suggest` → 200 with category, template, steps, `automatable`, `minutesSaved` | CERTIFIED |
| Category classification | 6 real categories across 190 tickets (`onboarding_stuck` 63, `feature_question` 22, `payment_issue` 21, `renewal_support` 21, `churn_risk` 20, `generic` 42) | CERTIFIED |
| Severity auto-escalation | Health `critical` → severity upgraded at create | CERTIFIED |
| **Knowledge retrieval** | `GET /co3/kb/search?q=payment` → 1 real hit | CERTIFIED |
| Lesson hints | `hints[]` sourced from `cle` | CERTIFIED |
| Churn-risk annotation | `churnRisk` on every suggestion | CERTIFIED |
| Mechanism | **Template + keyword classifier, not an LLM** | CERTIFIED WITH LIMITATIONS |
| AI thread summarisation | ❌ none | GENUINE CAPABILITY GAP |
| AI draft reply text | ❌ steps only, no customer-ready prose | GENUINE CAPABILITY GAP |
| KB relevance score | `score: None` — unranked | CERTIFIED WITH LIMITATIONS |

The AI support surface is honest: it never fabricates a reply, and it returns template steps rather than pretending to be generative.

## 6. Cross-system Matrix

| Link | Measured | Status |
|---|---|---|
| **Support → Customer Health** | `createTicket` reads `getHealthRecord()`; `health` stamped | CERTIFIED |
| **Support → Journey** | `stage` populated from `getJourney()` | CERTIFIED |
| **Support → Churn prediction** | `churnRisk` from `customerSuccessEngine.predict()` | CERTIFIED |
| **Feedback → Ticket** | `feedbackRef` verified: `fb-1786270758754-43bf` linked | CERTIFIED |
| **Support → Knowledge (lessons)** | `hints[]` from the engineering lesson store | CERTIFIED |
| **Support → KB** | `/co3/kb/search` returns real articles | CERTIFIED |
| Crash → Support | `crashGroups` present, `feedbackRef` available | CERTIFIED |
| Escalation → Workforce | `/workforce/:id/escalations` → 200 | CERTIFIED |
| **Support → Org (tenant)** | **No `orgId` anywhere in either engine** | **GENUINE CAPABILITY GAP** |
| Support → Memory | ❌ tickets not written to memory store | GENUINE CAPABILITY GAP |
| Support → AI cost ledger | ❌ no metering on support AI calls | GENUINE CAPABILITY GAP |
| Support → Engineering mission | ❌ no ticket→mission conversion | GENUINE CAPABILITY GAP |

## 7. Reporting Matrix

| Metric | Measured | Status |
|---|---|---|
| `total` / `open` / `resolved` | Accurate against the store | CERTIFIED |
| **`slaBreach`** | **2 — matched my independent recomputation exactly** | CERTIFIED |
| `byStatus` / `byPriority` | Correct rollups | CERTIFIED |
| `avgResolutionHrs` | Computed from `resolvedAt − createdAt` | CERTIFIED |
| **Reopened tickets polluting avg** | Was counted as resolved; now excluded (D2) | CERTIFIED (after D2) |
| **`open + resolved ≤ total`** | Was **violated** (2 vs 3); now holds | CERTIFIED (after D2) |
| Enum-declared vocabulary | `CS_TICKET_STATUS`, `CS_TICKET_PRIORITY`, `CS_CHANNELS` exposed to clients | CERTIFIED |
| Legacy stats | `total 190, resolved 43, avgResolutionMinutes 36, minutesSaved 1575` | CERTIFIED |
| Executive rollup | `/co3/executive` surfaces `cs.total/open/slaBreach` | CERTIFIED |
| Backlog aging | ❌ no age buckets | GENUINE CAPABILITY GAP |
| **CSAT / satisfaction** | ❌ KB articles rate-able; **tickets are not** | GENUINE CAPABILITY GAP |
| First-response time | ❌ not measured | GENUINE CAPABILITY GAP |
| Per-agent performance | ❌ none | GENUINE CAPABILITY GAP |

## 8. Recovery Matrix

SIGKILL of the live process, measured before/after.

| Signal | Before | After | Status |
|---|---|---|---|
| **Recovery time** | — | **~12 s** (PM2 auto-restart) | CERTIFIED |
| Health | 200 | **200** | CERTIFIED |
| CS tickets | 6 | **6** | CERTIFIED |
| Legacy tickets | 190 | **190** | CERTIFIED |
| Resolved count | 43 | **43** | CERTIFIED |
| `slaBreach` | 2 | **2** | CERTIFIED |
| Conversation threads | 4 msgs | **4 msgs** | CERTIFIED |
| Assignee / priority state | preserved | **preserved** | CERTIFIED |
| **Orphan / malformed tickets** | — | **0** | CERTIFIED |
| Store parseable | — | **yes** | CERTIFIED |
| In-flight write loss | — | none observed | CERTIFIED |
| Atomicity | Whole-file `writeFileSync`, **no** `.tmp`+rename | CERTIFIED WITH LIMITATIONS |

The write path is not atomic (unlike `agents/taskQueue.cjs`), so a crash *mid-write* could truncate the store. Not reproduced in this phase — recorded as a limitation, not a defect.

## 9. Multi-org Matrix

| Probe | Before | After | Status |
|---|---|---|---|
| B lists CS inbox | **sees A's ticket** | **0 tickets** | CERTIFIED (D1) |
| A's subject exposed | **yes** | no | CERTIFIED (D1) |
| A's **internal note** exposed | **yes** | no | CERTIFIED (D1) |
| B `PATCH` A's ticket | **200 (hijacked)** | **403** | CERTIFIED (D1) |
| B `reply` to A's thread | **accepted** | **403** | CERTIFIED (D1) |
| A acts on own ticket | 200 | **200** | CERTIFIED |
| Operator full desk view | 7 | **7** | CERTIFIED |
| Legacy tickets operable | yes | **yes** (not stranded) | CERTIFIED |
| `accountId` forgeable via body | — | **no** (stripped/overridden) | CERTIFIED |
| **Legacy `/customer-org/support/*`** | cross-org read **and** write | **still unscoped** | **GENUINE CAPABILITY GAP** |
| **Feedback surfaces** | A's item visible to B | **still visible** | **GENUINE CAPABILITY GAP** |
| `orgId` on any support record | **0 records** | **0 records** | GENUINE CAPABILITY GAP |

**Scope stated plainly:** D1 closes the **CS inbox** — the product's real helpdesk, the only surface with an ownership field to wire. The **legacy ticket store and the feedback surfaces remain cross-tenant readable**, because `customerSupportEngine.cjs` has no ownership parameter at all (0 `orgId` occurrences, `createTicket({customerId, issue, severity})`). Scoping those requires adding an ownership dimension to a storage model that has none — new capability, which this mission forbids. It is listed as G1, the top remaining gap.

**Correction recorded:** my *first* isolation probe reported "isolated" — B saw 0 of A's tickets. That was an artifact of the default `limit=50` hiding the newest ticket. Re-probing with `?limit=500` showed the leak immediately. The reassuring first result was wrong, and finding out why led directly to both D1 and D3.

## 10. Business Impact Matrix

| Impact | Before | After |
|---|---|---|
| **Customer A's support thread private** | **No** — B read subject, body, and the internal note verbatim | Yes — B sees 0 |
| **Another tenant can close your ticket** | **Yes** — reassigned to `ORG_B_HIJACK` and closed | No — 403 |
| **Another tenant can post as your support agent** | **Yes** | No — 403 |
| **Backlog completeness** | A bad status **deleted the ticket from open/resolved/slaBreach** — `open+resolved=2` vs `total=3` | Invariant holds; invalid status refused with 400 |
| **SLA breach detection evadable** | Yes, via an unrecognised status | No |
| **Resolution-time accuracy** | Reopened tickets still counted as resolved | `resolvedAt` cleared on reopen |
| Ticket-list cap | `?limit=-1` returned 189 of 190 | Clamped 1–500 |
| Operator desk view | Full | **Unchanged** (full) |
| Pre-existing support work | — | **Not stranded** (legacy tickets operable) |
| Durability | — | 6/6 tickets, threads, SLA state survived SIGKILL in ~12 s, 0 orphans |

## 11. Remaining Gap Matrix

| ID | Gap | Type | Severity |
|---|---|---|---|
| **G1** | **Legacy ticket store + feedback surfaces remain cross-tenant readable/writable.** `customerSupportEngine.cjs` has **0** `orgId` occurrences and `createTicket()` takes no ownership parameter; 190 tickets and all feedback items carry no owner. Scoping requires adding an ownership dimension the storage model lacks. | **GENUINE CAPABILITY GAP** | **Critical** |
| **G2** | **No audit trail for any support action.** 39,416 audit entries exist; **0** record ticket create/reply/assign/resolve/reopen/close — including the cross-org hijack I performed. Neither support service imports `auditLog`. | **GENUINE CAPABILITY GAP** | **High** |
| G3 | **No ticket-level CSAT.** KB articles are rate-able; tickets are not, so satisfaction is unmeasurable. | GENUINE CAPABILITY GAP | High |
| G4 | **No first-response-time SLA** — only resolution targets. | GENUINE CAPABILITY GAP | High |
| G5 | **No automatic escalation on SLA breach** — breach is reported, never acted on. No Support→Engineering→Executive chain for tickets. | GENUINE CAPABILITY GAP | High |
| G6 | **No automatic assignment** — every ticket defaults to `founder`; no routing, round-robin, load balancing, or roster validation. | GENUINE CAPABILITY GAP | Medium |
| G7 | **Attachments silently dropped** — `attachments` on a reply is discarded (thread messages keep only `body`/`role`/`ts`). Feedback *does* support `screenshot`/`videoRef`. | GENUINE CAPABILITY GAP | Medium |
| G8 | **No single-ticket GET for the CS inbox** — falls through to SPA HTML; clients must fetch the whole inbox. | GENUINE CAPABILITY GAP | Medium |
| G9 | **`sla_target` not recalculated on priority change** — urgent→high left the 4h target in place. | GENUINE CAPABILITY GAP | Medium |
| G10 | **Internal notes are not access-controlled** — `role:"internal"` is accepted but no route distinguishes agent-visible from customer-visible. | GENUINE CAPABILITY GAP | Medium |
| G11 | **No archive state and no assignment history** — reassignment overwrites in place. | GENUINE CAPABILITY GAP | Low |
| G12 | Support store writes are **not atomic** (no `.tmp`+rename), unlike `agents/taskQueue.cjs`. Not reproduced as data loss. | OBSERVATION | Low |
| G13 | Legacy lifecycle is `open → resolved` only — no assign/ack/reopen/close/archive routes (10/10 probed → 404). | GENUINE CAPABILITY GAP | Medium |
| G14 | KB search returns `score: None` — results unranked. | OBSERVATION | Low |
| G15 | Revenue-success health endpoints operator-gated; correctness unverifiable from a tenant account. | UNKNOWN (permission-gated) | Low |

---

## Final Support Certification

| Area | Classification |
|---|---|
| Support Inventory | **CERTIFIED** — 43 routes, 10/11 GET → 200, 0 HTML fallbacks, two real ticket systems |
| Ticket Lifecycle (CS inbox) | **CERTIFIED** — create→reply→reassign→resolve→reopen→close all verified |
| Ticket Lifecycle (legacy) | **GENUINE CAPABILITY GAP** — `open → resolved` only |
| SLA | **CERTIFIED WITH LIMITATIONS** — targets + breach detection exact; no response-time SLA, no auto-escalation |
| Assignment | **CERTIFIED WITH LIMITATIONS** — manual works; no automatic routing |
| Conversations | **CERTIFIED WITH LIMITATIONS** — threads + internal roles work; attachments dropped |
| AI Support | **CERTIFIED WITH LIMITATIONS** — real classification/KB/hints, template-based not generative, fabricates nothing |
| Cross-system Linkage | **CERTIFIED** — health, journey, churn, feedback, lessons, KB all genuinely wired |
| Escalation | **GENUINE CAPABILITY GAP** — mission escalation exists; no ticket escalation chain |
| **Multi-org Isolation (CS inbox)** | **CERTIFIED** (after D1) — 403 on cross-account read and write |
| **Multi-org Isolation (legacy + feedback)** | **GENUINE CAPABILITY GAP** — no ownership dimension exists |
| Reporting | **CERTIFIED** (after D2) — `slaBreach` exact, `open+resolved ≤ total` invariant restored |
| Recovery | **CERTIFIED** — 6/6 tickets, threads, SLA state survived SIGKILL in ~12 s, 0 orphans |
| **Audit** | **GENUINE CAPABILITY GAP** — 0 of 39,416 entries record a support action |
| Human Override | **CERTIFIED** — manual reassign, reopen, force-close, operator full-desk view all work |

### **Support Readiness: CERTIFIED WITH LIMITATIONS — with one critical residual gap (G1)**

**The most consequential finding was that support tickets had no owner.** The CS inbox is a genuine helpdesk — `assignee`, `priority`, `sla_target`, threaded conversations, five channels, five declared statuses — and `createCSTicket()` had always accepted an `accountId` while `getCSInbox()` had always supported an `accountId` filter. The routes simply never forwarded the authenticated user, so **every ticket stored `accountId: null` and the filter was dead code**. With two accounts in two separate organizations, account B read account A's ticket verbatim — including the note explicitly marked `INTERNAL: customer is on trial` — then reassigned it to `ORG_B_HIJACK` and closed it, and the change survived a SIGKILL. Wiring the field the product already had, plus a 403 ownership guard, closed it: B now sees 0 tickets and gets 403 on both write paths, while operators keep the full desk view and pre-existing tickets stay operable.

**The second defect quietly deleted work from the backlog.** `updateTicket()` never validated against the `CS_TICKET_STATUS`/`CS_TICKET_PRIORITY` enums it already declares *and exports to clients*. `PATCH {"status":"DROP_TABLE"}` stored verbatim with HTTP 200, and the inbox then reported `total=3` while `open+resolved=2` — the ticket disappeared from every operational bucket **and from SLA-breach detection**. A support manager's queue silently loses tickets and the customer waits indefinitely. The same function never cleared `resolvedAt` on reopen, so reopened tickets kept counting as resolved and understated real resolution time. Both are now correct, validated against the constants that already existed.

**What genuinely works is more than the surface suggested.** SLA targets derive correctly from priority (urgent → exactly 4h, verified to the second) and `slaBreach` matched my independent recomputation exactly. The full lifecycle — create, reply, reassign, resolve, reopen, close — persists and survives restart. Cross-system linkage is real, not decorative: tickets pull live customer health, journey stage and churn prediction at creation, `feedbackRef` links a bug report to its ticket, and KB search returns real articles. The AI support layer classifies across 6 categories over 190 real tickets and is honest about being template-based — it never fabricates a customer-ready reply. Recovery was clean: 6/6 tickets, threads, assignee and SLA state all intact after SIGKILL in ~12 s, with **0 orphans**.

**Two gaps are serious enough to name in the verdict.** First, **G1**: the legacy ticket store (190 tickets) and all feedback surfaces remain cross-tenant readable and writable, because `customerSupportEngine.cjs` contains **zero** `orgId` occurrences and `createTicket()` has no ownership parameter — closing it means adding an ownership dimension to a storage model that has none, which is new capability, not recovery. Second, **G2**: **not one of 39,416 audit entries records a support action** — not the tickets I created, the replies I posted, the reassignments, nor the cross-org hijack itself. Neither support service imports `auditLog`. For a support desk handling customer data, an unauditable action trail is a compliance problem, and it is a gap rather than a defect because the instrumentation was never there to restore.

**Three corrections to my own measurements**, each of which would otherwise have become a false finding: my first isolation probe reported **"isolated"** — an artifact of the default `limit=50` hiding the newest ticket, and re-probing with `?limit=500` exposed the leak immediately (investigating that false reassurance is what found both D1 and D3); `GET /co3/cs/:id` returned **200** which I nearly certified as a working route, but the body was the **SPA HTML fallback**; and my initial inventory missed the primary helpdesk entirely because I keyword-searched `support|ticket|inbox` and the real surface is `/co3/cs`. Separately, an early `hasHash: false` reading looked like accounts persisting without passwords — the stored record has a 161-char `passwordHash`, and `getByEmail` strips it before returning, which is correct hygiene rather than a defect.

**Validation hygiene:** the `ORG_B_HIJACK` assignee written during the breach reproduction was reverted to `founder`; the invalid `status`/`priority` values — including residue left by the reverted-fix negative test run — were repaired to valid enum members (**0 invalid statuses, 0 invalid priorities** remaining); my test tickets were left in place as evidence, and the two temporary regression fixtures self-clean. Regression **144/144 existing + 98/98 new (B.6–B.15)**, with the new suite negative-tested (**13 of 15 fail** with all three fixes reverted). Changes limited to `backend/routes/co3UserSuccess.js`, `backend/services/co3UserSuccess.cjs`, and `backend/routes/customerOrg.js` (**+93/−9**) plus one new test file. No merge, no push, no new ticket engine, no new support platform, no new storage.
