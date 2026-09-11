"use strict";
/**
 * VS Code Extension Service — backend for all /p24/vscode/* routes.
 *
 * Handles multi-provider AI routing: openrouter, claude, openai, ollama.
 * All five operations (chat, explain, generate, refactor, fix) funnel through
 * _aiCompletion() which selects the right API based on `provider` in the request body.
 */

const https = require("https");
const http  = require("http");
const { assertSafeNavigationTarget } = require("../utils/urlSafety.cjs");

// ── Provider dispatch ─────────────────────────────────────────────────────────

async function _openRouterCompletion(messages, model, apiKey) {
    const body = JSON.stringify({ model: model || "anthropic/claude-3-5-sonnet", messages });
    return _httpsPost("openrouter.ai", "/api/v1/chat/completions", body, {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer":  "https://jarvis-os.app",
        "X-Title":       "JARVIS Engineering",
    });
}

async function _claudeCompletion(messages, model, apiKey) {
    // Strip system messages for Anthropic format
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const filtered = messages.filter(m => m.role !== "system");
    const body = JSON.stringify({
        model:      model || "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages:   filtered,
    });
    return _httpsPost("api.anthropic.com", "/v1/messages", body, {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
    });
}

async function _openAiCompletion(messages, model, apiKey) {
    const body = JSON.stringify({ model: model || "gpt-4o", messages });
    return _httpsPost("api.openai.com", "/v1/chat/completions", body, {
        "Authorization": `Bearer ${apiKey}`,
    });
}

// SSRF & Outbound HTTP Security Audit (2026-08-22): ollamaUrl is a raw
// customer-supplied value from POST /p24/vscode/{chat,explain,generate,
// refactor,fix} (requireAuth-only) that was passed straight to a real
// https/http.request with zero validation — a non-blind SSRF, since the
// target's response body is echoed back to the caller via _extractReply().
// The default ("http://localhost:11434", the operator's own machine) is
// intentional and left unvalidated; only a customer-supplied override is
// checked, reusing the same shared choke point already established for
// the ODI browser-automation family (backend/utils/urlSafety.cjs).
async function _ollamaCompletion(messages, model, ollamaUrl) {
    const target = ollamaUrl || "http://localhost:11434";
    if (ollamaUrl) {
        const safety = await assertSafeNavigationTarget(ollamaUrl);
        if (!safety.safe) throw new Error(`ollamaUrl rejected: ${safety.reason}`);
    }
    const url  = new URL(target + "/api/chat");
    const body = JSON.stringify({ model: model || "llama3.2", messages, stream: false });
    return _httpPost(url.hostname, url.port || "11434", url.pathname, body, {});
}

function _extractReply(provider, raw) {
    if (provider === "claude") {
        return raw?.content?.[0]?.text ?? raw?.message ?? JSON.stringify(raw);
    }
    if (provider === "ollama") {
        return raw?.message?.content ?? raw?.response ?? JSON.stringify(raw);
    }
    // openrouter / openai
    return raw?.choices?.[0]?.message?.content ?? raw?.message ?? JSON.stringify(raw);
}

async function _aiCompletion({ provider = "openrouter", model, apiKey, ollamaUrl, messages }) {
    let raw;
    if (provider === "claude") {
        raw = await _claudeCompletion(messages, model, apiKey);
    } else if (provider === "openai") {
        raw = await _openAiCompletion(messages, model, apiKey);
    } else if (provider === "ollama") {
        raw = await _ollamaCompletion(messages, model, ollamaUrl);
    } else {
        raw = await _openRouterCompletion(messages, model, apiKey);
    }
    return _extractReply(provider, raw);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// Timeout, Cancellation & Long-Running Operation Safety Audit (2026-08-16):
// neither of these had any timeout — req.on("error", reject) only fires on
// a connection-level failure (refused/reset/DNS), never on a server that
// accepts the TCP connection but simply never replies, so a slow/hung AI
// endpoint (these back the Editor facade's aiExplain/aiGenerate/aiFix)
// hung the request forever. Fixed with the same req.setTimeout(ms, () =>
// req.destroy(new Error(...))) pattern already established and correct
// elsewhere in this codebase (gitHubEngineeringAgent.cjs,
// operationsAlertingLayer.cjs) — req.destroy() with an Error argument
// correctly triggers the existing req.on("error", reject) handler, so no
// new error path is introduced.
const HTTP_TIMEOUT_MS = 30_000;

function _httpsPost(hostname, path, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname,
            path,
            method:  "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...extraHeaders },
        }, res => {
            let raw = "";
            res.on("data", c => raw += c);
            res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } });
        });
        req.on("error", reject);
        req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error("Request timed out")));
        req.write(body);
        req.end();
    });
}

