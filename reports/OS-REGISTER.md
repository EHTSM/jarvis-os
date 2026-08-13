# OOPLIX OS PROGRAM REGISTER

Last updated: 2026-08-14 (Marketing/Growth OS) · Branch: `security/reality-completion`
Single source of truth for OS-track phase state. Update on every phase transition.

---

## Program state

| Phase | Scope | Status | Verdict |
|---|---|---|---|
| OS-1 / C.0 | Repository discovery, capability inventory | **CLOSED** | 150/150 routes mounted, 405/405 services referenced, nav 100% |
| C.1 | Runtime capability verification (1,010 endpoints) | **CLOSED** | 4 defects found; classifier + measurement errors corrected |
| C.1.1 | Reality cleanup & measurement integrity | **CLOSED** | 3 runtime defects fixed, SPA catch-all masking closed |
| OS-2 | 8-OS functional reality audit | **CLOSED** | 475/640 (74%); 2 fake-success defects fixed |
| OS-3 | 8-OS recovery & exposure plan | **CLOSED** | RECOVER 30 · FIX 5 · PROVISION 8 · VERIFY 27 · ARCHIVE 29 · **BUILD 0** |
| **OS-4** | Hosting + Cloud operator verification | **OPEN / OPERATOR-GATED** | **parked — see below** |
| OS-4.1 | Operator access attempt #2 | CLOSED | OPERATOR ACCESS BLOCKED |
| OS-4.2 | Operator access attempt #3 | CLOSED | OPERATOR ACCESS BLOCKED |
| OS-4.3 | Park operator gate; select next track | **THIS PHASE** | OS-4 parked; next OS selected |
| OS-5 | Business OS recovery & certification | **CERTIFIED (via OS-5.2)** | 10/14 PRODUCTION READY; blocked by OS5-002 route shadowing + unstable environment |
| OS-5.1 | Business OS recovery & canonical route resolution | CLOSED | OS5-002 canonical decision (Option A); live verification blocked |
| **OS-5.2** | Business OS runtime recovery & live certification | **CERTIFIED** | Runtime stabilised; OS5-001 + OS5-002 live-verified; critical unauth exposure closed |
| **OS-6** | Marketing / Growth OS | **CERTIFIED** | 8.5/10, confidence 90%; 4 defects fixed incl. silent CRM→audience no-op |

---

## OS-4 — PARKED: **OPEN / OPERATOR-GATED**

**Do not re-run the operator-access gate.** It has been independently checked three times (OS-4, OS-4.1, OS-4.2) with identical results. Repeating it produces the same report and no new information.

### Final recorded state — 30 capabilities

| Classification | Count | % |
|---|---:|---:|
| PRODUCTION READY | **13** | 43% |
| FIXED | **2** | 7% |
| VERIFY | **2** | 7% |
| CREDENTIAL BLOCKED | **1** | 3% |
| **UNKNOWN — OPERATOR ACCESS REQUIRED** | **12** | **40%** |
| GENUINE CAPABILITY GAP | **0** | 0% |
| ARCHIVE CANDIDATE | 0 new (3 carried from OS-3) | — |
| BUILD REQUIRED | **0** | 0% |
| **TOTAL** | **30** | 100% |

**Score: 6.5 / 10** — earned on 18 of 30 genuinely observed. Unobserved capability earns zero, not partial credit.
**Confidence: 60%** — evidence coverage, not optimism.
**Regression: 144/144 runtime pass.**

### The 12 parked capabilities — UNKNOWN — OPERATOR ACCESS REQUIRED

| # | OS | Capability | Surface | Gate |
|---|---|---|---|---|
| 1 | Hosting | VPS provisioning | `GET /ops/infra/vps` | 403 |
| 2 | Hosting | Deployment targets | `GET /deployment/targets` | 403 |
| 3 | Hosting | Deployment active | `GET /deployment/active` | 403 |
| 4 | Hosting | Ops health | `GET /ops/health` | 403 |
| 5 | Hosting | Ops stats | `GET /ops/stats` | 403 |
| 6 | Hosting | Infra deployment | `GET /ops/infra/deployment` | 403 |
| 7 | Hosting | Infra monitoring | `GET /ops/infra/monitoring` | 403 |
| 8 | Hosting | Infra security | `GET /ops/infra/security` | 403 |
| 9 | Hosting | Infra database | `GET /ops/infra/database` | 403 |
| 10 | Cloud | Integrations | `GET /integrations` | 403 |
| 11 | Cloud | Integration health | `GET /integrations/summary` | 403 |
| 12 | Cloud | Vault dashboard / env status | `GET /vault/dashboard`, `/vault/env/status` | 403 |

