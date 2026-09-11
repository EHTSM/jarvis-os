# 07 — AI Capabilities

**Status of this document:** VERIFIED against direct reads of `backend/services/aiService.js`, `missionOrchestrator.cjs`, `backend/routes/codingAssistant.js`, `backend/routes/creativeStudio.js`, `semanticMemorySearch.cjs`, and `knowledgeGraph.cjs`, cross-checked against `AI_PROVIDER_AUDIT.md` (an unusually rigorous self-audit) and the 2026-07-17 reality-completion audit.

---

## What Jarvis Can Do Today (VERIFIED)

### AI Chat & Multi-Provider Routing

`backend/services/aiService.js` (906 lines) implements **12 provider adapters**, each making direct HTTP calls (raw axios, not vendor SDKs, for most): Groq, OpenRouter, OpenAI, Claude (Anthropic), Gemini, Ollama (local), DeepSeek, Together, Fireworks, Cohere, NVIDIA NIM, LM Studio (local).

- **Fallback chain**: `_providerOrder()` builds an ordered provider list; `LLM_PROVIDER` env var promotes one to first position. `callAI()`/`chat()` iterate the chain, catching per-provider failures and falling through.
- **Retry**: `_withRetry()` retries once on network-class errors (connection reset/refused/timeout, 429/503) for 8 of the 12 providers (not Claude, Gemini, Ollama, LM Studio, per direct code read).
- **Capability-based routing**: `routeByCapability(task, opts)` maps task types (`reasoning`, `coding`, `fast`, `cheap`, `creative`, `analysis`) to a preferred provider order, picking the first with a configured key.
- **Tool/function calling**: `chatWithTools()` supports native tool-calling for 4 providers (OpenAI, OpenRouter, Claude, Gemini).
- **Live status today**: Groq and OpenAI are live-CONNECTED with real credentials. Anthropic and Gemini are fully coded but have no key provisioned in the current environment. OpenRouter and Ollama were independently flagged as not fully working by `AI_PROVIDER_AUDIT.md`.

**A documented, code-verified bug** (`AI_PROVIDER_AUDIT.md`, cross-checked against source): the `LLM_PROVIDER` env var and per-request `opts.model` override are not fully respected by the routing logic in all code paths — a hardcoded waterfall runs in some cases regardless of the configured preference. This means "pick your preferred AI provider" does not behave consistently everywhere in the app yet.

### Mission Planning

A real multi-file pipeline (Decision → `missionOrchestrator.cjs` stage-planning → `taskRouter.cjs`/`agentRegistry.cjs` capability routing → `agents/autonomousLoop.cjs` execution → `missionMemory.cjs` tracking), not a single-call stub. Live-verified: `POST /missions/orchestrator/create` produces a real mission with an auto-decomposed multi-stage plan; 228+ real missions were observed persisted during the 2026-07-17 audit, with 19 active and 95 total subtasks at one measured point.

### Developer Copilot

`backend/routes/codingAssistant.js` (989 lines) exposes 20+ real endpoints: `/coding/ask` (chat), `/coding/explain-file`, `/coding/find-impl`, `/coding/summarize`, `/coding/review`, `/coding/refactor`, `/coding/explain-error`, `/coding/generate-patch`, `/coding/apply-patch`, `/coding/undo-patch`, `/coding/patch-history`, `/coding/convert-to-mission`, `/coding/smells` (code-smell detection), `/coding/complete`, `/coding/hover`. A second file, `codingBundle.js`, adds repository-wide autonomous editing: `/coding/bundle/plan` (analyze a repo, produce an AI plan with per-file patches), `/coding/bundle/apply`, `/coding/bundle/:id/rollback`. This is a genuine chat + patch-preview + apply + undo pipeline, not a UI mockup.

### Automation & Connector Orchestration

