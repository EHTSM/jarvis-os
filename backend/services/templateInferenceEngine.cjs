"use strict";
/**
 * templateInferenceEngine.cjs — Universal Composition Engine, Completion
 * Gaps Phase 2 (Template Inference Engine).
 *
 * Fixes the confirmed problem (docs/audits/UNIVERSAL-COMPOSITION-ENGINE-
 * REALITY.md §6/§9): businessTemplateEngine.cjs's inferTemplate() is a
 * single-pattern keyword ladder that silently falls back to "saas" for
 * any niche it doesn't recognize — of the mission's own 10 target
 * niches, only 3 matched a genuinely dedicated pattern.
 *
 * This is NOT a rewrite of businessTemplateEngine.cjs and does NOT add
 * hundreds of if/else niche strings. It is a capability-driven layer
 * ABOVE the existing template + department machinery:
 *
 *   structured company definition (niche, business model, products,
 *   customer type, geography, physical/digital, regulated, commerce/
 *   financial/tech requirements)
 *     -> DIMENSION RULES (a small, fixed set — one rule per structural
 *        dimension, not one rule per niche) that each emit zero or more
 *        CAPABILITY TAGS (the same tags departmentTemplateRegistry.cjs's
 *        CAPABILITY_TO_DEPARTMENTS map already understands, e.g. "crm",
 *        "billing", "logistics", "inventory", "hipaa_compliance")
 *     -> the union of ALL matched base businessTemplateEngine templates'
 *        own capabilities[] arrays (a niche may match MULTIPLE base
 *        templates, not just one — e.g. Fashion Ecommerce = ecommerce +
 *        marketing-adjacent capabilities)
 *     -> fed into the EXISTING, unmodified
 *        departmentTemplateRegistry.deriveDepartmentsForTemplate() /
 *        composeDepartmentsForTemplate() (real capability-tag matching,
 *        already reused, not touched by this file)
 *     -> an honest per-family composable/requiresNewCapability status,
 *        aggregated into one of the mission's required output statuses.
 *
 * If NOTHING resolves — no dimension rule fires, no base template
 * matches, no department capability tag matches — this returns
 * CAPABILITY_GAP with the exact missing pieces, instead of silently
 * defaulting to "saas" the way inferTemplate() alone does. This module
 * does not change businessTemplateEngine.inferTemplate()'s own behavior
 * (existing callers of that function are unaffected) — it is a new,
 * additive entry point companyFactory.cjs and others may call instead.
 */

function _try(fn) { try { return fn(); } catch { return null; } }
const _bte = () => _try(() => require("./businessTemplateEngine.cjs"));
const _deptReg = () => _try(() => require("./departmentTemplateRegistry.cjs"));
const _agentRegistry = () => _try(() => require("../../agents/runtime/agentRegistry.cjs"));
const _connReg = () => _try(() => require("./integrationConnectors.cjs"));

