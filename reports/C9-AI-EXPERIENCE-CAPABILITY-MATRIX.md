# C.9 — AI EXPERIENCE CAPABILITY MATRIX

Date: 2026-08-14/15 · Branch: `security/reality-completion`

`PRODUCTION READY` · `FIXED` · `VERIFY` · `NOT MEASURED` · `CREDENTIAL BLOCKED` · `ENVIRONMENT BLOCKED` · `GENUINE GAP` · `N/A`

---

## AI honesty & error handling

| Capability | Classification | Evidence |
|---|---|---|
| `/ai/chat` — no fake success on total provider failure | **PRODUCTION READY** | Prior "A.10" fix confirmed live: real 502, real message |
| `/ai/chat-with-tools` — throws (not sentinel) on total failure | **PRODUCTION READY** | Source + live 500 reproduction |
| `/jarvis` — no fake success on total provider failure | **PRODUCTION READY** | Prior "B.9" fix confirmed; live browser test shows honest "Error" state after ~4s, no infinite hang |
| `/ai-ecosystem/orchestrator/execute` — no fake success | **PRODUCTION READY** | Live 500 with real per-provider error list |
| SSE stream honest error propagation | **PRODUCTION READY** | `event: error` with real message under live-tested failure |
| Empty/malformed provider response handling | **PRODUCTION READY** | `_callAI()` throws on empty/whitespace-only reply, not just on the sentinel string |
| Per-tool failure surfaced (not silently dropped) | **PRODUCTION READY** | `{...call, error: e.message}` per failed tool call, confirmed by source read |
| Fabricated metrics/confidence/model names | **FIXED** (was P0 GENUINE GAP) | `AICostCenter.jsx` — see below |

## Streaming

| Capability | Classification | Evidence |
|---|---|---|
| Backend SSE streaming (`aiOrchestrator.executeStream`, `_streamOpenAICompatible`) | **PRODUCTION READY** (as backend capability) | Real SSE parser, real honest error frames, live-tested |
| Frontend streaming consumption | **GENUINE GAP** | 0 frontend call sites for `/execute/stream`; Chat.jsx's "streaming" CSS is a loading-indicator animation over one blocking request |
| UI never falsely claims real-time token streaming | **PRODUCTION READY** | Confirmed: UI shows a generic "responding" state, not a token-stream claim — the gap is unused capability, not a false claim |

## Provider chain

| Provider | Classification | Evidence |
|---|---|---|
| groq | **PRODUCTION READY** (intermittent rate limit, not a defect) | Live success reproduced twice: real `llama-3.3-70b-versatile` completions |
| openai | **CREDENTIAL BLOCKED** | 401 — invalid/missing key |
| ollama | **ENVIRONMENT BLOCKED** | 404 — not running locally |
| lmstudio | **ENVIRONMENT BLOCKED** | unreachable at localhost:1234 |
| openrouter, claude, gemini, deepseek, together, fireworks, cohere, nvidia, grok, qwen | **NOT CONFIGURED** | No API key set |

## AI Memory/Context

| Capability | Classification | Evidence |
|---|---|---|
| `_missionContext()` honest empty-string degradation | **PRODUCTION READY** | try/catch to `""`, never fabricates mission data |
| Route-level honest 503 when memory unavailable | **PRODUCTION READY** | `codingAssistant.js:653` |
| Mission context tenant isolation | **GENUINE GAP** | `missionMemory.cjs` has no orgId field at all; proven live — Org A's mission text appears in the top-5 list regardless of caller's org |

## AI Tenant Isolation (2/2 real orgs tested)

