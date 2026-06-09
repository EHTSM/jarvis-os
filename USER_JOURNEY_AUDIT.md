# USER JOURNEY AUDIT
Date: 2026-06-06 | Auditor: Acting as real user (Playwright + live API calls)
Method: Launched backend (localhost:5050) + frontend dev server (localhost:3000), registered a fresh user account, navigated every screen, exercised every workflow end-to-end.

---

## AUDIT METHODOLOGY

**User persona:** New user. Registered `audit@test.com` via `/accounts/register`. Auth via session cookie. No prior knowledge of route paths or internal structure.

**Test surfaces:**
1. UI navigation — can a user find and reach the screen?
2. UI completeness — does the screen have actionable controls?
3. API — does the backend call succeed and return real data?
4. End-to-end — does the full workflow complete from user input to backend result?

**Auth finding:** App requires `jarvis_started` and `jarvis_biz_profile` in localStorage to skip Landing page. A fresh user lands on Landing → Onboarding → Login. Auth uses httpOnly session cookie. All phase endpoints (`/p18`–`/p25`) require `requireAuth` middleware and work once authenticated.

---

## NAVIGATION STRUCTURE

The app has a single-page shell with a top tab bar:
- **Direct tabs (5):** Control Center, Execution, Intelligence, Pipeline, Contacts
- **More ▾ dropdown (48 items):** All phase engine screens — Agents, Memory, Tool Fabric, Self-Healing, Engineering, DevOps, Collaboration, etc.

**Navigation verdict:** All 48 screens are reachable via More → [label]. No screen is hidden or behind a deep URL. Discoverability is **low** (48 items in a flat dropdown is not organized by workflow) but technical reachability is **complete**.

---

## WORKFLOW AUDITS

---

### WF1 — Create Agent
**Result: PARTIAL PASS**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Agent Factory" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — 8 template gallery cards + "Create Agent" button + form modal (name, template, model, description) |
| API complete? | Yes — `POST /p20/agents` works, returns full agent object |
| End-to-end functional? | **Yes** — form submits, agent persisted in backend |
| Production ready? | Partial — created agent shows in list; but toggle (active/retire) is UI-only (no `PATCH /p20/agents/:id`) |

**Screens:** Agent Factory (`AgentFactoryCenter`)
**Blockers:** None for create. Training form (`submit training`) fires `track()` only — no API call.

---

### WF2 — Execute Agent
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Agents" (Agent OS screen) |
| Reachable from navigation? | Yes |
| UI complete? | **No** — AgentCenter shows agent cards with Activate/Pause/Resume toggles only. No "Execute with input" text field. No way to submit a task to an agent. |
| API complete? | Partial — `POST /p18/agents/:id/execute` endpoint exists and returns 200, but `{success:false, output:"unknown"}` because `GROQ_API_KEY` is not configured. |
| End-to-end functional? | **No** — two failures: (1) no UI input form, (2) backend AI provider unconfigured |
| Production ready? | No |

**Screens:** Agent OS (`AgentCenter`)
**Blockers:**
- **BLOCKER 1:** No task input form on any agent screen. User cannot provide a prompt to an agent.
- **BLOCKER 2:** `GROQ_API_KEY` missing → all executions return `success:false, output:"unknown"`. Would need valid LLM key.

---

### WF3 — Review Execution History
**Result: PARTIAL PASS**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Agent Actions" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — 5 tabs: Executed, Pending, Failed, Human Approvals, Autonomous |
| API complete? | Partial — `GET /p18/actions?status=completed` returns 50 entries (legacy stress-test data from May 2026). `GET /p18/agents/:id/history` returns empty (0 real runs). |
| End-to-end functional? | Partial — legacy action data shows in Executed tab. Real-time history is empty because WF2 never succeeds. |
| Production ready? | No — depends on WF2 being functional first |

**Screens:** Agent Action Center (`AgentActionCenter`)
**Blockers:** History is only meaningful once agent execution works (WF2 BLOCKER resolved).

---

### WF4 — Store Memory
**Result: FAIL (critical body mismatch)**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Memory" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — "Add memory" button, form with type/importance/title/body/tags fields |
| API complete? | **No** — backend `POST /p18/memory` requires `{key, value}`. Frontend sends `{type, title, body, importance, tags}`. Returns HTTP 400 `{"error":"key required"}`. |
| End-to-end functional? | **No** — form saves to localStorage only. Backend memory is never written from any UI. |
| Production ready? | No |

