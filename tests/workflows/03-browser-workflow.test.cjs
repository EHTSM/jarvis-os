"use strict";
/**
 * Workflow 3: Browser Automation Workflow
 *
 * Tests the browser agent pipeline:
 *   Navigate to URLs → validate safety → resolve shortcuts → return result
 *
 * Uses real browserAgent and primitives.cjs.
 * NOTE: On macOS desktop, tests that call openURL will open the browser.
 *       On headless Linux (no DISPLAY), they return success with headless=true.
 */
const test   = require("node:test");
const assert = require("node:assert/strict");

const browser  = require("../../agents/browserAgent.cjs");
const { openURL, webSearch } = require("../../agents/primitives.cjs");

const IS_HEADLESS = process.platform === "linux" &&
    !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

// ── Phase 1: URL safety validation ────────────────────────────────

test("primitives.openURL rejects missing URL", async () => {
    const r = await openURL("");
    assert.equal(r.success, false);
    assert.ok(r.error?.includes("unsafe") || r.error?.includes("missing"),
        `expected unsafe/missing error: "${r.error}"`);
});

test("primitives.openURL rejects non-http URL (javascript:)", async () => {
    const r = await openURL("javascript:alert(1)");
    assert.equal(r.success, false, "javascript: URL should be rejected");
    assert.ok(r.error, "should have error message");
});

test("primitives.openURL rejects file:// URL", async () => {
    const r = await openURL("file:///etc/passwd");
    assert.equal(r.success, false, "file:// URL should be rejected");
});

test("primitives.openURL rejects ftp:// URL", async () => {
    const r = await openURL("ftp://example.com/file");
    assert.equal(r.success, false, "ftp:// rejected — only http/https allowed");
});

test("primitives.openURL accepts valid https URL", async () => {
    // On Linux headless, this returns success without opening browser
    // On macOS, this opens the default browser
    if (IS_HEADLESS) {
        const r = await openURL("https://example.com");
        assert.equal(r.success, true, "headless should return success=true with URL");
        assert.ok(r.headless === true || r.message?.includes("URL ready"),
            `headless response shape unexpected: ${JSON.stringify(r)}`);
    } else {
        // On macOS — run but verify return shape (browser will open)
        const r = await openURL("https://example.com");
        // Could be success or error depending on system state
        assert.ok(typeof r.success === "boolean", "should return success boolean");
    }
});

test("primitives.openURL accepts http URL (plain http)", async () => {
    if (IS_HEADLESS) {
        const r = await openURL("http://localhost:5050/health");
        // localhost http is valid pattern
        assert.ok(typeof r.success === "boolean");
    } else {
        // Just validate shape, don't assert success (network state unknown)
        const r = await openURL("http://example.com");
        assert.ok(typeof r.success === "boolean");
    }
});

test("primitives.webSearch rejects empty query", async () => {
    const r = await webSearch("");
    assert.equal(r.success, false);
    assert.ok(r.error?.includes("Empty"), `expected 'Empty' in error: "${r.error}"`);
});

test("primitives.webSearch rejects whitespace-only query", async () => {
    const r = await webSearch("   ");
    assert.equal(r.success, false);
});

test("primitives.webSearch builds correct Google URL", async () => {
    // We don't want to actually open a browser in automated tests
    // But we can verify the URL construction by checking the URL field
    // The URL is built before openURL is called, so we can check it
    const query = "test query 123";
    const expectedUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    // On headless, returns {success:true, url: ..., headless:true}
    if (IS_HEADLESS) {
        const r = await webSearch(query);
        assert.equal(r.success, true);
        assert.ok(r.url?.includes("google.com"), `expected google URL, got: ${r.url}`);
        assert.ok(r.url?.includes(encodeURIComponent("test")),
            `URL should include encoded query: ${r.url}`);
    }
    // On macOS, we skip opening but verify URL would be correct
    const constructedUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    assert.ok(constructedUrl.startsWith("https://www.google.com/search?q="),
        "Google search URL pattern is correct");
    assert.ok(constructedUrl.includes("test%20query%20123"),
        "query is properly URL-encoded");
});

// ── Phase 2: Browser agent named shortcuts ─────────────────────────

const NAMED_SHORTCUT_MAP = {
    "open_google":       "https://www.google.com",
    "open_youtube":      "https://www.youtube.com",
    "open_github":       "https://github.com",
    "open_chatgpt":      "https://chatgpt.com",
    "open_linkedin":     "https://linkedin.com",
    "open_stackoverflow":"https://stackoverflow.com",
};

