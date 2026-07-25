"use strict";
/**
 * departmentTemplateRegistry.cjs — 100-COMPANY P1 mission Phase 3.
 *
 * A single, data-driven registry of the 32 target department families.
 * Each template declares required agent archetypes (by real capability
 * tag from agents/runtime/agentRegistry.cjs, per the Phase 2 audit),
 * required skills, optional connector IDs (matching
 * backend/services/integrationConnectors.cjs's real connector ids),
 * required org permissions (matching organizationService.cjs's real
 * ACTIONS), and approval policy ids (matching approvalPolicy.cjs's real
 * WORKFLOW_POLICY keys where one exists).
 *
 * This does NOT create 32 independent subsystems, a new department data
 * model, or a new permission system — it composes over what already
 * exists:
 *   - department CRUD: organizationService.cjs createDepartment() (real,
 *     unchanged)
 *   - agent archetypes: agents/runtime/agentRegistry.cjs capability tags
 *     (real, Phase 1/P0 wired)
 *   - approval policies: approvalPolicy.cjs WORKFLOW_POLICY (real)
 *   - connectors: integrationConnectors.cjs connector ids (real)
 *
 * Honesty rule: a template's `composable` field is only true if every
 * required archetype capability in `requiredCapabilities` is genuinely
 * registered in agentRegistry today (verified at call time, not assumed
 * at authoring time — see isComposableNow()). Families with no working
 * primitive to compose from are marked composable:false and
 * requiresNewCapability:true — no placeholder/fake agents are attached.
 */

