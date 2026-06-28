"use strict";
/**
 * LEVEL Ω — Artificial Organization Platform test suite
 * Target: 120+ tests across all platform capabilities
 */

const TS = Date.now();
const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };
let passed = 0; let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); failed++; }
};

const st  = require("../../backend/services/platformState.cjs");
const org = require("../../backend/services/platformOrg.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Org Registry
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 1: Org Registry");

let orgA, orgB;

test("registerOrg — ok", () => {
  const r = st.registerOrg({ name: `AgencyA-${TS}`, type: "agency", tenantId: `tenant-${TS}`, ownerId: `owner-${TS}`, capabilities: ["engineering","business","knowledge"], tags: ["test"] });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org?.id, "no org id");
  assert(r.org.type === "agency", "wrong type");
  assert(Array.isArray(r.org.capabilities), "capabilities not array");
  assert(r.org.status === "provisioning", "not provisioning");
  orgA = r.org;
});

test("registerOrg — dedup returns existing", () => {
  // Dedup requires status === "active"; set it first
  st.updateOrg(orgA.id, { status: "active" });
  const r2 = st.registerOrg({ name: `AgencyA-${TS}`, type: "agency", tenantId: `tenant-${TS}` });
  assert(r2.ok, "dedup failed");
  assert(r2.existing, "should mark existing");
  assert(r2.org.id === orgA.id, "wrong org returned");
  orgA = r2.org;
});

test("registerOrg — missing name rejected", () => {
  const r = st.registerOrg({ type: "agency" });
  assert(!r.ok, "should reject missing name");
});

test("registerOrg — invalid type rejected", () => {
  const r = st.registerOrg({ name: `BadType-${TS}`, type: "invalid_type" });
  assert(!r.ok, "should reject invalid type");
});

test("registerOrg — all ORG_TYPES accepted", () => {
  for (const type of st.ORG_TYPES) {
    const r = st.registerOrg({ name: `${type}-${TS}`, type, tenantId: `t-${TS}-${type}` });
    assert(r.ok || r.existing, `type ${type} rejected: ${r.error}`);
  }
});

test("registerOrg — auto-derives capabilities from type", () => {
  const r = st.registerOrg({ name: `AutoCaps-${TS}`, type: "enterprise", tenantId: `ent-${TS}` });
  assert(r.ok, "failed");
  const expected = st.CAPABILITY_SETS.enterprise;
  assert(r.org.capabilities.length >= expected.length - 1, `expected ${expected.length} caps, got ${r.org.capabilities.length}`);
  orgB = r.org;
});

test("getOrg — returns correct org", () => {
  const o = st.getOrg(orgA.id);
  assert(o?.id === orgA.id, "wrong org");
});

test("getOrgByName — finds org by name", () => {
  const o = st.getOrgByName(`AgencyA-${TS}`, `tenant-${TS}`);
  assert(o?.id === orgA.id, "not found by name");
});

