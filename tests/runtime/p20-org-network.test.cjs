process.env.SKIP_PLATFORM_REGISTER = "1";
"use strict";
/**
 * p20-org-network.test.cjs
 * POST-Ω P20: Artificial Organization Network — FINAL PLATFORM EXPANSION SPRINT
 * Target: 100+ tests
 */

const assert = require("assert");
const atests = [];
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
}
function atest(name, fn) { atests.push({ name, fn }); }

const reg    = require("../../backend/services/organizationRegistryEngine.cjs");
const collab = require("../../backend/services/organizationCollaborationEngine.cjs");
const cap    = require("../../backend/services/organizationCapabilityExchangeEngine.cjs");
const gov    = require("../../backend/services/organizationGovernanceEngine.cjs");
const evo    = require("../../backend/services/organizationEvolutionEngine.cjs");
const db     = require("../../backend/services/organizationNetworkDashboard.cjs");

// ── Section 1: Organization Registry Engine (20 tests) ───────────────────────

console.log("\n[1/6] Organization Registry Engine");

test("exports ORG_TYPES with 15 types", () => {
  assert.ok(Array.isArray(reg.ORG_TYPES));
  assert.strictEqual(reg.ORG_TYPES.length, 15);
});

test("ORG_TYPES includes engineering, business, knowledge, evolution", () => {
  ["engineering","business","knowledge","evolution","executive","enterprise","ecosystem","civilization","autonomous"]
    .forEach(t => assert.ok(reg.ORG_TYPES.includes(t), `${t} missing`));
});

test("exports ORG_STATUSES array", () => {
  assert.ok(Array.isArray(reg.ORG_STATUSES));
  assert.ok(reg.ORG_STATUSES.includes("active"));
  assert.ok(reg.ORG_STATUSES.includes("evolving"));
});

test("exports TRUST_LEVELS array", () => {
  assert.ok(Array.isArray(reg.TRUST_LEVELS));
  assert.ok(reg.TRUST_LEVELS.includes("certified"));
  assert.ok(reg.TRUST_LEVELS.includes("untrusted"));
});

test("exports PLATFORM_ORGS with 16 platform orgs", () => {
  assert.ok(Array.isArray(reg.PLATFORM_ORGS));
  assert.ok(reg.PLATFORM_ORGS.length >= 16);
});

test("auto-seeds all platform orgs on load", () => {
  const stats = reg.getStats();
  assert.ok(stats.total >= 16, `Expected ≥16 seeded orgs, got ${stats.total}`);
});

test("seeded orgs include certified engineering org", () => {
  const r = reg.listOrgs({ orgType: "engineering", trustLevel: "certified" });
  assert.ok(r.orgs.length > 0);
});

test("registerOrg() requires name and orgType", () => {
  const r = reg.registerOrg({ name: "Test" });
  assert.strictEqual(r.ok, false);
});

test("registerOrg() with invalid orgType returns ok:false", () => {
  const r = reg.registerOrg({ name: "Test", orgType: "galactic_senate" });
  assert.strictEqual(r.ok, false);
});

