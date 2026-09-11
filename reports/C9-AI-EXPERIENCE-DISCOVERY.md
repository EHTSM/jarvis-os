# C.9 — AI EXPERIENCE DISCOVERY

Date: 2026-08-14/15 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Capability Matrix](C9-AI-EXPERIENCE-CAPABILITY-MATRIX.md) · [Workflow Evidence](C9-AI-EXPERIENCE-WORKFLOW-EVIDENCE.md) · [Security](C9-AI-EXPERIENCE-SECURITY.md) · [Final](C9-AI-EXPERIENCE-FINAL.md)

---

## Baseline

```
git status            : clean start, no C.9 files touched yet
branch                 : security/reality-completion
npm run test:runtime   : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0 (pre-C.9)
.env changes           : 0 (throughout — verified repeatedly)
```

## Track lock compliance

No OS was started or modified. All work is confined to the AI experience boundary: AI routes (`/ai/*`, `/jarvis`, `/ai-ecosystem/*`, `/coding/*`), AI services (`aiService.js`, `aiOrchestrator.cjs`, `promptHistory.cjs`, `connectorToolBridge.cjs`), AI frontend surfaces (`Chat.jsx`, `App.jsx`'s `handleSend`, `AICostCenter.jsx`, `AIUsageDashboard.jsx`), and one shared cross-cutting middleware bug (see below) that was directly blocking AI-route testing and needed a source-level fix to proceed honestly.

---

## 1 · AI Surface Inventory

Full surface map, traced UI → route → service → provider → model → memory → persistence → auth → org scope:

| Surface | Route(s) | Service | Auth | Org-scoped? |
|---|---|---|---|---|
| Main "AI Chat" tab (App.jsx `handleSend`) | `POST /jarvis` | `jarvisController.js` → `aiOrchestrator.execute()` / `ai.callAI()` fallback | `requireAuth` | **Was not** (fixed — see §4) |
| Direct AI chat API | `POST /ai/chat` | `aiService.callAI()` | `requireAuth` + `attachOrg` (B.14 fix) | Yes |
| AI chat with tools | `POST /ai/chat-with-tools` | `aiService.chatWithTools()` + `connectorToolBridge.cjs` | `requireAuth` + `attachOrg` | Yes |
| AI provider/status | `GET /ai/status` | `aiService.getAIStatus()` | `requireAuth` | N/A (global provider health) |
| Repo-aware coding assistant | `POST /coding/ask`, `/action`, `/explain-file`, etc. | `codingAssistant.js` → `aiService.callAI()` | `requireAuth` only | **No** (documented gap, §6) |
| AI patch generation/history | `/coding/generate-patch`, `/coding/patch-history*`, `/coding/bundle/*` | `repositoryEditingEngine.cjs`, flat JSON store | `requireAuth` only | **No** (documented gap, §6) |
| Orchestrated chat (capability router) | `POST /ai-ecosystem/orchestrator/execute` | `aiOrchestrator.execute()` | `requireAuth` + `billing.requireUsageQuota` | Yes, via caller-supplied `orgId`/`workspaceId` |
| Orchestrated streaming chat | `POST /ai-ecosystem/orchestrator/execute/stream` | `aiOrchestrator.executeStream()` → SSE | `requireAuth` | Yes (same params) — **zero frontend consumers** |
| AI prompt history (self) | `GET /ai-ecosystem/history/me` | `promptHistory.query({accountId})` | `requireAuth` | Yes, self-scoped |
| AI prompt history (org/workspace) | `GET /ai-ecosystem/history/workspace/:workspaceId` | `promptHistory.query({workspaceId})` | `requireAuth` + `attachOrg` + `requireOrgPermission("manage_billing")` | Yes (Phase A.1 fix, verified still real) |
| AI cost/usage dashboard | `AIUsageDashboard.jsx` | `/ai-ecosystem/analytics/*`, `/ai-ecosystem/budgets/*` | Real, live-fetch driven | Yes |
| AI cost center | `AICostCenter.jsx` | **Was fully fabricated** (fixed — see §5) | `requireAuth` | Now yes, via new `/analytics/ai-cost` |
| Founder/business assistant | `/assistant/*`, `_salesPipeline`, `_executionPipeline` in `jarvisController.js` | Real CRM/payment/WhatsApp service calls | `requireAuth` | Via CRM's own scoping |
| Chat UI "streaming" indicator | `Chat.jsx` `.chat-stream-indicator`, `.msg--streaming` | CSS-only loading animation | N/A | N/A — not real streaming (§3) |
| AI-Memory integration | `codingAssistant.js` `_missionContext()` | `missionMemory.cjs` `listMissions()` | inherits `/coding/*` auth | **No** (documented gap, §6) |

**23 distinct AI-adjacent capabilities discovered and traced.** No abandoned prototypes were counted as production — `/ai-ecosystem/orchestrator/execute/stream` is real, working, honest code but has zero frontend callers, so it is classified separately from the production chat path, not folded into it.

---

## 2 · AI Honesty — the critical dimension

**Result: sound at every route tested, with two prior fixes already in place and two new ones added this session.**

- `POST /ai/chat`: documented prior "A.10" fix — detects the `"AI backend unavailable"` sentinel and converts what would be a fake `{success:true}` into an honest `502`. Reproduced live: real 502 with a real, specific error message under genuine credential-blocked conditions.
- `chatWithTools()`: **throws** (not a fake-success sentinel) on total provider failure — confirmed by direct source read and live 500 reproduction.
- `_intelligencePipeline()` (the `/jarvis` main-chat path): documented prior "Phase B.9" fix for the exact same sentinel-as-success pattern. Correctly throws on failure, correctly records `success: !failed` in usage metering — never double-counts or silently marks a failure as billed success.
- `POST /ai-ecosystem/orchestrator/execute`: genuine try/catch, real per-provider error list surfaced (`"ollama (...); groq (...); openai (...)"`), no fabricated success.
- SSE stream (`/execute/stream`): correctly returns HTTP 200 (standard for SSE) while signaling real errors via a genuine `event: error` frame with a real error message — never converts an incomplete/failed stream into a fake `event: done`.
- Live browser reproduction (Playwright, real authenticated session): submitting a chat message under genuine credential-blocked conditions produced, after ~4 seconds, a clearly labeled "Error" message with the exact real backend error text — no infinite loading, no fake success, no generic "Something went wrong" masking a real cause.

## 3 · Streaming

Backend streaming is real and well-built: `_streamOpenAICompatible()` (genuine SSE parser), `STREAM_CAPABLE` (explicitly scoped to verified-streaming providers, distinct from `aiRegistry.cjs`'s broader aspirational flag), `aiOrchestrator.executeStream()` (same fallback chain, budget check, and history accounting as the non-streaming path).

**Finding: zero frontend consumers.** `grep -rln 'orchestrator/execute/stream' frontend/src` → 0 results. `Chat.jsx`'s `.chat-stream-indicator`/`.msg--streaming` CSS classes are a loading/typing-indicator animation over a single blocking `sendMessage()` call in `App.jsx`'s `handleSend` (traced and confirmed: one `await sendMessage()`, no token-by-token rendering). The UI never claims to be streaming tokens — it shows a generic "responding" state — so this is not a dishonesty defect, but it is a real, precisely-documented gap between backend capability and frontend usage.

## 4 · Provider Chain / Real AI Request

```
groq      : configured=true health=intermittent (429 rate-limited during most of the session,
                                                   but succeeded live at least twice — see §Live Success below)
openai    : configured=true health=false  (401 — credential invalid/missing)
ollama    : configured=true health=false  (404 — not running locally)
lmstudio  : configured=true health=false  (unreachable at localhost:1234)
openrouter, claude, gemini, deepseek, together, fireworks, cohere, nvidia, grok, qwen : not configured
```

Classification: **groq = PRODUCTION READY (intermittent — real rate limit, not a defect)**, **openai = CREDENTIAL BLOCKED**, **ollama/lmstudio = ENVIRONMENT BLOCKED**, all others = **NOT CONFIGURED**. No credentials were invented, none printed, `.env` never modified.

**Live success achieved twice during this audit** (not fabricated — see raw ledger evidence in Workflow Evidence doc): a real `POST /jarvis "hello"` request returned a genuine groq `llama-3.3-70b-versatile` completion, correctly recorded with real cost ($0.000001), real latency (913ms), real token count.

## 5 · AI Model/Provider/Cost Display — **P0 finding, fixed**

`AICostCenter.jsx` (433 lines, live in production nav as "AI Cost Management") rendered a **fully hardcoded** `PROVIDERS`/`BUDGET_ALERTS`/`MONTHLY_SPEND`/`OPTIMIZATIONS` seed as if it were live measured spend: fabricated per-model request/token/cost/RPM counts, a fabricated 6-month spend history chart, fabricated budget-vs-threshold percentages and "warning" status, and fabricated "optimization" recommendations with invented savings figures and invented usage-pattern claims (e.g. "17% of Qwen requests are near-duplicates"). Only `status` and `activeProvider` were genuinely live-merged — real and fabricated data were visually indistinguishable in the same view. Full details and fix in the Final report.

## 6 · AI Memory/Context integration boundary

One confirmed integration point: `codingAssistant.js`'s `_missionContext()` → `missionMemory.cjs`'s `listMissions()`. Honest degradation confirmed (`try { ... } catch { return "" }`, route-level `503` when the memory module is unavailable). **Genuine gap found**: `missionMemory.cjs` has **zero orgId/organizationId field anywhere in its schema** — `listMissions({limit:5})` returns the last 5 missions **across the entire system**, not scoped to the caller's org. Proven live with two real test organizations (see Security report). Classified as a genuine Memory OS architectural gap, not fixed — redesigning Memory OS's data model is explicitly out of this audit's scope; the finding is fully documented and negative-tested to stay honestly surfaced rather than silently working around it.

## 7 · Cross-cutting defect found during tenant-isolation testing (not AI-specific in origin, but directly blocking AI routes)

While setting up real two-tenant testing for AI tenant isolation, `/coding/ask` unexpectedly 403'd for a fresh, unrelated org with `"Not a member of this workspace"` — a route that has no workspace-gating code at all. Root-caused to an Express routing bug: `security.js`, `admin.js`, `governance.js`, `automation.js`, `analytics.js`, `extensions.js`, `marketplace.js`, `plugins.js`, and `workspace.js` each registered `attachWorkspace`/`requireWorkspaceMember` via `router.use(fn)` with **no path prefix** — since these sub-routers are mounted in `routes/index.js` with no path prefix either, the unscoped middleware leaked onto **every route mounted afterward in the same barrel router**, including all of `/coding/*` and 100+ unrelated route files. Reproduced in an isolated minimal Express app to confirm the exact mechanism before fixing. Root-caused to commit `58cf1032` ("fix(security): close cross-tenant IDOR in /security/* and /admin/*") — the original security fix's own scoping had this bug. Fixed by adding the missing path-prefix argument to all 9 files' `attachWorkspace`/`requireWorkspaceMember` registrations. Full detail in Workflow Evidence and Security reports.
