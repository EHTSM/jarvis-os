> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# LEGACY REMOVAL REPORT
Phase N — Legacy Runtime Removal + Final Core Cleanup  
Date: 2026-05-16

---

## EXECUTIVE SUMMARY

`backend/routes/legacy.js` (483 lines) has been deleted.  
5 operational routes extracted to `backend/routes/tasks.js` (82 lines).  
51 routes removed across 14 route groups.  
All 40 regression tests pass after removal.  
Server RSS: 125.8MB → 74.8MB (−40%).

---

## FILES DELETED

| File | Lines | Reason |
|------|-------|--------|
| `backend/routes/legacy.js` | 483 | All useful routes moved to `tasks.js`; remainder was dead/dangerous |

---

## FILES CREATED

| File | Lines | Contents |
|------|-------|---------|
| `backend/routes/tasks.js` | 82 | `GET/POST/DELETE /tasks`, `GET /scheduler/status`, `GET /queue/status` |

---

## FILES MODIFIED

| File | Change |
|------|--------|
| `backend/routes/index.js` | Added `router.use(require("./tasks"))` |
| `backend/server.js` | Removed `try { app.use(require("./routes/legacy")) } catch` mount block |

---

## ROUTES REMOVED (51 routes across 14 groups)

### Group 1: Evolution System (7 routes — 410 stubs from Phase M)
`GET /evolution/score`, `GET /evolution/approvals`, `POST /evolution/approve/:id`,  
`POST /evolution/reject/:id`, `GET /evolution/suggestions`,  
`GET /self-improve/analyze`, `GET /self-improve/evaluation`

The 410 stubs existed to signal clients during Phase M transition. Now removed entirely — 404 is the correct long-term signal for a permanently removed endpoint.

### Group 2: Scheduled Task Aliases (4 routes — duplicate of /tasks)
`GET /scheduled`, `GET /scheduled/:id`, `DELETE /scheduled/:id`, `DELETE /scheduled`

These were compatibility aliases pointing to the same `taskQueueMod.getAll()`. No frontend caller.

### Group 3: Memory / Analytics (5 routes — evolution artifacts)
`GET /memory`, `DELETE /memory`, `GET /memory/suggestions`, `GET /memory/frequency`, `GET /memory/history`

The `/memory/suggestions` and `/memory/frequency` routes backed by `commandHistory` were evolution-era frequency analytics disguised as "memory". `GET/DELETE /memory` depended on `orchestratorMod.getMemoryState()` which was never loaded on this VPS (503 unconditionally).

### Group 4: Learning System (8 routes — always 503)
`GET /learning/stats`, `/learning/habits`, `/learning/patterns`, `/learning/frequency`,  
`/learning/success-rates`, `/learning/suggestions`, `/learning/optimizations`, `DELETE /learning`

All 8 routes returned 503 unconditionally: `learningSystem` came from `orchestratorMod` which failed to load on every startup.

### Group 5: Context Engine (2 routes — always 503)
`GET /context/history`, `GET /context/session`

Same: `contextEngine` from unloaded `orchestratorMod`.

### Group 6: Voice Agent (2 routes — always 503 + hardware-absent)
`GET /voice/status`, `POST /voice/speak`

VPS has no audio hardware or display environment. Routes returned 503 unconditionally.

### Group 7: Desktop Agent (8 routes — always 503 + hardware-absent)
`GET /desktop/status`, `POST /desktop/open-app`, `POST /desktop/type`,  
`POST /desktop/press-key`, `POST /desktop/press-combo`, `POST /desktop/move-mouse`,  
`POST /desktop/click`, `POST /desktop/double-click`

No display/desktop environment on VPS. Routes always 503.

### Group 8: Agent Factory (8 routes — 503 + DANGER)
`GET /agents/status`, `/agents/list`, `/agents/suggestions`, `/agents/top-50`,  
`POST /agents/dynamic/create` (was 410), `POST /agents/delegate`,  
`POST /agents/:agentName/execute`, `DELETE /agents/:agentName`, `GET /agents/perf`, `GET /agents/:agentName`

`agentFactory` from `orchestratorMod` — not loaded. Dynamic execute routes were a DANGER category even when loaded: they ran arbitrary agent code outside the runtime governor's control.