// ── Dimension rules ─────────────────────────────────────────────────────
// One rule per STRUCTURAL DIMENSION (not per niche). Each rule inspects
// the structured input and returns zero or more capability tags — the
// same vocabulary departmentTemplateRegistry.cjs's CAPABILITY_TO_DEPARTMENTS
// map already consumes (crm, billing, inventory, logistics, hipaa_compliance,
// etc.), plus a few genuinely new tags this phase introduces for
// dimensions the department registry didn't previously have a capability
// tag for (physical_product, iot_hardware, regulated_industry,
// scientific_research, media_production) — each mapped onto the correct
// existing (or honestly requiresNewCapability:true) department family
// below in DIMENSION_CAPABILITY_TO_DEPARTMENTS.
const DIMENSION_RULES = [
    // Commerce / financial dimensions
    { test: (i) => i.commerceRequirements?.includes("payments") || i.financialRequirements?.includes("payments"), tags: ["payment", "billing"] },
    { test: (i) => i.commerceRequirements?.includes("inventory"), tags: ["inventory"] },
    { test: (i) => i.commerceRequirements?.includes("physical_goods") || i.physicalOrDigital === "physical", tags: ["inventory", "logistics", "physical_product"] },
    { test: (i) => i.commerceRequirements?.includes("subscriptions"), tags: ["subscription_billing"] },
    { test: (i) => i.financialRequirements?.includes("accounting") || i.financialRequirements?.includes("ledger"), tags: ["modules_finance"] },
    { test: (i) => i.financialRequirements?.includes("trading") || i.financialRequirements?.includes("investment"), tags: ["modules_finance", "audit_log"] },
    // Customer type / relationship dimensions
    { test: (i) => i.customerType === "b2b" || i.customerType === "enterprise", tags: ["crm", "proposal_generation"] },
    { test: (i) => i.customerType === "b2c" || i.customerType === "consumer", tags: ["crm", "reviews", "community"] },
    { test: (i) => i.businessModel === "marketplace" || i.businessModel === "two_sided", tags: ["crm", "reviews", "fraud_detection"] },
    { test: (i) => i.businessModel === "agency" || i.businessModel === "services", tags: ["proposal_generation", "project_tracking"] },
    // Real-estate/property/rental is genuinely marketplace-shaped
    // (listings, buyer/seller or landlord/tenant matching, escrow for
    // deposits) — a real capability overlap with the existing marketplace
    // template's own capabilities[] (listing_management/search/matching/
    // escrow), not a fabricated one.
    { test: (i) => i.businessModel === "real_estate" || i.productsServices?.some(p => /propert|listing|rental/i.test(p)), tags: ["listing_management", "search", "matching", "escrow"] },
    // Regulated / compliance dimensions. audit_log is a genuinely generic
    // regulated-industry signal (departmentTemplateRegistry.cjs's
    // audit_log tag maps to legal_compliance/security regardless of
    // sub-industry). hipaa_compliance is health-specific and must NOT be
    // added for every regulated business — a real bug this phase's own
    // unknown-niche testing caught: a crypto exchange (regulated:true, no
    // health signal) was spuriously matching the "healthcare" base
    // template purely because the generic regulated rule added
    // hipaa_compliance unconditionally.
    { test: (i) => i.regulated === true, tags: ["audit_log"] },
    { test: (i) => i.regulated === true && i.niche?.match(/health|medical|clinic|patient|pharma/i), tags: ["hipaa_compliance"] },
    { test: (i) => i.regulated === true && i.niche?.match(/financ|bank|invest|trading|lending|crypto|currency/i), tags: ["audit_log", "modules_finance"] },
    // Technology / infrastructure dimensions
    { test: (i) => i.technologyRequirements?.includes("ci_cd") || i.technologyRequirements?.includes("devops"), tags: ["ci_cd", "monitoring"] },
    { test: (i) => i.technologyRequirements?.includes("ai") || i.technologyRequirements?.includes("ml"), tags: [] }, // handled via base-template union below
    { test: (i) => i.technologyRequirements?.includes("iot") || i.technologyRequirements?.includes("sensors"), tags: ["iot_hardware"] },
    { test: (i) => i.technologyRequirements?.includes("hardware") || i.physicalOrDigital === "physical", tags: ["iot_hardware"] },
    // Operational dimensions
    { test: (i) => i.operatingGeography?.length > 1 || i.operatingGeography?.includes("global"), tags: ["reporting"] },
    { test: (i) => i.productsServices?.includes("procurement") || i.businessModel === "manufacturing", tags: ["modules_procurement", "physical_product"] },
];

// New capability tags this phase introduces, mapped onto department
// families — additive to departmentTemplateRegistry.cjs's own
// CAPABILITY_TO_DEPARTMENTS (that file is NOT modified; this is a
// separate, local mapping used only inside this engine, since these tags
// describe STRUCTURAL dimensions this phase newly models, not existing
// department-composition capabilities).
const DIMENSION_CAPABILITY_TO_DEPARTMENTS = {
    physical_product: ["inventory_warehouse", "logistics", "manufacturing_production"],
    iot_hardware: ["iot_robotics_maintenance_quality"],
};

