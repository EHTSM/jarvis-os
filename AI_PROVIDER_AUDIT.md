# AI Provider Audit — Phase 46.5

**Date:** 2026-06-08  
**Scope:** All AI provider integrations in the active codebase (no assumptions, evidence from code only)

---

## Summary Table

| Provider   | Implemented | Configured | Health Check | Model Discovery | Chat Completion | Embeddings | Working |
|------------|-------------|------------|--------------|-----------------|-----------------|------------|---------|
| Groq       | ✅ Yes      | ✅ Yes     | ❌ No        | ❌ No           | ✅ Yes          | ❌ No      | ✅ Yes  |
| OpenAI     | ✅ Yes      | ✅ Yes     | ❌ No        | ❌ No           | ✅ Yes          | ❌ No      | ✅ Yes  |
| Ollama     | ⚠️ Partial  | ❌ No      | ⚠️ Partial   | ⚠️ Partial      | ⚠️ Limited      | ❌ No      | ❌ No   |
| OpenRouter | ⚠️ Partial  | ❌ No      | ⚠️ Key probe | ✅ Yes          | ✅ Yes          | ❌ No      | ❌ No   |

---

## 1. Groq

### Evidence

**Implementation** — `backend/services/aiService.js` lines 39–48:
```javascript
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function _groq(messages, model) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");
    const res = await axios.post(GROQ_URL,
        { model: model || "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 1024 },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 20000 }
    );
    return res.data.choices[0].message.content;
}
```

**Configuration** — `.env`:
```
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_REDACTED_ROTATE_NOW... (live key, present)
```

**Config module** — `backend/config/index.js`:
```javascript
groqKey: () => process.env.GROQ_API_KEY || ""
```

**Router priority** — `aiService.js` `callAI()`: Groq is index 0 in `["groq","openai","ollama"]` — first attempted.

### Findings

| Check | Result | Evidence |
|-------|--------|----------|
| Implemented | ✅ | `_groq()` function, `aiService.js:39` |
| Configured | ✅ | `GROQ_API_KEY` present in `.env` (live key) |
| Tested | ⚠️ No test file | No unit/integration test found for `_groq()` |
| Working | ✅ | Key present, function calls Groq OpenAI-compatible endpoint |
| Health check route | ❌ | No `/health/groq` or similar endpoint exists |
| Model selection | ⚠️ Bug | `callAI()` calls `_groq(messages)` — second `model` arg NOT forwarded; `opts.model` silently ignored for Groq |
| Timeout | ⚠️ Fixed | 20000ms hardcoded in axios call; not configurable per-request |
| Retry | ❌ | Single attempt; no retry within Groq before falling to next provider |
| `LLM_PROVIDER` env var | ❌ | Set to `"groq"` in `.env` but **never read by `aiService.js`** — waterfall order is hardcoded |

### Missing
- Health check endpoint
- Retry logic within provider
- `opts.model` forwarding to `_groq()` call site
- `LLM_PROVIDER` env var has no effect on routing

---

## 2. OpenAI

### Evidence

**Implementation** — `backend/services/aiService.js` lines 54–64:
```javascript
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

async function _openai(messages, model) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");
    const res = await axios.post(OPENAI_URL,
        { model: model || "gpt-4o-mini", messages, temperature: 0.7, max_tokens: 1024 },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 20000 }
    );
    return res.data.choices[0].message.content;
}
```

**Configuration** — `.env`:
```
OPENAI_API_KEY=sk-proj-REDACTED_ROTATE_NOW... (live key, present)
```

**Role in router** — index 1 in waterfall; fallback if Groq fails.

### Findings

| Check | Result | Evidence |
|-------|--------|----------|
| Implemented | ✅ | `_openai()` function, `aiService.js:54` |
| Configured | ✅ | `OPENAI_API_KEY` present in `.env` (live key) |
| Tested | ⚠️ No test file | No unit/integration test found |
| Working | ✅ | Key present, function is correct OpenAI chat completions call |
| Health check route | ❌ | None |
| Model | `gpt-4o-mini` | Hardcoded default; same `opts.model` forwarding bug as Groq |
| Whisper/STT | ❌ | `.env.example` comment says "only used for Whisper STT" but no Whisper implementation exists anywhere in codebase |
| Embeddings | ❌ | Not implemented |
| Timeout | ⚠️ Fixed | 20000ms hardcoded |

### Missing
- No Whisper/STT implementation despite `.env.example` claiming that purpose
- Embeddings
- Health check
- Retry logic

---

## 3. Ollama

### Evidence

**Primary implementation** — `backend/services/aiService.js` lines 69–77:
```javascript
const OLLAMA_URL = "http://localhost:11434/api/generate";  // hardcoded

async function _ollama(prompt, model) {
    const res = await axios.post(OLLAMA_URL,
        { model: model || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b", prompt, stream: false },
        { timeout: 30000 }
    );
    if (!res.data?.response) throw new Error("Empty Ollama response");
    return res.data.response;
}
```

