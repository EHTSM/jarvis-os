/**
 * Groq Client — shared AI inference client for all dev agents.
 * Model: llama-3.3-70b-versatile via Groq API.
 */

const axios = require("axios");

const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TIMEOUT       = 30000;

async function chat(systemPrompt, userPrompt, options = {}) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY not set in environment");
    }

    const res = await axios.post(GROQ_URL, {
        model:       options.model       || DEFAULT_MODEL,
        messages:    [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   }
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens:  options.maxTokens   ?? 4096
    }, {
        headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type":  "application/json"
        },
        timeout: options.timeout ?? TIMEOUT
    });

    return res.data.choices[0].message.content.trim();
}

// Parse JSON from AI response (handles markdown fences)
function parseJson(raw) {
    const cleaned = raw.replace(/```(?:json)?\n?/gi, "").replace(/```/g, "").trim();
    const match   = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return JSON.parse(match ? match[0] : cleaned);
}

module.exports = { chat, parseJson };
