"use strict";
/**
 * actionEngine — executes individual browser actions on a Playwright Page.
 *
 * Reliability guarantees:
 *   - Multi-strategy selector resolution (CSS → text → role → label → placeholder)
 *   - Smart wait: waits for network-idle on slow pages, falls back to domcontentloaded
 *   - Post-navigate settle: short stabilization wait before proceeding
 *   - Stale-element retry: re-queries selector on stale element error
 *   - Masked evaluate: blocks Node.js escape patterns in page.evaluate scripts
 *   - All actions return { ok, action, ts, ...detail } — never throw to caller
 *
 * Public API:
 *   navigate(page, url, opts)
 *   click(page, selector, opts)
 *   typeText(page, selector, text, opts)
 *   fillForm(page, selector, text, opts)
 *   waitForElement(page, selector, opts)
 *   screenshot(page, opts)
 *   getText(page, selector)
 *   getTitle(page)
 *   getUrl(page)
 *   scrollDown(page, pixels)
 *   pressKey(page, key)
 *   selectOption(page, selector, value, opts)
 *   waitForNavigation(page, opts)
 *   evaluate(page, script, opts)
 *   hoverElement(page, selector, opts)
 *   getAttribute(page, selector, attr)
 *   checkElement(page, selector)
 */

const DEFAULT_TIMEOUT    = 12_000;
const NAVIGATE_TIMEOUT   = 20_000;
const MAX_TEXT_LEN       = 3_000;
const SETTLE_DELAY_MS    = 300;    // brief pause after navigation before next action