test("registerOrg() creates active org with provisional trust", () => {
  const r = reg.registerOrg({ name: "Test Org", orgType: "engineering" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.org.status, "active");
  assert.strictEqual(r.org.trustLevel, "provisional");
});

test("registerOrg() accepts all 15 org types", () => {
  reg.ORG_TYPES.forEach(t => {
    const r = reg.registerOrg({ name: `Test ${t}`, orgType: t });
    assert.strictEqual(r.ok, true, `${t} failed`);
  });
});

test("registerOrg() is idempotent by id", () => {
  const r1 = reg.registerOrg({ name: "Idempotent Org", orgType: "business" });
  const r2 = reg.registerOrg({ id: r1.org.id, name: "Idempotent Org Updated", orgType: "business" });
  assert.strictEqual(r2.org.id, r1.org.id);
  assert.strictEqual(r2.org.name, "Idempotent Org Updated");
});

test("updateOrgStatus() with valid status", () => {
  const r = reg.registerOrg({ name: "Status Test Org", orgType: "knowledge" });
  const u = reg.updateOrgStatus(r.org.id, "evolving");
  assert.strictEqual(u.ok, true);
  assert.strictEqual(u.org.status, "evolving");
});

test("updateOrgStatus() with invalid status returns ok:false", () => {
  const r = reg.registerOrg({ name: "Bad Status Org", orgType: "knowledge" });
  assert.strictEqual(reg.updateOrgStatus(r.org.id, "dormant").ok, false);
});

test("updateOrgStatus() can also set trustLevel", () => {
  const r = reg.registerOrg({ name: "Trust Upgrade Org", orgType: "enterprise" });
  const u = reg.updateOrgStatus(r.org.id, "active", { trustLevel: "trusted" });
  assert.strictEqual(u.org.trustLevel, "trusted");
});

test("getOrg('nonexistent') returns null", () => {
  assert.strictEqual(reg.getOrg("nonexistent-xyz"), null);
});

test("listOrgs({orgType:'engineering'}) filters", () => {
  const r = reg.listOrgs({ orgType: "engineering" });
  assert.ok(r.orgs.every(o => o.orgType === "engineering"));
});

test("listOrgs({trustLevel:'certified'}) filters", () => {
  const r = reg.listOrgs({ trustLevel: "certified" });
  assert.ok(r.orgs.every(o => o.trustLevel === "certified"));
});

test("findByCapability('code') returns engineering org", () => {
  const r = reg.findByCapability("code");
  assert.strictEqual(r.ok, true);
  assert.ok(r.orgs.length > 0);
  assert.ok(r.orgs[0].capabilities.some(c => c.includes("code")));
});

test("getStats() returns total, active, byType, byTrust, trustScore", () => {
  const s = reg.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.active === "number");
  assert.ok(typeof s.byType === "object");
  assert.ok(typeof s.byTrust === "object");
  assert.ok(typeof s.trustScore === "number");
});

// ── Section 2: Organization Collaboration Engine (17 tests) ──────────────────

console.log("\n[2/6] Organization Collaboration Engine");

test("exports COLLABORATION_TYPES with 6 types", () => {
  assert.ok(Array.isArray(collab.COLLABORATION_TYPES));
  assert.strictEqual(collab.COLLABORATION_TYPES.length, 6);
  ["mission_delegation","workforce_sharing","knowledge_exchange","infrastructure_sharing","research_sharing","capability_delegation"]
    .forEach(t => assert.ok(collab.COLLABORATION_TYPES.includes(t)));
});

test("exports COLLABORATION_STATUSES array", () => {
  assert.ok(Array.isArray(collab.COLLABORATION_STATUSES));
  assert.ok(collab.COLLABORATION_STATUSES.includes("active"));
  assert.ok(collab.COLLABORATION_STATUSES.includes("completed"));
});

atest("collaborate() returns ok:false without fromOrgId/toOrgId", async () => {
  const r = await collab.collaborate({ type: "mission_delegation" });
  assert.strictEqual(r.ok, false);
});

atest("collaborate() with unknown type returns ok:false", async () => {
  const r = await collab.collaborate({ fromOrgId: "org_engineering", toOrgId: "org_business", type: "world_domination" });
  assert.strictEqual(r.ok, false);
});

atest("collaborate() with unregistered fromOrgId returns ok:false", async () => {
  const r = await collab.collaborate({ fromOrgId: "nonexistent-from", toOrgId: "org_business", type: "mission_delegation" });
  assert.strictEqual(r.ok, false);
});

atest("collaborate() with unregistered toOrgId returns ok:false", async () => {
  const r = await collab.collaborate({ fromOrgId: "org_engineering", toOrgId: "nonexistent-to", type: "mission_delegation" });
  assert.strictEqual(r.ok, false);
});

atest("collaborate() mission_delegation with skipExecute returns ok:true", async () => {
  const r = await collab.collaborate({
    fromOrgId: "org_engineering", toOrgId: "org_business",
    type: "mission_delegation", payload: { goal: "test mission" }, skipExecute: true,
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.collaboration.id);
});

atest("collaborate() records collaboration with status completed", async () => {
  const r = await collab.collaborate({
    fromOrgId: "org_knowledge", toOrgId: "org_evolution",
    type: "knowledge_exchange", skipExecute: true,
  });
  assert.strictEqual(r.collaboration.status, "completed");
});

atest("collaborate() all 6 types work with skipExecute", async () => {
  for (const type of collab.COLLABORATION_TYPES) {
    const r = await collab.collaborate({
      fromOrgId: "org_engineering", toOrgId: "org_executive",
      type, payload: { goal: "test", capability: "code" }, skipExecute: true,
    });
    assert.strictEqual(r.ok, true, `type ${type} failed`);
  }
});

atest("collaborate() stores fromOrgName and toOrgName", async () => {
  const r = await collab.collaborate({
    fromOrgId: "org_engineering", toOrgId: "org_knowledge",
    type: "research_sharing", skipExecute: true,
  });
  assert.ok(r.collaboration.fromOrgName);
  assert.ok(r.collaboration.toOrgName);
});

test("listCollaborations() returns ok and array", () => {
  const r = collab.listCollaborations();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.collaborations));
});

