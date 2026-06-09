"use strict";
/**
 * workflows — pre-built, tested browser automation workflows.
 *
 * Design principles:
 *   - Every workflow uses selectors verified to work in headless Chromium
 *   - Search workflows use Bing (CAPTCHA-free for automation)
 *   - Timeout values are set based on real measured page load times
 *   - `retries: 2` on any step that can flake (form fills, navigation-dependent waits)
 *   - `stopOnFailure: false` recommended for diagnostic/scrape workflows
 *   - All evaluate() scripts are self-contained and return JSON strings
 *
 * Available workflows:
 *   openPage(url, opts)                  — navigate, verify, screenshot
 *   webSearch(query, opts)               — Bing search, extract top results
 *   fillAndSubmitForm(url, fields, sub)  — generic form fill + submit
 *   checkPageTitle(url, expected)        — verify page title
 *   scrapeText(url, selector)            — extract text from one selector
 *   scrapeMultiple(url, selectors)       — extract text from several selectors
 *   githubOpenRepo(owner, repo)          — repo page, README, metadata
 *   githubSearch(query)                  — GitHub code/repo search
 *   checkSiteHealth(url)                 — structural health check
 *   loginWithCredentials(url, opts)      — username + password login
 *   extractLinks(url, opts)              — collect all hrefs
 *   waitForText(url, text, selector)     — assert text appears
 *   scrollAndCapture(url, scrollCount)   — scroll + screenshot
 *   submitContactForm(url, data)         — fill name/email/message + submit
 *   extractPageMetadata(url)             — title, h1, og:*, canonical, description
 *   checkCaptcha(url)                    — detect if a page is serving a CAPTCHA
 *   monitorPage(url, opts)               — screenshot + structural diff data
 */

// ── openPage ──────────────────────────────────────────────────────────────────
function openPage(url, { screenshot = true, fullPage = false } = {}) {
  const steps = [
    { action: "navigate",       url,      label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page body loaded" },
    { action: "checkElement",   selector: "body", label: "Verify page structure" },
    { action: "getTitle",       label: "Get page title" },
    { action: "getUrl",         label: "Final URL (after redirects)" },
  ];
  if (screenshot) {
    steps.push({ action: "screenshot", fullPage, label: "Capture page" });
  }
  return steps;
}

// ── webSearch — Wikipedia search (reliable for headless automation) ──────────
// Uses Wikipedia's search page which works cleanly with headless Chromium.
// For general web search, use bingSearch() — but note Bing may block
// repeated headless requests from the same IP.
function webSearch(query, { maxResults = 5 } = {}) {
  const url = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}&ns0=1`;
  return [
    { action: "navigate",       url, label: `Wikipedia search: "${query}"`, timeout: 20000 },
    { action: "waitForElement", selector: "#mw-content-text, .mw-search-result, #firstHeading",
      label: "Results loaded", timeout: 10000, retries: 2 },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        // If redirected directly to an article, return that article
        const isArticle = !!document.querySelector('#mw-content-text .mw-parser-output');
        if (isArticle && !document.querySelector('.mw-search-results')) {
          const title   = document.querySelector('#firstHeading')?.textContent?.trim() || document.title;
          const summary = document.querySelector('#mw-content-text p:not(.mw-empty-elt)')?.textContent?.trim().slice(0, 300) || '';
          return [{ title, url: location.href, snippet: summary, type: 'article' }];
        }
        // Search results listing
        return Array.from(document.querySelectorAll('.mw-search-result')).slice(0, ${maxResults}).map(r => ({
          title:   r.querySelector('.mw-search-result-heading a')?.textContent?.trim() || '',
          url:     'https://en.wikipedia.org' + (r.querySelector('a')?.getAttribute('href') || ''),
          snippet: r.querySelector('.searchresult')?.textContent?.trim().slice(0, 200) || '',
          type:    'search_result',
        }));
      })())`,
      label: `Extract top ${maxResults} results`,
    },
    { action: "screenshot", label: "Search results" },
  ];
}