| Boundary | Classification | Evidence |
|---|---|---|
| `/coding/ask`, `/coding/patch-history`, `/coding/bundle/*` | **GENUINE GAP** | Zero org/workspace scoping anywhere in the `/coding/*` family; `/coding/patch-history` returns identical global data to both test orgs |
| `/ai-ecosystem/history/me` (self-scoped) | **PRODUCTION READY** | Correctly isolated by `accountId` from JWT; forged `orgId` query param ignored |
| `/ai-ecosystem/history/workspace/:workspaceId` | **PRODUCTION READY** | Prior "Phase A.1" fix confirmed live: cross-org read correctly 403's |
| `promptHistory.record()`/`query()` orgId scoping | **PRODUCTION READY** | Directly tested: A's marker only returned for A's orgId query, B's only for B's |
| Connector tool execution (`connectorToolBridge.cjs`) | **PRODUCTION READY** | Keyed `provider:userId`, directly tested isolated for two real accounts |
| Cross-router middleware leak blocking `/coding/*` for unrelated orgs | **FIXED** (was a real defect, now resolved) | Root-caused, reproduced in isolation, fixed in 9 files, live-verified cleared |
| `/jarvis` org attribution | **FIXED** (was GENUINE GAP) | `attachOrg` was never mounted; fixed, live-verified real `orgId` now recorded |
| Direct-ID/forged-header widening access | **N/A — correctly never occurs** | Forged headers/params had no effect either way on unscoped routes (never consulted); real gates (workspace history) correctly reject forgery |

## AI Agent/Tool Honesty

| Capability | Classification | Evidence |
|---|---|---|
| Tool requested → actually executed → result returned | **PRODUCTION READY** | `connectorToolBridge.executeConnectorTool()` — 3 real tools, real `oauth` service calls, honest `default: throw` for unknown tools |
| Tool failure correctly surfaced (not claimed as success) | **PRODUCTION READY** | Per-call try/catch in `/ai/chat-with-tools` |
| No "mission succeeded" claim on failure | **PRODUCTION READY** (at AI boundary only) | `_salesPipeline`'s honest degradation when `payment.createPaymentLink()` fails — no fabricated payment link |

## AI Model/Provider/Cost/Quota Display

| Capability | Classification | Evidence |
|---|---|---|
| `AICostCenter.jsx` cost/token/request data | **FIXED** (was P0 fabrication) | Full rewrite to real `/analytics/ai-cost`, honest empty state, live-verified with both zero and real non-zero data |
| `AICostCenter.jsx` provider health | **PRODUCTION READY** | Genuine `/ai/status` merge, unchanged (was already real) |
| `AICostCenter.jsx` routing/budget sections | **RELABELED** (was fabricated, no real engine exists) | Now explicit "Example configuration — not measured" — building a real engine is out of audit scope |
| `AIUsageDashboard.jsx` | **PRODUCTION READY** | Entirely real-fetch driven, no hardcoded seed found |
| `AIBenchmarkLab.jsx` | **PRODUCTION READY** | No hardcoded metrics found |
| Main chat UI (App.jsx) model/provider/token display | **GENUINE GAP** (absent, not fabricated) | `res.provider`/`res.model`/`res.tokens` never read anywhere in the frontend — nothing shown, so no fabrication risk, but no transparency either |
| Usage quota enforcement | **PRODUCTION READY** | `requireUsageQuota` — real 429 with real used/limit numbers, live-confirmed in dashboard ("0/200 AI actions") |
| `usageMetering.summary()`/`aggregateCost()` | **PRODUCTION READY** (was unwired, now exposed) | Real, correct cost/token/latency aggregation; previously had no route — added `GET /analytics/ai-cost` |

## AI History

| Capability | Classification | Evidence |
|---|---|---|
| Create (write on success) | **PRODUCTION READY** | `aiOrchestrator.execute()` → `history.record()`, correctly only on success path |
| Never records failures as successes | **PRODUCTION READY** | Confirmed: `history.record()` absent from the catch branch |
| Read (self + org/workspace scoped) | **PRODUCTION READY** | Both routes tested live |
| Reload/persistence (ndjson + in-memory ring) | **PRODUCTION READY** | `data/prompt-history.ndjson`, confirmed real entries with real cost/latency |
| Delete | **NOT MEASURED** | No delete endpoint found for prompt history; not exercised (would require a new route) |
| Tenant isolation | **PRODUCTION READY** | Live-verified, real data, both directions |

## AI Search/Citations