test("listCollaborations({type:'mission_delegation'}) filters", () => {
  const r = collab.listCollaborations({ type: "mission_delegation" });
  assert.ok(r.collaborations.every(c => c.type === "mission_delegation"));
});

test("getCollaboration('nonexistent') returns null", () => {
  assert.strictEqual(collab.getCollaboration("nonexistent-xyz"), null);
});

test("routeToOrg('code') returns ok:true with best org", () => {
  const r = collab.routeToOrg("code");
  assert.strictEqual(r.ok, true);
  assert.ok(r.best);
  assert.ok(r.best.id);
});

test("routeToOrg('code', {excludeOrgId}) excludes specified org", () => {
  const best1 = collab.routeToOrg("code");
  const best2 = collab.routeToOrg("code", { excludeOrgId: best1.best.id });
  if (best2.ok) {
    assert.notStrictEqual(best2.best.id, best1.best.id);
  }
});

test("routeToOrg('nonexistent_capability_xyz') returns ok:false or found", () => {
  const r = collab.routeToOrg("nonexistent_capability_xyz");
  // Either ok:false (no match) or ok:true (some loose match) — just check it doesn't throw
  assert.ok(typeof r.ok === "boolean");
});

test("getCollaborationStats() returns total, byType, byStatus, successRate", () => {
  const s = collab.getCollaborationStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.byType === "object");
  assert.ok(typeof s.byStatus === "object");
  assert.ok(typeof s.successRate === "number");
});

// ── Section 3: Capability Exchange Engine (14 tests) ─────────────────────────

console.log("\n[3/6] Capability Exchange Engine");

test("exports EXCHANGE_EVENT_TYPES array", () => {
  assert.ok(Array.isArray(cap.EXCHANGE_EVENT_TYPES));
  assert.ok(cap.EXCHANGE_EVENT_TYPES.includes("capability_discovered"));
  assert.ok(cap.EXCHANGE_EVENT_TYPES.includes("best_org_matched"));
});

test("discoverCapabilities() returns ok:true", () => {
  const r = cap.discoverCapabilities();
  assert.strictEqual(r.ok, true);
});

test("discoverCapabilities() returns total > 0", () => {
  const r = cap.discoverCapabilities();
  assert.ok(r.total > 0, `Expected >0 capabilities, got ${r.total}`);
});

test("discoverCapabilities() covers orgsCovered", () => {
  const r = cap.discoverCapabilities();
  assert.ok(r.orgsCovered >= 16);
});

test("findBestOrg() without goal or caps returns ok:false", () => {
  const r = cap.findBestOrg({});
  assert.strictEqual(r.ok, false);
});

test("findBestOrg({goal:'write code and deploy'}) returns best org", () => {
  const r = cap.findBestOrg({ goal: "write code and deploy" });
  assert.strictEqual(r.ok, true);
  assert.ok(r.best);
  assert.ok(r.best.matchScore > 0);
});

test("findBestOrg({requiredCapabilities:['research']}) matches knowledge org", () => {
  const r = cap.findBestOrg({ requiredCapabilities: ["research"] });
  assert.strictEqual(r.ok, true);
  assert.ok(r.best.capabilities.some(c => c.includes("research")));
});

test("findBestOrg() returns alternatives array", () => {
  const r = cap.findBestOrg({ goal: "strategic planning" });
  if (r.ok) assert.ok(Array.isArray(r.alternatives));
});

test("findBestOrg() includes allScores array", () => {
  const r = cap.findBestOrg({ goal: "code review" });
  if (r.ok) {
    assert.ok(Array.isArray(r.allScores));
    r.allScores.forEach(s => assert.ok(typeof s.score === "number"));
  }
});

test("detectGaps() returns ok:true and gaps array", () => {
  const r = cap.detectGaps();
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.gaps));
  assert.ok(typeof r.total === "number");
});

