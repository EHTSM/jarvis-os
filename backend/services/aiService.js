"use strict";
/**
 * AI Service — multi-provider router with health-based failover.
 *
 * Provider order (default): LLM_PROVIDER env var → ["groq","openrouter","openai","claude","gemini","ollama","deepseek","together","fireworks","cohere","nvidia","lmstudio","grok","qwen"]
 * Each provider is attempted once per call; failures are logged and the next
 * provider is tried. The last failure reason per provider is retained for
 * the /ai/status endpoint.
 *
 * Retry: 1 retry within Groq and OpenRouter (network-class errors only).
 * Timeout: per-provider, configured via env vars.
 *
 * Track F / F4 — Multi-Model Intelligence additions:
 *   - Claude (Anthropic) provider via raw HTTP (no SDK)
 *   - Gemini (Google) provider via raw HTTP
 *   - routeByCapability(task, opts) — capability-based intelligent routing
 *   - chat(messages, opts)          — OpenAI-format convenience wrapper
 *   - getProviderStatus()           — snapshot health for all 6 providers
 *
 * Production Mission 3 — Phase A additions (all OpenAI-compatible REST):
 *   - DeepSeek   (api.deepseek.com/v1)        DEEPSEEK_API_KEY
 *   - Together AI (api.together.xyz/v1)        TOGETHER_API_KEY
 *   - Fireworks AI (api.fireworks.ai/v1)       FIREWORKS_API_KEY
 *   - Cohere     (api.cohere.ai/v1)            COHERE_API_KEY
 *   - NVIDIA NIM (integrate.api.nvidia.com/v1) NVIDIA_API_KEY
 *   - LM Studio  (localhost:1234 by default)   LM_STUDIO_URL
 *
 * AI Provider Orchestration mission additions (OpenAI-compatible REST):
 *   - Grok (x.ai)  (api.x.ai/v1)                              GROK_API_KEY
 *   - Qwen (Alibaba DashScope, compatible-mode endpoint)       DASHSCOPE_API_KEY
 *     International endpoint by default; set QWEN_REGION=cn for mainland China.
 */

const axios  = require("axios");
const net    = require("net");
const logger = require("../utils/logger");

// Local-only providers (Ollama, LM Studio) have no API key to fail-fast on,
// unlike every other provider here — so when the server isn't installed/
// running (the common case in production, where only cloud providers are
// configured), callAI()'s fallback loop was blocking for the full 30s HTTP
// timeout on each one before moving on. A raw TCP probe with a short timeout
// tells "nothing listening" from "listening but slow to respond" in well
// under a second, without touching the real request's timeout at all.
function _isPortOpen(host, port, timeoutMs = 800) {
    return new Promise(resolve => {
        const socket = net.connect({ host, port });
        const done = ok => { socket.destroy(); resolve(ok); };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error",   () => done(false));
    });
}
async function _assertLocalServerUp(url, label) {
    const { hostname, port, protocol } = new URL(url);
    const p = port ? parseInt(port, 10) : (protocol === "https:" ? 443 : 80);
    const up = await _isPortOpen(hostname, p);
    if (!up) throw new Error(`${label} not reachable at ${hostname}:${p} (not installed/running?)`);
}

/**
 * Public reachability probe for local providers (Ollama, LM Studio). Reuses
 * the exact TCP-probe logic _assertLocalServerUp already uses internally to
 * fail fast on unreachable local servers — exported so callers building a
 * provider ranking (aiOrchestrator.cjs) can check reachability BEFORE
 * ranking a local provider ahead of real, working cloud providers, instead
 * of finding out only after a wasted retry attempt.
 */
async function isLocalServerReachable(url) {
    try {
        const { hostname, port, protocol } = new URL(url);
        const p = port ? parseInt(port, 10) : (protocol === "https:" ? 443 : 80);
        return await _isPortOpen(hostname, p);
    } catch { return false; }
}

// ── Provider endpoints ────────────────────────────────────────────────────────
const GROQ_URL        = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL      = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL  = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL   = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VER   = "2023-06-01";
const DEEPSEEK_URL    = "https://api.deepseek.com/v1/chat/completions";
const TOGETHER_URL    = "https://api.together.xyz/v1/chat/completions";
const FIREWORKS_URL   = "https://api.fireworks.ai/inference/v1/chat/completions";
const COHERE_URL      = "https://api.cohere.ai/v1/chat";
const NVIDIA_URL      = "https://integrate.api.nvidia.com/v1/chat/completions";
const GROK_URL        = "https://api.x.ai/v1/chat/completions";
// DashScope's "compatible-mode" endpoint speaks the OpenAI chat/completions
// schema — same wire format as every other OpenAI-compatible adapter below.
// International vs China endpoint selectable via QWEN_REGION (defaults intl,
// since DASHSCOPE_API_KEY keys issued outside mainland China only work there).
function _qwenUrl() {
    const region = (process.env.QWEN_REGION || "intl").toLowerCase();
    return region === "cn"
        ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        : "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
}

