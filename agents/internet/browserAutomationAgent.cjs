/**
 * Browser Automation Agent — headless browser actions via Puppeteer.
 * Gracefully degrades to webScraperAgent if Puppeteer is not installed.
 *
 * Install puppeteer: npm install puppeteer
 */

const rateLimiter   = require("./_rateLimiter.cjs");
const webScraper    = require("./webScraperAgent.cjs");

// Lazy-load Puppeteer so startup doesn't fail if it's not installed
let _puppeteer = null;
function _loadPuppeteer() {
    if (_puppeteer) return _puppeteer;
    try {
        _puppeteer = require("puppeteer");
        return _puppeteer;
    } catch {
        return null;
    }
}

const TIMEOUT_MS = 15_000;

/**
 * Capture a full-page screenshot as base64.
 */
async function screenshot(url) {
    const pptr = _loadPuppeteer();
    if (!pptr) throw new Error("Puppeteer not installed. Run: npm install puppeteer");

    await rateLimiter.gate(url, async () => null);  // rate check only
    const browser = await pptr.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (compatible; JarvisBot/1.0)");
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        const screenshotBuf = await page.screenshot({ type: "png", fullPage: false, encoding: "base64" });
        const title   = await page.title();
        const content = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
        return { url, title, content, screenshot: `data:image/png;base64,${screenshotBuf}`, capturedAt: new Date().toISOString() };
    } finally {
        await browser.close();
    }
}

/**
 * Extract text content from a JavaScript-heavy page.
 */
async function extractContent(url) {
    const pptr = _loadPuppeteer();
    if (!pptr) {
        // Fallback to static scraper
        return webScraper.scrape(url);
    }

    await rateLimiter.gate(url, async () => null);
    const browser = await pptr.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (compatible; JarvisBot/1.0)");
        await page.goto(url, { waitUntil: "networkidle2", timeout: TIMEOUT_MS });
        const data = await page.evaluate(() => ({
            title:      document.title,
            h1:         [...document.querySelectorAll("h1")].map(e => e.innerText.trim()).slice(0, 3),
            h2:         [...document.querySelectorAll("h2")].map(e => e.innerText.trim()).slice(0, 5),
            paragraphs: [...document.querySelectorAll("p")].map(e => e.innerText.trim()).filter(t => t.length > 40).slice(0, 6),
            links:      [...document.querySelectorAll("a[href]")].map(e => ({ text: e.innerText.trim().slice(0, 80), href: e.href })).slice(0, 10)
        }));
        return { ...data, url, capturedAt: new Date().toISOString(), engine: "puppeteer" };
    } finally {
        await browser.close();
    }
}

/**
 * Fill and submit a form (use only on pages you have permission to interact with).
 */
async function fillForm(url, fields = {}) {
    const pptr = _loadPuppeteer();
    if (!pptr) throw new Error("Puppeteer not installed. Run: npm install puppeteer");

    await rateLimiter.gate(url, async () => null);
    const browser = await pptr.launch({ headless: "new", args: ["--no-sandbox"] });
    try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        for (const [selector, value] of Object.entries(fields)) {
            try { await page.type(selector, String(value), { delay: 30 }); } catch { /* field not found */ }
        }
        return { success: true, url, fieldsFilled: Object.keys(fields).length };
    } finally {
        await browser.close();
    }
}

async function run(task) {
    const p      = task.payload || {};
    const url    = p.url || task.input || "";
    const action = task.type === "screenshot" ? "screenshot"
                 : task.type === "fill_form"  ? "fillForm"
                 : "extractContent";

    if (!url) return { success: false, source: "internet", type: "browserAutomationAgent", data: { error: "url required" } };

    try {
        let data;
        if (action === "screenshot")    data = await screenshot(url);
        else if (action === "fillForm") data = await fillForm(url, p.fields || {});
        else                            data = await extractContent(url);
        return { success: true, source: "internet", type: "browserAutomationAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "browserAutomationAgent", data: { error: err.message } };
    }
}

module.exports = { screenshot, extractContent, fillForm, run };
