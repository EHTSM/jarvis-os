# OOPLIX V1 — MASTER AUDIT REGISTER

Last updated: 2026-08-14 (B.23) · Branch: `security/reality-completion`
Audit-track register. **Separate from the OS development track** — see [OS-REGISTER.md](OS-REGISTER.md).

---

## Audit-track state

| Phase | Scope | Status | Verdict |
|---|---|---|---|
| **B.22** | Founder Stress Certification | **COMPLETE** | **CERTIFIED WITH LIMITATIONS** — 8.7/10, confidence 88% |
| **B.23** | Production Certification | **COMPLETE** | **CERTIFIED WITH LIMITATIONS** — 8.5/10, confidence 90%, 0 failures |

*(This register was created in B.22. Earlier audit phases are documented in their own reports at repo root: `PHASE_B19_*`, `PHASE_B18_*`, `C1.1_*`, etc.)*

---

## B.22 — FOUNDER STRESS CERTIFICATION

Reports: [Certification](B22-FOUNDER-STRESS-CERTIFICATION.md) · [Workflow Matrix](B22-FOUNDER-WORKFLOW-MATRIX.md) · [Friction Register](B22-FOUNDER-FRICTION-REGISTER.md)

### Method

Real Chromium session (Playwright) driving the **real production SPA** served by the live backend, authenticated as a real trial tenant. **Every click and timing observed — none estimated.** No competitor benchmark was run, so no comparative claim is made.

### Result

```
Total workflows:      20        Measured:            18
Production Ready:     18        Fixed:                2
Credential Blocked:    1        Not Measured:         1
Genuine Gaps:          0        Failures:             0

Total observed clicks: 8        Total observed time: 21,925 ms

PRODUCTIVITY SCORE:   9/10      FOUNDER STRESS SCORE: 8.7/10
EVIDENCE COVERAGE:    90%       CONFIDENCE:           88%
CERTIFICATION:        CERTIFIED WITH LIMITATIONS
```

### Critical paths — all measured end-to-end

| Path | Steps | Time | Verdict |
|---|---:|---:|---|
| A — lead → qualify → opportunity → pipeline → close → revenue | 7 | **4,910 ms** | PRODUCTION READY |
| B — customer → support → resolution | 3 | 1,322 ms | PRODUCTION READY |
| C — marketing → audience → campaign → result | 3 | 409 ms | PRODUCTION READY |
| D — mission → agent → execution | 3 | 271 ms | PRODUCTION READY |
| E — executive → finance → operations | 3 | 164 ms | PRODUCTION READY |
| F — search → capability → execute → return | 3 | 5,083 ms | FIXED |

**Path A is the headline:** a lead became qualified revenue in under 5 seconds, pipeline reporting `{count:1, value:75000}` and stats confirming `revenue=75000` — real persisted data at every step.

### The critical finding

**F-001 — a stale frontend build blocked login entirely.** The deployed bundle had `REACT_APP_API_URL: "http://127.0.0.1:5099"` compiled into **44 of 165 chunks**. CSP (`connect-src 'self' https:`) correctly refused the plain-HTTP cross-origin call, so `/auth/me` never resolved and **the founder could not sign in** — measured at 4 clicks / 7,487 ms with no progress.

**The source was already correct** (`_client.js:8` defaults to same-origin; every env file sets it empty). Only the artifact was stale. A clean rebuild cleared it: 0 stale-port occurrences, 0 CSP errors, founder lands directly in the app.

**Not durable:** the stale build was **restored twice by an external process** during the phase. This is the top remaining blocker and the main reason certification carries limitations.

### Other findings

| ID | Finding | Status |
|---|---|---|
| F-002 | `"campaign"` search matched 1 of 3 campaign surfaces | **FIXED** — alias-only, 3/3, 0 regressions |
| F-003 | First-run wizard covers nav until dismissed | NOT A DEFECT — 1 click, 1.7 s escape |
| F-004 | Server serves cached `index.html` after rebuild → blank app | ENVIRONMENT — restart required |

### Regression

**144/144 runtime pass** · 6 security suites PASS · `19-logging-consistency` PRE-EXISTING FAIL (untouched) · frontend build PASS.

**Accessibility suites NOT RUN** — 38 require a `:3000` dev server. Recorded as not run, **not** as passing.

### Remaining blockers

