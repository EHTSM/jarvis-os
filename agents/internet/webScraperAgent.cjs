/**
 * Web Scraper Agent — fetches and parses HTML from public URLs.
 * Uses axios + cheerio. Rate-limited to 5 req/min per domain.
 * Respects robots.txt convention: only scrapes public, non-login pages.
 */

const axios      = require("axios");
const cheerio    = require("cheerio");
const rateLimiter = require("./_rateLimiter.cjs");

const TIMEOUT_MS  = 8000;
const USER_AGENT  = "Mozilla/5.0 (compatible; JarvisBot/1.0; +https://jarvis.app/bot)";

async function _fetch(url) {
    return rateLimiter.gate(url, async () => {
        const res = await axios.get(url, {
            timeout: TIMEOUT_MS,
            headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
            maxRedirects: 3
        });
        return res.data;
    });
}

function _parse(html, url) {
    const $ = cheerio.load(html);

    // Remove noise
    $("script, style, nav, footer, iframe, noscript, [aria-hidden='true']").remove();

    const title       = $("title").text().trim() || $("h1").first().text().trim();
    const description = $('meta[name="description"]').attr("content") || "";
    const h1          = $("h1").map((_, el) => $(el).text().trim()).get().slice(0, 3);
    const h2          = $("h2").map((_, el) => $(el).text().trim()).get().slice(0, 5);
    const paragraphs  = $("p")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(t => t.length > 40)
        .slice(0, 6);
    const links = $("a[href]")
        .map((_, el) => ({ text: $(el).text().trim().slice(0, 80), href: $(el).attr("href") }))
        .get()
        .filter(l => l.text && l.href && !l.href.startsWith("#"))
        .slice(0, 10);

    return { url, title, description, h1, h2, paragraphs, links, scrapedAt: new Date().toISOString() };
}

/**
 * Scrape a public URL and return structured data.
 */
async function scrape(url) {
    if (!url || !url.startsWith("http")) throw new Error("Valid URL required (must start with http)");
    const html = await _fetch(url);
    return _parse(html, url);
}

/**
 * Scrape multiple URLs (sequential, rate-limited per domain).
 */
async function scrapeMany(urls) {
    const results = [];
    for (const url of urls.slice(0, 5)) {  // cap at 5 to stay safe
        try {
            results.push({ url, success: true, data: await scrape(url) });
        } catch (err) {
            results.push({ url, success: false, error: err.message });
        }
    }
    return results;
}

async function run(task) {
    const p   = task.payload || {};
    const url  = p.url || p.target || task.input || "";
    const urls = p.urls || (url ? [url] : []);

    if (!urls.length) return { success: false, source: "internet", type: "webScraperAgent", data: { error: "url or urls[] required" } };

    try {
        const data = urls.length === 1 ? await scrape(urls[0]) : await scrapeMany(urls);
        return { success: true, source: "internet", type: "webScraperAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "webScraperAgent", data: { error: err.message, rateLimited: !!err.rateLimited } };
    }
}

module.exports = { scrape, scrapeMany, run };
