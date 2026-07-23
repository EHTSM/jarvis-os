"use strict";
/**
 * Universal Composition Engine — Completion Gaps Phase 3: runs all 100
 * original company definitions (docs/audits/100-COMPANY-COVERAGE-MATRIX.md)
 * through templateInferenceEngine.cjs as a real, committed regression
 * test — not just a one-off scratchpad run. Proves the core fix holds:
 * zero silent SaaS fallback across the entire original 100-company set.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ORIGINAL_100 = require(path.join(__dirname, "../../docs/audits/original-100-companies.json"));

function deriveStructuredInput(niche) {
    const lc = niche.toLowerCase();
    const input = { niche };
    if (/saas\b/.test(lc)) input.businessModel = "saas";
    else if (/agency|consultanc/.test(lc)) input.businessModel = "agency";
    else if (/marketplace/.test(lc)) input.businessModel = "marketplace";
    else if (/crm\b/.test(lc)) input.businessModel = "crm";
    else if (/erp\b/.test(lc)) input.businessModel = "erp";
    else if (/^ai\s|ai\s(writing|image|code|voice|video|trading|3d|research|simulation)/.test(lc)) input.businessModel = "ai_product";
    else if (/^internal\s/.test(lc)) input.businessModel = "internal_tool";
    else if (/e-?commerce|store|shopify|woocommerce|dropshipping|boutique|d2c|resale|wholesale/.test(lc)) input.businessModel = "ecommerce";
    else if (/real-?estate|propert|rental|listing/.test(lc)) input.businessModel = "real_estate";
    else if (/course|tutor|lms|certification|testing|assessment|grading|language-learning|training|lecture|school|sis\b/.test(lc)) input.businessModel = "education";
    else if (/wellness|fitness|coaching|telehealth|patient|clinical|pharmacy|insurance-claims|mental-health/.test(lc)) input.businessModel = "healthcare";
    else if (/research-publication|publish/.test(lc)) input.businessModel = "education";

    if (/\bb2b\b|enterprise|wholesale/.test(lc)) input.customerType = "b2b";
    else if (/\bb2c\b|consumer|d2c/.test(lc)) input.customerType = "b2c";

    input.commerceRequirements = [];
    if (/iot|monitoring|device|warehouse|manufactur|construction|agricultur|energy|utility|logistics|fleet|3d|cad|apparel|electronics|grocery|perishable|print-on-demand|equipment/.test(lc)) {
        input.physicalOrDigital = "physical";
        input.commerceRequirements.push("physical_goods");
    }
    if (/health|medical|clinic|patient|hipaa|pharma|telehealth|insurance|financ|bank|lending|clinical/.test(lc)) input.regulated = true;

    input.technologyRequirements = [];
    if (/iot|sensor|monitoring|device/.test(lc)) input.technologyRequirements.push("iot", "sensors");
    if (/dev-?tools|ci\/cd|devops|deployment|release/.test(lc)) input.technologyRequirements.push("ci_cd", "devops");

    if (/subscription|box/.test(lc)) input.commerceRequirements.push("subscriptions");
    if (/e-?commerce|store|shopify|woocommerce|wholesale|resale/.test(lc)) input.commerceRequirements.push("payments", "inventory");

    input.financialRequirements = [];
    if (/fintech|trading|quant|lending|billing|expense/.test(lc)) input.financialRequirements.push("payments");
    if (/accounting|ledger|expense/.test(lc)) input.financialRequirements.push("accounting");
    if (/trading|quant|invest/.test(lc)) input.financialRequirements.push("trading");

    input.productsServices = [];
    if (/listing|propert|rental/.test(lc)) input.productsServices.push("property_listing");
    if (/procurement/.test(lc)) input.productsServices.push("procurement");

    return input;
}

describe("Original 100-company inference test (Phase 3)", () => {
    before(() => { require("../../agents/runtime/bootstrapRuntime.cjs"); });
    const engine = require("../../backend/services/templateInferenceEngine.cjs");

    it("the original-100 dataset is genuinely loaded (100 companies)", () => {
        assert.equal(ORIGINAL_100.length, 100);
    });

    it("every company resolves to an allowed status", () => {
        const ALLOWED = new Set(["COMPOSABLE_NOW", "NEEDS_CREDENTIALS", "NEEDS_CONNECTOR", "NEEDS_CAPABILITY", "NEEDS_EXTERNAL_INFRA", "UNSUPPORTED", "CAPABILITY_GAP"]);
        for (const company of ORIGINAL_100) {
            const analysis = engine.analyzeCompanyDefinition(deriveStructuredInput(company.niche));
            assert.ok(ALLOWED.has(analysis.status), `#${company.num} "${company.niche}" returned invalid status: ${analysis.status}`);
        }
    });

    it("zero silent SaaS fallback: every company matched to ONLY 'saas' genuinely mentions a SaaS-shaped keyword", () => {
        for (const company of ORIGINAL_100) {
            const analysis = engine.analyzeCompanyDefinition(deriveStructuredInput(company.niche));
            if (analysis.matchedTemplateIds.length === 1 && analysis.matchedTemplateIds[0] === "saas") {
                assert.ok(/saas|subscription|software/i.test(company.niche), `#${company.num} "${company.niche}" matched ONLY saas without a genuine SaaS-shaped signal — this is the silent-fallback bug`);
            }
        }
    });

    it("every genuinely composable/gap-carrying result traces to at least one real matched template OR an honest CAPABILITY_GAP (never an empty match with a non-gap status)", () => {
        for (const company of ORIGINAL_100) {
            const analysis = engine.analyzeCompanyDefinition(deriveStructuredInput(company.niche));
            if (analysis.status !== "CAPABILITY_GAP") {
                assert.ok(analysis.matchedTemplateIds.length > 0, `#${company.num} "${company.niche}" has status ${analysis.status} but zero matched templates`);
            }
        }
    });

    it("with the improved classifier, the original-100 set has zero genuine CAPABILITY_GAP results (full coverage confirmed as of this mission)", () => {
        let gapCount = 0;
        for (const company of ORIGINAL_100) {
            const analysis = engine.analyzeCompanyDefinition(deriveStructuredInput(company.niche));
            if (analysis.status === "CAPABILITY_GAP") gapCount++;
        }
        assert.equal(gapCount, 0, "expected zero CAPABILITY_GAP across the original 100 companies");
    });

    it("real-estate/marketplace-shaped companies (#33 real-estate listing, #62 real-estate CRM) resolve to genuine matches, not gaps", () => {
        const realEstateListing = ORIGINAL_100.find(c => c.num === 33);
        const realEstateCrm = ORIGINAL_100.find(c => c.num === 62);
        const a1 = engine.analyzeCompanyDefinition(deriveStructuredInput(realEstateListing.niche));
        const a2 = engine.analyzeCompanyDefinition(deriveStructuredInput(realEstateCrm.niche));
        assert.ok(a1.matchedTemplateIds.includes("marketplace"));
        assert.ok(a2.matchedTemplateIds.includes("crm"));
    });

    it("physical/manufacturing-shaped companies (#71 manufacturing ERP) honestly report NEEDS_EXTERNAL_INFRA, not a false COMPOSABLE_NOW", () => {
        const manufacturingErp = ORIGINAL_100.find(c => c.num === 71);
        const analysis = engine.analyzeCompanyDefinition(deriveStructuredInput(manufacturingErp.niche));
        assert.equal(analysis.status, "NEEDS_EXTERNAL_INFRA");
    });
});