/**
 * @typedef {object} CompanyDefinitionInput
 * @property {string} niche
 * @property {string} [businessModel]
 * @property {string[]} [productsServices]
 * @property {string} [customerType]
 * @property {string[]} [operatingGeography]
 * @property {"physical"|"digital"|"hybrid"} [physicalOrDigital]
 * @property {boolean} [regulated]
 * @property {string[]} [commerceRequirements]
 * @property {string[]} [financialRequirements]
 * @property {string[]} [technologyRequirements]
 */

/**
 * Determines every base businessTemplateEngine.cjs template whose own
 * keyword pattern OR whose capabilities[] genuinely overlaps with the
 * dimension-derived capability tags. A niche may match MULTIPLE base
 * templates — e.g. "Fashion Ecommerce" matches "ecommerce" via its own
 * pattern AND may pull in "agency"-style capabilities if
 * businessModel/productsServices imply marketing services.
 *
 * @param {CompanyDefinitionInput} input
 * @returns {{ matchedTemplateIds: string[], dimensionTags: string[] }}
 */
function _matchBaseTemplates(input) {
    const bte = _bte();
    const dimensionTags = new Set();
    for (const rule of DIMENSION_RULES) {
        if (_try(() => rule.test(input))) {
            for (const tag of rule.tags) dimensionTags.add(tag);
        }
    }

    const matchedTemplateIds = new Set();

    // 1. The existing keyword-pattern match on the niche string — reused,
    // not replaced. Only counted as a genuine match if the pattern list
    // in businessTemplateEngine.cjs actually fired (not its silent "saas"
    // default) — re-implemented here as a direct pattern check so we can
    // tell a real match from the fallback, since inferTemplate() itself
    // doesn't expose that distinction.
    const nicheStr = (input.niche || "").toLowerCase();
    const _PATTERNS = [
        [/saas|subscription|software[- ]as|cloud[- ]app|b2b[- ]software/i, "saas"],
        [/agency|consultanc|services?[- ]firm|freelanc|studio/i, "agency"],
        [/ecommerce|e-?commerce|online[- ]store|retail|shopif/i, "ecommerce"],
        [/marketplace|platform[- ](for|connecting)|two-?sided|gig[- ]economy/i, "marketplace"],
        [/health|medical|clinic|patient|hipaa|ehr|pharma|telemedicin/i, "healthcare"],
        [/educat|learn|course|tutori|lms|edtech|school|training/i, "education"],
        [/\bcrm\b|customer[- ]relation|contact[- ]manag|sales[- ]pipeline/i, "crm"],
        [/\berp\b|enterprise[- ]resource|resource[- ]planning|hr[- ]system/i, "erp"],
        [/\bai\b.*product|\bai\b.*tool|copilot|agent[- ]platform|llm[- ]app/i, "ai_product"],
        [/internal|inhouse|in-?house|back[- ]office|admin[- ]tool|workflow/i, "internal_tool"],
    ];
    for (const [pattern, id] of _PATTERNS) {
        if (pattern.test(nicheStr)) matchedTemplateIds.add(id);
    }

    // 2. businessModel is a direct, structured signal — matches even when
    // the niche STRING doesn't contain a recognized keyword (this is the
    // actual fix for the silent-SaaS-fallback problem: a structured field
    // is more reliable than free-text pattern matching alone).
    const modelToTemplate = {
        saas: "saas", subscription: "saas", agency: "agency", services: "agency",
        ecommerce: "ecommerce", retail: "ecommerce", marketplace: "marketplace",
        two_sided: "marketplace", erp: "erp", crm: "crm",
        ai_product: "ai_product", ai: "ai_product",
        internal_tool: "internal_tool", internal: "internal_tool",
        education: "education", edtech: "education",
        healthcare: "healthcare", health: "healthcare", medical: "healthcare",
    };
    if (input.businessModel && modelToTemplate[input.businessModel]) {
        matchedTemplateIds.add(modelToTemplate[input.businessModel]);
    }

    // 3. Any base template whose OWN capabilities[] overlaps
    // MEANINGFULLY with the dimension-derived tags is a genuine
    // combined match — this is what lets multiple templates combine
    // (Fashion Ecommerce = ecommerce's own capabilities + whatever
    // commerce/marketing dimension tags fired). Cross-cutting business
    // functions (crm/billing/reporting/reviews/community) are
    // deliberately excluded from this overlap check — nearly every real
    // company wants CRM/billing/reporting regardless of niche, so they
    // are not a meaningful signal for "this niche IS also an agency/
    // healthcare/education company." Only genuinely niche-differentiating
    // capability tags count toward the overlap threshold.
    const GENERIC_CROSS_CUTTING_TAGS = new Set(["crm", "billing", "reporting", "reviews", "community", "notifications", "api", "automation", "mobile"]);
    const MIN_OVERLAP_FOR_MATCH = 2;
    if (bte) {
        for (const tpl of bte.listTemplates()) {
            const caps = (tpl.capabilities || []).filter(c => !GENERIC_CROSS_CUTTING_TAGS.has(c));
            const overlapCount = caps.filter(c => dimensionTags.has(c)).length;
            const overlapsEnough = overlapCount >= MIN_OVERLAP_FOR_MATCH || (caps.length > 0 && overlapCount === caps.length);
            if (overlapsEnough) matchedTemplateIds.add(tpl.id);
        }
    }

    return { matchedTemplateIds: [...matchedTemplateIds], dimensionTags: [...dimensionTags] };
}

