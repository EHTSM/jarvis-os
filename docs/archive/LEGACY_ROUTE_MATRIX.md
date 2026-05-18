> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# LEGACY ROUTE MATRIX
Phase N — Legacy Runtime Removal + Final Core Cleanup  
Date: 2026-05-16

Source file: `backend/routes/legacy.js` (483 lines at audit time)

---

## CATEGORY DEFINITIONS

| Code | Meaning |
|------|---------|
| **ACTIVE** | Called by frontend component or regression test today |
| **PARTIAL** | Exported in API layer but no component calls it |
| **COMPAT** | Duplicate of a modern endpoint |
| **DEAD** | Module returns 503, or no caller anywhere |
| **DANGER** | Can execute arbitrary code, spawn agents, or trigger external sends without limits |
| **GONE** | Already 410 from Phase M — stubs still in file |

---

## COMPLETE ROUTE INVENTORY

### Task Queue — `/tasks` (3 routes)

| Method | Path | Category | Caller |
|--------|------|----------|--------|
| GET | `/tasks` | **ACTIVE** | `OperatorConsole.jsx` → `getTasks()` → `GET /tasks` |
| POST | `/tasks` | **PARTIAL** | Exported as `addTask()` in `runtimeApi.js`, no component calls it |
| DELETE | `/tasks/:id` | **PARTIAL** | No component calls it; TaskQueuePanel is read-only |

**Decision: KEEP. Move to `backend/routes/tasks.js`.**

---

### Diagnostics (2 routes)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/scheduler/status` | **PARTIAL** | Returns taskQueue counts — overlaps with `/runtime/status`; no frontend caller |
| GET | `/queue/status` | **PARTIAL** | Uses `metricsCollector.queueStatus()` — no frontend caller |

**Decision: KEEP in `tasks.js` as operator diagnostics. Low risk, useful for debugging.**

---

### Scheduled Tasks — `/scheduled/*` (4 routes, COMPAT)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/scheduled` | **COMPAT** | Same as `GET /tasks` — duplicate |
| GET | `/scheduled/:id` | **COMPAT** | Same as `GET /tasks` by id |
| DELETE | `/scheduled/:id` | **COMPAT** | Same as `DELETE /tasks/:id` |
| DELETE | `/scheduled` | **COMPAT** | Bulk cancel pending |

**Decision: REMOVE. Aliases of `/tasks`, no frontend caller.**

---

### Evolution System (7 routes, GONE)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/evolution/score` | **GONE** | 410 stub from Phase M |
| GET | `/evolution/approvals` | **GONE** | 410 stub from Phase M |
| POST | `/evolution/approve/:id` | **GONE** | 410 stub from Phase M |
| POST | `/evolution/reject/:id` | **GONE** | 410 stub from Phase M |
| GET | `/evolution/suggestions` | **GONE** | 410 stub from Phase M |
| GET | `/self-improve/analyze` | **GONE** | 410 stub from Phase M |
| GET | `/self-improve/evaluation` | **GONE** | 410 stub from Phase M |

**Decision: REMOVE stubs entirely. The 410 purpose was to signal existing clients during transition. Now stale.**

---

### Memory / Analytics (5 routes, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/memory` | **DEAD** | Returns `orchestratorMod.getMemoryState()` — orchestrator.cjs not loaded |
| DELETE | `/memory` | **DEAD** | Returns `orchestratorMod.clearMemoryState()` — same |
| GET | `/memory/suggestions` | **DEAD** | Returns `commandHistory.getSuggestions()` — evolution analytics |
| GET | `/memory/frequency` | **DEAD** | Returns `commandHistory.getFrequency()` — evolution analytics |
| GET | `/memory/history` | **DEAD** | Returns in-memory command log — evolution analytics |

**Decision: REMOVE. No frontend caller. `commandHistory` is an evolution-era analytics artifact.**

---

### Learning System (8 routes, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/learning/stats` | **DEAD** | `learningSystem` from orchestratorMod — 503 on load |
| GET | `/learning/habits` | **DEAD** | Same |
| GET | `/learning/patterns` | **DEAD** | Same |
| GET | `/learning/frequency` | **DEAD** | Same |
| GET | `/learning/success-rates` | **DEAD** | Same |
| GET | `/learning/suggestions` | **DEAD** | Same |
| GET | `/learning/optimizations` | **DEAD** | Same |
| DELETE | `/learning` | **DEAD** | Same |

**Decision: REMOVE. `learningSystem` module not loaded; routes return 503 unconditionally.**

---

### Context Engine (2 routes, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/context/history` | **DEAD** | `contextEngine` from orchestratorMod — 503 on load |
| GET | `/context/session` | **DEAD** | Same |

**Decision: REMOVE.**

---

### Voice Agent (2 routes, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/voice/status` | **DEAD** | `voiceAgent` from orchestratorMod — 503 on load |
| POST | `/voice/speak` | **DEAD** | Same — no active speech hardware on VPS |

**Decision: REMOVE.**

---

### Desktop Agent (8 routes, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/desktop/status` | **DEAD** | `desktopAgent` from orchestratorMod — 503 on load |
| POST | `/desktop/open-app` | **DEAD** | Same |
| POST | `/desktop/type` | **DEAD** | Same |
| POST | `/desktop/press-key` | **DEAD** | Same |
| POST | `/desktop/press-combo` | **DEAD** | Same |
| POST | `/desktop/move-mouse` | **DEAD** | Same |
| POST | `/desktop/click` | **DEAD** | Same |
| POST | `/desktop/double-click` | **DEAD** | Same |

**Decision: REMOVE. VPS has no display environment. Routes always 503.**

---