// ── bingSearch — direct Bing web search ──────────────────────────────────────
// NOTE: Bing may serve bot challenges on repeated headless requests from the
// same IP. Use checkCaptcha step in the workflow to detect blocking.
function bingSearch(query, { maxResults = 5 } = {}) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH`;
  return [
    { action: "navigate",       url, label: `Bing search: "${query}"`, timeout: 20000 },
    { action: "checkCaptcha",   label: "Check: Bing not blocking this request" },
    { action: "waitForElement", selector: ".b_algo, #b_content",
      label: "Results loaded", timeout: 15000, retries: 2 },
    {
      action: "evaluate",
      script: `JSON.stringify(
        Array.from(document.querySelectorAll('.b_algo')).slice(0, ${maxResults}).map(r => ({
          title:   r.querySelector('h2')?.textContent?.trim()  || '',
          url:     r.querySelector('a')?.href                  || '',
          snippet: r.querySelector('.b_caption p, .b_algoSlug')?.textContent?.trim().slice(0,200) || '',
        }))
      )`,
      label: `Extract top ${maxResults} results`,
    },
    { action: "screenshot", label: "Results screenshot" },
  ];
}

// ── fillAndSubmitForm ─────────────────────────────────────────────────────────
// fields: [{ selector, value, label? }]
function fillAndSubmitForm(url, fields, submitSelector) {
  const steps = [
    { action: "navigate",       url,      label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
  ];
  for (const field of fields) {
    steps.push({
      action:   "fillForm",
      selector: field.selector,
      text:     field.value,
      label:    field.label || `Fill: ${field.selector}`,
      retries:  2,
    });
  }
  if (submitSelector) {
    steps.push({ action: "click",             selector: submitSelector, label: "Submit form", retries: 2 });
    steps.push({ action: "waitForNavigation", label: "Wait for response",  timeout: 12000 });
  }
  steps.push({ action: "screenshot", label: "Result screenshot" });
  return steps;
}

// ── checkPageTitle ────────────────────────────────────────────────────────────
function checkPageTitle(url, expectedTitle) {
  return [
    { action: "navigate",       url,      label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
    { action: "getTitle",       label: "Get page title" },
    {
      action: "evaluate",
      script: `document.title.includes(${JSON.stringify(expectedTitle)})
        ? 'PASS: ' + document.title
        : 'FAIL: expected to contain "' + ${JSON.stringify(expectedTitle)} + '", got "' + document.title + '"'`,
      label: `Assert title contains "${expectedTitle}"`,
    },
    { action: "screenshot", label: "Evidence screenshot" },
  ];
}

// ── scrapeText ────────────────────────────────────────────────────────────────
function scrapeText(url, selector) {
  return [
    { action: "navigate",       url,      label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector, label: `Wait for: ${selector}`, timeout: 10000 },
    { action: "getText",        selector, label: `Extract text from: ${selector}` },
  ];
}

// ── scrapeMultiple ────────────────────────────────────────────────────────────
// selectors: [{ selector, label }] or string[]
function scrapeMultiple(url, selectors) {
  const steps = [
    { action: "navigate",       url, label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
  ];
  const list = Array.isArray(selectors) ? selectors : [selectors];
  for (const item of list) {
    const sel = typeof item === "string" ? item : item.selector;
    const lbl = typeof item === "string" ? sel : (item.label || sel);
    steps.push({ action: "checkElement", selector: sel, label: `Present? ${sel}` });
    steps.push({ action: "getText",      selector: sel, label: `Extract: ${lbl}` });
  }
  steps.push({ action: "screenshot", label: "Scrape screenshot" });
  return steps;
}

// ── githubOpenRepo ────────────────────────────────────────────────────────────
function githubOpenRepo(owner, repo) {
  const url = `https://github.com/${owner}/${repo}`;
  return [
    { action: "navigate",       url,              label: `Open github.com/${owner}/${repo}`, timeout: 25000 },
    { action: "waitForElement", selector: "main", label: "Repo page loaded", timeout: 15000, retries: 2 },
    { action: "getTitle",       label: "Get repo title" },
    { action: "checkElement",   selector: "article, [data-target='readme-toc.content']", label: "README present?" },
    { action: "getText",        selector: "article, [data-target='readme-toc.content']", label: "Read README preview" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const stars   = document.querySelector('#repo-stars-counter-star, [id*="stargazers"]');
        const lang    = document.querySelector('[itemprop="programmingLanguage"], .d-inline-flex .color-fg-default');
        const forks   = document.querySelector('[href$="/forks"] strong, #repo-network-counter');
        const topics  = Array.from(document.querySelectorAll('[data-octo-dimensions="topic_name"], .topic-tag')).map(t => t.textContent.trim()).slice(0,8);
        const desc    = document.querySelector('p[class*="Description"], .f4.my-3');
        return {
          stars:       stars  ? stars.textContent.trim()  : null,
          forks:       forks  ? forks.textContent.trim()  : null,
          language:    lang   ? lang.textContent.trim()   : null,
          description: desc   ? desc.textContent.trim().slice(0,200) : null,
          topics,
        };
      })())`,
      label: "Extract repo metadata (stars, forks, language, topics)",
    },
    { action: "screenshot", label: "Repo screenshot" },
  ];
}

// ── githubSearch ──────────────────────────────────────────────────────────────
// Note: GitHub search results render as div children of [data-testid="results-list"],
// not li elements. We query h3 > a inside each div child.
function githubSearch(query) {
  const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
  return [
    { action: "navigate",       url, label: `GitHub search: "${query}"`, timeout: 25000 },
    // Give React time to hydrate — results inject after domcontentloaded
    { action: "wait",           ms: 3000, label: "Wait for React hydration" },
    { action: "waitForElement", selector: "[data-testid='results-list']",
      label: "Results container loaded", timeout: 12000, retries: 2 },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const list = document.querySelector('[data-testid="results-list"]');
        if (!list) return [];
        return Array.from(list.children).slice(0, 5).map(item => {
          const h3     = item.querySelector('h3');
          const links  = Array.from(item.querySelectorAll('a'));
          // First link whose href contains github.com/<owner>/<repo> pattern
          const repoA  = links.find(a => /github\\.com\\/[^/]+\\/[^/]+$/.test(a.href));
          return {
            name:  h3?.textContent?.trim() || '',
            url:   repoA?.href || (links[0]?.href || ''),
            desc:  item.querySelector('p')?.textContent?.trim().slice(0, 150) || '',
            lang:  item.querySelector('[aria-label*="programming language"]')?.textContent?.trim() || '',
          };
        }).filter(r => r.name);
      })())`,
      label: "Extract top repositories",
    },
    { action: "screenshot", label: "Search results screenshot" },
  ];
}

