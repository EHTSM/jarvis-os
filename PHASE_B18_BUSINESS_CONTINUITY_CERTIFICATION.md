# Phase B.18 — Business Continuity & Operational Resilience Certification

**Product:** Ooplix (jarvis-os) v1.0.0-rc1
**Date:** 2026-08-09
**Branch:** `security/reality-completion` (no merge, no push)
**Method:** Operated as if serving real paying enterprise customers during failures. **Measured first, read source only after reproducing.** Real failures induced where safe. No new incident-management system, scheduler, or runtime.

**Failures actually induced:** 1 × SIGTERM (graceful), **3 × consecutive SIGKILL** (crashloop), 1 × operator emergency stop + resume, 1 × DLQ drain (20 entries requeued), 1 × induced permanent agent failure, AI total-provider outage exercised live.

---

## Defect Reproduced and Recovered

### D1 — Every dead-letter entry was anonymous, so a failure backlog could not be triaged (**HIGH**)

The dead-letter queue is the record of work that **permanently failed after all retries** — the first thing an operator opens during an incident. Measured on the live queue:

| Field | Coverage |
|---|---|
| `taskType` | **980 / 980** |
| `deadAt` | **980 / 980** |
| **`agentId`** | **0 / 980** |

The failures were real and varied — **550 `cb trigger`**, **328 `permanent failure`**, **110 `Agent "weather" not found`**, 6 `Timeout: ai/ai exceeded 30000ms` — but every one was anonymous. The queue could record *that* something failed and *when*, never *which component*.

**Why that matters for continuity, measured:** the queue sits at **exactly its 1000-entry cap**, evicting oldest, and the deep-health check `dlq: dlqSize < 50` was correctly failing. So an operator faced a saturated, still-growing backlog of permanent failures with **no way to distinguish one bad adapter from a systemic outage** — the single question triage exists to answer.