function _httpPost(hostname, port, path, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname,
            port:    parseInt(port) || 11434,
            path,
            method:  "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...extraHeaders },
        }, res => {
            let raw = "";
            res.on("data", c => raw += c);
            res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } });
        });
        req.on("error", reject);
        req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error("Request timed out")));
        req.write(body);
        req.end();
    });
}

// ── Session store (in-memory with persistence) ───────────────────────────────

const _sessions = new Map();
let _sessionSeq = 1;

// ── Public API ────────────────────────────────────────────────────────────────

async function chat({ messages, context, provider, model, apiKey, ollamaUrl }) {
    const augmented = [...(messages || [])];
    if (context?.file) {
        augmented.unshift({ role: "system", content: `Current file: ${context.file}` });
    }
    if (context?.repoContext) {
        augmented.unshift({ role: "system", content: `Repo context:\n${context.repoContext}` });
    }
    const reply = await _aiCompletion({ provider, model, apiKey, ollamaUrl, messages: augmented });
    return { reply, sessionId: `s${_sessionSeq++}` };
}

async function explain({ code, lang, file, provider, model, apiKey, ollamaUrl }) {
    const messages = [
        { role: "system", content: "You are an expert code explainer. Be concise and precise." },
        { role: "user",   content: `Explain this ${lang || "code"} (file: ${file || "unknown"}):\n\`\`\`${lang || ""}\n${code}\n\`\`\`` },
    ];
    const explanation = await _aiCompletion({ provider, model, apiKey, ollamaUrl, messages });
    return { explanation };
}

async function generate({ prompt, lang, file, provider, model, apiKey, ollamaUrl }) {
    const messages = [
        { role: "system", content: `You are an expert ${lang || "software"} engineer. Output ONLY code, no explanation unless asked.` },
        { role: "user",   content: `Generate ${lang || "code"} for: ${prompt}\nTarget file: ${file || "new file"}` },
    ];
    const code = await _aiCompletion({ provider, model, apiKey, ollamaUrl, messages });
    return { code };
}

async function refactor({ code, lang, file, provider, model, apiKey, ollamaUrl }) {
    const messages = [
        { role: "system", content: "You are an expert code refactoring assistant. Return the refactored code with a brief explanation of changes." },
        { role: "user",   content: `Refactor this ${lang || "code"} (${file || "unknown"}):\n\`\`\`${lang || ""}\n${code}\n\`\`\`` },
    ];
    const refactored = await _aiCompletion({ provider, model, apiKey, ollamaUrl, messages });
    return { refactored };
}

async function fix({ code, lang, file, errors, provider, model, apiKey, ollamaUrl }) {
    const errList = (errors || []).map(e => `  - Line ${e.line || "?"}: ${e.msg || e}`).join("\n");
    const messages = [
        { role: "system", content: "You are an expert debugger. Fix the code errors and return the corrected code." },
        { role: "user",   content: `Fix these errors in ${lang || "code"} (${file || "unknown"}):\n${errList}\n\`\`\`${lang || ""}\n${code}\n\`\`\`` },
    ];
    const fixed = await _aiCompletion({ provider, model, apiKey, ollamaUrl, messages });
    return { fixed };
}

function createTask(title) {
    const id = `task-vsc-${Date.now()}`;
    return { taskId: id, title, status: "open", createdAt: new Date().toISOString() };
}

module.exports = { chat, explain, generate, refactor, fix, createTask };
