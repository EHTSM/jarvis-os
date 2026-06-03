import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  getLibraryCatalogue, runLibraryWorkflow,
  listTemplates, saveTemplate, deleteTemplate, cloneTemplate, runTemplate,
  listHistory, replayExecution,
  getSystemHealth, getWorkflowHealth,
  cancelWorkflow,
  saveServerSchedule,
  getScheduleRuns,
} from "../../browserApi";
import "./browser-automation.css";

// ── Design data ───────────────────────────────────────────────────────────────

const CATEGORY_META = {
  development: { label: "Development",  icon: "⌥", color: "var(--op-blue)" },
  research:    { label: "Research",     icon: "⌕", color: "var(--op-accent)" },
  monitoring:  { label: "Monitoring",   icon: "◎", color: "var(--op-green)" },
  diagnostics: { label: "Diagnostics", icon: "⊕", color: "var(--op-purple)" },
  visual:      { label: "Visual",       icon: "⊡", color: "var(--op-accent2)" },
  automation:  { label: "Automation",   icon: "⟳", color: "var(--op-amber)" },
  productivity:{ label: "Productivity", icon: "⚡", color: "var(--op-amber)" },
  crm:         { label: "CRM",          icon: "◈", color: "var(--op-purple)" },
};

const FEATURED_PACKS = [
  {
    id:        "start_here",
    label:     "Start Here",
    tagline:   "Your first automations — no experience needed",
    color:     "var(--op-accent2)",
    accent:    "rgba(93,226,213,0.08)",
    border:    "rgba(93,226,213,0.22)",
    icon:      "⟢",
    workflows: ["hackernews_top","wikipedia_search","site_uptime_check","url_redirect_trace"],
  },
  {
    id:        "developer",
    label:     "Developer Tools",
    tagline:   "GitHub, npm, Stack Overflow — data for builders",
    color:     "var(--op-blue)",
    accent:    "rgba(68,162,255,0.08)",
    border:    "rgba(68,162,255,0.22)",
    icon:      "⌥",
    workflows: ["github_repo_info","github_trending","npm_package_info","stackoverflow_search"],
  },
  {
    id:        "research",
    label:     "Research Pack",
    tagline:   "News, product launches, content extraction",
    color:     "var(--op-accent)",
    accent:    "rgba(115,183,255,0.08)",
    border:    "rgba(115,183,255,0.22)",
    icon:      "⌕",
    workflows: ["techcrunch_headlines","producthunt_today","page_text_snapshot","page_seo_audit"],
  },
  {
    id:        "site_ops",
    label:     "Site Operations",
    tagline:   "Health checks, monitoring, diagnostics",
    color:     "var(--op-green)",
    accent:    "rgba(75,240,177,0.07)",
    border:    "rgba(75,240,177,0.2)",
    icon:      "◎",
    workflows: ["site_health_check","site_uptime_check","domain_info","opengraph_preview"],
  },
  {
    id:        "crm",
    label:     "CRM & Leads",
    tagline:   "Competitor intel, contacts, pricing, LinkedIn",
    color:     "var(--op-purple)",
    accent:    "rgba(159,127,253,0.07)",
    border:    "rgba(159,127,253,0.22)",
    icon:      "◈",
    workflows: ["competitor_analysis","contact_page_scraper","price_monitor","linkedin_profile"],
  },
];

// Estimated runtimes (seconds)
const EST_RUNTIME = {
  hackernews_top:8, github_repo_info:12, github_search:14, github_trending:12,
  npm_package_info:10, site_health_check:10, page_seo_audit:8, wikipedia_search:8,
  wikipedia_article:10, url_redirect_trace:8, page_text_snapshot:8, link_audit:15,
  scroll_page_capture:20, form_fill_submit:20, site_uptime_check:10, page_monitor:8,
  producthunt_today:18, techcrunch_headlines:15, domain_info:10, stackoverflow_search:12,
  opengraph_preview:8, competitor_analysis:25, contact_page_scraper:12,
  price_monitor:20, linkedin_profile:15,
};

// Workflows that are trending (most commonly run — static signal for now)
const TRENDING = new Set([
  "hackernews_top","github_repo_info","site_health_check","page_seo_audit",
  "github_trending","wikipedia_search","site_uptime_check","producthunt_today",
]);

// Beginner-safe workflows (zero or one required param, no advanced selector knowledge needed)
const BEGINNER_SAFE = new Set([
  "hackernews_top","producthunt_today","techcrunch_headlines","wikipedia_search",
  "url_redirect_trace","site_uptime_check","opengraph_preview","github_trending",
  "npm_package_info","domain_info","stackoverflow_search","page_text_snapshot",
]);

const DIFFICULTY_DESC = {
  "Beginner": "No setup needed — one click or one field. Takes under 15 seconds.",
  "Easy":     "One URL or search term. Runs in under 30 seconds.",
  "Medium":   "Needs a specific URL or CSS selector. May take 30–60 seconds.",
  "Advanced": "Requires careful setup — test on a staging URL first.",
};

const DIFFICULTY = {
  github_repo_info:    {label:"Easy",     color:"var(--op-green)"},
  github_search:       {label:"Easy",     color:"var(--op-green)"},
  site_health_check:   {label:"Easy",     color:"var(--op-green)"},
  page_seo_audit:      {label:"Easy",     color:"var(--op-green)"},
  wikipedia_search:    {label:"Beginner", color:"var(--op-accent2)"},
  wikipedia_article:   {label:"Beginner", color:"var(--op-accent2)"},
  url_redirect_trace:  {label:"Easy",     color:"var(--op-green)"},
  page_text_snapshot:  {label:"Beginner", color:"var(--op-accent2)"},
  link_audit:          {label:"Medium",   color:"var(--op-amber)"},
  scroll_page_capture: {label:"Medium",   color:"var(--op-amber)"},
  form_fill_submit:    {label:"Advanced", color:"var(--op-red)"},
  site_uptime_check:   {label:"Easy",     color:"var(--op-green)"},
  page_monitor:        {label:"Easy",     color:"var(--op-green)"},
  hackernews_top:      {label:"Beginner", color:"var(--op-accent2)"},
  github_trending:     {label:"Easy",     color:"var(--op-green)"},
  npm_package_info:    {label:"Easy",     color:"var(--op-green)"},
  producthunt_today:   {label:"Easy",     color:"var(--op-green)"},
  techcrunch_headlines:{label:"Easy",     color:"var(--op-green)"},
  domain_info:         {label:"Easy",     color:"var(--op-green)"},
  stackoverflow_search:{label:"Beginner", color:"var(--op-accent2)"},
  opengraph_preview:   {label:"Easy",     color:"var(--op-green)"},
  competitor_analysis: {label:"Medium",   color:"var(--op-amber)"},
  contact_page_scraper:{label:"Easy",     color:"var(--op-green)"},
  price_monitor:       {label:"Medium",   color:"var(--op-amber)"},
  linkedin_profile:    {label:"Easy",     color:"var(--op-green)"},
};

const WORKFLOW_TAGS = {
  github_repo_info:    ["github","code","open-source"],
  github_search:       ["github","search","code"],
  github_trending:     ["github","trending","code"],
  npm_package_info:    ["npm","packages","node"],
  stackoverflow_search:["stackoverflow","dev","Q&A"],
  site_health_check:   ["health","monitoring","seo"],
  page_seo_audit:      ["seo","metadata","og"],
  opengraph_preview:   ["seo","og","social","preview"],
  domain_info:         ["domain","whois","dns"],
  site_uptime_check:   ["uptime","monitoring","health"],
  page_monitor:        ["monitoring","change-detection"],
  url_redirect_trace:  ["redirect","url","diagnostics"],
  wikipedia_search:    ["wikipedia","research","knowledge"],
  wikipedia_article:   ["wikipedia","research","knowledge"],
  hackernews_top:      ["news","hn","tech"],
  techcrunch_headlines:["news","tech","startup"],
  producthunt_today:   ["product","startup","launches"],
  page_text_snapshot:  ["scraping","content","text"],
  link_audit:          ["links","seo","scraping"],
  scroll_page_capture: ["screenshot","visual","capture"],
  form_fill_submit:    ["forms","automation","submit"],
  competitor_analysis: ["competitor","research","business"],
  contact_page_scraper:["crm","leads","contact"],
  price_monitor:       ["price","ecommerce","monitoring"],
  linkedin_profile:    ["linkedin","crm","leads"],
};

const PARAM_SCHEMA = {
  github_repo_info:    [{key:"owner",label:"GitHub Owner",placeholder:"e.g. microsoft"},{key:"repo",label:"Repository",placeholder:"e.g. playwright"}],
  github_search:       [{key:"query",label:"Search Query",placeholder:"e.g. react hooks testing"}],
  site_health_check:   [{key:"url",label:"URL",placeholder:"https://example.com"}],
  page_seo_audit:      [{key:"url",label:"URL",placeholder:"https://example.com"}],
  wikipedia_search:    [{key:"query",label:"Search Query",placeholder:"e.g. Node.js event loop"},{key:"maxResults",label:"Max Results",placeholder:"5",type:"number"}],
  wikipedia_article:   [{key:"title",label:"Article Title",placeholder:"e.g. Playwright_(software)"}],
  url_redirect_trace:  [{key:"url",label:"URL to Trace",placeholder:"https://bit.ly/..."}],
  page_text_snapshot:  [{key:"url",label:"URL",placeholder:"https://example.com"}],
  link_audit:          [{key:"url",label:"URL",placeholder:"https://example.com"},{key:"maxLinks",label:"Max Links",placeholder:"50",type:"number"}],
  scroll_page_capture: [{key:"url",label:"URL",placeholder:"https://example.com"},{key:"scrollCount",label:"Scroll Steps",placeholder:"3",type:"number"}],
  form_fill_submit:    [{key:"url",label:"Form URL",placeholder:"https://example.com/contact"}],
  site_uptime_check:   [{key:"url",label:"URL",placeholder:"https://example.com"}],
  page_monitor:        [{key:"url",label:"URL",placeholder:"https://example.com"},{key:"selector",label:"CSS Selector (optional)",placeholder:"body"}],
  hackernews_top:      [],
  github_trending:     [{key:"language",label:"Language (optional)",placeholder:"e.g. typescript"}],
  npm_package_info:    [{key:"packageName",label:"Package Name",placeholder:"e.g. react"}],
  producthunt_today:   [],
  techcrunch_headlines:[],
  domain_info:         [{key:"domain",label:"Domain",placeholder:"e.g. example.com"}],
  stackoverflow_search:[{key:"query",label:"Search Query",placeholder:"e.g. how to debounce in React"}],
  opengraph_preview:   [{key:"url",label:"URL",placeholder:"https://example.com"}],
  competitor_analysis: [{key:"url",label:"Competitor URL",placeholder:"https://competitor.com"},{key:"yourUrl",label:"Your URL (optional)",placeholder:"https://yoursite.com"}],
  contact_page_scraper:[{key:"url",label:"Company Website",placeholder:"https://company.com"}],
  price_monitor:       [{key:"url",label:"Product URL",placeholder:"https://shop.com/product"},{key:"selector",label:"Price Selector (optional)",placeholder:".price, [class*=price]"}],
  linkedin_profile:    [{key:"url",label:"LinkedIn Profile URL",placeholder:"https://linkedin.com/in/username"}],
};

const WORKFLOW_SUMMARY = {
  github_repo_info:    "Opens the GitHub repository page and extracts stars, forks, primary language, description, and topics.",
  github_search:       "Searches GitHub repositories by keyword and returns the top 5 results with names, descriptions, and star counts.",
  github_trending:     "Opens GitHub Trending and returns up to 8 repos with name, description, language, stars, and stars gained today.",
  npm_package_info:    "Opens npm registry for a package and extracts version, description, weekly downloads, license, and linked repository.",
  stackoverflow_search:"Searches Stack Overflow and returns the 5 highest-voted questions with vote counts, answer counts, and links.",
  site_health_check:   "Navigates to the URL and checks headings, links, nav presence, CAPTCHA detection, and overall text length.",
  page_seo_audit:      "Extracts SEO signals: title, H1, meta description, Open Graph tags, canonical URL, Twitter card, and language.",
  opengraph_preview:   "Extracts all og:* and twitter:* meta tags — the same data used when a link is shared in Slack or iMessage.",
  domain_info:         "Performs a WHOIS lookup and returns registrar, creation date, expiry date, and name servers.",
  site_uptime_check:   "Verifies a URL is reachable, returns real content (not a CAPTCHA or error page), and reports status.",
  page_monitor:        "Takes a structural snapshot of a page element. Run on a schedule to detect content changes.",
  url_redirect_trace:  "Follows all HTTP redirects and reports original URL, final destination, and final page title.",
  wikipedia_search:    "Searches Wikipedia (CAPTCHA-free) and returns top results with titles, URLs, and article snippets.",
  wikipedia_article:   "Opens a Wikipedia article and extracts the lead paragraph, categories, and article length.",
  hackernews_top:      "Opens Hacker News front page and extracts the top 10 stories with titles, URLs, vote scores, and comment counts.",
  techcrunch_headlines:"Opens TechCrunch and extracts the 6 most recent article headlines with summaries and URLs.",
  producthunt_today:   "Opens Product Hunt's homepage and extracts today's top product launches with names, taglines, and upvotes.",
  page_text_snapshot:  "Opens any URL and extracts all visible text content — useful for content monitoring and competitive research.",
  link_audit:          "Navigates to the page and collects all external links with their anchor text.",
  scroll_page_capture: "Takes screenshots at multiple scroll positions across the page — useful for visual audits.",
  form_fill_submit:    "Fills in and submits any HTML form. Best for contact forms, search boxes, and login flows.",
  competitor_analysis: "Opens a competitor's website and extracts SEO data, headings, links, and page structure for comparison.",
  contact_page_scraper:"Navigates to a company website, finds the contact page, and extracts email addresses and contact form URLs.",
  price_monitor:       "Opens a product page and extracts the current price using a CSS selector — great for price change detection.",
  linkedin_profile:    "Opens a public LinkedIn profile page and extracts name, headline, location, and experience summary.",
};

const WORKFLOW_REQUIREMENTS = {
  github_repo_info:    "A valid GitHub owner and repository name (public repos only).",
  github_search:       "A search query string. Works best with 1–3 descriptive keywords.",
  github_trending:     "Optionally specify a programming language. Leave blank for all languages.",
  npm_package_info:    "A valid npm package name. Scoped packages use @scope/package format.",
  stackoverflow_search:"A search query. More specific queries yield better results.",
  site_health_check:   "A valid HTTPS URL. Works on most public sites.",
  page_seo_audit:      "A valid HTTPS URL. JavaScript-rendered content is supported.",
  opengraph_preview:   "A valid HTTPS URL. All og:* and twitter:* tags will be extracted.",
  domain_info:         "A domain name without protocol — e.g. 'example.com' not 'https://example.com'.",
  site_uptime_check:   "A valid HTTPS URL. Returns ok if the site responds with real content.",
  page_monitor:        "A valid URL and optionally a CSS selector to watch. Defaults to full body.",
  url_redirect_trace:  "A URL to trace — short links, marketing URLs, or any redirect chain.",
  wikipedia_search:    "A search term. Results are from English Wikipedia.",
  wikipedia_article:   "The Wikipedia article title exactly as it appears in the URL.",
  hackernews_top:      "No parameters required. Opens the Hacker News front page directly.",
  techcrunch_headlines:"No parameters required. Opens TechCrunch directly.",
  producthunt_today:   "No parameters required. Opens Product Hunt homepage.",
  page_text_snapshot:  "A valid HTTPS URL. Pages behind login or CAPTCHA will not be readable.",
  link_audit:          "A valid URL. Only external links are collected by default.",
  scroll_page_capture: "A valid URL. Scroll count between 1–5 recommended.",
  form_fill_submit:    "URL, field selectors, and field values. Requires a submit button selector.",
  competitor_analysis: "A valid HTTPS URL for the competitor site.",
  contact_page_scraper:"A company website URL. The workflow will attempt to find the /contact page.",
  price_monitor:       "A valid product page URL. Optionally provide a CSS selector for the price element.",
  linkedin_profile:    "A public LinkedIn profile URL. Private profiles will not be readable.",
};

// Beginner tutorial copy — shown in detail for zero/one-param beginner-safe flows
const BEGINNER_GUIDE = {
  hackernews_top:      "No setup needed. Hit Run and you'll get today's top Hacker News stories in ~8 seconds.",
  producthunt_today:   "No setup needed. Hit Run to get today's top Product Hunt launches.",
  techcrunch_headlines:"No setup needed. Hit Run to get the latest TechCrunch headlines.",
  wikipedia_search:    "Type any topic in the search box — history, science, people, places. Hit Run.",
  site_uptime_check:   "Paste any URL (like your own site) and hit Run to check if it's up.",
  url_redirect_trace:  "Paste a short link, affiliate link, or any redirecting URL to see where it ends up.",
  opengraph_preview:   "Paste any URL to see exactly how it appears when shared on Slack or social media.",
  github_trending:     "Leave language blank to see all trending repos, or type 'typescript' / 'python' etc.",
  npm_package_info:    "Type any npm package name — like 'react', 'axios', 'lodash' — and hit Run.",
  domain_info:         "Type a domain name like 'github.com' (no https://) to get WHOIS info.",
  stackoverflow_search:"Type any coding question to find the highest-voted Stack Overflow answers.",
  page_text_snapshot:  "Paste any public URL to extract and read all the text on that page.",
};

// ── Workflow warnings — amber trust callouts for risky/uncertain workflows ────
const WORKFLOW_WARNINGS = {
  form_fill_submit:    "This workflow fills and submits a real HTML form. Test on a staging URL first to avoid unintended submissions.",
  linkedin_profile:    "LinkedIn actively blocks automated access. This workflow may hit a login wall on most profiles. Use with a visible browser session.",
  competitor_analysis: "Some sites use bot-detection. If the workflow fails, try adding a delay step or running from a different IP.",
  price_monitor:       "Price selectors vary widely between sites. If extraction fails, inspect the page and set a more specific CSS selector.",
  scroll_page_capture: "Full-page capture can take 20–30s on long pages. Increase timeout if it times out.",
  link_audit:          "Pages with hundreds of links may be slow. Reduce maxLinks to 20–30 for faster results.",
};

// ── Step counts for library workflows ─────────────────────────────────────────
const STEP_COUNTS = {
  hackernews_top:3, github_repo_info:4, github_search:4, github_trending:4,
  npm_package_info:4, site_health_check:5, page_seo_audit:4, wikipedia_search:4,
  wikipedia_article:4, url_redirect_trace:4, page_text_snapshot:3, link_audit:4,
  scroll_page_capture:5, form_fill_submit:6, site_uptime_check:4, page_monitor:4,
  producthunt_today:3, techcrunch_headlines:3, domain_info:3, stackoverflow_search:3,
  opengraph_preview:3, competitor_analysis:5, contact_page_scraper:4,
  price_monitor:4, linkedin_profile:4,
};

// ── Persistence helpers ───────────────────────────────────────────────────────

const FAVS_KEY    = "bap_favorites";
const RECENTS_KEY = "bap_recents";
const PINS_KEY    = "bap_pins";
const NOTES_KEY   = "bap_notes";
const IMPORT_KEY  = "bap_import_draft";

function loadFavs()    { try { return new Set(JSON.parse(localStorage.getItem(FAVS_KEY)||"[]")); } catch { return new Set(); } }
function saveFavs(s)   { try { localStorage.setItem(FAVS_KEY, JSON.stringify([...s])); } catch {} }
function loadRecents() { try { return JSON.parse(localStorage.getItem(RECENTS_KEY)||"[]"); } catch { return []; } }
function pushRecent(name) {
  try {
    const list = loadRecents().filter(n => n !== name);
    list.unshift(name);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0,8)));
  } catch {}
}
function loadPins()      { try { return new Set(JSON.parse(localStorage.getItem(PINS_KEY)||"[]")); } catch { return new Set(); } }
function savePins(s)     { try { localStorage.setItem(PINS_KEY, JSON.stringify([...s])); } catch {} }
function loadNotes()     { try { return JSON.parse(localStorage.getItem(NOTES_KEY)||"{}"); } catch { return {}; } }
function saveNote(id, t) { try { const n={...loadNotes()}; if(t) n[id]=t; else delete n[id]; localStorage.setItem(NOTES_KEY,JSON.stringify(n)); } catch {} }

// ── Scheduled run notification helpers ────────────────────────────────────────

const NOTIF_SEEN_KEY = "bap_notif_seen_at";  // ISO timestamp — last time operator saw notifications

function loadNotifSeenAt() {
  try { return localStorage.getItem(NOTIF_SEEN_KEY) || null; } catch { return null; }
}
function saveNotifSeenAt(iso) {
  try { localStorage.setItem(NOTIF_SEEN_KEY, iso); } catch {}
}

// Returns notification objects for schedule runs that completed since seenAt
function computeScheduleNotifications(serverRuns, templates, seenAt) {
  const notifs = [];
  if (!serverRuns) return notifs;
  Object.entries(serverRuns).forEach(([templateId, run]) => {
    if (!run?.lastRun) return;
    if (seenAt && run.lastRun <= seenAt) return;  // operator already saw this
    const tpl = templates.find(t => t.id === templateId);
    const name = tpl?.name || templateId;
    notifs.push({
      templateId,
      name,
      lastRun:  run.lastRun,
      ok:       run.lastOk,
      error:    run.lastError || null,
      runCount: run.runCount || 1,
    });
  });
  // Sort newest first
  return notifs.sort((a, b) => b.lastRun.localeCompare(a.lastRun));
}

// ── Variables persistence ─────────────────────────────────────────────────────

const VARS_KEY      = "bap_variables";
const SCHEDULES_KEY = "bap_schedules";

const VAR_PRESETS = [
  { key:"website_url",    label:"Website URL",    icon:"🌐", placeholder:"https://example.com",      desc:"The main site URL your workflows target" },
  { key:"search_term",    label:"Search term",    icon:"🔍", placeholder:"quarterly report Q4",      desc:"A keyword or phrase to search for" },
  { key:"email",          label:"Email address",  icon:"📧", placeholder:"you@company.com",          desc:"Your email — used to fill contact forms" },
  { key:"company_name",   label:"Company name",   icon:"🏢", placeholder:"Acme Corp",               desc:"Your company name for form fields" },
  { key:"customer_name",  label:"Customer name",  icon:"👤", placeholder:"Jane Smith",              desc:"A contact or customer name" },
  { key:"product_name",   label:"Product name",   icon:"📦", placeholder:"Pro Plan",                desc:"The product or plan to reference" },
  { key:"price_selector", label:"Price selector", icon:"💲", placeholder:".price, [class*=price]",  desc:"CSS selector for a price element" },
  { key:"username",       label:"Username",       icon:"🔑", placeholder:"my_username",             desc:"Login username — stored locally only" },
];

function loadVars()      { try { return JSON.parse(localStorage.getItem(VARS_KEY)||"{}"); } catch { return {}; } }
function saveVars(v)     { try { localStorage.setItem(VARS_KEY, JSON.stringify(v)); } catch {} }
function loadSchedules() { try { return JSON.parse(localStorage.getItem(SCHEDULES_KEY)||"{}"); } catch { return {}; } }
function saveSchedule(id, sched) {
  try {
    const all = loadSchedules();
    if (sched) all[id] = sched; else delete all[id];
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(all));
  } catch {}
}

// Substitute {{varName}} tokens in a string using the vars map
function applyVars(str, vars) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

// ── Schedule execution tracking ───────────────────────────────────────────────

const SCHED_RUNS_KEY = "bap_sched_runs"; // { [templateId]: { lastRun: ISO, missedAt: ISO|null } }

function loadSchedRuns() { try { return JSON.parse(localStorage.getItem(SCHED_RUNS_KEY)||"{}"); } catch { return {}; } }
function saveSchedRun(id, iso) {
  try {
    const all = loadSchedRuns();
    all[id] = { lastRun: iso, missedAt: null };
    localStorage.setItem(SCHED_RUNS_KEY, JSON.stringify(all));
  } catch {}
}
function markMissedRun(id, iso) {
  try {
    const all = loadSchedRuns();
    if (!all[id]) all[id] = {};
    all[id].missedAt = iso;
    localStorage.setItem(SCHED_RUNS_KEY, JSON.stringify(all));
  } catch {}
}