**Screens:** Memory OS (`MemoryCenter`)
**Blockers:**
- **BLOCKER (critical):** `saveMemoryNode()` in `MemoryCenter.jsx` calls `POST /p18/memory` with `{title, body, type, tags, importance}`. Backend route at `phase18.js:133` extracts `req.body.key` and `req.body.value` and returns 400 if `key` is missing. The fix requires either: (a) changing the frontend to send `{key: title, value: body, ...}`, or (b) updating the backend to accept `{title, body}`.

---

### WF5 — Retrieve Memory
**Result: FAIL (consequence of WF4)**

| Check | Result |
|---|---|
| Discoverable? | Yes — same Memory OS screen |
| Reachable from navigation? | Yes |
| UI complete? | Yes — search input, type filters (User/Company/Project/Workflow/Agent), importance filters |
| API complete? | Partial — `GET /p18/memory?limit=100` returns `{nodes:[],total:0}` (empty because WF4 never writes). `GET /p18/memory/search?q=` works when nodes exist. |
| End-to-end functional? | **No** — always shows seed data from localStorage, never backend data |
| Production ready? | No |

**Screens:** Memory OS (`MemoryCenter`)
**Blockers:** Directly caused by WF4 body mismatch. Fix WF4 and WF5 becomes functional.

---

### WF6 — Launch Workflow (Autonomous Cycle)
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Autonomous Co" (Autonomous Workflow Center) |
| Reachable from navigation? | Yes |
| UI complete? | **No** — "New Workflow" button calls `track("awc_new_workflow")` only. No modal, no goal input, no way to POST a new cycle. Cycle list loads from backend (50 cycles shown, all `status:"failed"`). |
| API complete? | Partial — `POST /p18/cycles` works structurally but all cycles fail immediately (`_learning.push is not a function` bug). |
| End-to-end functional? | **No** — two failures: (1) no UI form to enter a goal, (2) backend cycle tasks crash |
| Production ready? | No |

**Screens:** Autonomous Workflow Center (`AutonomousWorkflowCenter`)
**Blockers:**
- **BLOCKER 1 (UI):** "New Workflow" button has no action. Needs: click → modal with goal/goalType input → POST /p18/cycles.
- **BLOCKER 2 (backend):** `data/learning-patterns.json` is `{patterns,history,meta}` object but `autonomousTaskLoop.cjs` calls `_learning.push()` expecting an array. Every cycle task fails. Fix: initialize `_learning` from `data.history` array (not the root object).

---

### WF7 — Run Tool
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Tool Fabric" |
| Reachable from navigation? | Yes |
| UI complete? | **No** — tool list with health, Connect/Disconnect buttons. No "Execute tool with input" form. |
| API complete? | Partial — `GET /p19/tools` returns 8 tools. All show `configured:false`. `POST /p19/tools/:id/execute` returns `not_configured: GITHUB_TOKEN not set` for all tools. |
| End-to-end functional? | **No** — two failures: (1) no execution form in UI, (2) all tools unconfigured |
| Production ready? | No |

**Screens:** Tool Fabric Center (`ToolFabricCenter`)
**Blockers:**
- **BLOCKER 1 (UI):** No form to execute a tool with user-provided input. Connect button only changes local state.
- **BLOCKER 2 (config):** No external API tokens set (GitHub, Gmail, Slack, Notion, Google Drive). All tools return `not_configured`.

---

### WF8 — Trigger Self-Healing
**Result: PASS (with caveat)**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Self-Healing" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — 5 tabs: Health Checks, Recovery Actions, Prevention Rules, Incident Timeline, Failure Prediction. "Probe" button on UI wired to `POST /p19/heal/probe`. |
| API complete? | Yes — `GET /p19/heal/status` returns `{probeCount:102, healedTotal:3, failedTotal:99}`. History populated. |
| End-to-end functional? | **Yes** — probe button calls real API. Health check list shows real state. Recovery history loads. |
| Production ready? | Partial — 99% heal failures reflect the WF6 cycle bug (every cycle task triggers a heal attempt that also fails). Self-healing machinery works; it's being overwhelmed by upstream failures. |