/**
 * Union every matched base template's own real capabilities[] with the
 * dimension-derived tags, and derive department keys via the EXISTING,
 * unmodified departmentTemplateRegistry.deriveDepartmentsForTemplate() —
 * called once per matched template (a template's own function accepts
 * one {teamTypes, capabilities} shape) then merged, plus one extra pass
 * for the dimension-only tags this phase newly introduces
 * (physical_product/iot_hardware) that have no equivalent in any base
 * template's capabilities[].
 */
function _deriveDepartmentKeys(matchedTemplateIds, dimensionTags) {
    const bte = _bte();
    const deptReg = _deptReg();
    const keys = new Set();

    for (const templateId of matchedTemplateIds) {
        const tpl = bte?.getTemplate?.(templateId);
        if (!tpl) continue;
        for (const key of deptReg?.deriveDepartmentsForTemplate?.(tpl) || []) keys.add(key);
    }

    // Dimension tags ALWAYS get run through the REAL, existing
    // departmentTemplateRegistry.deriveDepartmentsForTemplate() too — not
    // just the base templates matched above. This reuses its own real
    // CAPABILITY_TO_DEPARTMENTS map (crm/billing/inventory/logistics/
    // hipaa_compliance/audit_log/modules_finance/etc. already handled
    // there) so a dimension tag with no genuinely matched base template
    // (e.g. "modules_finance"/"audit_log" for a fintech niche whose
    // businessModel doesn't map to any of the 10 base templates) still
    // resolves to a real department, instead of silently contributing
    // nothing and letting the company fall through as a near-empty,
    // falsely COMPOSABLE_NOW "executive-only" composition. This is the
    // exact fix for a genuine bug this phase's own testing caught: a
    // "Weather-derivatives trading desk" niche with zero matched base
    // templates was incorrectly reported COMPOSABLE_NOW before this fix.
    for (const key of deptReg?.deriveDepartmentsForTemplate?.({ teamTypes: [], capabilities: dimensionTags }) || []) keys.add(key);

    // A few dimension tags this phase newly introduces
    // (physical_product/iot_hardware) have no equivalent in
    // departmentTemplateRegistry.cjs's own CAPABILITY_TO_DEPARTMENTS map
    // at all — this local mapping covers exactly those, additively.
    for (const tag of dimensionTags) {
        for (const key of DIMENSION_CAPABILITY_TO_DEPARTMENTS[tag] || []) keys.add(key);
    }

    keys.add("executive"); // every company has a leadership function
    return [...keys].filter(k => !!deptReg?.getTemplate?.(k));
}