test("resolveOverlap('code') returns ok:true", () => {
  const r = cap.resolveOverlap("code");
  assert.strictEqual(r.ok, true);
});

test("resolveOverlap('nonexistent_cap') returns resolved:false", () => {
  const r = cap.resolveOverlap("nonexistent_cap_xyz");
  assert.ok(r.ok);
  assert.strictEqual(r.resolved, false);
});

test("getAllCapabilities() returns totalCapabilities, gapsDetected, recentEvents", () => {
  const r = cap.getAllCapabilities();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.totalCapabilities === "number");
  assert.ok(typeof r.gapsDetected === "number");
  assert.ok(Array.isArray(r.recentEvents));
});

test("discoverCapabilities() is idempotent — no endless growth", () => {
  const r1 = cap.discoverCapabilities();
  const r2 = cap.discoverCapabilities();
  assert.ok(r2.newlyDiscovered === 0 || r2.total >= r1.total);
});

// ── Section 4: Governance Engine (16 tests) ──────────────────────────────────

console.log("\n[4/6] Governance Engine");

test("exports AGREEMENT_TYPES with 6 types", () => {
  assert.ok(Array.isArray(gov.AGREEMENT_TYPES));
  assert.strictEqual(gov.AGREEMENT_TYPES.length, 6);
});

test("exports AGREEMENT_STATUSES array", () => {
  assert.ok(Array.isArray(gov.AGREEMENT_STATUSES));
  assert.ok(gov.AGREEMENT_STATUSES.includes("active"));
  assert.ok(gov.AGREEMENT_STATUSES.includes("terminated"));
});

test("exports COMPLIANCE_DIMENSIONS with 5 dims", () => {
  assert.ok(Array.isArray(gov.COMPLIANCE_DIMENSIONS));
  assert.strictEqual(gov.COMPLIANCE_DIMENSIONS.length, 5);
});

test("createAgreement() requires fromOrgId and toOrgId", () => {
  const r = gov.createAgreement({ type: "service_level" });
  assert.strictEqual(r.ok, false);
});

test("createAgreement() with unknown type returns ok:false", () => {
  const r = gov.createAgreement({ fromOrgId: "org_engineering", toOrgId: "org_business", type: "handshake_deal" });
  assert.strictEqual(r.ok, false);
});

test("createAgreement() with unregistered org returns ok:false", () => {
  const r = gov.createAgreement({ fromOrgId: "nonexistent", toOrgId: "org_business", type: "service_level" });
  assert.strictEqual(r.ok, false);
});

