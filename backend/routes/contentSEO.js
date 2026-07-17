"use strict";
/**
 * Growth Operating System — G2
 * Content & SEO Engine
 * All routes under /content/*
 *
 * 10 modules: Blog Studio, SEO Command Center, Repurposing Engine,
 *             Landing Page Builder, Docs Generator, Content Calendar,
 *             Keyword Intelligence, Brand Voice Engine, Dashboard, Benchmark
 */

const router          = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const g               = require("../services/contentSEOEngine.cjs");

router.use("/content", requireAuth);

function _ok(res, data)            { res.json({ ok: true, ...data }); }
function _err(res, e, code = 500)  { res.status(code).json({ error: e.message || e }); }

// ══════════════════════════════════════════════════════════════════
// MODULE 1: AI Blog Studio
// ══════════════════════════════════════════════════════════════════

router.get("/content/articles",                   (req, res) => {
  try { _ok(res, { articles: g.listArticles(req.query.type, req.query.status), types: g.ARTICLE_TYPES }); }
  catch (e) { _err(res, e); }
});

router.post("/content/articles",                  (req, res) => {
  try { _ok(res, { article: g.createArticle(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/content/articles/prompt",            (req, res) => {
  try {
    const { type, topic, keyword, audience, brandVoice } = req.query;
    if (!type || !topic) return res.status(400).json({ error: "type and topic required" });
    _ok(res, { prompt: g.buildArticlePrompt(type, topic, { keyword, audience, brandVoice }) });
  } catch (e) { _err(res, e); }
});

router.get("/content/articles/:id",               (req, res) => {
  try {
    const a = g.getArticle(req.params.id);
    if (!a) return res.status(404).json({ error: "Article not found" });
    _ok(res, { article: a });
  } catch (e) { _err(res, e); }
});

router.patch("/content/articles/:id",             (req, res) => {
  try { _ok(res, { article: g.updateArticle(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/content/articles/:id/publish",      (req, res) => {
  try { _ok(res, { article: g.publishArticle(req.params.id) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 2: SEO Command Center
// ══════════════════════════════════════════════════════════════════

router.get("/content/seo/audit",                  (req, res) => {
  try { _ok(res, { audit: g.runTechnicalAudit(req.query) }); }
  catch (e) { _err(res, e); }
});

router.get("/content/seo/checks",                 (req, res) => {
  try { _ok(res, { checks: g.BUILTIN_SEO_CHECKS }); }
  catch (e) { _err(res, e); }
});

router.get("/content/seo/clusters",               (req, res) => {
  try { _ok(res, { clusters: g.listTopicClusters() }); }
  catch (e) { _err(res, e); }
});

router.post("/content/seo/clusters",              (req, res) => {
  try { _ok(res, { cluster: g.createTopicCluster(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/content/seo/clusters/:id",         (req, res) => {
  try { _ok(res, { cluster: g.updateTopicCluster(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/content/seo/clusters/:id/link",     (req, res) => {
  try {
    const { from, to, anchorText } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: "from and to required" });
    _ok(res, { cluster: g.addInternalLink(req.params.id, from, to, anchorText || "") });
  } catch (e) { _err(res, e); }
});

router.get("/content/seo/schema",                 (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.status(400).json({ error: "type required" });
    const data = req.query;
    _ok(res, { schema: g.generateSchemaMarkup(type, data), types: ["article","howto","faq","product","breadcrumb"] });
  } catch (e) { _err(res, e); }
});

router.post("/content/seo/schema",                (req, res) => {
  try {
    const { type, data } = req.body || {};
    if (!type) return res.status(400).json({ error: "type required" });
    _ok(res, { schema: g.generateSchemaMarkup(type, data || {}), types: ["article","howto","faq","product","breadcrumb"] });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 3: Content Repurposing Engine
// ══════════════════════════════════════════════════════════════════

router.get("/content/repurpose/targets",          (req, res) => {
  try { _ok(res, { targets: g.REPURPOSE_TARGETS }); }
  catch (e) { _err(res, e); }
});

router.post("/content/repurpose",                 (req, res) => {
  try {
    const { content, targets, brandVoice, videoDuration } = req.body || {};
    if (!content) return res.status(400).json({ error: "content required" });
    const targetIds = targets || g.REPURPOSE_TARGETS.map(t => t.id);
    const prompts   = g.buildRepurposePrompts(content, targetIds, { brandVoice, videoDuration });
    const job       = g.storeRepurposeJob(null, targetIds, prompts.map(p => ({ target: p.targetId, prompt: p.prompt })));
    _ok(res, { job, prompts, total: prompts.length });
  } catch (e) { _err(res, e); }
});

router.get("/content/repurpose/jobs",             (req, res) => {
  try { _ok(res, { jobs: g.listRepurposeJobs() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 4: Landing Page Builder
// ══════════════════════════════════════════════════════════════════

router.get("/content/landing-pages",              (req, res) => {
  try { _ok(res, { landingPages: g.listLandingPages(req.query.status), sections: g.LP_SECTIONS }); }
  catch (e) { _err(res, e); }
});

router.post("/content/landing-pages",             (req, res) => {
  try { _ok(res, { landingPage: g.createLandingPage(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/content/landing-pages/:id",        (req, res) => {
  try { _ok(res, { landingPage: g.updateLandingPage(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/content/landing-pages/prompt",       (req, res) => {
  try {
    const { audience, keyword, brandVoice } = req.query;
    if (!audience || !keyword) return res.status(400).json({ error: "audience and keyword required" });
    _ok(res, { prompt: g.buildLandingPagePrompt(audience, keyword, { brandVoice }) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 5: Documentation Generator
// ══════════════════════════════════════════════════════════════════

router.get("/content/docs",                       (req, res) => {
  try { _ok(res, { docs: g.listDocs(req.query.type, req.query.status), types: g.DOC_TYPES }); }
  catch (e) { _err(res, e); }
});

router.post("/content/docs",                      (req, res) => {
  try { _ok(res, { doc: g.createDoc(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/content/docs/prompt",                (req, res) => {
  try {
    const { type, subject, version } = req.query;
    if (!type || !subject) return res.status(400).json({ error: "type and subject required" });
    _ok(res, { prompt: g.buildDocPrompt(type, subject, { version }) });
  } catch (e) { _err(res, e); }
});

router.get("/content/docs/:id",                   (req, res) => {
  try {
    const d = g.getDoc(req.params.id);
    if (!d) return res.status(404).json({ error: "Doc not found" });
    _ok(res, { doc: d });
  } catch (e) { _err(res, e); }
});

router.patch("/content/docs/:id",                 (req, res) => {
  try { _ok(res, { doc: g.updateDoc(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 6: Content Calendar
// ══════════════════════════════════════════════════════════════════

router.get("/content/calendar",                   (req, res) => {
  try {
    const { month, channel, status } = req.query;
    _ok(res, { entries: g.listCalendarEntries(month, channel, status), stats: g.getCalendarStats(), approvalStates: g.APPROVAL_STATES });
  } catch (e) { _err(res, e); }
});

router.post("/content/calendar",                  (req, res) => {
  try { _ok(res, { entry: g.createCalendarEntry(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.patch("/content/calendar/:id",             (req, res) => {
  try { _ok(res, { entry: g.updateCalendarEntry(req.params.id, req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.post("/content/calendar/:id/approve",      (req, res) => {
  try {
    const { notes, approved } = req.body || {};
    _ok(res, { entry: g.approveCalendarEntry(req.params.id, notes || "", approved !== false) });
  } catch (e) { _err(res, e); }
});

router.post("/content/calendar/:id/reject",       (req, res) => {
  try {
    const { notes } = req.body || {};
    _ok(res, { entry: g.approveCalendarEntry(req.params.id, notes || "Rejected", false) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 7: Keyword Intelligence
// ══════════════════════════════════════════════════════════════════

router.get("/content/keywords",                   (req, res) => {
  try {
    const { intent, minOpportunity } = req.query;
    _ok(res, { keywords: g.listKeywords(intent, minOpportunity ? Number(minOpportunity) : null) });
  } catch (e) { _err(res, e); }
});

router.post("/content/keywords",                  (req, res) => {
  try { _ok(res, { keyword: g.addKeyword(req.body || {}) }); }
  catch (e) { _err(res, e); }
});

router.get("/content/keywords/intelligence",      (req, res) => {
  try { _ok(res, { intelligence: g.getKeywordIntelligence() }); }
  catch (e) { _err(res, e); }
});

router.get("/content/keywords/:id",               (req, res) => {
  try {
    const kw = g.getKeywordById(req.params.id);
    if (!kw) return res.status(404).json({ error: "Keyword not found" });
    _ok(res, { keyword: kw });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 8: Brand Voice Engine
// ══════════════════════════════════════════════════════════════════

router.get("/content/brand-voice",                (req, res) => {
  try {
    const accountId = req.query.accountId || req.user?.sub || req.user?.accountId || "global";
    _ok(res, { brandVoice: g.getBrandVoice(accountId) });
  } catch (e) { _err(res, e); }
});

router.patch("/content/brand-voice",              (req, res) => {
  try {
    const accountId = req.body?.accountId || req.user?.sub || req.user?.accountId || "global";
    _ok(res, { brandVoice: g.updateBrandVoice(accountId, req.body || {}) });
  } catch (e) { _err(res, e); }
});

router.get("/content/brand-voice/glossary",       (req, res) => {
  try { _ok(res, { glossary: g.listGlossary(), defaults: g.DEFAULT_GLOSSARY }); }
  catch (e) { _err(res, e); }
});

router.post("/content/brand-voice/glossary",      (req, res) => {
  try {
    const { term, definition, preferred, avoid } = req.body || {};
    if (!term || !definition) return res.status(400).json({ error: "term and definition required" });
    _ok(res, { entry: g.addGlossaryTerm({ term, definition, preferred, avoid }) });
  } catch (e) { _err(res, e); }
});

router.post("/content/brand-voice/check",         (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    _ok(res, { result: g.checkBrandConsistency(text) });
  } catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 9: Growth Content Dashboard
// ══════════════════════════════════════════════════════════════════

router.get("/content/dashboard",                  (req, res) => {
  try { _ok(res, { dashboard: g.getContentDashboard() }); }
  catch (e) { _err(res, e); }
});

// ══════════════════════════════════════════════════════════════════
// MODULE 10: Commercial Benchmark
// ══════════════════════════════════════════════════════════════════

router.get("/content/benchmark",                  (req, res) => {
  try { _ok(res, g.runBenchmark()); }
  catch (e) { _err(res, e); }
});

module.exports = router;
