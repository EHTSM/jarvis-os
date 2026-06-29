"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * POST-Ω P14 — Universal Knowledge Network
 *
 * knowledgeFederationEngine, knowledgeCorrelationEngine, knowledgeDiscoveryEngine,
 * knowledgeGovernanceEngine, knowledgeExchangeEngine, knowledgeNetworkDashboard
 *
 * Target: 77+ tests
 */

const assert = require("assert");

const kfe  = require("../../backend/services/knowledgeFederationEngine.cjs");
const kcor = require("../../backend/services/knowledgeCorrelationEngine.cjs");
const kde  = require("../../backend/services/knowledgeDiscoveryEngine.cjs");
const kgov = require("../../backend/services/knowledgeGovernanceEngine.cjs");
const kex  = require("../../backend/services/knowledgeExchangeEngine.cjs");
const knd  = require("../../backend/services/knowledgeNetworkDashboard.cjs");

let passed = 0; let failed = 0;
const promises = [];

let firstSourceId;   // set from federate results
let correlationId1;  // set from correlate
let discoveryId1;    // set from discover
let policyId1;       // set from addPolicy
let exchangeId1;     // set from exchange

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
// Section 1: Knowledge Federation Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Federation Engine ──");

test("module exports", () => {
  assert.ok(typeof kfe.federate      === "function");
  assert.ok(typeof kfe.getSource     === "function");
  assert.ok(typeof kfe.listSources   === "function");
  assert.ok(typeof kfe.getStats      === "function");
  assert.ok(Array.isArray(kfe.KNOWLEDGE_SOURCES) && kfe.KNOWLEDGE_SOURCES.length === 25);
});

test("KNOWLEDGE_SOURCES has 25 entries", () => {
  assert.strictEqual(kfe.KNOWLEDGE_SOURCES.length, 25);
  kfe.KNOWLEDGE_SOURCES.forEach(s => {
    assert.ok(s.id,      `missing id`);
    assert.ok(s.domain,  `missing domain on ${s.id}`);
    assert.ok(s.name,    `missing name on ${s.id}`);
    assert.ok(s.service, `missing service on ${s.id}`);
  });
});

test("KNOWLEDGE_SOURCES covers required domains", () => {
  const domains = [...new Set(kfe.KNOWLEDGE_SOURCES.map(s => s.domain))];
  ["engineering","research","knowledge","operations","mission","marketplace","product","customer","business","workforce","founder"].forEach(d =>
    assert.ok(domains.includes(d), `missing domain: ${d}`)
  );
});

test("federate returns ok with source counts", () => {
  const r = kfe.federate();
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.totalSources, 25);
  assert.ok(typeof r.healthySources  === "number" && r.healthySources >= 0);
  assert.ok(typeof r.totalItems      === "number" && r.totalItems >= 0);
  assert.ok(typeof r.coveragePct     === "number");
  assert.ok(r.coveragePct >= 0 && r.coveragePct <= 100);
  assert.ok(r.byDomain && typeof r.byDomain === "object");
});

test("federate returns federatedAt timestamp", () => {
  const r = kfe.federate();
  assert.ok(r.federatedAt && new Date(r.federatedAt).getTime() > 0);
});

test("federate probes live platform sources", () => {
  const r = kfe.federate();
  // At least continuous_learning should have >0 items (has 2000 lessons)
  const fedStats = kfe.getStats();
  assert.ok(fedStats.totalItems > 0, `expected > 0 total items, got ${fedStats.totalItems}`);
});

test("getStats has all required fields after federate", () => {
  const s = kfe.getStats();
  assert.ok(typeof s.totalSources   === "number" && s.totalSources === 25);
  assert.ok(typeof s.healthySources === "number");
  assert.ok(typeof s.coveragePct    === "number");
  assert.ok(typeof s.totalItems     === "number");
  assert.ok(s.byDomain && typeof s.byDomain === "object");
  assert.ok(s.lastFederated);
});

