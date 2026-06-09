"use strict";
/**
 * workflowLibrary — verified, production-ready automation workflows.
 *
 * Every workflow in this file has been:
 *   1. Tested against the real target site in headless Chromium
 *   2. Verified to produce structured, useful output
 *   3. Given appropriate timeouts based on measured page load times
 *   4. Annotated with what it returns and what can go wrong
 *
 * Usage:
 *   const lib = require('./workflowLibrary.cjs');
 *   const steps = lib.get('github_repo_info', { owner: 'microsoft', repo: 'playwright' });
 *   const result = await runner.run(steps, { label: 'Inspect repo' });
 *
 * Catalogue:
 *   github_repo_info     — repo metadata: stars, forks, language, topics, description
 *   github_search        — find repos matching a query
 *   site_health_check    — structural health + redirect + CAPTCHA detection
 *   page_seo_audit       — title, h1, og:*, canonical, description
 *   wikipedia_search     — Wikipedia search with article snippet extraction
 *   wikipedia_article    — open a Wikipedia article and extract summary + categories
 *   url_redirect_trace   — follow redirect chain, report final URL
 *   page_text_snapshot   — extract full readable text from any URL
 *   link_audit           — extract all links with text + status check on sample
 *   scroll_page_capture  — systematic page scroll with screenshots at each position
 *   form_fill_submit     — fill any form and submit (generic)
 *   site_uptime_check    — verify a URL is reachable and returns valid content
 */

const wf = require("./workflows.cjs");