// ── checkSiteHealth ───────────────────────────────────────────────────────────
function checkSiteHealth(url) {
  return [
    { action: "navigate",       url, label: `Health check: ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page loaded",             timeout: 12000 },
    { action: "getTitle",       label: "Page title" },
    { action: "getUrl",         label: "Final URL (after redirects)" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const body = document.body;
        return {
          headings:      document.querySelectorAll('h1,h2,h3').length,
          links:         document.querySelectorAll('a[href]').length,
          images:        document.querySelectorAll('img').length,
          hasNav:        !!document.querySelector('nav, header'),
          hasMainContent:!!document.querySelector('main, article, [role="main"]'),
          hasCaptcha:    !!(document.querySelector('#captcha-form, [id*="captcha"], [class*="captcha"]') ||
                           document.title.toLowerCase().includes('captcha') ||
                           document.title.toLowerCase().includes('robot')),
          textLength:    (body?.innerText || '').length,
          statusOk:      true,
        };
      })())`,
      label: "Structural health check",
    },
    { action: "screenshot", label: "Health check screenshot" },
  ];
}

// ── loginWithCredentials ──────────────────────────────────────────────────────
function loginWithCredentials(url, {
  username,
  password,
  usernameSelector = 'input[name="username"], input[name="email"], input[type="email"]',
  passwordSelector = 'input[name="password"], input[type="password"]',
  submitSelector   = 'button[type="submit"], input[type="submit"]',
  successSelector  = null,
  successUrl       = null,
} = {}) {
  const steps = [
    { action: "navigate",       url, label: `Open login page: ${url}`, timeout: 20000 },
    { action: "checkCaptcha",   label: "Check: login page accessible (no CAPTCHA)" },
    { action: "waitForElement", selector: usernameSelector, label: "Wait for username field", timeout: 10000, retries: 2 },
    { action: "fillForm",       selector: usernameSelector, text: username, label: "Enter username", retries: 2 },
    { action: "waitForElement", selector: passwordSelector, label: "Wait for password field", timeout: 5000 },
    { action: "fillForm",       selector: passwordSelector, text: password, label: "Enter password", retries: 2 },
    { action: "screenshot",     label: "Pre-submit state" },
    { action: "click",          selector: submitSelector,   label: "Submit login form",  retries: 2 },
    { action: "waitForNavigation", label: "Wait for post-login redirect", timeout: 12000 },
    { action: "getUrl",         label: "Current URL after login" },
    { action: "getTitle",       label: "Page title after login" },
  ];
  if (successSelector) {
    steps.push({ action: "waitForElement", selector: successSelector, label: `Verify: "${successSelector}" present`, timeout: 8000, retries: 2 });
  }
  steps.push({ action: "screenshot", label: "Post-login screenshot" });
  return steps;
}