Rule-based and scheduled automation (`node-cron`) drives WhatsApp/Telegram follow-up sequences and CRM automation rules, separate from the AI mission engine. Connector *status* (not yet actions) is exposed to AI agents as tool-calling definitions via `connectorToolBridge.cjs` — its own header comment is explicit: *"There is no per-service action layer in this codebase yet (no 'send Slack message' / 'create GitHub issue' methods exist anywhere)."* Three tools only today: `list_connected_services`, `get_connector_status`, `get_connector_auth_url`, covering 6 OAuth providers.

### Knowledge

`backend/services/knowledgeGraph.cjs` — a real typed graph (15 node types, ~16-18 relation types) built over existing domain stores rather than duplicating data, with `traverse`, `findRelated`, `impactAnalysis` APIs. Numerous supporting "knowledge*" services exist (reasoning, quality, benchmark, prediction, evolution, correlation, discovery, federation engines) whose existence is confirmed but whose internal depth was not individually verified in this audit — treat as REAL-but-unverified-in-depth.

### Memory

`backend/services/semanticMemorySearch.cjs` — a genuine, from-scratch TF-IDF semantic search engine (pure JS, no external dependency): real term-frequency/inverse-document-frequency vectorization and cosine-similarity search, directly confirmed by reading the implementation (not just the marketing description). This is one of the more solid, independently-verifiable claims in the entire codebase.

### Creative Studio

`backend/routes/creativeStudio.js` (561 lines) implements 10 sub-modules across 35+ endpoints: Image Studio (generate/edit/upscale/remove-background/logo/banner), Video Studio (text-to-video, image-to-video, reel, short, animation), Voice Studio (TTS, STT, music, voice clone), Brand Studio, Social Content Engine, Workspace, Asset Library, Commercial Benchmark. All generation routes funnel through a shared `_createCreativeJob()` helper — i.e. actual generation is job-queue-based (`creativeJobQueue.cjs`), not synchronous inline model calls. **This documentation could not independently confirm whether `creativeJobQueue.cjs` calls a real external image/video/voice generation provider end-to-end** — the routing and queueing architecture is real; the terminal provider call was not traced in this audit pass. A real bug was fixed here on 2026-07-17: a credit-check field mismatch was wrongly rejecting every account with real credits.

### Business Automation

Real, live-tested: CRM lead capture, deal pipeline, WhatsApp/Telegram automated follow-up, and the newer "Company Factory" (create a company from an idea, track through a 7-stage lifecycle). See [05_FEATURE_CATALOG.md](05_FEATURE_CATALOG.md).

---

## What Jarvis Cannot Do Yet (VERIFIED gaps)

- **True self-correction.** Specifically searched for in the 2026-07-17 audit and **not found**: the system does not recognize that a prior autonomous decision's judgment was wrong and choose a materially different approach because of it. `autonomousDecisionEngine.cjs` is a stateless rule-matcher with hardcoded, never-adjusted confidence constants. `executionRecovery.cjs`'s `selectStrategy()` escalates by attempt count (a static decision tree) — real recovery, not judgment revision. Live proof: 5 real self-heal events in one audited run all chose the identical strategy at the identical static confidence value.
- **Real per-service connector actions.** The AI agent tool layer can check connector *status* and get an auth URL, but cannot yet "send a Slack message" or "create a GitHub issue" — no such action methods exist in the codebase.
- **Real Gmail/Calendar/Drive access.** OAuth scopes are requested; zero outbound API calls are ever made to any of the three services.
- **A live, credentialed connection to most third-party connectors** in the current deployment environment — 12 of 17 named connectors are code-complete but uncredentialed (see [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md)).
- **Consistent AI provider preference honoring** — the `LLM_PROVIDER`/`opts.model` bug noted above means "always use provider X" is not fully reliable yet.
- **Genuine autonomous operation of the "organization" subsystems** as live businesses — see [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md) for the full, honest breakdown of what "autonomous" does and does not mean in this codebase today.

---

*Next: [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md) for the full external-integration inventory.*