All 12 verified as **correctly denied** to a non-operator session (12/12 × 403). The gate works; what sits behind it is unobserved.

### Resume condition — single unblocker

**A legitimate operator-role session.** Any one of:

1. The plaintext password used to generate `OPERATOR_PASSWORD_HASH`.
2. A regenerated hash from a password you choose: `node scripts/generate-password-hash.cjs <password>` → paste into `.env` **yourself** → restart.
3. Explicit authorization for a **disposable local environment** with `JWT_SECRET` unset and `ALLOW_DEV_AUTH_BYPASS=1`. Not advisable on any environment holding real data.

### Resume procedure when access arrives

1. Confirm exactly one process owns :5050 and contains current source
2. Authenticate as operator via `POST /auth/login`
3. Verify each of the 12 surfaces: real UI → real API → persisted data → permissions → reload → metric honesty
4. Cross-check Docker/infra against the host daemon where possible
5. Fix any defect: REPRODUCE → ROOT CAUSE → MINIMAL FIX → REGRESSION → LIVE RE-VERIFY
6. Recalculate the 30-capability scorecard and certify **only if all 12 are genuinely observed**

**OS-4 is not certified and must not be certified while any of the 12 remain unobserved.**

---

## Carried-forward items (not OS-4-specific)

| Item | Status | Owner decision |
|---|---|---|
| 3 dead prototypes (`EnterpriseOS/DeveloperOS/PersonalOS`, 3,052 LOC) | ARCHIVE recommended, **not performed** | authorization required |
| 26 further unreferenced components (~8,500 LOC) | catalogued | authorization required |
| Ecosystem tenant residue (644 records, ~52% test names) | VERIFY | purge / label / accept |
| Distribution legacy residue (3 jobs, 7,860 phantom reach) | VERIFY — quarantined under `legacy` | purge / retain-and-label |
| `19-logging-consistency` | PRE-EXISTING FAIL | out of scope; file untouched |
| AI provider chain (Groq 429 + invalid `OPENAI_API_KEY`) | CREDENTIAL BLOCKED — causes intermittent event-loop stalls | provisioning |
| `SENTRY_DSN` unset | CREDENTIAL BLOCKED — **production has no crash reporting** | provisioning |


---

## OS-5 — BUSINESS OS: **OPEN — NOT CERTIFIED**

Full report: [OS-5-BUSINESS-OS-CERTIFICATION.md](OS-5-BUSINESS-OS-CERTIFICATION.md)

| Classification | Count |
|---|---:|
| PRODUCTION READY | 10 |
| FIXED (pending live re-verify) | 1 |
| VERIFY (defect confirmed) | 1 |
| CREDENTIAL BLOCKED | 1 |
| GENUINE CAPABILITY GAP | 1 |
| **TOTAL** | **14** |

**Verified by real execution on a fresh tenant:** leads → qualify → opportunity → 4 stage advances → close-won → revenue ledger → stats. Every number traced to persisted data. Fresh tenant showed honest zeros with no cross-tenant leakage.

### Blockers to certification

| ID | Issue | Owner decision needed |
|---|---|---|
| **OS5-002** | `ops.js` defines **34 unscoped `/business/*` routes** (mounted line 38) that shadow the org-scoped `business.js` (line 73). `getPipelineSummary()` vs `getPipelineSummary(req.org.id)`. **Pre-existing in HEAD — not merge-introduced** (verified: HEAD also has 34). | Which implementation is canonical? |
| Environment | External `git stash pop` left conflict markers in 5 files and duplicate `const` declarations in `runtime.js`; server repeatedly killed externally. I repaired the duplicate-declaration blocker (semantically identical requires). | Stabilise before re-verification |