function _ollamaUrl()    { return (process.env.OLLAMA_URL    || "http://localhost:11434") + "/api/chat"; }
function _lmStudioUrl()  { return (process.env.LM_STUDIO_URL || "http://localhost:1234")  + "/v1/chat/completions"; }
function _ollamaModel()  { return process.env.OLLAMA_MODEL   || "llama3.2"; }
function _lmStudioModel(){ return process.env.LM_STUDIO_MODEL || "local-model"; }
function _claudeModel()  { return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"; }
function _geminiModel()  { return process.env.GEMINI_MODEL   || "gemini-2.0-flash"; }
function _deepseekModel(){ return process.env.DEEPSEEK_MODEL  || "deepseek-chat"; }
function _togetherModel(){ return process.env.TOGETHER_MODEL  || "meta-llama/Llama-3-70b-chat-hf"; }
function _fireworksModel(){ return process.env.FIREWORKS_MODEL || "accounts/fireworks/models/llama-v3-70b-instruct"; }
function _cohereModel()  { return process.env.COHERE_MODEL    || "command-r-plus"; }
function _nvidiaModel()  { return process.env.NVIDIA_MODEL    || "meta/llama-3.1-70b-instruct"; }
function _grokModel()    { return process.env.GROK_MODEL      || "grok-2-latest"; }
function _qwenModel()    { return process.env.QWEN_MODEL      || "qwen-plus"; }
function _geminiUrl()    {
    const model  = _geminiModel();
    const apiKey = process.env.GEMINI_API_KEY || "";
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

// ── Runtime state (in-process, reset on restart) ─────────────────────────────
const _state = {
    activeProvider:   null,   // last provider that succeeded
    lastSuccess:      null,   // ISO timestamp of last successful call
    lastFailures:     {},     // { [provider]: { reason, ts } }
    callCount:        {},     // { [provider]: int } — per-provider call counter (F4)
    failCount:        0,
};
// Initialise per-provider call counters for all providers
["groq", "openrouter", "openai", "claude", "gemini", "ollama", "deepseek", "together", "fireworks", "cohere", "nvidia", "lmstudio", "grok", "qwen"].forEach(p => { _state.callCount[p] = 0; });

// ── System prompt ─────────────────────────────────────────────────────────────
let _cachedPrompt = null;
function _getSystemPrompt() {
    if (!_cachedPrompt) {
        const name    = process.env.PRODUCT_NAME    || "JARVIS AI";
        const price   = process.env.PRODUCT_PRICE   ? `$${process.env.PRODUCT_PRICE}` : null;
        const contact = process.env.OPERATOR_CONTACT || null;
        const desc    = process.env.PRODUCT_DESC     || null;
        let p = `You are ${name}, an AI automation assistant. `;
        if (desc)    p += `${desc} `;
        p += "Help users automate tasks, answer questions, and control their system. Be concise, accurate, and helpful. ";
        if (price)   p += `When asked about cost or pricing, the product costs ${price}. `;
        if (contact) p += `For support, direct users to: ${contact}. `;
        p += "When asked to execute a task, confirm it clearly.";
        _cachedPrompt = p;
    }
    return _cachedPrompt;
}

// ── Provider priority ─────────────────────────────────────────────────────────
// Respects LLM_PROVIDER env var as the primary; others follow in fixed order.
// Each key-based provider's credential env var. Local providers (ollama,
// lmstudio) are deliberately absent — they have no key and are already
// fail-fast guarded by _assertLocalServerUp() above.
const _PROVIDER_KEY_ENV = {
    groq:       "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    openai:     "OPENAI_API_KEY",
    claude:     "ANTHROPIC_API_KEY",
    gemini:     "GEMINI_API_KEY",
    deepseek:   "DEEPSEEK_API_KEY",
    together:   "TOGETHER_API_KEY",
    fireworks:  "FIREWORKS_API_KEY",
    cohere:     "COHERE_API_KEY",
    nvidia:     "NVIDIA_API_KEY",
    grok:       "GROK_API_KEY",
    qwen:       "DASHSCOPE_API_KEY",
};

/**
 * True when a provider is *statically* unusable — it needs an API key and no
 * key is configured. This is knowable without any network call.
 *
 * B.1 P1 measurement: with no keys configured, callAI() attempted all 14
 * providers on every request and each key-less one threw "X_API_KEY not set"
 * only after being entered. Measured on the running server, that produced
 * 8,358 WARN lines out of 13,541 total log lines — 62% of all backend logging
 * was the same statically-knowable failure repeated, with ten providers
 * failing 592 times each. The autonomous AutoLoop drives this continuously,
 * so it burned CPU in bursts (measured 80-100% during every stall) on work
 * that could never succeed.
 *
 * NOTE ON HONESTY: this skips only providers with NO key configured. A
 * provider that HAS a key and fails authentication or rate limits (the
 * measured OpenAI 401 and Groq 429) is still attempted and still reported
 * exactly as before — real credential failures must never be hidden.
 */
function _isUnconfigured(provider) {
    const env = _PROVIDER_KEY_ENV[provider];
    if (!env) return false;                       // local provider — not key-gated
    return !String(process.env[env] || "").trim();
}

function _providerOrder() {
    const preferred = (process.env.LLM_PROVIDER || "").toLowerCase().trim();
    const defaults  = ["groq", "openrouter", "openai", "claude", "gemini", "ollama", "deepseek", "together", "fireworks", "cohere", "nvidia", "lmstudio", "grok", "qwen"];
    const ordered = (!preferred || !defaults.includes(preferred))
        ? defaults
        : [preferred, ...defaults.filter(p => p !== preferred)];

    const usable = ordered.filter(p => !_isUnconfigured(p));
    // Never return an empty list: callAI() must still run, still fail, and
    // still return its real "AI backend unavailable" sentinel. Skipping every
    // provider silently would turn a reported failure into a silent one.
    // In practice the local providers are never key-gated, so this list is
    // non-empty even with zero API keys configured — they are attempted and
    // fail loudly via _assertLocalServerUp(). The guard stays as a correctness
    // backstop in case the provider list ever becomes fully key-gated.
    return usable.length ? usable : ordered;
}

// ── Per-provider timeout (ms) ─────────────────────────────────────────────────
const TIMEOUTS = {
    groq:       parseInt(process.env.GROQ_TIMEOUT       || "20000", 10),
    openrouter: parseInt(process.env.OPENROUTER_TIMEOUT || "25000", 10),
    openai:     parseInt(process.env.OPENAI_TIMEOUT     || "20000", 10),
    ollama:     parseInt(process.env.OLLAMA_TIMEOUT     || "30000", 10),
    claude:     parseInt(process.env.ANTHROPIC_TIMEOUT  || "30000", 10),
    gemini:     parseInt(process.env.GEMINI_TIMEOUT     || "25000", 10),
    deepseek:   parseInt(process.env.DEEPSEEK_TIMEOUT   || "25000", 10),
    together:   parseInt(process.env.TOGETHER_TIMEOUT   || "25000", 10),
    fireworks:  parseInt(process.env.FIREWORKS_TIMEOUT  || "25000", 10),
    cohere:     parseInt(process.env.COHERE_TIMEOUT     || "25000", 10),
    nvidia:     parseInt(process.env.NVIDIA_TIMEOUT     || "30000", 10),
    lmstudio:   parseInt(process.env.LM_STUDIO_TIMEOUT  || "30000", 10),
    grok:       parseInt(process.env.GROK_TIMEOUT       || "25000", 10),
    qwen:       parseInt(process.env.QWEN_TIMEOUT       || "25000", 10),
};

// ── Retry helper (network-class errors only, 1 retry) ────────────────────────
function _isRetryable(err) {
    if (!err) return false;
    const code = err.code || "";
    const status = err.response?.status;
    // Retry on connection errors and 429 (rate-limit). Do NOT retry 4xx auth errors.
    return ["ECONNRESET","ECONNREFUSED","ETIMEDOUT","ENOTFOUND"].includes(code)
        || status === 429
        || status === 503;
}

async function _withRetry(fn) {
    try { return await fn(); }
    catch (err) {
        if (!_isRetryable(err)) throw err;
        await new Promise(r => setTimeout(r, 800));
        return fn();
    }
}

// ── Provider adapters ─────────────────────────────────────────────────────────

async function _groq(messages, model, opts = {}) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            GROQ_URL,
            { model: model || "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.groq }
        );
        return res.data.choices[0].message.content;
    });
}

