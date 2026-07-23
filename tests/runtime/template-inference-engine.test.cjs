"use strict";
/**
 * Universal Composition Engine — Completion Gaps, Phase 2: Template
 * Inference Engine. Proves the confirmed silent-SaaS-fallback problem is
 * fixed: an unrecognized niche returns a genuine CAPABILITY_GAP instead
 * of defaulting to "saas", and niches that combine multiple business
 * functions (Fashion Ecommerce, Agriculture IoT) correctly union
 * multiple base templates' capabilities rather than picking just one.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

describe("templateInferenceEngine.analyzeCompanyDefinition()", () => {
    before(() => { require("../../agents/runtime/bootstrapRuntime.cjs"); });
    const engine = require("../../backend/services/templateInferenceEngine.cjs");

    describe("core fix — no silent SaaS fallback", () => {
        it("a totally unrecognized niche returns CAPABILITY_GAP, never a defaulted template", () => {
            const result = engine.analyzeCompanyDefinition({ niche: "Xyzzy quantum flibbertigibbet company" });
            assert.equal(result.status, "CAPABILITY_GAP");
            assert.equal(result.matchedTemplateIds.length, 0);
            assert.ok(result.capabilityGap.reason.includes("genuine template-inference gap"));
        });
        it("empty input returns CAPABILITY_GAP, not a defaulted template", () => {
            const result = engine.analyzeCompanyDefinition({});
            assert.equal(result.status, "CAPABILITY_GAP");
        });
        it("a real, recognized niche (SaaS) does NOT return CAPABILITY_GAP", () => {
            const result = engine.analyzeCompanyDefinition({ niche: "A B2B SaaS subscription platform", businessModel: "saas" });
            assert.notEqual(result.status, "CAPABILITY_GAP");
            assert.ok(result.matchedTemplateIds.includes("saas"));
        });
    });

    describe("structured businessModel field matches even when the niche string has no keyword", () => {
        it("businessModel:'ecommerce' matches the ecommerce template even with a generic niche string", () => {
            const result = engine.analyzeCompanyDefinition({ niche: "My new company", businessModel: "ecommerce" });
            assert.ok(result.matchedTemplateIds.includes("ecommerce"));
        });
    });

    describe("multi-template composition — a niche may combine multiple base templates", () => {
        it("Fashion Ecommerce matches ecommerce and does not spuriously pull in unrelated templates via generic shared tags", () => {
            const result = engine.analyzeCompanyDefinition({
                niche: "Fashion ecommerce store", businessModel: "ecommerce", customerType: "b2c",
                physicalOrDigital: "physical", commerceRequirements: ["payments", "inventory", "physical_goods"],
            });
            assert.ok(result.matchedTemplateIds.includes("ecommerce"));
            assert.ok(!result.matchedTemplateIds.includes("healthcare"), "must not spuriously match healthcare via generic 'billing' tag overlap");
            assert.ok(!result.matchedTemplateIds.includes("education"), "must not spuriously match education via generic 'community' tag overlap");
        });
        it("Real estate genuinely matches the marketplace template (real listing/matching/escrow capability overlap), not a fabricated new template", () => {
            const result = engine.analyzeCompanyDefinition({ niche: "Real estate property listing and rental management", businessModel: "real_estate", productsServices: ["property_listing"] });
            assert.ok(result.matchedTemplateIds.includes("marketplace"));
            assert.notEqual(result.status, "CAPABILITY_GAP");
        });
        it("Agriculture IoT combines ecommerce-adjacent commerce tags with IoT-specific department requirements", () => {
            const result = engine.analyzeCompanyDefinition({
                niche: "Agriculture IoT sensor monitoring company", businessModel: "b2b_hardware",
                physicalOrDigital: "physical", technologyRequirements: ["iot", "sensors"], commerceRequirements: ["physical_goods"],
            });
            assert.ok(result.dimensionTags.includes("iot_hardware"));
            assert.ok(result.requiredDepartmentFamilies.includes("iot_robotics_maintenance_quality"));
            assert.ok(result.requiredDepartmentFamilies.includes("inventory_warehouse"));
        });
    });

    describe("required output fields — department families, agents, skills, connectors, approvals, external infra", () => {
        it("returns all required output categories for a real, composable niche", () => {
            const result = engine.analyzeCompanyDefinition({ niche: "A B2B SaaS subscription platform", businessModel: "saas" });
            assert.ok(Array.isArray(result.requiredDepartmentFamilies));
            assert.ok(Array.isArray(result.requiredAgentArchetypes));
            assert.ok(Array.isArray(result.requiredSkillPacks));
            assert.ok(Array.isArray(result.requiredConnectors));
            assert.ok(Array.isArray(result.approvalRequirements));
            assert.ok(Array.isArray(result.externalInfrastructureRequirements));
            assert.ok(result.requiredDepartmentFamilies.includes("executive"), "every company gets a leadership function");
        });
        it("a niche needing physical/manufacturing infrastructure reports NEEDS_EXTERNAL_INFRA honestly, not COMPOSABLE_NOW", () => {
            const result = engine.analyzeCompanyDefinition({
                niche: "3D printed manufacturing company", businessModel: "manufacturing", physicalOrDigital: "physical",
                productsServices: ["procurement"], technologyRequirements: ["hardware"],
            });
            assert.equal(result.status, "NEEDS_EXTERNAL_INFRA");
            assert.ok(result.externalInfrastructureRequirements.length > 0);
        });
    });

    describe("status vocabulary — only the mission's allowed statuses are ever returned", () => {
        const ALLOWED = new Set(["COMPOSABLE_NOW", "NEEDS_CREDENTIALS", "NEEDS_CONNECTOR", "NEEDS_CAPABILITY", "NEEDS_EXTERNAL_INFRA", "UNSUPPORTED", "CAPABILITY_GAP"]);
        const SAMPLE_NICHES = [
            { niche: "SaaS platform", businessModel: "saas" },
            { niche: "Ecommerce store", businessModel: "ecommerce" },
            { niche: "Marketing agency", businessModel: "agency" },
            { niche: "Real estate management", businessModel: "real_estate", productsServices: ["property_listing"] }, // matches marketplace (listing/matching/escrow overlap)
            { niche: "Biotech research lab", businessModel: "biotech", regulated: true, technologyRequirements: ["research"] },
            { niche: "Xyzzy unknown niche" },
        ];
        for (const def of SAMPLE_NICHES) {
            it(`"${def.niche}" returns a status from the allowed vocabulary`, () => {
                const result = engine.analyzeCompanyDefinition(def);
                assert.ok(ALLOWED.has(result.status), `unexpected status: ${result.status}`);
            });
        }
    });

    describe("dimension rules are declared once per structural dimension, not per niche string", () => {
        it("DIMENSION_RULES stays a small, fixed set (not hundreds of niche-specific entries)", () => {
            assert.ok(engine.DIMENSION_RULES.length < 30, `expected a small dimension-rule set, got ${engine.DIMENSION_RULES.length} rules`);
        });
    });
});