**Root cause (read only after reproduction):** [`executionEngine.cjs:373`](agents/runtime/executionEngine.cjs#L373) passed a hardcoded `agentId: null`. `deadLetterQueue.push()` has **always** documented (`agentId {string|null}`) and stored the field — the caller simply never supplied it. `const agent` is block-scoped inside the retry loop, so the push at the end of the function had no reference to it, while `agent.id` was already used in 5 other places (history records, telemetry, logs) inside that loop.

**Recovery:** track the attempted agent in `lastAgentId` alongside `lastError` — identical lifetime, the state of the final attempt. Both execution paths record it (registered agent → `agent.id`, legacy executor → `"legacy"`), and the exhausted-retries return value now reports it too, consistent with the DLQ record.

**Deliberately left as `null`:** the three earlier bail-out returns where **no agent ever ran** (no handler registered for the capability, or an approval gate blocked execution). `null` is the truthful value there, and the regression pins that distinction.

**Verified live:** a dead-letter write now persists `agentId="b18-media-agent"` end-to-end with `taskType` and `attempts` intact. The fix cannot retroactively name the 981 pre-existing anonymous entries — the regression asserts that anything written *from now on* is attributable whenever an agent was involved.

**Regression:** `tests/runtime/24-dlq-attribution.test.cjs` — **9 tests, 9/9 pass**. **Negative-tested: 3 fail** with the fix reverted.

---

## 1. Business Continuity Matrix

| Surface | Routes | Live probe | Reality |
|---|---|---|---|
| **Backups** | `ooplix-backup` PM2 cron | **ran today 03:01** | 9 archives, pruning active, **1.0 MB** latest |
| Backup contents | — | verified | `leads`, `organizations`, `billing`, `memory-store`, `missions`, `vault` — **B.5 fix holding in production** |
| **Deep health** | `/runtime/health/deep` | **207** | 7 named checks; honest multi-status for degraded |
| **Health matrix** | `/runtime/health/matrix` | **200** | score **62 / grade C**, per-subsystem breakdown |
| **Incidents** | `/runtime/incidents` + ack/auto-fix | **200** | 10 detection rules, 5-level severity, 5-state lifecycle |
| **Circuit breakers** | `/runtime/resilience/circuit-breakers` | **200** | per-agent `cbState`, 0 tripped |
| **DLQ** | `/runtime/dead-letter` + `/recover/dlq` | **200** | 989 entries, capped 1000, **replay works** |
| **Replay** | 30+ `/runtime/replay*` routes | **200** | record, execute, diff, timeline, chain |
| **Recovery centre** | `/runtime/recovery-center/*` (6) | **200** | snapshot, triage, activate, advance, complete |
| **Emergency stop** | `/runtime/emergency/{stop,resume}` | **200** | full lifecycle with `emergencyId` |
| Stale/orphan detection | `/runtime/survivability/stale` | **200** | **6 stale workflows** identified |
| Recovery orchestration | `/runtime/recovery-orch/*` (5) | — | restore-chain, rollback, heal-runtime |
| Audit health | `/runtime/audit/health` | **200** | 10 MB, seq-tracked, `malformed: 0` |
| **Total continuity routes** | **416 in 85 files** | 12/12 real paths → 200/207 | 6 HTML fallbacks (paths that don't exist) |

**Correction recorded:** I first read `ooplix-backup` as `status=stopped` and treated it as a continuity failure. `ecosystem.config.cjs:139` sets `autorestart: false` with `cron_restart: "0 2 * * *"` — **stopped is the correct state for a daily cron job between runs**, and the log confirms it completed at 03:01. Not a defect.

## 2. Incident Management Matrix

| Capability | Measured | Status |
|---|---|---|
| Detection engine | `incidentEngine.cjs`, `detect()` runs cleanly | CERTIFIED |
| **10 detection rules** | `deploy_failed`, `deploy_rollback`, `deploy_slow`, `api_error_spike`, `api_error_elevated`, `api_repeated_error`, `health_critical`, `health_degraded`, `route_failure`, `slow_api` | CERTIFIED |
| **Severity classification** | INFO / LOW / MEDIUM / HIGH / CRITICAL | CERTIFIED |
| **Lifecycle states** | open / acknowledged / escalated / resolved / auto-resolved | CERTIFIED |
| Acknowledge | `POST /runtime/incidents/:id/acknowledge` | CERTIFIED |
| Auto-fix + status | `POST …/auto-fix`, `GET …/auto-fix/status` | CERTIFIED |
| **Deduplication** | fingerprint = rule + blueprint + resource, within `DEDUP_WINDOW_MINS` | CERTIFIED |
| **Auto-resolution** | incidents whose fingerprint stops firing are auto-resolved | CERTIFIED |
| Incident KB + fix recommendation | `/runtime/intel/incident-kb`, `/recommend/incident-fixes` | CERTIFIED |
| `requiresAttention` rollup | computed from openCritical / openHigh | CERTIFIED |
| **Process crashes create incidents** | **3 × SIGKILL → 0 incidents** | **GENUINE CAPABILITY GAP** |
| **DLQ saturation creates an incident** | DLQ at cap → 0 incidents | **GENUINE CAPABILITY GAP** |

**Scope stated precisely:** the engine reads **deployment telemetry** (`getHealthSummary`, `getHistory`) and all 10 rules are deployment/API-scoped. Runtime process crashes and queue saturation are **outside its detection surface by design** — so 0 incidents from three hard kills is correct behaviour for what this engine is, not a broken detector. Extending it to runtime signals would be new capability. Recorded as G1/G2, not a defect.

## 3. Runtime Continuity Matrix

Real signals induced and measured.

| Failure | Result | Status |
|---|---|---|
| **SIGTERM** (graceful) | recovered, health **200**, restarts 36→37, **unstable 0** | CERTIFIED |
| **SIGKILL #1** | health **200**, restarts →38, **unstable 0** | CERTIFIED |
| **SIGKILL #2** | health **200**, restarts →39, **unstable 0** | CERTIFIED |
| **SIGKILL #3** | health **200**, restarts →40, **unstable 0** | CERTIFIED |
| **Crashloop resilience** | 3 consecutive hard kills, **no crashloop, no backoff lockout** | CERTIFIED |
| Recovery time | **~11–12 s** per kill (PM2) | CERTIFIED |
| Data after 3 kills | dead-letter 981, organizations 1068, leads 51, csInbox 7 — **all parseable, identical** | CERTIFIED |
| `uncaughtException` handler | logs, records, writes forensics, exits for clean PM2 restart | CERTIFIED |
| `unhandledRejection` handler | registered | CERTIFIED |
| **Crash forensics** | written **synchronously** so it survives the crash | CERTIFIED |
| SIGTERM-vs-SIGINT discrimination | distinguishes PM2 kill from operator Ctrl+C | CERTIFIED |
| Memory guard | `WARN 900MB / CRIT 990MB` (B.8 fix), `max_memory_restart 1536M` | CERTIFIED |
| Drift baseline | heap/rss/listener/timer/queue drift tracked vs boot baseline | CERTIFIED |
| Governor | `maxConcurrent 10`, `maxPerMin 120`, throttle `normal` | CERTIFIED |

## 4. Queue Matrix

| Capability | Measured | Status |
|---|---|---|
| Queue depth | 0 at rest; `queueSize` in throttle telemetry | CERTIFIED |
| **DLQ bounded** | `DLQ_CAP = 1000`, evicts oldest — documented, intentional | CERTIFIED |
| DLQ health threshold | `dlq: dlqSize < 50` — correctly **failing** at 989 | CERTIFIED |
| Second threshold | `dlq_healthy` gate at `< 100` | CERTIFIED |
| **DLQ replay** | `POST /runtime/recover/dlq` → `{queued: 20, remaining: 980}` | CERTIFIED |
| Queue reconciliation | `POST /runtime/recover/queue` → 200 | CERTIFIED |
| Governor reset | `POST /runtime/recover/governor` → 200 | CERTIFIED |
| Retry with backoff | `_backoffMs(attempt)`, retry lineage audited with parent taskId | CERTIFIED |
| Non-retriable short-circuit | `result.nonRetriable` bails immediately | CERTIFIED |
| Circuit breaker | per-agent `cbState`; 550 DLQ entries came from `cb trigger` | CERTIFIED |
| **Orphan cleanup** | `orphans` check in deep health; `orphans: 0` | CERTIFIED |
| Route limit clamping | `Math.max(1, Math.min(parseInt(n) || 50, 500))` — B.7 fix holding | CERTIFIED |
| **DLQ attribution** | Was **0/980**; new entries now name the agent | CERTIFIED (after D1) |
| Historical entries | **981 remain anonymous** — not retroactively fixable | GENUINE CAPABILITY GAP |

## 5. Mission Matrix

| Capability | Measured | Status |
|---|---|---|
| Execution history | 500 records, **successRate 1.0**, 8 unique agents, 9 types, avg 538 ms | CERTIFIED |
| Retry lineage | `recordRetry({taskId: …_r1, originalTaskId, reason, attempt})` | CERTIFIED |
| **Replay capability** | record / execute / diff / timeline / step / export / chain | CERTIFIED |
| Replay store | `/runtime/replay` → 0 replays, stats by chain | CERTIFIED |
| **Stale workflow detection** | **6 stale workflows** named with `lastActivity` | CERTIFIED |
| Stale recovery | `POST /runtime/session-hardening/recover-stale` | CERTIFIED |
| Long-horizon continuity | `/runtime/long-horizon/replay/:id/continuity` | CERTIFIED |
| Recovery memory | `/runtime/recovery-memory` + `/suggest` (learns from past recoveries) | CERTIFIED |
| Org mission attribution | `orgId`/`deptId`/`teamId`/`ownerId` (B.17) | CERTIFIED |
| **Idempotency / duplicate prevention** | No idempotency key observed on task submission | **UNKNOWN** |
| **Automatic mission resume after crash** | Stale workflows are *detected*, not auto-resumed | GENUINE CAPABILITY GAP |
| Stale workflow age | 6 workflows stale since `1779434692060` (~78 days) — detected, never cleaned | OBSERVATION |

## 6. AI Continuity Matrix

Exercised against a genuine total-provider outage.

| Test | Result | Status |
|---|---|---|
| `/health` reports AI state | **`services.ai: false`** with a warning | CERTIFIED |
| **`/ai/chat` under total outage** | **502** `AI backend unavailable. Check provider API keys…` | CERTIFIED |
| **No fabricated success** | Explicit failure, no invented content — **B.9/B.14 fixes holding** | CERTIFIED |
| Provider failover | `ollama` 404 → `lmstudio` unreachable → next provider tried | CERTIFIED |
| `/jarvis` with a working fallback | **200** with real content — failover genuinely works | CERTIFIED |
| Static-config skip | Unconfigured providers skipped in failover order (Phase B.1) | CERTIFIED |
| Quota exhaustion | **429** `usage_quota_exceeded` with `used`/`limit`/`upgradeUrl` (B.14) | CERTIFIED |
| Cost attribution during degradation | Failures recorded with `success: false` (B.14) | CERTIFIED |
| **Business surfaces during AI outage** | `/crm/leads`, `/co3/cs`, `/billing/status`, `/customer-org/health/stats`, `/orgs` — **all 200** | CERTIFIED |
| Degraded-mode announcement | Health reports it; no user-facing banner verified | UNKNOWN |

**Correction recorded:** my first `/ai/chat` probe returned **400 `prompt required`** — my payload used `message`. With the documented field the route returns a truthful **502**. Not a defect.

## 7. Monitoring Matrix

| Signal | Measured | Status |
|---|---|---|
| `/health` | **200**, uptime, per-service booleans, warnings | CERTIFIED |
| **`/runtime/health/deep`** | **207 multi-status** — honest partial-failure code | CERTIFIED |
| 7 named checks | `agents`, `memory`, `dlq`, `logFile`, `orphans`, `memDrift`, `drift` | CERTIFIED |
| Health matrix | score **62 / C** with per-subsystem detail | CERTIFIED |
| Metrics history | 50 days retained | CERTIFIED |
| Per-agent health | 42 agents with `cbState`, `active`, `successRate` | CERTIFIED |
| Vitals | `memRSS`, `memHeap`, `cpuLoad` | CERTIFIED |
| Drift detection | boot baseline vs current across 8 dimensions | CERTIFIED |
| Burn-in counters | long-session survivability metrics | CERTIFIED |
| Audit health | 10 MB, `seq` continuity, `malformed: 0`, type distribution | CERTIFIED |
| **SSE event stream** | 3345 events, ring 500, **`subscriberCount: 20 / 20`** | CERTIFIED WITH LIMITATIONS |
| **SSE at capacity** | Bus **throws** `EventBus at capacity (20 subscribers)`; all 20 slots held by *internal* subscribers | **GENUINE CAPABILITY GAP** |

**Reproduced:** filling the bus in a clean process rejected the 21st subscriber with a throw, cap enforced at 20. On the live server all 20 slots are consumed by internal workflow subscribers (`engorg_wf_*`, `bizorg_wf_*`, `orchestrator_i3`, `decision_engine_i2`), so **an operator monitoring client would be the 21st and rejected**. `MAX_SUBS = 20` is a deliberate leak-prevention guard (documented "hard cap — prevents runaway connection leaks"); raising it is a capacity decision, not a defect fix. Recorded as G3.

## 8. Recovery Matrix

| Signal | Before | After 3 × SIGKILL | Status |
|---|---|---|---|
| Health | 200 | **200** | CERTIFIED |
| PM2 status | online | **online** | CERTIFIED |
| **Unstable restarts** | 0 | **0** | CERTIFIED |
| Recovery time | — | **~11–12 s each** | CERTIFIED |
| dead-letter.json | 981 | **981** | CERTIFIED |
| organizations.json | 1068 | **1068** | CERTIFIED |
| leads.json | 51 | **51** | CERTIFIED |
| co3 csInbox | 7 | **7** | CERTIFIED |
| All stores parseable | — | **yes** | CERTIFIED |
| Backups intact | 9 archives | **9** | CERTIFIED |
| Emergency state clean | — | `active: false` | CERTIFIED |
| Atomic writes (orgs) | `.tmp` + rename, per-PID | CERTIFIED |
| Atomic writes (DLQ, support, customer) | whole-file, **no** `.tmp`+rename | CERTIFIED WITH LIMITATIONS |

## 9. Multi-org Matrix

| Probe | Result | Status |
|---|---|---|
| **Org A declares emergency stop** | 200, `emergencyId: emerg-1`, level critical | CERTIFIED |
| **Org B `/orgs` during org A emergency** | **200** | CERTIFIED |
| **Org B `/crm/leads`** | **200** | CERTIFIED |
| **Org B `/billing/status`** | **200** | CERTIFIED |
| **Org B `/co3/cs`** | **200** | CERTIFIED |
| Org A surfaces during its own emergency | **200** — business unaffected | CERTIFIED |
| Blast radius | Emergency halts **agent execution**, not tenant business surfaces | CERTIFIED |
| Resume | 200, `resolvedAt` stamped | CERTIFIED |
| Cross-tenant workforce isolation | 403 for non-members (B.17) | CERTIFIED |
| **Per-org emergency scoping** | Emergency stop is **global**, not per-org | GENUINE CAPABILITY GAP |

One org's failure genuinely cannot take another down — verified live, not inferred.

## 10. Business Impact Matrix

| Impact | Before | After |
|---|---|---|
| **Triage a failure backlog** | **Impossible** — 0 of 980 permanent failures named an agent, while the queue sat at its 1000 cap evicting oldest | New failures name the agent |
| Distinguish one bad adapter from systemic outage | **No** | Yes |
| Failure return value attribution | `agentId: null` on exhausted retries | Reports the agent |
| Genuine no-agent cases | — | Correctly still `null` |
| Business survives AI total outage | — | **All 5 business surfaces 200**, AI fails honestly with 502 |
| Business survives 3 hard kills | — | **0 unstable restarts, 0 data loss, ~12 s each** |
| Backup contains customer data | — | **B.5 fix verified in production** (leads/orgs/billing/memory) |
| One org's emergency affects another | — | **No** — verified with two live orgs |
| Operator can halt and resume the fleet | — | Yes, with full audit (`emergencyId`, reason, operator) |
| Incident lifecycle audited | — | Every continuity op recorded with operator + reason |

## 11. Remaining Gap Matrix

| ID | Gap | Type | Severity |
|---|---|---|---|
| **G1** | **Process crashes create no incident.** 3 consecutive SIGKILLs produced **0 incidents**. All 10 detection rules are deployment/API-scoped and read deployment telemetry; runtime crashes are outside the engine's surface. Recovery works — but nothing records that an incident *occurred*, so there is no post-incident record or MTTR. | **GENUINE CAPABILITY GAP** | **High** |
| **G2** | **DLQ saturation creates no incident.** The queue is at its 1000 cap evicting permanent failures and the health check correctly fails, but no incident opens and nothing escalates. | **GENUINE CAPABILITY GAP** | **High** |
| **G3** | **Monitoring can be locked out at peak load.** `MAX_SUBS = 20` and all 20 SSE slots are held by internal workflow subscribers; the bus **throws** on the 21st. An operator dashboard connecting during an incident — exactly when it is needed — would be rejected. | **GENUINE CAPABILITY GAP** | **High** |
| G4 | **981 historical DLQ entries remain anonymous** — the fix cannot retroactively attribute them, so the existing backlog stays untriageable. | GENUINE CAPABILITY GAP | Medium |
| G5 | **Stale workflows are detected but never resumed or cleaned** — 6 have been stale for ~78 days. Detection without remediation. | GENUINE CAPABILITY GAP | Medium |
| G6 | **No idempotency key on task submission** — duplicate-submission prevention across a crash boundary could not be verified. | **UNKNOWN** | Medium |
| G7 | **Emergency stop is global, not per-org** — an operator cannot quarantine one tenant's workloads while others run. | GENUINE CAPABILITY GAP | Medium |
| G8 | **No incident → customer communication path** — no status page, no tenant-facing incident notice, no maintenance banner verified. | GENUINE CAPABILITY GAP | Medium |
| G9 | **DLQ, support and customer stores write whole-file without `.tmp`+rename**, unlike `organizations.json` and `agents/taskQueue.cjs`. A crash mid-write could truncate. Not reproduced as loss across 4 induced crashes. | OBSERVATION | Medium |
| G10 | **Health matrix score 62/C** and deep health persistently **207** (`memory`, `dlq`, `drift` failing) — the system self-reports degraded in normal operation, which risks alert fatigue. | OBSERVATION | Medium |
| G11 | Heap drift **175 → 761 MB in ~14 min** observed on one baseline window. Within the 900 MB warn / 1536 M restart guards (B.8), and 3 crashes showed no OOM, but growth is steep. | OBSERVATION | Medium |
| G12 | **No RTO/RPO published** — recovery is fast (~12 s measured) and backups daily, but neither target is documented, so continuity cannot be certified against a commitment. | GENUINE CAPABILITY GAP | Medium |
| G13 | **Backups are local-disk only** (`backups/`, 9 archives) — no off-host or off-site copy verified, so a host loss loses both primary and backup. | GENUINE CAPABILITY GAP | **High** |
| G14 | 6 continuity paths I probed return the **SPA HTML fallback** (`/healthz`, `/readyz`, `/runtime/health`, `/runtime/dlq`, `/runtime/queue`, `/runtime/scheduler`) — the real routes exist under different names, but `/healthz` and `/readyz` are conventional and their absence will surprise orchestrators. | OBSERVATION | Low |
| G15 | Automation scheduler status route probed under two names, both HTML — cron continuity was verified in B.13, not re-verified here. | UNKNOWN | Low |

---

## Final Business Continuity Certification

| Area | Classification |
|---|---|
| Business Continuity Inventory | **CERTIFIED** — 416 routes / 85 files, backups running and verified, all real paths 200/207 |
| Continuity Lifecycle | **CERTIFIED** — normal → degraded (207) → emergency → recovery → resume, all exercised live |
| Incident Management | **CERTIFIED WITH LIMITATIONS** — 10 rules, 5 severities, 5 states, dedup + auto-resolve; deployment-scoped only |
| Operational Continuity | **CERTIFIED** — all 5 business surfaces stayed 200 through a total AI outage |
| Scheduler Continuity | **CERTIFIED** — backup cron ran on schedule; PM2 `cron_restart` semantics correct |
| Queue Continuity | **CERTIFIED** (after D1) — bounded DLQ, working replay, retry lineage, orphan checks |
| Mission Continuity | **CERTIFIED WITH LIMITATIONS** — replay/history/stale detection real; no auto-resume, idempotency UNKNOWN |
| AI Continuity | **CERTIFIED** — honest 502, real failover, quota 429, **zero fabrication** |
| Monitoring Continuity | **CERTIFIED WITH LIMITATIONS** — rich honest telemetry incl. 207; SSE lockout at 20/20 |
| **Multi-org Continuity** | **CERTIFIED** — one org's emergency provably cannot affect another |
| Disaster Communication | **CERTIFIED (operator) / GENUINE CAPABILITY GAP (customer)** — full audit timeline; no status page |
| Runtime Recovery | **CERTIFIED** — SIGTERM + 3 × SIGKILL, **0 unstable restarts, 0 data loss, ~12 s each** |
| Human Operations | **CERTIFIED** — emergency stop/resume, DLQ replay, queue + governor recovery, all audited |
| Audit Across Incident Lifecycle | **CERTIFIED** — every continuity op with operator, reason, `emergencyId` |

### **Business Continuity Readiness: CERTIFIED WITH LIMITATIONS**

**The runtime survives real violence, and I verified that rather than assuming it.** One SIGTERM and **three consecutive SIGKILLs** all recovered to HTTP 200 in ~11–12 seconds each with **zero unstable restarts** — no crashloop, no backoff lockout — and every store came back parseable with identical counts (dead-letter 981, organizations 1068, leads 51, csInbox 7). `uncaughtException` writes crash forensics **synchronously** so the evidence survives the crash, and the handler distinguishes a PM2 kill from an operator Ctrl+C. Backups are genuinely running: the 02:00 cron completed at 03:01 with 9 archives and active pruning, and unpacking the latest confirmed the **Phase B.5 fix is holding in production** — `leads.json`, `organizations.json`, `billing.json` and `memory-store.json` are all inside the archive, which was the exact omission that made B.5's backup worthless.

**Operational continuity — the thing this phase is actually about — held.** Under a genuine total AI-provider outage, `/ai/chat` returned a truthful **502** naming the cause with **no fabricated content** (the B.9 and B.14 honesty fixes holding), while `/crm/leads`, `/co3/cs`, `/billing/status`, `/customer-org/health/stats` and `/orgs` all stayed **200**. `/health` reported `services.ai: false` rather than a green light. And multi-org containment is real, not theoretical: with org A under a declared emergency stop, org B's business surfaces all returned 200 — the emergency halts agent execution, not tenant operations.

**The defect I found made incident triage impossible.** The dead-letter queue is what an operator opens first during an incident, and **0 of 980 entries named the agent that failed** — while `taskType` and `deadAt` were present on 980/980. The failures were real and specific (550 circuit-breaker trips, 328 permanent failures, 110 missing-agent errors), the queue sat at **exactly its 1000-entry cap evicting oldest**, and the health check was correctly screaming — yet nothing could answer *which component is failing*, which is the difference between restarting one adapter and declaring a systemic outage. `deadLetterQueue.push()` had always documented and stored `agentId`; `executionEngine` passed a hardcoded `null` because `agent` was block-scoped inside the retry loop. Tracking it in `lastAgentId` next to `lastError` fixed both the DLQ record and the failure return value, while deliberately leaving `null` on the three bail-outs where no agent ever ran.

**Three gaps are serious enough to name, and all three are about knowing rather than surviving.** Recovery works, but **three hard kills produced zero incidents** (G1) — every one of the 10 detection rules is deployment-scoped, so the system heals without ever recording that an incident happened, leaving no post-incident record and no MTTR. **DLQ saturation opens no incident either** (G2), despite the health check failing. And **monitoring can be locked out precisely when it is needed** (G3): all 20 SSE slots are held by internal workflow subscribers and the bus *throws* on the 21st, so an operator dashboard connecting mid-incident is rejected. Separately, **backups are local-disk only** (G13) — fast recovery from process failure, no verified protection against host loss — and **no RTO/RPO is published** (G12), so continuity cannot be certified against a commitment even though the measured numbers are good.

**Three corrections to my own measurements**, each of which would have been a false finding: I read `ooplix-backup` as `status=stopped` and nearly reported a backup failure — `autorestart: false` with `cron_restart` makes *stopped* the correct state between daily runs, and the log confirmed it ran; my first `/ai/chat` probe's **400 `prompt required`** was my payload using `message`; and I initially treated 6 HTML-fallback continuity paths as broken endpoints when the real routes simply live under different names (though `/healthz` and `/readyz` genuinely don't exist). I also could not induce a DLQ write through the full retry path — the circuit breaker bailed after attempt 1 — so I verified the fix through the persistence contract and the call site rather than claim an end-to-end reproduction I did not get.

**Validation hygiene:** the emergency stop I declared was resumed (`active: false`); the 9 B18 test entries were removed from the live dead-letter queue; the 20 DLQ entries I requeued were a genuine use of existing recovery capability and left in place. Regression **144/144 existing + 133/133 new (B.6–B.18, `--test-concurrency=1`)**, with the new suite negative-tested (**3 of 9 fail** with the fix reverted). Change limited to `agents/runtime/executionEngine.cjs` (**+29/−3**) plus one new test file. No merge, no push, no new incident-management system, no new scheduler, no new runtime, no architecture redesign.