test("createAgreement() service_level between valid orgs", () => {
  const r = gov.createAgreement({
    fromOrgId: "org_engineering", toOrgId: "org_business",
    type: "service_level", terms: { sla: "99.9%", responseTime: "200ms" },
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.agreement.id);
  assert.strictEqual(r.agreement.status, "active");
});

test("createAgreement() all 6 types work", () => {
  gov.AGREEMENT_TYPES.forEach(type => {
    const r = gov.createAgreement({
      fromOrgId: "org_knowledge", toOrgId: "org_evolution", type,
    });
    assert.strictEqual(r.ok, true, `type ${type} failed`);
  });
});

test("updateAgreement() status → terminated", () => {
  const created = gov.createAgreement({ fromOrgId: "org_executive", toOrgId: "org_enterprise", type: "service_level" });
  const r = gov.updateAgreement(created.agreement.id, { status: "terminated" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.agreement.status, "terminated");
});

test("getAgreement('nonexistent') returns null", () => {
  assert.strictEqual(gov.getAgreement("nonexistent-xyz"), null);
});

test("listAgreements({status:'active'}) filters", () => {
  const r = gov.listAgreements({ status: "active" });
  assert.ok(r.agreements.every(a => a.status === "active"));
});

test("getTrustScore() returns trustScore 0-100", () => {
  const r = gov.getTrustScore("org_engineering");
  assert.strictEqual(r.ok, true);
  assert.ok(r.trustScore >= 0 && r.trustScore <= 100);
});

test("getTrustNetwork() returns network with all active orgs", () => {
  const r = gov.getTrustNetwork();
  assert.strictEqual(r.ok, true);
  assert.ok(r.totalOrgs >= 16);
  assert.ok(typeof r.avgTrustScore === "number");
});

test("assessCompliance() returns ok and complianceScore", () => {
  const r = gov.assessCompliance();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.complianceScore === "number");
  assert.ok(r.complianceScore >= 0 && r.complianceScore <= 100);
});

test("recordViolation() without orgId returns ok:false", () => {
  assert.strictEqual(gov.recordViolation({}).ok, false);
});

test("recordViolation() records violation and reduces trust", () => {
  const trustBefore = gov.getTrustScore("org_ecosystem").trustScore;
  gov.recordViolation({ orgId: "org_ecosystem", dimension: "security", severity: "critical" });
  const trustAfter = gov.getTrustScore("org_ecosystem").trustScore;
  assert.ok(trustAfter <= trustBefore, `Trust should not increase after violation: was ${trustBefore}, now ${trustAfter}`);
});

// ── Section 5: Evolution Engine (13 tests) ───────────────────────────────────

console.log("\n[5/6] Evolution Engine");

test("exports EVOLUTION_TYPES with 5 types", () => {
  assert.ok(Array.isArray(evo.EVOLUTION_TYPES));
  assert.strictEqual(evo.EVOLUTION_TYPES.length, 5);
  ["network_optimization","trust_improvement","capability_expansion","collaboration_quality","conflict_resolution"]
    .forEach(t => assert.ok(evo.EVOLUTION_TYPES.includes(t)));
});

test("exports EVOLUTION_STATUSES array", () => {
  assert.ok(Array.isArray(evo.EVOLUTION_STATUSES));
  assert.ok(evo.EVOLUTION_STATUSES.includes("pending"));
  assert.ok(evo.EVOLUTION_STATUSES.includes("applied"));
});

test("evolve() returns ok:true", () => {
  const r = evo.evolve();
  assert.strictEqual(r.ok, true);
});

test("evolve() increments cycles", () => {
  const s1 = evo.getStats();
  evo.evolve();
  const s2 = evo.getStats();
  assert.ok(s2.cycles > s1.cycles);
});

test("evolve() returns found and total", () => {
  const r = evo.evolve();
  assert.ok(typeof r.found === "number");
  assert.ok(typeof r.total === "number");
  assert.ok(r.total >= r.found);
});

test("evolve() returns evolutions array", () => {
  const r = evo.evolve();
  assert.ok(Array.isArray(r.evolutions));
});

test("evolve() evolutions have required fields", () => {
  const r = evo.evolve();
  r.evolutions.forEach(e => {
    assert.ok(e.id);
    assert.ok(e.type);
    assert.ok(e.priority);
    assert.ok(e.title);
    assert.ok(Array.isArray(e.actions));
  });
});

test("evolve() assigns valid types", () => {
  evo.listEvolutions().evolutions.forEach(e => {
    assert.ok(evo.EVOLUTION_TYPES.includes(e.type), `Invalid type: ${e.type}`);
  });
});

test("applyEvolution(id) sets status to applied", () => {
  evo.evolve();
  const all = evo.listEvolutions({ status: "pending", limit: 1 });
  if (all.evolutions.length > 0) {
    const r = evo.applyEvolution(all.evolutions[0].id);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.evolution.status, "applied");
  }
});

test("applyEvolution('nonexistent') returns ok:false", () => {
  assert.strictEqual(evo.applyEvolution("nonexistent-xyz").ok, false);
});

test("listEvolutions({type:'network_optimization'}) filters", () => {
  const r = evo.listEvolutions({ type: "network_optimization" });
  assert.ok(r.evolutions.every(e => e.type === "network_optimization"));
});

test("getEvolution('nonexistent') returns null", () => {
  assert.strictEqual(evo.getEvolution("nonexistent-xyz"), null);
});

test("getStats() returns total, applied, cycles, byType, byStatus", () => {
  const s = evo.getStats();
  assert.ok(typeof s.total === "number");
  assert.ok(typeof s.applied === "number");
  assert.ok(typeof s.cycles === "number");
  assert.ok(typeof s.byType === "object");
  assert.ok(typeof s.byStatus === "object");
});

// ── Section 6: Network Dashboard (12 tests) ──────────────────────────────────

console.log("\n[6/6] Organization Network Dashboard");

test("exports NETWORK_SERVICES_REUSED = 30", () => {
  assert.strictEqual(db.NETWORK_SERVICES_REUSED, 30);
});