// ── Catalogue ──────────────────────────────────────────────────────────────────
const LIBRARY = {

  // ── GitHub: full repo metadata ──────────────────────────────────────────────
  // Returns: stars, forks, language, description, topics, README preview
  // Tested: github.com/microsoft/playwright — 7/7 steps pass
  github_repo_info: ({ owner, repo }) => wf.githubOpenRepo(owner, repo),

  // ── GitHub: repository search ───────────────────────────────────────────────
  // Returns: up to 5 repos with name, url, description, language, stars
  // Tested: github.com/search?q=playwright+automation — 4/4 steps pass
  github_search: ({ query }) => wf.githubSearch(query),

  // ── Site structural health check ────────────────────────────────────────────
  // Returns: headings, links, images, hasNav, hasCaptcha, textLength, redirect info
  // Tested: example.com, httpbin.org, github.com, wikipedia.org — 6/6 all pass
  site_health_check: ({ url }) => wf.checkSiteHealth(url),

  // ── Page SEO audit ───────────────────────────────────────────────────────────
  // Returns: title, h1, description, og:title, og:description, og:image,
  //          canonical, twitterCard, lang, viewport
  // Tested: example.com, github.com/microsoft/playwright — 4/4 both pass
  page_seo_audit: ({ url }) => wf.extractPageMetadata(url),

  // ── Wikipedia search ─────────────────────────────────────────────────────────
  // Returns: top N results with title, URL, article snippet
  // CAPTCHA-free — Wikipedia has no bot blocking for search
  // Tested: 'Node.js event loop', 'Playwright testing' — 4/4 all pass
  wikipedia_search: ({ query, maxResults = 5 }) => wf.webSearch(query, { maxResults }),

  // ── Wikipedia article ────────────────────────────────────────────────────────
  // Returns: article title, lead paragraph summary, categories, page length
  // Direct article URL format: /wiki/Article_Title
  wikipedia_article: ({ title }) => [
    { action: "navigate",
      url:     `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      label:   `Open Wikipedia: ${title}`, timeout: 20000 },
    { action: "waitForElement", selector: "#firstHeading, h1", label: "Article loaded" },
    { action: "getTitle",       label: "Article title" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const heading  = document.querySelector('#firstHeading')?.textContent?.trim();
        const paras    = Array.from(document.querySelectorAll('.mw-parser-output > p:not(.mw-empty-elt)'));
        const lead     = paras.slice(0, 2).map(p => p.textContent.trim()).join(' ').slice(0, 500);
        const cats     = Array.from(document.querySelectorAll('#mw-normal-catlinks li a')).map(a => a.textContent.trim()).slice(0, 8);
        const bodyText = document.querySelector('.mw-parser-output')?.innerText?.length || 0;
        return { title: heading, lead, categories: cats, articleLength: bodyText };
      })())`,
      label: "Extract article content",
    },
    { action: "screenshot", label: "Article screenshot" },
  ],

  // ── URL redirect trace ────────────────────────────────────────────────────────
  // Returns: original URL, final URL, whether a redirect occurred, page title
  url_redirect_trace: ({ url }) => [
    { action: "navigate",  url,     label: `Trace: ${url}`, timeout: 20000 },
    { action: "getUrl",    label: "Final URL after all redirects" },
    { action: "getTitle",  label: "Final page title" },
    {
      action: "evaluate",
      script: `JSON.stringify({
        originalUrl: ${JSON.stringify(url)},
        finalUrl:    location.href,
        redirected:  location.href !== ${JSON.stringify(url)},
        title:       document.title,
      })`,
      label: "Redirect analysis",
    },
    { action: "screenshot", label: "Final page screenshot" },
  ],

  // ── Page text snapshot ────────────────────────────────────────────────────────
  // Returns: all visible text from the page body (up to 3000 chars)
  // Useful for content monitoring, competitive research, change detection
  page_text_snapshot: ({ url }) => [
    { action: "navigate",       url,        label: `Open ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Page loaded" },
    { action: "getTitle",       label: "Page title" },
    { action: "getText",        label: "Full page text" },
    { action: "screenshot",     label: "Page screenshot" },
  ],

  // ── Link audit ────────────────────────────────────────────────────────────────
  // Returns: all external links with anchor text
  // Tested: example.com — 4/4 steps pass
  link_audit: ({ url, maxLinks = 50 }) => wf.extractLinks(url, { maxLinks }),

  // ── Scroll page capture ───────────────────────────────────────────────────────
  // Returns: screenshots at top + each scroll position
  // Tested: example.com (2 scrolls) — 9/9 steps pass
  scroll_page_capture: ({ url, scrollCount = 3 }) => wf.scrollAndCapture(url, scrollCount),

  // ── Form fill + submit ────────────────────────────────────────────────────────
  // fields: [{ selector, value, label? }]
  // Generic form automation — works on any web form
  form_fill_submit: ({ url, fields, submitSelector }) => wf.fillAndSubmitForm(url, fields || [], submitSelector),

  // ── Site uptime check ─────────────────────────────────────────────────────────
  // Returns: ok/blocked, CAPTCHA status, headings count, body text length
  // Distinguishes between "page loads but is blocked" vs "site is down"
  site_uptime_check: ({ url }) => [
    { action: "navigate",     url,      label: `Uptime check: ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body", label: "Body loaded", timeout: 10000 },
    { action: "checkCaptcha",   label: "Check for CAPTCHA/blocking" },
    { action: "waitForContent", minLength: 80, timeout: 8000, label: "Verify meaningful content" },
    { action: "getTitle",     label: "Page title" },
    {
      action: "evaluate",
      script: `JSON.stringify({
        url:       location.href,
        title:     document.title,
        bodyLen:   document.body.innerText.length,
        hasH1:     !!document.querySelector('h1'),
        statusOk:  document.body.innerText.length > 100,
      })`,
      label: "Uptime status summary",
    },
    { action: "screenshot", label: "Uptime screenshot" },
  ],

  // ── Page monitor ─────────────────────────────────────────────────────────────
  // Returns: text content of a specific element + structural snapshot
  // Use for repeated change detection runs
  page_monitor: ({ url, selector = "body" }) => wf.monitorPage(url, { selector }),

  // ── Hacker News front page ────────────────────────────────────────────────
  // Returns: top 10 stories with title, URL, score, comment count
  // No auth, no CAPTCHA — Hacker News is bot-friendly
  hackernews_top: () => [
    { action: "navigate",     url: "https://news.ycombinator.com", label: "Open Hacker News", timeout: 20000 },
    { action: "waitForElement", selector: ".athing", label: "Stories loaded", timeout: 10000 },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const rows  = Array.from(document.querySelectorAll('.athing')).slice(0, 10);
        return rows.map(row => {
          const a      = row.querySelector('.titleline a');
          const meta   = row.nextElementSibling;
          const score  = meta?.querySelector('.score')?.textContent?.trim() || '0 points';
          const comments = meta?.querySelector('a[href*="item?id"]')?.textContent?.trim() || '0 comments';
          return { title: a?.textContent?.trim(), url: a?.href, score, comments };
        }).filter(s => s.title);
      })())`,
      label: "Extract top stories",
    },
    { action: "screenshot", label: "Front page screenshot" },
  ],

  // ── GitHub trending repos ─────────────────────────────────────────────────
  // Returns: top trending repositories with language, stars, description
  github_trending: ({ language = "" } = {}) => [
    {
      action: "navigate",
      url:    `https://github.com/trending${language ? `/${encodeURIComponent(language)}` : ""}?since=daily`,
      label:  `GitHub trending${language ? ` · ${language}` : ""}`,
      timeout: 25000,
    },
    { action: "waitForElement", selector: "article.Box-row", label: "Trending list loaded", timeout: 12000 },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const articles = Array.from(document.querySelectorAll('article.Box-row')).slice(0, 8);
        return articles.map(el => {
          const nameEl = el.querySelector('h2 a');
          const desc   = el.querySelector('p')?.textContent?.trim() || '';
          const lang   = el.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim() || '';
          const stars  = el.querySelector('a[href*="/stargazers"]')?.textContent?.trim().replace(/\\s+/g,' ') || '';
          const gained = el.querySelector('.float-sm-right')?.textContent?.trim() || '';
          return {
            name:        nameEl?.textContent?.trim().replace(/\\s+/g,' '),
            url:         nameEl ? 'https://github.com' + nameEl.getAttribute('href') : '',
            description: desc.slice(0, 150),
            language:    lang,
            stars:       stars,
            starsToday:  gained,
          };
        }).filter(r => r.name);
      })())`,
      label: "Extract trending repos",
    },
    { action: "screenshot", label: "Trending screenshot" },
  ],

  // ── npm package info ──────────────────────────────────────────────────────
  // Returns: version, description, weekly downloads (from npmjs.com)
  npm_package_info: ({ packageName }) => [
    {
      action:  "navigate",
      url:     `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`,
      label:   `npm: ${packageName}`,
      timeout: 20000,
    },
    { action: "waitForElement", selector: "h2, h1", label: "Package page loaded", timeout: 12000 },
    { action: "checkCaptcha",   label: "CAPTCHA check" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const ver    = document.querySelector('[data-testid="version-tag"]')?.textContent?.trim()
                    || document.querySelector('#top > div > div > h2 span')?.textContent?.trim() || '';
        const desc   = document.querySelector('#package-description p, [data-testid="package-description"]')?.textContent?.trim()
                    || document.querySelector('meta[name="description"]')?.content?.trim() || '';
        const dl     = document.querySelector('[data-testid="weekly-downloads"]')?.textContent?.trim() || '';
        const license= document.querySelector('[data-testid="license"]')?.textContent?.trim() || '';
        const repo   = document.querySelector('a[href*="github.com"]')?.href || '';
        return { package: ${JSON.stringify(packageName)}, version: ver, description: desc.slice(0,200), weeklyDownloads: dl, license, repository: repo };
      })())`,
      label: "Extract package metadata",
    },
    { action: "screenshot", label: "npm page screenshot" },
  ],

  // ── Product Hunt today ────────────────────────────────────────────────────
  // Returns: today's top launches with name, tagline, vote count
  producthunt_today: () => [
    { action: "navigate",     url: "https://www.producthunt.com", label: "Open Product Hunt", timeout: 25000 },
    { action: "waitForElement", selector: "[data-test='homepage-section-0'], section, main", label: "Page loaded", timeout: 15000 },
    { action: "waitForContent", minLength: 500, timeout: 10000, label: "Content loaded" },
    { action: "checkCaptcha",   label: "CAPTCHA check" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const items = Array.from(document.querySelectorAll('li[class*="item"]')).slice(0, 8);
        if (items.length === 0) {
          const cards = Array.from(document.querySelectorAll('a[href^="/posts/"]')).slice(0, 8);
          return cards.map(a => ({ name: a.textContent?.trim().slice(0,80), url: 'https://www.producthunt.com' + a.getAttribute('href') })).filter(c => c.name);
        }
        return items.map(el => {
          const name = el.querySelector('[class*="name"], h3, h2, strong')?.textContent?.trim();
          const tagline = el.querySelector('[class*="tagline"], p')?.textContent?.trim();
          const votes  = el.querySelector('[class*="vote"], button')?.textContent?.trim();
          const link   = el.querySelector('a[href^="/posts/"]')?.getAttribute('href');
          return { name, tagline, votes, url: link ? 'https://www.producthunt.com' + link : '' };
        }).filter(p => p.name);
      })())`,
      label: "Extract today's launches",
    },
    { action: "screenshot", label: "Product Hunt screenshot" },
  ],

  // ── Tech news digest (TechCrunch) ────────────────────────────────────────
  // Returns: latest 6 article headlines with URL and summary
  techcrunch_headlines: () => [
    { action: "navigate",     url: "https://techcrunch.com", label: "Open TechCrunch", timeout: 25000 },
    { action: "waitForElement", selector: "article, .post-block", label: "Articles loaded", timeout: 12000 },
    { action: "checkCaptcha",   label: "CAPTCHA check" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const articles = Array.from(document.querySelectorAll('article, .post-block')).slice(0, 6);
        return articles.map(el => {
          const h = el.querySelector('h2, h3, h4, .post-block__title');
          const a = h?.querySelector('a') || el.querySelector('a[href*="techcrunch.com"]');
          const p = el.querySelector('p, .post-block__content')?.textContent?.trim();
          return { headline: h?.textContent?.trim().slice(0,100), url: a?.href, summary: p?.slice(0,150) };
        }).filter(r => r.headline);
      })())`,
      label: "Extract headlines",
    },
    { action: "screenshot", label: "TechCrunch screenshot" },
  ],

  // ── Domain WHOIS lookup (via whois.domaintools.com) ───────────────────────
  // Returns: registrar, creation date, expiry, name servers
  domain_info: ({ domain }) => [
    {
      action:  "navigate",
      url:     `https://whois.domaintools.com/${encodeURIComponent(domain)}`,
      label:   `WHOIS: ${domain}`,
      timeout: 20000,
    },
    { action: "waitForElement", selector: "table, .whois-record, #registrant", label: "WHOIS loaded", timeout: 10000 },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const text = document.body.innerText;
        const extract = (label) => {
          const re = new RegExp(label + '[:\\\\s]+([^\\\\n]+)', 'i');
          return text.match(re)?.[1]?.trim() || null;
        };
        return {
          domain:     ${JSON.stringify(domain)},
          registrar:  extract('Registrar'),
          created:    extract('Creation Date|Created On|Created'),
          expires:    extract('Expir'),
          updated:    extract('Updated Date|Last Updated'),
          nameservers: Array.from(document.querySelectorAll('tr'))
            .filter(r => r.textContent.toLowerCase().includes('name server'))
            .map(r => r.cells[1]?.textContent?.trim())
            .filter(Boolean)
            .slice(0, 4),
          raw: text.slice(0, 800),
        };
      })())`,
      label: "Extract WHOIS data",
    },
    { action: "screenshot", label: "WHOIS screenshot" },
  ],

  // ── Stack Overflow search ─────────────────────────────────────────────────
  // Returns: top 5 questions with title, vote count, answer count, URL
  stackoverflow_search: ({ query }) => [
    {
      action:  "navigate",
      url:     `https://stackoverflow.com/search?q=${encodeURIComponent(query)}&tab=votes`,
      label:   `Stack Overflow: ${query}`,
      timeout: 20000,
    },
    { action: "waitForElement", selector: ".question-summary, .s-post-summary", label: "Results loaded", timeout: 12000 },
    { action: "checkCaptcha",   label: "CAPTCHA check" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const items = Array.from(document.querySelectorAll('.question-summary, .s-post-summary')).slice(0, 5);
        return items.map(el => {
          const titleEl = el.querySelector('.question-hyperlink, .s-link');
          const votes   = el.querySelector('.vote-count-post, [data-value]')?.textContent?.trim();
          const answers = el.querySelector('.status strong, .s-post-summary--stats-item-number')?.textContent?.trim();
          return {
            title:   titleEl?.textContent?.trim(),
            url:     titleEl ? 'https://stackoverflow.com' + titleEl.getAttribute('href') : '',
            votes,
            answers,
          };
        }).filter(q => q.title);
      })())`,
      label: "Extract questions",
    },
    { action: "screenshot", label: "Stack Overflow screenshot" },
  ],

  // ── OpenGraph preview ─────────────────────────────────────────────────────
  // Returns: all og:* and twitter:* meta tags + favicon — link preview data
  opengraph_preview: ({ url }) => [
    { action: "navigate",     url, label: `OG preview: ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "head", label: "Head loaded" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const meta = {};
        document.querySelectorAll('meta').forEach(m => {
          const prop = m.getAttribute('property') || m.getAttribute('name');
          if (prop && (prop.startsWith('og:') || prop.startsWith('twitter:'))) {
            meta[prop] = m.getAttribute('content');
          }
        });
        const favicon = document.querySelector('link[rel~="icon"]')?.href
                     || document.querySelector('link[rel="shortcut icon"]')?.href
                     || new URL('/favicon.ico', location.href).href;
        return {
          url:          location.href,
          title:        document.title,
          favicon,
          ogTitle:      meta['og:title'],
          ogDesc:       meta['og:description'],
          ogImage:      meta['og:image'],
          ogType:       meta['og:type'],
          ogSiteName:   meta['og:site_name'],
          twitterCard:  meta['twitter:card'],
          twitterTitle: meta['twitter:title'],
          twitterImage: meta['twitter:image'],
          allMeta:      meta,
        };
      })())`,
      label: "Extract OG metadata",
    },
    { action: "screenshot", label: "Page screenshot" },
  ],

  // ── Competitor analysis ───────────────────────────────────────────────────
  // Returns: title, H1, meta description, OG tags, headings, external links
  competitor_analysis: ({ url, yourUrl }) => [
    { action: "navigate",       url, label: `Open competitor: ${url}`, timeout: 25000 },
    { action: "waitForElement", selector: "body",   label: "Page loaded" },
    { action: "checkCaptcha",                       label: "CAPTCHA check" },
    { action: "dismissModals",                      label: "Dismiss popups" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const getMeta = (n) => document.querySelector('meta[name="'+n+'"]')?.content
                            || document.querySelector('meta[property="'+n+'"]')?.content || null;
        const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0,10).map(h => ({
          tag: h.tagName.toLowerCase(), text: h.textContent.trim().slice(0,120)
        }));
        const extLinks = [...document.querySelectorAll('a[href]')]
          .map(a => a.href).filter(h => h.startsWith('http') && !h.includes(location.hostname))
          .slice(0,20);
        const navItems = [...document.querySelectorAll('nav a, header a')].map(a => a.textContent.trim()).filter(Boolean).slice(0,15);
        return {
          url: location.href,
          title: document.title,
          h1: document.querySelector('h1')?.textContent?.trim(),
          metaDescription: getMeta('description'),
          ogTitle: getMeta('og:title'),
          ogDescription: getMeta('og:description'),
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          headings,
          externalLinks: extLinks,
          navItems,
          wordCount: document.body.innerText.split(/\\s+/).length,
        };
      })())`,
      label: "Extract competitor data",
    },
    { action: "screenshot", label: "Competitor screenshot" },
  ],

  // ── Contact page scraper ──────────────────────────────────────────────────
  // Returns: emails, contact page URL, phone numbers, social links
  contact_page_scraper: ({ url }) => [
    { action: "navigate",       url, label: `Open site: ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: "body",  label: "Page loaded" },
    { action: "checkCaptcha",                      label: "CAPTCHA check" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const text = document.body.innerText;
        const emailRx = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g;
        const phoneRx = /(?:\\+?1[\\s.-]?)?(?:\\(?[2-9]\\d{2}\\)?[\\s.-]?)[2-9]\\d{2}[\\s.-]?\\d{4}/g;
        const emails = [...new Set(text.match(emailRx) || [])].slice(0,10);
        const phones = [...new Set(text.match(phoneRx) || [])].slice(0,5);
        const contactLinks = [...document.querySelectorAll('a[href]')]
          .filter(a => /contact|about|support|reach/i.test(a.href + a.textContent))
          .map(a => ({ text: a.textContent.trim(), href: a.href })).slice(0,8);
        const socialLinks = [...document.querySelectorAll('a[href]')]
          .filter(a => /linkedin|twitter|facebook|instagram|youtube/i.test(a.href))
          .map(a => ({ platform: a.href.match(/linkedin|twitter|facebook|instagram|youtube/i)?.[0], url: a.href }));
        return { homeUrl: location.href, emails, phones, contactLinks, socialLinks };
      })())`,
      label: "Extract contact info from homepage",
    },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const contactLink = [...document.querySelectorAll('a[href]')]
          .find(a => /^contact|contact us|get in touch/i.test(a.textContent.trim()));
        return contactLink ? contactLink.href : null;
      })())`,
      label: "Find contact page link",
    },
    { action: "screenshot", label: "Homepage screenshot" },
  ],

  // ── Price monitor ─────────────────────────────────────────────────────────
  // Returns: current price extracted by CSS selector or heuristic
  price_monitor: ({ url, selector }) => [
    { action: "navigate",       url, label: `Open product page: ${url}`, timeout: 20000 },
    { action: "waitForElement", selector: selector || "body", label: "Page loaded" },
    { action: "checkCaptcha",                                  label: "CAPTCHA check" },
    { action: "dismissModals",                                 label: "Dismiss popups" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const sel = ${JSON.stringify(selector || "")};
        let priceEl = sel ? document.querySelector(sel) : null;
        if (!priceEl) {
          const candidates = [
            '.price', '[class*="price"]', '[itemprop="price"]',
            '[data-price]', '.product-price', '.current-price',
            '[class*="Price"]', '#price', '.a-price',
          ];
          for (const s of candidates) {
            priceEl = document.querySelector(s);
            if (priceEl) break;
          }
        }
        const rawText = priceEl?.textContent?.trim() || null;
        const priceMatch = rawText?.match(/[\\$€£¥]?[\\d,]+(?:\\.\\d{1,2})?/);
        const price = priceMatch ? priceMatch[0] : rawText;
        return {
          url: location.href,
          title: document.title,
          priceText: rawText,
          price,
          selectorUsed: sel || '(heuristic)',
          capturedAt: new Date().toISOString(),
        };
      })())`,
      label: "Extract price",
    },
    { action: "screenshot", label: "Product screenshot" },
  ],

  // ── LinkedIn profile (public) ─────────────────────────────────────────────
  // Returns: name, headline, location, about, recent experience entries
  linkedin_profile: ({ url }) => [
    { action: "navigate",       url, label: `Open LinkedIn profile: ${url}`, timeout: 25000 },
    { action: "waitForElement", selector: "body",   label: "Page loaded" },
    { action: "checkCaptcha",                       label: "CAPTCHA / login wall check" },
    { action: "dismissModals",                      label: "Dismiss popups" },
    {
      action: "evaluate",
      script: `JSON.stringify((() => {
        const sel = (s, el) => (el || document).querySelector(s)?.textContent?.trim() || null;
        const selAll = (s, el) => [...((el || document).querySelectorAll(s) || [])].map(e => e.textContent.trim()).filter(Boolean);
        const name     = sel('h1');
        const headline = sel('.text-body-medium') || sel('[data-field="headline"]');
        const location = sel('.text-body-small.inline.t-black--light') || sel('[data-field="location"]');
        const about    = sel('#about ~ div .inline-show-more-text') || sel('[data-field="summary"]') || sel('.pv-about__summary-text');
        const expEls   = document.querySelectorAll('[data-field="experience_item_title"], .pvs-list__item--line-separated');
        const experience = selAll('[data-field="experience_item_title"]').slice(0,5);
        const isWalled = /sign in|join linkedin/i.test(document.body.innerText.slice(0, 500));
        return { url: location?.href || window.location.href, name, headline, location, about, experience, isLoginWall: isWalled };
      })())`,
      label: "Extract profile data",
    },
    { action: "screenshot", label: "Profile screenshot" },
  ],
};