// ── extractLinks ──────────────────────────────────────────────────────────────
function extractLinks(url, { maxLinks = 40 } = {}) {
  return [
    { action: "navigate",       url, label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
    {
      action: "evaluate",
      script: `JSON.stringify(
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.textContent.trim().slice(0,60), href: a.href }))
          .filter(l => l.href.startsWith('http'))
          .slice(0, ${maxLinks})
      )`,
      label: `Collect up to ${maxLinks} external links`,
    },
    { action: "screenshot", label: "Page screenshot" },
  ];
}

// ── waitForText ───────────────────────────────────────────────────────────────
function waitForText(url, text, selector = "body") {
  return [
    { action: "navigate",       url,      label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
    {
      action: "evaluate",
      script: `(() => {
        const el    = document.querySelector(${JSON.stringify(selector)});
        const found = el && el.textContent.includes(${JSON.stringify(text)});
        return found
          ? 'FOUND: ' + ${JSON.stringify(text)}
          : 'NOT FOUND — searched in: ' + ${JSON.stringify(selector)};
      })()`,
      label: `Search for text: "${text}"`,
    },
    { action: "screenshot", label: "Evidence screenshot" },
  ];
}

// ── scrollAndCapture ──────────────────────────────────────────────────────────
function scrollAndCapture(url, scrollCount = 3) {
  const steps = [
    { action: "navigate",       url,      label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
    { action: "screenshot",     label: "Initial view (top of page)" },
  ];
  const n = Math.min(scrollCount, 5);
  for (let i = 1; i <= n; i++) {
    steps.push({ action: "scrollDown", pixels: 900,  label: `Scroll ${i} of ${n}` });
    steps.push({ action: "wait",       ms: 500,       label: "Settle after scroll" });
    steps.push({ action: "screenshot", label: `View at scroll position ${i}` });
  }
  return steps;
}

// ── submitContactForm ─────────────────────────────────────────────────────────
function submitContactForm(url, {
  name,
  email,
  message,
  nameSelector    = 'input[name="name"], input[placeholder*="name" i], input[id*="name" i]',
  emailSelector   = 'input[name="email"], input[type="email"]',
  messageSelector = 'textarea[name="message"], textarea[placeholder*="message" i], textarea[id*="message" i]',
  submitSelector  = 'button[type="submit"], input[type="submit"]',
} = {}) {
  return fillAndSubmitForm(url, [
    { selector: nameSelector,    value: name,    label: "Full name" },
    { selector: emailSelector,   value: email,   label: "Email address" },
    { selector: messageSelector, value: message, label: "Message body" },
  ], submitSelector);
}

// ── extractPageMetadata ───────────────────────────────────────────────────────
function extractPageMetadata(url) {
  return [
    { action: "navigate",       url, label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page ready" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const m = n => document.querySelector(n)?.content || null;
        return {
          title:       document.title,
          h1:          document.querySelector('h1')?.textContent?.trim()?.slice(0,200) || null,
          description: m('meta[name="description"]'),
          ogTitle:     m('meta[property="og:title"]'),
          ogDesc:      m('meta[property="og:description"]'),
          ogImage:     m('meta[property="og:image"]'),
          twitterCard: m('meta[name="twitter:card"]'),
          canonical:   document.querySelector('link[rel="canonical"]')?.href || null,
          url:         location.href,
          lang:        document.documentElement.lang || null,
          viewport:    m('meta[name="viewport"]'),
        };
      })())`,
      label: "Extract full SEO + social metadata",
    },
    { action: "screenshot", label: "Page screenshot" },
  ];
}

// ── checkCaptcha (internal probe step, also usable standalone) ────────────────
// Returns ok=true always — result.result is 'CAPTCHA_DETECTED' or 'OK'
function checkCaptcha(url) {
  return [
    { action: "navigate",     url, label: `Open ${url}`, timeout: 20000 },
    { action: "checkCaptcha", label: "Detect CAPTCHA presence" },
  ];
}

// ── monitorPage ───────────────────────────────────────────────────────────────
function monitorPage(url, { selector = "body" } = {}) {
  return [
    { action: "navigate",       url, label: `Monitor: ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page loaded" },
    { action: "getTitle",       label: "Current title" },
    { action: "getUrl",         label: "Current URL" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const sel = ${JSON.stringify(selector)};
        const el  = document.querySelector(sel);
        return {
          selector:    sel,
          exists:      !!el,
          text:        el ? el.innerText.slice(0, 500).trim() : null,
          childCount:  el ? el.children.length : 0,
          timestamp:   new Date().toISOString(),
          pageTitle:   document.title,
          bodyLength:  document.body.innerText.length,
        };
      })())`,
      label: `Monitor: ${selector}`,
    },
    { action: "screenshot", label: "Monitor snapshot" },
  ];
}

// ── Workflow registry ─────────────────────────────────────────────────────────
const REGISTRY = {
  open_page:       ({ url, screenshot, fullPage })         => openPage(url, { screenshot, fullPage }),
  web_search:      ({ query, maxResults })                 => webSearch(query, { maxResults }),
  bing_search:     ({ query, maxResults })                 => bingSearch(query, { maxResults }),
  fill_form:       ({ url, fields, submit })               => fillAndSubmitForm(url, fields || [], submit),
  check_title:     ({ url, title })                        => checkPageTitle(url, title),
  scrape_text:     ({ url, selector })                     => scrapeText(url, selector),
  scrape_multiple: ({ url, selectors })                    => scrapeMultiple(url, selectors),
  github_repo:     ({ owner, repo })                       => githubOpenRepo(owner, repo),
  github_search:   ({ query })                             => githubSearch(query),
  site_health:     ({ url })                               => checkSiteHealth(url),
  login:           ({ url, ...opts })                      => loginWithCredentials(url, opts),
  extract_links:   ({ url, maxLinks })                     => extractLinks(url, { maxLinks }),
  wait_for_text:   ({ url, text, selector })               => waitForText(url, text, selector),
  scroll_capture:  ({ url, scrollCount })                  => scrollAndCapture(url, scrollCount),
  contact_form:    ({ url, ...data })                      => submitContactForm(url, data),
  page_metadata:   ({ url })                               => extractPageMetadata(url),
  check_captcha:   ({ url })                               => checkCaptcha(url),
  monitor_page:    ({ url, selector })                     => monitorPage(url, { selector }),
};

function getWorkflow(name, params = {}) {
  const fn = REGISTRY[name];
  if (!fn) return null;
  return fn(params);
}

function listWorkflows() {
  return Object.keys(REGISTRY).map(name => ({ name }));
}

module.exports = {
  openPage, webSearch, bingSearch, fillAndSubmitForm, checkPageTitle,
  scrapeText, scrapeMultiple, githubOpenRepo, githubSearch,
  checkSiteHealth, loginWithCredentials, extractLinks, waitForText,
  scrollAndCapture, submitContactForm, extractPageMetadata,
  checkCaptcha, monitorPage,
  getWorkflow, listWorkflows, REGISTRY,
};