**Screens:** Self-Healing Platform (`SelfHealingCenter`)
**Blockers:** None structural. Rule toggles are UI-only (no `/p19/heal/rules` write endpoint).

---

### WF9 — Run Engineering Autopilot Mission
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Engineering" |
| Reachable from navigation? | Yes |
| UI complete? | **No** — board shows task cards with stage pipeline. "New task" creates a local task object (no API call). No form to enter a goal+repo and trigger `POST /p23/autopilot/missions`. |
| API complete? | Partial — backend endpoint is `POST /p23/autopilot/missions` (plural). Frontend `phase23Api.js` calls `POST /p23/autopilot/mission` (singular) → HTTP 404. When called correctly: mission runs in ~93ms, returns full step chain. |
| End-to-end functional? | **No** — two failures: (1) no UI trigger, (2) wrong URL in frontend API client |
| Production ready? | No |

**Screens:** Engineering Center (`EngineeringCenter`)
**Blockers:**
- **BLOCKER 1 (UI):** No mission launcher form. "New task" = local storage only.
- **BLOCKER 2 (API URL):** `phase23Api.js:listMissions` and `runMission` call `/p23/autopilot/mission` (singular). Backend route is `/p23/autopilot/missions` (plural). Fix: add `s` to both function URLs.

---

### WF10 — Analyze Repository
**Result: FAIL (server crash)**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Copilot" |
| Reachable from navigation? | Yes |
| UI complete? | Partial — repo list shown (20 repos from prior stress tests). Index/analyze capability present but not surfaced with obvious button. |
| API complete? | **No** — `POST /p24/repo/index` crashes the Node process (OOM). Server auto-restarts in ~3s. Also: frontend sends `repoPath` param; backend requires `workspacePath`. |
| End-to-end functional? | **No** — crashes server |
| Production ready? | No |

**Screens:** Developer Copilot Center (`DeveloperCopilotCenter`)
**Blockers:**
- **BLOCKER (critical/crash):** `indexRepo()` in `repoIntelligenceEngine.cjs` uses synchronous spread on symbol arrays: `allSymbols.push(...fileSymbols)` per file. For large repos this OOM-kills Node before saving. Fix: stream results or batch-process with `splice`/`concat` instead of spread, or use async iteration.
- **SECONDARY:** Frontend param name mismatch (`repoPath` vs `workspacePath`).

---

### WF11 — Run Code Review
**Result: PARTIAL PASS**

| Check | Result |
|---|---|
| Discoverable? | Yes — Developer Copilot screen has a "Reviewer" section |
| Reachable from navigation? | Yes (via Copilot) |
| UI complete? | Partial — review list visible. No "submit code for review" input form. |
| API complete? | Yes — `POST /p23/review/code` with `{code, language}` → HTTP 200, `{score:100, grade:"A", findings:[], durationMs:5}`. `GET /p23/review` returns review list. |
| End-to-end functional? | **No** — backend works perfectly but there is no UI to paste code and trigger a review |
| Production ready? | No |

**Screens:** Developer Copilot Center (`DeveloperCopilotCenter`)
**Blockers:** No code input textarea + "Review" submit button in UI.

---

### WF12 — Generate Refactor Plan
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Partial — Developer Copilot has a refactor section |
| Reachable from navigation? | Yes (via Copilot) |
| UI complete? | Partial — refactor plan list shown. No detect/scan controls. |
| API complete? | **No** — Frontend calls `POST /p24/refactor/detect/duplication` → HTTP 404. Backend route is `POST /p24/refactor/detect/dup`. `GET /p24/refactor/plans` works and returns existing plans. |
| End-to-end functional? | **No** — detection trigger is broken |
| Production ready? | No |

**Screens:** Developer Copilot Center (`DeveloperCopilotCenter`)
**Blockers:**
- **API URL mismatch:** `phase24Api.js` → `/p24/refactor/detect/duplication`. Backend → `/p24/refactor/detect/dup`. Fix: change frontend to `/detect/dup`.
- **UI gap:** No "Detect duplications" / "Scan for smells" buttons.

---

