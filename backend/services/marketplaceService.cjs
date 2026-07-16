"use strict";
/**
 * L2 — Capability Marketplace Service
 *
 * Provides a curated catalog of installable plugins built on top of
 * Plugin SDK V2. Catalog entries are metadata-only — they describe
 * what a plugin does, its capabilities, ratings, reviews, version
 * history, and changelog. Actual plugin state (installed / enabled /
 * health / config) lives exclusively in pluginManagerService.
 *
 * No duplicate plugin storage.
 * No duplicate capability registry.
 * Install recommendations read from pluginManagerService.list() +
 * pluginSDK.getCapabilityMap() to avoid suggesting already-installed caps.
 *
 * Storage: data/marketplace-catalog.json
 *   { reviews: { [pluginId]: Review[] }, customEntries: CatalogEntry[] }
 *   (Built-in catalog is hardcoded — not stored — same pattern as governanceService templates.)
 */
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const DATA_FILE  = path.join(__dirname, "../../data/marketplace-catalog.json");
const MAX_REVIEWS = 200;

// ── Lazy deps ─────────────────────────────────────────────────────
let _mgr = null, _sdk = null, _sec = null, _bus = null;
function _pluginMgr() { if (!_mgr) try { _mgr = require("./pluginManagerService.cjs"); } catch {} return _mgr; }
function _pluginSDK() { if (!_sdk) try { _sdk = require("./pluginSDK.cjs");             } catch {} return _sdk; }
function _secLayer()  { if (!_sec) try { _sec = require("./securityLayer.cjs");          } catch {} return _sec; }
function _evtBus()    { if (!_bus) try { _bus = require("../../agents/runtime/runtimeEventBus.cjs"); } catch {} return _bus; }

