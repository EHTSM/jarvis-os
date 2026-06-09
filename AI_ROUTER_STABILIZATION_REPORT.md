# AI Router Stabilization Report — Phase 48.5

**Date:** 2026-06-08  
**Build:** `Compiled successfully` · 423.92 kB JS (+696 B) · 123.44 kB CSS (+58 B) · Zero errors · Zero warnings

---

## Summary of Changes

| File | Type | Change |
|------|------|--------|
| `backend/services/aiService.js` | Rewrite | 4-provider router, LLM_PROVIDER, Ollama /api/chat, model forwarding, retry, health checks, status state |
| `backend/routes/ai.js` | Edit | Added `GET /ai/status` endpoint; forwarded `provider`/`model` opts on `POST /ai/chat` |
| `frontend/src/aiApi.js` | New | `getAIStatus()` — thin fetch wrapper for `/ai/status` |
| `frontend/src/components/DevOpsCenterV2.jsx` | Edit | `TabModels` now fully live: router strip (active provider, order, call/fail counts), per-card health, key status, last error, timeout |
| `frontend/src/components/DevOpsCenterV2.css` | Edit | Router strip grid layout + error row styles |

---

## Provider Status

### Groq

| Check | Before | After |
|-------|--------|-------|
| Configured | ✅ | ✅ |
| Available | ✅ `GROQ_API_KEY` set | ✅ |
| Model forwarding | ❌ `_groq(messages)` — arg dropped | ✅ `_groq(messages, model)` |
| Retry | ❌ | ✅ 1 retry on network/429/503 errors |
| Timeout | 20s hardcoded | 20s default, `GROQ_TIMEOUT` env override |
| Health check | ❌ | ✅ `GET /openai/v1/models` |
| In main waterfall | ✅ | ✅ position 0 when LLM_PROVIDER=groq |
| Fallback order | position 0 always | position 0 when preferred OR first in defaults |

**Test evidence:** `GROQ_API_KEY` present in `.env`. Health probe: `GET https://api.groq.com/openai/v1/models` with Bearer token returns 200. `getAIStatus()` returns `{ ok: true }` for groq.

---

### OpenRouter

| Check | Before | After |
|-------|--------|-------|
| Configured | ❌ key absent | ❌ key still absent — must add `OPENROUTER_API_KEY` to `.env` |
| Available | ❌ | ❌ (key not set) |
| In main `callAI()` waterfall | ❌ not present | ✅ position 1 in default order |
| Health check | ❌ | ✅ `GET /api/v1/models` |
| Model forwarding | N/A | ✅ `_openrouter(messages, model)` |
| Retry | ❌ | ✅ 1 retry on network/429/503 |
| Timeout | N/A | 25s default, `OPENROUTER_TIMEOUT` env override |
| Referrer headers | ❌ (only in toolExecutionLayer) | ✅ `HTTP-Referer` + `X-Title` sent |

**Fallback order:** Groq → OpenRouter → OpenAI → Ollama (when LLM_PROVIDER not set or set to groq)

**To activate:** Add `OPENROUTER_API_KEY=<key>` to `.env`. No code change required.

---

### OpenAI

| Check | Before | After |
|-------|--------|-------|
| Configured | ✅ `OPENAI_API_KEY` set | ✅ |
| Available | ✅ | ✅ |
| Model forwarding | ❌ `_openai(messages)` — arg dropped | ✅ `_openai(messages, model)` |
| Retry | ❌ | ✅ 1 retry on network/429/503 |
| Timeout | 20s hardcoded | 20s default, `OPENAI_TIMEOUT` env override |
| Health check | ❌ | ✅ `GET /v1/models` |
| Fallback position | 1 (after Groq) | 2 (after Groq → OpenRouter) |

---

### Ollama

| Check | Before | After |
|-------|--------|-------|
| Configured | ❌ no env vars | ⚠️ still not in `.env`; env vars now honoured in code |
| Endpoint | ❌ `/api/generate` (deprecated) | ✅ `/api/chat` |
| Conversation history | ❌ plain `prompt` string | ✅ `messages` array passed |
| `OLLAMA_URL` env var | ❌ hardcoded | ✅ `process.env.OLLAMA_URL || "http://localhost:11434"` |
| `OLLAMA_MODEL` env var | ⚠️ only in old fn | ✅ `process.env.OLLAMA_MODEL || "llama3.2"` |
| Health check | ⚠️ only in observabilityEngine | ✅ `GET /api/tags` |
| Retry | ❌ | ❌ no retry for Ollama (local; connection refusal is immediate) |
| Fallback position | 2 (last) | 3 (last) |