const TEMPLATES = {
    executive: {
        label: "Executive",
        requiredCapabilities: ["ai"],
        skills: ["strategy", "executive_summary"],
        connectors: [],
        permissions: ["view_analytics"],
        approvalPolicies: [],
        kpis: ["company_health_score", "runway_months"],
    },
    strategy: {
        label: "Strategy",
        requiredCapabilities: ["ai"],
        skills: ["market_intelligence_report", "trend_analysis"],
        connectors: [],
        permissions: ["view_analytics"],
        approvalPolicies: [],
        kpis: ["strategic_initiatives_active"],
    },
    operations: {
        label: "Operations",
        requiredCapabilities: ["automation"],
        skills: ["automation"],
        connectors: [],
        permissions: ["manage_departments"],
        approvalPolicies: [],
        kpis: ["operational_uptime_pct"],
    },
    administration: {
        label: "Administration",
        requiredCapabilities: [],
        skills: [],
        connectors: [],
        permissions: ["manage_members"],
        approvalPolicies: [],
        kpis: [],
        requiresNewCapability: true,
    },
    sales: {
        label: "Sales",
        requiredCapabilities: ["crm", "crm_extended"],
        skills: ["crm", "crm_extended"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["pipeline_value", "leads_new_weekly"],
    },
    crm: {
        label: "CRM",
        requiredCapabilities: ["crm", "crm_extended"],
        skills: ["crm", "crm_extended"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["leads_total", "conversion_rate_pct"],
    },
    marketing: {
        label: "Marketing",
        requiredCapabilities: ["marketing_campaign", "seo"],
        skills: ["marketing_campaign", "seo", "content_writer"],
        connectors: ["msg:whatsapp"],
        permissions: ["create_mission"],
        approvalPolicies: ["wf_mkt_social_post", "wf_mkt_email_campaign"],
        kpis: ["campaigns_sent", "engagement_rate_pct"],
    },
    growth: {
        label: "Growth",
        requiredCapabilities: ["growth_suggestions", "analytics"],
        skills: ["growth_suggestions", "analytics"],
        connectors: [],
        permissions: ["view_analytics"],
        approvalPolicies: [],
        kpis: ["mrr_growth_pct", "churn_rate_pct"],
    },
    customer_success: {
        label: "Customer Success",
        requiredCapabilities: ["customer_support"],
        skills: ["customer_support"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["nps_score", "retention_rate_pct"],
    },
    support: {
        label: "Support",
        requiredCapabilities: ["customer_support"],
        skills: ["customer_support"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["tickets_resolved", "avg_resolution_hours"],
    },
    product: {
        label: "Product",
        requiredCapabilities: ["ai"],
        skills: ["strategy"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["feature_adoption_pct"],
    },
    engineering: {
        label: "Engineering",
        requiredCapabilities: ["dev", "filesystem"],
        skills: ["dev", "code_search", "patch_generate", "patch_apply"],
        connectors: ["git:github"],
        permissions: ["create_mission"],
        approvalPolicies: ["wf_eng_code_review", "wf_eng_dependency_update"],
        kpis: ["velocity_points_per_sprint", "bug_count_open"],
    },
    ai: {
        label: "AI",
        requiredCapabilities: ["ai"],
        skills: ["ai"],
        connectors: ["ai:groq", "ai:openai"],
        permissions: ["use_ai"],
        approvalPolicies: [],
        kpis: ["ai_calls_per_day", "ai_cost_monthly"],
    },
    devops_cloud: {
        label: "DevOps/Cloud",
        requiredCapabilities: ["dev"],
        skills: ["build_run", "test_run", "git_status", "git_diff"],
        connectors: ["infra:cloudflare", "infra:aws"],
        permissions: ["create_mission"],
        approvalPolicies: ["wf_deploy_vps_provision", "wf_deploy_env_config", "wf_eng_deploy_release"],
        kpis: ["deploy_frequency_weekly", "deploy_success_rate_pct"],
    },
    qa: {
        label: "QA",
        requiredCapabilities: ["dev"],
        skills: ["test_run"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["test_pass_rate_pct", "regression_count"],
    },
    security: {
        label: "Security",
        requiredCapabilities: ["ai"],
        skills: [],
        connectors: [],
        permissions: ["manage_policy"],
        approvalPolicies: [],
        kpis: ["security_incidents_open"],
        note: "Security agent tick is explicitly read-only by design (agentRuntimeSupervisor.cjs agent_security — creates missions only, never modifies code).",
    },
    data_analytics: {
        label: "Data/Analytics",
        requiredCapabilities: ["analytics"],
        skills: ["analytics", "revenue"],
        connectors: [],
        permissions: ["view_analytics"],
        approvalPolicies: [],
        kpis: ["reports_generated"],
    },
    research: {
        label: "Research",
        requiredCapabilities: ["research", "news", "trend_analysis"],
        skills: ["web_scraping", "news", "trend_analysis", "competitor_tracking"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["research_reports_delivered"],
    },
    finance_accounting: {
        label: "Finance/Accounting",
        requiredCapabilities: ["revenue"],
        skills: ["revenue"],
        connectors: ["pay:razorpay"],
        permissions: ["manage_billing"],
        approvalPolicies: [],
        kpis: ["mrr", "burn_rate_monthly"],
        note: "Accounting (ledger/reconciliation/tax) has no dedicated code — Finance side (revenue tracking) is real via business_revenue; Accounting sub-function is composable:false.",
    },
    billing_payments: {
        label: "Billing/Payments",
        requiredCapabilities: ["payment_link", "subscription"],
        skills: ["payment_link", "subscription"],
        connectors: ["pay:razorpay"],
        permissions: ["manage_billing"],
        approvalPolicies: ["wf_refund_credit", "wf_refund_finance"],
        kpis: ["payments_processed", "refund_rate_pct"],
    },
    legal_compliance: {
        label: "Legal/Compliance",
        requiredCapabilities: ["ai"],
        skills: ["contract_analysis", "compliance_policy_check", "regulatory_filing_draft"],
        connectors: [],
        permissions: ["manage_policy"],
        approvalPolicies: [],
        kpis: ["contracts_reviewed", "compliance_checks_completed"],
        note: "100-Company Missing Capability Build-Out: analysis/draft-only via the existing generic 'ai' agent (real LLM calls, no fabricated execution). regulatory_filing_draft is riskLevel:high (real approval-gated, never auto-submitted) — no e-signature/regulatory-filing connector exists, so actual submission stays a human action by design, not a gap.",
    },
    hr_recruitment: {
        label: "HR/Recruitment",
        requiredCapabilities: ["ai"],
        skills: ["candidate_screening", "job_description_generation", "interview_coordination", "onboarding_plan_generation", "employment_action_review"],
        connectors: [],
        permissions: ["manage_members"],
        approvalPolicies: [],
        kpis: ["candidates_screened", "positions_filled"],
        note: "100-Company Missing Capability Build-Out: analysis/draft/coordination via the existing generic 'ai' agent. employment_action_review is riskLevel:high (real approval-gated) — final hire/termination decisions are never auto-executed; this codebase has no employment-action execution capability at all, correctly not fabricated.",
    },
    procurement: {
        label: "Procurement",
        requiredCapabilities: ["ai"],
        skills: ["vendor_evaluation", "rfq_generation", "purchase_request_draft"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["vendors_evaluated", "rfqs_generated"],
        note: "100-Company Missing Capability Build-Out: analysis/draft via the existing generic 'ai' agent. purchase_request_draft is riskLevel:high (real approval-gated) — real purchase/vendor commitment requires human approval; no payment-execution connector is wired to this department, correctly not fabricated.",
    },
    supply_chain: {
        label: "Supply Chain",
        requiredCapabilities: [],
        skills: [],
        connectors: [],
        permissions: [],
        approvalPolicies: [],
        kpis: [],
        requiresNewCapability: true,
        note: "100-Company Missing Capability Build-Out: confirmed this template blocks ZERO of the 100 real companies today (deriveDepartmentsForTemplate() never resolves this key for any of the 100 niches) — left honestly requiresNewCapability:true rather than building unused capacity. Supply-chain-specific needs the 100 companies actually express are already covered by inventory_warehouse/logistics/procurement above.",
    },
    inventory_warehouse: {
        label: "Inventory/Warehouse",
        requiredCapabilities: ["ai"],
        skills: ["inventory_forecast", "reorder_point_analysis", "stock_level_report"],
        connectors: [],
        permissions: ["view_analytics"],
        approvalPolicies: [],
        kpis: ["forecast_accuracy_pct", "stockout_incidents"],
        note: "100-Company Missing Capability Build-Out: analysis/reporting via the existing generic 'ai' agent. Genuine physical warehouse control (robotic picking, automated reordering execution) is out of scope — no warehouse-automation connector exists; this department is analysis-only by honest design, not a fabricated capability.",
    },
    logistics: {
        label: "Logistics",
        requiredCapabilities: ["ai"],
        skills: ["shipment_planning", "carrier_selection_analysis", "delivery_route_optimization"],
        connectors: [],
        permissions: ["view_analytics"],
        approvalPolicies: [],
        kpis: ["shipments_planned", "on_time_delivery_pct"],
        note: "100-Company Missing Capability Build-Out: planning/analysis via the existing generic 'ai' agent. Real carrier booking/tracking requires a shipping-provider connector — none is implemented yet (see Phase 5 connector audit); this department plans and analyzes, it does not book real shipments.",
    },
    brand_design: {
        label: "Brand/Design",
        requiredCapabilities: ["image_brief"],
        skills: ["image_brief"],
        connectors: ["creative:figma"],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["brand_assets_delivered"],
        note: "Real brief-generation (image_brief) exists; no actual image-generation API is called (no image-gen connector exists) — composable for briefs, not full asset production.",
    },
    content_seo: {
        label: "Content/SEO",
        requiredCapabilities: ["content_writer", "seo"],
        skills: ["content_writer", "seo", "caption_generation", "hashtag_generation"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: ["wf_mkt_blog_post"],
        kpis: ["content_pieces_published", "organic_traffic_growth_pct"],
    },
    video_audio_media: {
        label: "Video/Audio/Media",
        requiredCapabilities: ["audio", "video_brief"],
        skills: ["audio", "video_brief", "video_script", "reel_script", "podcast_script"],
        connectors: [],
        permissions: ["create_mission"],
        approvalPolicies: [],
        kpis: ["media_assets_produced"],
        note: "Audio/Voice is fully working (real TTS). Video is script/brief generation only — no video-file rendering connector exists.",
    },
    threed_cad: {
        label: "3D/CAD",
        requiredCapabilities: [],
        skills: [],
        connectors: [],
        permissions: [],
        approvalPolicies: [],
        kpis: [],
        requiresNewCapability: true,
    },
    manufacturing_production: {
        label: "Manufacturing/Production",
        requiredCapabilities: [],
        skills: [],
        connectors: [],
        permissions: [],
        approvalPolicies: [],
        kpis: [],
        requiresNewCapability: true,
    },
    iot_robotics_maintenance_quality: {
        label: "IoT/Robotics/Maintenance/Quality",
        requiredCapabilities: [],
        skills: [],
        connectors: [],
        permissions: [],
        approvalPolicies: [],
        kpis: [],
        requiresNewCapability: true,
    },
    energy_infrastructure: {
        label: "Energy/Infrastructure",
        requiredCapabilities: [],
        skills: [],
        connectors: [],
        permissions: [],
        approvalPolicies: [],
        kpis: [],
        requiresNewCapability: true,
    },
};

/**
 * Returns the list of registered department family keys.
 */
function listTemplateKeys() {
    return Object.keys(TEMPLATES);
}

/**
 * Returns a single template definition (a copy, not a live reference).
 */
function getTemplate(key) {
    const t = TEMPLATES[key];
    return t ? { key, ...t } : null;
}

/**
 * Returns every template definition (copies).
 */
function listTemplates() {
    return Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t }));
}

/**
 * Checks whether a template's required capabilities are ALL genuinely
 * registered in the real agent registry right now — not assumed from
 * this file's own authoring-time claims. Requires the caller to pass
 * the real registry (agents/runtime/agentRegistry.cjs) so this module
 * has no hard dependency on runtime internals and stays a pure data +
 * verification layer.
 *
 * @param {string} key            template key
 * @param {object} agentRegistry  the real agents/runtime/agentRegistry.cjs module
 * @returns {{ composable: boolean, missingCapabilities: string[] }}
 */
function isComposableNow(key, agentRegistry) {
    const t = TEMPLATES[key];
    if (!t) return { composable: false, missingCapabilities: [], error: "unknown template" };
    if (t.requiresNewCapability) return { composable: false, missingCapabilities: t.requiredCapabilities || [] };
    if (!t.requiredCapabilities || t.requiredCapabilities.length === 0) {
        return { composable: true, missingCapabilities: [] };
    }
    const all = agentRegistry.listAll();
    const registeredCaps = new Set(all.flatMap(a => a.capabilities));
    const missing = t.requiredCapabilities.filter(c => !registeredCaps.has(c));
    return { composable: missing.length === 0, missingCapabilities: missing };
}

/**
 * Compose a department instance's metadata for a given template — does
 * NOT call organizationService.createDepartment() itself (callers decide
 * when/whether to actually create the department record); returns the
 * data a caller would attach via createDepartment()'s existing
 * description field or a follow-up metadata store, plus honest
 * composability status.
 *
 * @param {string} key            template key
 * @param {object} agentRegistry  the real agents/runtime/agentRegistry.cjs module
 */
function composeDepartment(key, agentRegistry) {
    const t = getTemplate(key);
    if (!t) throw new Error(`Unknown department template: ${key}`);
    const status = isComposableNow(key, agentRegistry);
    return {
        templateKey: key,
        label: t.label,
        requiredCapabilities: t.requiredCapabilities,
        skills: t.skills,
        connectors: t.connectors,
        permissions: t.permissions,
        approvalPolicies: t.approvalPolicies,
        kpis: t.kpis,
        composable: status.composable,
        missingCapabilities: status.missingCapabilities,
        requiresNewCapability: !!t.requiresNewCapability,
        note: t.note || null,
    };
}

// Maps a businessTemplateEngine.cjs template's teamTypes/capabilities to
// this registry's department keys. Every template always gets Executive
// (every company has a founder/leadership function) + whatever its
// teamTypes/capabilities genuinely imply — this does not fabricate
// departments a template's own data doesn't support.
const TEAM_TYPE_TO_DEPARTMENTS = {
    engineering:     ["engineering", "devops_cloud", "qa"],
    design:          ["brand_design"],
    research:        ["research", "strategy"],
    business:        ["sales", "crm", "marketing", "growth", "customer_success", "finance_accounting"],
    mixed:           ["operations", "product"],
    deployment:      ["devops_cloud"],
    infrastructure:  ["devops_cloud", "data_analytics"],
    emergency:       ["security"],
};

const CAPABILITY_TO_DEPARTMENTS = {
    crm:                  ["crm", "sales"],
    subscription_billing: ["billing_payments"],
    billing:              ["billing_payments"],
    payment:              ["billing_payments"],
    payments:             ["billing_payments"],
    monitoring:           ["devops_cloud"],
    ci_cd:                ["devops_cloud"],
    onboarding:           ["customer_success"],
    hipaa_compliance:     ["legal_compliance"],
    audit_log:            ["legal_compliance", "security"],
    encryption:           ["security"],
    reporting:            ["data_analytics"],
    automation:           ["operations"],
    reviews:              ["customer_success"],
    fraud_detection:      ["security"],
    modules_hr:           ["hr_recruitment"],
    modules_finance:      ["finance_accounting"],
    modules_inventory:    ["inventory_warehouse"],
    modules_procurement:  ["procurement"],
    inventory:            ["inventory_warehouse"],
    logistics:            ["logistics"],
    order_management:     ["operations"],
    community:            ["customer_success"],
    proposal_generation:  ["sales"],
    project_tracking:     ["operations"],
};

/**
 * Derive the set of department keys a business template genuinely implies,
 * from its own real teamTypes + capabilities arrays (businessTemplateEngine.cjs).
 * Always includes "executive" (every company needs a leadership function).
 * @param {{teamTypes?: string[], capabilities?: string[]}} template
 * @returns {string[]} deduplicated department keys, all guaranteed to exist in this registry
 */
function deriveDepartmentsForTemplate(template = {}) {
    const keys = new Set(["executive"]);
    for (const tt of template.teamTypes || []) {
        for (const k of TEAM_TYPE_TO_DEPARTMENTS[tt] || []) keys.add(k);
    }
    for (const cap of template.capabilities || []) {
        for (const k of CAPABILITY_TO_DEPARTMENTS[cap] || []) keys.add(k);
    }
    // Only return keys that genuinely exist in this registry.
    return [...keys].filter(k => !!TEMPLATES[k]);
}

/**
 * Compose the full set of departments implied by a business template,
 * each with honest composability status against the real, live agent
 * registry.
 * @param {object} template       a businessTemplateEngine.cjs template object
 * @param {object} agentRegistry  the real agents/runtime/agentRegistry.cjs module
 */
function composeDepartmentsForTemplate(template, agentRegistry) {
    const keys = deriveDepartmentsForTemplate(template);
    return keys.map(k => composeDepartment(k, agentRegistry));
}

module.exports = {
    listTemplateKeys, getTemplate, listTemplates, isComposableNow, composeDepartment,
    deriveDepartmentsForTemplate, composeDepartmentsForTemplate,
};