### WF13 — View Observability Metrics
**Result: PASS**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "DevOps" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — Deployments, Services, Infrastructure, Incidents, SLOs, Alerts tabs all present |
| API complete? | Partial — `GET /p25/obs/metrics` returns real metrics. SLO tab: 1 active SLO (`API Availability`, 100% / target 99.9%). Service map: empty (no services registered to obs engine). |
| End-to-end functional? | **Yes** — deployments list loads from backend. SLO tab shows live data. |
| Production ready? | Partial — `GET /p25/obs/service-map` returns empty (frontend calls `/service-map`, backend is `/servicemap`). |

**Screens:** DevOps Runtime (`DevOpsCenter`)
**Blockers:** `/p25/obs/service-map` URL mismatch (hyphen vs no-hyphen). Minor.

---

### WF14 — View Alerts
**Result: PASS (correct empty state)**

| Check | Result |
|---|---|
| Discoverable? | Yes — DevOps screen → "Alerts" tab |
| Reachable from navigation? | Yes |
| UI complete? | Yes — Alerts tab present, shows "No active alerts" empty state with green checkmark |
| API complete? | Partial — `GET /p25/obs/alerts` returns `{alerts:[]}` (correct — no active alerts). Alert rules route: frontend calls `/p25/obs/alert-rules` → 404; backend is `/p25/obs/alerts/rules`. |
| End-to-end functional? | **Yes** — correct empty state shown. Resolve button present on any future alert. |
| Production ready? | Partial |

**Screens:** DevOps Runtime (`DevOpsCenter`) → Alerts tab
**Blockers:** `/p25/obs/alert-rules` URL mismatch. Alert rules list never loads.

---

### WF15 — View Deployment Readiness
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Operations" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — Operations Center shows throughput, queue depth, agent metrics. Readiness score banner added in Phase 32. |
| API complete? | **No** — Frontend calls `GET /p21/readiness` → HTTP 404. Backend endpoint is `GET /p21/readiness/report` (with `/report` suffix). Actual score: 89/100, grade "NEARLY_READY". |
| End-to-end functional? | **No** — readiness banner never shows despite backend having valid data |
| Production ready? | No |

**Screens:** Operations Center (`OperationsCenter`)
**Blockers:**
- **API URL mismatch:** `phase21Api.js` calls `GET /p21/readiness`. Backend route is `GET /p21/readiness/report`. Fix: change `getReadinessReport()` to `_fetch("/p21/readiness/report")`.

---

### WF16 — Create Deployment
**Result: FAIL**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "DevOps" → Deployments tab |
| Reachable from navigation? | Yes |
| UI complete? | **No** — read-only deployment list. No "Trigger deployment", "Start canary", or "Run pipeline" button anywhere in the UI. |
| API complete? | Partial — `POST /p25/deploy/canary` works: returns `{deployId, type:"canary", status:"running", trafficPct:5}`. Blue-green: frontend calls `/p25/deploy/blue-green` → 404 (backend is `/p25/deploy/bluegreen`). |
| End-to-end functional? | **No** — no UI trigger for any deployment action |
| Production ready? | No |

**Screens:** DevOps Runtime (`DevOpsCenter`) → Deployments tab
**Blockers:**
- **BLOCKER:** No deployment creation controls in UI. Backend `POST /p25/deploy/canary` is working but unreachable from any UI.
- **SECONDARY:** `/p25/deploy/blue-green` URL mismatch (hyphen vs no-hyphen in `bluegreen`).

---

### WF17 — View Multi-Agent Coordination
**Result: PARTIAL PASS**

| Check | Result |
|---|---|
| Discoverable? | Yes — More → "Collaboration" |
| Reachable from navigation? | Yes |
| UI complete? | Yes — 3 tabs: Collaboration Graph (canvas), Event Feed (handoff list), Shared Tasks. Summary strip shows event type counts. |
| API complete? | Yes — `GET /p19/coord/sessions` → `{sessions:[],total:0}` (empty — no coordination sessions have been started). `GET /p19/coord/sessions/stats` → all-zero stats. |
| End-to-end functional? | **Partial** — UI renders with seed handoff data. Live sessions: 0. No "Start coordination session" button. |
| Production ready? | No |

**Screens:** Agent Collaboration Engine (`AgentCollaborationCenter`)
**Blockers:** No UI to initiate a coordination session (POST /p19/coord/handoff, /coord/delegate, /coord/collaborate). Seed data makes it look functional but all coordination data is static.

---