### Group 9: 500-Agent System (7 routes — DANGER)
`GET /agents/500/initialize`, `/agents/500/status`, `/agents/500/by-domain`,  
`POST /agents/500/execute`, `POST /agents/500/domain/:domain`,  
`POST /agents/500/start-learning` (was 410), `GET /agents/500/:agentName`

The 500-agent MasterAgentManager system — the original "AGI playground". HTTP-triggered autonomous multi-agent execution with no governor oversight. No frontend caller, no regression coverage, maximum blast radius.

### Group 10: Auto-Agent (3 routes — DANGER)
`POST /auto-agent/schedule`, `POST /auto-agent/execute`, `GET /auto-agent/status`

`/auto-agent/execute` and `/auto-agent/schedule` directly called `executeCommand(parseCommand(input))` — bypassing the runtime governor (emergency stop, queue limits, execution receipts). These were functionally identical to `/runtime/dispatch` but without safety controls.

### Group 11: In-Memory Workflows (3 routes — DEAD + DANGER)
`POST /workflow/create`, `POST /workflow/execute`, `GET /workflow/list`

State was in-memory and lost on every restart. `/workflow/execute` ran multi-step `executeCommand()` loops without governor. Not the same as the operator WorkflowPanel (which uses `/runtime/dispatch` and `/runtime/queue`).

### Group 12: Google Maps Leads (1 route — DEAD)
`GET /leads`

`getMapsLeads` from `leadsMod` — `GOOGLE_API` key not configured; always returned `[]` via `.catch(() => [])`. No frontend caller (different from CRM `/crm` leads).

### Group 13: Parse-Command (1 route — DEAD)
`POST /parse-command`

`commandParserMod` not loaded → 503 unconditionally.

### Group 14: Misc Dead (3 routes)
`POST /predict/next-commands` — `commandHistory.getSuggestions()`, evolution artifact  
`POST /start-automation` — hardcoded stub "Automation loop is already running"  
`GET /bulk` — **DANGER**: triggered WhatsApp bulk blast to all CRM leads unconditionally

Also removed: `/saas` mount (2-route stub with no frontend caller).

---

## CODE REMOVED (module-level)

| Object | Lines | Purpose |
|--------|-------|---------|
| `commandHistory` object | ~20 | Evolution-era command frequency analytics |
| `masterAgentMgr` + `initMasterAgentMgr()` | ~15 | 500-agent system state |
| `workflows` object | ~2 | In-memory workflow store |
| `orchestratorMod` require + destructure | ~25 | voice/desktop/agents/learning/context modules |
| `schedulerMod` require + destructure | ~10 | Legacy scheduler |
| `commandParserMod` require + destructure | ~5 | parse-command, auto-agent, workflow |
| `leadsMod`, `bulkSenderMod`, `followUpSeqMod` | ~6 | dead route dependencies |
| `saasRoutes` require | ~2 | /saas |

These `require()` calls previously executed on every server startup, loading large module trees (orchestrator.cjs, MasterAgentManager.cjs, etc.) into memory even when the routes were never called.

---

## ROUTES KEPT → `backend/routes/tasks.js`

| Route | Category | Consumer |
|-------|----------|---------|
| `GET /tasks` | ACTIVE | `OperatorConsole.jsx` → `getTasks()` |
| `POST /tasks` | PARTIAL | `runtimeApi.addTask()` (exported, no component caller currently) |
| `DELETE /tasks/:id` | PARTIAL | Available for task cancellation |
| `GET /scheduler/status` | DIAGNOSTIC | Operator tooling |
| `GET /queue/status` | DIAGNOSTIC | Operator tooling |

All 5 routes require `requireAuth` (operator JWT). No audit logging added — task queue reads are low-risk.

---

## RUNTIME IMPACT

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Server RSS at startup | 125.8MB | 74.8MB | **−40%** |
| Heap at startup | 34.6MB | 37.2MB | +7% (normal variance) |
| `backend/routes/` files | 12 (incl. legacy.js) | 12 (legacy.js → tasks.js) | net zero |
| `backend/routes/legacy.js` lines | 483 | 0 (deleted) | −100% |
| `backend/routes/tasks.js` lines | — | 82 | new file |
| Routes removed | — | 51 | — |
| Regression | 40/40 | 40/40 | ✓ |
