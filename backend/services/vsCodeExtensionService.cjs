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

async function _ollamaCompletion(messages, model, ollamaUrl) {
    const url  = new URL((ollamaUrl || "http://localhost:11434") + "/api/chat");
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