## SUMMARY SCORECARD

| # | Workflow | Result | UI Gap | API Gap | Backend Bug |
|---|---|---|---|---|---|
| 1 | Create Agent | **PARTIAL PASS** | Training form fires track() only | None | None |
| 2 | Execute Agent | **FAIL** | No task input form | None | GROQ_API_KEY missing |
| 3 | Review Execution History | **PARTIAL PASS** | None | Legacy data only | None |
| 4 | Store Memory | **FAIL** | — | Body mismatch (title/body vs key/value) | None |
| 5 | Retrieve Memory | **FAIL** | — | Empty (caused by WF4) | None |
| 6 | Launch Workflow | **FAIL** | "New Workflow" has no action | None | learning-patterns.json schema bug |
| 7 | Run Tool | **FAIL** | No execute form | None | All tools unconfigured |
| 8 | Trigger Self-Healing | **PASS** | None | None | None (overwhelmed by cycle failures) |
| 9 | Engineering Autopilot | **FAIL** | No mission launcher | `/mission` vs `/missions` (plural) | None |
| 10 | Analyze Repository | **FAIL** | None | repoPath vs workspacePath | OOM crash in indexRepo |
| 11 | Code Review | **PARTIAL PASS** | No code input form | None | None |
| 12 | Generate Refactor Plan | **FAIL** | No detect controls | `/detect/duplication` vs `/detect/dup` | None |
| 13 | View Observability Metrics | **PASS** | None | `/service-map` vs `/servicemap` | None |
| 14 | View Alerts | **PASS** | None | `/alert-rules` vs `/alerts/rules` | None |
| 15 | View Deployment Readiness | **FAIL** | None | `/p21/readiness` vs `/p21/readiness/report` | None |
| 16 | Create Deployment | **FAIL** | No create button | `/blue-green` vs `/bluegreen` | None |
| 17 | Multi-Agent Coordination | **PARTIAL PASS** | No session start button | None | None |

**Pass: 2/17 (12%) | Partial Pass: 4/17 (24%) | Fail: 11/17 (65%)**

---

## CRITICAL BUGS (blocking multiple workflows)

### BUG-1: POST /p18/memory body mismatch [blocks WF4, WF5]
- **Where:** `frontend/src/phase18Api.js` → `saveMemoryNode()` / `MemoryCenter.jsx`
- **Problem:** Frontend sends `{title, body, type, tags, importance}`. Backend requires `{key, value}`.
- **Fix:** In `saveMemoryNode(data)`, transform: `_fetch("/p18/memory", { method:"POST", body: JSON.stringify({ key: data.title, value: data.body, type: data.type, tags: data.tags, importance: data.importance }) })`

### BUG-2: learning-patterns.json schema mismatch [blocks WF6, WF8 indirectly]
- **Where:** `backend/data/learning-patterns.json` and `autonomousTaskLoop.cjs`
- **Problem:** JSON file is `{patterns:{}, history:[], meta:{}}`. Code calls `_learning.push(...)` expecting `_learning` to be the root array. Result: every cycle task fails with `TypeError: _learning.push is not a function`.
- **Fix:** In `autonomousTaskLoop.cjs`, change `const _learning = JSON.parse(...)` to `const _raw = JSON.parse(...); const _learning = _raw.history || _raw;`

### BUG-3: POST /p24/repo/index OOM crash [blocks WF10]
- **Where:** `backend/services/repoIntelligenceEngine.cjs` → `indexRepo()`
- **Problem:** `allSymbols.push(...fileSymbols)` on large repos causes V8 call-stack overflow / OOM. Server crashes, auto-restarts.
- **Fix:** Replace spread-push with `for (const s of fileSymbols) allSymbols.push(s)` or `allSymbols = allSymbols.concat(fileSymbols)`.

### BUG-4: GROQ_API_KEY not configured [blocks WF2]
- **Where:** `.env` file
- **Problem:** `LLM_PROVIDER=groq` but no `GROQ_API_KEY` set. All agent executions return `success:false, output:"unknown"`.
- **Fix:** Add valid `GROQ_API_KEY=...` to `.env`, or change `LLM_PROVIDER=anthropic` and set `ANTHROPIC_API_KEY`.

---

## URL MISMATCHES (5 frontend-to-backend route errors)

