# OS-5.1 — BUSINESS OS RECOVERY & CANONICAL ROUTE RESOLUTION

Date: 2026-08-13 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No routes deleted. No barrel reordered. OS-6 not started.**

---

# STATUS: **OS-5 REMAINS OPEN — SERVER STABILITY: FAIL**

Phase 1 required exactly one backend process; Phase 4 said to stop and report if the server dies rather than infer anything from failed requests. **Both conditions triggered.** Live verification could not be completed.

What *could* be completed — the OS5-002 static investigation — produced a decisive and security-relevant result, documented below.

---

## 1. Stabilization (Phase 1)

| Check | Result |
|---|---|
| HEAD | `18972132` — *docs(a11y): complete B19.5 regression evidence* |
| Conflict markers in tracked files | **none** (previous damage cleared) |
| Unmerged (`UU`) files | **none** |
| `.env` | **0 changes — untouched** |
| **Baseline `npm run test:runtime`** | **144/144 pass, 0 fail** |

### Server stability: **FAIL**

Started cleanly (health 200 in 319 ms), then died mid-request. Investigated rather than assumed:

- **No OOM** — zero `heap out of memory` / `FATAL ERROR` / `SIGKILL` signatures in 593 log lines
- **No crash report** — nothing in `~/Library/Logs/DiagnosticReports/`
- **No error trace** — the log simply stops mid-operation

Process census revealed the cause is **external**:

```
pid 4053  92.9% CPU   node backend/server.js   } all spawned 21:10:18–21:10:33
pid 4411   4.1% CPU   node backend/server.js   } by a common parent (4004)
pid 4427   0.0% CPU   node backend/server.js   } which had already exited
pid 4004   0.0% CPU   node backend/server.js
```

60-second observation, no intervention:

```
t+15s  server_procs=0  port_owners=0  health=000
t+30s  server_procs=2  port_owners=1  health=200
t+45s  server_procs=2  port_owners=1  health=200
t+60s  server_procs=0  port_owners=0  health=000
```

**An external supervisor is repeatedly spawning and killing backend processes.** Per Phase 1 ("do NOT kill unrelated processes blindly") I did not intervene. Any live measurement taken during this churn would be invalid — exactly the failure mode C.1.1 identified when two processes competed for :5050.

---

## 2. OS5-001 — live re-verification: **INCOMPLETE**

**Status: FIXED IN SOURCE, LIVE RE-VERIFICATION BLOCKED.**

The fix is present and syntax-verified:
- `businessOrg.cjs` passes `synthetic: true` from the CRM tick
- `businessOrgWorkflow.cjs` renders `Score: N (simulated — not measured)` everywhere the score is persisted or emitted, and returns `scoreSynthetic`

It follows the **repository's existing convention** — `growthCaptureLead()` 18 lines above already threads `synthetic: true` / `source: "demo_simulation"`. No new schema was invented.

Attempted live verification twice; the login returned status `0` (connection dropped) and the subsequent probe returned 0 deals. **Those zeros are not evidence** — they came from a dead server, and I am not classifying on them.

**OS5-001 cannot be classified FIXED until observed live.** It stays **FIXED (pending live re-verify)**.

---

## 3. OS5-002 — canonical route investigation (Phase 3): **RESOLVED — Option A**

This was completed statically, which is valid without a live server.

### Route comparison

| Measure | `backend/routes/ops.js` | `backend/routes/business.js` |
|---|---:|---:|
| `/business/*` routes defined | **34** | **79** |
| Exact duplicates (same METHOD + PATH) | **34** | 34 |
| Routes unique to this file | **0** | 45 |
| `requireAuth` on `/business` routes | **0** | **72** |
| `_requireOrg` usage | **0** | **43** |
| `req.org.id` usage | **0** | **47** |
| Backing service | `agents/runtime/businessOS.cjs` | `backend/services/businessDataService.cjs` |
| Barrel mount line | **38** | 73 |

### The full 34 duplicated endpoints

```
POST/GET/PATCH/DELETE  /business/leads[/:id]        + /qualify /disqualify
POST/GET/PATCH/DELETE  /business/contacts[/:id]
POST/GET/PATCH         /business/opportunities[/:id] + /advance /close-won /close-lost
POST/GET/PATCH         /business/campaigns[/:id]     + /event /complete
POST/GET               /business/revenue             + /revenue/stats
GET                    /business/dashboard /summary/daily /summary/weekly
GET                    /business/pipeline /business/search /business/stats
```

### The gate-ordering problem

```
line  38: router.use(require("./ops"));        ← 34 unauthenticated /business/* routes
line  73: router.use(require("./business"));   ← canonical, requireAuth + _requireOrg
line 181: router.use("/business", requireAuth); ← the /business auth gate
```

`ops.js` is mounted **143 lines before** the `/business` auth gate and **35 lines before** the canonical implementation. Express matches first registration, so **all 34 shadow the canonical routes and sit ahead of the auth gate**.