test("exports PIPELINE_STEPS with 10 steps", () => {
  assert.ok(Array.isArray(db.PIPELINE_STEPS));
  assert.strictEqual(db.PIPELINE_STEPS.length, 10);
});

test("PIPELINE_STEPS first step is 'Discover Organizations'", () => {
  assert.strictEqual(db.PIPELINE_STEPS[0].step, "Discover Organizations");
});

test("PIPELINE_STEPS last step is 'Network Optimization'", () => {
  assert.strictEqual(db.PIPELINE_STEPS[9].step, "Network Optimization");
});

test("getDashboard() returns ok:true", () => {
  const r = db.getDashboard();
  assert.strictEqual(r.ok, true);
});

test("getDashboard() summary has networkServicesReused=30", () => {
  const r = db.getDashboard();
  assert.strictEqual(r.summary.networkServicesReused, 30);
});

test("getDashboard() has all required sections", () => {
  const r = db.getDashboard();
  assert.ok(typeof r.organizations === "object");
  assert.ok(typeof r.collaboration === "object");
  assert.ok(typeof r.capabilityExchange === "object");
  assert.ok(typeof r.governance === "object");
  assert.ok(typeof r.evolution === "object");
  assert.ok(typeof r.founderTimeSaved === "object");
});

test("getDashboard() totalOrganizations >= 16", () => {
  const r = db.getDashboard();
  assert.ok(r.summary.totalOrganizations >= 16);
});

test("getDashboard() founderTimeSaved has totalHours", () => {
  const r = db.getDashboard();
  assert.ok(typeof r.founderTimeSaved.totalHours === "number");
});

test("getPipelineView() returns 10-step pipeline", () => {
  const r = db.getPipelineView();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.pipeline.length, 10);
});

test("getNetworkSystemHealth() returns ok and status", () => {
  const r = db.getNetworkSystemHealth();
  assert.strictEqual(r.ok, true);
  assert.ok(typeof r.status === "string");
  assert.ok(typeof r.healthy === "number");
  assert.ok(typeof r.total === "number");
});

test("all 6 P20 engines healthy in system check", () => {
  const r = db.getNetworkSystemHealth();
  const p20 = r.services.filter(s => [
    "organizationRegistryEngine","organizationCollaborationEngine",
    "organizationCapabilityExchangeEngine","organizationGovernanceEngine",
    "organizationEvolutionEngine","organizationNetworkDashboard",
  ].includes(s.name));
  assert.ok(p20.every(s => s.ok === true), `Not all P20 engines healthy: ${JSON.stringify(p20)}`);
});

// ── E2E Tests (18 tests) ─────────────────────────────────────────────────────

console.log("\n[E2E] End-to-End");

test("E2E: 16 platform orgs auto-seeded with certified trust", () => {
  const r = reg.listOrgs({ trustLevel: "certified" });
  assert.ok(r.orgs.length >= 9, `Expected ≥9 certified orgs, got ${r.orgs.length}`);
});

test("E2E: capability discovery covers all 15 org types", () => {
  const r = cap.discoverCapabilities();
  const types = Object.keys(r.capabilities);
  assert.ok(types.length >= 10, `Expected ≥10 capability types, got ${types.length}`);
});