| Frontend calls | Backend expects | Fix location | Workflows affected |
|---|---|---|---|
| `POST /p23/autopilot/mission` | `POST /p23/autopilot/missions` | `phase23Api.js:listMissions + runMission` | WF9 |
| `GET /p21/readiness` | `GET /p21/readiness/report` | `phase21Api.js:getReadinessReport()` | WF15 |
| `GET /p25/obs/service-map` | `GET /p25/obs/servicemap` | `phase25Api.js:getServiceMap()` | WF13 |
| `GET /p25/obs/alert-rules` | `GET /p25/obs/alerts/rules` | `phase25Api.js:listAlertRules()` | WF14 |
| `POST /p24/refactor/detect/duplication` | `POST /p24/refactor/detect/dup` | `phase24Api.js:detectDuplication()` | WF12 |
| `POST /p25/deploy/blue-green` | `POST /p25/deploy/bluegreen` | `phase25Api.js:startBlueGreen()` | WF16 |

All 6 fixes are single-line URL string changes in the respective `phase*Api.js` files.

---

## UI GAPS (missing interaction controls)

| Workflow | Missing UI | Needed endpoint |
|---|---|---|
| WF2 Execute Agent | Task input textarea + "Execute" button on AgentCenter | `POST /p18/agents/:id/execute` |
| WF6 Launch Workflow | Goal + goalType form + "Start cycle" on AutonomousWorkflowCenter | `POST /p18/cycles` |
| WF7 Run Tool | "Execute tool" input + action selector on ToolFabricCenter | `POST /p19/tools/:id/execute` |
| WF9 Engineering Mission | Goal + repo input + "Launch mission" on EngineeringCenter | `POST /p23/autopilot/missions` |
| WF11 Code Review | Code paste textarea + "Review" on DeveloperCopilotCenter | `POST /p23/review/code` |
| WF12 Refactor Plan | "Detect" / "Scan" buttons on DeveloperCopilotCenter | `POST /p24/refactor/detect/dup` |
| WF16 Create Deployment | "Deploy Canary" / "Run pipeline" on DevOpsCenter | `POST /p25/deploy/canary` |
| WF17 Start Coordination | "Handoff" / "Delegate" / "Collaborate" forms | `POST /p19/coord/handoff` |

---

## WHAT A NEW USER CAN ACTUALLY DO TODAY

A user who registers, logs in, and browses the app can:

| ✓ Works | What they see |
|---|---|
| Create an agent | Via Agent Factory — template gallery, form, backend persistence |
| View self-healing status | Health checks, recovery history, probe button — fully functional |
| Browse observability | Deployment list, SLO status, alerts empty state — live data |
| Browse memory (read) | Seed data in localStorage — visible but not from backend |
| Browse agent collaboration | Handoff feed, graph — seed data, looks real |
| View engineering board | Task cards with stage pipeline — local data |
| Access all 56 screens | via More dropdown |

| ✗ Blocked | Why |
|---|---|
| Execute an agent | No UI form + GROQ key missing |
| Store memory to backend | Body mismatch bug |
| Launch an autonomous workflow | No UI form + backend crash |
| Run a tool | No UI form + tools unconfigured |
| Trigger engineering mission | No UI form + wrong API URL |
| Index a repository | Server OOM crash |
| View deployment readiness score | Wrong API URL |
| Create a deployment | No UI button |

---

## VERDICT

**A new user cannot successfully use any of the 10 engineering capability workflows without encountering either a missing UI control, a broken API URL, or a backend crash.** The infrastructure is complete and the screens are all reachable, but the interaction layer between user intent and backend execution has 8 missing forms and 6 broken URL mappings that collectively block all primary workflows.

**Priority fix order:**
1. Fix `learning-patterns.json` schema bug (unblocks WF6, stops cascade failures)
2. Fix memory body mismatch (unblocks WF4/WF5)
3. Fix 6 URL mismatches in `phase*Api.js` (unblocks WF9/WF12/WF13/WF14/WF15/WF16)
4. Fix OOM crash in `indexRepo()` (unblocks WF10)
5. Add 8 missing interaction forms (unblocks WF2/WF6/WF7/WF9/WF11/WF12/WF16/WF17)
6. Configure `GROQ_API_KEY` or switch LLM provider (unblocks WF2)
