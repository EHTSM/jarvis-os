# B.23 — PRODUCTION GATE EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`
Raw measured evidence. Every value below was observed against the running application.

---

## Gate 1 — Production build artifact

| Check | Result |
|---|---|
| Build completes | ✅ compiles clean |
| Stale `:5099` chunks | **0 / 165** |
| `index.html` ↔ disk agreement | ✅ single main chunk, referenced correctly |
| Referenced assets exist | ✅ 2/2 |
| Dev auth bypass flag in artifact | ✅ absent |
| `NODE_ENV: "development"` in artifact | ✅ absent |

### Root cause of the B.22 stale build — PROVEN, not inferred

Ruled out by direct inspection:
- `deploy.sh:68` — `BUILD_API_URL="${REACT_APP_API_URL:-}"` defaults empty
- `deploy/update.sh:49` — same pattern
- `.env` — `REACT_APP_API_URL=` (empty)
- `frontend/build` — **gitignored, 0 tracked files**, so no checkout restores it

Reproduced the actual mechanism:

```
REACT_APP_API_URL="http://127.0.0.1:5099" npx react-scripts build
  -> 44 chunks contain the stale origin

REACT_APP_API_URL= npm run build
  -> 0 chunks
```

**Cause: an exported shell variable at build time.** Any shell exporting
`REACT_APP_API_URL` bakes it in, and the artifact is indistinguishable from a
good build without inspecting it. That is why it appeared to be "restored by an
external process".

### Regression gate added

`tests/security/96-production-build-artifact-integrity.cjs` — **negative-tested**:

```
poisoned build -> FAILED: REACT_APP_API_URL must not be a loopback/dev origin …
                          Offenders: main.aeafc88d.js -> http://127.0.0.1:5099
clean build    -> 4 passed, 0 failed
```

---

## Gate 2 — Server stability (150 s window)

| t | alive | listeners | health | RSS | CPU |
|---|---|---:|---|---:|---:|
| +15s | y | 1 | 200 / 1.9 ms | 757 MB | 6.6% |
| +30s | y | 1 | 200 / 1.4 ms | 861 MB | 3.0% |
| +45s | y | 1 | 200 / 1.7 ms | 854 MB | 6.9% |
| +60s | y | 1 | 200 / 10.3 ms | 883 MB | 23.2% |
| +75s | y | 1 | 200 / 22.1 ms | 832 MB | 4.8% |
| +90s | y | 1 | 200 / 1.6 ms | 838 MB | 1.3% |
| +105s | y | 1 | 200 / 1.4 ms | 784 MB | 17.1% |
| +120s | y | 1 | 200 / 1.7 ms | 513 MB | 18.8% |
| +135s | y | 1 | 200 / 1.6 ms | 752 MB | 4.6% |
| +150s | y | 1 | 200 / 1.6 ms | 282 MB | 0.2% |

**10/10 healthy · single process throughout · memory peaks 883 MB then GCs to 282 MB.**

---

## Gate 3 — Production SPA ↔ backend

```
auth via API      : true
initial load      : 6,243 ms
primary tabs      : 6
console errors    : 1
failed resources  : 1  (404 /coding/context — honest JSON 404)
workspace visible : true (Helios Media Ltd)
```

`/coding/context` returns `404 {"success":false,"error":"Not Found: GET /coding/context"}` — **JSON, not SPA HTML**. Both consumers (`RepoInsights.jsx`, `AITimeline.jsx`) use `.catch(()=>({}))` and degrade without crashing.

---

## Gate 4 — Persistence across a real backend restart

| Domain | Created | Survived restart |
|---|---|---|
| CRM lead | 200 | ✅ |
| Business opportunity | 200 | ✅ |
| Marketing audience | 200 | ✅ |
| Email campaign | 200 | ✅ |
| Customer | 200 | ✅ |
| Mission | 200 | ✅ |
| Department | 200 | ✅ |

**7/7 durable.** Backend was killed and relaunched between write and read.

---

## Gate 5 — Tenant isolation (two real organizations)

**Reads — 0/8 leaks:**
```
isolated ✓  B reading /crm/leads              isolated ✓  B reading /business/stats
isolated ✓  B reading /business/opportunities isolated ✓  B reading /business/pipeline
isolated ✓  B reading /business/customers     isolated ✓  B reading /growth/analytics
isolated ✓  B reading /growth/audiences       isolated ✓  B reading /growth/email/campaigns
```