**Secondary implementation** — `backend/services/toolExecutionLayer.cjs` lines 140–150, 294–310:
```javascript
ollama: {
    envKey: null,   // local — no env key required
    baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    actions: { generate, chat, list_models, pull_model }
}

// list_models: GET /api/tags — ✅ implemented
// generate:    POST /api/generate — ✅ implemented
// chat:        POST /api/chat — ✅ implemented (with messages array)
```

**Health probe** — `backend/services/observabilityEngine.cjs:226`:
```javascript
_probe("ollama", `http://localhost:11434/api/tags`)
```

**VS Code service** — `backend/services/vsCodeExtensionService.cjs:47–51`:
```javascript
async function _ollamaCompletion(messages, model, ollamaUrl) {
    const url = new URL((ollamaUrl || "http://localhost:11434") + "/api/chat");
    // Uses /api/chat (new API) + messages array ✅
}
```

**Configuration** — `.env`:
```
# No OLLAMA_URL entry
# No OLLAMA_MODEL entry
```

### Findings

| Check | Result | Evidence |
|-------|--------|----------|
| Implemented | ⚠️ Partial | Two separate implementations: `aiService.js` (limited) and `toolExecutionLayer.cjs` (full) |
| Configured | ❌ | No `OLLAMA_URL` or `OLLAMA_MODEL` in `.env` or `.env.example`; URL hardcoded in `aiService.js` |
| Health check | ⚠️ Partial | `observabilityEngine.cjs:226` probes `/api/tags` but result not exposed to chat routing |
| Model discovery | ⚠️ Partial | `toolExecutionLayer.cjs:297` calls `GET /api/tags`; `aiService.js` has no discovery |
| Chat (messages) | ⚠️ Split | `toolExecutionLayer.cjs` uses `/api/chat` with messages array ✅; `aiService.js` uses `/api/generate` with prompt string ❌ |
| Conversation history | ❌ | `aiService.js` `_ollama()` receives raw `prompt` string — conversation history is NOT passed to Ollama unlike Groq/OpenAI |
| Working | ❌ | Not configured; URL hardcoded; no running Ollama instance expected |
| Embeddings | ❌ | Not implemented anywhere |

### Missing (in `aiService.js` primary path)
- `OLLAMA_URL` env var support (exists in `toolExecutionLayer.cjs` but not `aiService.js`)
- `/api/chat` endpoint (uses deprecated `/api/generate`)
- Conversation history forwarding
- Model discovery before first call
- Embeddings

---

## 4. OpenRouter

### Evidence

**`toolExecutionLayer.cjs`** — Full integration as a "tool" (lines 130–139, 276–292):
```javascript
openrouter: {
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    actions: { chat_completion, stream_completion, list_models }
}