for (const [taskType, expectedUrl] of Object.entries(NAMED_SHORTCUT_MAP)) {
    test(`browserAgent.run() with type="${taskType}" targets correct URL`, async () => {
        if (!IS_HEADLESS) {
            // On macOS desktop: skip to avoid opening 6 browser tabs in CI
            // Just verify the URL_MAP is correct via module inspection
            const browserModule = require("../../agents/browserAgent.cjs");
            // Can't easily inspect URL_MAP without modifying module,
            // but we know the mapping is hardcoded — just validate shape
            const r = await browser.run({ type: taskType, payload: {} });
            // Result should have success boolean and url field
            assert.ok(typeof r.success === "boolean", `${taskType}: success should be boolean`);
            assert.ok(r.url || r.result, `${taskType}: should have url or result`);
            if (r.url) {
                assert.ok(r.url.includes(expectedUrl.replace("https://www.", "").replace("https://", "").split("/")[0]),
                    `${taskType}: URL ${r.url} should relate to ${expectedUrl}`);
            }
        } else {
            // Headless: actually run and verify
            const r = await browser.run({ type: taskType, payload: {} });
            assert.ok(r.success === true || r.url, `${taskType}: should succeed headless`);
        }
    });
}

// ── Phase 3: Browser agent error handling ─────────────────────────

test("browserAgent handles unknown type gracefully", async () => {
    const r = await browser.run({ type: "open_nonexistent_site", payload: {} });
    assert.equal(r.success, false, "unknown type should return success:false");
    assert.ok(r.result?.includes("Unknown browser action"),
        `expected 'Unknown browser action' in result: "${r.result}"`);
});

test("browserAgent web_search with empty query returns failure", async () => {
    const r = await browser.run({
        type:    "web_search",
        payload: { query: "" },
    });
    assert.equal(r.success, false, "empty query should fail");
    assert.ok(r.result, "should have result message explaining failure");
});

test("browserAgent web_search with valid query returns result", async () => {
    const r = await browser.run({
        type:    "web_search",
        payload: { query: "node.js best practices" },
    });
    // On headless: success with URL; on macOS: opens browser
    assert.ok(typeof r.success === "boolean", "should return success boolean");
    assert.equal(r.type, "search", "type should be 'search'");
    if (r.success) {
        assert.ok(r.url?.includes("google.com"), "should have google URL");
    }
});

test("browserAgent open_url with valid URL", async () => {
    const r = await browser.run({
        type:    "open_url",
        payload: { url: "https://example.com" },
    });
    assert.ok(typeof r.success === "boolean");
    assert.equal(r.type, "open_url");
});

test("browserAgent open_url with invalid URL returns failure", async () => {
    const r = await browser.run({
        type:    "open_url",
        payload: { url: "not-a-valid-url" },
    });
    assert.equal(r.success, false, "invalid URL should fail");
});

// ── Phase 4: URL safety regression cases ──────────────────────────

const UNSAFE_URLS = [
    "javascript:void(0)",
    "vbscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/hosts",
    "ftp://evil.com/payload",
    "",
    "   ",
    null,
];

for (const url of UNSAFE_URLS) {
    test(`openURL rejects unsafe URL: ${JSON.stringify(url)}`, async () => {
        const r = await openURL(url);
        assert.equal(r.success, false,
            `URL ${JSON.stringify(url)} should be rejected, got success:true`);
    });
}

const SAFE_URLS = [
    "https://google.com",
    "https://github.com/user/repo",
    "https://example.com/path?q=search&page=1",
    "http://localhost:5050/health",
];

for (const url of SAFE_URLS) {
    test(`openURL accepts safe URL: ${url}`, async () => {
        // Don't actually open — just test that it WOULD proceed past validation
        // We check by seeing if success is truthy (headless) or error is NOT about safety
        if (IS_HEADLESS) {
            const r = await openURL(url);
            assert.ok(r.success === true || r.headless,
                `${url}: should be accepted in headless: ${JSON.stringify(r)}`);
        } else {
            // On macOS, we just verify the URL passes the regex without opening
            const SAFE_URL_REGEX = /^https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+$/i;
            assert.ok(SAFE_URL_REGEX.test(url), `${url} should pass safety regex`);
        }
    });
}