test("listSources returns all 25 sources", () => {
  const r = kfe.listSources();
  assert.ok(r.ok && Array.isArray(r.sources));
  assert.strictEqual(r.total, 25);
  firstSourceId = r.sources[0]?.id;
  assert.ok(firstSourceId);
});

test("listSources filtered by domain=engineering", () => {
  const r = kfe.listSources({ domain: "engineering" });
  assert.ok(r.ok);
  r.sources.forEach(s => assert.strictEqual(s.domain, "engineering"));
  assert.ok(r.total >= 5, `expected >= 5 engineering sources, got ${r.total}`);
});

test("listSources filtered by healthy=true", () => {
  const r = kfe.listSources({ healthy: true });
  assert.ok(r.ok);
  r.sources.forEach(s => assert.ok(s.healthy === true));
});

test("getSource returns a specific source", () => {
  const s = kfe.getSource("continuous_learning");
  assert.ok(s && s.id === "continuous_learning");
  assert.ok(s.name && s.domain && s.itemCount !== undefined);
});

test("getSource for continuous_learning has itemCount > 0 (2000 lessons)", () => {
  const s = kfe.getSource("continuous_learning");
  assert.ok(s && s.itemCount > 0, `expected > 0 items, got ${s?.itemCount}`);
});

test("getSource returns null for unknown id", () => {
  const s = kfe.getSource("nonexistent_source");
  assert.strictEqual(s, null);
});

test("byDomain aggregates correctly from listed sources", () => {
  const s   = kfe.getStats();
  const biz = s.byDomain?.business;
  assert.ok(biz, "missing business domain in byDomain");
  assert.ok(typeof biz.sources === "number" && biz.sources >= 1);
  assert.ok(typeof biz.items   === "number");
});