Scoping difference on the surface that started this investigation:
- `ops.js`: `_bos.getPipelineSummary()` — **no orgId**
- `business.js`: `bds.getPipelineSummary(req.org.id)` — **org-scoped**

Frontend (`businessApi.js:160,302`) calls `/business/pipeline` and `/business/stats` — and therefore hits the **unscoped** ops.js handlers today.

### Decision: **A — `business.js` is canonical; the 34 `ops.js` routes are obsolete shadows**

Evidence: zero unique endpoints in `ops.js`; zero auth; zero org scoping; `business.js` has a superset (79 vs 34) with full `requireAuth` + `_requireOrg` + `req.org.id` and is the implementation the OS-5 workflow verification exercised successfully (leads → opportunity → pipeline → revenue, all org-scoped and persisted).

Option B is contradicted (no unique contract, no auth). Option C is contradicted (all 34 are exact METHOD+PATH duplicates, not different contracts).

### Not fixed — deliberately

Phase 5 says to prefer removal *"only when repository evidence proves it is safe"*, and Phase 6 requires live A/B tenant verification after any fix. **The environment cannot support that verification right now.** Removing 34 routes changes platform-wide behaviour and must be proven live, not assumed.

**Recommended minimal recovery, for your authorization:** delete the 34 duplicate `/business/*` route definitions from `ops.js` (they add nothing — 0 unique endpoints). This requires no barrel reordering and no new routes.

---

## 4. Tenant isolation re-test (Phase 4): **NOT PERFORMED**

Phase 4 is explicit: *"A 0 count or empty response is NOT evidence of isolation. If the server dies, stop and report the environment problem. Do not infer security from failed requests."*

The server died during every attempt. **No isolation claim is made in either direction.**

What is established **statically**: the handlers currently serving `/business/*` have no `requireAuth`, no `_requireOrg`, and no `req.org.id` — so there is no mechanism by which they *could* scope per tenant. That is a code-structure fact, not a live measurement, and it is reported as such.

### Security concern requiring live confirmation

If `ops.js`'s routes are reachable as the ordering implies, then `/business/leads`, `/business/contacts`, `/business/opportunities`, `/business/revenue`, `/business/pipeline` and `/business/stats` are served **without authentication and without tenant scoping**. I attempted the unauthenticated test three times; the server was down each time. **This must be confirmed live before any conclusion — I am flagging it as a risk, not asserting a breach.**

---

## 5. Invoices (Phase 7)

**GENUINE CAPABILITY GAP** — unchanged. No invoice entity, route, service, or storage exists repo-wide. **Not built. No placeholder UI. Score not inflated.**

## 6. Payments (Phase 8)

**CREDENTIAL / ENVIRONMENT BLOCKED** — unchanged. Razorpay keys are provisioned; no test-mode-only environment is evident. **No monetary transaction executed or attempted.**

---

## 7. Final OS-5 status

**Business OS: 10 of 14 capabilities verified**

| Classification | Count |
|---|---:|
| **PRODUCTION READY** | **10** |
| **FIXED** (pending live re-verify) | **1** |
| **VERIFY** (defect confirmed, fix awaiting authorization + live proof) | **1** |
| **CREDENTIAL BLOCKED** | **1** |
| **UNKNOWN** | **0** |
| **GENUINE GAP** | **1** |
| **BUILD REQUIRED** | **0** |
| **TOTAL** | **14** |

| Item | Status |
|---|---|
| **OS5-001** | FIXED in source, follows existing `synthetic: true` convention; **live re-verify blocked by server instability** |
| **OS5-002** | **Canonical decision made: Option A** — `business.js` canonical, 34 `ops.js` routes are obsolete shadows (0 unique, 0 auth, 0 org scoping). **Not removed** — pending authorization + live verification |
| **Invoices** | GENUINE CAPABILITY GAP |
| **Payments** | CREDENTIAL / ENVIRONMENT BLOCKED |
| **Regression** | **144/144 runtime pass** (baseline and final) |
| **Server stability** | **FAIL** — external supervisor churning processes; 0↔2 procs in 60 s |
| **Tenant isolation** | **NOT TESTED** — server died on every attempt; no claim made |
| **Certification** | **OPEN** |

---

## 8. Exact next actions

1. **Stop the external process supervisor** — something outside this session spawns and kills `node backend/server.js` continuously. Until one process runs stably, no live verification of any OS is possible.
2. **Authorize the OS5-002 recovery** — remove the 34 duplicate `/business/*` routes from `ops.js`. Evidence supports it; the change is deletion-only, no barrel reorder, no new routes.
3. **Then**: live-verify OS5-001, run the unauthenticated `/business/*` test, and complete the A/B tenant isolation matrix.

**OS-5 remains OPEN. OS-6 not started.**
