# OS-DEVELOPER — DISCOVERY REPORT

**Track:** OOPLIX V1 — Developer / Engineering OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any build. **Nothing was rebuilt from zero.**
**Isolation:** Verification server on **port 5088** (dedicated), leaving :5050 to other sessions.

---

## 1. Method

Swept `frontend/src`, `backend/routes`, `backend/services`, `agents/`, `electron/`, `tests/`,
`scripts/`, `deploy*`, and `data/` for every Developer/Engineering artifact. Routes were read
from source rather than guessed — several initially-probed paths (`/coding/context`,
`/agents/status`, `/mission/runtime/list`) returned 404 because **the guessed path was wrong**,
not because the capability was missing. Actual paths were then read from the route files.

---

## 2. Backend Inventory — Routes

| Route file | Endpoints | Mount | Purpose |
|---|---:|---|---|
| `runtime.js` | **1,212** | `/runtime/*` + many | Runtime monolith — dispatch, queue, status, history |
| `codingAssistant.js` | 22 | `/coding/*` | ask, explain, review, refactor, smells |
| `engineering.js` | 27 | `/engineering/*` | Engineering intelligence (J4) |
| `mission.js` | 26 | `/mission/*`, `/missions/orchestrator/*` | Mission runtime + orchestrator + mission-git |
| `deployment.js` | 22 | `/deployment/*` | Targets, run, active, benchmark (Phase I8) |
| `agentsRuntime.js` | 15 | `/agents/runtime/*` | Long-running agent supervisor (I4) |
| `engineeringMemory.js` | 13 | `/memory/*` | Engineering memory (ACP-10) |
| `productionDeployment.js` | 12 | `/pm7/*` | Live deployment tracking |
| `codingDecisions.js` | 10 | `/coding/decisions/*` | ACP-4 decisions |
| `workspace.js` | 10 | `/workspace/*` | Workspace CRUD, invite, switch |
| `autonomousAgent.js` | 9 | `/autonomous/*` | ACP-8 |
| `agents.js` | 7 | `/agents/*` | Conversation, delegation, override |
| `codingBundle.js` | 6 | `/coding/bundle/*` | ACP-6 |

All confirmed registered in `backend/routes/index.js` (lines 40, 64, 66, 67, 72, 88, 94, 99–107, 215).

## 3. Frontend Inventory — 20 Developer surfaces

**Wired (19):** AgentActionCenter, AgentCollaborationCenter, AgentFactoryCenter, AgentOSV2,
AgentRegistryCenter, AutonomousAgentDashboard, AutonomousAgentPanel, CodeEditorPane,
DevOpsCenterV2, EngineeringCenter, EngineeringConsole, EngineeringIntelligencePane,
EngineeringMemoryPanel, EngineeringWorkspace, ExecutionRuntimePanel, GitBlame, MissionControlV1,
MissionDock, ElectronWorkspace.

**Orphaned (1):** `AgentCenter.jsx` — defines and exports the component, referenced nowhere.

## 4. Git / Repository Integration — architectural finding

Git is **not** an HTTP capability. `VisualGit.jsx` calls `window.electronAPI` and explicitly
returns empty data outside Electron (`isElectron()` guard, line 186). The real implementation is
**Electron IPC** in `electron/main.cjs`: `git-status`, `git-diff`, `git-log`, `git-branches`,
`git-checkout`, `git-commit`, plus `shell-exec` — exposed through `electron/preload.cjs`.

Verified by executing the `git-status` handler's own logic read-only: it returned the real branch
(`security/reality-completion...[ahead 416]`) and 33 changed files. `git-diff` passes the filename
as a separate argv element specifically to avoid shell injection.

**Consequence:** Git/repository management is genuinely implemented but **unavailable in the
browser build** — an environment boundary, not a gap.

## 5. Persistence Inventory

| File | Contents |
|---|---|
| `data/orchestrator-state.json` | Mission orchestrator records (**data-loss defect found — D-3**) |
| `data/mission-memory.json` | 2,119 missions |
| `data/engineering-memory*` | 2,000 lessons, 2,440 failures analysed, 5 RCAs, 5 rules |
| `data/queue.json` | Autonomous task queue |
| `data/deployments*` | Deployment records |

## 6. AI Engineering — credential state

`/coding/ask` returns `AI backend unavailable. Check provider API keys in your .env file.`
Provider chain attempts **4 providers** then reports honestly — no fabricated output.

| Provider | State |
|---|---|
| GROQ | SET — **429** (quota exhausted) |
| OPENAI | SET — **401** (invalid/rotated) |
| OLLAMA | not running (404) |
| LM STUDIO | not installed |
| ANTHROPIC / GEMINI | MISSING |

**Classification: CREDENTIAL BLOCKED.** `.env` was not modified and no secret was printed.

## 7. Key Discovery Findings

1. **Developer OS substantially exists** — ~1,400 endpoints, 19 wired UI surfaces, 2,119 real
   missions, 2,000 engineering lessons. Nothing needed rebuilding.
2. **D-1 (fake success):** missions reported `completed` when **every stage failed** — the
   autonomous loop ignored the `success:false` executors already return.
3. **D-2 (false metric):** `todo_fixme` detector counted prose and `status:"todo"` data values —
   reported 15 markers in a file with 1.
4. **D-3 (data loss):** the orchestrator erased every completed/failed mission on the first save
   after restart.
5. **D-4 (artifact integrity):** an exported `REACT_APP_API_URL` **could** silently poison the
   production bundle — proven, 44 files.
6. **D-5 (security):** mission records carry **no tenant field**, so any authenticated user can
   enumerate all engineering missions.
7. Git is Electron-only (§4). AI is credential-blocked (§6). `AgentCenter.jsx` is orphaned.

---

**Outcome:** Developer OS is a recovery/verification target, not a build target.
Proceeded to VERIFY → RECOVER (4 fixes) → TEST → CERTIFY.
