"use strict";
/**
 * AI Service — Groq (primary) → OpenAI (secondary) → Ollama (local fallback)
 * Provides a single callAI(prompt, options) function.
 */

const axios  = require("axios");
const logger = require("../utils/logger");

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OLLAMA_URL = "http://localhost:11434/api/generate";

function _buildSystemPrompt() {
    const name    = process.env.PRODUCT_NAME    || "JARVIS AI";
    const price   = process.env.PRODUCT_PRICE   ? `$${process.env.PRODUCT_PRICE}` : null;
    const contact = process.env.OPERATOR_CONTACT || null;
    const desc    = process.env.PRODUCT_DESC     || null;

    let p = `You are ${name}, an AI automation assistant. `;
    if (desc) p += `${desc} `;
    p += "Help users automate tasks, answer questions, and control their system. Be concise, accurate, and helpful. ";
    if (price) p += `When asked about cost or pricing, the product costs ${price}. `;
    if (contact) p += `For support, direct users to: ${contact}. `;
    p += "When asked to execute a task, confirm it clearly.";
    return p;
}

// Evaluate at first call so env vars are loaded
let _cachedPrompt = null;
function _getSystemPrompt() {
    if (!_cachedPrompt) _cachedPrompt = _buildSystemPrompt();
    return _cachedPrompt;
}

/**
 * Call Groq API.
 */
async function _groq(messages, model) {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY not set");

    const res = await axios.post(
        GROQ_URL,
        { model: model || "llama-3.3-70b-versatile", messages, temperature: 0.7, max_tokens: 1024 },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 20000 }
    );
    return res.data.choices[0].message.content;
}

/**
 * Call OpenAI API.
 */
async function _openai(messages, model) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");

    const res = await axios.post(
        OPENAI_URL,
        { model: model || "gpt-4o-mini", messages, temperature: 0.7, max_tokens: 1024 },
        { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 20000 }
    );
    return res.data.choices[0].message.content;
}

/**
 * Call Ollama (local).
 */
async function _ollama(prompt, model) {
    const res = await axios.post(
        OLLAMA_URL,
        { model: model || "llama3", prompt, stream: false },
        { timeout: 30000 }
    );
    if (!res.data?.response) throw new Error("Empty Ollama response");
    return res.data.response;
}

/**
 * Main AI call — tries providers in order, stops at first success.
 *
 * @param {string}   prompt   – user message
 * @param {object}   opts
 * @param {string}   opts.system    – override system prompt
 * @param {Array}    opts.history   – prior messages [{role,content}]
 * @param {string}   opts.provider  – force "groq"|"openai"|"ollama"
 * @returns {Promise<string>}
 */
async function callAI(prompt, opts = {}) {
    const systemMsg = { role: "system", content: opts.system || _getSystemPrompt() };
    const history   = Array.isArray(opts.history) ? opts.history : [];
    const messages  = [systemMsg, ...history, { role: "user", content: prompt }];

    const providers = opts.provider
        ? [opts.provider]
        : ["groq", "openai", "ollama"];

    for (const provider of providers) {
        try {
            switch (provider) {
                case "groq":   return await _groq(messages);
                case "openai": return await _openai(messages);
                case "ollama": return await _ollama(prompt);
            }
        } catch (err) {
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

module.exports = { callAI, detectIntentWithAI };