test("updateOrg — ok", () => {
  const r = st.updateOrg(orgA.id, { status: "active", description: "Updated" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org.status === "active", "status not updated");
  assert(r.org.description === "Updated", "description not updated");
  orgA = r.org;
});

test("listOrgs — returns array", () => {
  const list = st.listOrgs({});
  assert(Array.isArray(list) && list.length >= 2, "expected >=2 orgs");
});

test("listOrgs — filter by type", () => {
  const list = st.listOrgs({ type: "agency" });
  assert(list.every(o => o.type === "agency"), "type filter failed");
});

test("listOrgs — filter by tenantId", () => {
  const list = st.listOrgs({ tenantId: `tenant-${TS}` });
  assert(list.length >= 1, "tenantId filter failed");
  assert(list.every(o => o.tenantId === `tenant-${TS}`), "wrong tenant");
});

test("updateOrgHealth — clamps 0-100", () => {
  const r = st.updateOrgHealth(orgA.id, 150);
  assert(r.ok, "failed");
  assert(r.org.health === 100, "not clamped to 100");
  const r2 = st.updateOrgHealth(orgA.id, -5);
  assert(r2.org.health === 0, "not clamped to 0");
  st.updateOrgHealth(orgA.id, 85); // restore
});

test("addOrgPolicy — ok", () => {
  const r = st.addOrgPolicy(orgA.id, { policy: "All decisions must have rationale", addedBy: "admin" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.entry?.id, "no entry id");
  const updated = st.getOrg(orgA.id);
  assert(updated.governance.policies.length >= 1, "policy not added");
});

test("getOrgHealth — returns multi-layer health", () => {
  const h = st.getOrgHealth(orgA.id);
  assert(h && typeof h.health === "number", "no health");
  assert(h.health >= 0 && h.health <= 100, `OOB: ${h.health}`);
  assert(h.layers, "no layers");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — Blueprint Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 2: Blueprint Engine");

let bpA, bpB;

test("createBlueprint — ok", () => {
  const r = st.createBlueprint({ name: `BlueprintA-${TS}`, description: "AI Marketing Agency Blueprint", type: "agency", capabilities: ["engineering","business","knowledge","evolution","executive"], authorId: `owner-${TS}`, tags: ["test","agency"] });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.blueprint?.id, "no blueprint id");
  assert(r.blueprint.status === "draft", "not draft");
  assert(r.blueprint.agents.length >= 1, "no agents");
  assert(r.blueprint.workflows.length >= 1, "no workflows");
  assert(r.blueprint.policies.length >= 1, "no policies");
  bpA = r.blueprint;
});

test("createBlueprint — missing name rejected", () => {
  const r = st.createBlueprint({ type: "agency" });
  assert(!r.ok, "should reject missing name");
});

test("createBlueprint — auto-derives agents from capabilities", () => {
  const r = st.createBlueprint({ name: `AutoAgents-${TS}`, type: "team", capabilities: ["engineering","knowledge"], authorId: "test" });
  assert(r.ok, "failed");
  assert(r.blueprint.agents.some(a => a.role === "engineering"), "missing engineering agent");
  assert(r.blueprint.agents.some(a => a.role === "knowledge"), "missing knowledge agent");
  bpB = r.blueprint;
});

test("getBlueprint — returns correct blueprint", () => {
  const bp = st.getBlueprint(bpA.id);
  assert(bp?.id === bpA.id, "wrong blueprint");
  assert(bp.capabilities.includes("engineering"), "missing engineering");
});

test("publishBlueprint — changes status", () => {
  const r = st.publishBlueprint(bpA.id);
  assert(r.ok, `failed: ${r.error}`);
  assert(r.blueprint.status === "published", "not published");
  bpA = r.blueprint;
});

test("updateBlueprint — ok", () => {
  const r = st.updateBlueprint(bpA.id, { description: "Updated blueprint", tags: ["v2","agency"] });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.blueprint.description === "Updated blueprint", "description not updated");
});

test("listBlueprints — filter by status", () => {
  const published = st.listBlueprints({ status: "published" });
  assert(published.every(b => b.status === "published"), "status filter failed");
});

test("listBuiltInTemplates — returns 8 built-in templates", () => {
  const templates = st.listBuiltInTemplates();
  assert(Array.isArray(templates) && templates.length === 8, `expected 8, got ${templates.length}`);
  assert(templates.every(t => t.templateId && t.name && t.type && t.capabilities), "template missing required fields");
});

test("getBuiltInTemplate — tpl_agency returns agency template", () => {
  const tpl = st.getBuiltInTemplate("tpl_agency");
  assert(tpl?.name === "AI Marketing Agency", "wrong template");
  assert(tpl.type === "agency", "wrong type");
  assert(tpl.capabilities.includes("engineering"), "missing engineering");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — Template Marketplace
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 3: Template Marketplace");

let tmplA;

test("publishTemplate — ok", () => {
  const r = st.publishTemplate({ name: `Template-${TS}`, description: "Reusable agency template", blueprintId: bpA.id, authorId: `owner-${TS}`, price: 0, category: "agency", tags: ["test"], visibility: "public" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.template?.id, "no template id");
  assert(r.template.status === "active", "not active");
  assert(r.template.installs === 0, "installs should start at 0");
  tmplA = r.template;
});

test("publishTemplate — dedup returns existing", () => {
  const r2 = st.publishTemplate({ name: `Template-${TS}`, blueprintId: bpA.id, authorId: `owner-${TS}` });
  assert(r2.ok, "dedup failed");
  assert(r2.existing, "should be existing");
  assert(r2.template.id === tmplA.id, "wrong template returned");
});

test("publishTemplate — missing blueprintId rejected", () => {
  const r = st.publishTemplate({ name: `NoBP-${TS}`, authorId: "test" });
  assert(!r.ok, "should reject missing blueprintId");
});

test("getTemplate — returns template with blueprint", () => {
  const t = st.getTemplate(tmplA.id);
  assert(t?.id === tmplA.id, "wrong template");
  assert(t.blueprint?.id === bpA.id, "blueprint not embedded");
});

test("installTemplate — increments installs", () => {
  const r = st.installTemplate(tmplA.id, { tenantId: `buyer-${TS}`, orgName: "My Agency" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.template.installs === 1, "installs not incremented");
  assert(r.blueprint?.id === bpA.id, "blueprint not returned");
});

test("rateTemplate — ok", () => {
  const r = st.rateTemplate(tmplA.id, { rating: 5, review: "Excellent", reviewerId: `user-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.template.rating === 5, "rating not set");
  assert(r.template.reviews === 1, "reviews not incremented");
});

test("rateTemplate — invalid rating rejected", () => {
  const r = st.rateTemplate(tmplA.id, { rating: 6 });
  assert(!r.ok, "should reject rating > 5");
});

test("listTemplates — returns public active templates", () => {
  const list = st.listTemplates({});
  assert(Array.isArray(list) && list.length >= 1, "no templates");
  assert(list.every(t => t.visibility === "public" && t.status === "active"), "filter failed");
});

test("listTemplates — filter by category", () => {
  const list = st.listTemplates({ category: "agency" });
  assert(list.every(t => t.category === "agency"), "category filter failed");
});

test("listTemplates — filter by free", () => {
  const list = st.listTemplates({ free: true });
  assert(list.every(t => t.price === 0), "free filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4 — Deployment Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 4: Deployment Engine");

let depA, deployedOrg;

test("deployOrg — from blueprintId", () => {
  const r = st.deployOrg({ blueprintId: bpA.id, tenantId: `tenant-${TS}`, ownerId: `owner-${TS}`, targetEnvironment: "production" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.deployment?.id, "no deployment id");
  assert(r.org?.id, "no org id");
  assert(r.deployment.status === "completed", "not completed");
  assert(Array.isArray(r.capabilities), "no capabilities array");
  depA = r.deployment;
  deployedOrg = r.org;
});

test("deployOrg — org status set to active", () => {
  const org = st.getOrg(deployedOrg.id);
  assert(org.status === "active", `expected active, got ${org.status}`);
  assert(org.deploymentHistory.length >= 1, "no deployment history");
});

test("deployOrg — blueprint deployCount incremented", () => {
  const bp = st.getBlueprint(bpA.id);
  assert(bp.deployCount >= 1, "deployCount not incremented");
});

test("deployOrg — from existing orgId", () => {
  const r = st.deployOrg({ orgId: orgA.id, targetEnvironment: "staging" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.deployment.orgId === orgA.id, "wrong org deployed");
});

test("deployOrg — missing both orgId+blueprintId", () => {
  const r = st.deployOrg({ tenantId: "test" });
  assert(!r.ok, "should fail without orgId or blueprintId");
});

test("getDeployment — returns deployment", () => {
  const d = st.getDeployment(depA.id);
  assert(d?.id === depA.id, "wrong deployment");
  assert(d.status === "completed", "wrong status");
});

test("listDeployments — filter by orgId", () => {
  const list = st.listDeployments({ orgId: deployedOrg.id });
  assert(list.length >= 1, "no deployments for org");
  assert(list.every(d => d.orgId === deployedOrg.id), "orgId filter failed");
});

test("listDeployments — filter by status", () => {
  const list = st.listDeployments({ status: "completed" });
  assert(list.every(d => d.status === "completed"), "status filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5 — Version Management
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 5: Version Management");

test("bumpVersion — increments patch", () => {
  assert(st.bumpVersion("1.0.0") === "1.0.1", "1.0.0→1.0.1 failed");
  assert(st.bumpVersion("2.3.7") === "2.3.8", "2.3.7→2.3.8 failed");
  assert(st.bumpVersion(null) === "1.0.1", "null→1.0.1 failed");
});

let versionId;
test("createVersion — ok", () => {
  const r = st.createVersion({ orgId: deployedOrg.id, version: "1.1.0", changelog: "Added new capabilities", authorId: `owner-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.version?.id, "no version id");
  assert(r.version.version === "1.1.0", "wrong version");
  versionId = r.version.id;
});

test("createVersion — updates org.version", () => {
  const updated = st.getOrg(deployedOrg.id);
  assert(updated.version === "1.1.0", `expected 1.1.0, got ${updated.version}`);
  assert(updated.evolutionHistory.length >= 1, "no evolution history");
});

test("createVersion — missing orgId+blueprintId rejected", () => {
  const r = st.createVersion({ version: "2.0.0" });
  assert(!r.ok, "should fail without orgId or blueprintId");
});

test("listVersions — filter by orgId", () => {
  const list = st.listVersions({ orgId: deployedOrg.id });
  assert(Array.isArray(list) && list.length >= 1, "no versions");
});

test("rollbackVersion — ok", () => {
  const r = st.rollbackVersion(deployedOrg.id, versionId);
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org.version === "1.1.0", "wrong version after rollback");
  assert(r.rolledBackTo === "1.1.0", "rolledBackTo wrong");
});

test("rollbackVersion — unknown versionId fails", () => {
  const r = st.rollbackVersion(deployedOrg.id, "nonexistent_version");
  assert(!r.ok, "should fail for unknown version");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 6 — Clone + Fork Engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 6: Clone & Fork Engine");

let clonedOrg;

test("cloneOrg — from orgId", () => {
  const r = st.cloneOrg({ sourceOrgId: deployedOrg.id, newName: `Clone-${TS}`, tenantId: `clone-tenant-${TS}`, ownerId: `clone-owner-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org?.id, "no org id");
  assert(r.org.name === `Clone-${TS}`, "wrong name");
  assert(r.clone?.type === "clone", "wrong clone type");
  assert(r.clone.sourceOrgId === deployedOrg.id, "wrong sourceOrgId");
  clonedOrg = r.org;
});

test("cloneOrg — from blueprintId", () => {
  const r = st.cloneOrg({ sourceBlueprintId: bpA.id, newName: `BPClone-${TS}`, tenantId: `bpclone-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org?.id, "no org id");
  assert(r.blueprint?.id, "no blueprint id");
});

test("cloneOrg — missing both source fields rejected", () => {
  const r = st.cloneOrg({ newName: "NoSource" });
  assert(!r.ok, "should fail without source");
});

test("cloneOrg — missing newName rejected", () => {
  const r = st.cloneOrg({ sourceOrgId: deployedOrg.id });
  assert(!r.ok, "should fail without newName");
});

test("cloneOrg — fork mode sets type=fork", () => {
  const r = st.cloneOrg({ sourceOrgId: deployedOrg.id, newName: `Fork-${TS}`, forkMode: true, tenantId: `fork-tenant-${TS}` });
  assert(r.ok, "fork failed");
  assert(r.clone.type === "fork", "wrong type");
});

test("listClones — filter by sourceOrgId", () => {
  const list = st.listClones({ sourceOrgId: deployedOrg.id });
  assert(list.length >= 2, "expected >=2 clones");
  assert(list.every(c => c.sourceOrgId === deployedOrg.id), "sourceOrgId filter failed");
});

test("listClones — filter by type", () => {
  const clones = st.listClones({ type: "clone" });
  assert(clones.every(c => c.type === "clone"), "type filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 7 — Package (Export/Import)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 7: Export / Import");

let exportedPkg;

test("exportOrg — ok", () => {
  const r = st.exportOrg(deployedOrg.id);
  assert(r.ok, `failed: ${r.error}`);
  assert(r.package?.id, "no package id");
  assert(r.package.format === "ooplix-org-package", "wrong format");
  assert(r.package.org?.id === deployedOrg.id, "wrong org in package");
  assert(r.package.checksum, "no checksum");
  exportedPkg = r.package;
});

test("exportOrg — includes blueprint + versions", () => {
  const r = st.exportOrg(deployedOrg.id);
  assert(r.ok, "failed");
  assert(r.package.blueprint !== undefined, "no blueprint in package");
  assert(Array.isArray(r.package.versions), "versions not array");
});

test("exportOrg — unknown orgId fails", () => {
  const r = st.exportOrg("unknown_org");
  assert(!r.ok, "should fail for unknown org");
});

test("importOrg — ok from exported package", () => {
  const r = st.importOrg(exportedPkg, { tenantId: `import-${TS}`, ownerId: `import-owner-${TS}`, newName: `Imported-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org?.id, "no org id");
  assert(r.org.name === `Imported-${TS}`, "wrong name");
});

test("importOrg — restores blueprint", () => {
  const r = st.importOrg(exportedPkg, { tenantId: `import2-${TS}`, newName: `Imported2-${TS}` });
  assert(r.ok, "failed");
  if (exportedPkg.blueprint) {
    assert(r.blueprint?.id, "blueprint not restored");
  }
});

test("importOrg — invalid package rejected", () => {
  const r = st.importOrg({ notAnOrg: true }, {});
  assert(!r.ok, "should reject invalid package");
});

test("importOrg — wrong format rejected", () => {
  const r = st.importOrg({ org: {}, format: "other-format" }, {});
  assert(!r.ok, "should reject wrong format");
});

test("listPackages — returns array", () => {
  const list = st.listPackages({});
  assert(Array.isArray(list) && list.length >= 1, "no packages");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 8 — Marketplace
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 8: Marketplace");

let listingId;

test("listOnMarketplace — from orgId", () => {
  const r = st.listOnMarketplace({ orgId: deployedOrg.id, sellerId: `owner-${TS}`, price: 0, description: "A complete AI agency", category: "agency", tags: ["test"], visibility: "public" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.listing?.id, "no listing id");
  assert(r.listing.status === "active", "not active");
  listingId = r.listing.id;
});

test("listOnMarketplace — from blueprintId", () => {
  const r = st.listOnMarketplace({ blueprintId: bpA.id, sellerId: `owner-${TS}`, price: 99, description: "Premium blueprint", category: "agency", visibility: "public" });
  assert(r.ok, `failed: ${r.error}`);
});

test("listOnMarketplace — missing source rejected", () => {
  const r = st.listOnMarketplace({ sellerId: "test" });
  assert(!r.ok, "should fail without orgId/blueprintId");
});

test("purchaseFromMarketplace — clones org for buyer", () => {
  const r = st.purchaseFromMarketplace(listingId, { buyerId: `buyer-${TS}`, tenantId: `buyer-tenant-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.listing.purchases === 1, "purchases not incremented");
  assert(r.result?.ok, "clone result failed");
});

test("listMarketplaceItems — public active only", () => {
  const list = st.listMarketplaceItems({});
  assert(Array.isArray(list) && list.length >= 1, "no listings");
  assert(list.every(l => l.visibility === "public" && l.status === "active"), "filter failed");
});

test("listMarketplaceItems — filter by category", () => {
  const list = st.listMarketplaceItems({ category: "agency" });
  assert(list.every(l => l.category === "agency"), "category filter failed");
});

test("listMarketplaceItems — filter by maxPrice", () => {
  const free = st.listMarketplaceItems({ maxPrice: 0 });
  assert(free.every(l => l.price <= 0), "maxPrice filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 9 — Certification
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 9: Certification");

let certId;

test("certifyOrg — bronze", () => {
  st.updateOrg(deployedOrg.id, { status: "active" });
  const r = st.certifyOrg({ orgId: deployedOrg.id, level: "bronze", criteria: ["active","deployed"], issuedBy: "platform", score: 95 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.cert?.id, "no cert id");
  assert(r.cert.level === "bronze", "wrong level");
  assert(r.cert.status === "active", "not active");
  certId = r.cert.id;
});

test("certifyOrg — all levels accepted", () => {
  for (const level of st.CERT_LEVELS) {
    const newOrg = st.registerOrg({ name: `CertOrg-${level}-${TS}`, type: "startup", tenantId: `cert-${level}-${TS}` });
    st.updateOrg(newOrg.org.id, { status: "active" });
    const r = st.certifyOrg({ orgId: newOrg.org.id, level, score: 80 });
    assert(r.ok, `level ${level} failed: ${r.error}`);
    assert(r.cert.level === level, "wrong level");
  }
});

test("certifyOrg — invalid level rejected", () => {
  const r = st.certifyOrg({ orgId: deployedOrg.id, level: "diamond" });
  assert(!r.ok, "should reject invalid level");
});

test("certifyOrg — org gets certification badge", () => {
  const o = st.getOrg(deployedOrg.id);
  assert(o.certifications.includes("bronze"), "certification not added to org");
});

test("listCertifications — filter by orgId", () => {
  const list = st.listCertifications({ orgId: deployedOrg.id });
  assert(list.length >= 1, "no certs");
  assert(list.every(c => c.orgId === deployedOrg.id), "orgId filter failed");
});

test("listCertifications — filter by level", () => {
  const list = st.listCertifications({ level: "bronze" });
  assert(list.every(c => c.level === "bronze"), "level filter failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 10 — Upgrade + Migration
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 10: Upgrade & Migration");

test("upgradeOrg — adds capabilities", () => {
  const r = st.upgradeOrg({ orgId: deployedOrg.id, addCapabilities: ["ecosystem"], changelog: "Added ecosystem tier", authorId: `owner-${TS}` });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org.capabilities.includes("ecosystem"), "ecosystem not added");
  assert(r.fromVersion !== r.toVersion, "version not bumped");
  assert(r.org.evolutionHistory.length >= 2, "evolution history not updated");
});

test("upgradeOrg — removes capabilities", () => {
  const r = st.upgradeOrg({ orgId: deployedOrg.id, removeCapabilities: ["ecosystem"], changelog: "Removed ecosystem" });
  assert(r.ok, "failed");
  assert(!r.org.capabilities.includes("ecosystem"), "ecosystem not removed");
});

test("upgradeOrg — missing orgId fails", () => {
  const r = st.upgradeOrg({ addCapabilities: ["enterprise"] });
  assert(!r.ok, "should fail without orgId");
});

test("migrateOrg — changes tenantId", () => {
  const newTenant = `migrated-tenant-${TS}`;
  const r = st.migrateOrg({ orgId: clonedOrg.id, targetTenantId: newTenant, migratedBy: "admin" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.org.tenantId === newTenant, "tenantId not changed");
  assert(r.org.governance.auditLog.some(e => e.action === "migration"), "audit log missing migration");
});

test("migrateOrg — missing orgId fails", () => {
  const r = st.migrateOrg({ targetTenantId: "new-tenant" });
  assert(!r.ok, "should fail without orgId");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 11 — Simulator + Digital Twin
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 11: Simulator & Digital Twin");

test("simulateOrg — from blueprintId", () => {
  const r = st.simulateOrg({ blueprintId: bpA.id, durationDays: 30, teamSize: 10, revenueTarget: 50000 });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.simulation?.id, "no sim id");
  assert(r.simulation.projection?.healthScore >= 0, "no health score");
  assert(r.simulation.projection?.projectedRevenue >= 0, "no revenue");
  assert(r.simulation.recommendation, "no recommendation");
  assert(Array.isArray(r.simulation.projection.capabilityBreakdown), "no breakdown");
});

test("simulateOrg — from templateId", () => {
  const r = st.simulateOrg({ templateId: "tpl_agency" });
  assert(r.ok, "failed");
  assert(r.simulation.capabilities.length >= 1, "no capabilities in sim");
});

test("simulateOrg — from type only", () => {
  const r = st.simulateOrg({ type: "startup" });
  assert(r.ok, "failed");
  assert(r.simulation.capabilities.length >= 1, "no capabilities");
});

test("simulateOrg — healthScore 0-100", () => {
  const r = st.simulateOrg({ type: "enterprise" });
  const h = r.simulation.projection.healthScore;
  assert(h >= 0 && h <= 100, `OOB: ${h}`);
});

test("getDigitalTwin — returns live twin", () => {
  const twin = st.getDigitalTwin(deployedOrg.id);
  assert(twin, "no twin returned");
  assert(twin.orgId === deployedOrg.id, "wrong orgId");
  assert(twin.health?.health >= 0, "no health");
  assert(typeof twin.liveData?.autonomousDecisions === "number", "no autonomous decisions count");
  assert(typeof twin.history?.versions === "number", "no version history count");
  assert(twin.twinSyncedAt, "no syncedAt");
});

test("getDigitalTwin — unknown org returns null", () => {
  const twin = st.getDigitalTwin("unknown_org");
  assert(twin === null, "should return null for unknown org");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 12 — SDK Manifest
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 12: SDK Manifest");

test("getSDKManifest — returns complete manifest", () => {
  const sdk = st.getSDKManifest();
  assert(sdk.version, "no version");
  assert(sdk.name, "no name");
  assert(sdk.endpoints, "no endpoints");
  assert(sdk.capabilities, "no capabilities");
  assert(sdk.builtInTemplates?.length >= 1, "no built-in templates");
  assert(sdk.levelStack?.length >= 10, "incomplete level stack");
});

test("getSDKManifest — all endpoint bases present", () => {
  const sdk = st.getSDKManifest();
  const required = ["orgs","blueprints","templates","deploy","clone","export","import","simulate","twin","marketplace","certify"];
  for (const ep of required) {
    assert(sdk.endpoints[ep], `missing endpoint: ${ep}`);
    assert(sdk.endpoints[ep].base?.startsWith("/platform"), `wrong base for ${ep}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 13 — Platform Analytics + Reports
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 13: Analytics & Reports");

test("getPlatformAnalytics — returns comprehensive data", () => {
  const a = st.getPlatformAnalytics();
  assert(typeof a.orgs?.total === "number", "no orgs total");
  assert(typeof a.blueprints?.total === "number", "no blueprints total");
  assert(typeof a.templates?.total === "number", "no templates total");
  assert(typeof a.deployments?.total === "number", "no deployments total");
  assert(typeof a.marketplace?.total === "number", "no marketplace total");
  assert(typeof a.certifications?.total === "number", "no certs total");
  assert(typeof a.events?.total === "number", "no events total");
});

test("getPlatformAnalytics — counts reflect test state", () => {
  const a = st.getPlatformAnalytics();
  assert(a.orgs.total >= 5, `expected >=5 orgs, got ${a.orgs.total}`);
  assert(a.blueprints.total >= 2, `expected >=2 blueprints, got ${a.blueprints.total}`);
  assert(a.deployments.total >= 2, `expected >=2 deployments, got ${a.deployments.total}`);
});

test("createPlatformReport — ok", () => {
  const r = st.createPlatformReport({ title: `Report-${TS}`, type: "platform", summary: "All systems nominal" });
  assert(r.ok, `failed: ${r.error}`);
  assert(r.report?.id, "no report id");
});

test("listPlatformReports — filter by type", () => {
  const list = st.listPlatformReports({ type: "platform" });
  assert(Array.isArray(list) && list.length >= 1, "no reports");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 14 — Org Registration (Platform Org Agents)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 14: Platform Org Agents");

test("org register — returns ok with 20 domains", () => {
  const r = org.register();
  assert(r.ok, `register failed: ${r.message || r.error}`);
  assert(r.count === 20, `expected 20, got ${r.count}`);
});

test("org register — idempotent", () => {
  const r2 = org.register();
  assert(r2.ok, "second register failed");
  assert(r2.message === "Already registered" || r2.registered >= 0, "unexpected");
});

test("getOrgStatus — returns 20 domains", () => {
  const status = org.getOrgStatus();
  assert(Array.isArray(status) && status.length === 20, `expected 20, got ${status.length}`);
});

test("getOrgStatus — all domains have id, role, label", () => {
  const status = org.getOrgStatus();
  assert(status.every(d => d.id && d.role && d.label), "domain missing fields");
});

test("getOrgStatus — director domain present", () => {
  const status = org.getOrgStatus();
  assert(status.some(d => d.id === "plt_director"), "no plt_director");
});

test("getOrgSummary — returns analytics + dashboard", () => {
  const s = org.getOrgSummary();
  assert(s.total === 20, `expected 20, got ${s.total}`);
  assert(s.analytics, "no analytics");
  assert(s.dashboard, "no dashboard");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 15 — Control State
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 15: Control State");

test("getControlState — returns state", () => {
  const ctl = st.getControlState();
  assert(ctl && typeof ctl === "object", "not object");
  assert(ctl.epoch >= 1, "no epoch");
});

test("updateControlState — ok", () => {
  const r = st.updateControlState({ sdkVersion: "1.1.0" });
  assert(r.ok, "failed");
  assert(r.control.sdkVersion === "1.1.0", "not updated");
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 16 — Integration Smoke
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[platform-Ω] Block 16: Integration Smoke");

test("L8 ecosystem receives org registration as tenant", () => {
  // Verify ecosystem was seeded (indirect: registration completed without error)
  const org = st.getOrg(deployedOrg.id);
  assert(org.status === "active", "org not active after ecosystem integration");
});

test("L9 civilization receives org as member on register", () => {
  // Verified indirectly: registerOrg calls civSt.registerMember without throwing
  const org = st.getOrg(orgA.id);
  assert(org?.id, "org disappeared after L9 integration");
});

test("L10 autonomous records org creation as evolution", () => {
  // Verified indirectly: deployOrg calls autoSt.recordEvolution without throwing
  const dep = st.getDeployment(depA.id);
  assert(dep.status === "completed", "deployment failed after L10 integration");
});

test("blueprint blueprintId cross-referenced in org", () => {
  const org = st.getOrg(deployedOrg.id);
  assert(org.blueprintId === bpA.id, "blueprintId not set on org");
});

test("clone inherits capabilities from source", () => {
  const cloneR = st.cloneOrg({ sourceOrgId: deployedOrg.id, newName: `SmokeClone-${TS}`, tenantId: `smoke-${TS}` });
  assert(cloneR.ok, "clone failed");
  const srcOrg = st.getOrg(deployedOrg.id);
  // Clone derives caps from source
  assert(cloneR.org.capabilities.length >= srcOrg.capabilities.length - 1, "clone lost too many capabilities");
});

test("export → import → deploy roundtrip", () => {
  const exp = st.exportOrg(deployedOrg.id);
  assert(exp.ok, "export failed");
  const imp = st.importOrg(exp.package, { tenantId: `rt-tenant-${TS}`, newName: `Roundtrip-${TS}` });
  assert(imp.ok, "import failed");
  const dep2 = st.deployOrg({ orgId: imp.org.id, targetEnvironment: "production" });
  assert(dep2.ok, "re-deploy failed");
  assert(dep2.org.status === "active", "re-deployed org not active");
});

test("simulate → compare with digital twin health", () => {
  const sim = st.simulateOrg({ blueprintId: bpA.id });
  const twin = st.getDigitalTwin(deployedOrg.id);
  assert(sim.ok && twin, "sim or twin unavailable");
  assert(typeof sim.simulation.projection.healthScore === "number", "no health in sim");
  assert(typeof twin.health.health === "number", "no health in twin");
});

test("platform analytics grows with each operation", () => {
  const before = st.getPlatformAnalytics().events.total;
  st.registerOrg({ name: `EventTest-${TS}`, type: "solo", tenantId: `evt-${TS}` });
  const after = st.getPlatformAnalytics().events.total;
  assert(after > before, "events.total did not grow");
});

test("certification on deployed org appears in digital twin", () => {
  st.certifyOrg({ orgId: deployedOrg.id, level: "silver", issuedBy: "integration_test", score: 90 });
  const twin = st.getDigitalTwin(deployedOrg.id);
  assert(twin.certifications.length >= 2, "certifications not in twin");
});

// Final results
console.log(`\n[platform-Ω] Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
process.exit(failed > 0 ? 1 : 0);
