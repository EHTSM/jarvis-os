# OOPLIX V1 — Critical Findings Dossier

**Document ID:** OPX-CFD-001
**Product:** Ooplix (`jarvis-os`) 1.0.0-rc1
**Date of record:** 2026-08-13
**Branch of record:** `security/reality-completion`
**Classification:** Confidential — Investor / Enterprise Due Diligence

> **Generated document.** Finding bodies are copied verbatim from the committed
> certifications listed in §Sources — not paraphrased. Regenerate with
> `node docs/ooplix-audit-suite/scripts/build-findings-dossier.js` rather than editing by hand.

---

## Purpose

This is the document technical due diligence reads. For each critical finding it carries the
**reproduction**, the **measured evidence**, the **root cause with file references**, the **fix**,
and the **negative-tested regression** — in the auditor's original words, with original numbers.

A reader who wants the summary should read `MASTER_AUDIT_REGISTER.md`. A reader who wants to
verify that the summary is true should read this.

## Contents

| # | Phase | ID | Severity | Finding |
|---|---|---|---|---|
| 1 | B.5 | `D1` | 🔴 CRITICAL | [Automated backup omitted the entire customer dataset](#b5-d1) |
| 2 | B.5 | `D2` | 🔴 CRITICAL | [`deploy/rollback.sh` restore was a silent no-op](#b5-d2) |
| 3 | B.7 | `F1` | 🔴 CRITICAL | [Cross-tenant data leak via `X-Org-Id` header override](#b7-f1) |
| 4 | B.8 | `F1` | 🔴 CRITICAL | [The app was in an unbounded OOM restart loop for ~2 months](#b8-f1) |
| 5 | B.10 | `F1` | 🔴 CRITICAL | [Every new memory was destroyed by its own save](#b10-f1) |
| 6 | B.11 | `F1` | 🔴 CRITICAL | [Admission gate rejected 68.6% of all agent work](#b11-f1) |
| 7 | B.12 | `D1` | 🔴 CRITICAL | [Knowledge Graph was never indexed](#b12-d1) |
| 8 | B.15 | `D1` | 🔴 CRITICAL | [Support tickets had no ownership; any account could read and close another's](#b15-d1) |
| 9 | B.17 | `D1` | 🔴 CRITICAL | [The sole org owner could demote themselves, stranding the company permanently](#b17-d1) |
| 10 | B.19.3 | `F3` | 🔴 CRITICAL | [B19.1's keyboard recovery had silently regressed in full](#b19.3-f3) |
| 11 | B.19.4 | `F2` | 🔴 CRITICAL | [`overlayProps` carried a latent defect that would have hidden every dialog](#b19.4-f2) |
| 12 | B.19.4 | `F3` | 🔴 CRITICAL | [77 keyboard findings, all recoverable with the existing helper](#b19.4-f3) |
| — | A.1 | — | 🔴 CRITICAL | Two authorization gaps closed during recertification variant sweep. *(commit-evidenced, no certification document)* |
| — | A.4 | — | 🔴 CRITICAL | 'More' dropdown was inert — 74 of ~79 surfaces unreachable. *(commit-evidenced, no certification document)* |
| — | A.5 | — | 🔴 CRITICAL | Unbounded mission-fanout loops blocked the event loop; Engineering Workspace swallowed every pipeline failure. *(commit-evidenced, no certification document)* |
| — | A.8 | — | 🔴 CRITICAL | Runtime Console crashed with 4 TDZ errors; Memory Fabric crashed on every real memory node. *(commit-evidenced, no certification document)* |
| — | A.9 | — | 🔴 CRITICAL | Cross-org tenant isolation confirmed with real accounts; Executive Intelligence crash fixed. *(commit-evidenced, no certification document)* |
| — | A.11 | — | 🔴 CRITICAL | A.11.2 fixed F3 in full (15/15 silent user-mutations now report the real backend reason; root cause was four private API() helpers returning r.json() with no status check) and fixed the one rendered table overflowing mobile. Mobile drawers measured PASS. F4 classified as a design-system migration gap (58/59 live, 0 true duplicates); F5 refined from 66 to 29 genuinely convertible. R2 remains OPEN — three attempted fixes were measured, failed and reverted rather than left as dead CSS. *(commit-evidenced, no certification document)* |
| — | B.1 | — | 🔴 CRITICAL | Mission store retention cap removed a measured 483 ms event-loop block. *(commit-evidenced, no certification document)* |

**12 critical findings** extracted from 19 certification documents.
**7 further critical findings** are commit-evidenced only and recorded in the register.

---

## Critical Findings

<a id="b5-d1"></a>

### 1. B.5 `D1` — Automated backup omitted the entire customer dataset

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.5 — Disaster Recovery & Business Continuity Certification  ·  **Source:** `PHASE_B5_DISASTER_RECOVERY_CERTIFICATION.md`

`scripts/safe-backup.cjs` used a hardcoded allowlist that captured 9 files. Absent: **CRM (`leads.json`), organizations/RBAC (`organizations.json`), missions (`missions.json`), memory (`memory-store.json`), Product OS (`product-plans.json`), and the encrypted vault (`vault.json`)**.

This was not theoretical:
- `DISASTER_RECOVERY.md:22` explicitly promises "**CRM leads, task history, learning/memory data**" are recoverable.
- The nightly automation (`crontab` 03:00 **and** `ecosystem.config.cjs` 02:00) both invoke *this* script.
- `deploy/rollback.sh` restores the newest `jarvis_*.tar.gz`, which is always one of these archives.
- Verified `jarvis.db` holds only `tasks`, so the JSON stores were **not** redundant — this data existed in no backup at all.

Measured before fix: `data/` 675 MB / 542 stores → archive **340 KB / 10 files**.

**Fix:** added a `CORE_BUSINESS_FILES` list (8 stores) to `scripts/safe-backup.cjs`. `vault.json` holds AES-256-GCM ciphertext whose key derives from `JWT_SECRET` in `.env` — which is deliberately *not* backed up — so including it stores no usable plaintext.

**Re-verified:** archive now 17 files / 1.1 MB, and `ALPHA-SECRET-LEAD`, `PRECRASH-MARKER-B5` and `SecVal Alpha Corp` are all recoverable from it.

---

<a id="b5-d2"></a>

### 2. B.5 `D2` — `deploy/rollback.sh` restore was a silent no-op

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.5 — Disaster Recovery & Business Continuity Certification  ·  **Source:** `PHASE_B5_DISASTER_RECOVERY_CERTIFICATION.md`

Two archive layouts coexist and the script's own glob matched both:

| Producer | Archive root | `tar -xzf` result |
|---|---|---|
| `backup.sh` | `data/` | extracts into `data/` ✅ |
| `safe-backup.cjs` | `snapshot_<ts>/` | creates `snapshot_<ts>/`, **`data/` untouched** ❌ |

Because `safe-backup.cjs` runs nightly, its archive was almost always the newest match — so the default `bash deploy/rollback.sh` hit the broken path. Verification only polled `/health` for 200, which succeeded while still serving the *old* data, so the script printed **"Rollback complete"** having restored nothing.

**Reproduced** in an isolated sandbox: pre-seeded `data/leads.json` was still the original content after the "successful" restore, with a stray `snapshot_*/` directory alongside.

**Fix:** detect the archive root and handle both layouts; copy snapshot files into `data/` explicitly; `die` if 0 files were copied or the layout is unrecognized (never report success on an empty restore); never overwrite `.env` from `env-config-nonsecret.txt`.

**Re-verified** end-to-end: stale marker gone, 15 files restored, real customer data present, no stray directory.

---

<a id="b7-f1"></a>

### 3. B.7 `F1` — Cross-tenant data leak via `X-Org-Id` header override

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.7 — API Certification  ·  **Source:** `PHASE_B7_API_CERTIFICATION.md`

`attachOrg()` gave the `X-Org-Id` header unconditional precedence over the `:orgId` path param. Every route shaped `/orgs/:orgId/...` was gated by `requireOrgPermission()` (which checks `req.org.id`, i.e. the **header's** org) while the handler read `req.params.orgId` and served the **path's** org — a textbook confused deputy.

**Reproduced live 3/3.** An account holding membership in org A *only*:

```
GET /orgs/<orgB>/members   with  X-Org-Id: <orgA>   → 200 + org B's member roster
GET /orgs/<orgB>/members   (no header)              → 403   ← correct behaviour
```

Confirmed leaking on `/members`, `/departments` and `/teams`. Blast radius: 34 `:orgId` routes are permission-gated, and 12 route files read `req.params.orgId` (`organizations.js` alone has 29 uses). The other org domains (`enterprise/*`, `org-graph`, `org-agents`, `org-workspace`) resolve from `req.org` and were unaffected — verified: they returned 403 with and without the header.

**Root cause:** precedence order in `backend/middleware/orgMiddleware.cjs`. A `_attachOrgFromParam` wrapper in `organizations.js:84` already tried to address this by forwarding the param into `req.body.orgId` — but `req.body` is **last** in the precedence chain, so the header still won.

**Fix:** the `:orgId` path param now wins, because it identifies the resource being addressed and is therefore the only correct authorization subject. The header remains the tenant selector for routes carrying no `:orgId` (e.g. `/crm/lead`). This *narrows* what the header can do and never widens access.

**Verified:** all three routes now 403 with the header; own-org access, CRM header-selection and org context all still 200.
**Regression:** `tests/runtime/10-org-param-precedence.test.cjs` — 6 tests built on two **real** organizations. Negative-tested: **3 fail** with the fix reverted, 6/6 pass restored. (A first draft used non-existent org ids that resolved to `null` either way and passed without the fix — worthless, so it was rewritten.)

---

<a id="b8-f1"></a>

### 4. B.8 `F1` — The app was in an unbounded OOM restart loop for ~2 months

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.8 — DevOps Certification  ·  **Source:** `PHASE_B8_DEVOPS_CERTIFICATION.md`

Bringing the process under PM2 supervision immediately exposed a long-hidden defect:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**223 occurrences in `logs/pm2-err.log`, earliest 2026-06-06.**

Two independent misconfigurations combined:

| Setting | Was | Measured reality |
|---|---|---|
| `node_args --max-old-space-size` | **400 MB** | 459 MB RSS at t+2s; **390–882 MB** across 198 s |
| `max_memory_restart` | **512 MB** | below the normal operating range |

V8 aborted hard whenever the heap crossed 400 MB. PM2 restarted; the cycle repeated every ~25–30 s. And because each run survived **longer than `min_uptime` (15 s)**, PM2 counted every restart as *stable* — so `max_restarts: 5` never tripped and nothing ever escalated.

**Reproduced live:** restarts climbed 11 → 12 → 13 → 14 with uptime resetting to 3 s while RSS sat at 555–738 MB.

**Why it went unnoticed:** the process was not under PM2 at all (Phase B.5 R1). Running bare, nothing recorded the aborts or reacted to them.

**Fix** — sized from measurement, not guesswork, preserving the safety hierarchy `heap cap < ceiling`:

| Path | Setting | Now |
|---|---|---|
| PM2 | `--max-old-space-size` | 1024 MB |
| PM2 | `max_memory_restart` | 1536 MB |
| Docker | `CMD --max-old-space-size` | 1024 MB (was **also 400**) |
| Compose | `deploy.resources.limits.memory` | 1536m (was **512m**) |
| memoryTracker | `WARN/CRIT_HEAP_MB` | 900/990 (was 350/450 — inside the normal range, so pure noise) |

`Dockerfile.production` carried the identical 400 MB cap, so fixing only PM2 would have left the container path still crashing.

**Verified:** **restarts=0 and 0 new OOMs across a 198-second steady-state observation**, versus a crash every ~25–30 s before. RSS oscillates 390–882 MB — healthy GC, not a leak.
**Regression:** `tests/runtime/12-pm2-config.test.cjs` — 11 tests pinning the limit hierarchy across both deployment paths. Negative-tested: reverting to 400 MB/512M **fails** the heap-cap assertion.

---

<a id="b10-f1"></a>

### 5. B.10 `F1` — Every new memory was destroyed by its own save

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.10 — Memory Certification  ·  **Source:** `PHASE_B10_MEMORY_CERTIFICATION.md`

`memoryPersistenceLayer` caps the active store at `MAX_STORE_NODES = 2000` and evicts overflow ordered by **importance alone**. Measured on the live store:

| Fact | Value |
|---|---|
| Store occupancy | **2000 / 2000 — full** |
| **Minimum** importance present | **95** |
| Importance distribution | 95 × 1918, 99 × 44, 100 × 38 |
| `saveTypedMemory()` default importance | **60** |
| Existing nodes below 60 | **0** |

So any newly-learned memory was the lowest-ranked node in the map and was deleted inside the very same `_persist()` call that saved it — while `save()` still returned `{ saved: true }`.

**Reproduced deterministically** with a hard cutoff:

```
importance= 60  save->true  retrievable_after_save= *** NO — EVICTED ***
importance= 94  save->true  retrievable_after_save= *** NO — EVICTED ***
importance= 95  save->true  retrievable_after_save= YES
importance= 96  save->true  retrievable_after_save= YES
```

**Retrieval consequence, measured:** three distinctive memories written "successfully", then queried → **recall@8 = 0/3, precision@1 = 0/3**. Two of the three queries returned **zero** results. `memory-store.json` contained **0** matching entries.

**Why the store was saturated:** the autonomous RCA-playbook writer had written **1918 near-duplicate nodes at exactly importance 95** — 640 for `circuit_breaker_open_media` and 639 for `ai_service_timeout` alone. One subsystem's output had locked out all new learning.

**Fix** (`backend/services/memoryPersistenceLayer.cjs`) — no engine change, no cap change, no schema change:
1. **Grace window** — a node is never evicted for `EVICTION_GRACE_MS` (60 s) after creation, so a just-written memory is always readable back. Beyond the window, the original importance/age ordering applies unchanged.
2. **Usage recency added to ordering** — `usageCount` and `lastUsedAt` (already maintained by `load()`) now participate, which is what the surrounding comment ("frequently-recalled/important nodes survive longest") claimed but did not implement.
3. Falls back to the full node set if everything is inside the grace window, so the cap is still honoured rather than growing unbounded.

**Verified:**

| Check | Before | After |
|---|---|---|
| Save at importance 60/94/95 readable | NO / NO / YES | **YES / YES / YES** |
| recall@8 on 3 fresh memories | **0/3** | **3/3** |
| precision@1 | 0/3 | 2/3 |
| New memory rank in semantic search | MISS | **#1** |
| Store size | 2000 | 1999 (cap honoured) |
| Minimum importance in store | 95 | **1** — new memories can land |

**Regression:** `tests/runtime/14-memory-eviction.test.cjs` — 6 tests. **Negative-tested: 2 fail** with the original eviction; 6/6 pass restored.

---

<a id="b11-f1"></a>

### 6. B.11 `F1` — Admission gate rejected 68.6% of all agent work

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.11 — Agent Certification  ·  **Source:** `PHASE_B11_AGENT_CERTIFICATION.md`

`runtimeOrchestrator`'s resource governor rejects new dispatches when the heap is "critically high". The threshold was a hardcoded **450 MB**, chosen against the *old* `--max-old-space-size=400` envelope. Phase B.8 measured the app's real steady state at **390–882 MB RSS** and raised the V8 cap to 1024 MB (PM2 ceiling 1536 MB) — but this gate was never updated, leaving it at **44% of the heap budget**, i.e. inside the normal operating range.

**Measured on live data** (`data/agent-runs.json`):

| Metric | Value |
|---|---|
| Total recorded runs | 2000 |
| **Failed with `memory_pressure`** | **1371 (68.6%)** |
| Completed | 621 |
| Retries that failed identically | 643 |
| Time span | 19:43 → 22:52 the same day (ongoing) |
| Distinct error causes | **1** — `memory_pressure` only |

Sampling `/runtime/health/deep` returned `heapMb` of **501, 458.6, 425.4, 270.9, 482.6** — oscillating straight across 450, so agent work was admitted or rejected according to where GC happened to be, not real pressure. 3 of 5 samples were above the gate.

**Fix:** derive the limit from the process's actual V8 heap budget instead of hardcoding it, so it tracks `--max-old-space-size` and can never again drift below the operating range. 85% of `heap_size_limit`, env-overridable via `RUNTIME_MEMORY_PRESSURE_MB`, falling back to the previous 450 constant if the budget is unreadable.

Under production flags: `heap_size_limit` 1216 MB → gate **1034 MB** (was 450), comfortably above the measured 458–501 MB working range.

**Verified live** — isolating runs after the restart:

| Window | Runs | Completed | `memory_pressure` | Failure rate |
|---|---|---|---|---|
| Before fix | 2000 | 621 | 1371 | **68.6%** |
| **After fix** | 20 | **20** | **0** | **0.0%** |

**Regression:** `tests/runtime/16-agent-admission-gate.test.cjs` — 8 tests. **Negative-tested: 4 fail** with the hardcoded gate; 8/8 pass restored.

---

<a id="b12-d1"></a>

### 7. B.12 `D1` — Knowledge Graph was never indexed

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.12 — Knowledge System Certification  ·  **Source:** `PHASE_B12_KNOWLEDGE_CERTIFICATION.md`

| Measurement | Before | After |
|---|---|---|
| `lastIndexed` | **`null`** — no index had ever run | `2026-08-09T07:49:44Z` |
| Graph edges | **5** | **1526** |
| Graph nodes | 8 | **2321** |
| Node types linked | 4 | **10** |
| Relation types in use | 3 | **11** |
| `/graph/reasoning` output | empty | critical deps (inDegree 57), health 72 |
| `/graph/reasoning/executive` | empty | healthScore 72, **3 top risks** |
| `/graph/reasoning/recommendations` | empty | **7 actionable recommendations** |
| Index duration | — | **2737 ms** for 1432 edges |

**Recovery method:** `POST /graph/index` — an existing route calling the existing `knowledgeGraph.indexAll()`. Nothing added.

**Root cause (read only after measuring):** `indexAll()` is reachable from exactly one place — the manual `POST /graph/index` route (`backend/routes/graph.js:90`). Nothing schedules it: no cron entry, no boot hook, no PM2 job. The incremental counterpart `indexMission()` is wired into **one** call site (`autonomousEngineeringPlatform.cjs:415`), so ordinary mission creation does not reach the graph.

**Reproduced decay:** created a real mission via `missionMemory.createMission()` → graph edges unchanged (1436 → 1436, delta 0). The mission node was still *resolvable* (nodes derive from edges plus live lookup), so there is **no data loss** — the gap is edge staleness, not disappearance.

**Business impact of the recovery** — surfaced only after indexing:

| Output | Value |
|---|---|
| Executive health score | 72 |
| Top risks identified | 3 (highest: a lead with inDegree 57 flagged `critical`) |
| Recommendations generated | 7 |
| Notable | Recommendation #3 was **"Fix: memory_pressure"** — the graph independently surfaced the Phase B.11 admission-gate defect from its own data |

---

<a id="b15-d1"></a>

### 8. B.15 `D1` — Support tickets had no ownership; any account could read and close another's

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.15 — Support Operations Certification  ·  **Source:** `PHASE_B15_SUPPORT_CERTIFICATION.md`

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

---

<a id="b17-d1"></a>

### 9. B.17 `D1` — The sole org owner could demote themselves, stranding the company permanently

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.17 — Team & Workforce Certification  ·  **Source:** `PHASE_B17_WORKFORCE_CERTIFICATION.md`

`removeMember()` has always refused to delete the org owner — *"Cannot remove the org owner — transfer ownership first"* — but `updateMemberRole()` had **no equivalent guard**. It blocked *promoting* anyone to `org_owner`, and never checked whether it was demoting the last one. The same protection was bypassable by demotion instead of removal.

**Reproduced live** on the real 4-member organization. The sole `org_owner` PATCHed itself to `viewer` and received **HTTP 200**:

```
members: 4  →  org_owner count: 0   >>> ORG IS OWNERLESS
```

**The organization was then permanently unmanageable** — every recovery path measured:

| Attempted recovery | Result |
|---|---|
| ex-owner `DELETE /orgs/:id` | **403** — no longer owner |
| ex-owner PATCH self back to `org_owner` | **403** |
| ex-owner `PATCH /orgs/:id` (update_org) | **403** |
| `org_admin` promotes anyone to owner | **400** `Use transferOwnership to assign org_owner` |
| `org_admin` `DELETE /orgs/:id` | **403** — `delete_org` is owner-only |

**And `transferOwnership` does not exist.** `organizationService` exports **39 functions** and none is named that — the identifier appears **only inside that error string**. `POST /orgs/:id/transfer-ownership`, `/transfer` and `/owner` all return **404**. So the instruction *both* guards give — "transfer ownership first" — is impossible to follow. Nothing in the product could recover the organization; I had to repair `data/organizations.json` by hand.

This is the workforce equivalent of losing the only key to the building: the company still exists, still holds members, departments, teams and missions, but no one can administer it, hand it over, or delete it.

**Recovery:** mirror the guard `removeMember` already has, scoped precisely to the **last** owner:

```js
if (m.orgRole === "org_owner" && newRole !== "org_owner") {
    const owners = org.members.filter(x => x.orgRole === "org_owner");
    if (owners.length <= 1) {
        throw new Error("Cannot demote the last org owner — transfer ownership first");
    }
}
```

Placed in the **service**, not the route, so every caller (HTTP, SCIM group-sync, scripts) passes through it. The route already defaults these errors to **400**, matching the DELETE guard's behaviour.

**Verified live — the fix is narrow, and legitimate workforce operations are untouched:**

| Operation | Result |
|---|---|
| **last owner → viewer** | **400** `Cannot demote the last org owner — transfer ownership first` |
| **last owner removal** (pre-existing guard) | **400** — unchanged |
| step-down **with a second owner present** | **200** — hand-over still works (verified: owners 2 → 1) |
| demote non-owner `team_lead → member` | **200** |
| promote `member → dept_lead` | **200** |
| demote / restore `org_admin` | **200 / 200** |
| invalid role (`emperor`) | **400** `Invalid orgRole` |
| direct promotion to `org_owner` | **400** — still blocked |

**Store-wide audit:** **0 of 933 active organizations** (1068 total) are ownerless — the one I created during reproduction was the only instance, and it is repaired.

**Regression:** `tests/runtime/23-workforce-ownership.test.cjs` — **11 tests, 11/11 pass**. **Negative-tested: 4 fail** with the fix reverted.

---

---

<a id="b19.3-f3"></a>

### 10. B.19.3 `F3` — B19.1's keyboard recovery had silently regressed in full

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.19.3 — Accessibility Final Closure Certification  ·  **Source:** `PHASE_B19_3_ACCESSIBILITY_CLOSURE_CERTIFICATION.md`

**Reproduction.** `tests/runtime/26-accessibility-foundation` failed on two
guards it was written to protect:

```
components/AgentRegistryCenter.jsx lost its Escape binding
tabs must use roving tabindex
```

**Measured evidence.** Both B19.1 recovery hooks still existed on disk and were
imported by **zero** files:

```
grep -rl "useEscapeKey"      frontend/src --include=*.jsx   → (empty)
grep -rl "useClickableProps" frontend/src --include=*.jsx   → (empty)
```

The consequences, measured:

- **12 modals** could be dismissed only by clicking the backdrop — a mouse-only
  affordance that traps a keyboard user inside the dialog.
- **157 rows/cards** carrying `onClick` on a plain `<div>` had no focus stop and
  no Enter/Space activation: real controls to a mouse, non-existent to a keyboard.
- `CodeEditorPane`'s `role="tab"` nodes had no `tabIndex` and no key handler, so
  the editor tab bar was entirely unreachable by keyboard.
- The settings `Toggle` had `role="switch"` + `aria-checked` but **no accessible
  name**, and defaulted to `type="submit"` inside a form.
- The operator command input's `aria-describedby="cmd-risk-hint"` pointed at an
  element that did not exist, so its destructive-command warning was never
  announced.

**Root cause.** The hooks were never deleted, but every call site was lost —
most likely in a bulk revert. Because `tests/` is `.gitignore`d (recorded in
B19.2.2), the guards that would have caught this were not running in CI.

**Fix.** Rebound Escape on all 12 modals to the *same* handler each backdrop
`onClick` already calls; restored `clickableProps()` on 115 of the 157 clickable
elements; added roving tabindex + Arrow/Home/End to the tab bar; gave the Toggle
an `aria-labelledby` pointing at its existing visible label plus `type="button"`;
and created the missing `#cmd-risk-hint` element with `role="status"`.

The clickable codemod is deliberately conservative — it rewrites only the
unambiguous single-line `<div|span className onClick={expr}>` shape and **leaves
72 sites alone**, reporting them, because overlay backdrops need `overlayProps`
and Escape rather than a focus stop, and a wrong transform silently breaks a
control.

**Negative-tested:** two earlier placement passes were caught and corrected
before commit — one inserted a hook inside a `.map()` callback (a hook in a
loop), the other placed it before the `useState` it closed over (temporal dead
zone). Both were found by verifying declaration order, not by the build, which
compiled cleanly in both cases.

**Regression.** `26-accessibility-foundation` 16/22 → 20/22; keyboard/form
findings 931 → 843; runtime 144/144; live scan unchanged at 0/0.

---

---

<a id="b19.4-f2"></a>

### 11. B.19.4 `F2` — `overlayProps` carried a latent defect that would have hidden every dialog

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.19.4 — Keyboard & ARIA Recovery Certification  ·  **Source:** `PHASE_B19_4_KEYBOARD_ARIA_CERTIFICATION.md`

**Reproduction.** Converting overlays to the repo's own `overlayProps()` helper
was the obvious recovery for 28 findings. Reading the helper before applying it:

```js
// "Marked aria-hidden so the backdrop itself is not announced;
//  the dialog above it carries the accessible content."
export function overlayProps(onDismiss) {
  return { onClick: …, 'aria-hidden': true };
}
```

**Measured evidence.** The comment assumes the dialog is a **sibling** of the
backdrop. Every modal in this codebase nests the panel **inside** the overlay:

```
<div className="arc-modal-overlay">            ← overlayProps would go here
  <div className="arc-modal" role="dialog">    ← its CHILD
```

`aria-hidden` is inherited by descendants. Spreading this helper would have
removed all 15 dialogs — title, fields and all — from the accessibility tree,
silently defeating the `role="dialog"` semantics recovered in F1. That is a
worse defect than the one the helper exists to fix.

**Root cause.** The helper was written against an assumed DOM shape that does
not occur anywhere in this repository.

**Fix.** Removed the inherited `aria-hidden`; the click behaviour (dismiss only
when the backdrop itself is the target) is unchanged and is the helper's actual
purpose. A call-site note records how to mark a genuinely bare backdrop.

**Regression.** `tests/runtime/28` — "overlayProps does not set aria-hidden",
negative-tested against a reintroduction.

---

---

<a id="b19.4-f3"></a>

### 12. B.19.4 `F3` — 77 keyboard findings, all recoverable with the existing helper

**Severity:** 🔴 CRITICAL  ·  **Phase:** B.19.4 — Keyboard & ARIA Recovery Certification  ·  **Source:** `PHASE_B19_4_KEYBOARD_ARIA_CERTIFICATION.md`

**Reproduction.** 75 `KBD-CLICK-NO-KEYBOARD` plus two singletons: rows, cards
and overlays carrying `onClick` on a plain `<div>`/`<span>` — real controls to a
mouse, non-existent to a keyboard.

**Measured evidence.** `hooks/useClickableProps.js` already provides exactly the
two helpers needed, and documents which applies where. B19.2.3 recovered 115
sites but deliberately skipped the ambiguous shapes.

**Fix — recovery only, in four passes.**

| Pass | Shape | Helper | Count |
|---|---|---|---:|
| 1 | multi-statement handlers (balanced-brace reader) | `clickableProps` | 12 |
| 2 | elements also carrying `style={{…}}` | `clickableProps` | 20 |
| 3 | overlay/backdrop containers (unblocked by F2) | `overlayProps` | 40 |
| 4 | multi-line openings, hand-verified | `clickableProps` | 2 |

Two half-implemented ARIA patterns were also completed: the `App.jsx` pin
control had `role="button"` + `aria-label` but no `tabIndex` or key handler, and
`MissionControl`'s `Tile` had `role` + `tabIndex` but no key handler.

**Result.** All three keyboard rules at **0**.

---

---

## High-Severity Findings — Index

Full bodies are in the source certifications; this index exists so the dossier is a complete
map of what was found rather than only the worst of it.

| Phase | ID | Finding | Source |
|---|---|---|---|
| B.5 | `D3` | The DR validation test could not fail | `PHASE_B5_DISASTER_RECOVERY_CERTIFICATION.md` |
| B.7 | `F2` | Negative `limit`/`n` bypassed result caps | `PHASE_B7_API_CERTIFICATION.md` |
| B.8 | `F2` | `deploy/update.sh` reported success having deployed nothing | `PHASE_B8_DEVOPS_CERTIFICATION.md` |
| B.9 | `F1` | `/jarvis` reported false success on total AI failure | `PHASE_B9_AI_INTELLIGENCE_CERTIFICATION.md` |
| B.10 | `F2` | Recalled memory never reached the AI context | `PHASE_B10_MEMORY_CERTIFICATION.md` |
| B.11 | `F2` | Emergency stop could not be undone for 95% of the fleet | `PHASE_B11_AGENT_CERTIFICATION.md` |
| B.12 | `D2` | Every reindex leaked a duplicate edge | `PHASE_B12_KNOWLEDGE_CERTIFICATION.md` |
| B.13 | `D1` | `dryRun` was silently dropped: every "preview" executed for real | `PHASE_B13_AUTOMATION_CERTIFICATION.md` |
| B.14 | `D1` | Org AI spend was structurally unreportable | `PHASE_B14_FINANCE_CERTIFICATION.md` |
| B.15 | `D2` | Invalid status/priority stored verbatim, silently deleting tickets from the backlog | `PHASE_B15_SUPPORT_CERTIFICATION.md` |
| B.16 | `D1` | Three customer statistics endpoints were unreachable | `PHASE_B16_CUSTOMER_OPERATIONS_CERTIFICATION.md` |
| B.16 | `D2` | Two customer-reporting surfaces disagreed on the same question | `PHASE_B16_CUSTOMER_OPERATIONS_CERTIFICATION.md` |
| B.18 | `D1` | Every dead-letter entry was anonymous, so a failure backlog could not be triaged | `PHASE_B18_BUSINESS_CONTINUITY_CERTIFICATION.md` |
| B.19 | `D1` | Primary navigation was invisible in light mode (**HIGH**, WCAG 1.4.3 + 2.5.8) | `PHASE_B19_ACCESSIBILITY_CERTIFICATION.md` |
| B.19.3 | `F1` | A B19.2.2 whitelist entry hid 21 real contrast defects | `PHASE_B19_3_ACCESSIBILITY_CLOSURE_CERTIFICATION.md` |
| B.19.3 | `F2` | "Fixed-dark" was being used to excuse failing contrast | `PHASE_B19_3_ACCESSIBILITY_CLOSURE_CERTIFICATION.md` |
| B.19.4 | `F1` | Dialog semantics existed in five components and were absent from ten | `PHASE_B19_4_KEYBOARD_ARIA_CERTIFICATION.md` |
| B.19.4 | `F5` | Form labelling is a GENUINE CAPABILITY GAP, not recoverable | `PHASE_B19_4_KEYBOARD_ARIA_CERTIFICATION.md` |

**18 high-severity findings** recorded across the certification set.

---

## Regression Evidence

A regression test that passes against the *un-fixed* code proves nothing. Every suite below was
verified to fail before the fix landed; the `Negative-tested` column records how many of its
assertions fail when the fix is reverted.

| Phase | Finding | Test suite | Tests | Negative-tested |
|---|---|---|---|---|
| B.7 | `F1` | `tests/runtime/10-org-param-precedence.test.cjs` | 6 | see source |
| B.8 | `F1` | `tests/runtime/12-pm2-config.test.cjs` | 11 | see source |
| B.10 | `F1` | `tests/runtime/14-memory-eviction.test.cjs` | 6 | **2 fail** without the fix |
| B.11 | `F1` | `tests/runtime/16-agent-admission-gate.test.cjs` | 8 | **4 fail** without the fix |
| B.7 | `F2` | `tests/runtime/11-limit-clamp.test.cjs` | 6 | see source |
| B.9 | `F1` | `tests/runtime/13-ai-honesty.test.cjs` | 7 | **2 fail** without the fix |
| B.10 | `F2` | `tests/runtime/15-memory-context-injection.test.cjs` | 6 | **2 fail** without the fix |
| B.11 | `F2` | `tests/runtime/17-agent-supervisor-restart.test.cjs` | 6 | **4 fail** without the fix |
| B.12 | `D2` | `tests/runtime/18-knowledge-graph-dedupe.test.cjs` | 7 | **4 fail** without the fix |
| B.13 | `D1` | `tests/runtime/19-automation-dryrun.test.cjs` | 7 | **3 fail** without the fix |
| B.19.3 | `F1` | `tests/runtime/27-visual-accessibility` | 16 | see source |

**Baseline:** 144/144 runtime regression, plus phase-specific suites. Independently re-executed 2026-08-13: 144/144 runtime; accessibility suites 25 (9/9), 26 (21/22 — the single form-labelling gap), 27 (16/16), 28 (14/14), 29 (9/9, A.11 UX consistency).

---

## Residual Critical Gaps

Distinct from the findings above. A **finding** was a broken capability that existed and was
recovered. A **gap** is a capability that was never built — recorded with its reproduction and
its reason for remaining open, rather than constructed under audit-day time pressure.

| Gap | Phase | Title | Measured evidence | Why open | Closes in |
|---|---|---|---|---|---|
| **G1-B15** | B.15 | Legacy ticket store cross-tenant readable/writable | customerSupportEngine.cjs contains zero orgId occurrences; createTicket() has no ownership parameter. 190 tickets affected. | Closing requires adding an ownership dimension to a storage model that has none — new capability, not recovery. | B.21 |
| **G1-B16** | B.16 | Customer engines discard org scoping | All five customer engines contain zero orgId occurrences; 0 of 123 stored customer records carry an owner. Org B read Org A's customer name and phone number. | Threading org through five engines and backfilling ownership into three stores is new capability. | B.23 |
| **G1-B17** | B.17 | No ownership transfer operation exists | Both removeMember() and updateMemberRole() guards demand transfer-ownership-first, but no such operation exists. No member suspend/restore either. | Requires building new capability, which the recovery mission forbids. | B.25 |

All three share one root cause: **storage models built before multi-tenancy existed, none carrying
an ownership dimension.** They are one remediation programme, not three tickets.

---

## Sources

| Certification | Phase |
|---|---|
| `PHASE_B4_SECURITY_VALIDATION_CERTIFICATION.md` | B.4 — Enterprise Security Validation Certification |
| `PHASE_B5_DISASTER_RECOVERY_CERTIFICATION.md` | B.5 — Disaster Recovery & Business Continuity Certification |
| `PHASE_B6_DATABASE_CERTIFICATION.md` | B.6 — Database Certification |
| `PHASE_B7_API_CERTIFICATION.md` | B.7 — API Certification |
| `PHASE_B8_DEVOPS_CERTIFICATION.md` | B.8 — DevOps Certification |
| `PHASE_B9_AI_INTELLIGENCE_CERTIFICATION.md` | B.9 — AI Intelligence Certification |
| `PHASE_B10_MEMORY_CERTIFICATION.md` | B.10 — Memory Certification |
| `PHASE_B11_AGENT_CERTIFICATION.md` | B.11 — Agent Certification |
| `PHASE_B12_KNOWLEDGE_CERTIFICATION.md` | B.12 — Knowledge System Certification |
| `PHASE_B13_AUTOMATION_CERTIFICATION.md` | B.13 — Automation & Workflow Operating System Certification |
| `PHASE_B14_FINANCE_CERTIFICATION.md` | B.14 — Finance Operations Certification |
| `PHASE_B15_SUPPORT_CERTIFICATION.md` | B.15 — Support Operations Certification |
| `PHASE_B16_CUSTOMER_OPERATIONS_CERTIFICATION.md` | B.16 — Customer Operations Certification |
| `PHASE_B17_WORKFORCE_CERTIFICATION.md` | B.17 — Team & Workforce Certification |
| `PHASE_B18_BUSINESS_CONTINUITY_CERTIFICATION.md` | B.18 — Business Continuity & Operational Resilience Certification |
| `PHASE_B19_2_VISUAL_ACCESSIBILITY_CERTIFICATION.md` | — |
| `PHASE_B19_3_ACCESSIBILITY_CLOSURE_CERTIFICATION.md` | B.19.3 — Accessibility Final Closure Certification |
| `PHASE_B19_4_KEYBOARD_ARIA_CERTIFICATION.md` | B.19.4 — Keyboard & ARIA Recovery Certification |
| `PHASE_B19_ACCESSIBILITY_CERTIFICATION.md` | B.19 — Accessibility & Inclusive UX Certification |

Verify any figure by opening the named certification. Verify the A-phase findings via
`git log --oneline security/reality-completion`.

---

*Ooplix V1 Critical Findings Dossier · OPX-CFD-001 · Confidential — Investor / Enterprise Due Diligence*