### OS-5 findings

| ID | Finding | Status |
|---|---|---|
| OS5-001 | Random qualification scores (`Math.random()`) shown as measured on `/bizorg/v3/deals` — "Score: 82/79/86" | **FIXED** — labelled `(simulated — not measured)`, mirroring the existing `synthetic: true` convention. Live re-verify pending. |
| OS5-002 | `/business/*` route shadowing | **CONFIRMED, not fixed** — needs a scoping decision |
| Invoices | No invoice entity/route/service/storage anywhere in the repo | **GENUINE CAPABILITY GAP** — recorded, not built |
| Payments | Razorpay keys provisioned; no test-mode environment evident | **CREDENTIAL/ENVIRONMENT BLOCKED** — no transaction attempted |

**Regression: 144/144 runtime pass** (run twice). Business/security suites **BLOCKED** — require a stable live server.


---

## OS-5.1 — CANONICAL ROUTE RESOLUTION

Full report: [OS-5.1-BUSINESS-OS-RECOVERY.md](OS-5.1-BUSINESS-OS-RECOVERY.md)

### OS5-002 — RESOLVED (decision), NOT APPLIED (awaiting authorization + live proof)

**Decision: Option A — `business.js` is canonical; the 34 `ops.js` `/business/*` routes are obsolete shadows.**

| Measure | `ops.js` | `business.js` |
|---|---:|---:|
| `/business/*` routes | 34 | 79 |
| Exact duplicates | 34 | 34 |
| **Unique endpoints** | **0** | 45 |
| `requireAuth` | **0** | **72** |
| `_requireOrg` | **0** | **43** |
| `req.org.id` | **0** | **47** |
| Barrel mount line | **38** | 73 |

Barrel ordering: `ops.js` (38) → `business.js` (73) → `/business` auth gate (181). The 34 shadows sit **ahead of both** the canonical implementation and the auth gate.

**Recommended minimal recovery:** delete the 34 duplicate route definitions from `ops.js`. Deletion-only — no barrel reorder, no new routes. **Requires authorization; must be live-verified after.**

### Blocking condition — SERVER STABILITY: FAIL

An **external supervisor** repeatedly spawns and kills `node backend/server.js`. Measured over 60 s with no intervention: server processes cycled **0 → 2 → 2 → 0**, health **000 → 200 → 200 → 000**. Up to 4 concurrent processes observed (one at 92.9% CPU), all from a parent that had already exited. No OOM, no crash report, no error trace.

Per Phase 1, unrelated processes were **not** killed. Any live measurement during this churn is invalid.

**Consequences:**
- **OS5-001** — fixed in source (follows existing `synthetic: true` convention), **live re-verify blocked**
- **Tenant isolation** — **NOT TESTED**; no claim made in either direction
- **Unauthenticated `/business/*` risk** — flagged from static evidence (0 auth, 0 org scoping on the shadowing handlers), **not asserted** pending live confirmation

**Regression: 144/144 runtime pass** (baseline and final, both without a live server).


---

## OS-5.2 — BUSINESS OS: **CERTIFIED**

Full report: [OS-5.2-BUSINESS-OS-CERTIFICATION.md](OS-5.2-BUSINESS-OS-CERTIFICATION.md)

| Classification | Count |
|---|---:|
| PRODUCTION READY | 11 |
| FIXED (live-verified) | 2 |
| CREDENTIAL BLOCKED | 1 |
| VERIFY / UNKNOWN / GENUINE GAP / BUILD | 0 |
| **TOTAL** | **14** |

**Score 13/14 (93%) · Confidence 93% · Regression 144/144**

### Critical security fix — OS5-002

`ops.js` defined 34 `/business/*` routes with **0 auth, 0 org scoping**, mounted at barrel line 38 — ahead of `business.js` (73) and the `/business` auth gate (181).

**Measured live with no cookie:** 7/7 reads returned 200 with real data (4 leads incl. emails, 2 contacts, 8 revenue records totalling $128,800); `POST /business/leads` returned **201 — anonymous write accepted**.