| Capability | Classification | Evidence |
|---|---|---|
| Citations (source-backed AI claims) | **N/A** | No citation UI or backend logic exists anywhere |
| Semantic memory search (`semanticMemorySearch.cjs`) | **PRODUCTION READY** (as its own capability) | Real TF-IDF/cosine-similarity search — not an AI-citation feature, out of this dimension's scope |

## AI + Cross-OS Experience

| Capability | Classification | Evidence |
|---|---|---|
| `_salesPipeline` → real CRM/payment calls | **PRODUCTION READY** | Honest degradation on payment failure |
| `_intelligencePipeline` → real orchestrator/AI calls | **PRODUCTION READY** | No re-audit of Sales/CRM OS performed — only the AI boundary verified |
| AI correctly reports OS state without re-auditing those OSs | **PRODUCTION READY** (at the boundary tested) | `_salesPipeline`, `_executionPipeline` traced; no OS work performed |

## AI Accessibility (AI-specific only, not a C.1 repeat)

| Check | Classification | Evidence |
|---|---|---|
| Chat input accessible name | **PRODUCTION READY** | `aria-label="Message Ooplix"`, stable despite dynamic placeholder (prior C.1 fix) |
| Submit control accessible name | **PRODUCTION READY** | `aria-label="Send message"` |
| Keyboard submission | **PRODUCTION READY** | Live-tested: Enter key submits |
| Visible focus | **PRODUCTION READY** | Live-tested: input focusable, `document.activeElement` confirms |
| Loading indication | **PRODUCTION READY** | `disabled: true`, placeholder → "Ooplix is responding…", live-confirmed |
| Error visibility | **PRODUCTION READY** | Live-tested: clearly labeled "Error" + real message text |
| Retry accessibility | **NOT MEASURED** | No explicit retry button found in Chat.jsx; user can resend manually |
| Empty state | **PRODUCTION READY** | AICostCenter's new empty state is a real, visible, readable banner |

## AI Performance (AI-specific only, not a C.3 repeat)

| Measure | Classification | Evidence |
|---|---|---|
| Time to first response (successful) | **PRODUCTION READY** (measured) | 913ms real groq call, `/jarvis` |
| Time to failure resolution (UI) | **PRODUCTION READY** (measured) | ~4s from submit to visible "Error" in live browser test |
| No infinite loading on failure | **PRODUCTION READY** | Confirmed: input re-enables, error displays |
| Provider vs application latency distinguished | **PRODUCTION READY** | `usageMetering`/`promptHistory` both record `latencyMs` per-provider-call, not blended with app overhead |

## Security

| Check | Classification | Evidence |
|---|---|---|
| Unauthenticated AI access | **PRODUCTION READY** | 401 on `/coding/ask`, `/ai/chat`, `/coding/patch-history` with no session |
| Cross-tenant AI history | **PRODUCTION READY** | Live-verified, real data |
| Cross-tenant AI memory/context | **GENUINE GAP** | See Memory section above |
| Direct-ID access widening | **N/A** | No case found where an ID/header widened access |
| Forged org headers | **N/A — correctly inert** | No effect either way on unscoped routes; real gates correctly reject |
| Tool execution authorization | **PRODUCTION READY** | Per-user `oauth` scoping confirmed |

## Summary counts

| Classification | Count |
|---|---:|
| PRODUCTION READY | 34 |
| FIXED | 3 (AICostCenter fabrication, jarvis.js attachOrg, cross-router middleware leak) |
| GENUINE GAP | 4 (mission-context tenant isolation, `/coding/*` tenant isolation, frontend streaming consumption, main-chat model/provider display) |
| RELABELED | 1 (AICostCenter routing/budget example sections) |
| CREDENTIAL BLOCKED | 1 (openai) |
| ENVIRONMENT BLOCKED | 2 (ollama, lmstudio) |
| NOT CONFIGURED | 10 (unconfigured providers) |
| NOT MEASURED | 2 (prompt history delete, retry-button accessibility) |
| N/A | 4 (citations, direct-ID widening, forged-header widening on unscoped routes) |
