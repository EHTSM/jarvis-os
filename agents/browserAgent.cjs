"use strict";
/**
 * Browser Agent — opens URLs and runs web searches.
 * Delegates execution to agents/primitives.cjs (single implementation).
 */

const { openURL, webSearch } = require("./primitives.cjs");

const URL_MAP = {
    open_google:       "https://www.google.com",
    open_youtube:      "https://www.youtube.com",
    open_chatgpt:      "https://chatgpt.com",
    open_github:       "https://github.com",
    open_twitter:      "https://twitter.com",
    open_linkedin:     "https://linkedin.com",
    open_instagram:    "https://www.instagram.com",
    open_whatsapp:     "https://web.whatsapp.com",
    open_stackoverflow:"https://stackoverflow.com",
};

async function run(task) {
    const type    = task.type || "";
    const payload = task.payload || {};

    // ── Named site shortcuts ────────────────────────────────────────
    if (URL_MAP[type]) {
        const url = URL_MAP[type];
        console.log(`[BrowserAgent] opening ${type} → ${url}`);
        const r = await openURL(url);
        return { success: r.success, type, result: r.success ? `Opened ${url}` : `Failed to open: ${r.error}`, url };
    }

    // ── Google search ───────────────────────────────────────────────
    if (type === "search" || type === "web_search") {
        const query = payload.query || task.query || "";
        if (!query) return { success: false, type, result: "Search query is empty" };
        console.log(`[BrowserAgent] searching → "${query}"`);
        const r = await webSearch(query);
        return { success: r.success, type: "search", result: r.success ? `Searching Google for: "${query}"` : `Search failed: ${r.error}`, url: r.url, query };
    }

    // ── Explicit URL ────────────────────────────────────────────────
    if (type === "open_url") {
        const url = payload.url || task.url || "";
        console.log(`[BrowserAgent] opening URL → ${url}`);
        const r = await openURL(url);
        return { success: r.success, type: "open_url", result: r.success ? `Opened ${url}` : `Failed: ${r.error}`, url };
    }

    return { success: false, type, result: `Unknown browser action: ${type}` };
}

module.exports = { run };
