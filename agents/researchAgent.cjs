"use strict";
/**
 * Research Agent — DuckDuckGo search + Groq synthesis.
 * Flow: query → DDG Instant Answer API → extract results → Groq synthesis → formatted report
 */

const https = require("https");

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "JarvisAI/1.0" } }, (res) => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => resolve(data));
        }).on("error", reject);
    });
}

async function duckduckgoSearch(query) {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
    const raw = await httpsGet(url);
    const data = JSON.parse(raw);

    const results = [];

    // Abstract (Wikipedia-style answer)
    if (data.AbstractText) {
        results.push({
            title: data.Heading || query,
            snippet: data.AbstractText.slice(0, 400),
            url: data.AbstractURL || ""
        });
    }

    // RelatedTopics — top 5
    if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 8)) {
            if (topic.Text && topic.FirstURL) {
                results.push({
                    title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 80),
                    snippet: topic.Text.slice(0, 300),
                    url: topic.FirstURL
                });
            }
            // Nested topics (DDG returns sub-groups sometimes)
            if (Array.isArray(topic.Topics)) {
                for (const sub of topic.Topics.slice(0, 4)) {
                    if (sub.Text && sub.FirstURL) {
                        results.push({
                            title: sub.Text.split(" - ")[0] || sub.Text.slice(0, 80),
                            snippet: sub.Text.slice(0, 300),
                            url: sub.FirstURL
                        });
                    }
                }
            }
        }
    }

    // Answer (quick calculator / factual answer)
    if (data.Answer && !results.length) {
        results.push({ title: "Answer", snippet: data.Answer, url: "" });
    }

    return results.slice(0, 6);
}

async function synthesizeWithGroq(query, results) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        // No Groq key — format raw results as markdown
        if (!results.length) return `No results found for: ${query}`;
        const lines = results.map((r, i) =>
            `**${i + 1}. ${r.title}**\n${r.snippet}${r.url ? `\n→ ${r.url}` : ""}`
        );
        return `## Research: ${query}\n\n${lines.join("\n\n")}`;
    }

    const context = results.map((r, i) =>
        `[${i + 1}] ${r.title}: ${r.snippet}`
    ).join("\n");

    const prompt = results.length
        ? `Based on the following search results, write a concise research summary about: "${query}"\n\nSearch Results:\n${context}\n\nProvide a structured summary with key findings, top tools/options (if applicable), and a brief recommendation. Be factual and concrete.`
        : `Write a concise research summary about: "${query}". Include key facts, top options or tools, and a brief recommendation.`;

    const body = JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
            { role: "system", content: "You are a research assistant. Provide clear, factual, well-structured research summaries." },
            { role: "user", content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 800
    });

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: "api.groq.com",
                path: "/openai/v1/chat/completions",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Length": Buffer.byteLength(body)
                }
            },
            (res) => {
                let data = "";
                res.on("data", chunk => { data += chunk; });
                res.on("end", () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed.choices?.[0]?.message?.content || "No synthesis available.");
                    } catch {
                        resolve("Research complete. Unable to parse synthesis response.");
                    }
                });
            }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

async function researchAgent(query) {
    if (!query || !query.trim()) return "Please provide a research query.";

    console.log(`[ResearchAgent] search started — query="${query.slice(0,80)}"`);
    let results = [];
    try {
        results = await duckduckgoSearch(query);
        console.log(`[ResearchAgent] DDG returned ${results.length} result(s)`);
    } catch (err) {
        console.warn(`[ResearchAgent] DDG search failed: ${err.message}`);
    }

    try {
        const synthesis = await synthesizeWithGroq(query, results);
        console.log(`[ResearchAgent] synthesis complete — ${synthesis.length} chars`);
        return synthesis;
    } catch (err) {
        console.warn(`[ResearchAgent] Groq synthesis failed: ${err.message}`);
        if (results.length) {
            return results.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n\n");
        }
        return `Research on "${query}" — no results found.`;
    }
}

module.exports = researchAgent;
