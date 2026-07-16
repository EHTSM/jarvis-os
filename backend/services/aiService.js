"use strict";
/**
 * AI Service — multi-provider router with health-based failover.
 *
 * Provider order (default): LLM_PROVIDER env var → ["groq","openrouter","openai","claude","gemini","ollama","deepseek","together","fireworks","cohere","nvidia","lmstudio"]
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
["groq", "openrouter", "openai", "claude", "gemini", "ollama", "deepseek", "together", "fireworks", "cohere", "nvidia", "lmstudio"].forEach(p => { _state.callCount[p] = 0; });

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
function _providerOrder() {
    const preferred = (process.env.LLM_PROVIDER || "").toLowerCase().trim();
    const defaults  = ["groq", "openrouter", "openai", "claude", "gemini", "ollama", "deepseek", "together", "fireworks", "cohere", "nvidia", "lmstudio"];
    if (!preferred || !defaults.includes(preferred)) return defaults;
    return [preferred, ...defaults.filter(p => p !== preferred)];
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

async function _groq(messages, model) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            GROQ_URL,
            { model: model || "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.groq }
        );
        return res.data.choices[0].message.content;
    });
}

async function _openrouter(messages, model) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            OPENROUTER_URL,
            { model: model || "anthropic/claude-haiku-4-5", messages, temperature: 0.7, max_tokens: 1024 },
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

async function _openai(messages, model) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            OPENAI_URL,
            { model: model || "gpt-4o-mini", messages, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.openai }
        );
        return res.data.choices[0].message.content;
    });
}

async function _ollama(messages, model) {
    const url = _ollamaUrl();
    await _assertLocalServerUp(url, "Ollama");
    const res = await axios.post(
        url,
        { model: model || _ollamaModel(), messages, stream: false },
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
        { contents: [{ parts: [{ text: fullPrompt }] }] },
        { headers: { "Content-Type": "application/json" }, timeout: TIMEOUTS.gemini }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    return text;
}

// ── DeepSeek adapter (OpenAI-compatible) ─────────────────────────────────────
async function _deepseek(messages, model) {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            DEEPSEEK_URL,
            { model: model || _deepseekModel(), messages, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.deepseek }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Together AI adapter (OpenAI-compatible) ───────────────────────────────────
async function _together(messages, model) {
    const key = process.env.TOGETHER_API_KEY;
    if (!key) throw new Error("TOGETHER_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            TOGETHER_URL,
            { model: model || _togetherModel(), messages, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.together }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Fireworks AI adapter (OpenAI-compatible) ──────────────────────────────────
async function _fireworks(messages, model) {
    const key = process.env.FIREWORKS_API_KEY;
    if (!key) throw new Error("FIREWORKS_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            FIREWORKS_URL,
            { model: model || _fireworksModel(), messages, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.fireworks }
        );
        return res.data.choices[0].message.content;
    });
}

// ── Cohere adapter ─────────────────────────────────────────────────────────────
// Cohere Chat v1 accepts OpenAI-style message arrays.
async function _cohere(messages, model) {
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
            { model: model || _cohereModel(), message: lastUser?.message || "", chat_history: chatHistory, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, timeout: TIMEOUTS.cohere }
        );
        const text = res.data?.text || res.data?.message?.content?.[0]?.text;
        if (!text) throw new Error("Empty Cohere response");
        return text;
    });
}

// ── NVIDIA NIM adapter (OpenAI-compatible) ────────────────────────────────────
async function _nvidia(messages, model) {
    const key = process.env.NVIDIA_API_KEY;
    if (!key) throw new Error("NVIDIA_API_KEY not set");
    return _withRetry(async () => {
        const res = await axios.post(
            NVIDIA_URL,
            { model: model || _nvidiaModel(), messages, temperature: 0.7, max_tokens: 1024 },
            { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: TIMEOUTS.nvidia }
        );
        return res.data.choices[0].message.content;
    });
}

// ── LM Studio adapter (OpenAI-compatible, local) ─────────────────────────────
async function _lmstudio(messages, model) {
    const url = _lmStudioUrl();
    await _assertLocalServerUp(url, "LM Studio");
    const res = await axios.post(
        url,
        { model: model || _lmStudioModel(), messages, temperature: 0.7, max_tokens: 1024 },
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
async function callAI(prompt, opts = {}) {
    const systemMsg = { role: "system", content: opts.system || _getSystemPrompt() };
    const history   = Array.isArray(opts.history) ? opts.history : [];
    const messages  = [systemMsg, ...history, { role: "user", content: prompt }];
    const model     = opts.model || null;

    const providers = opts.provider ? [opts.provider] : _providerOrder();

    for (const provider of providers) {
        try {
            let reply;
            switch (provider) {
                case "groq":       reply = await _groq(messages, model);              break;
                case "openrouter": reply = await _openrouter(messages, model);        break;
                case "openai":     reply = await _openai(messages, model);            break;
                case "ollama":     reply = await _ollama(messages, model);            break;
                case "claude":     reply = await _claude(messages, model, opts);      break;
                case "gemini":     reply = await _gemini(messages, model, opts);      break;
                case "deepseek":   reply = await _deepseek(messages, model);          break;
                case "together":   reply = await _together(messages, model);          break;
                case "fireworks":  reply = await _fireworks(messages, model);         break;
                case "cohere":     reply = await _cohere(messages, model);            break;
                case "nvidia":     reply = await _nvidia(messages, model);            break;
                case "lmstudio":   reply = await _lmstudio(messages, model);         break;
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

    for (const p of providers) {
        try {
            let text;
            const allMessages = systemMsg ? [systemMsg, ...rest] : rest;
            switch (p) {
                case "groq":       text = await _groq(allMessages, model);             break;
                case "openrouter": text = await _openrouter(allMessages, model);       break;
                case "openai":     text = await _openai(allMessages, model);           break;
                case "ollama":     text = await _ollama(allMessages, model);           break;
                case "claude":     text = await _claude(allMessages, model, adapterOpts); break;
                case "gemini":     text = await _gemini(allMessages, model, adapterOpts); break;
                case "deepseek":   text = await _deepseek(allMessages, model);         break;
                case "together":   text = await _together(allMessages, model);         break;
                case "fireworks":  text = await _fireworks(allMessages, model);        break;
                case "cohere":     text = await _cohere(allMessages, model);           break;
                case "nvidia":     text = await _nvidia(allMessages, model);           break;
                case "lmstudio":   text = await _lmstudio(allMessages, model);        break;
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
    const ALL = ["groq", "openrouter", "openai", "ollama", "claude", "gemini", "deepseek", "together", "fireworks", "cohere", "nvidia", "lmstudio"];
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

async function _openaiCompatWithTools(url, key, messages, tools, model, defaultModel, timeout) {
    if (!key) throw new Error("API key not set");
    const res = await axios.post(
        url,
        {
            model: model || defaultModel,
            messages,
            tools: tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 1024,
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
                    result = await _openaiCompatWithTools(OPENAI_URL, process.env.OPENAI_API_KEY, messages, tools, model, "gpt-4o-mini", TIMEOUTS.openai);
                    break;
                case "openrouter":
                    result = await _openaiCompatWithTools(OPENROUTER_URL, process.env.OPENROUTER_API_KEY, messages, tools, model, "anthropic/claude-haiku-4-5", TIMEOUTS.openrouter);
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

module.exports = { callAI, detectIntentWithAI, getAIStatus, routeByCapability, chat, chatWithTools, getProviderStatus };