1. **Build/deploy pipeline** reintroduces the stale `:5099` bundle — highest priority
2. AI provider quota (Groq 429) + invalid `OPENAI_API_KEY` — blocks workflow 18
3. Support reply/resolution mutation unmeasured
4. Accessibility suites need a `:3000` dev server

---

## Cross-track note

B.22 touched **no OS-track code**. The two source changes were:
- `frontend/build/*` — rebuilt artifact (no source change)
- `frontend/src/App.jsx` — two alias strings extended (F-002)

`.env` untouched · no merge · no push · no test weakened.


---

## B.23 — PRODUCTION CERTIFICATION

Reports: [Certification](B23-PRODUCTION-CERTIFICATION.md) · [Readiness Matrix](B23-PRODUCTION-READINESS-MATRIX.md) · [Gate Evidence](B23-PRODUCTION-GATE-EVIDENCE.md)

### Result — 88 items across 17 gates

```
PRODUCTION READY: 62    FIXED: 5    CREDENTIAL BLOCKED: 4
NOT CONFIGURED:    5    NOT MEASURED: 8    PRE-EXISTING LIMITATION: 2
GENUINE GAP:       1    ENVIRONMENT BLOCKED: 0    FAILURES: 0

PRODUCTION SCORE: 8.5/10   EVIDENCE COVERAGE: 91%   CONFIDENCE: 90%
CERTIFICATION:    CERTIFIED WITH LIMITATIONS
```

### B.22 regression gate — root cause PROVEN

B.22 described the stale build as "restored by an external process". B.23 proved the actual mechanism instead of accepting that.

**Ruled out:** `deploy.sh` and `deploy/update.sh` (both default `BUILD_API_URL` empty) · `.env` (empty) · git checkout (`frontend/build` gitignored, **0 tracked files**) · plain `npm run build` (**0** stale chunks).

**Reproduced:**
```
REACT_APP_API_URL="http://127.0.0.1:5099" npx react-scripts build  ->  44 stale chunks
REACT_APP_API_URL= npm run build                                   ->   0 stale chunks
```

**Cause: an exported shell variable at build time.** The artifact is indistinguishable from a good build without inspection — which is why it silently blocked login in production.

**Gate:** `tests/security/96-production-build-artifact-integrity.cjs` — **negative-tested both directions** (fails on poisoned build, passes clean).

### Key measured results

| Gate | Result |
|---|---|
| Persistence | **7/7 domains survived a real backend restart** |
| Tenant isolation | **0/8 read leaks · 5/5 direct-ID + write denials** |
| Core journeys | **6/6 complete** — lead→revenue in 4,910 ms on real data |
| Performance | **p50 94 ms · p95 147 ms · 0 operations > 2 s** |
| Error safety | **0 fake successes** across 5 failure classes |
| Server stability | **10/10 healthy over 150 s**, single process |
| Security | **7 suites PASS · 0 unauthenticated exposure** |

### Disclosed, not fixed

| ID | Finding | Classification |
|---|---|---|
| B23-03 | `/coding/context` called by 2 live components; route not mounted. Honest 404; consumers degrade via `.catch()`. | GENUINE GAP |
| B23-04 | Logout returns 200 but the stateless JWT stays valid until `exp` (8 h). No denylist. | PRE-EXISTING LIMITATION |
| B23-05 | `SENTRY_DSN` unset — **production has no crash reporting**. | CREDENTIAL BLOCKED |

### Regression

**144/144 runtime** (50 suites, 0 fail, 0 skipped) · **7 security suites PASS** · `19-logging-consistency` PRE-EXISTING FAIL (untouched) · build PASS.

**No test weakened. No blocked item counted as PASS.**

### Remaining blockers

1. **`SENTRY_DSN` unset** — no crash reporting; zero code work to fix
2. AI generation — Groq 429 + invalid `OPENAI_API_KEY`
3. 5 integrations not configured (email, SMS, push, GitHub, distribution)
4. Logout JWT revocation — requires new architecture
5. `/coding/context` missing — build the route or remove the consumers
6. 8 items not measured — load test, restore drill, `:3000` for a11y suites

### Cross-track note

B.23 touched **no OS-track code**. One file added: `tests/security/96-production-build-artifact-integrity.cjs`.
`.env` untouched · no merge · no push.