async function _openrouter(messages, model, opts = {}) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            OPENROUTER_URL,
            { model: model || "anthropic/claude-haiku-4-5", messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            {
                headers: {
                    Authorization:  `Bearer ${key}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": process.env.APP_URL || "https://jarvis-os.app",
                    "X-Title":      process.env.PRODUCT_NAME || "JARVIS OS",
                },
                timeout: TIMEOUTS.openrouter,
            }
        );
        return res.data.choices[0].message.content;
    });
}

async function _openai(messages, model, opts = {}) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            OPENAI_URL,
            { model: model || "gpt-4o-mini", messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.openai }
        );
        return res.data.choices[0].message.content;
    });
}

async function _ollama(messages, model, opts = {}) {
    const url = _ollamaUrl();
    await _assertLocalServerUp(url, "Ollama");
    const res = await axios.post(
        url,
        { model: model || _ollamaModel(), messages, stream: false, options: { num_predict: opts.maxTokens || 1024 } },
        { timeout: TIMEOUTS.ollama }
    );
    const content = res.data?.message?.content;
    if (!content) throw new Error("Empty Ollama response");
    return content;
}

// ── Claude (Anthropic) adapter — raw HTTP, no SDK ────────────────────────────
async function _claude(messages, model, opts = {}) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY not set");

    // Extract system prompt (first message with role "system")
    const systemMsg = messages.find(m => m.role === "system");
    const userMsgs  = messages.filter(m => m.role !== "system");

    const body = {
        model:      model || _claudeModel(),
        max_tokens: opts.maxTokens || 1024,
        messages:   userMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;

    const res = await axios.post(ANTHROPIC_URL, body, {
        headers: {
            "x-api-key":         key,
            "anthropic-version": ANTHROPIC_VER,
            "Content-Type":      "application/json",
        },
        timeout: TIMEOUTS.claude,
    });
    const text = res.data?.content?.[0]?.text;
    if (!text) throw new Error("Empty Claude response");
    return text;
}

// ── Gemini (Google) adapter — raw HTTP ───────────────────────────────────────
async function _gemini(messages, model, opts = {}) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");

    // Flatten all messages into a single prompt (Gemini single-turn for simplicity)
    const systemMsg = messages.find(m => m.role === "system");
    const userMsgs  = messages.filter(m => m.role !== "system");
    const systemPart = systemMsg ? systemMsg.content + "\n\n" : "";
    const fullPrompt = systemPart + userMsgs.map(m => m.content).join("\n");

    // Build URL with the override model if supplied
    const chosenModel = model || _geminiModel();
    const apiKey      = key;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${apiKey}`;

    const res = await axios.post(
        url,
        { contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { maxOutputTokens: opts.maxTokens || 1024 } },
        { headers: { "Content-Type": "application/json" }, timeout: TIMEOUTS.gemini }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    return text;
}

// ── DeepSeek adapter (OpenAI-compatible) ─────────────────────────────────────
async function _deepseek(messages, model, opts = {}) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            DEEPSEEK_URL,
            { model: model || _deepseekModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.deepseek }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Together AI adapter (OpenAI-compatible) ───────────────────────────────────
async function _together(messages, model, opts = {}) {
    const key = process.env.TOGETHER_API_KEY;
    if (!key) throw new Error("TOGETHER_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            TOGETHER_URL,
            { model: model || _togetherModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.together }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Fireworks AI adapter (OpenAI-compatible) ──────────────────────────────────
async function _fireworks(messages, model, opts = {}) {
    const key = process.env.FIREWORKS_API_KEY;
    if (!key) throw new Error("FIREWORKS_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            FIREWORKS_URL,
            { model: model || _fireworksModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.fireworks }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Cohere adapter ─────────────────────────────────────────────────────────────
// Cohere Chat v1 accepts OpenAI-style message arrays.
async function _cohere(messages, model, opts = {}) {
    const key = process.env.COHERE_API_KEY;
    if (!key) throw new Error("COHERE_API_KEY not set");
    return _withRetry(async () => {
        // Map OpenAI roles to Cohere roles (system → SYSTEM, user → USER, assistant → CHATBOT)
        const cohereMessages = messages.map(m => ({
            role:    m.role === "assistant" ? "CHATBOT" : m.role.toUpperCase(),
            message: m.content,
        }));
        const lastUser = [...cohereMessages].reverse().find(m => m.role === "USER");
        const chatHistory = cohereMessages.filter(m => m !== lastUser);

        const res = await axios.post(
            COHERE_URL,
            { model: model || _cohereModel(), message: lastUser?.message || "", chat_history: chatHistory, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, timeout: TIMEOUTS.cohere }
        );
        const text = res.data?.text || res.data?.message?.content?.[0]?.text;
        if (!text) throw new Error("Empty Cohere response");
        return text;
    });
}

// ── NVIDIA NIM adapter (OpenAI-compatible) ────────────────────────────────────
async function _nvidia(messages, model, opts = {}) {
    const key = process.env.NVIDIA_API_KEY;
    if (!key) throw new Error("NVIDIA_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            NVIDIA_URL,
            { model: model || _nvidiaModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.nvidia }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Grok (x.ai) adapter (OpenAI-compatible) ──────────────────────────────────
async function _grok(messages, model, opts = {}) {
    const key = process.env.GROK_API_KEY;
    if (!key) throw new Error("GROK_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            GROK_URL,
            { model: model || _grokModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.grok }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Qwen (Alibaba DashScope) adapter (OpenAI-compatible) ─────────────────────
async function _qwen(messages, model, opts = {}) {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            _qwenUrl(),
            { model: model || _qwenModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.qwen }
        );
        return res.data.choices[0].message.content;
    });
}

// ── LM Studio adapter (OpenAI-compatible, local) ─────────────────────────────
async function _lmstudio(messages, model, opts = {}) {
    const url = _lmStudioUrl();
    await _assertLocalServerUp(url, "LM Studio");
    const res = await axios.post(
        url,
        { model: model || _lmStudioModel(), messages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 },
        { headers: { "Content-Type": "application/json" }, timeout: TIMEOUTS.lmstudio }
    );
    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty LM Studio response");
    return content;
}

// ── Health check ──────────────────────────────────────────────────────────────
async function _healthCheck(provider) {
    try {
        switch (provider) {
            case "groq":
                if (!process.env.GROQ_API_KEY) return { ok: false, reason: "GROQ_API_KEY not set" };
                // Lightweight model list — confirms key is valid without spending tokens
                await axios.get("https://api.groq.com/openai/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "openrouter":
                if (!process.env.OPENROUTER_API_KEY) return { ok: false, reason: "OPENROUTER_API_KEY not set" };
                await axios.get("https://openrouter.ai/api/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "openai":
                if (!process.env.OPENAI_API_KEY) return { ok: false, reason: "OPENAI_API_KEY not set" };
                await axios.get("https://api.openai.com/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "ollama": {
                const base = process.env.OLLAMA_URL || "http://localhost:11434";
                await axios.get(`${base}/api/tags`, { timeout: 3000 });
                return { ok: true };
            }
            case "claude": {
                if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "ANTHROPIC_API_KEY not set" };
                // Minimal probe: send a tiny message and expect a 200
                await axios.post(
                    ANTHROPIC_URL,
                    { model: _claudeModel(), max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
                    {
                        headers: {
                            "x-api-key":         process.env.ANTHROPIC_API_KEY,
                            "anthropic-version": ANTHROPIC_VER,
                            "Content-Type":      "application/json",
                        },
                        timeout: 6000,
                    }
                );
                return { ok: true };
            }
            case "gemini": {
                if (!process.env.GEMINI_API_KEY) return { ok: false, reason: "GEMINI_API_KEY not set" };
                const probeModel = _geminiModel();
                const probeUrl   = `https://generativelanguage.googleapis.com/v1beta/models/${probeModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;
                await axios.post(
                    probeUrl,
                    { contents: [{ parts: [{ text: "hi" }] }] },
                    { headers: { "Content-Type": "application/json" }, timeout: 6000 }
                );
                return { ok: true };
            }
            case "deepseek":
                if (!process.env.DEEPSEEK_API_KEY) return { ok: false, reason: "DEEPSEEK_API_KEY not set" };
                await axios.get("https://api.deepseek.com/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "together":
                if (!process.env.TOGETHER_API_KEY) return { ok: false, reason: "TOGETHER_API_KEY not set" };
                await axios.get("https://api.together.xyz/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.TOGETHER_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "fireworks":
                if (!process.env.FIREWORKS_API_KEY) return { ok: false, reason: "FIREWORKS_API_KEY not set" };
                await axios.get("https://api.fireworks.ai/inference/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "cohere":
                if (!process.env.COHERE_API_KEY) return { ok: false, reason: "COHERE_API_KEY not set" };
                await axios.get("https://api.cohere.ai/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.COHERE_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "nvidia":
                if (!process.env.NVIDIA_API_KEY) return { ok: false, reason: "NVIDIA_API_KEY not set" };
                await axios.get("https://integrate.api.nvidia.com/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "grok":
                if (!process.env.GROK_API_KEY) return { ok: false, reason: "GROK_API_KEY not set" };
                await axios.get("https://api.x.ai/v1/models",
                    { headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}` }, timeout: 5000 });
                return { ok: true };
            case "qwen":
                if (!process.env.DASHSCOPE_API_KEY) return { ok: false, reason: "DASHSCOPE_API_KEY not set" };
                // DashScope's compatible-mode endpoint doesn't expose GET /models the
                // same way OpenAI does — probe with a minimal real chat completion
                // instead (1 max_token, cheapest reasonable liveness check).
                await axios.post(
                    _qwenUrl(),
                    { model: _qwenModel(), messages: [{ role: "user", content: "hi" }], max_tokens: 1 },
                    { headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, "Content-Type": "application/json" }, timeout: 6000 }
                );
                return { ok: true };
            case "lmstudio": {
                const lmBase = process.env.LM_STUDIO_URL || "http://localhost:1234";
                await axios.get(`${lmBase}/v1/models`, { timeout: 3000 });
                return { ok: true };
            }
            default:
                return { ok: false, reason: "unknown provider" };
        }
    } catch (err) {
        const reason = err.response
            ? `HTTP ${err.response.status}`
            : err.message;
        return { ok: false, reason };
    }
}

// ── Main call ─────────────────────────────────────────────────────────────────
/**
 * @param {string}  prompt
 * @param {object}  opts
 * @param {string}  [opts.system]    override system prompt
 * @param {Array}   [opts.history]   prior messages [{role,content}]
 * @param {string}  [opts.provider]  force a specific provider
 * @param {string}  [opts.model]     override model for chosen provider
 */
// OOPLIX V1 MASTER AUDIT (2026-08-16, A-to-Z backend coverage audit):
// callAI() tries up to 14 providers sequentially, each with its own 20-30s
// individual timeout (see TIMEOUTS above) — a worst case of several minutes
// cumulative, even though callers like agents/autonomousLoop.cjs wrap the
// whole call in a single 30s _withTimeout() and treat that as a hard
// ceiling. Confirmed live in this session's own real logs: tasks reporting
// "ERROR ... (5304216ms)" — 5.3 minutes — for a single AI call, because the
// outer timeout only stops the CALLER from waiting, it does not cancel the
// still-running sequential fallback chain underneath (no AbortController
// exists anywhere in this call path — threading one through all 14 provider
// helper functions would be a real architecture change, out of scope for
// this pass). This overall deadline is the safe, minimal fix available
// without that larger change: once the cumulative time already spent
// trying providers would leave no reasonable time for the outer caller's
// own ceiling, stop trying further providers and return the same honest
// "AI backend unavailable" sentinel immediately, rather than continuing to
// burn time nothing is still waiting for.
const CALL_AI_OVERALL_BUDGET_MS = 28_000; // stays under autonomousLoop.cjs's 30s TASK_TIMEOUT_MS

async function callAI(prompt, opts = {}) {
    const systemMsg = { role: "system", content: opts.system || _getSystemPrompt() };
    const history   = Array.isArray(opts.history) ? opts.history : [];
    const messages  = [systemMsg, ...history, { role: "user", content: prompt }];
    const model     = opts.model || null;

    const providers = opts.provider ? [opts.provider] : _providerOrder();
    const _callStart = Date.now();

    for (const provider of providers) {
        if (Date.now() - _callStart >= CALL_AI_OVERALL_BUDGET_MS) {
            logger.warn(`AI: overall budget (${CALL_AI_OVERALL_BUDGET_MS}ms) exhausted — stopping before trying "${provider}"`);
            break;
        }
        try {
            let reply;
            switch (provider) {
                case "groq":       reply = await _groq(messages, model, opts);         break;
                case "openrouter": reply = await _openrouter(messages, model, opts);   break;
                case "openai":     reply = await _openai(messages, model, opts);       break;
                case "ollama":     reply = await _ollama(messages, model, opts);       break;
                case "claude":     reply = await _claude(messages, model, opts);      break;
                case "gemini":     reply = await _gemini(messages, model, opts);      break;
                case "deepseek":   reply = await _deepseek(messages, model, opts);     break;
                case "together":   reply = await _together(messages, model, opts);     break;
                case "fireworks":  reply = await _fireworks(messages, model, opts);    break;
                case "cohere":     reply = await _cohere(messages, model, opts);       break;
                case "nvidia":     reply = await _nvidia(messages, model, opts);       break;
                case "lmstudio":   reply = await _lmstudio(messages, model, opts);    break;
                case "grok":       reply = await _grok(messages, model, opts);        break;
                case "qwen":       reply = await _qwen(messages, model, opts);        break;
                default:
                    logger.warn(`AI: unknown provider "${provider}", skipping`);
                    continue;
            }
            if (_state.callCount[provider] !== undefined) _state.callCount[provider]++;
            _state.activeProvider = provider;
            _state.lastSuccess    = new Date().toISOString();
            return reply;
        } catch (err) {
            _state.failCount++;
            _state.lastFailures[provider] = { reason: err.message, ts: new Date().toISOString() };
            logger.warn(`AI [${provider}] failed: ${err.message}`);
        }
    }

    return "AI backend unavailable. Check provider API keys in your .env file.";
}

/**
 * Detect intent using AI (for ambiguous inputs).
 */
async function detectIntentWithAI(input) {
    const prompt =
        `Classify the intent of this user input into ONE of these categories:\n` +
        `open_app | web_search | open_url | payment | crm | greeting | time | date | automation | intelligence\n\n` +
        `Input: "${input}"\n\nRespond with ONLY the category name, nothing else.`;
    try {
        const reply = await callAI(prompt, { system: "You are an intent classifier. Reply with only the category name." });
        return reply.trim().toLowerCase().replace(/[^a-z_]/g, "");
    } catch {
        return "intelligence";
    }
}

/**
 * Returns runtime status for /ai/status endpoint.
 */
async function getAIStatus() {
    const order = _providerOrder();
    const configured = {
        groq:       !!process.env.GROQ_API_KEY,
        openrouter: !!process.env.OPENROUTER_API_KEY,
        openai:     !!process.env.OPENAI_API_KEY,
        ollama:     true,   // local — no key required
        claude:     !!process.env.ANTHROPIC_API_KEY,
        gemini:     !!process.env.GEMINI_API_KEY,
        deepseek:   !!process.env.DEEPSEEK_API_KEY,
        together:   !!process.env.TOGETHER_API_KEY,
        fireworks:  !!process.env.FIREWORKS_API_KEY,
        cohere:     !!process.env.COHERE_API_KEY,
        nvidia:     !!process.env.NVIDIA_API_KEY,
        lmstudio:   true,   // local — no key required
        grok:       !!process.env.GROK_API_KEY,
        qwen:       !!process.env.DASHSCOPE_API_KEY,
    };

    // Run health probes in parallel, with 6s cap so /ai/status stays fast
    const probes = await Promise.allSettled(
        order.map(p => Promise.race([
            _healthCheck(p),
            new Promise(r => setTimeout(() => r({ ok: false, reason: "probe timeout" }), 6000)),
        ]))
    );

    const providers = order.map((p, i) => ({
        id:           p,
        configured:   configured[p] ?? false,
        health:       probes[i].status === "fulfilled" ? probes[i].value : { ok: false, reason: "probe error" },
        lastFailure:  _state.lastFailures[p] || null,
        timeout:      TIMEOUTS[p],
        callCount:    _state.callCount[p] ?? 0,
    }));

    return {
        activeProvider:  _state.activeProvider,
        preferredOrder:  order,
        lastSuccess:     _state.lastSuccess,
        callCount:       _state.callCount,
        failCount:       _state.failCount,
        providers,
    };
}

// ── F4: Capability-based intelligent routing ──────────────────────────────────
/**
 * Returns the best available provider for a given task type.
 *
 * @param {"reasoning"|"coding"|"fast"|"cheap"|"creative"|"analysis"} task
 * @param {object} [opts]  reserved for future options
 * @returns {{ provider: string, reason: string }}  never throws
 */
function routeByCapability(task, opts = {}) {
    const ROUTING = {
        reasoning: ["claude", "openai",    "deepseek",  "nvidia",    "groq",      "openrouter"],
        coding:    ["openai", "deepseek",  "fireworks", "groq",      "claude",    "openrouter"],
        fast:      ["groq",  "gemini",     "deepseek",  "together",  "openrouter","claude"],
        cheap:     ["ollama","lmstudio",   "groq",      "together",  "gemini",    "openrouter"],
        creative:  ["claude","openrouter", "gemini",    "openai",    "cohere",    "fireworks"],
        analysis:  ["claude","gemini",     "nvidia",    "openai",    "cohere",    "openrouter"],
    };

    // Determine whether a provider has its required key configured
    function _hasKey(p) {
        switch (p) {
            case "groq":       return !!process.env.GROQ_API_KEY;
            case "openrouter": return !!process.env.OPENROUTER_API_KEY;
            case "openai":     return !!process.env.OPENAI_API_KEY;
            case "claude":     return !!process.env.ANTHROPIC_API_KEY;
            case "gemini":     return !!process.env.GEMINI_API_KEY;
            case "ollama":     return true;  // local, no key needed
            default:           return false;
        }
    }

    const preferred = ROUTING[task] || ROUTING.fast;

    for (const p of preferred) {
        if (_hasKey(p)) {
            return { provider: p, reason: `best for "${task}"` };
        }
    }

    // Last-resort: any provider with a key
    const all = ["groq", "openrouter", "openai", "claude", "gemini", "ollama"];
    for (const p of all) {
        if (_hasKey(p)) {
            return { provider: p, reason: `fallback — no "${task}"-optimised provider available` };
        }
    }

    return { provider: "groq", reason: "no provider keys found — defaulting to groq" };
}

// ── F4: chat() — OpenAI-format convenience wrapper ───────────────────────────
/**
 * Send a messages array (OpenAI format) and get a unified response.
 *
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opts]
 * @param {string} [opts.provider]   force a specific provider
 * @param {string} [opts.task]       use routeByCapability to pick provider
 * @param {number} [opts.maxTokens]  passed to adapters that support it
 * @param {number} [opts.temperature]
 * @param {string} [opts.model]      override model
 * @returns {Promise<{text:string, provider:string, model:string, latencyMs:number}>}
 */
async function chat(messages, opts = {}) {
    let chosenProvider;

    if (opts.provider) {
        chosenProvider = opts.provider;
    } else if (opts.task) {
        const routed = routeByCapability(opts.task, opts);
        chosenProvider = routed.provider;
        logger.info(`AI chat routed to "${chosenProvider}" for task "${opts.task}"`);
    } else {
        chosenProvider = null;   // let callAI use normal failover order
    }

    const model = opts.model || null;
    const t0    = Date.now();

    // Rebuild the opts to pass maxTokens through to adapters
    const adapterOpts = { maxTokens: opts.maxTokens, temperature: opts.temperature };

    // Extract system + user messages to feed into callAI-style logic
    const systemMsg = messages.find(m => m.role === "system");
    const rest      = messages.filter(m => m.role !== "system");

    const providers = chosenProvider ? [chosenProvider] : _providerOrder();

    // Same overall-deadline fix as callAI() above, and for the same
    // reason: a sequential fallback across up to 14 providers, each with
    // its own 20-30s individual timeout, can legitimately run for minutes
    // even though callers wrap this whole function in a much shorter
    // single-call timeout.
    for (const p of providers) {
        if (Date.now() - t0 >= CALL_AI_OVERALL_BUDGET_MS) {
            logger.warn(`AI chat: overall budget (${CALL_AI_OVERALL_BUDGET_MS}ms) exhausted — stopping before trying "${p}"`);
            break;
        }
        try {
            let text;
            const allMessages = systemMsg ? [systemMsg, ...rest] : rest;
            switch (p) {
                case "groq":       text = await _groq(allMessages, model, adapterOpts);       break;
                case "openrouter": text = await _openrouter(allMessages, model, adapterOpts); break;
                case "openai":     text = await _openai(allMessages, model, adapterOpts);     break;
                case "ollama":     text = await _ollama(allMessages, model, adapterOpts);     break;
                case "claude":     text = await _claude(allMessages, model, adapterOpts); break;
                case "gemini":     text = await _gemini(allMessages, model, adapterOpts); break;
                case "deepseek":   text = await _deepseek(allMessages, model, adapterOpts);   break;
                case "together":   text = await _together(allMessages, model, adapterOpts);   break;
                case "fireworks":  text = await _fireworks(allMessages, model, adapterOpts);  break;
                case "cohere":     text = await _cohere(allMessages, model, adapterOpts);     break;
                case "nvidia":     text = await _nvidia(allMessages, model, adapterOpts);     break;
                case "lmstudio":   text = await _lmstudio(allMessages, model, adapterOpts);  break;
                case "grok":       text = await _grok(allMessages, model, adapterOpts);      break;
                case "qwen":       text = await _qwen(allMessages, model, adapterOpts);      break;
                default:
                    continue;
            }
            if (_state.callCount[p] !== undefined) _state.callCount[p]++;
            _state.activeProvider = p;
            _state.lastSuccess    = new Date().toISOString();
            return {
                text,
                provider:  p,
                model:     model || _defaultModel(p),
                latencyMs: Date.now() - t0,
            };
        } catch (err) {
            _state.failCount++;
            _state.lastFailures[p] = { reason: err.message, ts: new Date().toISOString() };
            logger.warn(`AI chat [${p}] failed: ${err.message}`);
        }
    }

    throw new Error("All AI providers failed — check your API keys.");
}

/** Helper: return the default model string for a provider (for metadata only). */
function _defaultModel(provider) {
    switch (provider) {
        case "groq":       return process.env.GROQ_MODEL       || "llama-3.3-70b-versatile";
        case "openrouter": return process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4-5";
        case "openai":     return process.env.OPENAI_MODEL     || "gpt-4o-mini";
        case "ollama":     return _ollamaModel();
        case "claude":     return _claudeModel();
        case "gemini":     return _geminiModel();
        case "deepseek":   return _deepseekModel();
        case "together":   return _togetherModel();
        case "fireworks":  return _fireworksModel();
        case "cohere":     return _cohereModel();
        case "nvidia":     return _nvidiaModel();
        case "lmstudio":   return _lmStudioModel();
        case "grok":       return _grokModel();
        case "qwen":       return _qwenModel();
        default:           return "unknown";
    }
}

// ── F4: getProviderStatus() — snapshot health for all 6 providers ─────────────
/**
 * Returns a lightweight (non-probing) snapshot of each provider's status.
 * Does NOT make network calls — use getAIStatus() for live health probes.
 *
 * @returns {{ [provider]: { available: boolean, hasKey: boolean, lastFailure: string|null, callCount: number } }}
 */
function getProviderStatus() {
    const ALL = ["groq", "openrouter", "openai", "ollama", "claude", "gemini", "deepseek", "together", "fireworks", "cohere", "nvidia", "lmstudio", "grok", "qwen"];
    const result = {};

    for (const p of ALL) {
        const hasKey = (() => {
            switch (p) {
                case "groq":       return !!process.env.GROQ_API_KEY;
                case "openrouter": return !!process.env.OPENROUTER_API_KEY;
                case "openai":     return !!process.env.OPENAI_API_KEY;
                case "ollama":     return true;
                case "claude":     return !!process.env.ANTHROPIC_API_KEY;
                case "gemini":     return !!process.env.GEMINI_API_KEY;
                case "deepseek":   return !!process.env.DEEPSEEK_API_KEY;
                case "together":   return !!process.env.TOGETHER_API_KEY;
                case "fireworks":  return !!process.env.FIREWORKS_API_KEY;
                case "cohere":     return !!process.env.COHERE_API_KEY;
                case "nvidia":     return !!process.env.NVIDIA_API_KEY;
                case "lmstudio":   return true;   // local, no key needed
                case "grok":       return !!process.env.GROK_API_KEY;
                case "qwen":       return !!process.env.DASHSCOPE_API_KEY;
                default:           return false;
            }
        })();

        const lastFailureEntry = _state.lastFailures[p];
        result[p] = {
            available:   hasKey && !lastFailureEntry,   // optimistic if key set and no recorded failure
            hasKey,
            lastFailure: lastFailureEntry ? `${lastFailureEntry.reason} (${lastFailureEntry.ts})` : null,
            callCount:   _state.callCount[p] ?? 0,
        };
    }

    return result;
}

// ── Tool-calling bridge (additive — does not change callAI/chat behavior) ────
// Native function/tool-calling for the 4 providers with a real tools API.
// Returns a unified shape: { text, toolCalls: [{id,name,arguments}], provider, model }.
// toolCalls is [] when the model responded with plain text instead of a call.

async function _openaiCompatWithTools(url, key, messages, tools, model, defaultModel, timeout, opts = {}) {
    if (!key) throw new Error("API key not set");
    const res = await axios.post(
        url,
        {
            model: model || defaultModel,
            messages,
            tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: opts.maxTokens || 1024,
        },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout }
    );
    const msg = res.data?.choices?.[0]?.message;
    if (!msg) throw new Error("Empty response");
    const toolCalls = (msg.tool_calls || []).map(tc => ({
        id: tc.id, name: tc.function?.name, arguments: _safeJsonParse(tc.function?.arguments),
    }));
    return { text: msg.content || "", toolCalls };
}

async function _claudeWithTools(messages, tools, model, opts = {}) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY not set");

    const systemMsg = messages.find(m => m.role === "system");
    const userMsgs  = messages.filter(m => m.role !== "system");

    const body = {
        model:      model || _claudeModel(),
        max_tokens: opts.maxTokens || 1024,
        messages:   userMsgs.map(m => ({ role: m.role, content: m.content })),
        tools:      tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    };
    if (systemMsg) body.system = systemMsg.content;

    const res = await axios.post(ANTHROPIC_URL, body, {
        headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VER, "Content-Type": "application/json" },
        timeout: TIMEOUTS.claude,
    });
    const blocks = res.data?.content || [];
    const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
    const toolCalls = blocks.filter(b => b.type === "tool_use").map(b => ({ id: b.id, name: b.name, arguments: b.input || {} }));
    if (!text && !toolCalls.length) throw new Error("Empty Claude response");
    return { text, toolCalls };
}

async function _geminiWithTools(messages, tools, model, opts = {}) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");

    const systemMsg  = messages.find(m => m.role === "system");
    const userMsgs   = messages.filter(m => m.role !== "system");
    const chosenModel = model || _geminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${key}`;

    const body = {
        contents: userMsgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        tools: [{ function_declarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
    };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

    const res = await axios.post(url, body, { headers: { "Content-Type": "application/json" }, timeout: TIMEOUTS.gemini });
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter(p => p.text).map(p => p.text).join("");
    const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
        id: `gemini_call_${i}`, name: p.functionCall.name, arguments: p.functionCall.args || {},
    }));
    if (!text && !toolCalls.length) throw new Error("Empty Gemini response");
    return { text, toolCalls };
}

function _safeJsonParse(str) {
    try { return JSON.parse(str || "{}"); } catch { return {}; }
}

/**
 * chatWithTools(messages, tools, opts) — like chat(), but supports native
 * tool/function-calling. Only providers with a real tools API are attempted:
 * openai, openrouter (OpenAI-compatible), claude, gemini.
 *
 * @param {Array<{role,content}>} messages
 * @param {Array<{name,description,parameters}>} tools  JSON-schema-style tool defs
 * @param {object} [opts]  same as chat() — provider, model, maxTokens, temperature
 * @returns {Promise<{text:string, toolCalls:Array, provider:string, model:string}>}
 */
async function chatWithTools(messages, tools = [], opts = {}) {
    if (!Array.isArray(tools) || !tools.length) {
        const result = await chat(messages, opts);
        return { ...result, toolCalls: [] };
    }

    const TOOL_CAPABLE = ["claude", "openai", "openrouter", "gemini"];
    const providers = opts.provider ? [opts.provider] : TOOL_CAPABLE.filter(p => _providerOrder().includes(p));
    const model = opts.model || null;

    for (const p of providers) {
        if (!TOOL_CAPABLE.includes(p)) continue;
        try {
            let result;
            switch (p) {
                case "openai":
                    result = await _openaiCompatWithTools(OPENAI_URL, process.env.OPENAI_API_KEY, messages, tools, model, "gpt-4o-mini", TIMEOUTS.openai, opts);
                    break;
                case "openrouter":
                    result = await _openaiCompatWithTools(OPENROUTER_URL, process.env.OPENROUTER_API_KEY, messages, tools, model, "anthropic/claude-haiku-4-5", TIMEOUTS.openrouter, opts);
                    break;
                case "claude":
                    result = await _claudeWithTools(messages, tools, model, opts);
                    break;
                case "gemini":
                    result = await _geminiWithTools(messages, tools, model, opts);
                    break;
                default:
                    continue;
            }
            if (_state.callCount[p] !== undefined) _state.callCount[p]++;
            _state.activeProvider = p;
            _state.lastSuccess    = new Date().toISOString();
            return { ...result, provider: p, model: model || _defaultModel(p) };
        } catch (err) {
            _state.failCount++;
            _state.lastFailures[p] = { reason: err.message, ts: new Date().toISOString() };
            logger.warn(`AI chatWithTools [${p}] failed: ${err.message}`);
        }
    }

    throw new Error("No tool-capable AI provider succeeded — check API keys for openai/openrouter/claude/gemini.");
}

// ── Streaming (SSE passthrough) ──────────────────────────────────────────────
// aiRegistry.cjs already carried a `streamable: true/false` capability flag
// per provider, but nothing in this file (or anywhere else) ever read it or
// requested a streamed response — Ollama's adapter explicitly passed
// `stream: false`, and every other adapter used the default non-streaming
// response shape. STREAM_CAPABLE below reflects only providers verified here
// to genuinely support it via a real streaming API (not aiRegistry's
// per-capability flag, which is broader/aspirational metadata).
const STREAM_CAPABLE = ["groq", "openrouter", "openai", "deepseek", "together", "fireworks", "nvidia", "grok", "qwen", "claude", "gemini", "ollama"];

function isStreamCapable(provider) { return STREAM_CAPABLE.includes(provider); }

// OpenAI-compatible SSE stream parser — shared by every provider on this wire
// format (groq/openai/openrouter/deepseek/together/fireworks/nvidia/grok/qwen).
// Each SSE frame is `data: {...}\n\n`, terminated by `data: [DONE]\n\n`.
async function _streamOpenAICompatible(url, key, body, timeout, onChunk) {
    const res = await axios.post(url, { ...body, stream: true }, {
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        timeout, responseType: "stream",
    });
    return new Promise((resolve, reject) => {
        let full = "";
        let buffer = "";
        res.data.on("data", chunk => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split("\n");
            buffer = lines.pop(); // keep the last (possibly partial) line for the next chunk
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                    const json = JSON.parse(payload);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (delta) { full += delta; onChunk(delta); }
                } catch { /* ignore malformed/keepalive frames */ }
            }
        });
        res.data.on("end", () => resolve(full));
        res.data.on("error", reject);
    });
}

// Claude's SSE format differs: named events (content_block_delta etc.), each
// with its own `data: {...}` payload carrying `delta.text`.
async function _streamClaude(messages, model, opts, onChunk) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY not set");
    const systemMsg = messages.find(m => m.role === "system");
    const userMsgs  = messages.filter(m => m.role !== "system");
    const body = {
        model: model || _claudeModel(), max_tokens: opts.maxTokens || 1024, stream: true,
        messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;

    const res = await axios.post(ANTHROPIC_URL, body, {
        headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VER, "Content-Type": "application/json" },
        timeout: TIMEOUTS.claude, responseType: "stream",
    });
    return new Promise((resolve, reject) => {
        let full = "";
        let buffer = "";
        res.data.on("data", chunk => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                try {
                    const json = JSON.parse(trimmed.slice(5).trim());
                    const delta = json.delta?.text;
                    if (delta) { full += delta; onChunk(delta); }
                } catch { /* ignore event-type lines / keepalives */ }
            }
        });
        res.data.on("end", () => resolve(full));
        res.data.on("error", reject);
    });
}

// Gemini's streaming endpoint returns a JSON array streamed incrementally
// (not SSE) — parse candidate text out of each top-level object as it arrives.
async function _streamGemini(messages, model, opts, onChunk) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY not set");
    const systemMsg = messages.find(m => m.role === "system");
    const userMsgs  = messages.filter(m => m.role !== "system");
    const systemPart = systemMsg ? systemMsg.content + "\n\n" : "";
    const fullPrompt = systemPart + userMsgs.map(m => m.content).join("\n");
    const chosenModel = model || _geminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:streamGenerateContent?alt=sse&key=${key}`;

    const res = await axios.post(url, { contents: [{ parts: [{ text: fullPrompt }] }] }, {
        headers: { "Content-Type": "application/json" }, timeout: TIMEOUTS.gemini, responseType: "stream",
    });
    return new Promise((resolve, reject) => {
        let full = "";
        let buffer = "";
        res.data.on("data", chunk => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                try {
                    const json = JSON.parse(trimmed.slice(5).trim());
                    const delta = json.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (delta) { full += delta; onChunk(delta); }
                } catch { /* ignore malformed frames */ }
            }
        });
        res.data.on("end", () => resolve(full));
        res.data.on("error", reject);
    });
}

async function _streamOllama(messages, model, onChunk) {
    const url = _ollamaUrl();
    await _assertLocalServerUp(url, "Ollama");
    const res = await axios.post(url, { model: model || _ollamaModel(), messages, stream: true }, {
        timeout: TIMEOUTS.ollama, responseType: "stream",
    });
    return new Promise((resolve, reject) => {
        let full = "";
        let buffer = "";
        res.data.on("data", chunk => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    const delta = json.message?.content;
                    if (delta) { full += delta; onChunk(delta); }
                } catch { /* ignore partial/malformed lines */ }
            }
        });
        res.data.on("end", () => resolve(full));
        res.data.on("error", reject);
    });
}