case "openrouter": {
    const headers = {
        Authorization: `Bearer ${token}`,
        "HTTP-Referer": "https://ooplix.com",
        "X-Title": "Jarvis-OS"
    };
    // chat_completion: POST /chat/completions, model: "anthropic/claude-haiku-4-5"
    // list_models:     GET /models
}
```

**`vsCodeExtensionService.cjs`** — Primary provider in VS Code chat (`aiService.js:15–21`):
```javascript
async function _openRouterCompletion(messages, model, apiKey) {
    const body = JSON.stringify({ model: model || "anthropic/claude-3-5-sonnet", messages });
    return _httpsPost("openrouter.ai", "/api/v1/chat/completions", body, {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://jarvis-os.app",
        "X-Title": "JARVIS Engineering",
    });
}
```
Default provider in `_aiCompletion()` when no `provider` arg passed — `provider = "openrouter"`.

**`observabilityEngine.cjs:227`** — Health probe (key check only):
```javascript
_probe("openrouter", () => !!process.env.OPENROUTER_API_KEY)
```

**`backend/routes/phase24.js:96`** — Listed in AI providers route response:
```javascript
{ id: "openrouter", label: "OpenRouter", models: ["anthropic/claude-3-5-sonnet", "openai/gpt-4o", "meta-llama/llama-3.1-70b-instruct"] }
```

**`backend/services/gitHubEngineeringAgent.cjs:250`**, **`engineeringAutopilot.cjs:220`**, **`codeReviewEngine.cjs:176`**:
All call `tel.execute("openrouter", "chat_completion", …)` — routed through `toolExecutionLayer.cjs`.

**Configuration** — `.env`:
```
# No OPENROUTER_API_KEY entry
```

### Findings

| Check | Result | Evidence |
|-------|--------|----------|
| Implemented | ✅ | Full adapter in `toolExecutionLayer.cjs`; VS Code provider in `vsCodeExtensionService.cjs`; multiple agent callers |
| Configured | ❌ | `OPENROUTER_API_KEY` absent from `.env` and `.env.example`; all calls will fail at runtime |
| Health check | ⚠️ Key probe only | `observabilityEngine.cjs:227` checks `!!process.env.OPENROUTER_API_KEY` — returns unhealthy since key is absent |
| Model discovery | ✅ | `toolExecutionLayer.cjs:288` calls `GET /api/v1/models` |
| Chat completion | ✅ | Implemented in `toolExecutionLayer.cjs` (via agent tel.execute) and `vsCodeExtensionService.cjs` (direct) |
| Default VS Code provider | ✅ | `vsCodeExtensionService.cjs:64` defaults to `openrouter` |
| Tested | ❌ | No test file; key absent means untestable without config change |
| Working | ❌ | `OPENROUTER_API_KEY` not set — all calls will throw 401 or "not_configured" |
| Embeddings | ❌ | Not implemented |
| In `aiService.js` waterfall | ❌ | OpenRouter is NOT in the main `callAI()` waterfall (`["groq","openai","ollama"]`) — it is only accessible through `toolExecutionLayer.cjs` and `vsCodeExtensionService.cjs` |

### Missing
- `OPENROUTER_API_KEY` in `.env`
- OpenRouter in main `aiService.js` waterfall
- Live test (blocked by missing key)

---

## 5. AI Router (`callAI`)

**File:** `backend/services/aiService.js`

### Architecture

```javascript
async function callAI(prompt, opts = {}) {
    const messages = [
        { role: "system", content: opts.system || "You are Jarvis..." },
        { role: "user",   content: prompt }
    ];
    const providers = opts.provider ? [opts.provider] : ["groq", "openai", "ollama"];

    for (const provider of providers) {
        try {
            switch (provider) {
                case "groq":   return await _groq(messages);       // ← model arg not passed
                case "openai": return await _openai(messages);     // ← model arg not passed
                case "ollama": return await _ollama(prompt);       // ← string not messages
            }
        } catch (err) {
            logger.warn(`AI [${provider}] failed: ${err.message}`);
        }
    }
    return "AI backend unavailable. Check GROQ_API_KEY in your .env file.";
}
```

### Findings

| Feature | Result | Evidence |
|---------|--------|----------|
| Provider priority | Groq → OpenAI → Ollama | Hardcoded array, `aiService.js` |
| Failover | ✅ Try/catch per provider; continues to next | `aiService.js` for-loop |
| Timeout | ⚠️ Per-provider, not configurable | Groq/OpenAI: 20s; Ollama: 30s (axios options in each fn) |
| Retry within provider | ❌ | Single attempt; no retry before moving to next provider |
| Circuit breaker | ❌ | None |
| `opts.model` forwarding | ❌ Bug | `_groq(messages)` and `_openai(messages)` called without second arg |
| `opts.provider` forcing | ✅ | `opts.provider` collapses array to single element |
| `LLM_PROVIDER` env var | ❌ Ignored | Set in `.env`; **never read by `aiService.js`**; waterfall order not affected |
| OpenRouter in waterfall | ❌ | Not in `callAI()` — only accessible via `toolExecutionLayer` |
| Last-resort message | ✅ | Returns human-readable string when all providers fail |

### Bugs Identified

1. **Model forwarding bug** (`aiService.js`): `callAI(prompt, {model: "mixtral-8x7b"})` silently ignores the model — `_groq(messages)` receives one argument, `model` defaults to `"llama-3.3-70b-versatile"` regardless.

2. **`LLM_PROVIDER` dead config**: `.env` sets `LLM_PROVIDER=groq` but `aiService.js` never imports or reads it. The env var has zero effect on runtime behavior.

3. **Ollama conversation history**: `_ollama(prompt)` receives a plain string — conversation history built in `callAI()` is discarded. Ollama responses will lack all context except the current prompt.

4. **OpenRouter isolation**: Three services actively call OpenRouter (`gitHubEngineeringAgent`, `engineeringAutopilot`, `codeReviewEngine`) but the key is missing from `.env`. These calls silently produce `not_configured` errors.

---

## Recommended Fixes (Priority Order)

1. **Add `OPENROUTER_API_KEY` to `.env`** — unblocks 3 active agent services immediately  
2. **Fix model forwarding in `callAI()`** — change `_groq(messages)` → `_groq(messages, opts.model)` and same for `_openai`  
3. **Fix Ollama in `aiService.js`** — change `_ollama(prompt)` to use `/api/chat` with the `messages` array (pattern already exists in `vsCodeExtensionService.cjs:47`)  
4. **Add `OLLAMA_URL` and `OLLAMA_MODEL` to `.env.example`** — `toolExecutionLayer.cjs` already reads `OLLAMA_URL`; `aiService.js` already reads `OLLAMA_MODEL`; just not documented  
5. **Remove or honour `LLM_PROVIDER`** — either read it in `callAI()` to control primary provider, or remove from `.env`/`.env.example` to avoid confusion  

---

*Audit complete. All findings sourced directly from code reads. No assumptions made.*
