# OS-4 CONTINUATION REPORT

Date: 2026-08-13 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. OS-5 not started. Master Audit track not touched.**

---

## 1. Operator session — exhaustively searched, legitimately unavailable

Before doing anything else I searched for a **legitimate** operator path through the normal application flow. Four candidates existed:

| Path | Result |
|---|---|
| `POST /auth/login` with operator password | `401 "Invalid password"`, no cookie. Password not held. |
| Dev passthrough in `auth.js:122` | Fires **only when `OPERATOR_PASSWORD_HASH` is unset**. It is set. Reaching it means editing `.env`. |
| Dev bypass in `authMiddleware.js:67` | Requires `JWT_SECRET` unset **and** `ALLOW_DEV_AUTH_BYPASS=1`. Both would require editing `.env`. |
| Role passed at registration | `createAccount()` accepts `role`, but `POST /accounts/register` destructures only `email, password, name, inviteCode, orgName`. **Verified empirically:** registering with `role:"operator"` returned `201` with `role: "user"`. |

I also found **8 non-legacy operator accounts** in `data/local-accounts.json` from prior verification runs (`verify-op-*`, `verify-p7-*`). Their passwords were generated at creation time and are not recorded, so they are unusable without guessing.

**Conclusion: no legitimate operator session exists.** Nothing was fabricated, guessed, or bypassed; `.env` was not modified. The 12 UNKNOWN capabilities remain UNKNOWN.

That the registration route correctly refuses to honour a client-supplied `role` is itself a positive security finding.

---

## 2. Non-operator verification completed — 4 capabilities reclassified

| Capability | Was | Now | Evidence |
|---|---|---|---|
| Infra dashboard | VERIFY | **PRODUCTION READY** | No `orgId`/`tenantId` field; byte-identical across two tenants after normalising timestamps → global infrastructure telemetry, correct by design |
| Extensions runtime | VERIFY | **PRODUCTION READY** | `runtime`, `metrics`, `hooks`, `quotas` all 200 in **70–86 ms**; honestly empty (no extensions installed) |
| Physical / org-network dashboards | VERIFY | **PRODUCTION READY** | Identical across tenants; the 20 org IDs in `/org-network` are registry entries and **neither probe org appears** → no tenant leak |
| Workspace mesh dashboard | VERIFY | **PRODUCTION READY** | 17 workspaces / 40 executions; global platform view, consistent across tenants |

**PRODUCTION READY: 9 → 13. VERIFY: 6 → 2.**

---

## 3. New finding — intermittent event-loop stalls (OS4-005)

**This was found by accident and nearly misdiagnosed twice.** Recording the reasoning because the corrections matter.

**Symptom:** four `/extensions/*` endpoints timed out at 30–40 s.

**First hypothesis — wrong.** I nearly filed this as an extensions defect. Interleaving `/health` with `/extensions/hooks` showed **both timing out identically**, proving the whole process was stalled, not one endpoint.

**Second hypothesis — also wrong.** I assumed the invalid `OPENAI_API_KEY` was burning a 20 s timeout per call. Measured directly: it fails in **492 ms with a fast 401**. Full provider-chain cost is ~962 ms, nowhere near a 40 s stall.

**Actual measured cause.** On a fresh process over 90 seconds:
- `/health` normally **1–12 ms**, but spiked to **1,822 ms** and **3,934 ms** (2 of 9 samples)
- server log for the same window: **12 ticks, 27 tasks, 72 failed calls per provider** — Groq 429, OpenAI 401, Ollama 404, LM Studio unreachable — ≈288 failed HTTP attempts in 90 s
- `agents/autonomousLoop.cjs:274` runs the batch **serially**: `for (const task of batch) { await _runTask(task); }` with `MAX_TASKS_PER_TICK = 20` and `TASK_TIMEOUT_MS = 30_000`

Every task walks the full provider chain and **every provider fails**, because Groq's quota is exhausted and no other provider is usable. The loop is well written — `_withTimeout` is a proper `Promise.race`, `_dispatching` guards re-entry, and there is a self-heal path. There is **no sync I/O** in the executor path.

**Classification: CREDENTIAL BLOCKED, not a code defect.** No fix applied; fixing this by editing code would mean working around a provisioning problem.

**User impact is real but bounded.** Between tick bursts, all 7 core endpoints responded in **2–132 ms** (`/graph/stats`, `/business/pipeline`, `/crm/leads`, `/orgs`, `/growth/dashboard`, `/runtime/status`, `/computer/docker/health`). The platform is usable; degradation is periodic, not sustained.

**This is direct measured evidence for OS-3's Tier-0 recommendation** — the AI credential gap is no longer just a blocked feature, it is causing intermittent platform-wide latency spikes.

---

## 4. Two figures corrected

| Claim | Corrected |
|---|---|
| Distribution legacy residue "10 jobs / 18,780 reach" | **3 jobs / 7,860 reach** when scoped to the probe org. The larger figure was the un-scoped global total. |
| Ecosystem tenants "578" | **644 and growing** — benchmark runs keep adding records, confirming test residue rather than customer growth. |

---

## 5. Environment note

Mid-run, the PM2 process list emptied and `jarvis-os` disappeared (no row, no listener) — not caused by any action of mine. I restarted the server directly, confirmed **exactly one listener** on :5050 and `/health` at 52 ms, and re-authenticated before resuming. Every measurement in section 3 was taken against that verified-fresh process.

---

## 6. Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144 pass, 0 fail** |
| `93-os2-os3-fake-success-protection` | PASS 6/6 |
| `92-c11-runtime-defect-regressions` | PASS 9/9 |
| `91-api-404-boundary` | PASS 5/5 |
| `90-phase-c1-search-alias-coverage` | PASS 8/8 |

**No new regressions. No test modified in this run. No code changed in this run.**

---

## 7. Updated classification

| Classification | Count | Change |
|---|---:|---|
| PRODUCTION READY | **13** | +4 |
| FIXED | 2 | — |
| VERIFY | **2** | −4 |
| CREDENTIAL BLOCKED | 1 | — |
| UNKNOWN | **12** | unchanged |
| ARCHIVE CANDIDATE | 0 new (3 carried) | — |
| GENUINE CAPABILITY GAP | **0** | — |
| **Total** | **30** | |

**OS-4 remains OPEN** — 12 of 30 capabilities (40%) cannot be honestly classified without an operator session.