// Returns ISO of when this schedule was last due (null if never due yet)
function scheduleLastDue(sched) {
  if (!sched || sched.freq === "manual") return null;
  const now = new Date();
  const [h, m] = (sched.time || "09:00").split(":").map(Number);

  if (sched.freq === "daily") {
    const due = new Date(now); due.setHours(h, m, 0, 0);
    if (due > now) due.setDate(due.getDate() - 1);
    return due.toISOString();
  }
  if (sched.freq === "weekly") {
    const d = new Date(now);
    const diff = (d.getDay() - (sched.day ?? 1) + 7) % 7;
    d.setDate(d.getDate() - diff); d.setHours(h, m, 0, 0);
    if (d > now) d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  if (sched.freq === "monthly") {
    const d = new Date(now.getFullYear(), now.getMonth(), sched.dayOfMonth || 1, h, m);
    if (d > now) d.setMonth(d.getMonth() - 1);
    return d.toISOString();
  }
  return null;
}

// Returns list of { templateId, name, sched, missedAt, dueAt } for missed/due schedules
function computeScheduleAlerts(templates, schedules, schedRuns) {
  const alerts = [];
  templates.forEach(tpl => {
    const sched = schedules[tpl.id];
    if (!sched || sched.freq === "manual") return;
    const dueAt  = scheduleLastDue(sched);
    if (!dueAt) return;
    const runs   = schedRuns[tpl.id];
    const lastRun = runs?.lastRun || null;
    const missed  = !lastRun || new Date(lastRun) < new Date(dueAt);
    if (missed) {
      alerts.push({ templateId: tpl.id, name: tpl.name, sched, dueAt, lastRun });
    }
  });
  return alerts;
}

// Compute next-run time from a schedule object
function nextRunLabel(sched) {
  if (!sched || sched.freq === "manual") return null;
  const now = new Date();
  if (sched.freq === "daily") {
    const [h, m] = (sched.time||"09:00").split(":").map(Number);
    const next = new Date(now); next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return `Daily at ${sched.time||"09:00"} — next ${fmtAge(next.toISOString())}`;
  }
  if (sched.freq === "weekly") {
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return `Weekly on ${days[sched.day??1]} at ${sched.time||"09:00"}`;
  }
  if (sched.freq === "monthly") return `Monthly on day ${sched.dayOfMonth||1} at ${sched.time||"09:00"}`;
  return null;
}

// ── Share/export helpers ──────────────────────────────────────────────────────

function buildSharePayload(item, source) {
  return {
    _jarvis:   true,
    version:   1,
    exportedAt:new Date().toISOString(),
    source,
    name:      item.name || item.label,
    label:     item.label || item.name,
    category:  item.category || "automation",
    description: item.description || WORKFLOW_SUMMARY[item.name] || "",
    tags:      WORKFLOW_TAGS[item.name] || [],
    steps:     item.steps || [],
    paramSchema: PARAM_SCHEMA[item.name] || [],
  };
}

function parseSharePayload(raw) {
  try {
    const obj = JSON.parse(raw);
    if (!obj._jarvis) throw new Error("Not a Jarvis workflow export");
    if (!obj.name) throw new Error("Missing workflow name");
    if (!Array.isArray(obj.steps)) throw new Error("Missing steps array");
    return { ok: true, payload: obj };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Display helpers ───────────────────────────────────────────────────────────

function healthBandColor(band) {
  if (band === "excellent") return "var(--op-green)";
  if (band === "good")      return "var(--op-accent)";
  if (band === "fair")      return "var(--op-amber)";
  if (band === "poor")      return "var(--op-red)";
  return "var(--op-text3)";
}
function fmtAge(ts) {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000)    return `${Math.round(ms/1000)}s ago`;
  if (ms < 3600000)  return `${Math.round(ms/60000)}m ago`;
  if (ms < 86400000) return `${Math.round(ms/3600000)}h ago`;
  return `${Math.round(ms/86400000)}d ago`;
}
function fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms/1000).toFixed(1)}s`;
}
function StepBadge({ ok, cancelled }) {
  if (cancelled) return <span className="bap-step-badge bap-step-cancelled">cancelled</span>;
  return <span className={`bap-step-badge ${ok ? "bap-step-ok" : "bap-step-fail"}`}>{ok ? "✓" : "✗"}</span>;
}
function HealthDot({ band }) {
  return <span className="bap-health-dot" style={{ background: healthBandColor(band) }} title={band || "no data"} />;
}
function ScreenshotLightbox({ src, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="bap-lightbox-overlay" onClick={onClose}>
      <div className="bap-lightbox-inner" onClick={e=>e.stopPropagation()}>
        <button className="bap-lightbox-close" onClick={onClose}>✕ Close</button>
        <img src={src} alt="Execution screenshot" className="bap-lightbox-img" />
      </div>
    </div>
  );
}
function ExecutionSummaryCard({ result, workflow }) {
  if (!result) return null;
  const name     = workflow?.item?.label || workflow?.item?.name || "Workflow";
  const steps    = result.steps || [];
  const passed   = steps.filter(s=>s.ok).length;
  const retries  = steps.reduce((n,s)=>n+Math.max(0,(s.attempts||1)-1), 0);
  const totalMs  = steps.reduce((n,s)=>n+(s.durationMs||0), 0);
  return (
    <div className={`bap-exec-summary ${result.ok?"ok":"fail"}`}>
      <div className="bap-exec-summary-icon">{result.ok ? "✓" : "✗"}</div>
      <div className="bap-exec-summary-body">
        <div className="bap-exec-summary-name">{name}</div>
        <div className="bap-exec-summary-stats">
          {steps.length > 0 && <span>{passed}/{steps.length} steps passed</span>}
          {totalMs > 0 && <span>{fmtDuration(totalMs)}</span>}
          {retries > 0 && <span className="bap-meta-warn">{retries} retries</span>}
          {result.cancelled && <span>Cancelled by operator</span>}
        </div>
        {result.currentUrl && <div className="bap-exec-summary-url">{result.currentUrl}</div>}
        {result.error && !result.ok && <div className="bap-exec-summary-error">{result.error}</div>}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function BrowserAutomationPanel({ addNotification }) {
  // Navigation
  const [view, setView]               = useState("marketplace");
  const [activeCategory, setCategory] = useState("all");
  const [activePack, setActivePack]   = useState(null);
  const [searchQuery, setSearch]      = useState("");
  const [activeTag, setActiveTag]     = useState(null);
  const [sortMode, setSortMode]       = useState("featured");
  const [showOnboarding, setOnboarding] = useState(() => !localStorage.getItem("bap_onboarded"));
  const [showFirstRun, setShowFirstRun] = useState(() => !localStorage.getItem("bap_firstrun_done"));
  const [showImport, setShowImport]   = useState(false);
  const [showSearch, setShowSearch]   = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  // Data
  const [catalogue, setCatalogue]     = useState([]);
  const [templates, setTemplates]     = useState([]);
  const [history, setHistory]         = useState([]);
  const [sysHealth, setSysHealth]     = useState(null);
  const [wfHealthMap, setWfHealth]    = useState({});
  const [loading, setLoading]         = useState(true);
  const [histLoading, setHistLoading] = useState(false);
  const [favorites, setFavorites]     = useState(loadFavs);
  const [pins, setPins]               = useState(loadPins);
  const [notes, setNotes]             = useState(loadNotes);
  const [recents, setRecents]         = useState(loadRecents);

  // Scheduled run notifications
  const [serverRuns, setServerRuns]       = useState({});
  const [notifSeenAt, setNotifSeenAt]     = useState(loadNotifSeenAt);

  // Selected workflow + params
  const [selectedWorkflow, setSelected] = useState(null);
  const [params, setParams]             = useState({});

  // Execution
  const [running, setRunning]           = useState(false);
  const [runResult, setRunResult]       = useState(null);
  const [liveSteps, setLiveSteps]       = useState([]);
  const [activeWorkflowId, setActiveWfId] = useState(null);
  const [testMode, setTestMode]         = useState(false);
  const liveRef = useRef([]);

  // Editor
  const [editName, setEditName]         = useState("");
  const [editCategory, setEditCat]      = useState("automation");
  const [editStepsRaw, setEditRaw]      = useState("");
  const [editDesc, setEditDesc]         = useState("");
  const [editTagsRaw, setEditTagsRaw]   = useState("");
  const [editError, setEditError]       = useState(null);
  const [saveLoading, setSaveLoading]   = useState(false);

  // Inline note editing on saved cards
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteText, setEditingNoteText] = useState("");

  // Template mgmt
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc]   = useState(null);

  // Share / export state (used in DetailView via props)
  const [shareToast, setShareToast]     = useState(null); // "copied" | "downloaded" | null

  // ── SSE ───────────────────────────────────────────────────────────────────
  const sseRef = useRef(null);
  function _startSSE() {
    if (sseRef.current) sseRef.current.close();
    liveRef.current = []; setLiveSteps([]);
    const base = (typeof process !== "undefined" ? process.env?.REACT_APP_API_URL : "") || "";
    const es = new EventSource(`${base}/runtime/stream`, { withCredentials: true });
    sseRef.current = es;
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        const t   = evt.type || "";
        if (t === "browser:step" || t === "browser:workflow:done" || t === "browser:workflow:cancel") {
          const p = evt.payload || evt;
          liveRef.current = [
            ...liveRef.current.filter(s => !(s.stepIndex === p.stepIndex && s.workflowId === p.workflowId)),
            p,
          ].slice(-60);
          setLiveSteps([...liveRef.current]);
        }
      } catch {}
    };
    es.onerror = () => {};
  }
  function _stopSSE() { sseRef.current?.close(); sseRef.current = null; }
  useEffect(() => () => _stopSSE(), []);

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    try { const r = await getLibraryCatalogue(); if (r?.catalogue) setCatalogue(r.catalogue); } catch {}
    setLoading(false);
  }, []);
  const loadTemplates = useCallback(async () => {
    try { const r = await listTemplates(); if (r?.templates) setTemplates(r.templates); } catch {}
  }, []);
  const loadHistory   = useCallback(async () => {
    setHistLoading(true);
    try { const r = await listHistory({ limit: 50 }); if (r?.history) setHistory(r.history); } catch {}
    setHistLoading(false);
  }, []);
  const loadSysHealth = useCallback(async () => {
    try { const r = await getSystemHealth(); if (r?.band) setSysHealth(r); } catch {}
  }, []);

  const loadServerRuns = useCallback(async () => {
    try { const r = await getScheduleRuns(); if (r?.runs) setServerRuns(r.runs); } catch {}
  }, []);

  // Bulk-load health for all saved templates (fired when Saved tab opens)
  const loadAllTemplateHealth = useCallback(async (tpls) => {
    if (!tpls?.length) return;
    tpls.forEach(tpl => {
      getWorkflowHealth(tpl.id)
        .then(r => { if (r?.score !== undefined) setWfHealth(p => ({...p, [tpl.id]: r})); })
        .catch(() => {});
    });
  }, []);

  useEffect(() => { loadCatalogue(); loadTemplates(); loadSysHealth(); loadServerRuns(); }, []);
  useEffect(() => {
    if (view === "history") loadHistory();
    if (view === "saved") { loadTemplates().then(() => {}); }
  }, [view]);
  // Bulk health load when templates are ready and Saved tab is active
  useEffect(() => {
    if (templates.length > 0 && (view === "saved" || view === "dashboard")) {
      loadAllTemplateHealth(templates);
    }
  }, [templates, view]);
  useEffect(() => {
    if (selectedWorkflow?.source === "template" && selectedWorkflow.item?.id) {
      const id = selectedWorkflow.item.id;
      if (!wfHealthMap[id]) {
        getWorkflowHealth(id).then(r => { if (r?.score !== undefined) setWfHealth(p => ({...p, [id]: r})); }).catch(()=>{});
      }
    }
  }, [selectedWorkflow]);

  // ── Favorites ─────────────────────────────────────────────────────────────
  const toggleFav = useCallback((name) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      saveFavs(next);
      return next;
    });
  }, []);

  // ── Pins ──────────────────────────────────────────────────────────────────
  const togglePin = useCallback((id) => {
    setPins(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      savePins(next);
      return next;
    });
  }, []);

  // ── Notes ─────────────────────────────────────────────────────────────────
  const updateNote = useCallback((id, text) => {
    saveNote(id, text);
    setNotes(loadNotes());
  }, []);

  // ── Variables & Schedules ──────────────────────────────────────────────────
  const [vars, setVars]           = useState(loadVars);
  const [schedules, setSchedules] = useState(loadSchedules);
  const [schedRuns, setSchedRuns] = useState(loadSchedRuns);

  const updateVar = useCallback((key, value) => {
    setVars(prev => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      saveVars(next);
      return next;
    });
  }, []);

  const updateSchedule = useCallback((id, sched) => {
    saveSchedule(id, sched);
    setSchedules(loadSchedules());
    saveServerSchedule(id, sched || { freq: "manual" }).catch(() => {});
  }, []);

  // Record a schedule run when workflow completes
  const recordSchedRun = useCallback((templateId) => {
    if (schedules[templateId]) {
      saveSchedRun(templateId, new Date().toISOString());
      setSchedRuns(loadSchedRuns());
    }
  }, [schedules]);

  // Compute missed/due schedule alerts
  const scheduleAlerts = useMemo(() =>
    computeScheduleAlerts(templates, schedules, schedRuns),
    [templates, schedules, schedRuns]
  );

  // Scheduled run notifications — new server-side run results since last visit
  const scheduleNotifs = useMemo(() =>
    computeScheduleNotifications(serverRuns, templates, notifSeenAt),
    [serverRuns, templates, notifSeenAt]
  );
  const unreadNotifCount = scheduleNotifs.length;

  const dismissNotifications = useCallback(() => {
    const now = new Date().toISOString();
    saveNotifSeenAt(now);
    setNotifSeenAt(now);
  }, []);

  // ── Filtered & sorted catalogue ───────────────────────────────────────────
  const filteredCatalogue = useMemo(() => {
    let list = catalogue;
    if (activePack) {
      const pack = FEATURED_PACKS.find(p => p.id === activePack);
      if (pack) list = list.filter(w => pack.workflows.includes(w.name));
    } else if (activeCategory !== "all") {
      list = list.filter(w => w.category === activeCategory);
    }
    if (activeTag) list = list.filter(w => (WORKFLOW_TAGS[w.name]||[]).includes(activeTag));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(w =>
        w.name.includes(q) ||
        w.label.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        (WORKFLOW_TAGS[w.name]||[]).some(t => t.includes(q))
      );
    }
    if (sortMode === "az")         list = [...list].sort((a,b) => a.label.localeCompare(b.label));
    if (sortMode === "difficulty") list = [...list].sort((a,b) => {
      const order = {Beginner:0,Easy:1,Medium:2,Advanced:3};
      return (order[DIFFICULTY[a.name]?.label]??1) - (order[DIFFICULTY[b.name]?.label]??1);
    });
    if (sortMode === "runtime")    list = [...list].sort((a,b) => (EST_RUNTIME[a.name]||30)-(EST_RUNTIME[b.name]||30));
    if (sortMode === "featured")   list = [...list].sort((a,b) => (favorites.has(b.name)?1:0)-(favorites.has(a.name)?1:0));
    return list;
  }, [catalogue, activeCategory, activePack, activeTag, searchQuery, sortMode, favorites]);

  const availableTags = useMemo(() => {
    const all = filteredCatalogue.flatMap(w => WORKFLOW_TAGS[w.name]||[]);
    return [...new Set(all)].sort();
  }, [filteredCatalogue]);

  const recentCatalogue = useMemo(() => {
    return recents
      .map(name => catalogue.find(w => w.name === name))
      .filter(Boolean)
      .slice(0, 4);
  }, [recents, catalogue]);

  const categories = ["all", ...Object.keys(CATEGORY_META)];

  // ── Actions ───────────────────────────────────────────────────────────────
  const openDetail = useCallback((source, item) => {
    setSelected({ source, item }); setParams({}); setView("detail");
    if (item.name) { pushRecent(item.name); setRecents(loadRecents()); }
  }, []);

  const handleRun = useCallback(async () => {
    if (!selectedWorkflow || running) return;
    setRunning(true); setRunResult(null); setView("run"); _startSSE();
    try {
      let result;
      if (selectedWorkflow.source === "library") {
        result = await runLibraryWorkflow(selectedWorkflow.item.name, params, { timeoutMs: 120000 });
      } else {
        result = await runTemplate(selectedWorkflow.item.id, params, { timeoutMs: 120000, noRecord: testMode });
      }
      setRunResult(result);
      setActiveWfId(null);
      const modeLabel = testMode ? " [test]" : "";
      addNotification?.(result?.ok ? `✓ ${selectedWorkflow.item.label||selectedWorkflow.item.name}${modeLabel}` : `✗ ${selectedWorkflow.item.label||selectedWorkflow.item.name}${modeLabel}`, result?.ok ? "ok" : "crit");
      if (selectedWorkflow.source === "template" && !testMode) recordSchedRun(selectedWorkflow.item.id);
      if (!testMode) { loadHistory(); loadSysHealth(); }
    } catch (err) {
      setRunResult({ ok: false, error: err.message });
      addNotification?.(`Run error: ${err.message}`, "crit");
    } finally { setRunning(false); _stopSSE(); }
  }, [selectedWorkflow, params, running, addNotification, loadHistory, loadSysHealth]);

  const handleCancel = useCallback(async () => {
    if (!activeWorkflowId) return;
    try { await cancelWorkflow(activeWorkflowId, "Cancelled by operator"); addNotification?.("Cancellation requested","warn"); } catch {}
  }, [activeWorkflowId, addNotification]);

  const handleReplay = useCallback(async (execId, name) => {
    setRunning(true); setRunResult(null); setView("run"); _startSSE();
    try {
      const result = await replayExecution(execId, { timeoutMs: 120000 });
      setRunResult(result);
      addNotification?.(result?.ok ? `↺ Replay ok: ${name}` : `↺ Replay failed: ${name}`, result?.ok ? "ok" : "crit");
      loadHistory();
    } catch (err) { setRunResult({ ok: false, error: err.message }); }
    finally { setRunning(false); _stopSSE(); }
  }, [addNotification, loadHistory]);

  const handleSaveFromEditor = useCallback(async () => {
    if (!editName.trim()) { setEditError("Name required"); return; }
    let parsedSteps;
    try { parsedSteps = JSON.parse(editStepsRaw); } catch { setEditError("Invalid JSON"); return; }
    if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) { setEditError("Steps must be a non-empty array"); return; }
    const parsedTags = editTagsRaw.split(",").map(t=>t.trim().toLowerCase().replace(/^#+/,"")).filter(Boolean);
    setSaveLoading(true); setEditError(null);
    try {
      const r = await saveTemplate(editName.trim(), parsedSteps, {
        category: editCategory, source: "editor",
        description: editDesc.trim() || undefined,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
      });
      if (r?.ok) {
        addNotification?.(`Saved: ${editName.trim()}`, "ok");
        await loadTemplates(); setView("saved");
        setEditName(""); setEditRaw(""); setEditDesc(""); setEditTagsRaw("");
      } else setEditError(r?.error || "Save failed");
    } catch (err) { setEditError(err.message); }
    finally { setSaveLoading(false); }
  }, [editName, editStepsRaw, editCategory, addNotification, loadTemplates]);

  const handleClone = useCallback(async (id, name) => {
    const r = await cloneTemplate(id, `${name} (copy)`).catch(()=>null);
    if (r?.ok) { addNotification?.(`Duplicated: ${name}`, "ok"); await loadTemplates(); }
  }, [addNotification, loadTemplates]);

  const handleDelete = useCallback(async (id, name) => {
    const r = await deleteTemplate(id).catch(()=>null);
    if (r?.ok) {
      addNotification?.(`Deleted: ${name}`, "ok"); setConfirmDeleteId(null);
      await loadTemplates();
      if (selectedWorkflow?.item?.id === id) { setSelected(null); setView("saved"); }
    }
  }, [addNotification, loadTemplates, selectedWorkflow]);

  const dismissOnboarding = useCallback(() => {
    localStorage.setItem("bap_onboarded", "1"); setOnboarding(false);
  }, []);

  const dismissFirstRun = useCallback(() => {
    localStorage.setItem("bap_firstrun_done", "1");
    localStorage.setItem("bap_onboarded", "1");
    setShowFirstRun(false);
    setOnboarding(false);
  }, []);

  const firstRunSelect = useCallback((item) => {
    dismissFirstRun();
    openDetail("library", item);
  }, [dismissFirstRun, openDetail]);

  // ── Share handlers ────────────────────────────────────────────────────────
  const handleShare = useCallback((item, source) => {
    const payload = buildSharePayload(item, source);
    const json    = JSON.stringify(payload, null, 2);
    const ok = copyToClipboard(json);
    setShareToast(ok ? "copied" : "download");
    if (!ok) downloadJson(payload, `${(item.name||item.label||"workflow").replace(/\s+/g,"_")}.jarvis.json`);
    setTimeout(() => setShareToast(null), 2400);
  }, []);

  const handleExportDownload = useCallback((item, source) => {
    const payload = buildSharePayload(item, source);
    downloadJson(payload, `${(item.name||item.label||"workflow").replace(/\s+/g,"_")}.jarvis.json`);
    setShareToast("downloaded");
    setTimeout(() => setShareToast(null), 2400);
  }, []);

  // Import a workflow from JSON string
  const handleImport = useCallback(async (rawJson) => {
    const { ok, payload, error } = parseSharePayload(rawJson);
    if (!ok) return { ok: false, error };
    const steps = payload.steps && payload.steps.length > 0 ? payload.steps : [{ action:"navigate", url:"https://example.com", label:"Imported step" }];
    const r = await saveTemplate(
      payload.label || payload.name,
      steps,
      { category: payload.category || "automation", source: "import", description: payload.description, tags: payload.tags }
    ).catch(e => ({ ok: false, error: e.message }));
    if (r?.ok) {
      addNotification?.(`Imported: ${payload.label || payload.name}`, "ok");
      await loadTemplates();
      setView("saved");
    }
    return r;
  }, [addNotification, loadTemplates]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="bap-root">

      {/* Share toast */}
      {shareToast && (
        <div className="bap-share-toast">
          {shareToast === "copied"     && "✓ Copied to clipboard"}
          {shareToast === "downloaded" && "✓ Downloaded"}
          {shareToast === "download"   && "Downloaded (clipboard unavailable)"}
        </div>
      )}

      {/* First-run guided modal */}
      {showFirstRun && catalogue.length > 0 && (
        <FirstRunModal
          catalogue={catalogue}
          onSelect={firstRunSelect}
          onDismiss={dismissFirstRun}
        />
      )}

      {/* Import modal */}
      {showImport && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Screenshot lightbox */}
      {lightboxSrc && <ScreenshotLightbox src={lightboxSrc} onClose={()=>setLightboxSrc(null)} />}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bap-header">
        <div className="bap-header-left">
          <span className="bap-title">Browser Automation</span>
          {sysHealth?.runs > 0 && (
            <div className="bap-sys-pill" title={sysHealth.message}>
              <HealthDot band={sysHealth.band} />
              <span>{sysHealth.passRate}% · {sysHealth.runs} runs · {sysHealth.trend}</span>
            </div>
          )}
          {!sysHealth?.runs && !loading && (
            <span className="bap-sys-pill bap-sys-new">No runs yet — run your first workflow</span>
          )}
        </div>
        <div className="bap-header-nav">
          {[
            {id:"dashboard",   label:"Dashboard",  sub:"Your workspace",       title:"Your automation workspace — pinned workflows, recent runs, and system health"},
            {id:"marketplace", label:"Browse",      sub:"25 automations",       title:"25 ready-to-run automations — pick one, fill a field, hit Run"},
            {id:"saved",       label:`Mine${templates.length>0?` (${templates.length})`:templates.length===0?" (empty)":""}`, sub:"Saved templates", title:"Your saved workflow templates — run, edit, clone, or schedule them"},
            {id:"history",     label:"History",     sub:"Past runs + replay",   title:"Every execution result — with screenshots, step breakdowns, and replay controls"},
          ].map(tab => (
            <button key={tab.id} className={`bap-nav-tab${view===tab.id?" active":""}`} onClick={()=>{ setView(tab.id); if(tab.id==="dashboard") dismissNotifications(); }} title={tab.title} data-sub={tab.sub}>
              {tab.label}
              {tab.id === "dashboard" && unreadNotifCount > 0 && (
                <span className="bap-notif-badge">{unreadNotifCount}</span>
              )}
            </button>
          ))}
          <button className="bap-nav-tab bap-nav-search" onClick={()=>setShowSearch(v=>!v)} title="Search all workflows and templates">⌕ Search</button>
          <button className="bap-nav-tab bap-nav-import" onClick={()=>setShowImport(true)} title="Import a workflow from a .jarvis.json file shared by a teammate">⤵ Import</button>
          <button className="bap-nav-tab bap-nav-editor" onClick={()=>{setEditName("");setEditRaw("[]");setEditCat("automation");setEditDesc("");setEditTagsRaw("");setEditError(null);setView("editor");}} title="Build a new workflow visually — no code needed">+ Build</button>
        </div>
      </div>

      {/* ── Global search ──────────────────────────────────────────────────── */}
      {showSearch && (
        <div className="bap-global-search-panel">
          <div className="bap-global-search-bar">
            <span className="bap-search-icon">⌕</span>
            <input
              className="bap-global-search-input"
              type="text"
              autoFocus
              placeholder="Search all workflows and templates…"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
            />
            {globalSearch && <button className="bap-search-clear" onClick={()=>setGlobalSearch("")}>✕</button>}
            <button className="bap-btn-ghost bap-btn-sm" onClick={()=>{setShowSearch(false);setGlobalSearch("");}}>Close</button>
          </div>
          {globalSearch.trim().length >= 1 && (() => {
            const q = globalSearch.toLowerCase();
            const libHits = catalogue.filter(w =>
              w.label?.toLowerCase().includes(q) ||
              w.name?.toLowerCase().includes(q) ||
              (WORKFLOW_SUMMARY[w.name]||w.description||"").toLowerCase().includes(q) ||
              (WORKFLOW_TAGS[w.name]||[]).some(t=>t.includes(q))
            ).slice(0, 8);
            const tplHits = templates.filter(t =>
              t.name?.toLowerCase().includes(q) ||
              t.description?.toLowerCase().includes(q) ||
              (t.tags||[]).some(tag=>tag.includes(q))
            ).slice(0, 5);
            const total = libHits.length + tplHits.length;
            if (total === 0) return <div className="bap-global-search-empty">No results for "{globalSearch}"</div>;
            return (
              <div className="bap-global-search-results">
                {libHits.length > 0 && (
                  <div className="bap-search-result-group">
                    <div className="bap-search-result-group-label">Library ({libHits.length})</div>
                    {libHits.map(item => (
                      <button key={item.name} className="bap-search-result-row" onClick={()=>{openDetail("library",item);setShowSearch(false);setGlobalSearch("");}}>
                        <span className="bap-search-result-icon" style={{color:CATEGORY_META[item.category]?.color||"var(--op-text2)"}}>
                          {CATEGORY_META[item.category]?.icon||"◌"}
                        </span>
                        <div className="bap-search-result-body">
                          <span className="bap-search-result-name">{item.label}</span>
                          <span className="bap-search-result-meta">{CATEGORY_META[item.category]?.label} · {DIFFICULTY[item.name]?.label||"Medium"}</span>
                        </div>
                        <span className="bap-search-result-cta">Run →</span>
                      </button>
                    ))}
                  </div>
                )}
                {tplHits.length > 0 && (
                  <div className="bap-search-result-group">
                    <div className="bap-search-result-group-label">My Templates ({tplHits.length})</div>
                    {tplHits.map(tpl => (
                      <button key={tpl.id} className="bap-search-result-row" onClick={()=>{openDetail("template",tpl);setShowSearch(false);setGlobalSearch("");}}>
                        <span className="bap-search-result-icon" style={{color:CATEGORY_META[tpl.category]?.color||"var(--op-text2)"}}>
                          {CATEGORY_META[tpl.category]?.icon||"✦"}
                        </span>
                        <div className="bap-search-result-body">
                          <span className="bap-search-result-name">{tpl.name}</span>
                          <span className="bap-search-result-meta">Template · {tpl.steps?.length||0} steps</span>
                        </div>
                        <span className="bap-search-result-cta">Open →</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ DASHBOARD ════════════════════════════════════════════════════════ */}
      {view === "dashboard" && (
        <WorkflowDashboard
          catalogue={catalogue}
          templates={templates}
          history={history}
          sysHealth={sysHealth}
          favorites={favorites}
          pins={pins}
          notes={notes}
          wfHealthMap={wfHealthMap}
          onOpenTemplate={tpl=>openDetail("template",tpl)}
          onOpenLibrary={item=>openDetail("library",item)}
          onBrowse={()=>setView("marketplace")}
          onMine={()=>setView("saved")}
          onHistory={()=>setView("history")}
          scheduleAlerts={scheduleAlerts}
          onRunScheduled={tpl=>openDetail("template",tpl)}
          scheduleNotifs={scheduleNotifs}
          onDismissNotifs={dismissNotifications}
          onRunPinned={pinnedId => {
            const tpl = templates.find(t => t.id === pinnedId);
            if (tpl) openDetail("template", tpl);
          }}
        />
      )}

      {/* ═══ ONBOARDING BANNER ════════════════════════════════════════════════ */}
      {showOnboarding && view === "marketplace" && (
        <OnboardingBanner
          onDismiss={dismissOnboarding}
          onPickStarter={() => { openDetail("library", catalogue.find(w=>w.name==="hackernews_top")||catalogue[0]); dismissOnboarding(); }}
        />
      )}

      {/* ═══ MARKETPLACE ══════════════════════════════════════════════════════ */}
      {view === "marketplace" && (
        <div className="bap-marketplace">

          {/* Search + sort row */}
          <div className="bap-search-sort-row">
            <div className="bap-search-wrap">
              <span className="bap-search-icon">⌕</span>
              <input
                className="bap-search"
                type="text"
                placeholder={`Search ${catalogue.length || 25} workflows…`}
                value={searchQuery}
                onChange={e=>{ setSearch(e.target.value); setActivePack(null); }}
              />
              {searchQuery && <button className="bap-search-clear" onClick={()=>setSearch("")}>✕</button>}
            </div>
            <select className="bap-sort-select" value={sortMode} onChange={e=>setSortMode(e.target.value)}>
              <option value="featured">Featured first</option>
              <option value="az">A → Z</option>
              <option value="difficulty">Easiest first</option>
              <option value="runtime">Fastest first</option>
            </select>
          </div>

          {/* Recents strip — only when nothing is filtering */}
          {!searchQuery && !activeTag && activeCategory === "all" && !activePack && recentCatalogue.length > 0 && (
            <div className="bap-recents-row">
              <span className="bap-recents-label">Recently viewed</span>
              {recentCatalogue.map(item => (
                <button key={item.name} className="bap-recent-chip" onClick={()=>openDetail("library",item)}>
                  <span style={{color:CATEGORY_META[item.category]?.color||"var(--op-text2)"}}>{CATEGORY_META[item.category]?.icon||"◌"}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* Featured packs — only when not filtering */}
          {!searchQuery && !activeTag && activeCategory === "all" && !activePack && (
            <div className="bap-packs-row">
              {FEATURED_PACKS.map(pack => (
                <button
                  key={pack.id}
                  className="bap-pack-card"
                  style={{"--pack-color":pack.color,"--pack-accent":pack.accent,"--pack-border":pack.border}}
                  onClick={()=>setActivePack(pack.id)}
                >
                  <span className="bap-pack-icon" style={{color:pack.color}}>{pack.icon}</span>
                  <span className="bap-pack-label">{pack.label}</span>
                  <span className="bap-pack-tagline">{pack.tagline}</span>
                  <span className="bap-pack-count">{pack.workflows.length} workflows</span>
                </button>
              ))}
            </div>
          )}

          {/* Active pack banner */}
          {activePack && (
            <div className="bap-pack-active-banner">
              {(() => {
                const pack = FEATURED_PACKS.find(p=>p.id===activePack);
                return <>
                  <span className="bap-pack-active-icon" style={{color:pack?.color}}>{pack?.icon}</span>
                  <span className="bap-pack-active-label">{pack?.label}</span>
                  <span className="bap-pack-active-tagline">{pack?.tagline}</span>
                  <button className="bap-pack-active-clear" onClick={()=>setActivePack(null)}>✕ Clear</button>
                </>;
              })()}
            </div>
          )}

          {/* Category filter */}
          <div className="bap-cat-strip">
            {categories.map(cat => {
              const meta  = cat === "all" ? {label:"All",icon:"⊞",color:"var(--op-text2)"} : CATEGORY_META[cat]||{label:cat,icon:"◌",color:"var(--op-text2)"};
              const count = cat === "all" ? catalogue.length : catalogue.filter(w=>w.category===cat).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  className={`bap-cat-pill${activeCategory===cat&&!activePack?" active":""}`}
                  style={activeCategory===cat&&!activePack ? {borderColor:meta.color,color:meta.color} : {}}
                  onClick={()=>{ setCategory(cat); setActivePack(null); setActiveTag(null); }}
                >
                  <span>{meta.icon}</span><span>{meta.label}</span>
                  <span className="bap-cat-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Tag chips */}
          {availableTags.length > 0 && !activePack && !searchQuery && (
            <div className="bap-tag-strip">
              {availableTags.slice(0,16).map(tag => (
                <button
                  key={tag}
                  className={`bap-tag-chip${activeTag===tag?" active":""}`}
                  onClick={()=>setActiveTag(activeTag===tag?null:tag)}
                ># {tag}</button>
              ))}
            </div>
          )}

          {/* Results summary */}
          {(searchQuery || activeTag || activePack) && (
            <div className="bap-results-meta">
              {filteredCatalogue.length} result{filteredCatalogue.length!==1?"s":""}
              {searchQuery && <> for <strong>"{searchQuery}"</strong></>}
              {activeTag && <> tagged <strong>#{activeTag}</strong></>}
              {(searchQuery||activeTag) && <button className="bap-clear-filters" onClick={()=>{setSearch("");setActiveTag(null);}}>Clear filters</button>}
            </div>
          )}

          {/* Beginner section — shown to new users when browsing unfiltered */}
          {!searchQuery && !activeTag && activeCategory === "all" && !activePack && !loading && !(sysHealth?.runs > 0) && (
            <div className="bap-beginner-section">
              <div className="bap-beginner-section-header">
                <span className="bap-beginner-section-label">⟢ Start here — no setup needed</span>
                <HelpTip>These workflows run with one click or one URL. Pick any one to try your first automation.</HelpTip>
              </div>
              <div className="bap-beginner-strip">
                {catalogue.filter(w => DIFFICULTY[w.name]?.label === "Beginner" || BEGINNER_SAFE.has(w.name)).slice(0, 5).map(item => (
                  <button key={item.name} className="bap-beginner-chip" onClick={() => openDetail("library", item)}>
                    <span className="bap-beginner-chip-icon">{CATEGORY_META[item.category]?.icon || "◌"}</span>
                    <span className="bap-beginner-chip-label">{item.label}</span>
                    <span className="bap-beginner-chip-time">{EST_RUNTIME[item.name] ? `~${EST_RUNTIME[item.name]}s` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Workflow grid */}
          {loading ? (
            <div className="bap-loading"><span className="bap-loading-spinner" />Loading workflows…</div>
          ) : filteredCatalogue.length === 0 ? (
            <div className="bap-empty">No workflows match your filters. <button className="bap-inline-link" onClick={()=>{setSearch("");setCategory("all");setActivePack(null);setActiveTag(null);}}>Clear all</button></div>
          ) : (
            <div className="bap-card-grid">
              {filteredCatalogue.map(item => (
                <WorkflowCard
                  key={item.name}
                  item={item}
                  isFav={favorites.has(item.name)}
                  isTrending={TRENDING.has(item.name)}
                  isNew={item.name === "competitor_analysis" || item.name === "contact_page_scraper" || item.name === "price_monitor" || item.name === "linkedin_profile"}
                  onToggleFav={()=>toggleFav(item.name)}
                  onSelect={()=>openDetail("library",item)}
                  onTagClick={tag=>{ setActiveTag(tag); setActivePack(null); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ MY TEMPLATES ════════════════════════════════════════════════════ */}
      {view === "saved" && (
        <SavedView
          templates={templates}
          wfHealthMap={wfHealthMap}
          favorites={favorites}
          pins={pins}
          notes={notes}
          confirmDeleteId={confirmDeleteId}
          onRun={tpl=>openDetail("template",tpl)}
          onEdit={tpl=>{ setEditName(tpl.name); setEditCat(tpl.category||"automation"); setEditRaw(JSON.stringify(tpl.steps,null,2)); setEditDesc(tpl.description||""); setEditTagsRaw((tpl.tags||[]).join(", ")); setEditError(null); setView("editor"); setSelected({source:"template",item:tpl}); }}
          onClone={handleClone}
          onDelete={(id)=>setConfirmDeleteId(id)}
          onConfirmDelete={handleDelete}
          onCancelDelete={()=>setConfirmDeleteId(null)}
          onToggleFav={toggleFav}
          onTogglePin={togglePin}
          onUpdateNote={updateNote}
          editingNoteId={editingNoteId}
          editingNoteText={editingNoteText}
          onStartEditNote={(id,cur)=>{ setEditingNoteId(id); setEditingNoteText(cur||""); }}
          onSaveNote={(id)=>{ updateNote(id, editingNoteText); setEditingNoteId(null); }}
          onCancelNote={()=>setEditingNoteId(null)}
          onChangeNoteText={setEditingNoteText}
          onShare={(tpl)=>handleShare(tpl,"template")}
          onExport={(tpl)=>handleExportDownload(tpl,"template")}
          onBrowse={()=>setView("marketplace")}
          onNew={()=>{ setEditName(""); setEditRaw("[]"); setEditCat("automation"); setEditError(null); setView("editor"); }}
          onImport={()=>setShowImport(true)}
          vars={vars}
          schedules={schedules}
          schedRuns={schedRuns}
          onUpdateVar={updateVar}
          onUpdateSchedule={updateSchedule}
          onViewHistory={(name)=>{ setView("history"); }}
        />
      )}

      {/* ═══ DETAIL ══════════════════════════════════════════════════════════ */}
      {view === "detail" && selectedWorkflow && (
        <DetailView
          workflow={selectedWorkflow}
          params={params}
          setParams={setParams}
          health={selectedWorkflow.source==="template" ? wfHealthMap[selectedWorkflow.item.id] : null}
          isFav={favorites.has(selectedWorkflow.item.name)}
          onToggleFav={()=>toggleFav(selectedWorkflow.item.name)}
          onRun={handleRun}
          onBack={()=>setView(selectedWorkflow.source==="template" ? "saved" : "marketplace")}
          onSaveAsTemplate={()=>{ setEditName(selectedWorkflow.item.label||selectedWorkflow.item.name); setEditCat(selectedWorkflow.item.category||"automation"); setEditRaw("[]"); setEditDesc(WORKFLOW_SUMMARY[selectedWorkflow.item.name]||selectedWorkflow.item.description||""); setEditTagsRaw((WORKFLOW_TAGS[selectedWorkflow.item.name]||[]).join(", ")); setEditError(null); setView("editor"); }}
          onShare={()=>handleShare(selectedWorkflow.item, selectedWorkflow.source)}
          onExport={()=>handleExportDownload(selectedWorkflow.item, selectedWorkflow.source)}
          running={running}
          shareToast={shareToast}
          vars={vars}
          catalogue={catalogue}
          onSelectSimilar={(item) => openDetail("library", item)}
          testMode={testMode}
          onToggleTestMode={selectedWorkflow?.source === "template" ? () => setTestMode(v => !v) : null}
        />
      )}

      {/* ═══ EXECUTION ═══════════════════════════════════════════════════════ */}
      {view === "run" && (
        <ExecutionView
          workflow={selectedWorkflow}
          running={running}
          liveSteps={liveSteps}
          result={runResult}
          onCancel={handleCancel}
          onBack={()=>setView(selectedWorkflow ? "detail" : "marketplace")}
          onRunAgain={handleRun}
          onViewHistory={()=>setView("history")}
          onOpenLightbox={setLightboxSrc}
          isFirstRun={history.length === 0}
          onSaveAsTemplate={selectedWorkflow?.source === "library" ? () => {
            const item = selectedWorkflow.item;
            setEditName(item.label||item.name);
            setEditCat(item.category||"automation");
            setEditRaw("[]");
            setEditDesc(WORKFLOW_SUMMARY[item.name]||item.description||"");
            setEditTagsRaw((WORKFLOW_TAGS[item.name]||[]).join(", "));
            setEditError(null);
            setView("editor");
          } : null}
          onSchedule={selectedWorkflow?.source === "template" ? () => setView("saved") : null}
          onShare={selectedWorkflow ? () => handleShare(selectedWorkflow.item, selectedWorkflow.source) : null}
          onBrowseSimilar={selectedWorkflow ? () => {
            if (selectedWorkflow.item?.category) setCategory(selectedWorkflow.item.category);
            setView("marketplace");
          } : null}
        />
      )}

      {/* ═══ HISTORY ═════════════════════════════════════════════════════════ */}
      {view === "history" && (
        <HistoryView
          history={history}
          loading={histLoading}
          running={running}
          sysHealth={sysHealth}
          onReplay={handleReplay}
          onRefresh={loadHistory}
          onOpenLightbox={setLightboxSrc}
        />
      )}

      {/* ═══ EDITOR ══════════════════════════════════════════════════════════ */}
      {view === "editor" && (
        <EditorView
          editName={editName}         setEditName={setEditName}
          editCategory={editCategory} setEditCat={setEditCat}
          editStepsRaw={editStepsRaw} setEditRaw={setEditRaw}
          editDesc={editDesc}         setEditDesc={setEditDesc}
          editTagsRaw={editTagsRaw}   setEditTagsRaw={setEditTagsRaw}
          editError={editError}
          saveLoading={saveLoading}
          onSave={handleSaveFromEditor}
          onBack={()=>setView(selectedWorkflow ? "detail" : "marketplace")}
          vars={vars}
        />
      )}
    </div>
  );
}

// ── ImportModal ───────────────────────────────────────────────────────────────

function ImportModal({ onImport, onClose }) {
  const [raw, setRaw]         = useState("");
  const [err, setErr]         = useState(null);
  const [busy, setBusy]       = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef               = useRef(null);

  function handleChange(text) {
    setRaw(text); setErr(null);
    const { ok, payload, error } = parseSharePayload(text);
    setPreview(ok ? payload : null);
    if (!ok && text.trim()) setErr(error);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleChange(ev.target.result || "");
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (!preview) { setErr("Paste or load a valid workflow JSON first"); return; }
    setBusy(true);
    const r = await onImport(raw);
    setBusy(false);
    if (!r?.ok) setErr(r?.error || "Import failed");
    else onClose();
  }

  return (
    <div className="bap-modal-overlay" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="bap-modal">
        <div className="bap-modal-header">
          <span className="bap-modal-title">Import Workflow</span>
          <button className="bap-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="bap-modal-body">
          <div className="bap-import-instructions">
            Paste an Ooplix workflow JSON string below, or load a <code>.jarvis.json</code> file exported from any Ooplix instance.
          </div>
          <textarea
            className="bap-import-textarea"
            value={raw}
            onChange={e=>handleChange(e.target.value)}
            placeholder={'{\n  "_jarvis": true,\n  "name": "My Workflow",\n  "steps": [...]\n}'}
            spellCheck={false}
            rows={8}
          />
          <div className="bap-import-actions">
            <button className="bap-btn-ghost bap-btn-sm" onClick={()=>fileRef.current?.click()}>⤵ Load .jarvis.json file</button>
            <input ref={fileRef} type="file" accept=".json,.jarvis.json" style={{display:"none"}} onChange={handleFile} />
          </div>
          {preview && (
            <div className="bap-import-preview">
              <div className="bap-import-preview-title">Ready to import</div>
              <div className="bap-import-preview-row">
                <span className="bap-import-preview-label">Name</span>
                <span className="bap-import-preview-val">{preview.label || preview.name}</span>
              </div>
              <div className="bap-import-preview-row">
                <span className="bap-import-preview-label">Category</span>
                <span className="bap-import-preview-val">{preview.category}</span>
              </div>
              <div className="bap-import-preview-row">
                <span className="bap-import-preview-label">Steps</span>
                <span className="bap-import-preview-val">{preview.steps?.length || 0}</span>
              </div>
              {preview.description && (
                <div className="bap-import-preview-desc">{preview.description}</div>
              )}
            </div>
          )}
          {err && <div className="bap-editor-error">{err}</div>}
        </div>
        <div className="bap-modal-footer">
          <button className="bap-btn-primary" onClick={handleSubmit} disabled={!preview || busy}>
            {busy ? "Importing…" : "Import Workflow"}
          </button>
          <button className="bap-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── WorkflowDashboard ─────────────────────────────────────────────────────────

// ── NewUserDashboard — shown when no runs and no templates yet ─────────────────

const NEW_USER_PICKS = [
  { name:"hackernews_top",    label:"Hacker News Top 10",  desc:"Today's top tech stories — no setup.",         icon:"◎", time:"~8s"  },
  { name:"site_uptime_check", label:"Check site uptime",   desc:"Paste your URL. See if it loads correctly.",   icon:"⬆", time:"~10s" },
  { name:"wikipedia_search",  label:"Wikipedia search",    desc:"Any topic. Readable summary back.",             icon:"⌕", time:"~12s" },
  { name:"npm_package_info",  label:"Look up an npm pkg",  desc:"Type a package name. Get version + stats.",    icon:"⌥", time:"~10s" },
];

function NewUserDashboard({ catalogue, onOpenLibrary, onBrowse, onNew }) {
  return (
    <div className="bap-new-user-dash">
      <div className="bap-nud-hero">
        <div className="bap-nud-hero-title">Ready to automate</div>
        <div className="bap-nud-hero-body">
          Pick a workflow below and hit Run. No code, no setup, no browser plugin.<br />
          Your first automation takes less than 30 seconds.
        </div>
      </div>

      <div className="bap-nud-picks-label">Good starting points</div>
      <div className="bap-nud-picks">
        {NEW_USER_PICKS.map(p => {
          const item = catalogue.find(w => w.name === p.name);
          return (
            <button key={p.name} className="bap-nud-pick" onClick={() => item && onOpenLibrary(item)}>
              <span className="bap-nud-pick-icon">{p.icon}</span>
              <div className="bap-nud-pick-body">
                <div className="bap-nud-pick-label">{p.label}</div>
                <div className="bap-nud-pick-desc">{p.desc}</div>
              </div>
              <span className="bap-nud-pick-time">{p.time}</span>
            </button>
          );
        })}
      </div>

      <div className="bap-nud-paths">
        <div className="bap-nud-path" onClick={onBrowse}>
          <span className="bap-nud-path-icon">⌕</span>
          <div>
            <div className="bap-nud-path-label">Browse all 25 workflows</div>
            <div className="bap-nud-path-desc">News, GitHub, SEO, monitoring, research, and more</div>
          </div>
          <span className="bap-nud-path-arrow">→</span>
        </div>
        <div className="bap-nud-path" onClick={onNew}>
          <span className="bap-nud-path-icon">✦</span>
          <div>
            <div className="bap-nud-path-label">Build your own</div>
            <div className="bap-nud-path-desc">Visual step builder — no code required</div>
          </div>
          <span className="bap-nud-path-arrow">→</span>
        </div>
      </div>
    </div>
  );
}

function WorkflowDashboard({ catalogue, templates, history, sysHealth, favorites, pins, notes, wfHealthMap, onOpenTemplate, onOpenLibrary, onBrowse, onMine, onHistory, scheduleAlerts, onRunScheduled, scheduleNotifs, onDismissNotifs, onRunPinned }) {
  const safePin    = pins || new Set();
  const safeNotes  = notes || {};

  const totalRuns     = history.length;
  const passCount     = history.filter(e=>e.ok).length;
  const failCount     = history.filter(e=>!e.ok&&!e.cancelled).length;
  const passRate      = totalRuns > 0 ? Math.round((passCount/totalRuns)*100) : null;
  const recent5       = history.slice(0,5);
  const pinnedTpl     = templates.filter(t=>safePin.has(t.id));
  const favLibrary    = catalogue.filter(w=>favorites.has(w.name));

  // Per-workflow last run from history
  const lastRunMap = {};
  history.forEach(e => { if (!lastRunMap[e.name]) lastRunMap[e.name] = e; });

  // Category breakdown of saved templates
  const catCounts = {};
  templates.forEach(t => { catCounts[t.category] = (catCounts[t.category]||0)+1; });

  // Brand-new user: show focused guidance instead of empty KPI tiles
  if (totalRuns === 0 && templates.length === 0 && catalogue.length > 0) {
    return (
      <div className="bap-dashboard">
        {scheduleAlerts && scheduleAlerts.length > 0 && (
          <div className="bap-sched-alerts">
            <div className="bap-sched-alerts-header">
              <span className="bap-sched-alerts-icon">🕐</span>
              <span className="bap-sched-alerts-title">{scheduleAlerts.length} scheduled workflow{scheduleAlerts.length!==1?"s":""} due</span>
            </div>
            {scheduleAlerts.map(alert => {
              const tpl = templates.find(t => t.id === alert.templateId);
              return (
                <div key={alert.templateId} className="bap-sched-alert-row">
                  <div className="bap-sched-alert-body">
                    <span className="bap-sched-alert-name">{alert.name}</span>
                    <span className="bap-sched-alert-meta">{nextRunLabel(alert.sched)} · due {fmtAge(alert.dueAt)}{alert.lastRun ? ` · last ran ${fmtAge(alert.lastRun)}` : " · never run"}</span>
                  </div>
                  {tpl && onRunScheduled && (
                    <button className="bap-btn-primary bap-btn-sm bap-sched-run-btn" onClick={()=>onRunScheduled(tpl)}>▶ Run now</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <NewUserDashboard catalogue={catalogue} onOpenLibrary={onOpenLibrary} onBrowse={onBrowse} onNew={()=>onMine()} />
      </div>
    );
  }

  return (
    <div className="bap-dashboard">

      {/* ── Missed schedule alerts ────────────────────────────────────────── */}
      {scheduleAlerts && scheduleAlerts.length > 0 && (
        <div className="bap-sched-alerts">
          <div className="bap-sched-alerts-header">
            <span className="bap-sched-alerts-icon">🕐</span>
            <span className="bap-sched-alerts-title">
              {scheduleAlerts.length} scheduled workflow{scheduleAlerts.length !== 1 ? "s" : ""} due
            </span>
          </div>
          {scheduleAlerts.map(alert => {
            const tpl = templates.find(t => t.id === alert.templateId);
            return (
              <div key={alert.templateId} className="bap-sched-alert-row">
                <div className="bap-sched-alert-body">
                  <span className="bap-sched-alert-name">{alert.name}</span>
                  <span className="bap-sched-alert-meta">
                    {nextRunLabel(alert.sched)} · due {fmtAge(alert.dueAt)}
                    {alert.lastRun ? ` · last ran ${fmtAge(alert.lastRun)}` : " · never run"}
                  </span>
                </div>
                {tpl && onRunScheduled && (
                  <button className="bap-btn-primary bap-btn-sm bap-sched-run-btn" onClick={()=>onRunScheduled(tpl)}>
                    ▶ Run now
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Scheduled run notifications ───────────────────────────────────── */}
      {scheduleNotifs && scheduleNotifs.length > 0 && (
        <div className="bap-run-notifs">
          <div className="bap-run-notifs-header">
            <span className="bap-run-notifs-icon">🔔</span>
            <span className="bap-run-notifs-title">
              {scheduleNotifs.filter(n=>!n.ok).length > 0
                ? `${scheduleNotifs.filter(n=>!n.ok).length} scheduled run${scheduleNotifs.filter(n=>!n.ok).length!==1?"s":""} failed since your last visit`
                : `${scheduleNotifs.length} scheduled run${scheduleNotifs.length!==1?"s":""} completed since your last visit`}
            </span>
            <button className="bap-run-notifs-dismiss" onClick={onDismissNotifs} title="Mark as seen">✕</button>
          </div>
          {scheduleNotifs.slice(0, 5).map(n => (
            <div key={n.templateId + n.lastRun} className={`bap-run-notif-row ${n.ok?"ok":"fail"}`}>
              <span className="bap-run-notif-badge">{n.ok ? "✓" : "✗"}</span>
              <div className="bap-run-notif-body">
                <span className="bap-run-notif-name">{n.name}</span>
                <span className="bap-run-notif-age"> · {fmtAge(n.lastRun)}</span>
                {!n.ok && n.error && (
                  <span className="bap-run-notif-error"> — {n.error.slice(0, 80)}</span>
                )}
              </div>
            </div>
          ))}
          {scheduleNotifs.length > 5 && (
            <div className="bap-run-notifs-more">+{scheduleNotifs.length - 5} more — view History for full details</div>
          )}
        </div>
      )}

      {/* ── Workflow health warnings ───────────────────────────────────────── */}
      {(() => {
        const warnings = templates.filter(t => {
          const h = wfHealthMap[t.id];
          return h && (h.band === "poor" || h.band === "fair") && h.runs >= 3;
        });
        if (warnings.length === 0) return null;
        return (
          <div className="bap-health-warnings">
            <div className="bap-health-warnings-header">
              <span className="bap-health-warn-icon">⚠</span>
              <span className="bap-health-warnings-title">
                {warnings.length} workflow{warnings.length!==1?"s":""} need attention
              </span>
            </div>
            {warnings.map(tpl => {
              const h = wfHealthMap[tpl.id];
              return (
                <div key={tpl.id} className={`bap-health-warn-row ${h.band}`} onClick={()=>onOpenTemplate(tpl)}>
                  <div className="bap-health-warn-name">{tpl.name}</div>
                  <div className="bap-health-warn-meta">
                    <span style={{color:healthBandColor(h.band)}}>{h.passRate}% pass</span>
                    <span>{h.runs} runs</span>
                    {h.recent5 && <span className="bap-health-warn-series">{h.recent5}</span>}
                  </div>
                  <span className="bap-health-warn-cta">Fix →</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── KPI row ───────────────────────────────────────────────────────── */}
      <div className="bap-dash-kpi-row">
        <div className="bap-dash-kpi" onClick={onBrowse} title="Browse library">
          <div className="bap-dash-kpi-val">{catalogue.length}</div>
          <div className="bap-dash-kpi-label">Library workflows</div>
        </div>
        <div className="bap-dash-kpi" onClick={onMine} title="My templates">
          <div className="bap-dash-kpi-val">{templates.length}</div>
          <div className="bap-dash-kpi-label">My templates</div>
        </div>
        <div className="bap-dash-kpi" onClick={onHistory} title="Execution history">
          <div className="bap-dash-kpi-val">{totalRuns}</div>
          <div className="bap-dash-kpi-label">Total runs</div>
        </div>
        {passRate !== null ? (
          <div className="bap-dash-kpi" onClick={onHistory} title="Overall success rate">
            <div className="bap-dash-kpi-val" style={{color: passRate>=80?"var(--op-green)":passRate>=60?"var(--op-amber)":"var(--op-red)"}}>{passRate}%</div>
            <div className="bap-dash-kpi-label">Success rate</div>
          </div>
        ) : (
          <div className="bap-dash-kpi bap-dash-kpi-empty">
            <div className="bap-dash-kpi-val">—</div>
            <div className="bap-dash-kpi-label">No runs yet</div>
          </div>
        )}
        <div className="bap-dash-kpi">
          <div className="bap-dash-kpi-val">{[...favorites].length}</div>
          <div className="bap-dash-kpi-label">Favorites</div>
        </div>
        <div className="bap-dash-kpi">
          <div className="bap-dash-kpi-val">{pinnedTpl.length}</div>
          <div className="bap-dash-kpi-label">Pinned</div>
        </div>
      </div>

      <div className="bap-dash-body">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="bap-dash-col">

          {/* Pinned quick-launch */}
          {pinnedTpl.length > 0 && (
            <div className="bap-dash-panel">
              <div className="bap-dash-panel-header">
                📌 Pinned
                {pinnedTpl.length > 1 && onRunPinned && (
                  <button
                    className="bap-dash-panel-link bap-run-all-btn"
                    title="Open each pinned workflow to run — sequential, one at a time"
                    onClick={() => onRunPinned(pinnedTpl[0].id)}
                  >▶ Run first</button>
                )}
              </div>
              <div className="bap-dash-quick-list">
                {pinnedTpl.map(tpl => {
                  const h = wfHealthMap[tpl.id];
                  return (
                    <div key={tpl.id} className="bap-dash-quick-row" onClick={()=>onOpenTemplate(tpl)}>
                      <div className="bap-dash-quick-name">{tpl.name}</div>
                      <div className="bap-dash-quick-meta">
                        {h && h.band !== "no-data" && (
                          <span style={{color:healthBandColor(h.band)}} title={`Health: ${h.band} — ${h.passRate}% pass rate over ${h.runs} runs`}>{h.score}/100</span>
                        )}
                        {tpl.usageCount>0 && <span>{tpl.usageCount} runs</span>}
                        {h?.recent5 && <span className="bap-pinned-series" title="Last 5 runs">{h.recent5}</span>}
                      </div>
                      <button className="bap-dash-run-btn" onClick={e=>{e.stopPropagation();onOpenTemplate(tpl);}}>▶</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Saved favorites */}
          {favLibrary.length > 0 && (
            <div className="bap-dash-panel">
              <div className="bap-dash-panel-header">★ Favorite workflows</div>
              <div className="bap-dash-quick-list">
                {favLibrary.slice(0,6).map(item => {
                  const last = lastRunMap[item.name];
                  return (
                    <div key={item.name} className="bap-dash-quick-row" onClick={()=>onOpenLibrary(item)}>
                      <span className="bap-dash-quick-icon" style={{color:CATEGORY_META[item.category]?.color||"var(--op-text2)"}}>
                        {CATEGORY_META[item.category]?.icon||"◌"}
                      </span>
                      <div className="bap-dash-quick-name">{item.label}</div>
                      <div className="bap-dash-quick-meta">
                        {last && <span>{last.ok?"✓":"✗"} {fmtAge(last.recordedAtISO)}</span>}
                      </div>
                      <button className="bap-dash-run-btn">▶</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* My templates by category */}
          {templates.length > 0 && Object.keys(catCounts).length > 0 && (
            <div className="bap-dash-panel">
              <div className="bap-dash-panel-header">My Templates by Category</div>
              <div className="bap-dash-cat-breakdown">
                {Object.entries(catCounts).sort((a,b)=>b[1]-a[1]).map(([cat,n]) => {
                  const meta = CATEGORY_META[cat]||{label:cat,icon:"◌",color:"var(--op-text2)"};
                  return (
                    <div key={cat} className="bap-dash-cat-row" onClick={onMine}>
                      <span className="bap-dash-cat-icon" style={{color:meta.color}}>{meta.icon}</span>
                      <span className="bap-dash-cat-label">{meta.label}</span>
                      <span className="bap-dash-cat-bar-wrap">
                        <span className="bap-dash-cat-bar" style={{width:`${Math.round((n/templates.length)*100)}%`,background:meta.color}} />
                      </span>
                      <span className="bap-dash-cat-count">{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="bap-dash-col">

          {/* System health */}
          {sysHealth && sysHealth.runs > 0 && (
            <div className="bap-dash-panel">
              <div className="bap-dash-panel-header">System Health</div>
              <div className="bap-dash-health-block">
                <div className="bap-dash-health-score" style={{color:healthBandColor(sysHealth.band)}}>{sysHealth.score}<span className="bap-dash-health-denom">/100</span></div>
                <div className="bap-dash-health-band">{sysHealth.band}</div>
                <div className="bap-dash-health-stats">
                  <div><span>{sysHealth.passRate}%</span><label>pass rate</label></div>
                  <div><span>{sysHealth.runs}</span><label>total runs</label></div>
                  <div><span>{sysHealth.totalRetries||0}</span><label>retries</label></div>
                  <div><span>{sysHealth.trend}</span><label>trend</label></div>
                </div>
                {sysHealth.recentSeries && (
                  <div className="bap-dash-health-series" title="Last 10 runs">{sysHealth.recentSeries}</div>
                )}
              </div>
            </div>
          )}

          {/* Recent executions */}
          {recent5.length > 0 ? (
            <div className="bap-dash-panel">
              <div className="bap-dash-panel-header">
                Recent Executions
                <button className="bap-dash-panel-link" onClick={onHistory}>View all →</button>
              </div>
              <div className="bap-dash-recent-list">
                {recent5.map(exec => (
                  <div key={exec.id} className={`bap-dash-recent-row ${exec.ok?"ok":exec.cancelled?"cancelled":"fail"}`}>
                    <span className="bap-dash-recent-badge">{exec.ok?"✓":"✗"}</span>
                    <div className="bap-dash-recent-name">{exec.name}</div>
                    <div className="bap-dash-recent-meta">
                      <span>{fmtAge(exec.recordedAtISO)}</span>
                      {exec.stepsPassed>0 && <span>{exec.stepsPassed}/{exec.stepCount}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bap-dash-panel bap-dash-empty-panel">
              <div className="bap-dash-panel-header">Recent Executions</div>
              <div className="bap-dash-empty-body">
                <div className="bap-dash-empty-icon">⟳</div>
                <div>No runs yet. Browse the workflow library to get started.</div>
                <button className="bap-btn-primary bap-btn-sm" onClick={onBrowse}>Browse Workflows</button>
              </div>
            </div>
          )}

          {/* Suggested next workflows — based on what user has run */}
          {totalRuns > 0 && catalogue.length > 0 && (() => {
            const runNames = new Set(history.map(e => e.name));
            const usedCats = [...new Set(history.map(e => {
              const w = catalogue.find(c => c.name === e.name);
              return w?.category;
            }).filter(Boolean))];
            const suggestions = catalogue
              .filter(w => !runNames.has(w.name))
              .filter(w => usedCats.includes(w.category) || DIFFICULTY[w.name]?.label === "Beginner")
              .slice(0, 4);
            if (suggestions.length === 0) return null;
            return (
              <div className="bap-dash-panel">
                <div className="bap-dash-panel-header">
                  Try next
                  <HelpTip>Based on what you've run — workflows in the same categories you haven't tried yet.</HelpTip>
                </div>
                <div className="bap-dash-quick-list">
                  {suggestions.map(item => (
                    <div key={item.name} className="bap-dash-quick-row" onClick={() => onOpenLibrary(item)}>
                      <span className="bap-dash-quick-icon" style={{color:CATEGORY_META[item.category]?.color||"var(--op-text2)"}}>
                        {CATEGORY_META[item.category]?.icon||"◌"}
                      </span>
                      <div className="bap-dash-quick-name">{item.label}</div>
                      <div className="bap-dash-quick-meta">
                        <span style={{color:DIFFICULTY[item.name]?.color||"var(--op-text3)"}}>{DIFFICULTY[item.name]?.label||"Medium"}</span>
                        {EST_RUNTIME[item.name] && <span>~{EST_RUNTIME[item.name]}s</span>}
                      </div>
                      <button className="bap-dash-run-btn">▶</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Notes with notes */}
          {Object.keys(safeNotes).length > 0 && (
            <div className="bap-dash-panel">
              <div className="bap-dash-panel-header">Notes</div>
              <div className="bap-dash-notes-list">
                {Object.entries(safeNotes).map(([id, text]) => {
                  const tpl = templates.find(t=>t.id===id);
                  if (!tpl) return null;
                  return (
                    <div key={id} className="bap-dash-note-row" onClick={()=>onOpenTemplate(tpl)}>
                      <div className="bap-dash-note-tpl">{tpl.name}</div>
                      <div className="bap-dash-note-text">💬 {text}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HelpTip — inline contextual help chip ─────────────────────────────────────

function HelpTip({ children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <span className="bap-helptip">
      <button className="bap-helptip-btn" onClick={()=>setOpen(v=>!v)} title="What is this?">?</button>
      {open && (
        <span className="bap-helptip-body">
          {children}
          <button className="bap-helptip-close" onClick={()=>setOpen(false)}>✕</button>
        </span>
      )}
    </span>
  );
}

// ── FirstRunModal — guided 3-step welcome flow ────────────────────────────────

const FIRST_RUN_STEPS = [
  {
    id:      "welcome",
    title:   "Welcome to Browser Automation",
    icon:    "⟳",
    body:    "Ooplix can open real websites, fill forms, extract data, check uptime, and capture screenshots — automatically. No code, no configuration, no browser plugin required.",
    hint:    null,
    cta:     "Get started →",
    skip:    "Skip intro",
  },
  {
    id:      "how",
    title:   "How it works",
    icon:    "◎",
    body:    null,
    steps: [
      { num:"1", label:"Pick a workflow",      desc:"Choose from 25 ready-to-run automations — news, GitHub, SEO, health checks, and more." },
      { num:"2", label:"Fill in one field",    desc:"Most workflows only need a URL or a search term. That's it." },
      { num:"3", label:"Watch it run",         desc:"See each step execute live. Get a screenshot and result summary when it's done." },
    ],
    cta:     "Show me a workflow →",
    skip:    "Skip",
  },
  {
    id:      "pick",
    title:   "Your first automation",
    icon:    "⟢",
    body:    "These three take under 10 seconds and need no setup. Pick one to try.",
    picks: [
      { name:"hackernews_top",      label:"Hacker News Top 10",    desc:"Today's top tech stories, no signup needed.",    time:"~8s"  },
      { name:"site_uptime_check",   label:"Check a website is up", desc:"Paste any URL — check if it loads correctly.",   time:"~10s" },
      { name:"wikipedia_search",    label:"Wikipedia search",      desc:"Search any topic and get a readable summary.",   time:"~12s" },
    ],
    cta:     null,
    skip:    "I'll explore on my own",
  },
];

function FirstRunModal({ catalogue, onSelect, onDismiss }) {
  const [step, setStep] = React.useState(0);
  const current = FIRST_RUN_STEPS[step];
  const isLast  = step === FIRST_RUN_STEPS.length - 1;

  function advance() {
    if (step < FIRST_RUN_STEPS.length - 1) setStep(s => s + 1);
  }

  function pickWorkflow(name) {
    const item = catalogue.find(w => w.name === name);
    if (item) onSelect(item);
    else onDismiss();
  }

  return (
    <div className="bap-modal-overlay bap-firstrun-overlay">
      <div className="bap-firstrun-modal">
        {/* Progress dots */}
        <div className="bap-firstrun-dots">
          {FIRST_RUN_STEPS.map((s, i) => (
            <span key={s.id} className={`bap-firstrun-dot${i === step ? " active" : i < step ? " done" : ""}`} />
          ))}
        </div>

        <div className="bap-firstrun-icon">{current.icon}</div>
        <div className="bap-firstrun-title">{current.title}</div>

        {current.body && (
          <div className="bap-firstrun-body">{current.body}</div>
        )}

        {current.steps && (
          <div className="bap-firstrun-steps">
            {current.steps.map(s => (
              <div key={s.num} className="bap-firstrun-step">
                <span className="bap-firstrun-step-num">{s.num}</span>
                <div>
                  <div className="bap-firstrun-step-label">{s.label}</div>
                  <div className="bap-firstrun-step-desc">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {current.picks && (
          <div className="bap-firstrun-picks">
            {current.picks.map(p => (
              <button key={p.name} className="bap-firstrun-pick" onClick={() => pickWorkflow(p.name)}>
                <div className="bap-firstrun-pick-label">{p.label}</div>
                <div className="bap-firstrun-pick-desc">{p.desc}</div>
                <span className="bap-firstrun-pick-time">{p.time}</span>
              </button>
            ))}
          </div>
        )}

        <div className="bap-firstrun-footer">
          {!isLast && current.cta && (
            <button className="bap-btn-primary" onClick={advance}>{current.cta}</button>
          )}
          <button className="bap-btn-ghost bap-btn-sm" onClick={onDismiss}>{current.skip}</button>
        </div>
      </div>
    </div>
  );
}

// ── OnboardingBanner — shown in marketplace when not yet dismissed ─────────────
// (retained as a lightweight re-entry hint for users who dismissed the modal)

function OnboardingBanner({ onDismiss, onPickStarter }) {
  return (
    <div className="bap-onboarding">
      <div className="bap-onboarding-left">
        <div className="bap-onboarding-title">New here?</div>
        <div className="bap-onboarding-body">
          Pick any workflow, fill in one field, and hit Run. Real browser automation — no code needed.
        </div>
        <div className="bap-onboarding-steps">
          <div className="bap-ob-step"><span className="bap-ob-num">1</span><span>Pick a <strong>Beginner</strong> workflow below</span></div>
          <div className="bap-ob-step"><span className="bap-ob-num">2</span><span>Fill in the URL or search term</span></div>
          <div className="bap-ob-step"><span className="bap-ob-num">3</span><span>Hit Run — watch it happen live</span></div>
        </div>
      </div>
      <div className="bap-onboarding-right">
        <button className="bap-btn-primary" onClick={onPickStarter}>Try Hacker News Top →</button>
        <button className="bap-btn-ghost bap-btn-sm" onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}

// ── WorkflowCard ──────────────────────────────────────────────────────────────

function WorkflowCard({ item, isFav, isTrending, isNew, onToggleFav, onSelect, onTagClick }) {
  const cat      = CATEGORY_META[item.category]||{label:item.category,icon:"◌",color:"var(--op-text2)"};
  const diff     = DIFFICULTY[item.name]||{label:"Medium",color:"var(--op-amber)"};
  const tags     = (WORKFLOW_TAGS[item.name]||[]).slice(0,3);
  const est      = EST_RUNTIME[item.name];
  const stepCnt  = STEP_COUNTS[item.name];

  return (
    <div className="bap-card" onClick={onSelect}>
      <div className="bap-card-top">
        <span className="bap-card-icon" style={{color:cat.color}}>{cat.icon}</span>
        <div className="bap-card-top-right">
          {isNew      && <span className="bap-badge bap-badge-new">New</span>}
          {isTrending && !isNew && <span className="bap-badge bap-badge-trending">⬆ Trending</span>}
          {!isNew && !isTrending && <span className="bap-badge bap-badge-verified">✓ Verified</span>}
          <button
            className={`bap-fav-btn${isFav?" active":""}`}
            onClick={e=>{e.stopPropagation();onToggleFav();}}
            title={isFav?"Remove from favorites":"Add to favorites"}
          >{isFav?"★":"☆"}</button>
        </div>
      </div>
      <div className="bap-card-label">{item.label}</div>
      <div className="bap-card-desc">{item.description}</div>
      <div className="bap-card-tags">
        {tags.map(tag => (
          <span key={tag} className="bap-inline-tag" onClick={e=>{e.stopPropagation();onTagClick(tag);}}>#{tag}</span>
        ))}
      </div>
      <div className="bap-card-footer">
        <div className="bap-card-footer-left">
          <span
            className="bap-diff-pill"
            style={{color:diff.color,borderColor:diff.color+"44"}}
            title={DIFFICULTY_DESC[diff.label] || diff.label}
          >{diff.label}</span>
          {est && <span className="bap-est-time">~{est}s</span>}
          {stepCnt && <span className="bap-est-time">{stepCnt} steps</span>}
        </div>
        <button className="bap-card-run-btn" onClick={e=>{e.stopPropagation();onSelect();}}>Run →</button>
      </div>
    </div>
  );
}

// ── SavedCard (used by SavedView) ─────────────────────────────────────────────

function SavedCard({ tpl, health, isFav, isPinned, note, isDeleting, isEditingNote, editingNoteText, onRun, onEdit, onClone, onDelete, onConfirmDelete, onCancelDelete, onToggleFav, onTogglePin, onStartEditNote, onSaveNote, onCancelNote, onChangeNoteText, onShare, onExport, schedule, onSaveSchedule, schedRun, onViewHistory }) {
  const cat = CATEGORY_META[tpl.category]||{label:tpl.category,icon:"✦",color:"var(--op-text2)"};
  return (
    <div className={`bap-card bap-card-saved${isPinned?" bap-card-pinned":""}`}>
      <div className="bap-card-top">
        <span className="bap-card-icon" style={{color:cat.color}}>{cat.icon}</span>
        <div className="bap-card-top-right">
          {health && health.band !== "no-data" && <HealthDot band={health.band} />}
          {isPinned && <span className="bap-card-pin-badge" title="Pinned">📌</span>}
          <button className={`bap-fav-btn${isFav?" active":""}`} onClick={()=>onToggleFav(tpl.name)} title="Favorite">{isFav?"★":"☆"}</button>
        </div>
      </div>
      <div className="bap-card-label">{tpl.name}</div>
      <div className="bap-card-desc">{tpl.description||`${tpl.steps?.length||0} steps · ${cat.label}`}</div>

      {/* Trust signals: health score + run count */}
      <div className="bap-saved-trust-row">
        {health && health.band !== "no-data" ? (
          <span className="bap-trust-health" style={{color:healthBandColor(health.band)}}>
            {health.score}/100 · {health.passRate}% pass
            {health.recent5 && <span className="bap-trust-series">{health.recent5}</span>}
          </span>
        ) : (
          <span className="bap-trust-health bap-trust-no-data">No runs yet</span>
        )}
        {tpl.usageCount > 0 && <span className="bap-trust-runs">{tpl.usageCount} run{tpl.usageCount!==1?"s":""}</span>}
      </div>

      {/* Tags */}
      {(tpl.tags||[]).length > 0 && (
        <div className="bap-card-tags">
          {tpl.tags.slice(0,3).map(tag=><span key={tag} className="bap-inline-tag">#{tag}</span>)}
        </div>
      )}

      {/* Metadata row */}
      <div className="bap-card-saved-meta">
        <span className="bap-card-age">{fmtAge(tpl.lastUsed||tpl.savedAtISO)}</span>
        {tpl.source==="import" && <span className="bap-card-source-badge">imported</span>}
        {note && !isEditingNote && (
          <button className="bap-note-edit-btn" onClick={()=>onStartEditNote(tpl.id,note)} title="Edit note">💬 edit</button>
        )}
        {!note && !isEditingNote && (
          <button className="bap-note-add-btn" onClick={()=>onStartEditNote(tpl.id,"")} title="Add note">+ note</button>
        )}
      </div>

      {/* Note display / inline editor */}
      {isEditingNote ? (
        <div className="bap-note-editor">
          <textarea
            className="bap-note-textarea"
            value={editingNoteText}
            onChange={e=>onChangeNoteText(e.target.value)}
            placeholder="Add a private note for this template…"
            rows={2}
            autoFocus
          />
          <div className="bap-note-editor-actions">
            <button className="bap-btn-ghost bap-btn-xs" onClick={()=>onSaveNote(tpl.id)}>Save</button>
            <button className="bap-btn-ghost bap-btn-xs" onClick={onCancelNote}>Cancel</button>
            {note && <button className="bap-btn-danger bap-btn-xs" onClick={()=>{ onChangeNoteText(""); onSaveNote(tpl.id); }}>Remove</button>}
          </div>
        </div>
      ) : note ? (
        <div className="bap-card-note" onClick={()=>onStartEditNote(tpl.id,note)} title="Click to edit note">💬 {note}</div>
      ) : null}

      {/* Schedule panel */}
      {onSaveSchedule && (
        <SchedulePanel
          templateId={tpl.id}
          schedule={schedule}
          onSave={onSaveSchedule}
          schedRun={schedRun}
          health={health}
          templateName={tpl.name}
          onViewHistory={onViewHistory}
        />
      )}

      {/* Footer */}
      {isDeleting ? (
        <div className="bap-delete-confirm">
          <span>Delete "{tpl.name}"?</span>
          <button className="bap-btn-danger bap-btn-sm" onClick={()=>onConfirmDelete(tpl.id,tpl.name)}>Delete</button>
          <button className="bap-btn-ghost bap-btn-sm" onClick={onCancelDelete}>Cancel</button>
        </div>
      ) : (
        <div className="bap-card-footer" style={{marginTop:"auto",paddingTop:6,borderTop:"1px solid var(--op-border)"}}>
          <button className="bap-card-run-btn" onClick={()=>onRun(tpl)}>▶ Run</button>
          <div className="bap-card-actions">
            <button className="bap-card-action" onClick={()=>onEdit(tpl)} title="Edit">✎</button>
            <button className="bap-card-action" onClick={()=>onClone(tpl.id,tpl.name)} title="Duplicate">⧉</button>
            <button className={`bap-card-action${isPinned?" bap-card-action-pinned":""}`} onClick={()=>onTogglePin?.(tpl.id)} title={isPinned?"Unpin":"Pin to top"}>📌</button>
            <button className="bap-card-action bap-card-action-share" onClick={()=>onShare(tpl)} title="Copy share JSON">⤴</button>
            <button className="bap-card-action" onClick={()=>onExport(tpl)} title="Download .jarvis.json">⤵</button>
            <button className="bap-card-action bap-card-action-del" onClick={()=>onDelete(tpl.id,tpl.name)} title="Delete">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SavedView ─────────────────────────────────────────────────────────────────

function SavedView({ templates, wfHealthMap, favorites, pins, notes, confirmDeleteId, onRun, onEdit, onClone, onDelete, onConfirmDelete, onCancelDelete, onToggleFav, onTogglePin, onUpdateNote, editingNoteId, editingNoteText, onStartEditNote, onSaveNote, onCancelNote, onChangeNoteText, onShare, onExport, onBrowse, onNew, onImport, vars, schedules, schedRuns, onUpdateVar, onUpdateSchedule, onViewHistory }) {
  const [sortSaved, setSortSaved]       = useState("recent");
  const [searchSaved, setSearchSaved]   = useState("");
  const [activeCollection, setCollection] = useState("all");
  const [showVarManager, setShowVarManager] = useState(false);

  // Derive unique collections from template tags
  const collections = useMemo(() => {
    const sets = new Set();
    templates.forEach(t => (t.tags||[]).forEach(tag => sets.add(tag)));
    return ["all", ...sets];
  }, [templates]);

  const safePin = pins || new Set();

  const sorted = useMemo(() => {
    let list = [...templates];
    if (searchSaved) {
      const q = searchSaved.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || (t.description||"").toLowerCase().includes(q));
    }
    if (activeCollection !== "all") list = list.filter(t => (t.tags||[]).includes(activeCollection));
    if (sortSaved === "name")   list.sort((a,b) => a.name.localeCompare(b.name));
    if (sortSaved === "runs")   list.sort((a,b) => (b.usageCount||0)-(a.usageCount||0));
    if (sortSaved === "health") list.sort((a,b) => (wfHealthMap[b.id]?.score??-1)-(wfHealthMap[a.id]?.score??-1));
    // favorites float to top, pins float above all
    list.sort((a,b) => (favorites.has(b.name)?1:0)-(favorites.has(a.name)?1:0));
    list.sort((a,b) => (safePin.has(b.id)?1:0)-(safePin.has(a.id)?1:0));
    return list;
  }, [templates, sortSaved, searchSaved, activeCollection, wfHealthMap, favorites, safePin]);

  const pinnedTemplates = sorted.filter(t => safePin.has(t.id));
  const unpinnedTemplates = sorted.filter(t => !safePin.has(t.id));

  if (templates.length === 0) {
    return (
      <div className="bap-marketplace">
        <div className="bap-empty-state bap-empty-state-rich">
          <div className="bap-empty-icon">✦</div>
          <div className="bap-empty-heading">No saved templates yet</div>
          <div className="bap-empty-body">
            Templates are workflows you've customized and saved for reuse. You get them three ways:
          </div>
          <div className="bap-empty-paths">
            <div className="bap-empty-path-row" onClick={onBrowse}>
              <span className="bap-empty-path-num">1</span>
              <div>
                <div className="bap-empty-path-label">Run a library workflow</div>
                <div className="bap-empty-path-desc">After running any verified workflow, hit "Save to My Templates" in the result view.</div>
              </div>
              <span className="bap-empty-path-cta">Browse →</span>
            </div>
            <div className="bap-empty-path-row" onClick={onNew}>
              <span className="bap-empty-path-num">2</span>
              <div>
                <div className="bap-empty-path-label">Build from scratch</div>
                <div className="bap-empty-path-desc">Use the visual step builder — pick actions, fill in selectors or URLs, save.</div>
              </div>
              <span className="bap-empty-path-cta">Build →</span>
            </div>
            <div className="bap-empty-path-row" onClick={onImport}>
              <span className="bap-empty-path-num">3</span>
              <div>
                <div className="bap-empty-path-label">Import from a file</div>
                <div className="bap-empty-path-desc">Got a .jarvis.json from a teammate? Import it here.</div>
              </div>
              <span className="bap-empty-path-cta">Import →</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bap-marketplace">
      {showVarManager && (
        <div className="bap-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowVarManager(false);}}>
          <div className="bap-modal bap-varman-modal">
            <VariableManager vars={vars||{}} onUpdateVar={onUpdateVar} onClose={()=>setShowVarManager(false)} />
          </div>
        </div>
      )}
      <div className="bap-saved-header">
        <span className="bap-section-title">My Templates <span className="bap-saved-count">{templates.length}</span></span>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <input className="bap-search bap-search-sm" type="text" placeholder="Search templates…" value={searchSaved} onChange={e=>setSearchSaved(e.target.value)} />
          <select className="bap-sort-select" value={sortSaved} onChange={e=>setSortSaved(e.target.value)}>
            <option value="recent">Most recent</option>
            <option value="name">Name A–Z</option>
            <option value="runs">Most used</option>
            <option value="health">Best health</option>
          </select>
          <button className="bap-btn-ghost bap-btn-sm" onClick={()=>setShowVarManager(true)} title="Manage reusable variables">{"{{}"} Variables</button>
          <button className="bap-btn-ghost bap-btn-sm" onClick={onImport} title="Import workflow from JSON">⤵</button>
          <button className="bap-btn-ghost bap-btn-sm" onClick={onNew}>+ New</button>
        </div>
      </div>

      {/* Collection filter if tags exist */}
      {collections.length > 1 && (
        <div className="bap-cat-strip">
          {collections.map(col => (
            <button
              key={col}
              className={`bap-cat-pill${activeCollection===col?" active":""}`}
              onClick={()=>setCollection(col)}
            >{col === "all" ? "All" : `#${col}`}</button>
          ))}
        </div>
      )}

      {pinnedTemplates.length > 0 && (
        <div className="bap-saved-section-header">
          <span className="bap-saved-section-label">📌 Pinned</span>
          <span className="bap-saved-section-count">{pinnedTemplates.length}</span>
        </div>
      )}
      <div className={`bap-card-grid${pinnedTemplates.length>0?" bap-card-grid-pinned-section":""}`}>
        {(pinnedTemplates.length > 0 ? pinnedTemplates : []).concat(
          pinnedTemplates.length > 0 ? [] : unpinnedTemplates
        ).map(tpl => <SavedCard
          key={tpl.id} tpl={tpl}
          health={wfHealthMap[tpl.id]}
          isFav={favorites.has(tpl.name)}
          isPinned={safePin.has(tpl.id)}
          note={(notes||{})[tpl.id]}
          isDeleting={confirmDeleteId===tpl.id}
          isEditingNote={editingNoteId===tpl.id}
          editingNoteText={editingNoteText}
          schedule={(schedules||{})[tpl.id]}
          schedRun={(schedRuns||{})[tpl.id]}
          onSaveSchedule={onUpdateSchedule}
          onViewHistory={onViewHistory}
          onRun={onRun} onEdit={onEdit} onClone={onClone} onDelete={onDelete}
          onConfirmDelete={onConfirmDelete} onCancelDelete={onCancelDelete}
          onToggleFav={onToggleFav} onTogglePin={onTogglePin}
          onStartEditNote={onStartEditNote} onSaveNote={onSaveNote}
          onCancelNote={onCancelNote} onChangeNoteText={onChangeNoteText}
          onShare={onShare} onExport={onExport}
        />)}
      </div>
      {pinnedTemplates.length > 0 && unpinnedTemplates.length > 0 && (
        <>
          <div className="bap-saved-section-header" style={{marginTop:12}}>
            <span className="bap-saved-section-label">All templates</span>
            <span className="bap-saved-section-count">{unpinnedTemplates.length}</span>
          </div>
          <div className="bap-card-grid">
            {unpinnedTemplates.map(tpl => <SavedCard
              key={tpl.id} tpl={tpl}
              health={wfHealthMap[tpl.id]}
              isFav={favorites.has(tpl.name)}
              isPinned={false}
              note={(notes||{})[tpl.id]}
              isDeleting={confirmDeleteId===tpl.id}
              isEditingNote={editingNoteId===tpl.id}
              editingNoteText={editingNoteText}
              schedule={(schedules||{})[tpl.id]}
              schedRun={(schedRuns||{})[tpl.id]}
              onSaveSchedule={onUpdateSchedule}
              onViewHistory={onViewHistory}
              onRun={onRun} onEdit={onEdit} onClone={onClone} onDelete={onDelete}
              onConfirmDelete={onConfirmDelete} onCancelDelete={onCancelDelete}
              onToggleFav={onToggleFav} onTogglePin={onTogglePin}
              onStartEditNote={onStartEditNote} onSaveNote={onSaveNote}
              onCancelNote={onCancelNote} onChangeNoteText={onChangeNoteText}
              onShare={onShare} onExport={onExport}
            />)}
          </div>
        </>
      )}
    </div>
  );
}