**After removing the 34 duplicates:** 7/7 → **401**, write → **401**, authenticated access restored to the canonical org-scoped implementation, **tenant isolation 5/5 verified live A/B**. Locked by `tests/security/94-business-routes-auth-required.cjs` (4/4).

### Two corrections to earlier findings

| Earlier claim | Corrected |
|---|---|
| "Invoices: GENUINE CAPABILITY GAP" (OS-5, OS-5.1) | **WRONG — my search error.** `/cbeta/billing/invoices` returns real invoices with `lineItems`, `razorpayId`, `amountINR`, `period`, `dueAt`, `paidAt`. Nothing was built. |
| "EnterpriseOS.jsx is a dead prototype, 0/9 endpoints exist" (C.1.1, OS-2, OS-3) | **WRONG — stale-process measurement.** All 7 probed `/enterprise/*` endpoints are mounted by `ops.js` and return real data. Its archive recommendation must be revisited. |

### Disclosed findings — OUT OF OS-5 SCOPE, NOT FIXED

| ID | Finding |
|---|---|
| **F-A** | `/enterprise/*` in `ops.js` (line 740+) is **unauthenticated** — 7/7 return 200 with real org data. Same defect class as OS5-002, Enterprise scope. |
| **F-B** | `/cbeta/billing/invoices` is **not tenant-scoped** — accounts A and B receive byte-identical payloads for an invoice belonging to neither. |

### Runtime supervisor

PM2 God Daemon (pid 6986) runs with **0 managed apps**, but `~/.pm2/dump.pm2` holds `jarvis-os` with `autorestart: true`. Earlier churn came from external `pm2 start`/`npm start` invocations. **No unrelated process was killed.** Stability gate passed: 1 process, 1 listener, 120 s, health 200 throughout.


---

## OS-6 — MARKETING / GROWTH OS: **CERTIFIED**

Full report: [OS-MARKETING-GROWTH-CERTIFICATION.md](OS-MARKETING-GROWTH-CERTIFICATION.md)

**Score 8.5/10 · Confidence 90% · Regression 144/144**

234 endpoints, 9 navigable+searchable surfaces, 98/98 frontend endpoint references resolve. Operated end-to-end on two fresh tenants with real data.

### Four defects found by execution (all 2xx, invisible to read-only audit)

| ID | Defect | Fix |
|---|---|---|
| **M-001** | **CRM → audience sync was a silent no-op** — mapped `l.id`, but CRM leads have no id (keyed by phone). 2 leads → 0 members, returned 200. Broke the entire lead-nurture chain. | Map `l.phone`, matching the send path's existing contract. Verified: 2 leads → 2 members. |
| **M-002** | **WhatsApp reported `status:"sent"` for a fully failed broadcast** — real Meta permissions error, `delivered:0 failed:2`, yet "sent" with a timestamp. `stats.sent` counted attempts. | Status derived from measured outcome; `sentAt` null when nothing delivered; `stats.sent = delivered`; new `stats.attempted`. Verified: `status:"failed"`. |
| **M-003** | Empty POST created junk records (`name:""`) counting toward totals | `name required` guard on all 5 creators |
| **M-004** | Required-field rejection surfaced as **500** | `_err` maps `required → 400`, preserving `not found → 404` |

Plus **M-005**: WhatsApp said "no audience is attached" when one *was* attached but empty — now names the accurate cause.

### Results

- **Security: 0/11 unauthenticated** — no exposure found
- **Tenant isolation: 5/5 verified** live A/B with identifiable data
- **Analytics honesty: 0 fabricated measured metrics** — the only multiplier sites are ID generators or already-quarantined distribution projections
- **Cross-OS: 2/2 identities traceable** CRM → audience
- **Performance: median 140 ms, max 201 ms**
- **Genuine gaps: 0** — every capability exists
- **Locked by** `tests/security/95-marketing-os-integrity.cjs` (4/4); suite 93 strengthened +3 assertions

### Blockers (all external, none code)

SMTP · SMS provider · Firebase · WhatsApp phone-number permissions · social platform connectors · `PartnerProgram.jsx` archive decision (static mockup, 335 LOC, 0 endpoints)