/**
 * The main entry point. Analyzes a structured company definition and
 * returns either a real composition plan or an honest CAPABILITY_GAP.
 *
 * @param {CompanyDefinitionInput} input
 * @returns {{
 *   status: "COMPOSABLE_NOW"|"NEEDS_CREDENTIALS"|"NEEDS_CONNECTOR"|"NEEDS_CAPABILITY"|"NEEDS_EXTERNAL_INFRA"|"UNSUPPORTED"|"CAPABILITY_GAP",
 *   matchedTemplateIds: string[],
 *   dimensionTags: string[],
 *   departments: object[],
 *   requiredDepartmentFamilies: string[],
 *   requiredAgentArchetypes: string[],
 *   requiredSkillPacks: string[],
 *   requiredTools: string[],
 *   requiredConnectors: string[],
 *   approvalRequirements: string[],
 *   externalInfrastructureRequirements: string[],
 *   capabilityGap: null | { missingDepartments: string[], missingConnectors: string[], missingExternalInfra: string[] },
 * }}
 */
function analyzeCompanyDefinition(input = {}) {
    if (!input.niche?.trim() && !input.businessModel?.trim()) {
        return {
            status: "CAPABILITY_GAP",
            matchedTemplateIds: [], dimensionTags: [], departments: [],
            requiredDepartmentFamilies: [], requiredAgentArchetypes: [], requiredSkillPacks: [],
            requiredTools: [], requiredConnectors: [], approvalRequirements: [],
            externalInfrastructureRequirements: [],
            capabilityGap: { missingDepartments: [], missingConnectors: [], missingExternalInfra: [], reason: "no niche or businessModel provided — nothing to analyze" },
        };
    }

    const { matchedTemplateIds, dimensionTags } = _matchBaseTemplates(input);

    // Genuine gap: nothing at all resolved — no keyword pattern, no
    // businessModel mapping, no capability-tag overlap. This is the
    // exact honest-failure case the mission requires INSTEAD of a silent
    // "saas" default.
    if (matchedTemplateIds.length === 0 && dimensionTags.length === 0) {
        return {
            status: "CAPABILITY_GAP",
            matchedTemplateIds: [], dimensionTags: [], departments: [],
            requiredDepartmentFamilies: [], requiredAgentArchetypes: [], requiredSkillPacks: [],
            requiredTools: [], requiredConnectors: [], approvalRequirements: [],
            externalInfrastructureRequirements: [],
            capabilityGap: {
                missingDepartments: ["unknown — no department family could be inferred"],
                missingConnectors: [],
                missingExternalInfra: [],
                reason: `niche "${input.niche}" matched no known business-template pattern, businessModel mapping, or capability dimension — this is a genuine template-inference gap, not a defaulted guess`,
            },
        };
    }

    const departmentKeys = _deriveDepartmentKeys(matchedTemplateIds, dimensionTags);
    const agentRegistry = _agentRegistry();
    const deptReg = _deptReg();
    const composed = departmentKeys.map(key => deptReg.composeDepartment(key, agentRegistry));

    const requiredAgentArchetypes = [...new Set(composed.flatMap(d => d.requiredCapabilities || []))];
    const requiredSkillPacks = [...new Set(composed.flatMap(d => d.skills || []))];
    const requiredConnectors = [...new Set(composed.flatMap(d => d.connectors || []))];
    const approvalRequirements = [...new Set(composed.flatMap(d => d.approvalPolicies || []))];

    const composableDepts = composed.filter(d => d.composable);
    const gapDepts = composed.filter(d => !d.composable);
    const missingDepartments = gapDepts.map(d => d.label);

    // Connector readiness — real check against integrationConnectors.cjs's
    // composition status (Phase 7 of the prior mission), never fabricated.
    const connReg = _connReg();
    const missingConnectors = [];
    for (const connId of requiredConnectors) {
        const status = _try(() => connReg?.getCompositionStatus?.(connId)?.status);
        if (status && !["CONNECTED_VERIFIED", "CONFIGURED_UNVERIFIED"].includes(status)) {
            missingConnectors.push({ connectorId: connId, status });
        }
    }

    const requiresExternalInfra = gapDepts.some(d =>
        ["threed_cad", "manufacturing_production", "iot_robotics_maintenance_quality", "energy_infrastructure"].includes(d.templateKey)
    );
    const externalInfrastructureRequirements = gapDepts
        .filter(d => ["threed_cad", "manufacturing_production", "iot_robotics_maintenance_quality", "energy_infrastructure"].includes(d.templateKey))
        .map(d => d.label);

    // Aggregate to one of the mission's required statuses — priority
    // order matches the mission's own listed vocabulary (most-blocking
    // first): UNSUPPORTED > NEEDS_EXTERNAL_INFRA > NEEDS_CAPABILITY >
    // NEEDS_CONNECTOR > NEEDS_CREDENTIALS > COMPOSABLE_NOW.
    let status;
    const nonInfraGaps = gapDepts.filter(d => !externalInfrastructureRequirements.includes(d.label));
    // Safety guard: zero genuinely matched base template AND nothing beyond
    // the trivial always-present "executive" department is NOT sufficient
    // composition evidence for COMPOSABLE_NOW — a niche whose only signal
    // was a dimension tag that happened to resolve one thin department
    // must not be reported as fully composable. Real bug this guard fixes:
    // a fintech niche with dimension tags (modules_finance/audit_log) but
    // no matched base template previously fell through to a false
    // COMPOSABLE_NOW off the executive department alone.
    const onlyTrivialComposition = matchedTemplateIds.length === 0 && departmentKeys.every(k => k === "executive");
    if (composableDepts.length === 0 && gapDepts.length > 0) {
        status = "UNSUPPORTED";
    } else if (requiresExternalInfra) {
        status = "NEEDS_EXTERNAL_INFRA";
    } else if (nonInfraGaps.length > 0) {
        status = "NEEDS_CAPABILITY";
    } else if (onlyTrivialComposition) {
        status = "NEEDS_CAPABILITY";
    } else if (missingConnectors.some(c => c.status === "NOT_IMPLEMENTED")) {
        status = "NEEDS_CONNECTOR";
    } else if (missingConnectors.length > 0) {
        status = "NEEDS_CREDENTIALS";
    } else {
        status = "COMPOSABLE_NOW";
    }

    return {
        status,
        matchedTemplateIds,
        dimensionTags,
        departments: composed,
        requiredDepartmentFamilies: departmentKeys,
        requiredAgentArchetypes,
        requiredSkillPacks,
        requiredTools: [], // Tool Fabric requirements are declared per-skill (skillRegistry.cjs), not per-department today — honestly empty here rather than guessed
        requiredConnectors,
        approvalRequirements,
        externalInfrastructureRequirements,
        capabilityGap: (missingDepartments.length > 0 || missingConnectors.length > 0 || onlyTrivialComposition)
            ? {
                missingDepartments: onlyTrivialComposition
                    ? [...missingDepartments, "no genuinely matched business template — only the trivial executive department resolved from dimension tags alone"]
                    : missingDepartments,
                missingConnectors: missingConnectors.map(c => `${c.connectorId} (${c.status})`),
                missingExternalInfra: externalInfrastructureRequirements,
              }
            : null,
    };
}

module.exports = {
    analyzeCompanyDefinition,
    DIMENSION_RULES,
    DIMENSION_CAPABILITY_TO_DEPARTMENTS,
};