// ── VariableManager ───────────────────────────────────────────────────────────

function VariableManager({ vars, onUpdateVar, onClose }) {
  const [customKey, setCustomKey]     = useState("");
  const [customVal, setCustomVal]     = useState("");
  const [customErr, setCustomErr]     = useState("");

  function handleCustomAdd() {
    const k = customKey.trim().replace(/\s+/g,"_").replace(/[^a-zA-Z0-9_]/g,"");
    if (!k) { setCustomErr("Variable name required"); return; }
    if (VAR_PRESETS.some(p=>p.key===k)) { setCustomErr("Name conflicts with a built-in variable"); return; }
    onUpdateVar(k, customVal.trim());
    setCustomKey(""); setCustomVal(""); setCustomErr("");
  }

  const customVars = Object.keys(vars).filter(k => !VAR_PRESETS.some(p=>p.key===k));

  return (
    <div className="bap-varman">
      <div className="bap-varman-header">
        <span className="bap-varman-title">Workflow Variables</span>
        <button className="bap-modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="bap-varman-hint">
        Variables let you reuse values across workflows. Set a value once here, then type <code>{"{{variable_name}}"}</code> in any workflow field — Ooplix substitutes the real value when you run.
        <br /><span style={{fontSize:"9px",color:"var(--op-text3)",marginTop:4,display:"block"}}>Example: set <code>website_url</code> to <code>https://mysite.com</code>, then use <code>{"{{website_url}}"}</code> in any URL field across all your workflows.</span>
      </div>

      <div className="bap-varman-section-label">Built-in variables</div>
      <div className="bap-varman-rows">
        {VAR_PRESETS.map(p => (
          <div key={p.key} className="bap-varman-row">
            <div className="bap-varman-row-left">
              <span className="bap-varman-icon">{p.icon}</span>
              <div>
                <div className="bap-varman-label">{p.label}</div>
                <div className="bap-varman-desc">{p.desc}</div>
                <div className="bap-varman-token"><code>{"{{"+p.key+"}}"}</code></div>
              </div>
            </div>
            <input
              className="bap-varman-input"
              value={vars[p.key]||""}
              onChange={e=>onUpdateVar(p.key, e.target.value)}
              placeholder={p.placeholder}
            />
          </div>
        ))}
      </div>

      {customVars.length > 0 && (
        <>
          <div className="bap-varman-section-label">Custom variables</div>
          <div className="bap-varman-rows">
            {customVars.map(k => (
              <div key={k} className="bap-varman-row">
                <div className="bap-varman-row-left">
                  <span className="bap-varman-icon">✦</span>
                  <div>
                    <div className="bap-varman-label">{k}</div>
                    <div className="bap-varman-token"><code>{"{{"+k+"}}"}</code></div>
                  </div>
                </div>
                <input
                  className="bap-varman-input"
                  value={vars[k]||""}
                  onChange={e=>onUpdateVar(k, e.target.value)}
                  placeholder="value…"
                />
                <button className="bap-varman-del" onClick={()=>onUpdateVar(k,"")} title="Remove">✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="bap-varman-section-label">Add custom variable</div>
      <div className="bap-varman-custom-add">
        <input
          className="bap-varman-input bap-varman-key-input"
          value={customKey}
          onChange={e=>{setCustomKey(e.target.value);setCustomErr("");}}
          placeholder="variable_name"
        />
        <input
          className="bap-varman-input"
          value={customVal}
          onChange={e=>setCustomVal(e.target.value)}
          placeholder="value"
        />
        <button className="bap-btn-ghost bap-btn-sm" onClick={handleCustomAdd}>+ Add</button>
      </div>
      {customErr && <div className="bap-varman-err">{customErr}</div>}
    </div>
  );
}

// ── SchedulePanel ─────────────────────────────────────────────────────────────

function SchedulePanel({ templateId, schedule, onSave, schedRun, health, templateName, onViewHistory }) {
  const [freq, setFreq]           = useState(schedule?.freq || "manual");
  const [time, setTime]           = useState(schedule?.time || "09:00");
  const [day, setDay]             = useState(schedule?.day ?? 1);
  const [dayOfMonth, setDom]      = useState(schedule?.dayOfMonth || 1);
  const [open, setOpen]           = useState(false);

  function handleSave() {
    const sched = freq === "manual" ? null : { freq, time, day: Number(day), dayOfMonth: Number(dayOfMonth) };
    onSave(templateId, sched);
    setOpen(false);
  }

  const label   = schedule ? nextRunLabel(schedule) : null;
  const lastRun = schedRun?.lastRun || null;
  const dueAt   = schedule ? scheduleLastDue(schedule) : null;
  const overdue = dueAt && lastRun ? new Date(lastRun) < new Date(dueAt) : (dueAt && !lastRun);

  // Health indicator color based on template run history
  const healthColor = health && health.band !== "no-data"
    ? healthBandColor(health.band)
    : null;

  return (
    <div className="bap-schedule-panel">
      <button className="bap-schedule-trigger" onClick={()=>setOpen(v=>!v)}>
        {label ? (
          <>
            <span className={`bap-schedule-icon${overdue?" bap-schedule-icon-overdue":""}`}>🕐</span>
            <span className={`bap-schedule-label${overdue?" bap-schedule-label-overdue":""}`}>{label}
            </span>
            {overdue && <span className="bap-schedule-overdue-badge">overdue</span>}
          </>
        ) : (
          <><span className="bap-schedule-icon-dim">⏱</span><span className="bap-schedule-label-dim">Set schedule</span></>
        )}
      </button>
      {open && (
        <div className="bap-schedule-form">
          {/* Status row — last run + health */}
          <div className="bap-schedule-status-row">
            {lastRun ? (
              <span className="bap-schedule-last-run">Last ran {fmtAge(lastRun)}</span>
            ) : schedule && schedule.freq !== "manual" ? (
              <span className="bap-schedule-last-run bap-schedule-never">Never run</span>
            ) : null}
            {health && health.band !== "no-data" && (
              <span className="bap-schedule-health" style={{color:healthColor}}>
                {health.passRate}% pass · {health.runs} run{health.runs!==1?"s":""}
              </span>
            )}
            {overdue && (
              <span className="bap-schedule-overdue-label">⚠ Due {fmtAge(dueAt)}</span>
            )}
          </div>

          <div className="bap-schedule-form-row">
            <label className="bap-schedule-form-label">
              Frequency
              <HelpTip>Ooplix will run this workflow automatically at the time you choose. Daily = every day at that time. Weekly = once a week on the day you pick. Automatic runs appear in History and update the health score.</HelpTip>
            </label>
            <select className="bap-param-input bap-schedule-select" value={freq} onChange={e=>setFreq(e.target.value)}>
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {freq !== "manual" && (
            <div className="bap-schedule-form-row">
              <label className="bap-schedule-form-label">Time</label>
              <input className="bap-param-input bap-schedule-time" type="time" value={time} onChange={e=>setTime(e.target.value)} />
            </div>
          )}
          {freq === "weekly" && (
            <div className="bap-schedule-form-row">
              <label className="bap-schedule-form-label">Day</label>
              <select className="bap-param-input bap-schedule-select" value={day} onChange={e=>setDay(e.target.value)}>
                {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d,i)=>(
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
          )}
          {freq === "monthly" && (
            <div className="bap-schedule-form-row">
              <label className="bap-schedule-form-label">Day of month</label>
              <input className="bap-param-input bap-schedule-select" type="number" min={1} max={28} value={dayOfMonth} onChange={e=>setDom(e.target.value)} />
            </div>
          )}
          <div className="bap-schedule-form-actions">
            <button className="bap-btn-primary bap-btn-sm" onClick={handleSave}>Save</button>
            <button className="bap-btn-ghost bap-btn-sm" onClick={()=>setOpen(false)}>Cancel</button>
            {schedule && <button className="bap-btn-danger bap-btn-sm" onClick={()=>{onSave(templateId,null);setFreq("manual");setOpen(false);}}>Remove</button>}
            {onViewHistory && <button className="bap-btn-ghost bap-btn-sm" onClick={()=>{setOpen(false);onViewHistory(templateName);}}>View runs →</button>}
          </div>
          {freq !== "manual" && (
            <div className="bap-schedule-preview">{nextRunLabel({freq,time,day:Number(day),dayOfMonth:Number(dayOfMonth)})}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Selector confidence heuristic ─────────────────────────────────────────────

function selectorConfidence(sel) {
  if (!sel || !sel.trim()) return null;
  const s = sel.trim();
  // ID selectors are most specific
  if (/^#[\w-]+$/.test(s)) return { score: 95, label: "Excellent", color: "var(--op-green)", tip: "ID selectors are very reliable" };
  // Data attributes are stable
  if (/\[data-[\w-]+/.test(s)) return { score: 85, label: "Good", color: "var(--op-green)", tip: "Data attributes tend to be stable" };
  // Specific classes
  if (/^\.([\w-]+){1}$/.test(s)) return { score: 72, label: "Good", color: "var(--op-accent)", tip: "Single class selector — check it's unique" };
  // Named input selectors
  if (/input\[name=/.test(s) || /\[name=/.test(s)) return { score: 80, label: "Good", color: "var(--op-green)", tip: "Named inputs are usually stable" };
  // Tag only — fragile
  if (/^(div|span|a|p|li|ul|table)$/.test(s)) return { score: 35, label: "Fragile", color: "var(--op-amber)", tip: "Generic tag — too broad, may match many elements" };
  // Multiple comma-separated — fallback chain
  if (s.includes(",")) return { score: 65, label: "OK", color: "var(--op-accent)", tip: "Multiple fallbacks — one will match" };
  // Class with element
  if (/^\w+\.\w/.test(s)) return { score: 78, label: "Good", color: "var(--op-accent)", tip: "Element + class combo" };
  // Attribute selector
  if (/\[/.test(s)) return { score: 75, label: "Good", color: "var(--op-accent)", tip: "Attribute selector" };
  return { score: 55, label: "Moderate", color: "var(--op-amber)", tip: "Verify this selector in browser DevTools" };
}

// Enhanced confidence returns type label + estimated breadth
function selectorType(sel) {
  if (!sel || !sel.trim()) return null;
  const s = sel.trim();
  if (/^#[\w-]+$/.test(s))            return "ID";
  if (/\[data-[\w-]+/.test(s))        return "Data attribute";
  if (/\[name=/.test(s))              return "Named field";
  if (s.includes(","))                return "Fallback chain";
  if (/^\w+\[/.test(s))               return "Element+attribute";
  if (/^\.\S+$/.test(s))              return "Class";
  if (/^[\w]+$/.test(s))              return "Tag";
  return "Compound";
}

const SELECTOR_CHIPS = [
  { label:"#id",            val:"#element-id",        tip:"ID — most reliable, unique on the page" },
  { label:".class",         val:".class-name",         tip:"Class — usually stable, may match many" },
  { label:"button",         val:"button",              tip:"Any button element" },
  { label:"input[name]",    val:"input[name='field']", tip:"Named input — very stable for forms" },
  { label:"[data-testid]",  val:"[data-testid='btn']", tip:"Test attribute — stable, added intentionally" },
  { label:"a.link",         val:"a.nav-link",          tip:"Link with class — specific anchor" },
  { label:"h1",             val:"h1",                  tip:"Main heading — usually unique" },
  { label:".price",         val:".price",              tip:"Price element" },
];

// ── SelectorPickerModal ───────────────────────────────────────────────────────
// Provides a URL-load + manual CSS input flow with live confidence feedback.
// A true click-in-iframe picker requires browser extension / same-origin;
// this modal gives the nearest safe equivalent: guided selector input with
// real-time confidence, type label, suggestion engine, and copy-from-DevTools flow.

function SelectorPickerModal({ initialUrl, initialSelector, onInsert, onClose }) {
  const [url, setUrl]             = useState(initialUrl || "");
  const [urlInput, setUrlInput]   = useState(initialUrl || "");
  const [selector, setSelector]   = useState(initialSelector || "");
  const [mode, setMode]           = useState("guide"); // "guide" | "devtools" | "manual"
  const [copied, setCopied]       = useState(false);

  const conf = selectorConfidence(selector);
  const type = selectorType(selector);

  // Suggested improvements for known weak patterns
  const suggestions = useMemo(() => {
    const s = selector.trim();
    if (!s) return [];
    const out = [];
    if (/^(div|span|section|header|footer|main|nav|aside)$/.test(s))
      out.push({ label:"Add a class or ID", example:`${s}.${s}-wrapper` });
    if (/^a$/.test(s))
      out.push({ label:"Qualify by context", example:`nav a, .nav-links a` });
    if (s === "button")
      out.push({ label:"Add type or class", example:`button[type=submit], button.btn-primary` });
    if (s.split(",").length > 3)
      out.push({ label:"Too many fallbacks — pick the best 2", example:s.split(",").slice(0,2).join(",").trim() });
    return out;
  }, [selector]);

  function handleInsert() {
    if (selector.trim()) { onInsert(selector.trim()); onClose(); }
  }

  function handleCopyScript() {
    const script = `
// Run this in DevTools Console on the target page:
// 1. Right-click the element → Inspect
// 2. In the Console tab, run:
document.querySelectorAll('YOUR_SELECTOR_HERE').length
// It should return 1 for a unique element.
`.trim();
    copyToClipboard(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bap-modal-overlay" onClick={e=>{if(e.target===e.currentTarget) onClose();}}>
      <div className="bap-modal bap-picker-modal">

        {/* Header */}
        <div className="bap-modal-header">
          <span className="bap-modal-title">Element Picker</span>
          <button className="bap-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Mode tabs */}
        <div className="bap-picker-modal-tabs">
          <button className={`bap-picker-modal-tab${mode==="guide"?" active":""}`} onClick={()=>setMode("guide")}>
            ⟢ Guided
          </button>
          <button className={`bap-picker-modal-tab${mode==="devtools"?" active":""}`} onClick={()=>setMode("devtools")}>
            ⌥ From DevTools
          </button>
          <button className={`bap-picker-modal-tab${mode==="manual"?" active":""}`} onClick={()=>setMode("manual")}>
            ✎ Manual
          </button>
        </div>

        <div className="bap-modal-body bap-picker-modal-body">

          {/* ── GUIDED MODE ── */}
          {mode === "guide" && (
            <div className="bap-picker-guide">
              <div className="bap-picker-guide-steps">
                <div className="bap-picker-guide-step">
                  <div className="bap-picker-guide-num">1</div>
                  <div>
                    <div className="bap-picker-guide-label">Open your target website</div>
                    <div className="bap-picker-guide-desc">Open a new browser tab and go to the page your workflow will run on.</div>
                  </div>
                </div>
                <div className="bap-picker-guide-step">
                  <div className="bap-picker-guide-num">2</div>
                  <div>
                    <div className="bap-picker-guide-label">Right-click the element you want to interact with</div>
                    <div className="bap-picker-guide-desc">Click "Inspect" — DevTools opens and highlights the element.</div>
                  </div>
                </div>
                <div className="bap-picker-guide-step">
                  <div className="bap-picker-guide-num">3</div>
                  <div>
                    <div className="bap-picker-guide-label">Look for id="" or class="" on the highlighted line</div>
                    <div className="bap-picker-guide-desc">
                      <code>id="submit-btn"</code> → use <code>#submit-btn</code><br/>
                      <code>class="btn primary"</code> → use <code>.btn.primary</code><br/>
                      <code>name="email"</code> → use <code>input[name='email']</code>
                    </div>
                  </div>
                </div>
                <div className="bap-picker-guide-step">
                  <div className="bap-picker-guide-num">4</div>
                  <div>
                    <div className="bap-picker-guide-label">Type it below</div>
                    <div className="bap-picker-guide-desc">The confidence meter will score it instantly.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── DEVTOOLS MODE ── */}
          {mode === "devtools" && (
            <div className="bap-picker-devtools">
              <div className="bap-picker-devtools-intro">
                DevTools can copy a selector for you automatically. Here's how:
              </div>
              <div className="bap-picker-devtools-steps">
                <div className="bap-picker-devtools-step">
                  <span className="bap-picker-devtools-num">1</span>
                  Right-click any element on the page → <strong>Inspect</strong>
                </div>
                <div className="bap-picker-devtools-step">
                  <span className="bap-picker-devtools-num">2</span>
                  In the Elements panel, right-click the highlighted line
                </div>
                <div className="bap-picker-devtools-step">
                  <span className="bap-picker-devtools-num">3</span>
                  Choose <strong>Copy → Copy selector</strong>
                </div>
                <div className="bap-picker-devtools-step">
                  <span className="bap-picker-devtools-num">4</span>
                  Paste it in the selector field below
                </div>
              </div>
              <div className="bap-picker-devtools-warn">
                ⚠ DevTools-generated selectors are often very long and fragile (e.g. <code>body &gt; div:nth-child(3) &gt; main &gt; section &gt; button</code>).
                The confidence meter below will warn you. Prefer IDs, named inputs, or class names instead.
              </div>
              <button className="bap-btn-ghost bap-btn-sm" onClick={handleCopyScript}>
                {copied ? "✓ Copied!" : "⧉ Copy validation script"}
              </button>
            </div>
          )}

          {/* ── MANUAL MODE ── */}
          {mode === "manual" && (
            <div className="bap-picker-manual">
              <div className="bap-picker-manual-intro">
                Write a CSS selector directly. Use the common patterns below as a starting point.
              </div>
              <div className="bap-picker-chip-row">
                {SELECTOR_CHIPS.map(c => (
                  <button
                    key={c.val}
                    className="bap-sel-chip bap-sel-chip-lg"
                    title={c.tip}
                    onClick={()=>setSelector(c.val)}
                  >{c.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* ── Selector input (all modes) ── */}
          <div className="bap-picker-input-section">
            <label className="bap-picker-input-label">CSS Selector</label>
            <div className="bap-picker-input-row">
              <input
                className="bap-picker-input"
                value={selector}
                onChange={e=>setSelector(e.target.value)}
                placeholder="e.g.  #submit-btn  or  input[name='email']"
                autoFocus
                spellCheck={false}
              />
            </div>

            {/* Live confidence meter */}
            {selector.trim() && conf && (
              <div className="bap-picker-confidence">
                <div className="bap-picker-conf-bar-track">
                  <div className="bap-picker-conf-bar" style={{width:`${conf.score}%`, background:conf.color}} />
                </div>
                <div className="bap-picker-conf-meta">
                  <span className="bap-picker-conf-label" style={{color:conf.color}}>{conf.label}</span>
                  <span className="bap-picker-conf-score">{conf.score}/100</span>
                  {type && <span className="bap-picker-conf-type">{type}</span>}
                </div>
                <div className="bap-picker-conf-tip">{conf.tip}</div>
              </div>
            )}

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div className="bap-picker-suggestions">
                <div className="bap-picker-suggestions-label">Suggestions to improve:</div>
                {suggestions.map((s,i) => (
                  <div key={i} className="bap-picker-suggestion">
                    <span className="bap-picker-suggestion-label">{s.label}</span>
                    <button
                      className="bap-picker-suggestion-apply"
                      onClick={()=>setSelector(s.example)}
                    >Try: <code>{s.example}</code></button>
                  </div>
                ))}
              </div>
            )}

            {/* Common patterns quick-ref */}
            {!selector.trim() && (
              <div className="bap-picker-empty-hint">
                <div className="bap-picker-empty-title">Common patterns</div>
                <div className="bap-picker-pattern-grid">
                  {[
                    {sel:"#login-btn",          q:"Excellent", c:"var(--op-green)"},
                    {sel:"input[name='email']",  q:"Excellent", c:"var(--op-green)"},
                    {sel:".submit-button",        q:"Good",      c:"var(--op-accent)"},
                    {sel:"button[type=submit]",   q:"Good",      c:"var(--op-accent)"},
                    {sel:"[data-testid='nav']",   q:"Good",      c:"var(--op-accent)"},
                    {sel:"div",                   q:"Fragile",   c:"var(--op-amber)"},
                  ].map(p => (
                    <button key={p.sel} className="bap-picker-pattern" onClick={()=>setSelector(p.sel)}>
                      <code>{p.sel}</code>
                      <span style={{color:p.c,fontSize:8,fontWeight:700}}>{p.q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bap-modal-footer">
          <button
            className="bap-btn-primary"
            onClick={handleInsert}
            disabled={!selector.trim()}
          >Use this selector</button>
          <button className="bap-btn-ghost" onClick={onClose}>Cancel</button>
          {selector.trim() && conf && conf.score < 50 && (
            <span className="bap-picker-footer-warn">⚠ Low confidence — this selector may be unreliable</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DetailView ────────────────────────────────────────────────────────────────

function DetailView({ workflow, params, setParams, health, isFav, onToggleFav, onRun, onBack, onSaveAsTemplate, onShare, onExport, running, shareToast, vars, catalogue, onSelectSimilar, testMode, onToggleTestMode }) {
  const item    = workflow.item;
  const cat     = CATEGORY_META[item.category]||{label:item.category,icon:"◌",color:"var(--op-text2)"};
  const diff    = DIFFICULTY[item.name]||{label:"Medium",color:"var(--op-amber)"};
  const schema  = PARAM_SCHEMA[item.name]||[];
  const tags    = WORKFLOW_TAGS[item.name]||[];
  const est     = EST_RUNTIME[item.name];
  const summary = WORKFLOW_SUMMARY[item.name]||item.description;
  const reqs    = WORKFLOW_REQUIREMENTS[item.name]||"A valid HTTPS URL.";
  const guide   = BEGINNER_GUIDE[item.name];
  const isBeginner = BEGINNER_SAFE.has(item.name);

  // Similar workflows — same category, excluding current
  const similar = (catalogue||[])
    .filter(w => w.category === item.category && w.name !== item.name)
    .slice(0, 3);

  const allFilled = schema.every(f => f.type === "number" || !!params[f.key]?.toString().trim());

  // Share card text — plain-text rendition
  const shareCardText = [
    `🔁 ${item.label || item.name}`,
    `Category: ${cat.label}  •  ~${est||"?"}s  •  ${diff.label}`,
    summary,
    tags.length ? `Tags: ${tags.map(t=>"#"+t).join("  ")}` : "",
    `— Shared from Ooplix Browser Automation`,
  ].filter(Boolean).join("\n");

  return (
    <div className="bap-detail">
      {/* Breadcrumb row */}
      <div className="bap-breadcrumb">
        <button className="bap-back-btn" onClick={onBack}>← Back</button>
        <span className="bap-breadcrumb-sep">/</span>
        <span className="bap-breadcrumb-label">{item.label||item.name}</span>
        <button className={`bap-fav-btn bap-fav-detail${isFav?" active":""}`} onClick={onToggleFav} title={isFav?"Remove from favorites":"Add to favorites"}>{isFav?"★ Saved":"☆ Save"}</button>
      </div>

      {/* Hero */}
      <div className="bap-detail-hero">
        <div className="bap-detail-icon" style={{color:cat.color}}>{cat.icon}</div>
        <div className="bap-detail-hero-body">
          <div className="bap-detail-title">{item.label||item.name}</div>
          <div className="bap-detail-meta">
            <span className="bap-badge bap-badge-verified">✓ Verified</span>
            <span className="bap-badge" style={{color:diff.color,borderColor:diff.color+"44"}} title={DIFFICULTY_DESC[diff.label] || diff.label}>{diff.label}</span>
            <span className="bap-badge" style={{color:cat.color,borderColor:cat.color+"44"}}>{cat.label}</span>
            {est && <span className="bap-badge" style={{color:"var(--op-text3)",borderColor:"var(--op-border2)"}}>~{est}s</span>}
            {isBeginner && <span className="bap-badge bap-badge-beginner">Beginner friendly</span>}
          </div>
          <div className="bap-detail-desc">{summary}</div>
          {tags.length > 0 && (
            <div className="bap-detail-tags">
              {tags.map(t=><span key={t} className="bap-inline-tag">#{t}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* Beginner guide callout */}
      {guide && (
        <div className="bap-beginner-guide">
          <span className="bap-beginner-guide-icon">⟢</span>
          <div>
            <div className="bap-beginner-guide-title">How to use this workflow</div>
            <div className="bap-beginner-guide-body">{guide}</div>
          </div>
        </div>
      )}

      {/* Health card for saved templates */}
      {health && health.band !== "no-data" && (
        <div className="bap-detail-health">
          <div className="bap-detail-health-title">Reliability</div>
          <div className="bap-detail-health-stats">
            {[
              {val:health.score,         label:"Score",      color:healthBandColor(health.band)},
              {val:`${health.passRate}%`, label:"Pass rate"},
              {val:health.runs,          label:"Runs"},
              {val:health.avgDurationSec!=null?`${health.avgDurationSec}s`:"—", label:"Avg time"},
              {val:health.totalRetries,  label:"Retries"},
            ].map(s => (
              <div key={s.label} className="bap-health-stat">
                <div className="bap-health-stat-val" style={s.color?{color:s.color}:{}}>{s.val}</div>
                <div className="bap-health-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
          {health.recent5 && (
            <div className="bap-health-series">
              <span className="bap-health-series-label">Last 5 runs:</span>
              <span className="bap-health-series-val">{health.recent5}</span>
            </div>
          )}
          <div className="bap-health-message" style={{color:healthBandColor(health.band)}}>{health.message}</div>
        </div>
      )}

      {/* Param form */}
      {schema.length > 0 && (
        <div className="bap-param-form">
          <div className="bap-param-form-title">Configure</div>
          {schema.map(field => {
            const filled = vars ? (params[field.key]||"").trim() : (params[field.key]||"").trim();
            const preview = vars ? applyVars(params[field.key]||"", vars) : null;
            const hasToken = (params[field.key]||"").includes("{{");
            const filledVars = vars ? Object.entries(vars).filter(([,v])=>v) : [];
            return (
              <div className="bap-param-field" key={field.key}>
                <label className="bap-param-label">{field.label}</label>
                <input
                  className="bap-param-input"
                  type={field.type||"text"}
                  value={params[field.key]||""}
                  onChange={e=>setParams(p=>({...p,[field.key]:e.target.value}))}
                  placeholder={field.placeholder||""}
                />
                {filledVars.length > 0 && (
                  <div className="bap-var-chips">
                    {filledVars.map(([k])=>(
                      <button
                        key={k}
                        className="bap-var-chip"
                        onClick={()=>setParams(p=>({...p,[field.key]:(p[field.key]||"")+"{{"+k+"}}"}))}
                        title={`Insert {{${k}}}`}
                      >{k}</button>
                    ))}
                  </div>
                )}
                {hasToken && preview && preview !== (params[field.key]||"") && (
                  <div className="bap-var-preview">→ {preview}</div>
                )}
              </div>
            );
          })}
          {!allFilled && <div className="bap-param-hint">Fill in all required fields to run</div>}
        </div>
      )}

      {/* CTA row */}
      <div className="bap-detail-actions">
        <button
          className={`bap-btn-primary bap-btn-run${!allFilled?" bap-btn-dimmed":""}${testMode?" bap-btn-testmode":""}`}
          onClick={onRun}
          disabled={running||!allFilled}
          title={testMode ? "Test mode — run without saving to history" : !allFilled?"Fill in all required fields first":""}
        >
          {running ? <><span className="bap-spinner-sm" /> Running…</> : testMode ? "▶  Test Run" : "▶  Run Workflow"}
        </button>
        {onToggleTestMode && (
          <button
            className={`bap-btn-ghost bap-btn-sm bap-testmode-toggle${testMode?" active":""}`}
            onClick={onToggleTestMode}
            title="Test mode — runs the workflow but does not save the result to history or update run counts"
          >{testMode ? "✓ Test mode on" : "Test mode"}</button>
        )}
        {workflow.source === "library" && (
          <button className="bap-btn-ghost" onClick={onSaveAsTemplate}>+ Save to My Templates</button>
        )}
        <div className="bap-detail-share-row">
          <button className="bap-share-btn" onClick={onShare} title="Copy workflow as shareable JSON">
            {shareToast === "copied" ? "✓ Copied!" : "⤴ Share"}
          </button>
          <button className="bap-share-btn" onClick={onExport} title="Download as .jarvis.json">
            {shareToast === "downloaded" ? "✓ Downloaded!" : "⤵ Export"}
          </button>
        </div>
      </div>

      {/* Share card preview */}
      <div className="bap-share-card">
        <div className="bap-share-card-title">Share preview</div>
        <pre className="bap-share-card-body">{shareCardText}</pre>
        <button className="bap-share-card-copy" onClick={()=>copyToClipboard(shareCardText)}>Copy as text</button>
      </div>

      {/* What it does / Requirements */}
      <div className="bap-detail-info-grid">
        <div className="bap-detail-section">
          <div className="bap-detail-section-title">What this does</div>
          <div className="bap-detail-section-body">{summary}</div>
        </div>
        <div className="bap-detail-section">
          <div className="bap-detail-section-title">Requirements</div>
          <div className="bap-detail-section-body">{reqs}</div>
        </div>
      </div>

      {/* Similar workflows */}
      {similar.length > 0 && onSelectSimilar && (
        <div className="bap-similar-section">
          <div className="bap-similar-label">More in {cat.label}</div>
          <div className="bap-similar-list">
            {similar.map(w => (
              <button key={w.name} className="bap-similar-item" onClick={() => onSelectSimilar(w)}>
                <span className="bap-similar-icon" style={{color:cat.color}}>{cat.icon}</span>
                <div>
                  <div className="bap-similar-name">{w.label}</div>
                  <div className="bap-similar-diff">{DIFFICULTY[w.name]?.label || "Medium"}{EST_RUNTIME[w.name] ? ` · ~${EST_RUNTIME[w.name]}s` : ""}</div>
                </div>
                <span className="bap-similar-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── OperatorEvidencePanel ─────────────────────────────────────────────────────

function OperatorEvidencePanel({ result, workflow }) {
  if (!result || result.cancelled) return null;

  const steps      = result.steps || [];
  const passed     = steps.filter(s=>s.ok).length;
  const failed     = steps.filter(s=>!s.ok).length;
  const retries    = steps.reduce((n,s)=>n+Math.max(0,(s.attempts||1)-1), 0);
  const recovered  = steps.filter(s=>s.recovered).length;
  const totalMs    = steps.reduce((n,s)=>n+(s.durationMs||0), 0);
  const hasScreenshot = !!(result.screenshot);
  const hasUrl     = !!(result.currentUrl);

  const evidence = [
    {
      label:"Steps passed",
      tip:"How many steps in the workflow completed successfully out of the total. Each step is one action — navigate, click, fill, screenshot, etc.",
      value: steps.length > 0 ? `${passed}/${steps.length}` : "—",
      ok: failed === 0,
    },
    {
      label:"Retries",
      tip:"Some steps failed on the first attempt but succeeded after automatically trying again. Retries are normal for slow pages. A high retry count may mean a selector is fragile.",
      value: retries > 0 ? `${retries} retry${retries!==1?"ies":""}` : "None needed",
      ok: retries === 0,
    },
    {
      label:"Auto-recovered",
      tip:"When a step fails, Ooplix tries reloading the page and retrying before giving up. 'Auto-recovered' means that page-reload recovery worked and the workflow continued.",
      value: recovered > 0 ? `${recovered} time${recovered!==1?"s":""}` : "No issues",
      ok: true,
    },
    {
      label:"Duration",
      tip:"Total time from first step to last step. Includes page load time. Workflows that open slow pages or wait for dynamic content naturally take longer.",
      value: totalMs > 0 ? fmtDuration(totalMs) : "—",
      ok: true,
    },
    {
      label:"Screenshot",
      tip:"A photo of the browser at the end of the run — or at the point of failure. Useful for verifying what the workflow saw, or diagnosing why it failed.",
      value: hasScreenshot ? "Captured ✓" : "Not available",
      ok: hasScreenshot,
    },
    {
      label:"Final URL",
      tip:"The URL the browser was on when the workflow finished. Useful for confirming the workflow ended up on the right page after navigating or submitting a form.",
      value: hasUrl ? "Recorded ✓" : "Not recorded",
      ok: hasUrl,
    },
  ];

  return (
    <div className={`bap-evidence-panel ${result.ok ? "ok" : "fail"}`}>
      <div className="bap-evidence-title">
        {result.ok ? "✓ Execution evidence" : "✗ Failure evidence"}
      </div>
      <div className="bap-evidence-grid">
        {evidence.map(e => (
          <div key={e.label} className="bap-evidence-item" title={e.tip}>
            <div className="bap-evidence-label">
              {e.label}
              <span className="bap-evidence-tip-icon" title={e.tip}>?</span>
            </div>
            <div className={`bap-evidence-value ${e.ok ? "ok" : "warn"}`}>{e.value}</div>
          </div>
        ))}
      </div>
      {result.ok && (
        <div className="bap-evidence-trust">
          <span className="bap-evidence-trust-icon">✓</span>
          <span>This result is real — captured from a live browser session.</span>
        </div>
      )}
      {!result.ok && result.error && (
        <div className="bap-evidence-error-raw">
          <span className="bap-evidence-error-label">Raw error:</span>
          <code>{result.error.slice(0, 200)}</code>
        </div>
      )}
    </div>
  );
}

// ── ExecutionView ─────────────────────────────────────────────────────────────

// ── PostRunCard — first-success "what next?" moment ───────────────────────────

function PostRunCard({ workflow, result, onSaveAsTemplate, onSchedule, onShare, onBrowseSimilar, onViewHistory, isFirstRun }) {
  if (!result?.ok) return null;
  const isLibrary  = workflow?.source === "library";
  const isTemplate = workflow?.source === "template";
  const name = workflow?.item?.label || workflow?.item?.name || "this workflow";

  return (
    <div className="bap-postrun-card">
      <div className="bap-postrun-title">
        {isFirstRun ? "Your first automation worked!" : "What would you like to do next?"}
      </div>
      {isFirstRun && (
        <div className="bap-postrun-congrats">
          You just ran a real browser automation. Here's what you can do with it:
        </div>
      )}
      {isFirstRun && (
        <div className="bap-postrun-history-reminder">
          <span className="bap-postrun-history-icon">⊞</span>
          <span>This result is already saved in <strong>History</strong> — with a full screenshot, step-by-step breakdown, and a replay button. You can find it there any time.</span>
        </div>
      )}
      <div className="bap-postrun-options">
        {isLibrary && onSaveAsTemplate && (
          <button className="bap-postrun-opt" onClick={onSaveAsTemplate}>
            <span className="bap-postrun-opt-icon">✦</span>
            <div>
              <div className="bap-postrun-opt-label">Save as template</div>
              <div className="bap-postrun-opt-desc">Keep this workflow in My Templates to run again anytime</div>
            </div>
          </button>
        )}
        {isTemplate && onSchedule && (
          <button className="bap-postrun-opt" onClick={onSchedule}>
            <span className="bap-postrun-opt-icon">🕐</span>
            <div>
              <div className="bap-postrun-opt-label">Set a schedule</div>
              <div className="bap-postrun-opt-desc">Run this automatically — daily, weekly, or monthly</div>
            </div>
          </button>
        )}
        {onShare && (
          <button className="bap-postrun-opt" onClick={onShare}>
            <span className="bap-postrun-opt-icon">⤴</span>
            <div>
              <div className="bap-postrun-opt-label">Share with a teammate</div>
              <div className="bap-postrun-opt-desc">Copy a JSON link they can import in one click</div>
            </div>
          </button>
        )}
        {onBrowseSimilar && (
          <button className="bap-postrun-opt" onClick={onBrowseSimilar}>
            <span className="bap-postrun-opt-icon">⌕</span>
            <div>
              <div className="bap-postrun-opt-label">Browse similar workflows</div>
              <div className="bap-postrun-opt-desc">See other automations in the same category</div>
            </div>
          </button>
        )}
        <button className="bap-postrun-opt" onClick={onViewHistory}>
          <span className="bap-postrun-opt-icon">⊞</span>
          <div>
            <div className="bap-postrun-opt-label">View in history</div>
            <div className="bap-postrun-opt-desc">See the full result, screenshot, and step breakdown</div>
          </div>
        </button>
      </div>
    </div>
  );
}

function ExecutionView({ workflow, running, liveSteps, result, onCancel, onBack, onRunAgain, onViewHistory, onOpenLightbox, onSaveAsTemplate, onSchedule, onShare, onBrowseSimilar, isFirstRun }) {
  const name  = workflow?.item?.label||workflow?.item?.name||"Workflow";
  const steps = liveSteps.filter(s => s.status !== undefined);

  // Elapsed time counter while running
  const startRef   = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) { startRef.current = null; setElapsed(0); return; }
    startRef.current = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now()-startRef.current)/1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Last live-step timestamp for stuck detection
  const lastStepRef = useRef(Date.now());
  useEffect(() => { if (liveSteps.length > 0) lastStepRef.current = Date.now(); }, [liveSteps]);
  const stuckSec = 90;
  const isStuck = running && elapsed >= stuckSec && (Date.now() - lastStepRef.current) >= stuckSec * 1000;

  const stepMap = new Map();
  steps.forEach(s => {
    const ex = stepMap.get(s.stepIndex);
    if (!ex || s.status === "done" || s.status === "failed") stepMap.set(s.stepIndex, s);
  });
  const displaySteps = [...stepMap.values()].sort((a,b)=>(a.stepIndex??0)-(b.stepIndex??0));

  const latest      = displaySteps[displaySteps.length-1];
  const pct         = latest?.progressPct ?? (result ? 100 : 0);
  const statusLabel = running ? "Running" : result?.ok ? "Completed" : result?.cancelled ? "Cancelled" : "Failed";
  const statusCls   = running ? "running" : result?.ok ? "ok" : "fail";
  const resultSteps = result?.steps||[];

  // Recovery events from live steps
  const recoveryEvents = steps.filter(s => s.status === "recovering" || s.recovered);
  const retryCount = steps.filter(s => s.status === "retrying").length;

  // Build mini execution timeline from result steps if timing available
  const totalMs = resultSteps.reduce((n,s)=>n+(s.durationMs||0),0);

  return (
    <div className="bap-exec">
      <div className="bap-exec-topbar">
        <button className="bap-back-btn" onClick={onBack}>← Back</button>
        <div className="bap-exec-header">
          <div className="bap-exec-title">{name}</div>
          <span className={`bap-exec-status ${statusCls}`}>{statusLabel}</span>
          {running && elapsed > 0 && (
            <span className="bap-exec-elapsed">{elapsed}s</span>
          )}
        </div>
      </div>

      <div className="bap-progress-track">
        <div className={`bap-progress-bar ${running?"bap-progress-anim":result?.ok?"bap-progress-ok":"bap-progress-fail"}`} style={{width:`${pct}%`}} />
      </div>
      <div className="bap-progress-label">
        <span>{pct}%</span>
        {latest?.label && <span className="bap-progress-step">— {latest.label}</span>}
        {running && <span className="bap-progress-working">working…</span>}
        {running && retryCount > 0 && <span className="bap-progress-retrying">↺ retrying</span>}
        {running && recoveryEvents.length > 0 && <span className="bap-progress-recovering">recovering…</span>}
      </div>

      {/* Recovery notice — shown while recovering */}
      {running && recoveryEvents.length > 0 && (
        <div className="bap-exec-recovery-notice">
          <span className="bap-exec-recovery-icon">↺</span>
          <span>The workflow hit an obstacle and is recovering automatically. This is normal for complex pages.</span>
        </div>
      )}

      {/* Stuck detection — no step activity for 90s */}
      {isStuck && (
        <div className="bap-exec-stuck-notice">
          <span className="bap-exec-stuck-icon">⚠</span>
          <span>No step activity for {stuckSec}+ seconds — the workflow may be waiting on a slow page or stuck behind a CAPTCHA. You can cancel and retry, or wait a little longer.</span>
        </div>
      )}

      {/* Live step log */}
      {displaySteps.length > 0 && (
        <div className="bap-exec-steps">
          {displaySteps.map((s,i) => (
            <div key={i} className={`bap-exec-step bap-exec-step-${s.status}`}>
              <span className="bap-exec-step-idx">{(s.stepIndex??i)+1}</span>
              <span className="bap-exec-step-label">{s.label||s.action}</span>
              <div className="bap-exec-step-right">
                {s.status==="retrying"   && s.attempt && (
                  <span className="bap-exec-step-hint bap-hint-retry" title="Retrying after a failure">↺ retry {s.attempt}</span>
                )}
                {s.status==="recovering" && (
                  <span className="bap-exec-step-hint bap-hint-recovery" title="Recovering by reloading the page">↺ recovering…</span>
                )}
                {s.status==="running" && s.timeoutMs && (
                  <span className="bap-exec-step-hint" title="Maximum wait time for this step">⏱ {Math.round(s.timeoutMs/1000)}s limit</span>
                )}
                <span className={`bap-exec-step-status bap-step-status-${s.status}`}>
                  {s.status === "done"      ? "✓"
                  : s.status === "failed"   ? "✗"
                  : s.status === "running"  ? "…"
                  : s.status === "retrying" ? "↺"
                  : s.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Result card */}
      {result && !running && (
        <div className={`bap-exec-result ${result.ok?"ok":"fail"}`}>
          <div className="bap-exec-result-header">
            <div className="bap-exec-result-title">
              {result.ok ? "✓ Workflow completed successfully" : "✗ Workflow failed"}
            </div>
            {resultSteps.length > 0 && (
              <div className="bap-exec-result-stats-inline">
                <span>{resultSteps.filter(s=>s.ok).length}/{resultSteps.length} steps</span>
                {result.steps?.some(s=>s.attempts>1) && (
                  <span>· {result.steps.reduce((n,s)=>n+Math.max(0,(s.attempts||1)-1),0)} retries</span>
                )}
                {result.steps?.some(s=>s.recovered) && (
                  <span>· {result.steps.filter(s=>s.recovered).length} auto-recovered</span>
                )}
                {totalMs > 0 && <span>· {fmtDuration(totalMs)}</span>}
              </div>
            )}
          </div>
          {result.summary && <div className="bap-exec-result-summary">{result.summary}</div>}
          {result.currentUrl && <div className="bap-exec-result-url">{result.currentUrl}</div>}
          {result.error && !result.ok && <div className="bap-exec-result-error">{result.error}</div>}

          {/* Execution timeline — proportional step bars */}
          {resultSteps.length > 0 && totalMs > 0 && (
            <div className="bap-exec-timeline">
              <div className="bap-exec-timeline-title">Step timeline</div>
              <div className="bap-exec-timeline-bars">
                {resultSteps.map((s,i) => {
                  const pct = Math.max(1, Math.round(((s.durationMs||0)/totalMs)*100));
                  return (
                    <div key={i} className="bap-timeline-bar-wrap" title={`${s.label||s.action} — ${fmtDuration(s.durationMs)}`}>
                      <div
                        className={`bap-timeline-bar ${s.ok?"ok":"fail"}`}
                        style={{width:`${pct}%`}}
                      />
                      <span className="bap-timeline-label">{s.label||s.action}</span>
                    </div>
                  );
                })}
              </div>
              <div className="bap-exec-timeline-total">Total: {fmtDuration(totalMs)}</div>
            </div>
          )}

          {/* Step breakdown */}
          {resultSteps.length > 0 && (
            <div className="bap-exec-step-breakdown">
              {resultSteps.map((s,i) => (
                <div key={i} className={`bap-exec-step-row ${s.ok?"ok":"fail"}`}>
                  <StepBadge ok={s.ok} />
                  <span className="bap-step-row-label">{s.label||s.action}</span>
                  {(s.attempts||1)>1 && <span className="bap-step-row-retries">{s.attempts-1} retries</span>}
                  {s.recovered && <span className="bap-step-row-recovered">↺ recovered</span>}
                  {s.durationMs!=null && <span className="bap-step-row-dur">{fmtDuration(s.durationMs)}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Failure explanation — plain English */}
          {!result.ok && !result.cancelled && (
            <FailureExplainer error={result.error} steps={resultSteps} />
          )}

          {/* Screenshot */}
          {result.screenshot && (
            <div className="bap-exec-screenshot">
              <div className="bap-screenshot-label">
                Result screenshot
                <span className="bap-screenshot-hint">click to expand</span>
                {!result.ok && <span className="bap-screenshot-evidence"> — check the screenshot for clues</span>}
              </div>
              <img
                src={result.screenshot}
                alt="Workflow result"
                className="bap-screenshot-img bap-screenshot-clickable"
                onClick={() => onOpenLightbox?.(result.screenshot)}
              />
            </div>
          )}

          {/* Confidence summary */}
          <div className="bap-exec-confidence">
            {result.ok ? (
              <div className="bap-exec-confidence-ok">
                <span className="bap-exec-confidence-icon">✓</span>
                <span>
                  Automation completed.
                  {resultSteps.length > 0 && ` All ${resultSteps.filter(s=>s.ok).length} steps passed.`}
                  {result.currentUrl && ` Final page: ${result.currentUrl}`}
                </span>
              </div>
            ) : result.cancelled ? (
              <div className="bap-exec-confidence-cancelled">
                <span className="bap-exec-confidence-icon">○</span>
                <span>Cancelled by operator — no data was changed.</span>
              </div>
            ) : (
              <div className="bap-exec-confidence-fail">
                <span className="bap-exec-confidence-icon">✗</span>
                <span>
                  {resultSteps.filter(s=>!s.ok).length > 0
                    ? `Failed at: ${resultSteps.find(s=>!s.ok)?.label || "unknown step"}`
                    : "Workflow failed to complete."}
                  {result.steps?.some(s=>(s.attempts||1)>1) && ` (retried ${result.steps.reduce((n,s)=>n+Math.max(0,(s.attempts||1)-1),0)} times)`}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Operator evidence panel — post-run */}
      {!running && result && (
        <OperatorEvidencePanel result={result} workflow={workflow} />
      )}

      {/* Post-run "what next?" card */}
      {!running && result?.ok && (
        <PostRunCard
          workflow={workflow}
          result={result}
          isFirstRun={isFirstRun}
          onSaveAsTemplate={onSaveAsTemplate}
          onSchedule={onSchedule}
          onShare={onShare}
          onBrowseSimilar={onBrowseSimilar}
          onViewHistory={onViewHistory}
        />
      )}

      <div className="bap-exec-controls">
        {running && <button className="bap-btn-danger" onClick={onCancel}>✕ Cancel</button>}
        {!running && result && (
          <>
            <button className="bap-btn-primary" onClick={onRunAgain}>▶ Run Again</button>
            <button className="bap-btn-ghost" onClick={onViewHistory}>View in History →</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── HistoryView ───────────────────────────────────────────────────────────────

const HIST_DISMISSED_KEY = "bap_hist_dismissed";
function loadDismissed() { try { return new Set(JSON.parse(localStorage.getItem(HIST_DISMISSED_KEY)||"[]")); } catch { return new Set(); } }
function saveDismissed(s) { try { localStorage.setItem(HIST_DISMISSED_KEY, JSON.stringify([...s])); } catch {} }

function HistoryView({ history, loading, running, sysHealth, onReplay, onRefresh, onOpenLightbox }) {
  const [filterOk, setFilterOk]     = useState(null);
  const [searchHist, setSearchHist] = useState("");
  const [expanded, setExpanded]     = useState(null);
  const [groupByName, setGroupByName] = useState(false);
  const [dismissed, setDismissed]   = useState(loadDismissed);

  function dismissFailed() {
    const ids = new Set(history.filter(e=>!e.ok&&!e.cancelled).map(e=>e.id));
    const next = new Set([...dismissed, ...ids]);
    saveDismissed(next);
    setDismissed(next);
  }

  function undismiss() {
    saveDismissed(new Set());
    setDismissed(new Set());
  }

  const filtered = useMemo(() => {
    let list = history.filter(e => !dismissed.has(e.id));
    if (filterOk !== null) list = list.filter(e => e.ok === filterOk);
    if (searchHist) {
      const q = searchHist.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q)||(e.triggeredBy||"").includes(q));
    }
    return list;
  }, [history, filterOk, searchHist, dismissed]);

  const dismissedFailCount = history.filter(e=>!e.ok&&!e.cancelled&&dismissed.has(e.id)).length;

  // Per-workflow aggregates for comparison
  const byWorkflow = useMemo(() => {
    const map = {};
    history.forEach(e => {
      if (!map[e.name]) map[e.name] = { name: e.name, runs: [], pass: 0, fail: 0 };
      map[e.name].runs.push(e);
      e.ok ? map[e.name].pass++ : map[e.name].fail++;
    });
    return map;
  }, [history]);

  const passCount = history.filter(e=>e.ok).length;
  const failCount = history.filter(e=>!e.ok&&!e.cancelled).length;

  return (
    <div className="bap-history">
      <div className="bap-history-topbar">
        <span className="bap-section-title">
          Execution History
          <HelpTip>Every workflow run is saved here — successful or not. Expand any row to see the step-by-step breakdown, screenshot, and failure explanation. Use ↺ Replay to re-run any past execution with the same inputs.</HelpTip>
        </span>
        <button className="bap-btn-ghost bap-btn-sm" onClick={onRefresh}>↻ Refresh</button>
      </div>

      {/* System health summary */}
      {sysHealth && sysHealth.runs > 0 && (
        <div className="bap-hist-health">
          {[
            {val:sysHealth.score,           label:"Score",       color:healthBandColor(sysHealth.band)},
            {val:`${sysHealth.passRate}%`,  label:"Success"},
            {val:sysHealth.runs,            label:"Total runs"},
            {val:sysHealth.trend,           label:"Trend"},
            {val:sysHealth.totalRetries||0, label:"Retries"},
          ].map(s => (
            <div key={s.label} className="bap-hist-health-stat">
              <span className="bap-hist-health-val" style={s.color?{color:s.color}:{}}>{s.val}</span>
              <span className="bap-hist-health-label">{s.label}</span>
            </div>
          ))}
          {sysHealth.recentSeries && (
            <div className="bap-hist-series" title="Last 10 runs">{sysHealth.recentSeries}</div>
          )}
        </div>
      )}

      {/* Filter bar */}
      {history.length > 0 && (
        <div className="bap-hist-filters">
          <div className="bap-hist-filter-chips">
            <button className={`bap-filter-chip${filterOk===null?" active":""}`} onClick={()=>setFilterOk(null)}>All ({filtered.length})</button>
            <button className={`bap-filter-chip bap-filter-pass${filterOk===true?" active":""}`} onClick={()=>setFilterOk(filterOk===true?null:true)}>✓ Passed ({passCount})</button>
            <button className={`bap-filter-chip bap-filter-fail${filterOk===false?" active":""}`} onClick={()=>setFilterOk(filterOk===false?null:false)}>✗ Failed ({failCount - dismissedFailCount})</button>
            <button className={`bap-filter-chip${groupByName?" active":""}`} onClick={()=>setGroupByName(v=>!v)} title="Group by workflow">Group by workflow</button>
            {failCount > dismissedFailCount && (
              <button className="bap-filter-chip bap-filter-clear-fail" onClick={dismissFailed} title="Hide all failed runs from view">
                ✕ Clear failed
              </button>
            )}
            {dismissedFailCount > 0 && (
              <button className="bap-filter-chip bap-filter-restore" onClick={undismiss} title="Show all hidden runs again">
                ↩ Show {dismissedFailCount} hidden
              </button>
            )}
          </div>
          <input className="bap-search bap-search-sm" type="text" placeholder="Filter by name…" value={searchHist} onChange={e=>setSearchHist(e.target.value)} />
        </div>
      )}

      {loading ? (
        <div className="bap-loading"><span className="bap-loading-spinner" /> Loading history…</div>
      ) : history.length === 0 ? (
        <div className="bap-empty-state bap-empty-state-rich">
          <div className="bap-empty-icon">⟳</div>
          <div className="bap-empty-heading">No runs yet</div>
          <div className="bap-empty-body">
            Every time you run a workflow, the result appears here — with a screenshot, step-by-step breakdown, and a replay button.
          </div>
          <div className="bap-empty-actions">
            <div className="bap-empty-hint-row">
              <span className="bap-empty-hint-icon">⟢</span>
              <span>Go to <strong>Browse</strong> and pick any workflow to get started. Hacker News Top 10 takes 8 seconds and needs no setup.</span>
            </div>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bap-empty bap-empty-filter">
          <span>No executions match these filters.</span>
          <button className="bap-inline-link" onClick={()=>{ setFilterOk(null); setSearchHist(""); }}>Clear filters</button>
        </div>
      ) : groupByName ? (
        <div className="bap-hist-list">
          {Object.values(byWorkflow).sort((a,b)=>b.runs.length-a.runs.length).map(wf => {
            const passRate   = Math.round((wf.pass/wf.runs.length)*100);
            const isOpen     = expanded === `wf:${wf.name}`;
            const passColor  = passRate >= 80 ? "var(--op-green)" : passRate >= 60 ? "var(--op-amber)" : "var(--op-red)";
            const lastFail   = wf.runs.find(r=>!r.ok&&!r.cancelled);
            const lastFailExplain = lastFail ? explainError(lastFail.error) : null;
            return (
              <div key={wf.name} className="bap-hist-wf-group">
                <div className="bap-hist-wf-header" onClick={()=>setExpanded(isOpen?null:`wf:${wf.name}`)}>
                  <div className="bap-hist-wf-header-left">
                    <span className="bap-hist-wf-name">{wf.name}</span>
                    {/* Pass-rate bar */}
                    <div className="bap-hist-wf-bar-track">
                      <div className="bap-hist-wf-bar-fill" style={{width:`${passRate}%`,background:passColor}} />
                    </div>
                  </div>
                  <div className="bap-hist-wf-stats">
                    <span style={{color:passColor,fontWeight:600}}>{passRate}%</span>
                    <span>{wf.runs.length} run{wf.runs.length!==1?"s":""}</span>
                    <span className="bap-wf-ok-count">✓{wf.pass}</span>
                    {wf.fail>0&&<span className="bap-wf-fail-count">✗{wf.fail}</span>}
                  </div>
                  <span className="bap-hist-expand">{isOpen?"▲":"▼"}</span>
                </div>
                {/* Inline failure hint if last run failed */}
                {!isOpen && lastFailExplain && wf.fail > 0 && (
                  <div className="bap-hist-wf-fail-hint">
                    {lastFailExplain.icon} Last failure: {lastFailExplain.cause} — {lastFailExplain.fix}
                  </div>
                )}
                {isOpen && (
                  <div className="bap-hist-wf-runs">
                    {wf.runs.map(exec => {
                      const dur = exec.startedAt && exec.completedAt ? new Date(exec.completedAt)-new Date(exec.startedAt) : null;
                      const ex  = !exec.ok && !exec.cancelled ? explainError(exec.error) : null;
                      return (
                        <div key={exec.id} className={`bap-hist-wf-run ${exec.ok?"ok":exec.cancelled?"cancelled":"fail"}`}>
                          <StepBadge ok={exec.ok} cancelled={exec.cancelled} />
                          <div className="bap-hist-wf-run-body">
                            <div className="bap-hist-wf-run-row">
                              <span className="bap-hist-wf-run-age">{fmtAge(exec.recordedAtISO)}</span>
                              {exec.stepCount>0&&<span className="bap-hist-wf-run-steps">{exec.stepsPassed}/{exec.stepCount} steps</span>}
                              {dur&&<span className="bap-hist-wf-run-dur">{fmtDuration(dur)}</span>}
                              {exec.totalRetries>0&&<span className="bap-meta-warn">{exec.totalRetries} retries</span>}
                              {exec.replaySteps?.length > 0 && (
                                <button className="bap-replay-btn bap-btn-xs" disabled={running} onClick={()=>onReplay(exec.id,exec.name)}>↺ Replay</button>
                              )}
                            </div>
                            {ex && (
                              <div className="bap-hist-wf-run-explain">{ex.icon} {ex.cause} — {ex.fix}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bap-hist-list">
          {filtered.map(exec => {
            const isOpen  = expanded === exec.id;
            const dur     = exec.startedAt && exec.completedAt ? new Date(exec.completedAt)-new Date(exec.startedAt) : null;
            const totalMs = exec.steps?.reduce((n,s)=>n+(s.durationMs||0),0)||0;
            // Previous runs of same workflow for comparison context
            const prevRuns = history.filter(e=>e.name===exec.name&&e.id!==exec.id).slice(0,3);
            return (
              <div key={exec.id} className={`bap-hist-row ${exec.ok?"ok":exec.cancelled?"cancelled":"fail"}`}>
                <div className="bap-hist-row-main" onClick={()=>setExpanded(isOpen?null:exec.id)}>
                  <StepBadge ok={exec.ok} cancelled={exec.cancelled} />
                  <div className="bap-hist-row-body">
                    <div className="bap-hist-row-name">{exec.name}</div>
                    <div className="bap-hist-row-meta">
                      <span>{fmtAge(exec.recordedAtISO)}</span>
                      {exec.stepCount>0 && <span>{exec.stepsPassed}/{exec.stepCount} steps</span>}
                      {dur && <span>{fmtDuration(dur)}</span>}
                      {exec.totalRetries>0 && <span className="bap-meta-warn">{exec.totalRetries} retries</span>}
                      <span className="bap-hist-trigger">{exec.triggeredBy}</span>
                    </div>
                    {exec.finalUrl && <div className="bap-hist-row-url">{exec.finalUrl}</div>}
                    {!exec.ok && !exec.cancelled && !isOpen && (() => {
                      const ex = explainError(exec.error);
                      return ex ? <div className="bap-hist-inline-explain">{ex.icon} {ex.cause}</div> : null;
                    })()}
                  </div>
                  <div className="bap-hist-row-right">
                    {exec.replaySteps?.length > 0 && (
                      <button
                        className="bap-card-action bap-replay-btn"
                        disabled={running}
                        onClick={e=>{ e.stopPropagation(); onReplay(exec.id,exec.name); }}
                        title="Replay this execution"
                      >↺ Replay</button>
                    )}
                    <span className="bap-hist-expand">{isOpen?"▲":"▼"}</span>
                  </div>
                </div>

                {/* Expanded: comparison + timeline + step breakdown */}
                {isOpen && (
                  <div className="bap-hist-expanded">
                    {/* Prior runs context */}
                    {prevRuns.length > 0 && (
                      <div className="bap-hist-compare">
                        <span className="bap-hist-compare-label">Previous runs:</span>
                        {prevRuns.map(p => (
                          <span key={p.id} className={`bap-hist-compare-pill ${p.ok?"ok":"fail"}`} title={fmtAge(p.recordedAtISO)}>
                            {p.ok?"✓":"✗"} {fmtAge(p.recordedAtISO)}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Mini timeline */}
                    {exec.steps?.length > 0 && totalMs > 0 && (
                      <div className="bap-hist-timeline">
                        {exec.steps.map((s,i) => {
                          const pct = Math.max(1, Math.round(((s.durationMs||0)/totalMs)*100));
                          return (
                            <div key={i} className="bap-hist-timeline-seg" style={{width:`${pct}%`}} title={`${s.label||s.action} — ${fmtDuration(s.durationMs)}`}>
                              <div className={`bap-hist-timeline-fill ${s.ok?"ok":"fail"}`} />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Step rows */}
                    {exec.steps?.map((s,i) => (
                      <div key={i} className={`bap-exec-step-row ${s.ok?"ok":"fail"}`}>
                        <StepBadge ok={s.ok} />
                        <span className="bap-step-row-label">{s.label||s.action}</span>
                        {(s.attempts||1)>1 && <span className="bap-step-row-retries">{s.attempts-1} retries</span>}
                        {s.recovered && <span className="bap-step-row-recovered">↺ recovered</span>}
                        {!s.ok && s.error && <span className="bap-step-row-error">{s.error.slice(0,80)}</span>}
                        {s.durationMs!=null && <span className="bap-step-row-dur">{fmtDuration(s.durationMs)}</span>}
                      </div>
                    ))}
                    {/* Failure explainer for failed executions */}
                    {!exec.ok && !exec.cancelled && exec.error && (
                      <FailureExplainer error={exec.error} />
                    )}

                    {/* Screenshot thumbnail */}
                    {exec.screenshot && (
                      <div className="bap-hist-screenshot-thumb-wrap">
                        <div className="bap-hist-screenshot-label">📸 Screenshot</div>
                        <img
                          src={exec.screenshot}
                          alt="Execution screenshot"
                          className="bap-hist-screenshot-thumb bap-screenshot-clickable"
                          onClick={()=>onOpenLightbox?.(exec.screenshot)}
                        />
                      </div>
                    )}
                    {exec.hasScreenshot && !exec.screenshot && (
                      <div className="bap-hist-screenshot-note">📸 Screenshot captured — re-run to view</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Visual Builder data ───────────────────────────────────────────────────────

const ACTION_DEFS = [
  { action:"navigate",       icon:"🌐", label:"Open a website",        group:"Navigation",
    desc:"Goes to a URL in the browser — the starting point of any workflow.",
    fields:[{key:"url",label:"Website URL",placeholder:"https://example.com",required:true},{key:"label",label:"Step name",placeholder:"Open site"},{key:"timeout",label:"Timeout (ms)",placeholder:"20000",type:"number"}] },
  { action:"click",          icon:"👆", label:"Click something",        group:"Interaction",
    desc:"Clicks on a button, link, or any element on the page.",
    fields:[{key:"selector",label:"CSS selector",placeholder:".btn-submit, #next-btn",required:true},{key:"label",label:"Step name",placeholder:"Click submit"},{key:"retries",label:"Retries",placeholder:"2",type:"number"},{key:"timeout",label:"Timeout (ms)",placeholder:"10000",type:"number"}] },
  { action:"type",           icon:"⌨", label:"Type text",               group:"Interaction",
    desc:"Types text into a text box or search field — like a keyboard.",
    fields:[{key:"selector",label:"Input field selector",placeholder:"#search, input[name='q']",required:true},{key:"value",label:"Text to type",placeholder:"hello world",required:true},{key:"label",label:"Step name",placeholder:"Type search query"},{key:"retries",label:"Retries",placeholder:"1",type:"number"}] },
  { action:"fill",           icon:"📝", label:"Fill a form field",       group:"Interaction",
    desc:"Clears and fills a form field — better than type for modern apps.",
    fields:[{key:"selector",label:"Input field selector",placeholder:"input[name='email']",required:true},{key:"value",label:"Value to fill",placeholder:"user@example.com",required:true},{key:"label",label:"Step name",placeholder:"Fill email"},{key:"retries",label:"Retries",placeholder:"1",type:"number"}] },
  { action:"waitForElement", icon:"⏳", label:"Wait for element",        group:"Waiting",
    desc:"Pauses until a specific element appears on the page — useful after page loads.",
    fields:[{key:"selector",label:"CSS selector to wait for",placeholder:"body, .results, #content",required:true},{key:"label",label:"Step name",placeholder:"Wait for page"},{key:"timeout",label:"Timeout (ms)",placeholder:"15000",type:"number"}] },
  { action:"waitForContent", icon:"🔍", label:"Wait for text",           group:"Waiting",
    desc:"Pauses until specific text appears anywhere on the page.",
    fields:[{key:"text",label:"Text to wait for",placeholder:"Loaded, Results, Welcome",required:true},{key:"label",label:"Step name",placeholder:"Wait for content"}] },
  { action:"screenshot",     icon:"📸", label:"Take a screenshot",       group:"Capture",
    desc:"Captures a photo of the current browser view. Saved with the execution.",
    fields:[{key:"label",label:"Step name",placeholder:"Screenshot result"}] },
  { action:"getText",        icon:"📄", label:"Read text from page",     group:"Capture",
    desc:"Reads and returns the visible text from an element or the whole page.",
    fields:[{key:"selector",label:"CSS selector (leave blank for whole page)",placeholder:"h1, .price, #content"},{key:"label",label:"Step name",placeholder:"Read page content"}] },
  { action:"getTitle",       icon:"🏷", label:"Get page title",          group:"Capture",
    desc:"Reads the title of the current page — the text shown in the browser tab.",
    fields:[{key:"label",label:"Step name",placeholder:"Get page title"}] },
  { action:"getUrl",         icon:"🔗", label:"Get current URL",         group:"Capture",
    desc:"Records the URL the browser is currently on — useful after redirects.",
    fields:[{key:"label",label:"Step name",placeholder:"Get final URL"}] },
  { action:"scrollDown",     icon:"⬇", label:"Scroll down",             group:"Navigation",
    desc:"Scrolls the page down — useful to load lazy content or reach the bottom.",
    fields:[{key:"amount",label:"Pixels to scroll",placeholder:"500",type:"number"},{key:"label",label:"Step name",placeholder:"Scroll down"}] },
  { action:"checkCaptcha",   icon:"🤖", label:"Detect CAPTCHA",          group:"Diagnostics",
    desc:"Checks if the page is showing a CAPTCHA or bot-blocking screen.",
    fields:[{key:"label",label:"Step name",placeholder:"Check for CAPTCHA"}] },
  { action:"dismissModals",  icon:"❌", label:"Close popups",            group:"Interaction",
    desc:"Tries to close cookie banners, overlays, and other popups automatically.",
    fields:[{key:"label",label:"Step name",placeholder:"Dismiss modals"}] },
  { action:"getAttribute",   icon:"🔎", label:"Read element attribute",  group:"Capture",
    desc:"Reads an HTML attribute from an element — e.g. href from a link, src from an image.",
    fields:[{key:"selector",label:"CSS selector",placeholder:"a.logo",required:true},{key:"attribute",label:"Attribute name",placeholder:"href, src, data-id",required:true},{key:"label",label:"Step name",placeholder:"Get attribute"}] },
  { action:"checkElement",   icon:"✅", label:"Check element exists",    group:"Diagnostics",
    desc:"Checks whether a specific element is present on the page. Does not fail if absent.",
    fields:[{key:"selector",label:"CSS selector",placeholder:".error, #success-msg",required:true},{key:"label",label:"Step name",placeholder:"Check element"}] },
  { action:"evaluate",       icon:"⚙", label:"Run custom script",       group:"Advanced",
    desc:"Runs any JavaScript code in the browser page and returns the result.",
    fields:[{key:"script",label:"JavaScript code",placeholder:"document.title",required:true,type:"code"},{key:"label",label:"Step name",placeholder:"Custom script"}] },
];

const ACTION_DEF_MAP = Object.fromEntries(ACTION_DEFS.map(a=>[a.action, a]));

const ACTION_GROUPS = ["Navigation","Interaction","Waiting","Capture","Diagnostics","Advanced"];

const STARTER_TEMPLATES = [
  { id:"site_check", label:"Site health check", icon:"◎", desc:"Open a URL and check if it loads correctly",
    steps:[
      {action:"navigate",       url:"",      label:"Open website",     timeout:20000},
      {action:"waitForElement", selector:"body",                       label:"Wait for page to load"},
      {action:"checkCaptcha",                                          label:"Check for blocking"},
      {action:"getTitle",                                              label:"Get page title"},
      {action:"screenshot",                                            label:"Screenshot result"},
    ]},
  { id:"data_extract", label:"Read page content", icon:"📄", desc:"Open a URL and extract its text content",
    steps:[
      {action:"navigate",       url:"",      label:"Open page",        timeout:20000},
      {action:"waitForElement", selector:"body",                       label:"Wait for content"},
      {action:"getTitle",                                              label:"Page title"},
      {action:"getText",        selector:"h1, main, article",          label:"Main content"},
      {action:"screenshot",                                            label:"Screenshot"},
    ]},
  { id:"form_flow", label:"Fill and submit form", icon:"📝", desc:"Navigate to a form, fill fields, and submit",
    steps:[
      {action:"navigate",       url:"",      label:"Open form page",   timeout:20000},
      {action:"waitForElement", selector:"form",                       label:"Wait for form"},
      {action:"dismissModals",                                         label:"Close any popups"},
      {action:"fill",           selector:"", value:"",                 label:"Fill first field"},
      {action:"click",          selector:"button[type=submit]",        label:"Click submit"},
      {action:"screenshot",                                            label:"Confirm submission"},
    ]},
  { id:"news_reader", label:"Grab headlines", icon:"📰", desc:"Open a news site and extract headlines",
    steps:[
      {action:"navigate",       url:"",      label:"Open news site",   timeout:25000},
      {action:"waitForElement", selector:"h1, h2, article",            label:"Wait for articles"},
      {action:"getText",        selector:"h1, h2",                     label:"Read headlines"},
      {action:"screenshot",                                            label:"Screenshot"},
    ]},
  { id:"blank", label:"Start from scratch", icon:"✦", desc:"Build your own workflow step by step",
    steps:[] },
];

// Human-readable step summary for the preview strip
function stepSummary(step) {
  const def = ACTION_DEF_MAP[step.action];
  const label = step.label || def?.label || step.action;
  if (step.action === "navigate")       return `🌐 Open ${step.url || "a URL"}`;
  if (step.action === "click")          return `👆 Click ${step.selector || "element"}`;
  if (step.action === "type")           return `⌨ Type "${step.value||"…"}" into ${step.selector||"field"}`;
  if (step.action === "fill")           return `📝 Fill "${step.value||"…"}" into ${step.selector||"field"}`;
  if (step.action === "waitForElement") return `⏳ Wait for ${step.selector||"element"}`;
  if (step.action === "waitForContent") return `🔍 Wait for text "${step.text||"…"}"`;
  if (step.action === "screenshot")     return `📸 ${label}`;
  if (step.action === "getText")        return `📄 Read ${step.selector ? `"${step.selector}"` : "page text"}`;
  if (step.action === "getTitle")       return `🏷 Get page title`;
  if (step.action === "getUrl")         return `🔗 Get current URL`;
  if (step.action === "scrollDown")     return `⬇ Scroll down ${step.amount ? step.amount+"px" : ""}`;
  if (step.action === "checkCaptcha")   return `🤖 Check for CAPTCHA`;
  if (step.action === "dismissModals")  return `❌ Close popups`;
  if (step.action === "getAttribute")   return `🔎 Get "${step.attribute||"attr"}" from ${step.selector||"element"}`;
  if (step.action === "checkElement")   return `✅ Check ${step.selector||"element"} exists`;
  if (step.action === "evaluate")       return `⚙ Run script`;
  return label;
}

function stepsFromRaw(raw) {
  try {
    const parsed = JSON.parse(raw||"[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return null; }
}

function rawFromSteps(steps) {
  return JSON.stringify(steps, null, 2);
}

// ── Workflow reliability analysis ─────────────────────────────────────────────

const BROAD_SELECTORS = new Set(["div","span","a","p","li","ul","table","section","header","footer","main","body"]);

function analyzeStepReliability(step) {
  const issues = [];
  const def = ACTION_DEF_MAP[step.action];
  if (!def) return issues;

  // Missing required fields
  (def.fields||[]).forEach(f => {
    if (f.required && !step[f.key]?.toString().trim()) {
      if (f.key === "selector") issues.push({ severity:"error", msg:`Missing CSS selector — the workflow won't know what to interact with` });
      else if (f.key === "url")   issues.push({ severity:"error", msg:`Missing URL — add the website address this step should open` });
      else if (f.key === "value") issues.push({ severity:"error", msg:`Missing value — what should be typed into this field?` });
      else if (f.key === "text")  issues.push({ severity:"error", msg:`Missing text — what text should the workflow wait to see?` });
      else                        issues.push({ severity:"error", msg:`"${f.label}" is required` });
    }
  });

  // Broad selector warning
  if (step.selector) {
    const base = step.selector.trim().split(/[\s,\[:.#>+~]/)[0];
    if (BROAD_SELECTORS.has(base) && !step.selector.includes(".") && !step.selector.includes("#") && !step.selector.includes("[")) {
      issues.push({ severity:"warn", msg:`"${step.selector}" matches many elements — add a class or ID to be more specific` });
    }
  }

  // No timeout on navigate
  if (step.action === "navigate" && !step.timeout) {
    issues.push({ severity:"info", msg:`No timeout set — slow pages may cause failures. Consider adding a timeout (e.g. 20000ms)` });
  }

  // Hardcoded password-like value visible in plain text
  if (step.action === "fill" || step.action === "type") {
    if ((step.value||"").length > 6 && /password|secret|token/i.test(step.selector||"")) {
      issues.push({ severity:"warn", msg:`Sensitive field detected — consider using a {{variable}} instead of a hardcoded value` });
    }
  }

  return issues;
}

function analyzeWorkflowReliability(steps) {
  const allIssues = [];
  steps.forEach((step, idx) => {
    const issues = analyzeStepReliability(step);
    issues.forEach(i => allIssues.push({ ...i, stepIdx: idx, stepLabel: step.label || ACTION_DEF_MAP[step.action]?.label || step.action }));
  });
  return allIssues;
}

// Map runtime error strings to beginner-friendly explanations
function explainError(error) {
  if (!error) return null;
  const e = error.toLowerCase();
  if (e.includes("timeout") || e.includes("timed out"))
    return { cause:"The page took too long to respond", fix:"Try increasing the timeout, or check if the website is accessible", icon:"⏱" };
  if (e.includes("econnrefused") || e.includes("connection refused"))
    return { cause:"The server refused the connection", fix:"The target server may be down or not accepting connections. Check the URL and try again", icon:"🔌" };
  if (e.includes("err_empty_response") || e.includes("empty response"))
    return { cause:"The server sent no response", fix:"The website may be temporarily down. Wait a moment and try again", icon:"📭" };
  if (e.includes("net::err") || e.includes("navigation failed") || e.includes("net_error"))
    return { cause:"The website couldn't be reached", fix:"Check the URL is correct and the site is online", icon:"🌐" };
  if (e.includes("401") || e.includes("unauthorized") || e.includes("authentication"))
    return { cause:"The website requires login", fix:"This workflow needs authentication. Log in manually first, or add login steps to your workflow", icon:"🔐" };
  if (e.includes("selector") || e.includes("element not found") || e.includes("no element"))
    return { cause:"The element wasn't found on the page", fix:"The selector may be wrong, or the page layout has changed. Try a different CSS selector", icon:"🔍" };
  if (e.includes("captcha") || e.includes("blocked") || e.includes("403") || e.includes("access denied"))
    return { cause:"The website blocked the automation", fix:"The site detected automated access. Some sites prevent this. Try again later or use a different approach", icon:"🤖" };
  if (e.includes("click") || e.includes("not clickable") || e.includes("intercept"))
    return { cause:"The element couldn't be clicked", fix:"A popup or overlay may be covering it. Try adding a 'Close popups' step before clicking", icon:"👆" };
  if (e.includes("navigation") || e.includes("redirect"))
    return { cause:"The page redirected unexpectedly", fix:"Add a 'Wait for element' step after navigating to let the page finish loading", icon:"↪" };
  if (e.includes("script") || e.includes("execution context"))
    return { cause:"A script step failed to run", fix:"Check the JavaScript code in your 'Run custom script' step", icon:"⚙" };
  if (e.includes("out of memory") || e.includes("oom"))
    return { cause:"The browser ran out of memory", fix:"The page may have too many resources. Try breaking the workflow into smaller steps", icon:"💾" };
  return { cause:"An unexpected error occurred", fix:"Check the execution screenshot for clues, or try running the workflow again", icon:"⚠" };
}

// ── WorkflowReadinessPanel ────────────────────────────────────────────────────

function WorkflowReadinessPanel({ steps }) {
  const issues = useMemo(() => analyzeWorkflowReliability(steps), [steps]);

  const errors = issues.filter(i=>i.severity==="error");
  const warns  = issues.filter(i=>i.severity==="warn");
  const infos  = issues.filter(i=>i.severity==="info");

  if (issues.length === 0 && steps.length > 0) {
    return (
      <div className="bap-readiness-panel bap-readiness-clear">
        <div className="bap-readiness-header">
          <span className="bap-readiness-icon bap-readiness-ok">✓</span>
          <span className="bap-readiness-title">Workflow looks good — ready to run</span>
        </div>
      </div>
    );
  }
  if (issues.length === 0) return null;

  return (
    <div className="bap-readiness-panel">
      <div className="bap-readiness-header">
        {errors.length > 0 ? (
          <><span className="bap-readiness-icon bap-readiness-error">✗</span>
          <span className="bap-readiness-title">
            {errors.length} issue{errors.length!==1?"s":""} will prevent this workflow from running
          </span></>
        ) : warns.length > 0 ? (
          <><span className="bap-readiness-icon bap-readiness-warn">⚠</span>
          <span className="bap-readiness-title">
            {warns.length} warning{warns.length!==1?"s":""} — workflow may be unreliable
          </span></>
        ) : (
          <><span className="bap-readiness-icon bap-readiness-info">ℹ</span>
          <span className="bap-readiness-title">Suggestions to improve reliability</span></>
        )}
      </div>
      <div className="bap-readiness-list">
        {issues.map((issue, i) => (
          <div key={i} className={`bap-readiness-item bap-readiness-${issue.severity}`}>
            <span className="bap-readiness-item-badge">
              {issue.severity === "error" ? "✗" : issue.severity === "warn" ? "⚠" : "ℹ"}
            </span>
            <div className="bap-readiness-item-body">
              <span className="bap-readiness-step-ref">Step {issue.stepIdx+1} · {issue.stepLabel}</span>
              <span className="bap-readiness-msg">{issue.msg}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StepReliabilityHint ───────────────────────────────────────────────────────

function StepReliabilityHint({ step }) {
  const issues = analyzeStepReliability(step);
  if (issues.length === 0) return null;
  return (
    <div className="bap-step-hints">
      {issues.map((issue, i) => (
        <div key={i} className={`bap-step-hint bap-step-hint-${issue.severity}`}>
          <span>{issue.severity === "error" ? "✗" : issue.severity === "warn" ? "⚠" : "ℹ"}</span>
          <span>{issue.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── FailureExplainer ──────────────────────────────────────────────────────────

function FailureExplainer({ error, steps }) {
  const explanation = explainError(error);
  if (!explanation) return null;
  return (
    <div className="bap-failure-explainer">
      <div className="bap-failure-icon">{explanation.icon}</div>
      <div className="bap-failure-body">
        <div className="bap-failure-cause"><strong>Why it failed:</strong> {explanation.cause}</div>
        <div className="bap-failure-fix"><strong>What to try:</strong> {explanation.fix}</div>
      </div>
    </div>
  );
}

// ── SelectorTeachCard ─────────────────────────────────────────────────────────

function SelectorTeachCard({ onClose }) {
  return (
    <div className="bap-teach-card">
      <div className="bap-teach-header">
        <span className="bap-teach-title">How to find the right CSS selector</span>
        <button className="bap-modal-close bap-teach-close" onClick={onClose}>✕</button>
      </div>
      <div className="bap-teach-steps">
        <div className="bap-teach-step">
          <div className="bap-teach-step-num">1</div>
          <div>
            <div className="bap-teach-step-label">Open the website in Chrome or Firefox</div>
            <div className="bap-teach-step-desc">Navigate to the page your workflow will run on.</div>
          </div>
        </div>
        <div className="bap-teach-step">
          <div className="bap-teach-step-num">2</div>
          <div>
            <div className="bap-teach-step-label">Right-click the element you want</div>
            <div className="bap-teach-step-desc">A button, link, input box, or any text on the page.</div>
          </div>
        </div>
        <div className="bap-teach-step">
          <div className="bap-teach-step-num">3</div>
          <div>
            <div className="bap-teach-step-label">Click "Inspect" from the menu</div>
            <div className="bap-teach-step-desc">DevTools opens and highlights the element in the code panel.</div>
          </div>
        </div>
        <div className="bap-teach-step">
          <div className="bap-teach-step-num">4</div>
          <div>
            <div className="bap-teach-step-label">Look for id="" or class="" on the highlighted line</div>
            <div className="bap-teach-step-desc">
              If you see <code>id="submit-btn"</code> → use <code>#submit-btn</code><br/>
              If you see <code>class="btn primary"</code> → use <code>.btn.primary</code>
            </div>
          </div>
        </div>
        <div className="bap-teach-step">
          <div className="bap-teach-step-num">5</div>
          <div>
            <div className="bap-teach-step-label">Right-click the line → Copy → Copy selector</div>
            <div className="bap-teach-step-desc">Paste it here. The confidence indicator will tell you if it's reliable.</div>
          </div>
        </div>
      </div>
      <div className="bap-teach-examples">
        <div className="bap-teach-examples-title">Common selector patterns</div>
        <div className="bap-teach-example-grid">
          {[
            {sel:"#login-btn",          quality:"Excellent", tip:"ID — unique on the page, very reliable"},
            {sel:".submit-button",      quality:"Good",      tip:"Class name — usually stable"},
            {sel:"input[name='email']", quality:"Good",      tip:"Named input — very stable for forms"},
            {sel:"button[type=submit]", quality:"Good",      tip:"Submit button — works on most forms"},
            {sel:"[data-testid='nav']", quality:"Good",      tip:"Test ID — stable, developers add these intentionally"},
            {sel:"div",                 quality:"Fragile",   tip:"Generic tag — matches hundreds of elements"},
          ].map(ex => (
            <div key={ex.sel} className="bap-teach-example">
              <code className="bap-teach-example-sel">{ex.sel}</code>
              <span className={`bap-teach-quality bap-teach-quality-${ex.quality.toLowerCase()}`}>{ex.quality}</span>
              <span className="bap-teach-example-tip">{ex.tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── EditorView ────────────────────────────────────────────────────────────────

function EditorView({ editName, setEditName, editCategory, setEditCat, editStepsRaw, setEditRaw, editDesc, setEditDesc, editTagsRaw, setEditTagsRaw, editError, saveLoading, onSave, onBack, vars }) {
  // Visual builder state — source of truth; JSON textarea is derived
  const [steps, setSteps]             = useState(() => stepsFromRaw(editStepsRaw) || []);
  const [showPicker, setShowPicker]   = useState(false);
  const [pickerGroup, setPickerGroup] = useState("Navigation");
  const [showRaw, setShowRaw]         = useState(false);
  const [rawError, setRawError]       = useState(null);
  const [showStarters, setShowStarters] = useState(steps.length === 0);
  const [showTeach, setShowTeach]     = useState(false);
  // Selector picker: { stepIdx, fieldKey }
  const [selectorPicker, setSelectorPicker] = useState(null);
  // Drag-to-reorder state
  const [dragIdx, setDragIdx]         = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // Keep editStepsRaw in sync whenever steps change
  useEffect(() => {
    const json = rawFromSteps(steps);
    setEditRaw(json);
    setRawError(null);
  }, [steps, setEditRaw]);

  // If raw textarea is edited directly, sync back to cards
  function handleRawChange(val) {
    setEditRaw(val);
    const parsed = stepsFromRaw(val);
    if (parsed !== null) { setSteps(parsed); setRawError(null); }
    else setRawError("Invalid JSON — fix the raw editor to update cards");
  }

  function addStep(actionDef) {
    const defaults = {};
    (actionDef.fields||[]).forEach(f => { if (f.required && !defaults[f.key]) defaults[f.key] = ""; });
    setSteps(s => [...s, { action: actionDef.action, label: actionDef.label, ...defaults }]);
    setShowPicker(false);
    setShowStarters(false);
  }

  function updateStep(idx, key, val) {
    setSteps(s => s.map((step,i) => i===idx ? {...step, [key]:val} : step));
  }

  function removeStep(idx) {
    setSteps(s => s.filter((_,i)=>i!==idx));
  }

  function moveStep(idx, dir) {
    setSteps(s => {
      const next = [...s];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return next;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function duplicateStep(idx) {
    setSteps(s => {
      const copy = JSON.parse(JSON.stringify(s[idx]));
      const next = [...s];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }

  function handleDragStart(idx) { setDragIdx(idx); }
  function handleDragEnter(idx) { setDragOverIdx(idx); }
  function handleDragEnd() {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setSteps(s => {
        const next = [...s];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(dragOverIdx, 0, moved);
        return next;
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function applyStarter(tmpl) {
    setSteps(JSON.parse(JSON.stringify(tmpl.steps)));
    setShowStarters(false);
    if (tmpl.id !== "blank" && !editName.trim()) setEditName(tmpl.label);
    if (tmpl.id !== "blank" && !editDesc.trim())  setEditDesc(tmpl.desc);
  }

  const canSave = editName.trim() && steps.length > 0 && !rawError;

  return (
    <div className="bap-editor bap-editor-v2">

      {/* Selector teach card modal */}
      {showTeach && (
        <div className="bap-modal-overlay" onClick={e=>{if(e.target===e.currentTarget)setShowTeach(false);}}>
          <div className="bap-modal bap-teach-modal">
            <SelectorTeachCard onClose={()=>setShowTeach(false)} />
          </div>
        </div>
      )}

      {/* Selector picker modal */}
      {selectorPicker && (
        <SelectorPickerModal
          initialSelector={steps[selectorPicker.stepIdx]?.[selectorPicker.fieldKey] || ""}
          initialUrl={steps.find(s=>s.action==="navigate")?.url || ""}
          onInsert={sel => {
            updateStep(selectorPicker.stepIdx, selectorPicker.fieldKey, sel);
            setSelectorPicker(null);
          }}
          onClose={() => setSelectorPicker(null)}
        />
      )}

      {/* Header */}
      <div className="bap-editor-v2-header">
        <button className="bap-back-btn" onClick={onBack}>← Back</button>
        <div className="bap-editor-v2-title">
          {editName.trim() ? editName : <span className="bap-editor-v2-placeholder">New Workflow</span>}
        </div>
        <div className="bap-editor-v2-header-actions">
          <button
            className="bap-btn-primary"
            onClick={onSave}
            disabled={saveLoading || !canSave}
            title={!editName.trim() ? "Add a workflow name" : steps.length === 0 ? "Add at least one step" : ""}
          >{saveLoading ? "Saving…" : "Save Workflow"}</button>
        </div>
      </div>

      {/* Metadata */}
      <div className="bap-editor-v2-meta">
        <div className="bap-param-field">
          <label className="bap-param-label">Name *</label>
          <input className="bap-param-input" value={editName} onChange={e=>setEditName(e.target.value)} placeholder="e.g. Monitor competitor prices" />
        </div>
        <div className="bap-param-field">
          <label className="bap-param-label">Category</label>
          <select className="bap-param-input" value={editCategory} onChange={e=>setEditCat(e.target.value)}>
            {Object.entries(CATEGORY_META).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="bap-param-field bap-editor-field-full">
          <label className="bap-param-label">Description <span className="bap-field-optional">(optional — shown on the card)</span></label>
          <input className="bap-param-input" value={editDesc} onChange={e=>setEditDesc(e.target.value)} placeholder="What does this workflow do?" />
        </div>
        <div className="bap-param-field bap-editor-field-full">
          <label className="bap-param-label">Tags <span className="bap-field-optional">(comma-separated)</span></label>
          <input className="bap-param-input" value={editTagsRaw} onChange={e=>setEditTagsRaw(e.target.value)} placeholder="monitoring, seo, github" />
        </div>
      </div>

      {/* Starter templates — shown when no steps yet */}
      {showStarters && steps.length === 0 && (
        <div className="bap-starters">
          <div className="bap-starters-title">Start with a template</div>
          <div className="bap-starters-grid">
            {STARTER_TEMPLATES.map(tmpl => (
              <button key={tmpl.id} className="bap-starter-card" onClick={()=>applyStarter(tmpl)}>
                <span className="bap-starter-icon">{tmpl.icon}</span>
                <span className="bap-starter-label">{tmpl.label}</span>
                <span className="bap-starter-desc">{tmpl.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Workflow preview strip */}
      {steps.length > 0 && (
        <div className="bap-wf-preview-strip">
          <div className="bap-wf-preview-label">{steps.length} step{steps.length!==1?"s":""}</div>
          <div className="bap-wf-preview-flow">
            {steps.map((s,i) => (
              <React.Fragment key={i}>
                <span className="bap-wf-preview-step">{stepSummary(s)}</span>
                {i < steps.length-1 && <span className="bap-wf-preview-arrow">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Reliability checklist — shown when workflow has issues */}
      {steps.length > 0 && <WorkflowReadinessPanel steps={steps} />}

      {/* Step cards */}
      <div className="bap-step-list">
        {steps.length === 0 && !showStarters && (
          <div className="bap-step-empty">
            <span>No steps yet.</span>
            <button className="bap-inline-link" onClick={()=>setShowStarters(true)}>Choose a starter</button>
            <span>or</span>
            <button className="bap-inline-link" onClick={()=>setShowPicker(true)}>add your first step</button>
          </div>
        )}

        {steps.map((step, idx) => {
          const def = ACTION_DEF_MAP[step.action] || { icon:"⚙", label:step.action, fields:[], desc:"" };
          const isDragging = dragIdx === idx;
          const isDragOver = dragOverIdx === idx && dragIdx !== idx;
          return (
            <div
              key={idx}
              className={`bap-step-card${isDragging?" bap-step-dragging":""}${isDragOver?" bap-step-dragover":""}`}
              draggable
              onDragStart={()=>handleDragStart(idx)}
              onDragEnter={()=>handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={e=>e.preventDefault()}
            >
              <div className="bap-step-card-header">
                <div className="bap-step-drag-handle" title="Drag to reorder">⣿</div>
                <div className="bap-step-num-badge">{idx + 1}</div>
                <span className="bap-step-action-icon">{def.icon}</span>
                <div className="bap-step-card-title">
                  <span className="bap-step-action-label">{def.label}</span>
                  {def.group && <span className="bap-step-group-tag">{def.group}</span>}
                </div>
                <div className="bap-step-card-controls">
                  <button className="bap-step-ctrl" onClick={()=>duplicateStep(idx)} title="Duplicate this step">⧉</button>
                  <button className="bap-step-ctrl" onClick={()=>moveStep(idx,-1)} disabled={idx===0} title="Move up">↑</button>
                  <button className="bap-step-ctrl" onClick={()=>moveStep(idx,1)} disabled={idx===steps.length-1} title="Move down">↓</button>
                  <button className="bap-step-ctrl bap-step-del" onClick={()=>removeStep(idx)} title="Remove step">✕</button>
                </div>
              </div>

              {def.desc && <div className="bap-step-card-desc">{def.desc}</div>}

              <div className="bap-step-card-fields">
                {/* Primary fields — all except advanced config and label */}
                {def.fields.filter(f=>f.key!=="label"&&f.key!=="retries"&&f.key!=="timeout").map(field => {
                  const isSelector = field.key === "selector";
                  const isValue    = field.key === "value" || field.key === "url" || field.key === "text";
                  const conf       = isSelector ? selectorConfidence(step[field.key]||"") : null;
                  const filledVars = vars ? Object.entries(vars).filter(([,v])=>v) : [];
                  const hasToken   = (step[field.key]||"").includes("{{");
                  const tokenPreview = (vars && hasToken) ? applyVars(step[field.key]||"", vars) : null;
                  return (
                  <div key={field.key} className={`bap-step-field${field.type==="code"?" bap-step-field-code":""}`}>
                    <label className="bap-step-field-label">
                      {field.label}
                      {field.required && <span className="bap-step-required"> *</span>}
                      {conf && step[field.key] && (
                        <span className="bap-sel-confidence" style={{color:conf.color}} title={conf.tip}>
                          {conf.label} ({conf.score}/100)
                        </span>
                      )}
                      {isSelector && (
                        <>
                          <HelpTip>A CSS selector tells Ooplix which element on the page to interact with. The easiest way: right-click the button or input on the real page → Inspect → look for id="" or class="" → use #id-name or .class-name. Click "⊹ Pick" for guided examples, or "? How to find this" for a step-by-step walkthrough.</HelpTip>
                          <button className="bap-sel-pick-btn" onClick={()=>setSelectorPicker({stepIdx:idx,fieldKey:field.key})} title="Open selector picker">
                            ⊹ Pick
                          </button>
                          <button className="bap-sel-help-btn" onClick={()=>setShowTeach(v=>!v)} title="How do I find a CSS selector?">
                            ? How to find this
                          </button>
                        </>
                      )}
                    </label>
                    {field.type === "code" ? (
                      <textarea
                        className="bap-step-code-input"
                        value={step[field.key]||""}
                        onChange={e=>updateStep(idx,field.key,e.target.value)}
                        placeholder={field.placeholder||""}
                        rows={3}
                        spellCheck={false}
                      />
                    ) : (
                      <input
                        className={`bap-step-input${field.required && !(step[field.key]||"").trim() ? " bap-step-input-empty" : ""}`}
                        type={field.type||"text"}
                        value={step[field.key]||""}
                        onChange={e=>updateStep(idx,field.key,e.target.value)}
                        placeholder={field.placeholder||""}
                      />
                    )}
                    {isSelector && (
                      <div className="bap-sel-chips">
                        {SELECTOR_CHIPS.map(c=>(
                          <button
                            key={c.val}
                            className="bap-sel-chip"
                            title={c.tip}
                            onClick={()=>updateStep(idx,field.key,c.val)}
                          >{c.label}</button>
                        ))}
                      </div>
                    )}
                    {isValue && filledVars.length > 0 && (
                      <div className="bap-var-chips">
                        {filledVars.map(([k])=>(
                          <button
                            key={k}
                            className="bap-var-chip"
                            title={`Insert {{${k}}}`}
                            onClick={()=>updateStep(idx,field.key,(step[field.key]||"")+"{{"+k+"}}")}
                          >{k}</button>
                        ))}
                      </div>
                    )}
                    {hasToken && tokenPreview && tokenPreview !== (step[field.key]||"") && (
                      <div className="bap-var-preview">→ {tokenPreview}</div>
                    )}
                  </div>
                  );
                })}
                {/* Advanced config: retries + timeout in one compact row */}
                {def.fields.some(f=>f.key==="retries"||f.key==="timeout") && (
                  <div className="bap-step-adv-row">
                    {def.fields.filter(f=>f.key==="retries"||f.key==="timeout").map(f=>(
                      <div key={f.key} className="bap-step-adv-field">
                        <label className="bap-step-adv-label">{f.key==="retries"?"Retries":"Timeout (ms)"}</label>
                        <input
                          className="bap-step-adv-input"
                          type="number"
                          min={0}
                          max={f.key==="retries"?5:120000}
                          value={step[f.key]||""}
                          onChange={e=>updateStep(idx,f.key,e.target.value===""?"":Number(e.target.value))}
                          placeholder={f.placeholder||""}
                        />
                      </div>
                    ))}
                    <div className="bap-step-adv-hint">
                      {(step.retries||0)>0 && <span>↺ retry {step.retries}×</span>}
                      {(step.timeout||0)>0 && <span>⏱ {Math.round(step.timeout/1000)}s limit</span>}
                    </div>
                  </div>
                )}
                {/* Step name (label) always last, collapsible visually */}
                <div className="bap-step-field bap-step-field-name">
                  <label className="bap-step-field-label bap-step-label-dim">Step name <span className="bap-field-optional">(shown during execution)</span></label>
                  <input
                    className="bap-step-input bap-step-input-dim"
                    value={step.label||""}
                    onChange={e=>updateStep(idx,"label",e.target.value)}
                    placeholder={def.label||step.action}
                  />
                </div>
              </div>
              {/* Per-step reliability hints */}
              <StepReliabilityHint step={step} />
            </div>
          );
        })}

        {/* Add step button */}
        <button className="bap-add-step-btn" onClick={()=>setShowPicker(v=>!v)}>
          {showPicker ? "✕ Cancel" : "+ Add Step"}
        </button>
      </div>

      {/* Action picker */}
      {showPicker && (
        <div className="bap-picker">
          <div className="bap-picker-header">
            <span className="bap-picker-title">Choose an action</span>
            <div className="bap-picker-groups">
              {ACTION_GROUPS.map(g => (
                <button
                  key={g}
                  className={`bap-picker-group${pickerGroup===g?" active":""}`}
                  onClick={()=>setPickerGroup(g)}
                >{g}</button>
              ))}
            </div>
          </div>
          <div className="bap-picker-grid">
            {ACTION_DEFS.filter(a=>a.group===pickerGroup).map(a => (
              <button key={a.action} className="bap-picker-tile" onClick={()=>addStep(a)}>
                <span className="bap-picker-tile-icon">{a.icon}</span>
                <span className="bap-picker-tile-label">{a.label}</span>
                <span className="bap-picker-tile-desc">{a.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Save error */}
      {editError && <div className="bap-editor-error">{editError}</div>}

      {/* Advanced: raw JSON collapsible */}
      <details className="bap-raw-details" onToggle={e=>setShowRaw(e.target.open)}>
        <summary className="bap-raw-summary">Advanced — Raw JSON {steps.length > 0 && `(${steps.length} steps)`}</summary>
        <div className="bap-raw-body">
          <div className="bap-raw-hint">You can edit the JSON directly. Changes sync back to the visual cards above.</div>
          <textarea
            className={`bap-steps-textarea${rawError?" bap-steps-error":""}`}
            value={editStepsRaw}
            onChange={e=>handleRawChange(e.target.value)}
            rows={10}
            spellCheck={false}
          />
          {rawError && <div className="bap-editor-parse-error">{rawError}</div>}
        </div>
      </details>

      <div className="bap-editor-actions">
        <button
          className="bap-btn-primary"
          onClick={onSave}
          disabled={saveLoading || !canSave}
        >{saveLoading ? "Saving…" : "Save Workflow"}</button>
        <button className="bap-btn-ghost" onClick={onBack}>Cancel</button>
        {!canSave && editName.trim() && steps.length === 0 && (
          <span className="bap-editor-v2-hint">Add at least one step to save.</span>
        )}
        {!canSave && !editName.trim() && (
          <span className="bap-editor-v2-hint">Give your workflow a name to save.</span>
        )}
      </div>
    </div>
  );
}