**To activate:** Add to `.env`:
```
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

---

## AI Router

### Provider Priority

`LLM_PROVIDER` env var is now honoured. It elevates its value to position 0; all other providers follow in fixed order.

| `LLM_PROVIDER` | Waterfall |
|----------------|-----------|
| `groq` (or unset) | groq → openrouter → openai → ollama |
| `openrouter` | openrouter → groq → openai → ollama |
| `openai` | openai → groq → openrouter → ollama |
| `ollama` | ollama → groq → openrouter → openai |

### Failover Logic

```
for provider in waterfall:
    try:
        result = call(provider)   ← with 1 retry on network/429/503
        record activeProvider = provider
        return result
    except:
        record lastFailures[provider] = { reason, ts }
        log.warn(...)
        continue

return "AI backend unavailable…"
```

### Timeout

Per-provider, configurable via env vars:

| Provider | Default | Env var |
|----------|---------|---------|
| Groq | 20s | `GROQ_TIMEOUT` |
| OpenRouter | 25s | `OPENROUTER_TIMEOUT` |
| OpenAI | 20s | `OPENAI_TIMEOUT` |
| Ollama | 30s | `OLLAMA_TIMEOUT` |

### Retry

- Groq, OpenRouter, OpenAI: 1 retry after 800ms on `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, HTTP 429, HTTP 503.
- Ollama: no retry (local — connection refused is permanent until service starts).
- No retry across providers (each provider is a single attempt after its own retry).

### Circuit Breaker

Not implemented. Health probes on `/ai/status` serve as manual circuit inspection. Health-based automatic skip is a future improvement.

---

## Runtime Status Endpoint

`GET /ai/status` (auth required):

```json
{
  "success": true,
  "activeProvider": "groq",
  "preferredOrder": ["groq", "openrouter", "openai", "ollama"],
  "lastSuccess": "2026-06-08T12:34:56.789Z",
  "callCount": 42,
  "failCount": 1,
  "providers": [
    {
      "id": "groq",
      "configured": true,
      "health": { "ok": true },
      "lastFailure": null,
      "timeout": 20000
    },
    {
      "id": "openrouter",
      "configured": false,
      "health": { "ok": false, "reason": "OPENROUTER_API_KEY not set" },
      "lastFailure": null,
      "timeout": 25000
    },
    {
      "id": "openai",
      "configured": true,
      "health": { "ok": true },
      "lastFailure": null,
      "timeout": 20000
    },
    {
      "id": "ollama",
      "configured": true,
      "health": { "ok": false, "reason": "connect ECONNREFUSED 127.0.0.1:11434" },
      "lastFailure": null,
      "timeout": 30000
    }
  ]
}
```

Health probes run in parallel on each `/ai/status` call with a 6s cap. The endpoint itself stays fast because all probes race against the cap.

---

## UI Visibility (DevOps Center — AI Models tab)

The AI Models tab now shows live data from `/ai/status` on every mount:

1. **Router Status strip** (new) — active provider, failover order, total calls, failure count, last success timestamp
2. **Provider cards** — now 4 cards (Groq, OpenRouter, OpenAI, Ollama) with:
   - Live health status (reachable / unreachable + reason)
   - API key presence
   - Configured timeout
   - Last failure reason (if any)
   - `PRIMARY` badge on active provider
   - Status chip colour: green (active) → teal (ready) → amber (degraded) → grey (not configured)
3. **Fallback**: if `/ai/status` call fails, cards render from seed data with `status: "loading"` styling

---

## Bugs Fixed from Audit

| Bug | Fix |
|-----|-----|
| `opts.model` silently dropped | `_groq(messages, model)`, `_openai(messages, model)`, `_openrouter(messages, model)`, `_ollama(messages, model)` |
| `LLM_PROVIDER` env var ignored | `_providerOrder()` reads `process.env.LLM_PROVIDER` |
| Ollama `/api/generate` (deprecated) | Rewritten to `POST /api/chat` with `messages` array |
| Ollama conversation history discarded | `messages` array now passed instead of raw `prompt` |
| OpenRouter absent from main waterfall | Added as position 1 in default order; full `_openrouter()` adapter |
| No retry logic | `_withRetry()` wrapper on hosted providers |
| No health checks | `_healthCheck(provider)` for all 4 providers |
| No runtime visibility | `getAIStatus()`, `/ai/status` endpoint, UI router strip |

---

## Remaining Actions Required

| Action | Owner | Effort |
|--------|-------|--------|
| Add `OPENROUTER_API_KEY=<key>` to `.env` | Operator | 1 min |
| Add `OLLAMA_URL` + `OLLAMA_MODEL` to `.env` | Operator | 1 min |
| Install and start Ollama locally | Operator | ~5 min |
| Add circuit-breaker (auto-skip unhealthy providers) | Engineering | 2–4h |
| Add `/ai/status` to public ops dashboard (unauthenticated summary) | Engineering | 30 min |

---

*Phase 48.5 complete. All 5 deliverables shipped. Build clean.*
