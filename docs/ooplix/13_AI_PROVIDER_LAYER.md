# 13 — AI Provider Layer (Phase 7 detail)

## Real multi-provider routing

`backend/services/aiService.js` implements 14 real provider integrations
(Groq, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Together AI, Fireworks
AI, Cohere, NVIDIA NIM, Ollama, LM Studio, Grok/x.ai, Qwen/DashScope), each
with a real per-provider model default overridable by env var
(`_claudeModel()`, `_geminiModel()`, etc.), real port-liveness checks for local
providers (`_isPortOpen` for Ollama/LM Studio), and a real `_providerOrder()`
failover chain with `_isUnconfigured`/`_isRetryable` classification. This is a
genuine multi-provider abstraction, not a single-provider wrapper with a
config flag.

## Historical defects, confirmed fixed

- **`AIW-1`** (per `03_OOPLIX_OS_MAP.md`'s AI OS entry): a model/provider
  selector UI control previously had zero backend effect (silently ignored) —
  fixed.
- **`AIW-2`** (P1, cross-tenant): the AI response cache had no tenant
  dimension — two different orgs asking the same prompt within a 5-minute
  window shared a cached response invisibly. Fixed.
- **A real historical fake-success defect** (per `03_OOPLIX_OS_MAP.md`'s
  reference to a parallel audit track, C.9): `AICostCenter.jsx` previously
  fabricated an entire cost dashboard (hardcoded provider/spend/chart/
  recommendations) presented as live data — the exact CLAUDE.md §17 violation
  class. Fixed by wiring the already-existing `usageMetering.summary()`.

## Open items

- One genuine, currently-unresolved policy question (not a security hole):
  client-controlled `history` in the chat payload can inject a
  `role:"system"` message — a prompt-injection surface scoped to the caller's
  own session (no cross-tenant impact confirmed), needing a product decision
  rather than a code fix.
- The connector layer's separate `connect*AIProvider` functions (see
  `14_INTEGRATION_CATALOG.md`) do real `/models`-equivalent reachability
  probes for these same 14 providers, distinct from `aiService.js`'s own
  runtime provider selection — the two systems are not the same code path,
  which is expected (one drives real chat completions, the other drives the
  operator-facing connector status dashboard).

## Verdict

The AI provider layer is one of the more mature, multi-vendor-hardened
subsystems in the repo — real failover, real per-tenant cache scoping (after
fix), real usage-metering-backed cost reporting (after fix). Not scored 10/10:
the unresolved prompt-injection policy question and the general caveat that
provider API keys were not (and per credential-safety rules, could not be)
verified live in this mission keep it below full certification.