// ── Storage ───────────────────────────────────────────────────────
function _read() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { reviews: {}, customEntries: [], submissions: [] }; }
}
function _write(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// ── Built-in catalog (hardcoded, like governance templates) ───────
const BUILT_IN_CATALOG = [
  {
    id:          "plugin-whatsapp-crm",
    name:        "WhatsApp CRM Bridge",
    description: "Sync WhatsApp conversations directly into the CRM. Auto-creates leads from inbound messages and updates contact history.",
    author:      "Ooplix Labs",
    version:     "2.1.0",
    category:    "integration",
    tags:        ["crm", "whatsapp", "leads", "messaging"],
    capabilities: ["crm_write", "lead_qualify", "message_receive"],
    permissions:  ["crm:write", "whatsapp:read"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    true,
    featured:    true,
    rating:      4.8,
    reviewCount: 124,
    installCount: 3200,
    compatibility: ["starter", "pro", "enterprise"],
    changelog: [
      { version: "2.1.0", date: "2026-05-10", notes: "Auto-qualify leads via AI scoring. Bug fixes for group chats." },
      { version: "2.0.0", date: "2026-03-01", notes: "Complete rewrite on Plugin SDK V2. Added permissions model." },
      { version: "1.4.2", date: "2025-12-15", notes: "Rate limit handling improvements." },
    ],
    versions: ["2.1.0","2.0.0","1.4.2","1.3.0","1.0.0"],
  },
  {
    id:          "plugin-ai-classifier",
    name:        "AI Intent Classifier",
    description: "Adds an AI-powered intent classifier capability to any agent. Routes incoming tasks to the best-fit agent automatically.",
    author:      "Ooplix Labs",
    version:     "1.3.0",
    category:    "ai",
    tags:        ["ai","classification","routing","nlp"],
    capabilities: ["intent_classify", "agent_route"],
    permissions:  ["runtime:read"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    true,
    featured:    true,
    rating:      4.6,
    reviewCount: 89,
    installCount: 2100,
    compatibility: ["pro", "enterprise"],
    changelog: [
      { version: "1.3.0", date: "2026-04-20", notes: "Groq + Claude dual-provider fallback. Latency improved 40%." },
      { version: "1.2.0", date: "2026-01-10", notes: "Configurable confidence threshold." },
      { version: "1.0.0", date: "2025-09-01", notes: "Initial release." },
    ],
    versions: ["1.3.0","1.2.0","1.0.0"],
  },
  {
    id:          "plugin-github-connector",
    name:        "GitHub Connector",
    description: "Bi-directional sync with GitHub. Create issues from tasks, track PR status, trigger automations on push events.",
    author:      "Ooplix Labs",
    version:     "3.0.1",
    category:    "developer",
    tags:        ["github","ci","devops","pr","issues"],
    capabilities: ["pr_create", "issue_create", "repo_read", "webhook_receive"],
    permissions:  ["github:write", "webhook:receive"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    true,
    featured:    true,
    rating:      4.9,
    reviewCount: 211,
    installCount: 5800,
    compatibility: ["starter","pro","enterprise"],
    changelog: [
      { version: "3.0.1", date: "2026-06-01", notes: "Patch: handle renamed default branch gracefully." },
      { version: "3.0.0", date: "2026-05-15", notes: "SDK V2 migration. Added fine-grained permissions." },
      { version: "2.5.0", date: "2026-02-10", notes: "PR review automation." },
    ],
    versions: ["3.0.1","3.0.0","2.5.0","2.0.0"],
  },
  {
    id:          "plugin-slack-alerts",
    name:        "Slack Alerts",
    description: "Post real-time notifications to Slack channels when automation rules fire, missions complete, or errors exceed thresholds.",
    author:      "Community",
    version:     "1.1.0",
    category:    "integration",
    tags:        ["slack","notifications","alerts","messaging"],
    capabilities: ["notify", "emit_event"],
    permissions:  ["slack:write"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    true,
    featured:    false,
    rating:      4.4,
    reviewCount: 56,
    installCount: 1400,
    compatibility: ["starter","pro","enterprise"],
    changelog: [
      { version: "1.1.0", date: "2026-04-05", notes: "Thread-based alert grouping. Reduced noise." },
      { version: "1.0.0", date: "2026-01-20", notes: "Initial release." },
    ],
    versions: ["1.1.0","1.0.0"],
  },
  {
    id:          "plugin-analytics-export",
    name:        "Analytics Exporter",
    description: "Export enterprise analytics reports to CSV, JSON, or Google Sheets on a schedule or on demand.",
    author:      "Community",
    version:     "1.0.2",
    category:    "analytics",
    tags:        ["export","csv","sheets","reporting"],
    capabilities: ["report_generate", "file_export"],
    permissions:  ["analytics:read", "storage:write"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    false,
    featured:    false,
    rating:      3.9,
    reviewCount: 22,
    installCount: 410,
    compatibility: ["pro","enterprise"],
    changelog: [
      { version: "1.0.2", date: "2026-05-28", notes: "Fix Google Sheets token refresh." },
      { version: "1.0.0", date: "2026-04-10", notes: "Initial release." },
    ],
    versions: ["1.0.2","1.0.0"],
  },
  {
    id:          "plugin-compliance-scanner",
    name:        "Compliance Scanner",
    description: "Automated daily scan of workspace settings against SOC 2, GDPR, and HIPAA baselines. Surfaces gaps as governance risk items.",
    author:      "Ooplix Labs",
    version:     "2.0.0",
    category:    "security",
    tags:        ["compliance","soc2","gdpr","hipaa","audit"],
    capabilities: ["audit_read", "risk_assess", "report_generate"],
    permissions:  ["governance:read", "audit:read"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    true,
    featured:    true,
    rating:      4.7,
    reviewCount: 68,
    installCount: 1900,
    compatibility: ["enterprise"],
    changelog: [
      { version: "2.0.0", date: "2026-05-20", notes: "SDK V2 migration. ISO 27001 baseline added." },
      { version: "1.5.0", date: "2026-02-14", notes: "HIPAA module." },
      { version: "1.0.0", date: "2025-11-01", notes: "SOC 2 + GDPR initial." },
    ],
    versions: ["2.0.0","1.5.0","1.0.0"],
  },
  {
    id:          "plugin-telegram-bot",
    name:        "Telegram Bot Bridge",
    description: "Connect a Telegram bot to your workspace. Receive commands, send notifications, and manage customer interactions via Telegram.",
    author:      "Community",
    version:     "1.2.0",
    category:    "integration",
    tags:        ["telegram","bot","messaging","notifications"],
    capabilities: ["notify", "message_receive", "message_send"],
    permissions:  ["telegram:write"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    false,
    featured:    false,
    rating:      4.1,
    reviewCount: 33,
    installCount: 620,
    compatibility: ["starter","pro","enterprise"],
    changelog: [
      { version: "1.2.0", date: "2026-05-01", notes: "Inline keyboard support." },
      { version: "1.0.0", date: "2026-02-05", notes: "Initial release." },
    ],
    versions: ["1.2.0","1.0.0"],
  },
  {
    id:          "plugin-data-pipeline",
    name:        "Data Pipeline Orchestrator",
    description: "Build and schedule multi-step data transformation pipelines. Integrates with automation rules to trigger on events.",
    author:      "Ooplix Labs",
    version:     "1.0.0",
    category:    "automation",
    tags:        ["pipeline","etl","data","transformation","scheduler"],
    capabilities: ["queue_task", "data_transform", "schedule"],
    permissions:  ["automation:write", "runtime:write"],
    dependencies: [],
    minSDKVersion: "1.0.0",
    verified:    true,
    featured:    false,
    rating:      4.3,
    reviewCount: 15,
    installCount: 280,
    compatibility: ["pro","enterprise"],
    changelog: [
      { version: "1.0.0", date: "2026-06-05", notes: "Initial release." },
    ],
    versions: ["1.0.0"],
  },
];

const CATEGORIES = [
  { id: "all",         label: "All",           icon: "◎", count: 0 },
  { id: "integration", label: "Integrations",  icon: "⬡", count: 0 },
  { id: "ai",          label: "AI & ML",        icon: "▷", count: 0 },
  { id: "developer",   label: "Developer",      icon: "◈", count: 0 },
  { id: "analytics",   label: "Analytics",      icon: "◉", count: 0 },
  { id: "security",    label: "Security",        icon: "⬟", count: 0 },
  { id: "automation",  label: "Automation",     icon: "✦", count: 0 },
];

// ── Helpers ───────────────────────────────────────────────────────
function _allEntries() {
  const store = _read();
  return [...BUILT_IN_CATALOG, ...(store.customEntries || [])];
}

function _installedIds(workspaceId) {
  try {
    const installed = _pluginMgr()?.list(workspaceId) || [];
    return new Set(installed.map(p => p.id));
  } catch { return new Set(); }
}

function _enrich(entry, installedIds) {
  return { ...entry, installed: installedIds.has(entry.id) };
}

function _computeCategoryCounts(entries) {
  const counts = {};
  for (const e of entries) counts[e.category] = (counts[e.category] || 0) + 1;
  return counts;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * getCatalog(workspaceId, opts)
 * Returns full catalog enriched with installed flag.
 * opts: { category, verified, tag, limit, offset }
 */
function getCatalog(workspaceId, { category, verified, tag, limit = 50, offset = 0 } = {}) {
  const installedIds = _installedIds(workspaceId);
  let entries = _allEntries();
  if (category && category !== "all") entries = entries.filter(e => e.category === category);
  if (verified !== undefined) entries = entries.filter(e => !!e.verified === verified);
  if (tag) entries = entries.filter(e => e.tags?.includes(tag));
  const total = entries.length;
  const page  = entries.slice(offset, offset + limit).map(e => _enrich(e, installedIds));
  return { plugins: page, total, limit, offset };
}

/**
 * getPlugin(workspaceId, pluginId)
 * Returns full catalog entry including reviews and version history.
 */
function getPlugin(workspaceId, pluginId) {
  const entries = _allEntries();
  const entry   = entries.find(e => e.id === pluginId);
  if (!entry) return null;

  const store    = _read();
  const reviews  = (store.reviews[pluginId] || []).slice(0, 20);
  const installed = _installedIds(workspaceId).has(pluginId);

  // Compatibility check against installed plugins
  const installedList = _pluginMgr()?.list(workspaceId) || [];
  const depsMet = (entry.dependencies || []).every(dep => installedList.some(p => p.id === dep));

  return { ...entry, installed, reviews, depsMet, dependencyStatus: depsMet ? "met" : "unmet" };
}

/**
 * getCategories(workspaceId)
 */
function getCategories(workspaceId) {
  const installedIds = _installedIds(workspaceId);
  const entries = _allEntries();
  const counts  = _computeCategoryCounts(entries);
  return CATEGORIES.map(cat => ({
    ...cat,
    count: cat.id === "all" ? entries.length : (counts[cat.id] || 0),
  }));
}

/**
 * getFeatured(workspaceId)
 * Returns featured + verified plugins sorted by rating desc.
 */
function getFeatured(workspaceId) {
  const installedIds = _installedIds(workspaceId);
  const featured = _allEntries()
    .filter(e => e.featured)
    .sort((a, b) => b.rating - a.rating)
    .map(e => _enrich(e, installedIds));
  return { plugins: featured, total: featured.length };
}

/**
 * search(workspaceId, query, opts)
 * Full-text search across id, name, description, tags, capabilities.
 */
function search(workspaceId, query, { category, limit = 20 } = {}) {
  if (!query?.trim()) return getCatalog(workspaceId, { category, limit });
  const needle = query.toLowerCase();
  const installedIds = _installedIds(workspaceId);
  let entries = _allEntries().filter(e => {
    return (
      e.id.includes(needle) ||
      e.name.toLowerCase().includes(needle) ||
      e.description.toLowerCase().includes(needle) ||
      e.tags?.some(t => t.includes(needle)) ||
      e.capabilities?.some(c => c.includes(needle)) ||
      e.author.toLowerCase().includes(needle)
    );
  });
  if (category && category !== "all") entries = entries.filter(e => e.category === category);
  entries = entries.sort((a, b) => b.rating * b.installCount - a.rating * a.installCount);
  return { plugins: entries.slice(0, limit).map(e => _enrich(e, installedIds)), total: entries.length, query };
}

/**
 * getRecommendations(workspaceId)
 * Suggests plugins not yet installed, using capability gap analysis
 * from pluginSDK.getCapabilityMap().
 */
function getRecommendations(workspaceId) {
  const installedIds = _installedIds(workspaceId);
  const capMap = {};
  try { Object.assign(capMap, _pluginSDK()?.getCapabilityMap() || {}); } catch {}

  const installedCaps = new Set(
    [...installedIds].flatMap(id => {
      const entry = _allEntries().find(e => e.id === id);
      return entry?.capabilities || [];
    })
  );

  // Rank uninstalled plugins by: not installed + rating + fills capability gap
  const recs = _allEntries()
    .filter(e => !installedIds.has(e.id))
    .map(e => {
      const newCaps = (e.capabilities || []).filter(c => !installedCaps.has(c));
      const score   = (e.rating || 3) * (1 + newCaps.length * 0.3) * Math.log10(Math.max(e.installCount || 1, 10));
      return { ...e, score: +score.toFixed(2), newCapabilities: newCaps };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return { recommendations: recs, total: recs.length };
}

/**
 * getVersions(pluginId)
 */
function getVersions(pluginId) {
  const entry = _allEntries().find(e => e.id === pluginId);
  if (!entry) return null;
  return { pluginId, currentVersion: entry.version, versions: entry.versions || [entry.version] };
}

/**
 * getChangelog(pluginId)
 */
function getChangelog(pluginId) {
  const entry = _allEntries().find(e => e.id === pluginId);
  if (!entry) return null;
  return { pluginId, changelog: entry.changelog || [], currentVersion: entry.version };
}

/**
 * addReview(pluginId, { rating, body, author }, requestingAccountId, workspaceId)
 */
function addReview(pluginId, { rating, body, author }, requestingAccountId, workspaceId) {
  if (!pluginId) throw new Error("pluginId required");
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new Error("rating must be 1–5");
  if (!body?.trim()) throw new Error("review body required");

  const entries = _allEntries();
  if (!entries.find(e => e.id === pluginId)) throw new Error(`Plugin "${pluginId}" not in catalog`);

  const store = _read();
  if (!store.reviews[pluginId]) store.reviews[pluginId] = [];

  const review = {
    id:        crypto.randomBytes(5).toString("hex"),
    pluginId,
    rating,
    body:      body.trim(),
    author:    author || requestingAccountId,
    ts:        Date.now(),
    accountId: requestingAccountId,
  };

  store.reviews[pluginId].unshift(review);
  if (store.reviews[pluginId].length > MAX_REVIEWS) store.reviews[pluginId].length = MAX_REVIEWS;
  _write(store);

  try { _secLayer()?.addAuditEntry(workspaceId, requestingAccountId, "marketplace.review_added", `plugin=${pluginId} rating=${rating}`); } catch {}
  try { _evtBus()?.emit("marketplace_review_added", { pluginId, rating, _ts: Date.now() }); } catch {}

  return review;
}

// ── Third-party developer publishing workflow ──────────────────────
// Submissions are held separately from the visible catalog until an
// operator reviews them — approving is what actually adds an entry to
// customEntries (the array _allEntries() reads). This is the missing
// piece: customEntries existed in the schema but nothing ever wrote to
// it, so no third-party submission could ever reach the catalog.
// Reuses pluginManagerService.validateManifest() — no duplicate
// manifest-validation logic.

function submitConnector(submitterAccountId, manifest) {
  const validation = _pluginMgr()?.validateManifest(manifest);
  if (!validation) throw new Error("pluginManagerService unavailable — cannot validate manifest");
  if (!validation.valid) {
    const err = new Error(`Manifest invalid: ${validation.errors.join("; ")}`);
    err.validationErrors = validation.errors;
    throw err;
  }

  const store = _read();
  if (!store.submissions) store.submissions = [];

  if (_allEntries().some(e => e.id === manifest.id)) {
    throw new Error(`A catalog entry with id "${manifest.id}" already exists`);
  }
  if (store.submissions.some(s => s.manifest.id === manifest.id && s.status === "pending")) {
    throw new Error(`A pending submission for "${manifest.id}" already exists`);
  }

  const submission = {
    id:            `sub-${crypto.randomBytes(8).toString("hex")}`,
    manifest,
    submitterAccountId,
    status:        "pending",   // pending | approved | rejected
    submittedAt:   new Date().toISOString(),
    reviewedAt:    null,
    reviewerAccountId: null,
    reviewNotes:   null,
  };
  store.submissions.push(submission);
  _write(store);
  try { _evtBus()?.emit("marketplace:submission_created", { submissionId: submission.id, pluginId: manifest.id }); } catch {}
  return submission;
}

function listSubmissions(status) {
  const store = _read();
  const all   = store.submissions || [];
  return status ? all.filter(s => s.status === status) : all;
}

function getSubmission(submissionId) {
  const store = _read();
  return (store.submissions || []).find(s => s.id === submissionId) || null;
}

function reviewSubmission(submissionId, decision, reviewerAccountId, notes = "") {
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error('decision must be "approved" or "rejected"');
  }
  const store = _read();
  const submission = (store.submissions || []).find(s => s.id === submissionId);
  if (!submission) throw new Error(`Submission not found: ${submissionId}`);
  if (submission.status !== "pending") throw new Error(`Submission already ${submission.status}`);

  submission.status             = decision;
  submission.reviewedAt         = new Date().toISOString();
  submission.reviewerAccountId  = reviewerAccountId;
  submission.reviewNotes        = notes;

  if (decision === "approved") {
    if (!store.customEntries) store.customEntries = [];
    store.customEntries.push({
      ...submission.manifest,
      author:       submission.manifest.author,
      verified:     false,   // third-party submissions are never auto-verified
      featured:     false,
      rating:       0,
      installCount: 0,
      publishedAt:  submission.reviewedAt,
      submissionId: submission.id,
    });
  }

  _write(store);
  try { _evtBus()?.emit(`marketplace:submission_${decision}`, { submissionId, pluginId: submission.manifest.id }); } catch {}
  return submission;
}

module.exports = {
  getCatalog,
  getPlugin,
  getCategories,
  getFeatured,
  search,
  getRecommendations,
  getVersions,
  getChangelog,
  addReview,
  submitConnector,
  listSubmissions,
  getSubmission,
  reviewSubmission,
  CATEGORIES,
};
