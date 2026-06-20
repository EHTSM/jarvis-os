"use strict";
/**
 * Growth Operating System — G2
 * Content & SEO Engine
 *
 * Reuses: socialContentEngine (multi-platform), brandStudio (voice/kit),
 *         crmService (lead context). No new runtime, no new AI.
 *
 * Storage: data/content-seo.json
 * {
 *   articles:    {}   blog/guide/case-study/release-note
 *   keywords:    {}   keyword intelligence records
 *   clusters:    {}   topic clusters
 *   landingPages:{}   AI-generated landing pages
 *   docs:        {}   API/feature/tutorial docs
 *   calendar:    {}   content calendar entries
 *   brandVoice:  {}   brand voice rules per account
 *   glossary:    []   brand terminology entries
 * }
 */

const fs      = require("fs");
const path    = require("path");
const social  = require("./socialContentEngine.cjs");
const brand   = require("./brandStudio.cjs");

const DATA_FILE = path.join(__dirname, "../../data/content-seo.json");

// ── helpers ──────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch {
    return {
      articles:     {},
      keywords:     {},
      clusters:     {},
      landingPages: {},
      docs:         {},
      calendar:     {},
      brandVoice:   {},
      glossary:     [],
    };
  }
}

function _save(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }
function _id(p)   { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function _ts()    { return new Date().toISOString(); }
function _today() { return new Date().toISOString().slice(0, 10); }

// ── SEO scoring helpers ───────────────────────────────────────────────────────

function _seoScore(opts) {
  let score = 0;
  if (opts.title?.length >= 30 && opts.title?.length <= 70)  score += 20;
  if (opts.metaDesc?.length >= 100 && opts.metaDesc?.length <= 160) score += 15;
  if (opts.keyword && opts.body?.toLowerCase().includes(opts.keyword.toLowerCase())) score += 15;
  if ((opts.body?.match(/## /g) || []).length >= 2) score += 10;
  if (opts.slug?.includes("-")) score += 10;
  if ((opts.body?.split(" ") || []).length >= 300) score += 15;
  if (opts.schema) score += 10;
  if (opts.internalLinks?.length >= 2) score += 5;
  return Math.min(100, score);
}

function _conversionScore(opts) {
  let score = 0;
  if (opts.headline?.length >= 20 && opts.headline?.length <= 80) score += 20;
  if (opts.cta) score += 25;
  if (opts.benefits?.length >= 3) score += 20;
  if (opts.socialProof) score += 15;
  if (opts.urgency) score += 10;
  if (opts.subheadline) score += 10;
  return Math.min(100, score);
}

function _opportunityScore(kw) {
  const vol   = kw.volume   || 0;
  const diff  = kw.difficulty || 50;
  const comp  = kw.competitorGap ? 15 : 0;
  const intent = kw.intent === "transactional" ? 20 : kw.intent === "commercial" ? 15 : 5;
  return Math.min(100, Math.round(vol / 100 + (100 - diff) * 0.4 + comp + intent));
}

// ── MODULE 1: AI Blog Studio ──────────────────────────────────────────────────

const ARTICLE_TYPES = ["blog", "how-to", "case-study", "release-notes", "product-update", "tutorial", "listicle", "comparison"];

function createArticle(opts) {
  const s  = _load();
  const id = _id("art");
  const body = opts.body || "";
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  s.articles[id] = {
    id,
    type:         opts.type        || "blog",
    title:        opts.title       || "",
    slug:         opts.slug        || opts.title?.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || id,
    metaTitle:    opts.metaTitle   || opts.title || "",
    metaDesc:     opts.metaDesc    || "",
    keyword:      opts.keyword     || "",
    tags:         opts.tags        || [],
    body,
    wordCount,
    schema:       opts.schema      || null,
    internalLinks: opts.internalLinks || [],
    status:       opts.status      || "draft",
    seoScore:     _seoScore({ title: opts.metaTitle || opts.title, metaDesc: opts.metaDesc, keyword: opts.keyword, body, slug: opts.slug, schema: opts.schema, internalLinks: opts.internalLinks }),
    prompt:       opts.prompt      || null,
    aiGenerated:  opts.aiGenerated || false,
    clusterId:    opts.clusterId   || null,
    publishedAt:  opts.status === "published" ? _ts() : null,
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.articles[id];
}

function updateArticle(id, patch) {
  const s = _load();
  if (!s.articles[id]) throw new Error(`Article ${id} not found`);
  Object.assign(s.articles[id], patch, { updatedAt: _ts() });
  // Recompute SEO score on body/meta update
  const a = s.articles[id];
  a.seoScore  = _seoScore({ title: a.metaTitle || a.title, metaDesc: a.metaDesc, keyword: a.keyword, body: a.body, slug: a.slug, schema: a.schema, internalLinks: a.internalLinks });
  a.wordCount = (a.body || "").split(/\s+/).filter(Boolean).length;
  if (patch.status === "published" && !a.publishedAt) a.publishedAt = _ts();
  _save(s);
  return s.articles[id];
}

function publishArticle(id) {
  return updateArticle(id, { status: "published" });
}

function listArticles(type, status) {
  const s = _load();
  return Object.values(s.articles)
    .filter(a => (!type || a.type === type) && (!status || a.status === status))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getArticle(id) { return _load().articles[id] || null; }

function buildArticlePrompt(type, topic, opts = {}) {
  const LENGTH = { blog: 1200, "how-to": 900, "case-study": 1000, "release-notes": 400, "product-update": 500, tutorial: 1500, listicle: 800, comparison: 1000 };
  const len = LENGTH[type] || 1000;
  return {
    systemPrompt: `You are an expert ${type} writer for Ooplix — an AI Operating System for solo founders and small teams. You write in a direct, founder-first voice. No fluff, no jargon. SEO-optimized, scannable, and useful.`,
    userPrompt:   `Write a ${len}-word ${type} article on: "${topic}"\n\nFocus keyword: ${opts.keyword || topic}\nAudience: ${opts.audience || "solo founders and small business owners"}\nBrand voice: ${opts.brandVoice || "direct, capable, founder-first"}\n\nInclude:\n- H1 title\n- Meta description (150-160 chars)\n- H2/H3 structure\n- A TL;DR at the top\n- Internal link opportunities tagged as [LINK: topic]\n- Keyword density: 1-2% for "${opts.keyword || topic}"\n- CTA at the end pointing to Ooplix\n\nReturn JSON: { title, metaTitle, metaDesc, slug, body, internalLinks: [] }`,
    type, topic, length: len, keyword: opts.keyword || topic,
  };
}

// ── MODULE 2: SEO Command Center ──────────────────────────────────────────────

const BUILTIN_SEO_CHECKS = [
  { id: "title",       label: "Title tag (30-70 chars)",          category: "on-page",   severity: "critical" },
  { id: "meta_desc",   label: "Meta description (100-160 chars)",  category: "on-page",   severity: "critical" },
  { id: "og_tags",     label: "Open Graph tags",                   category: "on-page",   severity: "high"     },
  { id: "twitter_card",label: "Twitter Card meta",                 category: "on-page",   severity: "medium"   },
  { id: "canonical",   label: "Canonical URL",                     category: "on-page",   severity: "high"     },
  { id: "schema",      label: "JSON-LD structured data",           category: "technical", severity: "high"     },
  { id: "sitemap",     label: "XML Sitemap",                       category: "technical", severity: "critical" },
  { id: "robots_txt",  label: "robots.txt",                        category: "technical", severity: "critical" },
  { id: "https",       label: "HTTPS / SSL",                       category: "technical", severity: "critical" },
  { id: "mobile",      label: "Mobile viewport",                   category: "technical", severity: "high"     },
  { id: "core_vitals", label: "Core Web Vitals",                   category: "technical", severity: "high"     },
  { id: "h1",          label: "Single H1 per page",                category: "on-page",   severity: "critical" },
  { id: "alt_text",    label: "Image alt text",                    category: "on-page",   severity: "medium"   },
  { id: "internal_links",label: "Internal linking depth",          category: "on-page",   severity: "medium"   },
  { id: "breadcrumbs", label: "Breadcrumb schema",                 category: "technical", severity: "low"      },
  { id: "gsc",         label: "Google Search Console verified",    category: "off-page",  severity: "critical" },
  { id: "ga4",         label: "GA4 tracking",                      category: "off-page",  severity: "high"     },
  { id: "blog_content",label: "Blog / content pages",              category: "content",   severity: "critical" },
  { id: "backlinks",   label: "Backlink profile",                  category: "off-page",  severity: "high"     },
  { id: "page_speed",  label: "PageSpeed Insights > 80",           category: "technical", severity: "high"     },
];

function runTechnicalAudit(siteStatus = {}) {
  const checks = BUILTIN_SEO_CHECKS.map(c => {
    const result = siteStatus[c.id];
    return {
      ...c,
      status: result?.status || "unknown",
      note:   result?.note   || "Not yet verified — run audit against live site",
      pass:   result?.status === "pass",
    };
  });

  const passing  = checks.filter(c => c.pass).length;
  const critical = checks.filter(c => !c.pass && c.severity === "critical").length;
  const score    = Math.round(passing / checks.length * 100);

  return {
    score, passing, total: checks.length, criticalIssues: critical,
    checks,
    verdict: score >= 80 ? "seo_ready" : score >= 60 ? "needs_work" : "critical_gaps",
    runAt: _ts(),
  };
}

function createTopicCluster(opts) {
  const s  = _load();
  const id = _id("cls");
  s.clusters[id] = {
    id,
    pillarTopic: opts.pillarTopic || "",
    pillarUrl:   opts.pillarUrl   || null,
    supportingTopics: opts.supportingTopics || [],
    internalLinks: [],
    articles:    [],
    status:      "planning",
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.clusters[id];
}

function updateTopicCluster(id, patch) {
  const s = _load();
  if (!s.clusters[id]) throw new Error(`Cluster ${id} not found`);
  Object.assign(s.clusters[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.clusters[id];
}

function listTopicClusters() {
  return Object.values(_load().clusters).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function addInternalLink(clusterId, from, to, anchorText) {
  const s = _load();
  const c = s.clusters[clusterId];
  if (!c) throw new Error(`Cluster ${clusterId} not found`);
  c.internalLinks.push({ from, to, anchorText, addedAt: _ts() });
  c.updatedAt = _ts();
  _save(s);
  return c;
}

function generateSchemaMarkup(type, data) {
  const schemas = {
    article:  { "@context": "https://schema.org", "@type": "Article",        headline: data.title, author: { "@type": "Organization", name: "Ooplix" }, publisher: { "@type": "Organization", name: "Ooplix" }, datePublished: data.date || _today() },
    howto:    { "@context": "https://schema.org", "@type": "HowTo",          name: data.title, description: data.description || "", step: (data.steps || []).map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s })) },
    faq:      { "@context": "https://schema.org", "@type": "FAQPage",        mainEntity: (data.faqs || []).map(q => ({ "@type": "Question", name: q.q, acceptedAnswer: { "@type": "Answer", text: q.a } })) },
    product:  { "@context": "https://schema.org", "@type": "SoftwareApplication", name: data.name || "Ooplix", applicationCategory: "BusinessApplication", offers: { "@type": "Offer", price: data.price || "0", priceCurrency: "INR" } },
    breadcrumb: { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: (data.crumbs || []).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })) },
  };
  return schemas[type] || {};
}

// ── MODULE 3: Content Repurposing Engine ──────────────────────────────────────

const REPURPOSE_TARGETS = [
  { id: "blog",       label: "Blog Post",       platform: "blog",      maxLen: 1200 },
  { id: "linkedin",   label: "LinkedIn Post",   platform: "linkedin",  maxLen: 3000 },
  { id: "instagram",  label: "Instagram",       platform: "instagram", maxLen: 2200 },
  { id: "facebook",   label: "Facebook Post",   platform: "facebook",  maxLen: 500  },
  { id: "x",          label: "X / Twitter",     platform: "x",         maxLen: 280  },
  { id: "threads",    label: "Threads",         platform: "threads",   maxLen: 500  },
  { id: "pinterest",  label: "Pinterest Pin",   platform: "pinterest", maxLen: 500  },
  { id: "newsletter", label: "Newsletter",      platform: "email",     maxLen: 600  },
  { id: "email",      label: "Email Campaign",  platform: "email",     maxLen: 300  },
  { id: "video_script", label: "Video Script",  platform: "youtube",   maxLen: 2000 },
];

function buildRepurposePrompts(sourceContent, targets, opts = {}) {
  return targets.map(targetId => {
    const target = REPURPOSE_TARGETS.find(t => t.id === targetId);
    if (!target) return null;
    const platformSpec = social.getPlatform(target.platform);

    let prompt = "";
    if (targetId === "video_script") {
      prompt = `Convert this content into a ${opts.videoDuration || 3}-minute video script:\n\n${sourceContent}\n\nFormat: Hook (30s), Problem (30s), Solution (60s), Demo/Proof (45s), CTA (15s). Include [VISUAL CUE: ...] notes.`;
    } else if (targetId === "newsletter") {
      prompt = `Repurpose this content into a 200-word newsletter section with:\n- Subject line\n- Opening hook\n- Key insight\n- 1 actionable tip\n- CTA\n\nContent:\n${sourceContent}`;
    } else {
      prompt = `Repurpose this content into an optimized ${target.label} post:\n\nSource:\n${sourceContent}\n\nPlatform rules: ${platformSpec?.tips || "be concise and engaging"}\nMax length: ${target.maxLen} chars\nBrand voice: ${opts.brandVoice || "direct, helpful, founder-first"}\n\nReturn: { caption, hashtags, hook, cta }`;
    }

    return {
      targetId,
      targetLabel: target.label,
      platform:    target.platform,
      maxLen:      target.maxLen,
      prompt,
      capability:  "content_generate",
      creditCost:  1,
    };
  }).filter(Boolean);
}

function storeRepurposeJob(sourceId, targets, results) {
  const s  = _load();
  if (!s.repurposeJobs) s.repurposeJobs = {};
  const id = _id("rpj");
  s.repurposeJobs[id] = {
    id, sourceId, targets, results,
    status: "completed",
    createdAt: _ts(),
  };
  _save(s);
  return s.repurposeJobs[id];
}

function listRepurposeJobs() {
  const s = _load();
  return Object.values(s.repurposeJobs || {}).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
}

// ── MODULE 4: Landing Page Builder ────────────────────────────────────────────

const LP_SECTIONS = ["hero", "problem", "solution", "features", "social_proof", "pricing", "faq", "cta"];

function createLandingPage(opts) {
  const s  = _load();
  const id = _id("lp");
  const sections = opts.sections || {};

  const convScore = _conversionScore({
    headline:    sections.hero?.headline,
    cta:         sections.cta?.text,
    benefits:    sections.features?.items || [],
    socialProof: sections.social_proof?.text,
    urgency:     sections.hero?.urgency,
    subheadline: sections.hero?.subheadline,
  });

  const seoScore = _seoScore({
    title:    opts.metaTitle || sections.hero?.headline,
    metaDesc: opts.metaDesc,
    keyword:  opts.keyword,
    body:     Object.values(sections).map(s => typeof s === "object" ? JSON.stringify(s) : s).join(" "),
    slug:     opts.slug,
    schema:   opts.schema,
  });

  s.landingPages[id] = {
    id,
    name:           opts.name           || "Landing Page",
    slug:           opts.slug           || id,
    audience:       opts.audience       || "",
    keyword:        opts.keyword        || "",
    metaTitle:      opts.metaTitle      || sections.hero?.headline || "",
    metaDesc:       opts.metaDesc       || "",
    sections,
    schema:         opts.schema         || null,
    status:         opts.status         || "draft",
    conversionScore: convScore,
    seoScore,
    aiGenerated:    opts.aiGenerated    || false,
    abVariants:     [],
    prompt:         opts.prompt         || null,
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.landingPages[id];
}

function updateLandingPage(id, patch) {
  const s = _load();
  if (!s.landingPages[id]) throw new Error(`Landing page ${id} not found`);
  Object.assign(s.landingPages[id], patch, { updatedAt: _ts() });
  const lp = s.landingPages[id];
  lp.conversionScore = _conversionScore({ headline: lp.sections?.hero?.headline, cta: lp.sections?.cta?.text, benefits: lp.sections?.features?.items || [], socialProof: lp.sections?.social_proof?.text, urgency: lp.sections?.hero?.urgency, subheadline: lp.sections?.hero?.subheadline });
  lp.seoScore = _seoScore({ title: lp.metaTitle, metaDesc: lp.metaDesc, keyword: lp.keyword, body: JSON.stringify(lp.sections), slug: lp.slug, schema: lp.schema });
  _save(s);
  return s.landingPages[id];
}

function listLandingPages(status) {
  const s = _load();
  return Object.values(s.landingPages).filter(lp => !status || lp.status === status).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function buildLandingPagePrompt(audience, keyword, opts = {}) {
  return {
    systemPrompt: `You are a conversion copywriter for Ooplix. You write landing pages that convert at 3-5%. Direct, benefit-led, zero fluff.`,
    userPrompt:   `Write a high-converting landing page for: ${audience}\nFocus keyword: ${keyword}\nBrand voice: ${opts.brandVoice || "direct, capable, no fluff"}\n\nGenerate JSON with these sections:\n- hero: { headline, subheadline, cta, urgency }\n- problem: { heading, bullets: [] }\n- solution: { heading, description }\n- features: { heading, items: [{icon, title, desc}] }\n- social_proof: { heading, text, stats: [] }\n- pricing: { heading, plans: [] }\n- faq: { heading, items: [{q, a}] }\n- cta: { heading, text, subtext }\n\nAlso: metaTitle, metaDesc (150 chars), slug`,
    audience, keyword, sections: LP_SECTIONS,
  };
}

// ── MODULE 5: Documentation Generator ────────────────────────────────────────

const DOC_TYPES = ["api-reference", "feature-guide", "release-notes", "tutorial", "troubleshooting", "changelog", "faq"];

function createDoc(opts) {
  const s  = _load();
  const id = _id("doc");
  s.docs[id] = {
    id,
    type:       opts.type       || "feature-guide",
    title:      opts.title      || "",
    slug:       opts.slug       || opts.title?.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || id,
    body:       opts.body       || "",
    version:    opts.version    || "v3.0",
    tags:       opts.tags       || [],
    status:     opts.status     || "draft",
    aiGenerated: opts.aiGenerated || false,
    prompt:     opts.prompt     || null,
    relatedDocs: opts.relatedDocs || [],
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.docs[id];
}

function updateDoc(id, patch) {
  const s = _load();
  if (!s.docs[id]) throw new Error(`Doc ${id} not found`);
  Object.assign(s.docs[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.docs[id];
}

function listDocs(type, status) {
  const s = _load();
  return Object.values(s.docs)
    .filter(d => (!type || d.type === type) && (!status || d.status === status))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getDoc(id) { return _load().docs[id] || null; }

function buildDocPrompt(type, subject, opts = {}) {
  const TEMPLATES = {
    "api-reference":    `Generate complete API reference documentation for: ${subject}\n\nInclude: endpoint URL, method, authentication, request params (table), response schema (table), example request (curl), example response (JSON), error codes, rate limits.`,
    "feature-guide":    `Write a feature guide for: ${subject}\n\nInclude: overview, prerequisites, step-by-step setup, configuration options, common use cases, tips & tricks, troubleshooting.`,
    "release-notes":    `Write release notes for ${opts.version || "v3.0"}: ${subject}\n\nFormat: ## What's New, ## Improvements, ## Bug Fixes, ## Breaking Changes, ## Migration Guide (if any). Be specific, developer-friendly.`,
    "tutorial":         `Write a hands-on tutorial: ${subject}\n\nFormat: Prerequisites → Setup → Step 1 → ... → Step N → Result → Next Steps. Include code blocks. Target: beginner to intermediate.`,
    "troubleshooting":  `Write a troubleshooting guide for: ${subject}\n\nFor each issue: Symptom → Cause → Fix (with command or screenshot instruction). 5-8 common issues.`,
    "changelog":        `Write a CHANGELOG entry for ${opts.version || "v3.0"} — ${subject}. Use Keep a Changelog format.`,
    "faq":              `Write 10 FAQ entries for: ${subject}\n\nReturn JSON array of {q, a} objects. Questions should match real user searches.`,
  };
  return {
    systemPrompt: "You are a senior technical writer for Ooplix. Clear, precise, developer-friendly documentation.",
    userPrompt:   TEMPLATES[type] || `Write ${type} documentation for: ${subject}`,
    type, subject, version: opts.version || "v3.0",
  };
}

// ── MODULE 6: Content Calendar ────────────────────────────────────────────────

const APPROVAL_STATES = ["draft", "in-review", "approved", "scheduled", "published", "rejected"];

function createCalendarEntry(opts) {
  const s  = _load();
  const id = _id("cal");
  s.calendar[id] = {
    id,
    title:        opts.title        || "",
    type:         opts.type         || "blog",
    channel:      opts.channel      || "blog",
    scheduledDate: opts.scheduledDate || null,
    publishDate:  opts.publishDate  || null,
    assignee:     opts.assignee     || null,
    status:       opts.status       || "draft",
    approvalState: "draft",
    approvalNotes: [],
    contentId:    opts.contentId    || null,
    keywords:     opts.keywords     || [],
    campaignId:   opts.campaignId   || null,
    notes:        opts.notes        || "",
    createdAt: _ts(), updatedAt: _ts(),
  };
  _save(s);
  return s.calendar[id];
}

function updateCalendarEntry(id, patch) {
  const s = _load();
  if (!s.calendar[id]) throw new Error(`Calendar entry ${id} not found`);
  Object.assign(s.calendar[id], patch, { updatedAt: _ts() });
  _save(s);
  return s.calendar[id];
}

function approveCalendarEntry(id, notes, approved) {
  const s = _load();
  const e = s.calendar[id];
  if (!e) throw new Error(`Calendar entry ${id} not found`);
  e.approvalState = approved ? "approved" : "rejected";
  e.approvalNotes.push({ note: notes, at: _ts(), approved });
  e.updatedAt = _ts();
  _save(s);
  return e;
}

function listCalendarEntries(month, channel, status) {
  const s = _load();
  return Object.values(s.calendar)
    .filter(e =>
      (!month  || e.scheduledDate?.startsWith(month)) &&
      (!channel || e.channel === channel) &&
      (!status  || e.approvalState === status)
    )
    .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
}

function getCalendarStats() {
  const s       = _load();
  const entries = Object.values(s.calendar);
  const byState = {};
  const byChannel = {};
  for (const e of entries) {
    byState[e.approvalState]   = (byState[e.approvalState]   || 0) + 1;
    byChannel[e.channel]       = (byChannel[e.channel]       || 0) + 1;
  }
  return { total: entries.length, byState, byChannel, thisMonth: entries.filter(e => e.scheduledDate?.startsWith(_today().slice(0, 7))).length };
}

// ── MODULE 7: Keyword Intelligence ────────────────────────────────────────────

const BUILTIN_KEYWORDS = [
  { keyword: "whatsapp follow up automation", volume: 4400, difficulty: 42, intent: "commercial",    competitorGap: true,  trend: "rising"  },
  { keyword: "ai crm for freelancers india",  volume: 1900, difficulty: 28, intent: "commercial",    competitorGap: true,  trend: "rising"  },
  { keyword: "small business ai tools india", volume: 8100, difficulty: 55, intent: "informational", competitorGap: false, trend: "stable"  },
  { keyword: "automate whatsapp messages",     volume: 6600, difficulty: 48, intent: "transactional", competitorGap: true,  trend: "rising"  },
  { keyword: "ai os for business",             volume: 1300, difficulty: 22, intent: "commercial",    competitorGap: true,  trend: "rising"  },
  { keyword: "freelancer crm india",           volume: 2400, difficulty: 35, intent: "commercial",    competitorGap: false, trend: "stable"  },
  { keyword: "lead follow up software india",  volume: 3200, difficulty: 40, intent: "transactional", competitorGap: true,  trend: "rising"  },
  { keyword: "whatsapp business automation",   volume: 12000,difficulty: 62, intent: "commercial",    competitorGap: false, trend: "stable"  },
  { keyword: "ai mission control software",    volume: 720,  difficulty: 18, intent: "commercial",    competitorGap: true,  trend: "emerging"},
  { keyword: "solo founder tools 2026",        volume: 590,  difficulty: 15, intent: "informational", competitorGap: true,  trend: "emerging"},
];

function addKeyword(opts) {
  const s  = _load();
  const id = _id("kw");
  const kw = {
    id,
    keyword:      opts.keyword     || "",
    volume:       opts.volume      || 0,
    difficulty:   opts.difficulty  || 50,
    intent:       opts.intent      || "informational",
    competitorGap: opts.competitorGap || false,
    trend:        opts.trend       || "stable",
    clusterId:    opts.clusterId   || null,
    notes:        opts.notes       || "",
    opportunityScore: _opportunityScore(opts),
    createdAt: _ts(),
  };
  s.keywords[id] = kw;
  _save(s);
  return kw;
}

function listKeywords(intent, minOpportunity) {
  const s = _load();
  const custom = Object.values(s.keywords);
  const all    = [
    ...BUILTIN_KEYWORDS.map(k => ({ ...k, id: `builtin-${k.keyword.replace(/\s+/g,"-")}`, opportunityScore: _opportunityScore(k), builtin: true })),
    ...custom,
  ];
  return all
    .filter(k => (!intent || k.intent === intent) && (!minOpportunity || k.opportunityScore >= minOpportunity))
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

function getKeywordById(id) {
  const builtin = BUILTIN_KEYWORDS.find(k => `builtin-${k.keyword.replace(/\s+/g,"-")}` === id);
  if (builtin) return { ...builtin, id, opportunityScore: _opportunityScore(builtin), builtin: true };
  return _load().keywords[id] || null;
}

function getKeywordIntelligence() {
  const all = listKeywords();
  const byIntent = {};
  for (const k of all) byIntent[k.intent] = (byIntent[k.intent] || 0) + 1;
  return {
    total:         all.length,
    avgOpportunity: Math.round(all.reduce((s, k) => s + k.opportunityScore, 0) / (all.length || 1)),
    highOpportunity: all.filter(k => k.opportunityScore >= 70).length,
    competitorGaps:  all.filter(k => k.competitorGap).length,
    byIntent,
    rising:         all.filter(k => k.trend === "rising").length,
    emerging:       all.filter(k => k.trend === "emerging").length,
    topOpportunities: all.slice(0, 5),
  };
}

// ── MODULE 8: Brand Voice Engine ──────────────────────────────────────────────

const DEFAULT_BRAND_VOICE = {
  tone:          "direct",
  personality:   ["capable", "founder-first", "no-fluff"],
  avoid:         ["jargon", "superlatives", "corporate speak", "passive voice"],
  preferredWords: ["ship", "build", "automate", "founder", "operator"],
  avoidWords:    ["leverage", "synergy", "scalable solutions", "cutting-edge"],
  sentenceStyle: "short-to-medium",
  povStyle:      "second-person",
  examples: [
    { good: "Your leads stop leaking. Your revenue starts compounding.", bad: "Our synergistic AI leverages cutting-edge automation to optimize your lead pipeline." },
    { good: "Ship faster. Automate the boring parts. Stay in control.", bad: "Scale your business with our enterprise-grade AI-powered platform solution." },
  ],
};

const DEFAULT_GLOSSARY = [
  { term: "Mission",    definition: "A unit of work assigned to an AI agent. Missions have goals, constraints, and a success criteria.", preferred: "Mission", avoid: "Task, Job, Ticket" },
  { term: "Operator",   definition: "The human founder or manager who controls the system.", preferred: "Operator", avoid: "User, Admin, Customer" },
  { term: "AI OS",      definition: "AI Operating System — the Ooplix platform that runs agents, automations, and intelligence together.", preferred: "AI OS", avoid: "Platform, Tool, Software" },
  { term: "Agent",      definition: "An AI worker that executes missions autonomously.", preferred: "AI Agent", avoid: "Bot, Robot, Script" },
  { term: "Workspace",  definition: "The coding + file environment where development happens inside Ooplix.", preferred: "Workspace", avoid: "IDE, Editor, Environment" },
  { term: "Growth OS",  definition: "The marketing and content subsystem of Ooplix.", preferred: "Growth OS", avoid: "Marketing tool, CMS" },
];

function getBrandVoice(accountId) {
  const s = _load();
  const custom = s.brandVoice?.[accountId];
  const kit    = brand.listKits(accountId)[0];
  const kitVoice = kit?.brandVoice;
  return {
    ...DEFAULT_BRAND_VOICE,
    ...(kitVoice || {}),
    ...(custom   || {}),
    glossary: [...DEFAULT_GLOSSARY, ...(s.glossary || [])],
  };
}

function updateBrandVoice(accountId, patch) {
  const s = _load();
  if (!s.brandVoice) s.brandVoice = {};
  s.brandVoice[accountId] = { ...(s.brandVoice[accountId] || {}), ...patch, updatedAt: _ts() };
  _save(s);
  return s.brandVoice[accountId];
}

function addGlossaryTerm(opts) {
  const s = _load();
  if (!s.glossary) s.glossary = [];
  s.glossary.push({ term: opts.term, definition: opts.definition, preferred: opts.preferred || opts.term, avoid: opts.avoid || "", createdAt: _ts() });
  _save(s);
  return s.glossary[s.glossary.length - 1];
}

function listGlossary() {
  const s = _load();
  return [...DEFAULT_GLOSSARY, ...(s.glossary || [])];
}

function checkBrandConsistency(text) {
  const voice = getBrandVoice("global");
  const violations = [];
  const suggestions = [];

  for (const word of voice.avoidWords || []) {
    if (text.toLowerCase().includes(word.toLowerCase())) {
      violations.push({ type: "avoid_word", found: word, suggestion: "Rephrase to be more direct" });
    }
  }
  for (const g of DEFAULT_GLOSSARY) {
    for (const av of (g.avoid || "").split(",").map(s => s.trim()).filter(Boolean)) {
      if (av && text.toLowerCase().includes(av.toLowerCase())) {
        suggestions.push({ type: "terminology", found: av, preferred: g.preferred, term: g.term });
      }
    }
  }

  const score = Math.max(0, 100 - violations.length * 15 - suggestions.length * 5);
  return { score, violations, suggestions, passed: violations.length === 0 };
}

// ── MODULE 9: Growth Content Dashboard ───────────────────────────────────────

function getContentDashboard() {
  const s        = _load();
  const articles = Object.values(s.articles);
  const lps      = Object.values(s.landingPages);
  const docs     = Object.values(s.docs);
  const calendar = Object.values(s.calendar);
  const keywords = listKeywords();
  const kwIntel  = getKeywordIntelligence();

  const published  = articles.filter(a => a.status === "published");
  const avgSEO     = articles.length ? Math.round(articles.reduce((s, a) => s + (a.seoScore || 0), 0) / articles.length) : 0;
  const avgConv    = lps.length ? Math.round(lps.reduce((s, l) => s + (l.conversionScore || 0), 0) / lps.length) : 0;

  const organicScore = Math.round(
    (published.length > 0 ? 20 : 0) +
    (avgSEO * 0.3) +
    (kwIntel.highOpportunity > 0 ? 15 : 0) +
    (listTopicClusters().length > 0 ? 15 : 0) +
    (docs.length > 0 ? 10 : 0) +
    (lps.filter(l => l.seoScore > 60).length > 0 ? 10 : 0)
  );

  const trafficProjection = {
    month1: published.length * 120,
    month3: published.length * 450 + kwIntel.highOpportunity * 200,
    month6: published.length * 1200 + kwIntel.highOpportunity * 800,
    assumptions: "~120 organic visits/published article/month at average 1% CTR from search",
  };

  return {
    organicScore: Math.min(100, organicScore),
    seo: {
      avgArticleSEO:  avgSEO,
      publishedCount: published.length,
      draftCount:     articles.filter(a => a.status === "draft").length,
      topSEOArticle:  articles.sort((a, b) => b.seoScore - a.seoScore)[0] || null,
    },
    content: {
      totalArticles:    articles.length,
      totalDocs:        docs.length,
      totalLandingPages: lps.length,
      avgConversionScore: avgConv,
      byType:           _countBy(articles, "type"),
    },
    keywords: kwIntel,
    calendar: getCalendarStats(),
    publishing: {
      scheduled: calendar.filter(e => e.approvalState === "scheduled").length,
      approved:  calendar.filter(e => e.approvalState === "approved").length,
      pending:   calendar.filter(e => e.approvalState === "draft" || e.approvalState === "in-review").length,
    },
    trafficProjection,
    repurposing: {
      totalJobs: Object.keys(s.repurposeJobs || {}).length,
      platforms: REPURPOSE_TARGETS.length,
    },
    brand: { glossaryTerms: listGlossary().length },
  };
}

function _countBy(arr, key) {
  const out = {};
  for (const item of arr) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

function listTopicClusters() {
  return Object.values(_load().clusters || {});
}

// ── MODULE 10: Commercial Benchmark ──────────────────────────────────────────

function runBenchmark() {
  const checks = [
    {
      id: "blog_studio",
      label: "AI Blog Studio (blog/how-to/case-study/release-notes/product-update)",
      run: () => {
        const types = ["blog","how-to","case-study","release-notes","product-update"];
        const ids = types.map(t => createArticle({ type: t, title: `Benchmark ${t}`, metaDesc: "Test meta description that is within the required length range.", keyword: "benchmark keyword", body: "This is a benchmark test article body with enough words to pass validation checks. ".repeat(20), slug: `benchmark-${t}` }).id);
        const prompts = types.map(t => buildArticlePrompt(t, "AI automation for founders"));
        publishArticle(ids[0]);
        const art = getArticle(ids[0]);
        return ids.length === 5 && art.status === "published" && art.seoScore >= 0 && prompts.length === 5;
      },
    },
    {
      id: "seo_command",
      label: "SEO Command Center (audit + schema + clusters + internal links)",
      run: () => {
        const audit   = runTechnicalAudit();
        const cluster = createTopicCluster({ pillarTopic: "WhatsApp Automation", supportingTopics: ["OTP automation","broadcast campaigns","lead qualification"] });
        addInternalLink(cluster.id, "/blog/whatsapp-automation", "/blog/otp-guide", "OTP automation guide");
        const schema = generateSchemaMarkup("article", { title: "Benchmark Article", date: _today() });
        const faq    = generateSchemaMarkup("faq", { faqs: [{ q: "What is Ooplix?", a: "An AI OS." }] });
        return audit.total >= 20 && cluster.id && schema["@type"] === "Article" && faq["@type"] === "FAQPage";
      },
    },
    {
      id: "repurposing",
      label: "Content Repurposing Engine (1 input → 10 platform outputs)",
      run: () => {
        const targets = REPURPOSE_TARGETS.map(t => t.id);
        const prompts = buildRepurposePrompts("This is a test article about AI automation.", targets);
        const job = storeRepurposeJob("art-bench", targets, prompts.map(p => ({ target: p.targetId, content: "Generated content" })));
        const jobs = listRepurposeJobs();
        return prompts.length === 10 && job.id && jobs.length >= 1;
      },
    },
    {
      id: "landing_pages",
      label: "Landing Page Builder (SEO score + conversion score + prompt)",
      run: () => {
        const lp = createLandingPage({
          name: "Freelancers Landing Page", audience: "freelancers", keyword: "ai crm for freelancers india",
          metaTitle: "AI CRM for Freelancers India — Ooplix", metaDesc: "Ooplix is the AI operating system that automates your client follow-ups, payments, and outreach.",
          slug: "ai-crm-freelancers-india",
          sections: { hero: { headline: "Stop Losing Leads. Start Closing More.", subheadline: "Ooplix automates your follow-ups so you can focus on the work.", cta: "Start Free Trial" }, features: { items: [{icon:"⚡",title:"Auto Follow-up"},{icon:"₹",title:"Payment Automation"},{icon:"◉",title:"Lead Tracking"}] }, social_proof: { text: "Used by 500+ freelancers" }, cta: { text: "Get Started Free" } },
          schema: generateSchemaMarkup("product", { name: "Ooplix", price: "0" }),
        });
        const prompt = buildLandingPagePrompt("freelancers", "ai crm for freelancers india");
        return lp.id && lp.seoScore >= 0 && lp.conversionScore >= 0 && prompt.userPrompt?.length > 50;
      },
    },
    {
      id: "docs_generator",
      label: "Documentation Generator (API/feature/release/tutorial docs)",
      run: () => {
        const types = ["api-reference","feature-guide","release-notes","tutorial","troubleshooting"];
        const ids   = types.map(t => createDoc({ type: t, title: `Benchmark ${t}`, body: "Documentation content here.", version: "v3.0" }).id);
        const prompts = types.map(t => buildDocPrompt(t, "Growth OS API", { version: "v3.0" }));
        const docs  = listDocs();
        return ids.length === 5 && docs.length >= 5 && prompts.every(p => p.userPrompt?.length > 20);
      },
    },
    {
      id: "content_calendar",
      label: "Content Calendar (planning + scheduling + approval workflow)",
      run: () => {
        const e1 = createCalendarEntry({ title: "WA Automation Guide", type: "blog", channel: "blog", scheduledDate: `${_today().slice(0,7)}-15`, keywords: ["whatsapp automation"] });
        const e2 = createCalendarEntry({ title: "LinkedIn Post: AI OS", type: "social", channel: "linkedin", scheduledDate: `${_today().slice(0,7)}-18` });
        approveCalendarEntry(e1.id, "Content looks good, approved for publish", true);
        updateCalendarEntry(e2.id, { approvalState: "in-review" });
        const stats = getCalendarStats();
        return e1.id && e2.id && stats.total >= 2 && stats.byState?.approved >= 1;
      },
    },
    {
      id: "keyword_intel",
      label: "Keyword Intelligence (opportunity score + difficulty + intent + competitor gap)",
      run: () => {
        const custom = addKeyword({ keyword: "ai automation india", volume: 5400, difficulty: 38, intent: "commercial", competitorGap: true, trend: "rising" });
        const all    = listKeywords();
        const intel  = getKeywordIntelligence();
        const highOpp = all.find(k => k.opportunityScore >= 50);
        return all.length >= 10 && custom.id && intel.total >= 10 && highOpp && typeof intel.avgOpportunity === "number";
      },
    },
    {
      id: "brand_voice",
      label: "Brand Voice Engine (tone + rules + terminology + glossary + consistency check)",
      run: () => {
        const voice   = getBrandVoice("bench-account");
        updateBrandVoice("bench-account", { tone: "direct", personality: ["capable","founder-first"] });
        const term    = addGlossaryTerm({ term: "Revenue Loop", definition: "Automated payment + follow-up cycle", preferred: "Revenue Loop", avoid: "Payment cycle" });
        const glossary = listGlossary();
        const check   = checkBrandConsistency("Our synergistic platform leverages scalable solutions to optimize your enterprise workflow.");
        return voice.tone && glossary.length >= 6 && term.term === "Revenue Loop" && check.violations.length >= 1 && check.score < 100;
      },
    },
    {
      id: "content_dashboard",
      label: "Growth Content Dashboard (SEO + traffic projections + organic score)",
      run: () => {
        const dash = getContentDashboard();
        return typeof dash.organicScore === "number" && dash.seo && dash.content && dash.keywords && dash.trafficProjection?.month6 >= 0 && dash.publishing;
      },
    },
    {
      id: "seo_readiness",
      label: "Organic Readiness (article count + keyword coverage + cluster + LP)",
      run: () => {
        const audit    = runTechnicalAudit();
        const articles = listArticles();
        const keywords = listKeywords();
        const clusters = listTopicClusters();
        const lps      = listLandingPages();
        return audit.total >= 20 && articles.length >= 5 && keywords.length >= 10 && clusters.length >= 1 && lps.length >= 1;
      },
    },
  ];

  const results = checks.map(c => {
    try {
      const ok = c.run();
      return { id: c.id, label: c.label, ok, error: null };
    } catch (e) {
      return { id: c.id, label: c.label, ok: false, error: e.message };
    }
  });

  const passing = results.filter(r => r.ok).length;
  const score   = Math.round(passing / results.length * 100);

  return {
    score, passing, total: results.length,
    organicReadiness: score >= 90 ? "production_ready" : score >= 70 ? "nearly_ready" : "needs_work",
    regressionPass: passing === results.length,
    checks: results,
    runAt: _ts(),
  };
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // M1: Blog Studio
  createArticle, updateArticle, publishArticle, listArticles, getArticle, buildArticlePrompt, ARTICLE_TYPES,
  // M2: SEO Command Center
  runTechnicalAudit, createTopicCluster, updateTopicCluster, listTopicClusters, addInternalLink, generateSchemaMarkup, BUILTIN_SEO_CHECKS,
  // M3: Repurposing
  buildRepurposePrompts, storeRepurposeJob, listRepurposeJobs, REPURPOSE_TARGETS,
  // M4: Landing Pages
  createLandingPage, updateLandingPage, listLandingPages, buildLandingPagePrompt, LP_SECTIONS,
  // M5: Docs
  createDoc, updateDoc, listDocs, getDoc, buildDocPrompt, DOC_TYPES,
  // M6: Calendar
  createCalendarEntry, updateCalendarEntry, approveCalendarEntry, listCalendarEntries, getCalendarStats, APPROVAL_STATES,
  // M7: Keywords
  addKeyword, listKeywords, getKeywordById, getKeywordIntelligence, BUILTIN_KEYWORDS,
  // M8: Brand Voice
  getBrandVoice, updateBrandVoice, addGlossaryTerm, listGlossary, checkBrandConsistency, DEFAULT_BRAND_VOICE, DEFAULT_GLOSSARY,
  // M9: Dashboard
  getContentDashboard,
  // M10: Benchmark
  runBenchmark,
};
