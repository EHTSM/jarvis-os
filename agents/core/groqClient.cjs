"use strict";
/**
 * groqClient — thin adapter giving agents/business/* and agents/content/*
 * the chat(SYSTEM, prompt, opts) + parseJson(raw) interface they already
 * expect, backed by the real, already-wired multi-provider AI service
 * (backend/services/aiService.js) instead of a dedicated Groq SDK client.
 *
 * This file does not implement its own AI calling logic, retry, or
 * provider fallback — all of that is aiService.chat()'s existing
 * responsibility (14 providers, fallback order, credit/budget checks
 * upstream of it). Groq is aiService's default first-priority provider
 * when no specific provider/task is requested, so "groqClient" still
 * genuinely means Groq in the common case, while transparently falling
 * back to whichever other provider has a live credential if Groq is
 * unavailable — the same behavior every other agent already gets via the
 * registered "ai" runtime capability (agents/runtime/bootstrapRuntime.cjs).
 *
 * Was missing entirely prior to this fix — 11 agent files depended on
 * "../core/groqClient.cjs", which never existed anywhere in the repo,
 * making them unable to even require() successfully.
 */

const aiService = require("../../backend/services/aiService.js");

/**
 * Send a system+user prompt, get back the raw text response.
 * @param {string} system   system prompt
 * @param {string} prompt   user prompt
 * @param {object} [opts]   { maxTokens, temperature, provider, model }
 * @returns {Promise<string>} raw model output (may contain markdown fences)
 */
async function chat(system, prompt, opts = {}) {
    const result = await aiService.chat(
        [
            { role: "system", content: system },
            { role: "user", content: prompt },
        ],
        {
            maxTokens: opts.maxTokens,
            temperature: opts.temperature,
            provider: opts.provider,
            model: opts.model,
        }
    );
    return result.text;
}

/**
 * Extract and parse a JSON object/array from a raw model response,
 * defensively stripping markdown code fences (```json ... ``` or ``` ... ```)
 * that models sometimes add even when explicitly told not to.
 * Never throws — returns {} on any parse failure so callers using the
 * synchronous, un-try/caught `groq.parseJson(raw)` pattern degrade to an
 * empty object rather than crashing the calling agent.
 * @param {string} raw
 * @returns {object}
 */
function parseJson(raw) {
    if (!raw || typeof raw !== "string") return {};
    let text = raw.trim();
    // Strip a leading/trailing markdown fence if present, with or without a language tag.
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) text = fenceMatch[1].trim();
    try {
        return JSON.parse(text);
    } catch {
        // Last resort: find the first {...} or [...] block and try that,
        // in case the model added prose before/after the JSON despite
        // instructions not to.
        const objMatch = text.match(/[{[][\s\S]*[}\]]/);
        if (objMatch) {
            try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
        }
        return {};
    }
}

module.exports = { chat, parseJson };
