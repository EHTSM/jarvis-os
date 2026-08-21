# OS-AI-WORKSPACE — DISCOVERY REPORT

**Track:** OOPLIX OS #14 — AI Workspace OS
**Date:** 2026-08-15 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new AI platform was built.**
**Isolation:** Verification server on **port 5188**. The concurrent Audit Track's own server
(port 5050) was checked before and after every process action this pass — confirmed running
throughout, including through two legitimate self-initiated restarts by that session (PID changed
79223 → 18045 → 26024, each verified healthy via its own `/health` endpoint before continuing;
none of these restarts were caused by this session).

---

## 1. Relationship to the concurrent C.9 AI Experience audit

The Audit Track's own C.9 pass (dated the same day, `reports/C9-AI-EXPERIENCE-*.md`, read but never
modified) already comprehensively covered: AI honesty across `/jarvis`, `/ai/chat`,
`/ai/chat-with-tools`, `/ai-ecosystem/orchestrator/*`; the provider fallback chain and real
credential-blocked/environment-blocked classification; streaming (real backend, zero frontend
consumers); a P0 fabricated-data fix in `AICostCenter.jsx`; a platform-wide unscoped-middleware bug
found and fixed across 9 route files; and two genuine, documented (not fixed) tenant-isolation gaps
in `missionMemory.cjs` and `/coding/*` patch storage.