**Direct-ID and write — 5/5 denied:**
```
403  B -> /orgs/<A>                403  B -> /orgs/<A>/missions
403  B -> /orgs/<A>/departments    403  B -> /org-agents/<A>
403  B WRITE -> A org
intrusion artifact in A org: false
```

---

## Gate 6 — Authentication

```
valid login          : OK ✓
invalid password     : rejected ✓
unauthenticated API  : 401 ✓
malformed token      : 401 ✓
expired/forged token : 401 ✓
```

**Logout — measured limitation (not invented as a fix):**
```
before logout           : 200
logout call             : 200
same token after logout : 200
```
Stateless JWT remains valid until `exp`; logout clears the cookie client-side only. Recorded as **PRE-EXISTING LIMITATION**.

---

## Gate 7 — Authorization (RBAC)

```
403  user-tier -> /ops/health          403  user-tier -> /deployment/targets
403  user-tier -> /vault/dashboard     403  user-tier -> /integrations
200  owner     -> own org departments
```

**Backend-enforced**, not UI-hidden.

---

## Gate 13 — Performance (12 real endpoints)

```
p50 = 94 ms   p95 = 147 ms   max = 147 ms   >2s: 0/12

slowest:
  147 ms  200  /growth/dashboard
  146 ms  200  /business/pipeline
  144 ms  200  /content/dashboard
  137 ms  200  /distrib/analytics
```

Frontend initial load: **6,243 ms** · navigation: **~2.0 s/surface** (B.22 measured).

**No scalability claim is made from a local sample.**

---

## Gate 14 — Error / failure safety

```
400  html=false  invalid input           {"error":"name required"}
404  html=false  nonexistent entity      {"error":"Audience nope-xyz not found"}
404  html=false  unknown API path        {"success":false,"error":"Not Found: GET /business/…"}
403  html=false  unauthorized (operator) {"error":"Forbidden — operator access required"}
404  html=false  send nonexistent bcast  {"error":"WhatsApp broadcast nope not found"}

fake successes: 0
```

**Zero HTML masking. Zero fake success. Every failure carries an honest status and reason.**

---

## Gate 12 — Accessibility (production-critical regression only)

```
skip link present     : true
keyboard focus moves  : BUTTON:✦ New Mission -> BUTTON:◎ AI Chat
aria-labelled elements: 13
html lang attribute   : "en"
```

Full a11y program **not re-run** (per mission). `G1-B193` screen-reader limitation preserved.

---

## Gate 15 — Observability

| Signal | State |
|---|---|
| `/health` | ✅ 200, `uptime_seconds` real |
| `/metrics/health` | ⚠️ `degraded` — `backend_alive` OK, `error_rate_lt_5` OK, **`graph_success_rate_gt50` FAIL** |
| Audit log | ✅ real sequenced entries (`seq:151`) |
| Log files | ✅ 4 present |
| **Crash reporting** | ❌ `SENTRY_DSN` unset — **production has no crash reporting** |

The `degraded` status is **honest self-reporting**, not a defect.

---

## Gate 16 — Backup / recovery

```
backups present   : 9
newest            : jarvis_full_2026-08-12T21-02-52-644Z.tar.gz (25 h ago)
DR documentation  : DISASTER_RECOVERY.md present
```

**No production data destroyed.** Restore was not executed (destructive).

---

## Gate 19 — Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144 · 50 suites · 0 fail · 0 cancelled · 0 skipped** |
| `90-phase-c1-search-alias-coverage` | PASS 8/8 |
| `91-api-404-boundary` | PASS 5/5 |
| `92-c11-runtime-defect-regressions` | PASS 9/9 |
| `93-os2-os3-fake-success-protection` | PASS 6/6 |
| `94-business-routes-auth-required` | PASS 4/4 |
| `95-marketing-os-integrity` | PASS 4/4 |
| **`96-production-build-artifact-integrity`** *(new)* | **PASS 4/4** |
| `19-logging-consistency` | **PRE-EXISTING FAIL** — untouched |

**PASS 7 · FAIL 0 · BLOCKED 0 · PRE-EXISTING 1. No test weakened.**
