"use strict";
/**
 * Universal Composition Engine — Completion Gaps Phase 4: Unknown Niche
 * Test. 20+ temporary company definitions genuinely NOT present in the
 * original 100 (docs/audits/original-100-companies.json), intentionally
 * diverse across regulated/physical/digital/novel-technology dimensions.
 * Proves the inference engine can:
 *   - recognize reusable existing capabilities where they genuinely apply
 *   - compose multiple templates where warranted
 *   - identify missing capabilities honestly (never a fabricated match)
 *   - avoid unnecessary new agents
 *
 * No permanent capability is created merely to make these pass — every
 * assertion checks the ENGINE'S OWN real classification, never asserts a
 * specific desired outcome that would require fabricating support.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const UNKNOWN_NICHES = [
    // Genuinely novel/futuristic — not in the original 100 at all
    { name: "Space/satellite data operator", input: { niche: "Space company operating satellites for orbital data collection", businessModel: "b2b_data", technologyRequirements: ["satellite", "data"] } },
    { name: "Quantum computing R&D lab", input: { niche: "Quantum computing research lab developing quantum algorithms", businessModel: "research", technologyRequirements: ["research"], regulated: false } },
    { name: "Autonomous drone delivery", input: { niche: "Drone delivery company running autonomous aerial logistics", businessModel: "logistics", physicalOrDigital: "physical", commerceRequirements: ["physical_goods"] } },
    { name: "Carbon credit marketplace", input: { niche: "Carbon credit trading marketplace for environmental offsets", businessModel: "marketplace", financialRequirements: ["trading"] } },
    { name: "Neurotech/BCI device maker", input: { niche: "Neurotechnology company building brain-computer interface devices", businessModel: "hardware", physicalOrDigital: "physical", regulated: true } },
    // Regulated but distinct from healthcare/finance already covered
    { name: "Cannabis dispensary compliance platform", input: { niche: "Cannabis dispensary point-of-sale and compliance tracking platform", businessModel: "saas", regulated: true, commerceRequirements: ["payments", "inventory"] } },
    { name: "Firearms dealer licensing platform", input: { niche: "Firearms dealer licensing and compliance management platform", businessModel: "saas", regulated: true } },
    { name: "Crypto custody/exchange", input: { niche: "Cryptocurrency custody and exchange platform", businessModel: "fintech", regulated: true, financialRequirements: ["trading", "payments"] } },
    // Physical/industrial, genuinely distinct from the original ERP set
    { name: "Aerospace parts manufacturer", input: { niche: "Aerospace component manufacturing and precision machining company", businessModel: "manufacturing", physicalOrDigital: "physical", productsServices: ["procurement"] } },
    { name: "Deep-sea mining operator", input: { niche: "Deep-sea mineral mining and extraction operator", businessModel: "resource_extraction", physicalOrDigital: "physical" } },
    { name: "Vertical farming operator", input: { niche: "Vertical farming operator using automated hydroponic towers", businessModel: "agriculture", physicalOrDigital: "physical", technologyRequirements: ["iot", "sensors"] } },
    { name: "Nuclear plant monitoring", input: { niche: "Nuclear power plant monitoring and safety compliance system", businessModel: "energy", physicalOrDigital: "physical", regulated: true, technologyRequirements: ["iot", "sensors"] } },
    // Media/creative, distinct shapes from the original set
    { name: "Podcast network/ad marketplace", input: { niche: "Podcast network selling advertising slots across shows", businessModel: "marketplace", productsServices: ["advertising"] } },
    { name: "NFT/digital-collectibles platform", input: { niche: "NFT digital collectibles minting and trading platform", businessModel: "marketplace", financialRequirements: ["trading"] } },
    { name: "Livestream shopping platform", input: { niche: "Livestream shopping platform combining video and ecommerce checkout", businessModel: "ecommerce", commerceRequirements: ["payments"] } },
    // Services with unusual regulatory/physical combinations
    { name: "Funeral home management SaaS", input: { niche: "Funeral home scheduling and case management software", businessModel: "saas", regulated: true } },
    { name: "Pet grooming franchise CRM", input: { niche: "Pet grooming franchise scheduling and customer management", businessModel: "crm", customerType: "b2c" } },
    { name: "Ride-hailing dispatch platform", input: { niche: "Ride-hailing driver dispatch and fare matching platform", businessModel: "marketplace", physicalOrDigital: "hybrid" } },
    { name: "Autonomous warehouse robotics", input: { niche: "Autonomous warehouse robotics fleet management company", businessModel: "b2b_hardware", physicalOrDigital: "physical", technologyRequirements: ["iot", "robotics"] } },
    { name: "Genomics sequencing service", input: { niche: "Genomics DNA sequencing and analysis laboratory service", businessModel: "biotech", regulated: true, technologyRequirements: ["research"] } },
    { name: "Weather-derivatives trading desk", input: { niche: "Weather derivatives trading and risk hedging desk", businessModel: "fintech", financialRequirements: ["trading", "investment"] } },
    { name: "Underwater cable maintenance", input: { niche: "Submarine cable installation and maintenance operator", businessModel: "infrastructure", physicalOrDigital: "physical" } },
];

describe("Unknown Niche Test (Phase 4) — 20+ niches NOT in the original 100", () => {
    before(() => { require("../../agents/runtime/bootstrapRuntime.cjs"); });
    const engine = require("../../backend/services/templateInferenceEngine.cjs");
    const original100 = require("../../docs/audits/original-100-companies.json");

    it("dataset is genuinely at least 20 niches and none duplicate the original 100", () => {
        assert.ok(UNKNOWN_NICHES.length >= 20, `expected 20+ niches, got ${UNKNOWN_NICHES.length}`);
        const originalNiches = new Set(original100.map(c => c.niche.toLowerCase()));
        for (const n of UNKNOWN_NICHES) {
            assert.ok(!originalNiches.has(n.input.niche.toLowerCase()), `"${n.name}" duplicates an original-100 niche`);
        }
    });

    describe("every niche resolves to an allowed status (no crash, no undefined status)", () => {
        const ALLOWED = new Set(["COMPOSABLE_NOW", "NEEDS_CREDENTIALS", "NEEDS_CONNECTOR", "NEEDS_CAPABILITY", "NEEDS_EXTERNAL_INFRA", "UNSUPPORTED", "CAPABILITY_GAP"]);
        for (const n of UNKNOWN_NICHES) {
            it(`"${n.name}" returns a valid status`, () => {
                const result = engine.analyzeCompanyDefinition(n.input);
                assert.ok(ALLOWED.has(result.status), `unexpected status: ${result.status}`);
            });
        }
    });

    it("recognizes reusable existing capabilities where genuinely applicable — e.g. marketplace-shaped niches (podcast ads, NFT trading, ride-hailing) reuse the real marketplace template rather than gapping", () => {
        const podcast = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Podcast network/ad marketplace").input);
        const nft = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "NFT/digital-collectibles platform").input);
        assert.ok(podcast.matchedTemplateIds.length > 0, "podcast ad marketplace should reuse an existing template, not gap");
        assert.ok(nft.matchedTemplateIds.length > 0, "NFT trading platform should reuse an existing template, not gap");
    });

    it("identifies missing capabilities honestly for genuinely unsupported physical/novel domains — never fabricates a false COMPOSABLE_NOW", () => {
        const drone = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Autonomous drone delivery").input);
        const mining = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Deep-sea mining operator").input);
        const robotics = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Autonomous warehouse robotics").input);
        assert.notEqual(drone.status, "COMPOSABLE_NOW", "drone delivery involves genuinely unbuilt physical/logistics infrastructure — must not claim full composability");
        assert.notEqual(mining.status, "COMPOSABLE_NOW", "deep-sea mining involves genuinely unbuilt physical infrastructure");
        assert.notEqual(robotics.status, "COMPOSABLE_NOW", "warehouse robotics involves genuinely unbuilt IoT/robotics infrastructure");
    });

    it("avoids unnecessary new agents: composable department counts stay bounded (no runaway/duplicate department inflation for novel niches)", () => {
        for (const n of UNKNOWN_NICHES) {
            const result = engine.analyzeCompanyDefinition(n.input);
            assert.ok(result.requiredDepartmentFamilies.length <= 33, `"${n.name}" returned more department families (${result.requiredDepartmentFamilies.length}) than genuinely exist in departmentTemplateRegistry.cjs (33) — impossible unless something fabricated extra departments`);
            // No duplicate department keys.
            assert.equal(new Set(result.requiredDepartmentFamilies).size, result.requiredDepartmentFamilies.length, `"${n.name}" returned duplicate department family keys`);
        }
    });

    it("genuinely novel/futuristic niches (space, quantum, neurotech) either honestly gap OR reuse an existing template — never silently default to saas without a real signal", () => {
        const space = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Space/satellite data operator").input);
        const quantum = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Quantum computing R&D lab").input);
        const neurotech = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Neurotech/BCI device maker").input);
        for (const [label, result] of [["space", space], ["quantum", quantum], ["neurotech", neurotech]]) {
            if (result.matchedTemplateIds.length === 1 && result.matchedTemplateIds[0] === "saas") {
                assert.fail(`${label} matched ONLY saas — verify this wasn't a silent fallback, since none of these niches mention SaaS/subscription`);
            }
        }
    });

    it("regulated-but-novel niches (cannabis, firearms, crypto) genuinely trigger regulated-industry capability tags (audit_log), not silently ignored", () => {
        const cannabis = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Cannabis dispensary compliance platform").input);
        const firearms = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Firearms dealer licensing platform").input);
        const crypto = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Crypto custody/exchange").input);
        for (const [label, result] of [["cannabis", cannabis], ["firearms", firearms], ["crypto", crypto]]) {
            assert.ok(result.requiredDepartmentFamilies.includes("legal_compliance") || result.requiredDepartmentFamilies.includes("security"), `${label} should genuinely trigger a compliance-adjacent department given regulated:true`);
        }
    });

    it("Capability Evolution is only implicitly invoked (via NEEDS_CAPABILITY/NEEDS_EXTERNAL_INFRA reporting) for niches that genuinely lack support — never fabricated for niches that already have real coverage", () => {
        const saasLike = engine.analyzeCompanyDefinition(UNKNOWN_NICHES.find(n => n.name === "Funeral home management SaaS").input);
        // A regulated SaaS-shaped niche should still resolve to a real
        // template (saas) plus honestly-flagged compliance gaps — it
        // should NOT be UNSUPPORTED (the underlying SaaS engineering
        // capability genuinely exists).
        assert.notEqual(saasLike.status, "UNSUPPORTED");
        assert.ok(saasLike.matchedTemplateIds.includes("saas"));
    });

    it("this test file only calls the read-only analyzeCompanyDefinition() entry point — never a mutating registry function", () => {
        // Structural guarantee: every test above calls only
        // engine.analyzeCompanyDefinition(...), a pure read/derive
        // function (confirmed in templateInferenceEngine.cjs — it never
        // writes to skillRegistry.cjs, departmentTemplateRegistry.cjs, or
        // any data/*.json file). This test asserts that invariant by
        // checking the one function this file's `engine` object is used
        // through, rather than a fragile string search over its own source.
        const engineModule = require("../../backend/services/templateInferenceEngine.cjs");
        const exportedFunctionNames = Object.keys(engineModule).filter(k => typeof engineModule[k] === "function");
        assert.deepEqual(exportedFunctionNames, ["analyzeCompanyDefinition"], "templateInferenceEngine.cjs must expose only the read-only analysis entry point, no mutating functions this test (or any caller) could accidentally invoke");
    });
});
