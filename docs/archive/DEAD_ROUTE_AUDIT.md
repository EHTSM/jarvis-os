> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# DEAD ROUTE AUDIT
Phase N — Legacy Runtime Removal + Final Core Cleanup  
Date: 2026-05-16

---

## METHODOLOGY

Audit scope: `backend/routes/legacy.js` (now deleted).  
Inputs used: frontend component grep, `runtimeApi.js` review, regression test coverage, server startup module load trace, route-by-route caller analysis.

A route was classified DEAD if all of the following were true:
1. No frontend component imports a function that calls it
2. No regression test hits it
3. Its module either fails to load (503) or has no active callers

A route was classified DANGER if it could execute arbitrary code, trigger external sends, or bypass the runtime governor — regardless of whether it had callers.

---

## DEAD ROUTES (no callers anywhere)

### Module-load failures (always 503)

These routes could never succeed because their backing modules failed to load on startup.
`orchestratorMod = tryRequire(ROOT + "orchestrator.cjs")` returned null on VPS.

| Path | Module | 503 cause |
|------|--------|-----------|
| `GET /memory` | orchestratorMod.getMemoryState | Not loaded |
| `DELETE /memory` | orchestratorMod.clearMemoryState | Not loaded |
| `GET /learning/*` (8 routes) | orchestratorMod.learningSystem | Not loaded |
| `GET /context/history` | orchestratorMod.contextEngine | Not loaded |
| `GET /context/session` | orchestratorMod.contextEngine | Not loaded |
| `GET /voice/status` | orchestratorMod.voiceAgent | Not loaded |
| `POST /voice/speak` | orchestratorMod.voiceAgent | Not loaded |
| `GET /desktop/*` (8 routes) | orchestratorMod.desktopAgent | Not loaded |
| `GET /agents/list` | orchestratorMod.agentFactory | Not loaded |
| `GET /agents/suggestions` | orchestratorMod.agentFactory | Not loaded |
| `POST /agents/delegate` | orchestratorMod.agentFactory | Not loaded |
| `GET /leads` | leadsMod.getMapsLeads | Not loaded + no API key |
| `POST /parse-command` | commandParserMod.parseCommand | Not loaded |

### Live code with no callers

These routes had working code but no component, test, or operator ever called them.

| Path | Notes |
|------|-------|
| `GET /memory/suggestions` | commandHistory.getSuggestions() — evolution artifact |
| `GET /memory/frequency` | commandHistory.getFrequency() — evolution artifact |
| `GET /memory/history` | commandHistory command ring buffer |
| `POST /predict/next-commands` | Same getSuggestions() result |
| `POST /start-automation` | Hardcoded stub returning "already running" |
| `/saas/dashboard` | `agents/saas.cjs` static HTML string |
| `/saas/leads` | Duplicate of `GET /crm` — no caller |
| `GET /agents/status` | agentFactory not loaded → always partial 503 |
| `GET /agents/top-50` | Same |
| `GET /agents/perf` | metricsCollector — worked but no caller |
| `GET /auto-agent/status` | Returns hardcoded "active" regardless of state |
| `POST /workflow/create` | In-memory only — lost on restart |
| `GET /workflow/list` | Always empty list after restart |
| `GET /scheduled` | Duplicate of GET /tasks |
| `GET /scheduled/:id` | Duplicate |
| `DELETE /scheduled/:id` | Duplicate |
| `DELETE /scheduled` | No caller |
| `GET /scheduler/status` | Working — kept in tasks.js as diagnostic |
| `GET /queue/status` | Working — kept in tasks.js as diagnostic |

---

## DANGEROUS ROUTES (removed regardless of callers)

| Path | Danger | Notes |
|------|--------|-------|
| `POST /agents/500/execute` | Autonomous multi-agent execution | Bypasses governor, no limits |
| `POST /agents/500/domain/:domain` | Same | Domain-targeted |
| `GET /agents/500/initialize` | Loads 500-agent system into memory | One HTTP request activates it |
| `POST /agents/:agentName/execute` | Arbitrary agent execution | Governor bypass |
| `POST /auto-agent/execute` | executeCommand() directly | Governor bypass |
| `POST /auto-agent/schedule` | setTimeout(executeCommand()) | Delayed governor bypass |
| `POST /workflow/execute` | Multi-step executeCommand() loop | Governor bypass |
| `GET /bulk` | WhatsApp blast to all CRM leads | No confirmation, hardcoded message |

**Why these are particularly dangerous:**  
The runtime governor (`agents/runtime/governor.cjs`) provides emergency stop, queue depth limits, execution receipts, and stuck-task detection. The DANGER routes called `executeCommand()` directly, completely bypassing all of these controls. An attacker with a valid JWT could have used `/auto-agent/execute` to run arbitrary commands on the VPS without the operator being able to stop them via the emergency stop button.

`GET /bulk` is in a separate danger category: it required no request body and would immediately send a promotional WhatsApp message to every lead in the CRM. One accidental HTTP request.

---

## ALREADY-GONE ROUTES (410 stubs removed)

These were converted to 410 in Phase M and the stub code itself removed in Phase N.

| Path | Phase removed |
|------|--------------|
| `GET /evolution/score` | Phase M (410) → Phase N (deleted) |
| `GET /evolution/approvals` | Phase M (410) → Phase N (deleted) |
| `POST /evolution/approve/:id` | Phase M (410) → Phase N (deleted) |
| `POST /evolution/reject/:id` | Phase M (410) → Phase N (deleted) |
| `GET /evolution/suggestions` | Phase M (410) → Phase N (deleted) |
| `GET /self-improve/analyze` | Phase M (410) → Phase N (deleted) |
| `GET /self-improve/evaluation` | Phase M (410) → Phase N (deleted) |
| `POST /agents/dynamic/create` | Phase I (410) → Phase N (deleted) |
| `POST /agents/500/start-learning` | Phase I (410) → Phase N (deleted) |

---

## ROUTES THAT LOOK DEAD BUT AREN'T

| Path | Why it looks dead | Why it's kept |
|------|-------------------|---------------|
| `POST /tasks` | No component calls `addTask()` | `addTask()` is exported — valid for operator scripting; POST endpoint itself is active infrastructure |
| `DELETE /tasks/:id` | TaskQueuePanel doesn't have cancel UI | Valid operational endpoint; absence of current caller ≠ dead |
| `GET /scheduler/status` | Not called from frontend | Useful operator diagnostic endpoint |

---

## SUMMARY

| Cause | Count |
|-------|-------|
| Module failed to load (503 unconditional) | 29 |
| No caller anywhere | 13 |
| Danger: bypasses governor | 7 |
| Danger: unconditional external send | 1 |
| 410 stubs from prior phases | 9 |
| **Total removed** | **51** |
| **Total kept** | **5** |