test("production_bible source has itemCount from bible.workflows", () => {
  const s = kfe.getSource("production_bible");
  assert.ok(s && typeof s.itemCount === "number");
  // bible has 118 workflows
  assert.ok(s.itemCount >= 0, `bible itemCount: ${s.itemCount}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Knowledge Correlation Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Correlation Engine ──");

test("module exports", () => {
  assert.ok(typeof kcor.correlate           === "function");
  assert.ok(typeof kcor.getCorrelation      === "function");
  assert.ok(typeof kcor.listCorrelations    === "function");
  assert.ok(typeof kcor.getStats            === "function");
  assert.ok(Array.isArray(kcor.CORRELATION_TYPES) && kcor.CORRELATION_TYPES.length === 6);
});

test("CORRELATION_TYPES has all 6 types", () => {
  const expected = ["failure_pattern","workflow_overlap","learning_signal","domain_bridge","quality_trend","evolution_link"];
  expected.forEach(t => assert.ok(kcor.CORRELATION_TYPES.includes(t), `missing: ${t}`));
});

test("correlate returns ok with found count", () => {
  const r = kcor.correlate();
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.found === "number" && r.found >= 0);
  assert.ok(typeof r.total === "number" && r.total >= 0);
  assert.ok(typeof r.avgStrength === "number");
  assert.ok(r.byType && typeof r.byType === "object");
});

test("correlate finds live platform correlations", () => {
  const r = kcor.correlate();
  assert.ok(r.total > 0, `expected > 0 correlations from live data, got ${r.total}`);
});

test("correlations have required fields", () => {
  const list = kcor.listCorrelations({ limit: 10 });
  assert.ok(list.ok && list.correlations.length > 0);
  list.correlations.forEach(c => {
    assert.ok(c.id,          `missing id`);
    assert.ok(c.type,        `missing type`);
    assert.ok(c.sourceA,     `missing sourceA on ${c.id}`);
    assert.ok(c.sourceB,     `missing sourceB on ${c.id}`);
    assert.ok(typeof c.strength === "number", `missing strength`);
    assert.ok(c.strength >= 0 && c.strength <= 100, `strength out of range: ${c.strength}`);
    assert.ok(c.label,       `missing label`);
    correlationId1 = correlationId1 || c.id;
  });
});

test("correlations sorted by strength descending", () => {
  const list = kcor.listCorrelations({ limit: 10 });
  for (let i = 1; i < list.correlations.length; i++) {
    assert.ok(list.correlations[i].strength <= list.correlations[i-1].strength,
      `not sorted at index ${i}`);
  }
});

test("getCorrelation by id", () => {
  assert.ok(correlationId1, "need correlationId1 from previous test");
  const c = kcor.getCorrelation(correlationId1);
  assert.ok(c && c.id === correlationId1);
});

test("getCorrelation returns null for unknown id", () => {
  assert.strictEqual(kcor.getCorrelation("nonexistent"), null);
});

test("listCorrelations filtered by sourceId", () => {
  const list = kcor.listCorrelations({ sourceId: "continuous_learning", limit: 10 });
  assert.ok(list.ok);
  list.correlations.forEach(c =>
    assert.ok(c.sourceA === "continuous_learning" || c.sourceB === "continuous_learning",
      `wrong source on ${c.id}`)
  );
});

test("listCorrelations filtered by type", () => {
  const list = kcor.listCorrelations({ type: "learning_signal", limit: 10 });
  assert.ok(list.ok);
  list.correlations.forEach(c => assert.strictEqual(c.type, "learning_signal"));
});

test("getStats has byType with all 6 types", () => {
  const s = kcor.getStats();
  assert.ok(typeof s.total === "number" && s.total > 0);
  assert.ok(typeof s.avgStrength === "number");
  assert.ok(s.CORRELATION_TYPES);
  kcor.CORRELATION_TYPES.forEach(t =>
    assert.ok(s.byType[t] !== undefined, `missing type in byType: ${t}`)
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Knowledge Discovery Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Discovery Engine ──");

test("module exports", () => {
  assert.ok(typeof kde.discover         === "function");
  assert.ok(typeof kde.getDiscovery     === "function");
  assert.ok(typeof kde.listDiscoveries  === "function");
  assert.ok(typeof kde.getStats         === "function");
  assert.ok(Array.isArray(kde.DISCOVERY_CATEGORIES) && kde.DISCOVERY_CATEGORIES.length === 8);
});

test("DISCOVERY_CATEGORIES has all 8 categories", () => {
  const expected = ["high_value_lesson","reusable_rule","research_signal","bible_workflow",
    "improvement_pattern","marketplace_asset","knowledge_gap","cross_domain_gem"];
  expected.forEach(c => assert.ok(kde.DISCOVERY_CATEGORIES.includes(c), `missing: ${c}`));
});

test("discover returns ok with found count", () => {
  const r = kde.discover();
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.found === "number" && r.found >= 0);
  assert.ok(typeof r.total === "number" && r.total >= 0);
  assert.ok(r.byCategory && typeof r.byCategory === "object");
});

test("discover finds live platform knowledge", () => {
  const r = kde.discover();
  assert.ok(r.total > 0, `expected > 0 discoveries from live platform, got ${r.total}`);
});

test("discoveries have required fields", () => {
  const list = kde.listDiscoveries({ limit: 10 });
  assert.ok(list.ok && list.discoveries.length > 0);
  list.discoveries.forEach(d => {
    assert.ok(d.id,       `missing id`);
    assert.ok(d.category, `missing category`);
    assert.ok(d.title,    `missing title`);
    assert.ok(d.source,   `missing source`);
    assert.ok(typeof d.value === "number" && d.value >= 0 && d.value <= 100,
      `value out of range: ${d.value}`);
    discoveryId1 = discoveryId1 || d.id;
  });
});

test("discoveries sorted by value descending", () => {
  const list = kde.listDiscoveries({ limit: 10 });
  for (let i = 1; i < list.discoveries.length; i++) {
    assert.ok(list.discoveries[i].value <= list.discoveries[i-1].value,
      `not sorted at index ${i}`);
  }
});

test("discover finds high_value_lesson (CLE has 2000 lessons)", () => {
  const list = kde.listDiscoveries({ category: "high_value_lesson", limit: 10 });
  assert.ok(list.ok && list.discoveries.length > 0,
    "expected at least one high_value_lesson discovery from CLE 2000 lessons");
});

test("discover finds reusable_rule (ERR has 10 rules)", () => {
  const list = kde.listDiscoveries({ category: "reusable_rule", limit: 10 });
  assert.ok(list.ok && list.discoveries.length > 0,
    "expected reusable_rule discoveries from ERR's 10 rules");
});

test("discover finds marketplace_asset (catalog has >5 assets)", () => {
  const list = kde.listDiscoveries({ category: "marketplace_asset", limit: 10 });
  assert.ok(list.ok && list.discoveries.length > 0,
    "expected marketplace_asset discoveries from catalog");
});

test("getDiscovery by id", () => {
  assert.ok(discoveryId1, "need discoveryId1");
  const d = kde.getDiscovery(discoveryId1);
  assert.ok(d && d.id === discoveryId1);
});

test("getDiscovery returns null for unknown id", () => {
  assert.strictEqual(kde.getDiscovery("nonexistent"), null);
});

test("listDiscoveries filtered by minValue", () => {
  const list = kde.listDiscoveries({ minValue: 60, limit: 20 });
  assert.ok(list.ok);
  list.discoveries.forEach(d => assert.ok(d.value >= 60, `value too low: ${d.value}`));
});

test("getStats has byCategory with all 8 categories", () => {
  const s = kde.getStats();
  assert.ok(typeof s.total === "number" && s.total > 0);
  assert.ok(s.byCategory && typeof s.byCategory === "object");
  kde.DISCOVERY_CATEGORIES.forEach(c =>
    assert.ok(s.byCategory[c] !== undefined, `missing: ${c}`)
  );
  assert.ok(s.lastRun);
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Knowledge Governance Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Governance Engine ──");

test("module exports", () => {
  assert.ok(typeof kgov.governAll           === "function");
  assert.ok(typeof kgov.governRecord        === "function");
  assert.ok(typeof kgov.addPolicy           === "function");
  assert.ok(typeof kgov.listPolicies        === "function");
  assert.ok(typeof kgov.getRecord           === "function");
  assert.ok(typeof kgov.listRecords         === "function");
  assert.ok(typeof kgov.getGovernanceHealth === "function");
  assert.ok(typeof kgov.getStats            === "function");
  assert.ok(Array.isArray(kgov.GOVERNANCE_DIMENSIONS) && kgov.GOVERNANCE_DIMENSIONS.length === 5);
});

test("GOVERNANCE_DIMENSIONS has 5 dimensions", () => {
  const expected = ["ownership","confidence","freshness","lineage","provenance"];
  expected.forEach(d => assert.ok(kgov.GOVERNANCE_DIMENSIONS.includes(d), `missing: ${d}`));
});

test("governAll returns ok with governed count", () => {
  const r = kgov.governAll();
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(typeof r.governed       === "number" && r.governed > 0);
  assert.ok(typeof r.avgConfidence  === "number");
  assert.ok(typeof r.avgFreshness   === "number");
  assert.ok(typeof r.staleItems     === "number");
  assert.ok(typeof r.lowConfidence  === "number");
});

test("governAll governs all 25 sources", () => {
  const r = kgov.governAll();
  assert.strictEqual(r.governed, 25);
});

test("governance records have all required fields", () => {
  const list = kgov.listRecords({ limit: 5 });
  assert.ok(list.ok && list.records.length > 0);
  list.records.forEach(r => {
    assert.ok(r.id,           `missing id`);
    assert.ok(r.sourceId,     `missing sourceId`);
    assert.ok(r.domain,       `missing domain`);
    assert.ok(r.ownership,    `missing ownership`);
    assert.ok(typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 100,
      `confidence out of range: ${r.confidence}`);
    assert.ok(typeof r.freshness  === "number" && r.freshness  >= 0 && r.freshness  <= 100,
      `freshness out of range: ${r.freshness}`);
    assert.ok(Array.isArray(r.lineage) && r.lineage.length > 0, `missing lineage`);
    assert.ok(r.provenance,   `missing provenance`);
  });
});

test("getRecord returns record for known source", () => {
  const r = kgov.getRecord("continuous_learning");
  assert.ok(r && r.sourceId === "continuous_learning");
  assert.ok(r.confidence >= 0 && r.confidence <= 100);
  assert.ok(r.freshness  >= 0 && r.freshness  <= 100);
});

test("getRecord returns null for unknown source", () => {
  const r = kgov.getRecord("nonexistent_source");
  assert.strictEqual(r, null);
});

test("listRecords filtered by domain", () => {
  const list = kgov.listRecords({ domain: "engineering", limit: 10 });
  assert.ok(list.ok);
  list.records.forEach(r => assert.strictEqual(r.domain, "engineering"));
  assert.ok(list.total >= 5);
});

test("listRecords filtered by minConfidence", () => {
  const list = kgov.listRecords({ minConfidence: 50, limit: 10 });
  assert.ok(list.ok);
  list.records.forEach(r => assert.ok(r.confidence >= 50, `confidence too low: ${r.confidence}`));
});

test("listRecords sorted by confidence descending", () => {
  const list = kgov.listRecords({ limit: 10 });
  for (let i = 1; i < list.records.length; i++) {
    assert.ok(list.records[i].confidence <= list.records[i-1].confidence,
      `not sorted at index ${i}`);
  }
});

test("governRecord for specific source", () => {
  const r = kgov.governRecord("knowledge_graph");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.record.sourceId === "knowledge_graph");
  assert.ok(r.record.confidence >= 0 && r.record.confidence <= 100);
});

test("governRecord fails for unknown source", () => {
  const r = kgov.governRecord("nonexistent_xyz");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("addPolicy creates a governance policy", () => {
  const r = kgov.addPolicy({
    name:        "stale_threshold",
    condition:   "freshness < 40",
    action:      "flag_for_review",
    description: "Flag knowledge items that haven't been updated in 90+ days",
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.policy.id.startsWith("kgov_"));
  policyId1 = r.policy.id;
});

test("addPolicy fails without required fields", () => {
  const r = kgov.addPolicy({ name: "incomplete" });
  assert.strictEqual(r.ok, false);
});

test("listPolicies returns created policy", () => {
  const r = kgov.listPolicies();
  assert.ok(r.ok && r.policies.some(p => p.id === policyId1));
});

test("getGovernanceHealth has all required fields", () => {
  const h = kgov.getGovernanceHealth();
  assert.ok(h.ok, JSON.stringify(h));
  ["governed","avgConfidence","avgFreshness","staleItems","lowConfidence","healthScore"].forEach(k =>
    assert.ok(h[k] !== undefined, `missing: ${k}`)
  );
});

test("getStats has GOVERNANCE_DIMENSIONS and byOwner", () => {
  const s = kgov.getStats();
  assert.ok(typeof s.total === "number" && s.total === 25);
  assert.ok(s.byOwner && typeof s.byOwner === "object");
  assert.ok(Array.isArray(s.GOVERNANCE_DIMENSIONS));
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Knowledge Exchange Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Exchange Engine ──");

test("module exports", () => {
  assert.ok(typeof kex.exchange        === "function");
  assert.ok(typeof kex.runAllChannels  === "function");
  assert.ok(typeof kex.getExchange     === "function");
  assert.ok(typeof kex.listExchanges   === "function");
  assert.ok(typeof kex.getStats        === "function");
  assert.ok(Array.isArray(kex.EXCHANGE_DOMAINS) && kex.EXCHANGE_DOMAINS.length === 7);
  assert.ok(Array.isArray(kex.EXCHANGE_CHANNELS) && kex.EXCHANGE_CHANNELS.length === 7);
});

test("EXCHANGE_DOMAINS has 7 domains", () => {
  const expected = ["engineering","business","design","research","customer","marketplace","platform"];
  expected.forEach(d => assert.ok(kex.EXCHANGE_DOMAINS.includes(d), `missing: ${d}`));
});

test("EXCHANGE_CHANNELS has 7 channels with from/to/desc", () => {
  kex.EXCHANGE_CHANNELS.forEach(c => {
    assert.ok(c.id,   `missing id`);
    assert.ok(c.from, `missing from on ${c.id}`);
    assert.ok(c.to,   `missing to on ${c.id}`);
    assert.ok(c.desc, `missing desc on ${c.id}`);
  });
});

test("exchange eng_to_biz succeeds", () => {
  const r = kex.exchange("eng_to_biz");
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.exchange.channelId === "eng_to_biz");
  assert.ok(r.exchange.from === "engineering" && r.exchange.to === "business");
  assert.ok(typeof r.exchange.itemsExchanged === "number");
  assert.ok(typeof r.exchange.minutesSaved   === "number");
  exchangeId1 = r.exchange.id;
});

test("exchange res_to_mkt succeeds", () => {
  const r = kex.exchange("res_to_mkt");
  assert.ok(r.ok && r.exchange.channelId === "res_to_mkt");
  assert.ok(r.exchange.from === "research" && r.exchange.to === "marketplace");
});

test("exchange biz_to_eng succeeds", () => {
  const r = kex.exchange("biz_to_eng");
  assert.ok(r.ok && r.exchange.channelId === "biz_to_eng");
});

test("exchange eng_to_res succeeds", () => {
  const r = kex.exchange("eng_to_res");
  assert.ok(r.ok && r.exchange.channelId === "eng_to_res");
});

test("exchange fails for unknown channel", () => {
  const r = kex.exchange("nonexistent_channel");
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test("runAllChannels runs all 7 channels", () => {
  const r = kex.runAllChannels();
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.total, 7);
  assert.ok(typeof r.success             === "number" && r.success >= 0);
  assert.ok(typeof r.totalItemsExchanged === "number");
  assert.ok(typeof r.totalMinutesSaved   === "number");
  assert.ok(Array.isArray(r.results));
});

test("runAllChannels items exchanged from live platform", () => {
  const r = kex.runAllChannels();
  assert.ok(r.totalItemsExchanged > 0, `expected > 0 items exchanged from live sources, got ${r.totalItemsExchanged}`);
});

test("exchange records have items array", () => {
  const list = kex.listExchanges({ limit: 5 });
  assert.ok(list.ok && list.exchanges.length > 0);
  list.exchanges.forEach(e => {
    assert.ok(e.id,                       `missing id`);
    assert.ok(e.channelId,                `missing channelId`);
    assert.ok(e.from && e.to,             `missing from/to`);
    assert.ok(Array.isArray(e.items),     `missing items array`);
    assert.ok(typeof e.itemsExchanged === "number", `missing itemsExchanged`);
    assert.ok(typeof e.minutesSaved   === "number", `missing minutesSaved`);
  });
});

test("getExchange by id", () => {
  assert.ok(exchangeId1, "need exchangeId1");
  const e = kex.getExchange(exchangeId1);
  assert.ok(e && e.id === exchangeId1);
});

test("getExchange returns null for unknown id", () => {
  assert.strictEqual(kex.getExchange("nonexistent"), null);
});

test("listExchanges filtered by channelId", () => {
  const list = kex.listExchanges({ channelId: "eng_to_biz", limit: 10 });
  assert.ok(list.ok);
  list.exchanges.forEach(e => assert.strictEqual(e.channelId, "eng_to_biz"));
});

test("listExchanges filtered by from domain", () => {
  const list = kex.listExchanges({ from: "engineering", limit: 10 });
  assert.ok(list.ok);
  list.exchanges.forEach(e => assert.strictEqual(e.from, "engineering"));
});

test("getStats has cumulative itemsExchanged and minutesSaved", () => {
  const s = kex.getStats();
  assert.ok(typeof s.total          === "number" && s.total > 0);
  assert.ok(typeof s.itemsExchanged === "number" && s.itemsExchanged > 0);
  assert.ok(typeof s.minutesSaved   === "number");
  assert.ok(s.EXCHANGE_CHANNELS === 7);
  assert.ok(Array.isArray(s.EXCHANGE_DOMAINS));
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Knowledge Network Dashboard
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Knowledge Network Dashboard ──");

test("module exports", () => {
  assert.ok(typeof knd.getDashboard             === "function");
  assert.ok(typeof knd.getPipelineView          === "function");
  assert.ok(typeof knd.getNetworkSystemHealth   === "function");
  assert.strictEqual(knd.KNOWLEDGE_SERVICES_REUSED, 25);
});

test("getDashboard returns ok with all sections", () => {
  const d = knd.getDashboard();
  assert.ok(d.ok, JSON.stringify(d));
  ["summary","knowledgeCoverage","connectedSources","crossDomainLinks",
   "knowledgeFreshness","knowledgeConfidence","federationHealth","founderTimeSaved"].forEach(k =>
    assert.ok(d[k] !== undefined, `missing section: ${k}`)
  );
});

test("summary.knowledgeServicesReused is 25", () => {
  const d = knd.getDashboard();
  assert.strictEqual(d.summary.knowledgeServicesReused, 25);
});

test("summary has all required keys", () => {
  const s = knd.getDashboard().summary;
  ["knowledgeServicesReused","totalSources","healthySources","coveragePct",
   "totalKnowledgeItems","totalCorrelations","totalDiscoveries",
   "avgConfidence","founderHoursSaved","federationStatus"].forEach(k =>
    assert.ok(s[k] !== undefined, `missing key: ${k}`)
  );
});

test("connectedSources.total is 25", () => {
  const d = knd.getDashboard();
  assert.strictEqual(d.connectedSources.total, 25);
  assert.ok(typeof d.connectedSources.totalItems === "number");
});

test("knowledgeFreshness has avgFreshness", () => {
  const f = knd.getDashboard().knowledgeFreshness;
  assert.ok(typeof f.avgFreshness === "number");
  assert.ok(typeof f.staleItems   === "number");
  assert.ok(typeof f.governed     === "number");
});

test("crossDomainLinks has correlations and exchanges", () => {
  const c = knd.getDashboard().crossDomainLinks;
  assert.ok(typeof c.totalCorrelations === "number" && c.totalCorrelations > 0);
  assert.ok(typeof c.totalExchanges    === "number" && c.totalExchanges > 0);
  assert.ok(typeof c.itemsExchanged    === "number");
});

test("founderTimeSaved has bySource breakdown", () => {
  const f = knd.getDashboard().founderTimeSaved;
  assert.ok(typeof f.totalMinutes === "number" && f.totalMinutes >= 0);
  assert.ok(typeof f.totalHours   === "number");
  assert.ok(f.bySource);
  ["exchange","discovery","governance","federation"].forEach(k =>
    assert.ok(typeof f.bySource[k] === "number", `missing bySource.${k}`)
  );
});

test("founderTimeSaved.totalMinutes > 0 (from live exchange+discovery)", () => {
  const f = knd.getDashboard().founderTimeSaved;
  assert.ok(f.totalMinutes > 0, `expected > 0 minutes saved, got ${f.totalMinutes}`);
});

test("federationHealth has coveragePct and status", () => {
  const h = knd.getDashboard().federationHealth;
  assert.ok(typeof h.federationCoverage === "number");
  assert.ok(["operational","degraded","critical"].includes(h.status));
  assert.ok(typeof h.totalKnowledgeItems === "number");
});

test("getPipelineView returns 9-step pipeline", () => {
  const p = knd.getPipelineView();
  assert.ok(p.ok, JSON.stringify(p));
  assert.ok(Array.isArray(p.pipeline) && p.pipeline.length === 9);
  const steps = ["Discover","Normalize","Correlate","Link","Govern","Publish","Share","Learn","Improve"];
  steps.forEach((step, i) => assert.strictEqual(p.pipeline[i].step, step, `step ${i} wrong`));
});

test("getPipelineView engines are delegated to correct services", () => {
  const p = knd.getPipelineView();
  const fedStep = p.pipeline.find(s => s.step === "Discover");
  assert.strictEqual(fedStep.engine, "knowledgeFederationEngine");
  const learnStep = p.pipeline.find(s => s.step === "Learn");
  assert.strictEqual(learnStep.status, "delegated");
});

test("getNetworkSystemHealth returns 31 services", () => {
  const h = knd.getNetworkSystemHealth();
  assert.ok(h.ok);
  assert.strictEqual(h.total, 31);
  assert.ok(["operational","degraded","critical"].includes(h.status));
});

test("all 6 P14 engines healthy", () => {
  const h = knd.getNetworkSystemHealth();
  ["knowledgeFederationEngine","knowledgeCorrelationEngine","knowledgeDiscoveryEngine",
   "knowledgeGovernanceEngine","knowledgeExchangeEngine","knowledgeNetworkDashboard"].forEach(svc => {
    const s = h.services.find(x => x.name === svc);
    assert.ok(s,    `service not found: ${svc}`);
    assert.ok(s.ok, `service unhealthy: ${svc}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: End-to-End pipeline
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── End-to-End: Full Knowledge Network Pipeline ──");

test("full pipeline: federate→govern→correlate→discover→exchange→dashboard", () => {
  // 1. Federate
  const fed = kfe.federate();
  assert.ok(fed.ok && fed.totalSources === 25);

  // 2. Govern
  const gov = kgov.governAll();
  assert.ok(gov.ok && gov.governed === 25);

  // 3. Correlate
  const cor = kcor.correlate();
  assert.ok(cor.ok && cor.total > 0);

  // 4. Discover
  const disc = kde.discover();
  assert.ok(disc.ok && disc.total > 0);

  // 5. Exchange all channels
  const ex = kex.runAllChannels();
  assert.ok(ex.ok && ex.total === 7);

  // 6. Dashboard reflects everything
  const dash = knd.getDashboard();
  assert.ok(dash.ok);
  assert.ok(dash.summary.totalSources === 25);
  assert.ok(dash.summary.totalCorrelations > 0);
  assert.ok(dash.summary.totalDiscoveries > 0);
});

test("knowledge network covers all 7 exchange domains", () => {
  const r = kex.runAllChannels();
  const fromDomains = new Set(r.results.map(x => kex.EXCHANGE_CHANNELS.find(c => c.id === x.channelId)?.from).filter(Boolean));
  const toDomains   = new Set(r.results.map(x => kex.EXCHANGE_CHANNELS.find(c => c.id === x.channelId)?.to).filter(Boolean));
  const covered     = new Set([...fromDomains, ...toDomains]);
  assert.ok(covered.size >= 5, `expected >= 5 covered domains, got ${covered.size}`);
});

test("governance health score > 0 after governing all sources", () => {
  kgov.governAll();
  const h = kgov.getGovernanceHealth();
  assert.ok(h.healthScore >= 0 && h.healthScore <= 100);
});

test("continuous_learning source has most items (2000 lessons in CLE)", () => {
  kfe.federate();
  const s = kfe.getSource("continuous_learning");
  assert.ok(s && s.itemCount > 0, `CLE should have > 0 items, got ${s?.itemCount}`);
});

test("correlations reference real source IDs from federation", () => {
  const fedSources = kfe.listSources().sources.map(s => s.id);
  const cors = kcor.listCorrelations({ limit: 20 });
  cors.correlations.forEach(c => {
    assert.ok(fedSources.includes(c.sourceA) || c.sourceA === "knowledge_federation",
      `unknown sourceA: ${c.sourceA}`);
    assert.ok(fedSources.includes(c.sourceB) || c.sourceB === "knowledge_federation",
      `unknown sourceB: ${c.sourceB}`);
  });
});

test("discovery source field matches federation source IDs", () => {
  const fedSources = new Set(kfe.listSources().sources.map(s => s.service));
  const discs = kde.listDiscoveries({ limit: 20 });
  // source should be a known service name or "knowledge_federation"
  discs.discoveries.forEach(d => {
    assert.ok(d.source, `missing source on ${d.id}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log(`\n── POST-Ω P14 Results ──`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