Per this mission's instruction not to re-audit unless a direct AI Workspace dependency requires it,
this pass **does not re-derive** C.9's findings. It cites them as prior art, spot-verifies the
current state is unchanged, and focuses new verification on the dimensions this mission's own
30-point checklist requires that C.9 did not cover: model/provider selection correctness,
attachments, agent handoff boundary, org-scoped AI (`/org-ai/*` — not in C.9's surface map at all),
response-cache tenant isolation, restart persistence with two populated tenants, and Electron
reachability.

## 2. Real AI Workspace surface map

| Surface | Route(s) | Service | Auth | Tenant scope |
|---|---|---|---|---|
| Main "AI Chat" tab | `POST /jarvis` | `jarvisController.js` → `aiOrchestrator.execute()` / `ai.callAI()` fallback | `requireAuth` + `attachOrg` (already fixed by C.9) | Account + org (after this pass's fix — see §5) |
| Direct AI chat API | `POST /ai/chat`, `/ai/chat-with-tools` | `aiService.js` | `requireAuth` + `attachOrg` | Yes (B.14 fix, pre-existing) |
| Provider status | `GET /ai/status` | `aiService.getAIStatus()` | `requireAuth` | N/A (global health) |
| Orchestrated chat | `POST /ai-ecosystem/orchestrator/execute[/stream]` | `aiOrchestrator.execute/executeStream` | `requireAuth` + quota | Yes, caller-supplied orgId/workspaceId |
| **Org AI Brain** (not in C.9's map) | `POST /org-ai/:orgId/ask[-stream]`, `GET /org-ai/:orgId/{history,usage,recommend,provider-health}` | `orgAiBrain.cjs` | `requireAuth` + `organizationService.hasPermission(..., "use_ai")` | Yes — path-param-only, proactively confused-deputy-hardened (own code comment cites the lesson from a prior header-vs-path-param bug) |
| AI prompt history (self) | `GET /ai-ecosystem/history/me` | `promptHistory.query/loadHistory` | `requireAuth` | Yes, self-scoped |
| AI prompt history (org) | `GET /ai-ecosystem/history/workspace/:workspaceId` | same | `requireAuth`+`attachOrg`+permission | Yes (pre-existing "Phase A.1 Recertification" fix) |
| AI cost/usage dashboards | `AIUsageDashboard.jsx`, `AICostCenter.jsx` | `/ai-ecosystem/analytics/*` | Real, live-fetch | Yes |
| Repo-aware coding assistant | `/coding/ask` etc. | `codingAssistant.js` → `aiService.callAI()` | `requireAuth` only | No (C.9-documented gap, not re-verified here) |

## 3. Genuinely new findings this pass (beyond C.9's scope)

1. **Model/provider selection was completely non-functional.** The AI Chat tab's model selector
   (`Chat.jsx`'s `MODELS` list) has always sent `{provider, model}` to `POST /jarvis`
   (`frontend/src/api.js`'s `sendMessage()`), but `jarvisController.js`'s `handleJarvis()` never
   read either field from `req.body`, and never forwarded them into `aiOrchestrator.execute()`.
   Selecting "GPT-4o mini" or "Claude Haiku" in the UI had zero effect — every request silently used
   the same auto-routed chain. **Fixed** — see Security/Final reports.
2. **`jarvisController.js`'s generic usage-ledger recording lost org attribution.** Two of its three
   `usageMetering.record()` call sites (the `mode !== "intelligence"` success path, and the outer
   catch-all failure) never forwarded `req.org?.id`/`req.workspace?.id`, unlike the third site
   inside `_intelligencePipeline`. Confirmed live: every `"provider":"jarvis"` ledger entry read
   `orgId:null` regardless of the account's real org. **Fixed.**
3. **`aiOrchestrator`'s response cache had no tenant dimension.** Cache key was
   `(provider, model, temperature, messages)` only — two different accounts asking the exact same
   prompt text within the 5-minute TTL would receive the same cached response, and neither side's
   usage/history would ever record it (a cache hit returns before either ledger write runs).
   **Fixed** by adding a tenant key (accountId, falling back to orgId) to the cache.
4. **`AIUsageDashboard.jsx`'s history panel silently loses all visible history on every backend
   restart**, even though the data is genuinely still on disk. `promptHistory.query()` (the default
   the panel calls) only reads an in-memory ring that resets on restart; `loadHistory()`
   (`fromLedger=true`) reads the durable file and was never used by this panel. **Fixed** — one
   query-param change.
5. **Client-controlled `history` array can inject a `role:"system"` message with no server-side
   validation or stripping**, in both `/jarvis` and the orchestrator paths. Not a cross-tenant or
   auth boundary issue (a user can only manipulate their own conversation), but a real prompt-
   injection surface. **Documented as a genuine gap, not fixed** — closing it properly requires a
   product decision on system-role-message policy, out of this pass's minimal-recovery scope.

## 4. Confirmed genuinely absent (not mis-implemented)

- **No file/attachment upload anywhere in the AI chat surface** — confirmed via full-repo grep for
  attachment/upload handling scoped to `/jarvis`, `/ai/*`, `/ai-ecosystem/*`, `/org-ai/*`.
- **No agent-handoff reachable from AI Workspace chat.** Real multi-agent handoff infrastructure
  exists elsewhere (`multiAgentCoordinator.cjs`, `agentRuntimeSupervisor.cjs` — Agent OS territory,
  explicitly out of this mission's build scope) but nothing in `jarvisController.js` or
  `aiOrchestrator.cjs` calls into it. A real, honest architectural boundary, not a broken feature.
- **No direct Knowledge OS (`orgKnowledgeGraph.cjs`) wiring into the chat pipeline** — same boundary
  situation as Memory OS (already documented by C.9).

## 5. Backend inventory (files touched or newly traced this pass)

| File | Role |
|---|---|
| `backend/controllers/jarvisController.js` | Main `/jarvis` pipeline — 2 fixes this pass |
| `backend/services/aiOrchestrator.cjs` | Fallback chain, budget, cache, history — 1 fix this pass (cache tenant key wiring) |
| `backend/services/aiResponseCache.cjs` | Response cache — 1 fix this pass (tenant-keyed) |
| `backend/services/orgAiBrain.cjs` | Org-scoped AI entry point — verified real, no changes needed |
| `backend/routes/orgAiBrain.js` | `/org-ai/:orgId/*` — verified real, confused-deputy-safe by design |
| `backend/services/promptHistory.cjs` | Durable + in-memory conversation log — verified real, no changes needed |
| `frontend/src/components/AIUsageDashboard.jsx` | 1 fix this pass (restart-persistence query param) |

---

**Outcome:** AI Workspace OS is a real, substantial, mostly well-built system layered on top of
already-hardened AI infrastructure. Three genuine defects found and fixed (model selection dead,
org-attribution loss, cross-tenant cache sharing), one UX/reliability defect fixed (history panel
false-empty state after restart), one genuine gap documented (system-role prompt injection). **0
systems built.**