### Agent Factory (8 routes, DEAD + DANGER)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/agents/status` | **DEAD** | `agentFactory` from orchestratorMod — 503 on load |
| GET | `/agents/list` | **DEAD** | Same |
| GET | `/agents/suggestions` | **DEAD** | Same |
| GET | `/agents/top-50` | **DEAD** | Same |
| POST | `/agents/dynamic/create` | **GONE** | 410 from Phase I |
| POST | `/agents/delegate` | **DEAD** | Same |
| POST | `/agents/:agentName/execute` | **DANGER** | Executes arbitrary agent code |
| DELETE | `/agents/:agentName` | **DEAD** | Same |
| GET | `/agents/perf` | **DEAD** | Uses `metricsCollector` — only works if MC loaded |
| GET | `/agents/:agentName` | **DEAD** | agentFactory unavailable |

**Decision: REMOVE ALL. agentFactory module not reliably loaded. Dynamic execution endpoints are DANGER.**

---

### 500-Agent System (7 routes, DANGER)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/agents/500/initialize` | **DANGER** | Instantiates MasterAgentManager with 500 agent slots |
| GET | `/agents/500/status` | **DANGER** | State readout of 500-agent system |
| GET | `/agents/500/by-domain` | **DANGER** | Lists all 500 agents |
| POST | `/agents/500/execute` | **DANGER** | Routes tasks through 500-agent orchestration |
| POST | `/agents/500/domain/:domain` | **DANGER** | Domain-targeted execution |
| POST | `/agents/500/start-learning` | **GONE** | 410 from Phase I |
| GET | `/agents/500/:agentName` | **DANGER** | Per-agent status |

**Decision: REMOVE ALL. The 500-agent autonomous execution system is the original "AGI playground" target. No frontend component or regression test references it. Maximum attack surface for minimum value.**

---

### Auto-Agent (3 routes, DANGER)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| POST | `/auto-agent/schedule` | **DANGER** | Spawns arbitrary command execution via `setTimeout(executeCommand)` — no queue, no governor |
| POST | `/auto-agent/execute` | **DANGER** | Direct `executeCommand(parseCommand(input))` — bypasses the runtime governor |
| GET | `/auto-agent/status` | **DEAD** | Returns static stub string |

**Decision: REMOVE ALL. `auto-agent/execute` bypasses the runtime governor (emergency stop, queue limits, receipts). Using the `/runtime/dispatch` path is the safe equivalent.**

---

### In-Memory Workflows (3 routes, DEAD + DANGER)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| POST | `/workflow/create` | **DEAD** | Creates in-memory workflow (lost on restart) |
| POST | `/workflow/execute` | **DANGER** | Executes multi-step `executeCommand()` calls in a loop — bypasses governor |
| GET | `/workflow/list` | **DEAD** | Lists in-memory workflows (always empty on restart) |

**Decision: REMOVE. In-memory workflows are lost on restart (not useful). Execution bypasses governor.**

---

### Prediction / SaaS / Misc (4 routes, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| POST | `/predict/next-commands` | **DEAD** | Returns `commandHistory.getSuggestions()` — evolution artifact |
| POST | `/start-automation` | **DEAD** | Returns hardcoded stub string |
| GET | `/bulk` | **DANGER** | Triggers WhatsApp bulk send to all leads with hardcoded message |
| `/saas/*` | `/saas/dashboard`, `/saas/leads` | **DEAD** | 2-route stub, no frontend reference |

**Decision: REMOVE ALL.**  
`/bulk` is especially dangerous — unconditionally blasts all CRM leads with a hardcoded promotional message. No rate limit, no confirmation, no dry-run.

---

### Google Maps Leads (1 route, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| GET | `/leads` | **DEAD** | `getMapsLeads` from `leadsMod` — not loaded; Google Maps API key not configured |

**Decision: REMOVE.**

---

### Parse-Command (1 route, DEAD)

| Method | Path | Category | Notes |
|--------|------|----------|-------|
| POST | `/parse-command` | **DEAD** | `commandParserMod` not loaded — always 503 |

**Decision: REMOVE.**

---

## SUMMARY TABLE

| Category | Count | Action |
|----------|-------|--------|
| ACTIVE | 1 | Keep → `tasks.js` |
| PARTIAL (keep) | 4 | Keep → `tasks.js` |
| COMPAT (duplicate) | 4 | Remove |
| GONE (410 stubs) | 8 | Remove stubs |
| DEAD | 29 | Remove |
| DANGER | 10 | Remove |
| **TOTAL** | **56** | **5 kept, 51 removed** |

---

## REMOVED MODULE-LEVEL CODE

| Object/Variable | Purpose | Action |
|-----------------|---------|--------|
| `commandHistory` | Evolution-era command analytics | Remove |
| `masterAgentMgr` + `initMasterAgentMgr()` | 500-agent system state | Remove |
| `workflows` | In-memory workflow store | Remove |
| `orchestratorMod` require + destructure | voice/desktop/agents/learning/context | Remove |
| `schedulerMod` require + destructure | Legacy scheduler | Remove |
| `commandParserMod` require + destructure | parse-command, auto-agent, workflow | Remove |
| `leadsMod` require | Google Maps leads | Remove |
| `bulkSenderMod` require | `/bulk` | Remove |
| `followUpSeqMod` require | Unused (no route used it) | Remove |
| `saasRoutes` require | `/saas` | Remove |
| `_getMC()` helper | agents/perf + queue/status | Keep if `/queue/status` kept |

---

## POST-CLEANUP RESULT

`legacy.js` → **deleted**  
Active routes extracted to `backend/routes/tasks.js` (~60 lines)  
`routes/index.js` and `server.js` updated to remove legacy mount.
