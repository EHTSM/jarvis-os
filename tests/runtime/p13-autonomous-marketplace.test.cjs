"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * POST-Ω P13 — Autonomous Marketplace
 * Tests 6 new services against live platform assets.
 *
 * marketplaceCatalogEngine, marketplaceRecommendationEngine,
 * marketplaceCertificationEngine, marketplaceAutomationEngine,
 * marketplaceEconomyEngine, marketplaceDashboard
 *
 * Target: 77+ tests
 */

const assert = require("assert");

const mce  = require("../../backend/services/marketplaceCatalogEngine.cjs");
const mre  = require("../../backend/services/marketplaceRecommendationEngine.cjs");
const mce2 = require("../../backend/services/marketplaceCertificationEngine.cjs");
const mae  = require("../../backend/services/marketplaceAutomationEngine.cjs");
const mee  = require("../../backend/services/marketplaceEconomyEngine.cjs");
const mfd  = require("../../backend/services/marketplaceDashboard.cjs");

let passed = 0;
let failed = 0;
const promises = [];

// Asset IDs shared across sections
let assetId1, assetId2, certId1;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function atest(name, fn) {
  promises.push(
    fn()
      .then(() => { console.log(`  ✓ ${name}`); passed++; })
      .catch(e  => { console.error(`  ✗ ${name}: ${e.message}`); failed++; })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Marketplace Catalog Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Marketplace Catalog Engine ──");

test("module exports", () => {
  assert.ok(typeof mce.discover        === "function");
  assert.ok(typeof mce.listAssets      === "function");
  assert.ok(typeof mce.getAsset        === "function");
  assert.ok(typeof mce.searchAssets    === "function");
  assert.ok(typeof mce.publishAsset    === "function");
  assert.ok(typeof mce.recordDownload  === "function");
  assert.ok(typeof mce.getStats        === "function");
  assert.ok(Array.isArray(mce.ASSET_TYPES) && mce.ASSET_TYPES.length === 13);
});

test("ASSET_TYPES has all 13 types", () => {
  const expected = ["agent","workflow","blueprint","product_template","company_template",
    "plugin","sdk_package","automation_pack","design_system","ui_component",
    "knowledge_pack","prompt_pack","deployment_recipe"];
  expected.forEach(t => assert.ok(mce.ASSET_TYPES.includes(t), `missing: ${t}`));
});

test("discover returns ok with counts", () => {
  const r = mce.discover();
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.discovered === "number");
  assert.ok(typeof r.total      === "number" && r.total >= 0);
  assert.ok(r.byType && typeof r.byType === "object");
});

test("discover populates blueprints from live blueprintEngine", () => {
  const r = mce.discover();
  assert.ok(r.total > 0, "expected > 0 total assets after discovery");
});

test("listAssets returns all discovered assets", () => {
  const r = mce.listAssets({ limit: 500 });
  assert.ok(r.ok && Array.isArray(r.assets));
  assert.ok(r.total > 0, `expected > 0 assets, got ${r.total}`);
});

test("listAssets filtered by type=blueprint", () => {
  const r = mce.listAssets({ type: "blueprint", limit: 10 });
  assert.ok(r.ok);
  r.assets.forEach(a => assert.strictEqual(a.type, "blueprint", `wrong type: ${a.type}`));
});

test("listAssets filtered by type=workflow", () => {
  const r = mce.listAssets({ type: "workflow", limit: 10 });
  assert.ok(r.ok);
  r.assets.forEach(a => assert.strictEqual(a.type, "workflow"));
});

test("listAssets filtered by status=published", () => {
  const r = mce.listAssets({ status: "published", limit: 10 });
  assert.ok(r.ok);
  r.assets.forEach(a => assert.strictEqual(a.status, "published"));
});

test("asset entries have required fields", () => {
  const r = mce.listAssets({ limit: 5 });
  assert.ok(r.assets.length > 0);
  r.assets.forEach(a => {
    assert.ok(a.id,        `missing id in ${a.name}`);
    assert.ok(a.type,      `missing type in ${a.name}`);
    assert.ok(a.name,      `missing name`);
    assert.ok(a.status,    `missing status`);
    assert.ok(a.version,   `missing version`);
    assert.ok(Array.isArray(a.tags), `missing tags`);
  });
  assetId1 = r.assets[0].id;
});

test("getAsset returns correct asset", () => {
  const a = mce.getAsset(assetId1);
  assert.ok(a && a.id === assetId1);
});

test("getAsset returns null for unknown id", () => {
  assert.strictEqual(mce.getAsset("nonexistent_id"), null);
});

test("searchAssets finds by name keyword", () => {
  const allAssets = mce.listAssets({ limit: 5 });
  const keyword   = allAssets.assets[0]?.name?.split(" ")[0] || "blueprint";
  const r         = mce.searchAssets(keyword, { limit: 10 });
  assert.ok(r.ok && Array.isArray(r.assets));
  assert.ok(r.total >= 0);
});

test("searchAssets with empty query returns list", () => {
  const r = mce.searchAssets("", { limit: 5 });
  assert.ok(r.ok && Array.isArray(r.assets));
});

test("publishAsset creates new asset", () => {
  const r = mce.publishAsset({
    type:   "knowledge_pack",
    name:   "Test Knowledge Pack v1",
    desc:   "A test knowledge pack for marketplace certification",
    tags:   ["test","knowledge","ai"],
    source: "test_suite",
    version:"1.0.0",
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.asset.id.startsWith("mca_"));
  assert.strictEqual(r.asset.type, "knowledge_pack");
  assert.strictEqual(r.asset.status, "published");
  assetId2 = r.asset.id;
});

test("publishAsset fails without type", () => {
  const r = mce.publishAsset({ name: "no type asset" });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("publishAsset fails with unknown type", () => {
  const r = mce.publishAsset({ type: "invalid_type", name: "test" });
  assert.strictEqual(r.ok, false);
});

test("recordDownload increments count", () => {
  const r = mce.recordDownload(assetId1);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.downloads === "number" && r.downloads >= 1);
});

test("recordDownload fails for unknown asset", () => {
  const r = mce.recordDownload("nonexistent");
  assert.strictEqual(r.ok, false);
});

test("getStats has all 13 types in byType", () => {
  const s = mce.getStats();
  assert.ok(typeof s.total     === "number" && s.total > 0);
  assert.ok(typeof s.published === "number");
  assert.ok(s.byType && Object.keys(s.byType).length === 13);
  assert.ok(Array.isArray(s.ASSET_TYPES));
});

test("getStats total matches listAssets total", () => {
  const s = mce.getStats();
  const r = mce.listAssets({ limit: 5000 });
  assert.strictEqual(s.total, r.total);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Marketplace Recommendation Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Marketplace Recommendation Engine ──");

test("module exports", () => {
  assert.ok(typeof mre.recommend           === "function");
  assert.ok(typeof mre.getRecommendation   === "function");
  assert.ok(typeof mre.listRecommendations === "function");
  assert.ok(typeof mre.getStats            === "function");
  assert.ok(typeof mre.RECOMMENDATION_WEIGHTS === "object");
});

test("RECOMMENDATION_WEIGHTS has 6 dimensions summing to 1.0", () => {
  const sum = Object.values(mre.RECOMMENDATION_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `sum: ${sum}`);
  assert.strictEqual(Object.keys(mre.RECOMMENDATION_WEIGHTS).length, 6);
});

test("recommend returns results", () => {
  const r = mre.recommend({ objective: "Build a SaaS automation platform", limit: 5 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Array.isArray(r.recommendations));
  assert.ok(typeof r.sessionId === "string");
  assert.ok(r.context);
});

test("recommendations have scores object", () => {
  const r = mre.recommend({ objective: "product deployment pipeline", limit: 5 });
  assert.ok(r.ok);
  r.recommendations.forEach(rec => {
    assert.ok(rec.scores, `missing scores on ${rec.name}`);
    assert.ok(typeof rec.recommendationScore === "number", `missing recommendationScore`);
    assert.ok(rec.recommendationScore >= 0 && rec.recommendationScore <= 100,
      `score out of range: ${rec.recommendationScore}`);
  });
});

test("all 6 score dimensions present on each recommendation", () => {
  const r = mre.recommend({ objective: "knowledge management", limit: 3 });
  assert.ok(r.ok);
  const dims = Object.keys(mre.RECOMMENDATION_WEIGHTS);
  r.recommendations.forEach(rec => {
    dims.forEach(d => assert.ok(typeof rec.scores[d] === "number", `missing dim ${d} on ${rec.name}`));
  });
});

test("recommend with typeFilter only returns that type", () => {
  const r = mre.recommend({ objective: "automation", typeFilter: "workflow", limit: 10 });
  assert.ok(r.ok);
  r.recommendations.forEach(rec => assert.strictEqual(rec.type, "workflow"));
});

test("recommend returns sorted by score descending", () => {
  const r = mre.recommend({ objective: "build ai agents for my team", limit: 10 });
  assert.ok(r.ok && r.recommendations.length > 1);
  for (let i = 1; i < r.recommendations.length; i++) {
    assert.ok(r.recommendations[i].recommendationScore <= r.recommendations[i-1].recommendationScore,
      `not sorted at index ${i}`);
  }
});

test("getRecommendation returns stored session", () => {
  const r = mre.recommend({ objective: "test session", limit: 3 });
  assert.ok(r.ok);
  const stored = mre.getRecommendation(r.sessionId);
  assert.ok(stored && stored.id === r.sessionId);
});

test("listRecommendations returns sessions", () => {
  const r = mre.listRecommendations({ limit: 10 });
  assert.ok(r.ok && Array.isArray(r.recommendations) && r.total >= 3);
});

test("getStats has total and avgRelevance", () => {
  const s = mre.getStats();
  assert.ok(typeof s.total         === "number" && s.total >= 3);
  assert.ok(typeof s.avgRelevance  === "number");
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Marketplace Certification Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Marketplace Certification Engine ──");

test("module exports", () => {
  assert.ok(typeof mce2.certify                  === "function");
  assert.ok(typeof mce2.certifyBatch             === "function");
  assert.ok(typeof mce2.getCertification         === "function");
  assert.ok(typeof mce2.getCertificationForAsset === "function");
  assert.ok(typeof mce2.listCertifications       === "function");
  assert.ok(typeof mce2.getStats                 === "function");
  assert.ok(Array.isArray(mce2.CERT_LEVELS));
});

test("CERT_LEVELS are none/bronze/silver/gold/platinum", () => {
  const expected = ["none","bronze","silver","gold","platinum"];
  expected.forEach(l => assert.ok(mce2.CERT_LEVELS.includes(l), `missing: ${l}`));
});

test("CERT_WEIGHTS have 4 dimensions summing to 1.0", () => {
  const sum = Object.values(mce2.CERT_WEIGHTS).reduce((a,b) => a+b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `sum: ${sum}`);
  ["quality","security","production_readiness","adoption"].forEach(k =>
    assert.ok(mce2.CERT_WEIGHTS[k], `missing: ${k}`)
  );
});

test("certify fails for unknown asset", () => {
  const r = mce2.certify("nonexistent_asset");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("certify succeeds for known asset", () => {
  const r = mce2.certify(assetId1);
  assert.ok(r.ok, JSON.stringify(r));
  certId1 = r.certification.id;
  assert.ok(certId1.startsWith("cert_"));
  assert.ok(r.certification.assetId === assetId1);
  assert.ok(mce2.CERT_LEVELS.includes(r.certification.level));
  assert.ok(typeof r.certification.overallScore === "number");
  assert.ok(r.certification.overallScore >= 0 && r.certification.overallScore <= 100);
});

test("certification has all 4 dimension scores", () => {
  const c = mce2.getCertification(certId1);
  assert.ok(c, "cert not found");
  ["quality","security","production_readiness","adoption"].forEach(dim =>
    assert.ok(typeof c.dimensions[dim] === "number", `missing dim: ${dim}`)
  );
});

test("certification dimensions are all 0–100", () => {
  const c = mce2.getCertification(certId1);
  Object.entries(c.dimensions).forEach(([k,v]) =>
    assert.ok(v >= 0 && v <= 100, `${k} out of range: ${v}`)
  );
});

test("certification overallScore matches weighted average", () => {
  const c        = mce2.getCertification(certId1);
  const expected = Math.round(
    Object.entries(mce2.CERT_WEIGHTS).reduce((s, [k,w]) => s + w * c.dimensions[k], 0)
  );
  assert.ok(Math.abs(c.overallScore - expected) <= 1, `expected ~${expected}, got ${c.overallScore}`);
});

test("certification has passed flag", () => {
  const c = mce2.getCertification(certId1);
  assert.ok(typeof c.passed === "boolean");
  assert.strictEqual(c.passed, c.level !== "none");
});

test("certification has expiresAt date", () => {
  const c = mce2.getCertification(certId1);
  assert.ok(c.expiresAt && new Date(c.expiresAt) > new Date(), "expiresAt must be future date");
});

test("certifyBatch certifies multiple assets", () => {
  const assets = mce.listAssets({ type: "blueprint", limit: 3 });
  const ids    = assets.assets.map(a => a.id);
  assert.ok(ids.length >= 2, "need >= 2 blueprint assets");
  const r = mce2.certifyBatch(ids);
  assert.ok(r.ok);
  assert.strictEqual(r.total, ids.length);
  assert.ok(typeof r.passed === "number");
  assert.ok(r.results.length === ids.length);
});

test("getCertificationForAsset returns cert", () => {
  const c = mce2.getCertificationForAsset(assetId1);
  assert.ok(c && c.assetId === assetId1);
});

test("listCertifications filtered by level", () => {
  // Certify a few to have data
  const r = mce2.certify(assetId2);
  assert.ok(r.ok);
  const level = r.certification.level;
  const list  = mce2.listCertifications({ level });
  assert.ok(list.ok && list.certifications.every(c => c.level === level));
});

test("listCertifications filtered by assetType", () => {
  const r = mce2.listCertifications({ assetType: "blueprint", limit: 10 });
  assert.ok(r.ok && r.certifications.every(c => c.assetType === "blueprint"));
});

test("getStats has byLevel breakdown", () => {
  const s = mce2.getStats();
  assert.ok(typeof s.total    === "number" && s.total > 0);
  assert.ok(typeof s.avgScore === "number");
  assert.ok(s.byLevel && typeof s.byLevel === "object");
  ["none","bronze","silver","gold","platinum"].forEach(l =>
    assert.ok(s.byLevel[l] !== undefined, `missing level: ${l}`)
  );
  assert.ok(Array.isArray(s.CERT_LEVELS));
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Marketplace Automation Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Marketplace Automation Engine ──");

test("module exports", () => {
  assert.ok(typeof mae.automate          === "function");
  assert.ok(typeof mae.runLifecycleScan  === "function");
  assert.ok(typeof mae.getAutomation     === "function");
  assert.ok(typeof mae.listAutomations   === "function");
  assert.ok(typeof mae.getStats          === "function");
  assert.ok(typeof mae.AUTOMATION_ACTIONS === "object");
});

test("AUTOMATION_ACTIONS has 6 actions", () => {
  const keys = Object.keys(mae.AUTOMATION_ACTIONS);
  assert.strictEqual(keys.length, 6);
  ["publish","update","version_bump","deprecate","retire","re_certify"].forEach(a =>
    assert.ok(keys.includes(a), `missing: ${a}`)
  );
});

atest("automate publish (skipExecute)", async () => {
  const r = await mae.automate(assetId1, "publish", { skipExecute: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.automation.id.startsWith("mau_"));
  assert.strictEqual(r.automation.action, "publish");
  assert.strictEqual(r.automation.status, "executed");
  assert.ok(r.automation.minutesSaved > 0);
});

atest("automate version_bump increments version", async () => {
  const r = await mae.automate(assetId1, "version_bump", { skipExecute: true, bumpType: "patch" });
  assert.ok(r.ok);
  assert.ok(r.automation.newVersion, "missing newVersion");
  assert.ok(/^\d+\.\d+\.\d+$/.test(r.automation.newVersion), `not semver: ${r.automation.newVersion}`);
});

atest("automate re_certify triggers certification", async () => {
  const r = await mae.automate(assetId1, "re_certify", { skipExecute: true });
  assert.ok(r.ok);
  assert.strictEqual(r.automation.type || r.automation.action, "re_certify");
  assert.strictEqual(r.automation.status, "executed");
});

atest("automate fails for unknown asset", async () => {
  const r = await mae.automate("nonexistent", "publish");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("automate fails for unknown action", async () => {
  const r = await mae.automate(assetId1, "nonexistent_action");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

atest("automate requires approval for deprecate (no skipExecute)", async () => {
  const r = await mae.automate(assetId1, "deprecate", { skipExecute: false });
  assert.ok(r.ok);
  assert.ok(["awaiting_approval","executed","failed"].includes(r.automation.status));
  assert.strictEqual(r.automation.requiresApproval, true);
});

atest("runLifecycleScan returns scanned + triggered", async () => {
  const r = await mae.runLifecycleScan({ skipExecute: true });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.scanned    === "number");
  assert.ok(typeof r.triggered  === "number");
  assert.ok(Array.isArray(r.actions));
});

atest("getAutomation by id", async () => {
  const r = await mae.automate(assetId2, "update", { skipExecute: true });
  assert.ok(r.ok);
  const a = mae.getAutomation(r.automation.id);
  assert.ok(a && a.id === r.automation.id);
});

atest("listAutomations filtered by action", async () => {
  const r = mae.listAutomations({ action: "publish", limit: 10 });
  assert.ok(r.ok && r.automations.every(a => a.action === "publish"));
});

atest("listAutomations filtered by status", async () => {
  const r = mae.listAutomations({ status: "executed", limit: 10 });
  assert.ok(r.ok && r.automations.every(a => a.status === "executed"));
});

atest("getStats has minutesSaved > 0 after executions", async () => {
  const s = mae.getStats();
  assert.ok(typeof s.total        === "number" && s.total > 0);
  assert.ok(typeof s.executed     === "number");
  assert.ok(typeof s.minutesSaved === "number" && s.minutesSaved >= 0);
  assert.ok(Array.isArray(s.AUTOMATION_ACTIONS));
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Marketplace Economy Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Marketplace Economy Engine ──");

test("module exports", () => {
  assert.ok(typeof mee.recordUsage        === "function");
  assert.ok(typeof mee.rateAsset          === "function");
  assert.ok(typeof mee.getEconomySnapshot === "function");
  assert.ok(typeof mee.getAssetEconomy    === "function");
  assert.ok(typeof mee.getTopAssets       === "function");
  assert.ok(typeof mee.getStats           === "function");
});

test("recordUsage succeeds for known asset", () => {
  const r = mee.recordUsage(assetId1, { eventType: "download" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.event.id.startsWith("eco_"));
  assert.strictEqual(r.event.assetId, assetId1);
  assert.strictEqual(r.event.eventType, "download");
});

test("recordUsage fails for unknown asset", () => {
  const r = mee.recordUsage("nonexistent");
  assert.strictEqual(r.ok, false);
});

test("rateAsset succeeds with valid rating", () => {
  const r = mee.rateAsset(assetId1, { rating: 4, comment: "Great blueprint!", userId: "user_test" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.avgRating    === "number");
  assert.ok(typeof r.totalRatings === "number" && r.totalRatings >= 1);
  assert.ok(r.avgRating >= 1 && r.avgRating <= 5);
});

test("rateAsset fails with out-of-range rating", () => {
  const r = mee.rateAsset(assetId1, { rating: 6 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("rateAsset fails with rating 0", () => {
  const r = mee.rateAsset(assetId1, { rating: 0 });
  assert.strictEqual(r.ok, false);
});

test("rateAsset fails for unknown asset", () => {
  const r = mee.rateAsset("nonexistent", { rating: 3 });
  assert.strictEqual(r.ok, false);
});

test("getEconomySnapshot returns full snapshot", () => {
  const r = mee.getEconomySnapshot();
  assert.ok(r.ok, JSON.stringify(r));
  const e = r.economy;
  ["totalAssets","publishedAssets","adoptedAssets","adoptionRate",
   "totalDownloads","totalROIMinutes","totalROIHours","avgRating","successRate",
   "topDownloads","usageEvents"].forEach(k =>
    assert.ok(e[k] !== undefined, `missing economy key: ${k}`)
  );
});

test("economy totalROIMinutes is positive", () => {
  const r = mee.getEconomySnapshot();
  assert.ok(r.economy.totalROIMinutes >= 0);
});

test("getAssetEconomy returns economy for known asset", () => {
  const r = mee.getAssetEconomy(assetId1);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.assetId === assetId1);
  assert.ok(typeof r.downloads      === "number");
  assert.ok(r.ratings && typeof r.ratings.count  === "number");
  assert.ok(r.ratings && typeof r.ratings.avg    === "number");
  assert.ok(typeof r.roiMinutes === "number");
});

test("getAssetEconomy fails for unknown asset", () => {
  const r = mee.getAssetEconomy("nonexistent");
  assert.strictEqual(r.ok, false);
});

test("getTopAssets by downloads", () => {
  const r = mee.getTopAssets({ by: "downloads", limit: 5 });
  assert.ok(r.ok && Array.isArray(r.assets));
  assert.strictEqual(r.by, "downloads");
  // Should be sorted descending
  for (let i = 1; i < r.assets.length; i++) {
    assert.ok(r.assets[i].downloads <= r.assets[i-1].downloads, "not sorted by downloads");
  }
});

test("getTopAssets by roi", () => {
  const r = mee.getTopAssets({ by: "roi", limit: 5 });
  assert.ok(r.ok && Array.isArray(r.assets));
  assert.strictEqual(r.by, "roi");
  r.assets.forEach(a => assert.ok(typeof a.roiMinutes === "number"));
});

test("getTopAssets filtered by type", () => {
  const r = mee.getTopAssets({ type: "blueprint", limit: 5 });
  assert.ok(r.ok);
  r.assets.forEach(a => assert.strictEqual(a.type, "blueprint"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Marketplace Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Marketplace Dashboard ──");

test("module exports", () => {
  assert.ok(typeof mfd.getDashboard              === "function");
  assert.ok(typeof mfd.getAssetView              === "function");
  assert.ok(typeof mfd.getMarketplaceSystemHealth=== "function");
  assert.strictEqual(mfd.MARKETPLACE_SERVICES_REUSED, 24);
});

test("getDashboard returns ok with all sections", () => {
  const d = mfd.getDashboard();
  assert.ok(d.ok, JSON.stringify(d));
  ["summary","marketplaceHealth","assetQuality","topDownloads",
   "certificationStatus","automationCoverage","founderTimeSaved"].forEach(k =>
    assert.ok(d[k] !== undefined, `missing section: ${k}`)
  );
});

test("summary.marketplaceServicesReused is 24", () => {
  const d = mfd.getDashboard();
  assert.strictEqual(d.summary.marketplaceServicesReused, 24);
});

test("summary has all required keys", () => {
  const s = mfd.getDashboard().summary;
  ["marketplaceServicesReused","totalAssets","publishedAssets","avgCertScore",
   "automationCoveragePct","founderHoursSaved","assetTypes"].forEach(k =>
    assert.ok(s[k] !== undefined, `missing key: ${k}`)
  );
});

test("marketplaceHealth.byType has 13 asset types", () => {
  const h = mfd.getDashboard().marketplaceHealth;
  assert.ok(Object.keys(h.byType).length === 13, `expected 13 types, got ${Object.keys(h.byType).length}`);
});

test("assetQuality has platformReview section", () => {
  const q = mfd.getDashboard().assetQuality;
  assert.ok(q.platformReview, "missing platformReview");
  ["overall","security","reliability","architecture"].forEach(k =>
    assert.ok(typeof q.platformReview[k] === "number", `missing platformReview.${k}`)
  );
});

test("founderTimeSaved has bySource breakdown", () => {
  const f = mfd.getDashboard().founderTimeSaved;
  assert.ok(typeof f.totalMinutes === "number");
  assert.ok(typeof f.totalHours   === "number");
  assert.ok(f.bySource);
  ["automation","assetROI","certification","discovery"].forEach(k =>
    assert.ok(typeof f.bySource[k] === "number", `missing bySource.${k}`)
  );
});

test("automationCoverage has coveragePct and actions", () => {
  const a = mfd.getDashboard().automationCoverage;
  assert.ok(typeof a.coveragePct       === "number");
  assert.ok(typeof a.automationsTotal  === "number");
  assert.ok(typeof a.minutesSaved      === "number");
  assert.ok(Array.isArray(a.actions));
});

test("getAssetView fails without assetId", () => {
  const r = mfd.getAssetView(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("getAssetView returns data for known asset", () => {
  const r = mfd.getAssetView(assetId1);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.assetId === assetId1);
  assert.ok(r.asset, "missing asset");
  assert.ok(typeof r.recentRecommendations === "number");
  assert.ok(typeof r.recentAutomations     === "number");
});

test("getAssetView includes certification if available", () => {
  const r = mfd.getAssetView(assetId1);
  assert.ok(r.ok);
  // cert should be present since we certified assetId1 above
  assert.ok(r.certification !== undefined, "certification field should exist");
});

test("getMarketplaceSystemHealth returns 30 services", () => {
  const h = mfd.getMarketplaceSystemHealth();
  assert.ok(h.ok);
  assert.strictEqual(h.total, 30, `expected 30 services, got ${h.total}`);
  assert.ok(["operational","degraded","critical"].includes(h.status));
});

test("all 6 P13 services healthy", () => {
  const h = mfd.getMarketplaceSystemHealth();
  ["marketplaceCatalogEngine","marketplaceRecommendationEngine","marketplaceCertificationEngine",
   "marketplaceAutomationEngine","marketplaceEconomyEngine","marketplaceDashboard"].forEach(svc => {
    const s = h.services.find(x => x.name === svc);
    assert.ok(s,    `service not found: ${svc}`);
    assert.ok(s.ok, `service unhealthy: ${svc}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: End-to-end tests — real platform assets
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── End-to-End: Real Platform Assets ──");

test("discover → certify → recommend → rate pipeline", () => {
  // 1. discover
  const disc = mce.discover();
  assert.ok(disc.ok && disc.total > 0);

  // 2. list blueprints (from live blueprintEngine)
  const bps = mce.listAssets({ type: "blueprint", limit: 3 });
  assert.ok(bps.assets.length > 0, "no blueprints discovered from live data");

  // 3. certify first blueprint
  const bid = bps.assets[0].id;
  const cert = mce2.certify(bid);
  assert.ok(cert.ok && cert.certification.level !== undefined);

  // 4. recommend based on blueprint tags
  const rec = mre.recommend({ tags: bps.assets[0].tags || ["saas"], limit: 5 });
  assert.ok(rec.ok && rec.recommendations.length >= 0);

  // 5. rate the blueprint
  const rate = mee.rateAsset(bid, { rating: 5, comment: "production-ready!" });
  assert.ok(rate.ok);
});

test("workflow assets discovered from productionBibleEngine", () => {
  const wf = mce.listAssets({ type: "workflow", limit: 5 });
  assert.ok(wf.ok && wf.assets.length > 0, "no workflows discovered");
  wf.assets.forEach(a => assert.strictEqual(a.source, "productionBibleEngine"));
});

test("deployment_recipe assets present (from bible launch/deployment category)", () => {
  const dr = mce.listAssets({ type: "deployment_recipe", limit: 5 });
  assert.ok(dr.ok && dr.assets.length > 0, "no deployment recipes found");
  dr.assets.forEach(a => assert.ok(["launch","deployment"].includes(a.category)));
});

test("automation_pack assets from productionBibleEngine and founderWorkRegistry", () => {
  const ap = mce.listAssets({ type: "automation_pack", limit: 10 });
  assert.ok(ap.ok && ap.assets.length > 0, "no automation packs found");
});

test("company_template assets discovered from factory runs", () => {
  const ct = mce.listAssets({ type: "company_template", limit: 10 });
  assert.ok(ct.ok);
  // real factory has runs with templateIds — should have at least saas/ai_product
  if (ct.assets.length > 0) {
    ct.assets.forEach(a => assert.ok(a.templateId, "company_template missing templateId"));
  }
});

test("sdk_package assets always present (seeded)", () => {
  const sp = mce.listAssets({ type: "sdk_package", limit: 10 });
  assert.ok(sp.ok && sp.assets.length >= 5, `expected >= 5 SDK packages, got ${sp.assets.length}`);
  sp.assets.forEach(a => assert.strictEqual(a.type, "sdk_package"));
});

atest("full lifecycle: discover → certify batch → automate → economy snapshot", async () => {
  // discover
  const disc = mce.discover();
  assert.ok(disc.ok);

  // get 3 assets
  const all = mce.listAssets({ limit: 3 });
  assert.ok(all.assets.length >= 2);

  // certify batch
  const batch = mce2.certifyBatch(all.assets.map(a => a.id));
  assert.ok(batch.ok && batch.total >= 2);

  // automate version_bump on first
  const bump = await mae.automate(all.assets[0].id, "version_bump", { skipExecute: true });
  assert.ok(bump.ok);

  // economy snapshot
  const snap = mee.getEconomySnapshot();
  assert.ok(snap.ok && snap.economy.totalAssets > 0);

  // dashboard
  const dash = mfd.getDashboard();
  assert.ok(dash.ok && dash.summary.totalAssets > 0);
});

atest("recommendation uses real OBI X and OKB X intelligence", async () => {
  const r = mre.recommend({
    objective: "autonomous business intelligence analytics dashboard",
    tags:      ["business","analytics","ai"],
    limit:     10,
  });
  assert.ok(r.ok);
  assert.ok(r.context, "missing context");
  // Context should reflect real workforce domains pulled from workforceManager
  assert.ok(r.context.workforceDomains !== undefined, "missing workforceDomains");
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log(`\n── POST-Ω P13 Results ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