/**
 * Stream a chat completion, invoking onChunk(deltaText) as tokens arrive.
 * Resolves with the same shape as chat(): { text, provider, model, latencyMs }.
 * Falls back through the same provider order as chat()/callAI() — if a
 * provider fails before producing any chunk, tries the next.
 *
 * @param {Array<{role,content}>} messages
 * @param {object} opts   same as chat() — provider, task, model, maxTokens
 * @param {(delta: string) => void} onChunk
 */
async function streamChat(messages, opts = {}, onChunk = () => {}) {
    let chosenProvider;
    if (opts.provider) chosenProvider = opts.provider;
    else if (opts.task) chosenProvider = routeByCapability(opts.task, opts).provider;

    const model = opts.model || null;
    const t0 = Date.now();
    const systemMsg = messages.find(m => m.role === "system");
    const rest = messages.filter(m => m.role !== "system");
    const allMessages = systemMsg ? [systemMsg, ...rest] : rest;

    const providers = (chosenProvider ? [chosenProvider] : _providerOrder()).filter(isStreamCapable);
    if (!providers.length) throw new Error("No streaming-capable provider available in the current provider order");

    for (const p of providers) {
        try {
            let text;
            switch (p) {
                case "groq":       text = await _streamOpenAICompatible(GROQ_URL, process.env.GROQ_API_KEY, { model: model || "llama-3.3-70b-versatile", messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.groq, onChunk); break;
                case "openrouter": text = await _streamOpenAICompatible(OPENROUTER_URL, process.env.OPENROUTER_API_KEY, { model: model || "anthropic/claude-haiku-4-5", messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.openrouter, onChunk); break;
                case "openai":     text = await _streamOpenAICompatible(OPENAI_URL, process.env.OPENAI_API_KEY, { model: model || "gpt-4o-mini", messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.openai, onChunk); break;
                case "deepseek":   text = await _streamOpenAICompatible(DEEPSEEK_URL, process.env.DEEPSEEK_API_KEY, { model: model || _deepseekModel(), messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.deepseek, onChunk); break;
                case "together":   text = await _streamOpenAICompatible(TOGETHER_URL, process.env.TOGETHER_API_KEY, { model: model || _togetherModel(), messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.together, onChunk); break;
                case "fireworks":  text = await _streamOpenAICompatible(FIREWORKS_URL, process.env.FIREWORKS_API_KEY, { model: model || _fireworksModel(), messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.fireworks, onChunk); break;
                case "nvidia":     text = await _streamOpenAICompatible(NVIDIA_URL, process.env.NVIDIA_API_KEY, { model: model || _nvidiaModel(), messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.nvidia, onChunk); break;
                case "grok":       text = await _streamOpenAICompatible(GROK_URL, process.env.GROK_API_KEY, { model: model || _grokModel(), messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.grok, onChunk); break;
                case "qwen":       text = await _streamOpenAICompatible(_qwenUrl(), process.env.DASHSCOPE_API_KEY, { model: model || _qwenModel(), messages: allMessages, temperature: 0.7, max_tokens: opts.maxTokens || 1024 }, TIMEOUTS.qwen, onChunk); break;
                case "claude":     text = await _streamClaude(allMessages, model, opts, onChunk); break;
                case "gemini":     text = await _streamGemini(allMessages, model, opts, onChunk); break;
                case "ollama":     text = await _streamOllama(allMessages, model, onChunk); break;
                default: continue;
            }
            if (_state.callCount[p] !== undefined) _state.callCount[p]++;
            _state.activeProvider = p;
            _state.lastSuccess = new Date().toISOString();
            return { text, provider: p, model: model || _defaultModel(p), latencyMs: Date.now() - t0 };
        } catch (err) {
            _state.failCount++;
            _state.lastFailures[p] = { reason: err.message, ts: new Date().toISOString() };
            logger.warn(`AI streamChat [${p}] failed: ${err.message}`);
        }
    }

    throw new Error("All streaming-capable AI providers failed — check your API keys.");
}

/**
 * Extract and parse a JSON object from a raw LLM text response.
 *
 * Every AI-JSON generator in this codebase (componentGenerator.cjs,
 * autonomousPageBuilder.cjs, aiDesignPlanner.cjs, selfHealingFrontend.cjs,
 * and others) independently duplicated the same `raw.match(/\{[\s\S]*\}/)`
 * + `JSON.parse()` pattern, none of them handling a real, observed failure
 * mode: LLMs frequently return multi-line code inside a JSON string value
 * with literal (unescaped) newlines/tabs instead of `\n`/`\t` — valid as
 * "text a model would write," invalid per the JSON spec, and something
 * `JSON.parse` rejects outright ("Bad control character in string
 * literal"). Consolidating here (not redesigning each caller's contract)
 * so every generator gets the same real fix and only needs to switch its
 * two-line inline block for a call to this.
 *
 * @param {string} raw - full LLM response text
 * @returns {{ok:true, data:object}|{ok:false, error:string}}
 */
function extractJSON(raw) {
    if (typeof raw !== "string") return { ok: false, error: "AI response was not text" };
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "AI did not return JSON" };
    const candidate = jsonMatch[0];
    try {
        return { ok: true, data: JSON.parse(candidate) };
    } catch (firstErr) {
        // Escape raw control characters (newline, tab, CR) that appear
        // INSIDE string literals — the single most common real failure
        // mode for multi-line code/text embedded in an LLM's JSON output.
        // Walks the string tracking quote state so control chars outside
        // strings (real JSON formatting whitespace) are left untouched.
        let repaired = "";
        let inString = false;
        let escaped  = false;
        for (const ch of candidate) {
            if (inString) {
                if (escaped) { repaired += ch; escaped = false; continue; }
                if (ch === "\\") { repaired += ch; escaped = true; continue; }
                if (ch === '"') { inString = false; repaired += ch; continue; }
                if (ch === "\n") { repaired += "\\n"; continue; }
                if (ch === "\r") { repaired += "\\r"; continue; }
                if (ch === "\t") { repaired += "\\t"; continue; }
                repaired += ch;
            } else {
                if (ch === '"') inString = true;
                repaired += ch;
            }
        }
        try {
            return { ok: true, data: JSON.parse(repaired) };
        } catch (secondErr) {
            return { ok: false, error: `AI returned malformed JSON: ${firstErr.message}` };
        }
    }
}

module.exports = {
    callAI, detectIntentWithAI, getAIStatus, routeByCapability, chat, chatWithTools, getProviderStatus, extractJSON,
    // Exported for aiOrchestrator.cjs's availability probing — read-only
    // accessors, no new behavior; local-server URL builders + reachability
    // check already existed internally (used by _ollama/_lmstudio's own
    // fail-fast path), just weren't exposed for callers to probe ahead of time.
    isLocalServerReachable, ollamaUrl: _ollamaUrl, lmStudioUrl: _lmStudioUrl,
    // Streaming (SSE passthrough) — see STREAM_CAPABLE for exactly which
    // providers this supports. Cohere and LM Studio are deliberately excluded:
    // Cohere's streaming wire format differs from every other provider here
    // (named event_type frames, not OpenAI-style delta chunks) and hasn't been
    // implemented/verified; LM Studio's local server likely supports the same
    // OpenAI-compatible stream shape as the cloud providers but hasn't been
    // verified against a real running instance either — both would need a
    // real verified implementation before being added, not a guess.
    streamChat, isStreamCapable,
    CALL_AI_OVERALL_BUDGET_MS,
};