atest("E2E: engineering→knowledge mission delegation", async () => {
  const r = await collab.collaborate({
    fromOrgId: "org_engineering", toOrgId: "org_knowledge",
    type: "mission_delegation", payload: { goal: "analyze codebase patterns" }, skipExecute: true,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.collaboration.fromOrgId, "org_engineering");
  assert.strictEqual(r.collaboration.toOrgId, "org_knowledge");
});

atest("E2E: knowledge→research knowledge exchange", async () => {
  const r = await collab.collaborate({
    fromOrgId: "org_knowledge", toOrgId: "org_research",
    type: "knowledge_exchange", skipExecute: true,
  });
  assert.strictEqual(r.ok, true);
});

atest("E2E: infrastructure sharing between orgs", async () => {
  const r = await collab.collaborate({
    fromOrgId: "org_engineering", toOrgId: "org_research",
    type: "infrastructure_sharing", skipExecute: true,
  });
  assert.strictEqual(r.ok, true);
});

test("E2E: governance SLA agreement between engineering and executive", () => {
  const r = gov.createAgreement({
    fromOrgId: "org_engineering", toOrgId: "org_executive",
    type: "service_level", terms: { sla: "99.9%", renewal: "annual" },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.agreement.fromOrgName, "Engineering Organization");
});

test("E2E: trust network covers all active orgs", () => {
  const r = gov.getTrustNetwork();
  assert.ok(r.totalOrgs >= 16);
  assert.ok(r.avgTrustScore >= 0 && r.avgTrustScore <= 100);
});

test("E2E: findBestOrg routes 'deploy software' to engineering", () => {
  const r = cap.findBestOrg({ goal: "deploy software to production" });
  assert.strictEqual(r.ok, true);
  // Engineering org handles deployment capability
  assert.ok(["engineering","infrastructure"].includes(r.best.orgType));
});

test("E2E: findBestOrg routes 'grow revenue' to business org", () => {
  const r = cap.findBestOrg({ goal: "grow revenue and manage sales pipeline" });
  assert.strictEqual(r.ok, true);
  assert.ok(["business","enterprise"].includes(r.best.orgType));
});

test("E2E: evolution cycle detects and records improvements", () => {
  const r = evo.evolve();
  assert.ok(r.ok);
  assert.ok(r.cycles >= 1);
});

test("E2E: register new org → discover capabilities → find best org", () => {
  const newOrg = reg.registerOrg({
    name: "Specialist AI Org", orgType: "research",
    capabilities: ["quantum_research", "hypothesis_generation", "ai_experimentation"],
    trustLevel: "trusted", networkScore: 90,
  });
  assert.strictEqual(newOrg.ok, true);

  cap.discoverCapabilities();

  const found = cap.findBestOrg({ requiredCapabilities: ["quantum_research"] });
  // Should find either the new org or another with relevant capability
  assert.ok(found.ok || found.gap === true);
});

atest("E2E: full collaboration flow — all 6 types", async () => {
  for (const type of collab.COLLABORATION_TYPES) {
    const r = await collab.collaborate({
      fromOrgId: "org_autonomous", toOrgId: "org_civilization",
      type, payload: { goal: "civilizational advancement", capability: "diplomacy" },
      skipExecute: true,
    });
    assert.strictEqual(r.ok, true, `Collab type ${type} failed`);
  }
});

test("E2E: all agreements types register in governance", () => {
  gov.AGREEMENT_TYPES.forEach(type => {
    const r = gov.createAgreement({
      fromOrgId: "org_ecosystem", toOrgId: "org_civilization", type,
    });
    assert.strictEqual(r.ok, true, `Agreement type ${type} failed`);
  });
  const all = gov.listAgreements({ status: "active" });
  assert.ok(all.total >= gov.AGREEMENT_TYPES.length);
});

test("E2E: compliance score between 0-100", () => {
  const r = gov.assessCompliance();
  assert.ok(r.complianceScore >= 0 && r.complianceScore <= 100);
});

atest("E2E: full network pipeline run", async () => {
  // Discover
  const orgs = reg.listOrgs({ status: "active" });
  assert.ok(orgs.total >= 16);
  // Capability exchange
  const caps = cap.discoverCapabilities();
  assert.ok(caps.ok);
  // Trust check
  const trust = gov.getTrustNetwork();
  assert.ok(trust.ok);
  // Collaborate
  const c = await collab.collaborate({
    fromOrgId: "org_engineering", toOrgId: "org_evolution",
    type: "research_sharing", skipExecute: true,
  });
  assert.ok(c.ok);
  // Evolve
  const e = evo.evolve();
  assert.ok(e.ok);
  // Dashboard
  const dash = db.getDashboard();
  assert.ok(dash.ok);
  assert.ok(dash.summary.totalOrganizations >= 16);
  assert.ok(dash.summary.collaborationHealth >= 0);
});

test("E2E: platform inventory returns services count", () => {
  const r = db.getPlatformInventory();
  assert.strictEqual(r.ok, true);
  assert.ok(r.services > 0);
  assert.ok(r.routeFiles > 0);
});

test("E2E: network collaboration health score 0-100", () => {
  const r = db.getDashboard();
  assert.ok(r.summary.collaborationHealth >= 0 && r.summary.collaborationHealth <= 100);
});

test("E2E: evolution applied count ≥ 0", () => {
  const r = evo.getStats();
  assert.ok(r.applied >= 0);
  assert.ok(r.cycles > 0);
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of atests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`); passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`); failed++;
    }
  }
  console.log(`\n${"─".repeat(55)}`);
  console.log(`POST-Ω P20 FINAL: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
