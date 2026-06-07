"use strict";
/**
 * AI Service — multi-provider router with health-based failover.
 *
 * Provider order (default): LLM_PROVIDER env var → ["groq","openrouter","openai","ollama"]
 * Each provider is attempted once per call; failures are logged and the next
 * provider is tried. The last failure reason per provider is retained for
 * the /ai/status endpoint.
 *
 * Retry: 1 retry within Groq and OpenRouter (network-class errors only).
 * Timeout: per-provider, configured via env vars.
 */

const axios  = require("axios");
const logger = require("../utils/logger");

// ── Provider endpoints ────────────────────────────────────────────────────────
const GROQ_URL       = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL     = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function _ollamaUrl()  { return (process.env.OLLAMA_URL || "http://localhost:11434") + "/api/chat"; }
function _ollamaModel(){ return process.env.OLLAMA_MODEL || "llama3.2"; }

// ── Runtime state (in-process, reset on restart) ─────────────────────────────
const _state = {
    activeProvider:   null,   // last provider that succeeded
    lastSuccess:      null,   // ISO timestamp of last successful call
    lastFailures:     {},     // { [provider]: { reason, ts } }
    callCount:        0,
    failCount:        0,
};

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
    const defaults  = ["groq", "openrouter", "openai", "ollama"];
    if (!preferred || !defaults.includes(preferred)) return defaults;
    return [preferred, ...defaults.filter(p => p !== preferred)];
}

// ── Per-provider timeout (ms) ─────────────────────────────────────────────────
const TIMEOUTS = {
    groq:       parseInt(process.env.GROQ_TIMEOUT       || "20000", 10),
    openrouter: parseInt(process.env.OPENROUTER_TIMEOUT || "25000", 10),
    openai:     parseInt(process.env.OPENAI_TIMEOUT     || "20000", 10),
    ollama:     parseInt(process.env.OLLAMA_TIMEOUT     || "30000", 10),
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
    const res = await axios.post(
        url,
        { model: model || _ollamaModel(), messages, stream: false },
        { timeout: TIMEOUTS.ollama }
    );
    const content = res.data?.message?.content;
    if (!content) throw new Error("Empty Ollama response");
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

    _state.callCount++;

    for (const provider of providers) {
        try {
            let reply;
            switch (provider) {
                case "groq":       reply = await _groq(messages, model);       break;
                case "openrouter": reply = await _openrouter(messages, model); break;
                case "openai":     reply = await _openai(messages, model);     break;
                case "ollama":     reply = await _ollama(messages, model);     break;
                default:
                    logger.warn(`AI: unknown provider "${provider}", skipping`);
                    continue;
            }
            _state.activeProvider = provider;
            _state.lastSuccess    = new Date().toISOString();
            return reply;
        } catch (err) {
            _state.failCount++;
            _state.lastFailures[provider] = { reason: err.message, ts: new Date().toISOString() };
            logger.warn(`AI [${provider}] failed: ${err.message}`);
        }
    }

    return "AI backend unavailable. Check GROQ_API_KEY in your .env file.";
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

module.exports = { callAI, detectIntentWithAI, getAIStatus };