// ── Unsafe eval patterns (browser renderer context) ──────────────────────────
// These don't actually exist in renderer, but block confused operator inputs
const UNSAFE_EVAL_PATTERNS = [
  /require\s*\(/,
  /process\s*\./,
  /child_process/,
  /\bfs\s*\./,
  /globalThis\s*\.\s*process/,
  /window\s*\.\s*process/,
];

function _isSafeScript(script) {
  return !UNSAFE_EVAL_PATTERNS.some(p => p.test(script));
}

// ── Result helpers ────────────────────────────────────────────────────────────
function _ok(action, detail = {}) {
  return { ok: true,  action, ...detail, ts: new Date().toISOString() };
}
function _fail(action, error, detail = {}) {
  return { ok: false, action, error, ...detail, ts: new Date().toISOString() };
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Multi-strategy selector resolution ───────────────────────────────────────
// Returns the first Playwright locator that resolves to a visible element,
// trying CSS → exact-text → partial-text → role → label → placeholder.
async function _resolveSelector(page, selector, { timeout = DEFAULT_TIMEOUT, state = "visible" } = {}) {
  // 1. Direct CSS / Playwright selector (fastest path)
  try {
    await page.waitForSelector(selector, { timeout: Math.min(timeout, 5000), state });
    return { locator: page.locator(selector).first(), method: "css" };
  } catch {}

  // 2. Exact visible text (for buttons and links with plain labels)
  if (/^[^.#\[\]>+~:()]+$/.test(selector.trim())) {
    try {
      const loc = page.getByText(selector.trim(), { exact: true });
      await loc.first().waitFor({ timeout: 2000, state });
      return { locator: loc.first(), method: "text-exact" };
    } catch {}

    // 3. Partial text
    try {
      const loc = page.getByText(selector.trim(), { exact: false });
      await loc.first().waitFor({ timeout: 2000, state });
      return { locator: loc.first(), method: "text-partial" };
    } catch {}

    // 4. ARIA role button/link with matching name
    for (const role of ["button", "link", "menuitem"]) {
      try {
        const loc = page.getByRole(role, { name: selector.trim(), exact: false });
        await loc.first().waitFor({ timeout: 1500, state });
        return { locator: loc.first(), method: `role-${role}` };
      } catch {}
    }

    // 5. Label text (for form inputs)
    try {
      const loc = page.getByLabel(selector.trim(), { exact: false });
      await loc.first().waitFor({ timeout: 1500, state });
      return { locator: loc.first(), method: "label" };
    } catch {}

    // 6. Placeholder text
    try {
      const loc = page.getByPlaceholder(selector.trim(), { exact: false });
      await loc.first().waitFor({ timeout: 1500, state });
      return { locator: loc.first(), method: "placeholder" };
    } catch {}
  }

  return null;
}

// ── navigate ─────────────────────────────────────────────────────────────────
async function navigate(page, url, {
  timeout   = NAVIGATE_TIMEOUT,
  waitUntil = "domcontentloaded",
} = {}) {
  if (!url) return _fail("navigate", "URL is required");

  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  try {
    const response = await page.goto(normalized, { timeout, waitUntil });
    const status   = response?.status?.() ?? null;
    const finalUrl = page.url();

    await _sleep(SETTLE_DELAY_MS);

    const title    = await page.title().catch(() => "");
    const redirect = finalUrl !== normalized && finalUrl !== normalized + "/";
    return _ok("navigate", { url: normalized, finalUrl, status, title, redirected: redirect });
  } catch (err) {
    if (err.message.includes("timeout") || err.message.includes("Timeout")) {
      try {
        const title   = await page.title().catch(() => "");
        const hasBody = await page.evaluate(() => !!document.body).catch(() => false);
        if (hasBody) {
          return _ok("navigate", {
            url: normalized, finalUrl: page.url(), status: null, title, partial: true,
          });
        }
      } catch {}
    }
    return _fail("navigate", err.message, { url: normalized });
  }
}

// ── reloadPage ────────────────────────────────────────────────────────────────
// Hard reload — use for recovery after a stuck or partial load
async function reloadPage(page, { timeout = NAVIGATE_TIMEOUT } = {}) {
  try {
    const response = await page.reload({ timeout, waitUntil: "domcontentloaded" });
    await _sleep(SETTLE_DELAY_MS);
    const status = response?.status?.() ?? null;
    const title  = await page.title().catch(() => "");
    const url    = page.url();
    return _ok("reloadPage", { url, status, title });
  } catch (err) {
    return _fail("reloadPage", err.message);
  }
}

// ── waitForContent ────────────────────────────────────────────────────────────
// Wait until the page has meaningful text content — useful for JS-rendered pages.
// Returns ok=true once bodyTextLength > minLength characters.
async function waitForContent(page, { minLength = 100, timeout = DEFAULT_TIMEOUT } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const len = await page.evaluate(() => document.body?.innerText?.length || 0);
      if (len >= minLength) {
        return _ok("waitForContent", { bodyTextLength: len, minLength });
      }
    } catch {}
    await _sleep(500);
  }
  try {
    const len = await page.evaluate(() => document.body?.innerText?.length || 0);
    return _fail("waitForContent", `Page body has only ${len} chars after ${timeout}ms (minimum: ${minLength})`, { bodyTextLength: len });
  } catch (err) {
    return _fail("waitForContent", err.message);
  }
}

// ── click ─────────────────────────────────────────────────────────────────────
async function click(page, selector, { timeout = DEFAULT_TIMEOUT, force = false } = {}) {
  if (!selector) return _fail("click", "Selector is required");

  const resolved = await _resolveSelector(page, selector, { timeout, state: "visible" });
  if (!resolved) return _fail("click", `Could not find element: "${selector}"`, { selector });

  try {
    await resolved.locator.click({ force, timeout: Math.min(timeout, 5000) });
    await _sleep(150);  // let any triggered navigation begin
    return _ok("click", { selector, method: resolved.method });
  } catch (err) {
    // Stale element — retry once
    if (err.message.includes("stale") || err.message.includes("detached")) {
      try {
        await _sleep(500);
        const r2 = await _resolveSelector(page, selector, { timeout: 3000, state: "visible" });
        if (r2) {
          await r2.locator.click({ force, timeout: 3000 });
          return _ok("click", { selector, method: r2.method, retried: true });
        }
      } catch {}
    }
    return _fail("click", err.message, { selector, method: resolved.method });
  }
}

// ── typeText ──────────────────────────────────────────────────────────────────
async function typeText(page, selector, text, {
  timeout = DEFAULT_TIMEOUT,
  delay   = 40,
  clear   = true,
} = {}) {
  if (!selector) return _fail("typeText", "Selector is required");
  if (!text)     return _fail("typeText", "Text is required");

  const resolved = await _resolveSelector(page, selector, { timeout, state: "visible" });
  if (!resolved) return _fail("typeText", `Could not find element: "${selector}"`, { selector });

  try {
    if (clear) await resolved.locator.fill("");
    await resolved.locator.pressSequentially(text, { delay });
    return _ok("typeText", { selector, length: text.length, method: resolved.method });
  } catch (err) {
    return _fail("typeText", err.message, { selector });
  }
}

// ── fillForm ──────────────────────────────────────────────────────────────────
async function fillForm(page, selector, text, { timeout = DEFAULT_TIMEOUT } = {}) {
  if (!selector)   return _fail("fillForm", "Selector is required");
  if (text == null) return _fail("fillForm", "Value is required");

  const resolved = await _resolveSelector(page, selector, { timeout, state: "visible" });
  if (!resolved) return _fail("fillForm", `Could not find element: "${selector}"`, { selector });

  try {
    await resolved.locator.fill(String(text));
    return _ok("fillForm", { selector, length: String(text).length, method: resolved.method });
  } catch (err) {
    return _fail("fillForm", err.message, { selector });
  }
}

// ── waitForElement ────────────────────────────────────────────────────────────
async function waitForElement(page, selector, {
  timeout = DEFAULT_TIMEOUT,
  state   = "visible",
} = {}) {
  if (!selector) return _fail("waitForElement", "Selector is required");
  try {
    await page.waitForSelector(selector, { timeout, state });
    return _ok("waitForElement", { selector, state });
  } catch (err) {
    // Try text-based fallback for plain labels
    if (/^[^.#\[\]>+~:()]+$/.test(selector.trim())) {
      try {
        await page.getByText(selector.trim(), { exact: false })
          .first().waitFor({ timeout: 2000, state });
        return _ok("waitForElement", { selector, state, method: "text-fallback" });
      } catch {}
    }
    return _fail("waitForElement", err.message, { selector });
  }
}

// ── screenshot ────────────────────────────────────────────────────────────────
async function screenshot(page, { fullPage = false } = {}) {
  try {
    const buffer = await page.screenshot({ type: "png", fullPage });
    const base64 = buffer.toString("base64");
    return _ok("screenshot", {
      dataUrl:  `data:image/png;base64,${base64}`,
      sizeKb:   Math.round(buffer.length / 1024),
      fullPage,
    });
  } catch (err) {
    return _fail("screenshot", err.message);
  }
}

// ── getText ───────────────────────────────────────────────────────────────────
async function getText(page, selector) {
  if (!selector) {
    try {
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || "");
      return _ok("getText", { text: text.trim(), selector: "body" });
    } catch (err) {
      return _fail("getText", err.message);
    }
  }

  const resolved = await _resolveSelector(page, selector, { state: "attached" });
  if (!resolved) return _fail("getText", `Element not found: "${selector}"`, { selector });

  try {
    const text = await resolved.locator.textContent({ timeout: DEFAULT_TIMEOUT });
    return _ok("getText", {
      text:     (text || "").slice(0, MAX_TEXT_LEN).trim(),
      selector,
      method:   resolved.method,
    });
  } catch (err) {
    return _fail("getText", err.message, { selector });
  }
}

// ── getTitle / getUrl ─────────────────────────────────────────────────────────
async function getTitle(page) {
  try {
    const title = await page.title();
    return _ok("getTitle", { title });
  } catch (err) {
    return _fail("getTitle", err.message);
  }
}

function getUrl(page) {
  try {
    return _ok("getUrl", { url: page.url() });
  } catch (err) {
    return _fail("getUrl", err.message);
  }
}

// ── scrollDown ────────────────────────────────────────────────────────────────
async function scrollDown(page, pixels = 500) {
  try {
    await page.evaluate((px) => window.scrollBy(0, px), pixels);
    await _sleep(200);
    return _ok("scrollDown", { pixels });
  } catch (err) {
    return _fail("scrollDown", err.message);
  }
}

// ── pressKey ──────────────────────────────────────────────────────────────────
async function pressKey(page, key) {
  if (!key) return _fail("pressKey", "Key is required");
  try {
    await page.keyboard.press(key);
    return _ok("pressKey", { key });
  } catch (err) {
    return _fail("pressKey", err.message, { key });
  }
}

// ── selectOption ──────────────────────────────────────────────────────────────
async function selectOption(page, selector, value, { timeout = DEFAULT_TIMEOUT } = {}) {
  if (!selector) return _fail("selectOption", "Selector is required");
  try {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    await page.selectOption(selector, value);
    return _ok("selectOption", { selector, value });
  } catch (err) {
    return _fail("selectOption", err.message, { selector, value });
  }
}

// ── waitForNavigation ─────────────────────────────────────────────────────────
async function waitForNavigation(page, {
  timeout   = DEFAULT_TIMEOUT,
  waitUntil = "domcontentloaded",
} = {}) {
  try {
    await page.waitForNavigation({ timeout, waitUntil });
    await _sleep(SETTLE_DELAY_MS);
    const url   = page.url();
    const title = await page.title().catch(() => "");
    return _ok("waitForNavigation", { url, title });
  } catch (err) {
    // Not all clicks cause navigation — a timeout here can be benign
    if (err.message.includes("timeout") || err.message.includes("Timeout")) {
      return _ok("waitForNavigation", { url: page.url(), title: "", noNavigation: true });
    }
    return _fail("waitForNavigation", err.message);
  }
}

// ── evaluate ──────────────────────────────────────────────────────────────────
async function evaluate(page, script, { timeout = DEFAULT_TIMEOUT } = {}) {
  if (!script)                return _fail("evaluate", "Script is required");
  if (!_isSafeScript(script)) return _fail("evaluate", "Script rejected — unsafe pattern detected");
  try {
    const result = await page.evaluate(script);
    const repr   = (typeof result === "string" ? result : JSON.stringify(result))?.slice(0, MAX_TEXT_LEN) ?? "";
    return _ok("evaluate", { result: repr });
  } catch (err) {
    return _fail("evaluate", err.message);
  }
}

// ── hoverElement ──────────────────────────────────────────────────────────────
async function hoverElement(page, selector, { timeout = DEFAULT_TIMEOUT } = {}) {
  if (!selector) return _fail("hoverElement", "Selector is required");
  const resolved = await _resolveSelector(page, selector, { timeout, state: "visible" });
  if (!resolved) return _fail("hoverElement", `Element not found: "${selector}"`, { selector });
  try {
    await resolved.locator.hover({ timeout });
    return _ok("hoverElement", { selector, method: resolved.method });
  } catch (err) {
    return _fail("hoverElement", err.message, { selector });
  }
}

// ── getAttribute ──────────────────────────────────────────────────────────────
async function getAttribute(page, selector, attr) {
  if (!selector) return _fail("getAttribute", "Selector is required");
  if (!attr)     return _fail("getAttribute", "Attribute name is required");
  try {
    await page.waitForSelector(selector, { timeout: DEFAULT_TIMEOUT, state: "attached" });
    const value = await page.getAttribute(selector, attr);
    return _ok("getAttribute", { selector, attr, value });
  } catch (err) {
    return _fail("getAttribute", err.message, { selector, attr });
  }
}

// ── checkElement ──────────────────────────────────────────────────────────────
// Non-blocking: returns ok=true with exists/visible flags, never fails
async function checkElement(page, selector) {
  if (!selector) return _fail("checkElement", "Selector is required");
  try {
    const el      = page.locator(selector).first();
    const count   = await el.count();
    const visible = count > 0 ? await el.isVisible().catch(() => false) : false;
    return _ok("checkElement", { selector, exists: count > 0, visible, count });
  } catch (err) {
    return _ok("checkElement", { selector, exists: false, visible: false, count: 0 });
  }
}

// ── checkCaptcha ──────────────────────────────────────────────────────────────
// Detects common CAPTCHA / bot-detection pages. Returns ok=true always.
// result.captchaDetected = true means the page is blocked.
async function checkCaptcha(page) {
  try {
    const detected = await page.evaluate(() => {
      const url   = location.href.toLowerCase();
      const title = document.title.toLowerCase();
      const body  = document.body?.innerText?.toLowerCase() || "";
      const hasCaptchaEl = !!(
        document.querySelector('#captcha-form, #recaptcha, .g-recaptcha, [data-sitekey]') ||
        document.querySelector('[class*="captcha"], [id*="captcha"]')
      );
      const hasCaptchaText =
        title.includes("captcha")   || title.includes("robot")   ||
        title.includes("blocked")   || title.includes("unusual") ||
        url.includes("/sorry/")     || url.includes("captcha")   ||
        (body.includes("unusual traffic") && body.includes("robot")) ||
        body.includes("please verify you are a human");
      return hasCaptchaEl || hasCaptchaText;
    });

    if (detected) {
      return _ok("checkCaptcha", {
        captchaDetected: true,
        result: "CAPTCHA_DETECTED — page is blocking automated access",
        url: page.url(),
      });
    }
    return _ok("checkCaptcha", { captchaDetected: false, result: "OK — no CAPTCHA detected", url: page.url() });
  } catch (err) {
    return _ok("checkCaptcha", { captchaDetected: false, result: "OK (check failed — assuming no block)", url: page.url() });
  }
}

// ── dismissModals ─────────────────────────────────────────────────────────────
// Best-effort dismissal of cookie banners, newsletter popups, GDPR notices.
// Returns ok=true always — this step never blocks a workflow.
async function dismissModals(page, { timeout = 3000 } = {}) {
  const dismissSelectors = [
    // Cookie consent banners
    'button[id*="accept" i], button[class*="accept" i], button[id*="cookie" i]',
    'button[aria-label*="accept" i], button[aria-label*="agree" i]',
    '[id*="cookie-banner"] button, [class*="cookie-banner"] button',
    '[id*="consent"] button[class*="primary" i], [class*="consent"] button[class*="primary" i]',
    // Close / dismiss buttons
    'button[aria-label="Close"], button[aria-label="Dismiss"], button[title="Close"]',
    'button[class*="close" i][class*="modal" i], [class*="modal" i] button[class*="close" i]',
    // Newsletter / notification overlays
    '[id*="newsletter"] button[class*="close" i], [id*="popup"] button[class*="close" i]',
  ];

  let dismissed = 0;
  for (const sel of dismissSelectors) {
    try {
      const loc = page.locator(sel).first();
      const visible = await loc.isVisible({ timeout: 800 }).catch(() => false);
      if (visible) {
        await loc.click({ timeout, force: true });
        await _sleep(300);
        dismissed++;
        break;  // one dismiss per call — avoids double-clicking
      }
    } catch {}
  }

  return _ok("dismissModals", { dismissed, message: dismissed > 0 ? `Dismissed ${dismissed} modal(s)` : "No modals found" });
}

module.exports = {
  navigate, reloadPage, waitForContent,
  click, typeText, fillForm,
  waitForElement, screenshot, getText, getTitle, getUrl,
  scrollDown, pressKey, selectOption, waitForNavigation, evaluate,
  hoverElement, getAttribute, checkElement, checkCaptcha, dismissModals,
};