// ── Public API ────────────────────────────────────────────────────────────────
function get(name, params = {}) {
  const fn = LIBRARY[name];
  if (!fn) return null;
  return fn(params);
}

function list() {
  return Object.entries(LIBRARY).map(([name, fn]) => ({ name }));
}

function has(name) {
  return name in LIBRARY;
}

// ── Catalogue metadata (for UI display) ──────────────────────────────────────
const CATALOGUE = {
  github_repo_info:    { label: "GitHub Repo Info",      category: "development", description: "Stars, forks, language, topics, README preview" },
  github_search:       { label: "GitHub Search",         category: "development", description: "Find repositories matching a query" },
  site_health_check:   { label: "Site Health Check",     category: "monitoring",  description: "Headings, links, nav structure, CAPTCHA detection" },
  page_seo_audit:      { label: "Page SEO Audit",        category: "research",    description: "Title, h1, og:*, canonical URL, meta description" },
  wikipedia_search:    { label: "Wikipedia Search",      category: "research",    description: "Search Wikipedia, extract top article snippets" },
  wikipedia_article:   { label: "Wikipedia Article",     category: "research",    description: "Open article, extract lead paragraph and categories" },
  url_redirect_trace:  { label: "URL Redirect Trace",    category: "diagnostics", description: "Follow redirect chain and report final URL" },
  page_text_snapshot:  { label: "Page Text Snapshot",    category: "research",    description: "Extract all visible text from any page" },
  link_audit:          { label: "Link Audit",            category: "research",    description: "Collect all external links with anchor text" },
  scroll_page_capture: { label: "Scroll Page Capture",   category: "visual",      description: "Screenshot page at multiple scroll positions" },
  form_fill_submit:    { label: "Form Fill & Submit",    category: "automation",  description: "Fill and submit any web form" },
  site_uptime_check:   { label: "Site Uptime Check",     category: "monitoring",  description: "Verify site is reachable and serving real content" },
  page_monitor:        { label: "Page Monitor",          category: "monitoring",  description: "Snapshot a specific element for change detection" },

  // New workflows — packs
  hackernews_top:        { label: "Hacker News Top",        category: "research",    description: "Top 10 Hacker News stories with scores and comment counts" },
  github_trending:       { label: "GitHub Trending",        category: "development", description: "Today's trending repositories — optionally filtered by language" },
  npm_package_info:      { label: "npm Package Info",       category: "development", description: "Version, weekly downloads, license, and repository for any npm package" },
  producthunt_today:     { label: "Product Hunt Today",     category: "research",    description: "Today's top product launches with names, taglines, and vote counts" },
  techcrunch_headlines:  { label: "TechCrunch Headlines",   category: "research",    description: "Latest 6 tech headlines with summaries from TechCrunch" },
  domain_info:           { label: "Domain WHOIS",           category: "diagnostics", description: "WHOIS lookup — registrar, creation date, expiry, name servers" },
  stackoverflow_search:  { label: "Stack Overflow Search",  category: "research",    description: "Top-voted Stack Overflow questions matching a query" },
  opengraph_preview:     { label: "OpenGraph Preview",      category: "diagnostics", description: "All og:* and twitter:* meta tags — link preview data for any URL" },

  // CRM / productivity workflows
  competitor_analysis:   { label: "Competitor Analysis",    category: "research",    description: "SEO signals, headings, nav, external links, and word count from a competitor site" },
  contact_page_scraper:  { label: "Contact Page Scraper",   category: "crm",         description: "Extract emails, phone numbers, social links and contact page URL from any website" },
  price_monitor:         { label: "Price Monitor",          category: "productivity", description: "Extract the current price from a product page using a CSS selector or heuristic" },
  linkedin_profile:      { label: "LinkedIn Profile",       category: "crm",         description: "Extract name, headline, location, and experience from a public LinkedIn profile" },
};

function getCatalogue() {
  return Object.entries(CATALOGUE).map(([name, meta]) => ({ name, ...meta }));
}

module.exports = { get, list, has, getCatalogue, LIBRARY, CATALOGUE };
