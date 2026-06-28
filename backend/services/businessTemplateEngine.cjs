"use strict";
/**
 * businessTemplateEngine.cjs — POST-Ω Sprint P8 Autonomous Company Factory
 *
 * Defines 10 business templates. Each template carries:
 *   - recommended workforce skills
 *   - required capabilities
 *   - governance model
 *   - KPI targets
 *   - default roadmap phases
 *   - tech stack suggestions
 *   - risk profile
 *
 * No own storage — pure reference data + inference.
 */

const TEMPLATES = {
  saas: {
    id:          "saas",
    name:        "SaaS",
    fullName:    "Software as a Service",
    description: "Subscription-based software product delivered over the web.",
    skills:      ["backend","frontend","api","database","devops","security","testing","documentation","release"],
    teamTypes:   ["engineering","deployment","design","research"],
    capabilities:["user_auth","subscription_billing","multi_tenant","api_gateway","monitoring","ci_cd","onboarding"],
    governance:  { approvalRequired: ["billing_changes","security_updates","major_release"], riskLevel: "medium" },
    kpis:        { mrr: 0, churn: 0, nps: 0, uptime: 99.9, cac: 0, ltv: 0 },
    roadmap:     ["mvp","private_beta","public_beta","v1_launch","growth","scale"],
    techStack:   ["Node.js","React","PostgreSQL","Redis","Stripe","AWS","Docker"],
    riskProfile: "medium",
    minutesSaved: 4800,
  },
  agency: {
    id:          "agency",
    name:        "Agency",
    fullName:    "AI/Digital Services Agency",
    description: "Service delivery business providing AI, development, or marketing services.",
    skills:      ["strategy","planning","documentation","coordination","delivery","marketing","sales","quality"],
    teamTypes:   ["business","mixed","research"],
    capabilities:["crm","project_tracking","client_portal","billing","proposal_generation","reporting"],
    governance:  { approvalRequired: ["client_proposals","major_contracts","team_expansion"], riskLevel: "low" },
    kpis:        { revenue: 0, utilization: 0, clientSatisfaction: 0, projectMargin: 0 },
    roadmap:     ["setup","first_clients","portfolio","team_growth","productize","scale"],
    techStack:   ["CRM","Project Mgmt","Billing","Communication","Analytics"],
    riskProfile: "low",
    minutesSaved: 3200,
  },
  ecommerce: {
    id:          "ecommerce",
    name:        "Ecommerce",
    fullName:    "Ecommerce Store",
    description: "Online retail selling physical or digital products.",
    skills:      ["frontend","backend","database","devops","marketing","analytics","security"],
    teamTypes:   ["engineering","design","business","deployment"],
    capabilities:["product_catalog","cart","payment","inventory","order_management","logistics","reviews"],
    governance:  { approvalRequired: ["pricing_changes","new_categories","payment_integrations"], riskLevel: "medium" },
    kpis:        { gmv: 0, conversion: 0, aov: 0, cart_abandonment: 0, return_rate: 0 },
    roadmap:     ["catalog_setup","payment_integration","launch","marketing","expansion","optimization"],
    techStack:   ["Shopify/Custom","Stripe","Cloudflare","Analytics","Email","Logistics API"],
    riskProfile: "medium",
    minutesSaved: 3600,
  },
  marketplace: {
    id:          "marketplace",
    name:        "Marketplace",
    fullName:    "Two-Sided Marketplace",
    description: "Platform connecting buyers and sellers, creators and consumers.",
    skills:      ["backend","frontend","api","database","devops","security","testing","marketing"],
    teamTypes:   ["engineering","design","business","deployment","research"],
    capabilities:["listing_management","search","matching","escrow","reviews","notifications","fraud_detection"],
    governance:  { approvalRequired: ["fee_changes","seller_onboarding_policy","trust_system"], riskLevel: "high" },
    kpis:        { gmv: 0, take_rate: 0, buyer_retention: 0, seller_satisfaction: 0, liquidity: 0 },
    roadmap:     ["supply_side","demand_side","matching","trust","growth","international"],
    techStack:   ["Node.js","React","Elasticsearch","PostgreSQL","Stripe Connect","AWS"],
    riskProfile: "high",
    minutesSaved: 5200,
  },
  healthcare: {
    id:          "healthcare",
    name:        "Healthcare",
    fullName:    "Healthcare Startup",
    description: "Digital health product serving patients, providers, or payers.",
    skills:      ["backend","security","compliance","documentation","api","database","testing","architecture"],
    teamTypes:   ["engineering","research","deployment"],
    capabilities:["hipaa_compliance","ehr_integration","patient_portal","scheduling","billing","audit_log","encryption"],
    governance:  { approvalRequired: ["all_releases","data_access_changes","vendor_integrations","phi_processing"], riskLevel: "critical" },
    kpis:        { patient_outcomes: 0, adherence: 0, nps: 0, hipaa_audit_score: 0, downtime: 0 },
    roadmap:     ["compliance_setup","core_product","pilot","regulatory","launch","scale"],
    techStack:   ["HIPAA-compliant AWS","Node.js","React","PostgreSQL","HL7 FHIR","Encryption"],
    riskProfile: "critical",
    minutesSaved: 6400,
  },
  education: {
    id:          "education",
    name:        "Education",
    fullName:    "EdTech Platform",
    description: "Learning management or education delivery platform.",
    skills:      ["backend","frontend","api","database","documentation","testing","marketing"],
    teamTypes:   ["engineering","design","research","business"],
    capabilities:["course_builder","video_delivery","quiz","progress_tracking","certificates","payments","community"],
    governance:  { approvalRequired: ["content_policies","payment_changes","data_retention"], riskLevel: "medium" },
    kpis:        { learners: 0, completion_rate: 0, nps: 0, revenue: 0, content_hours: 0 },
    roadmap:     ["content_framework","delivery_platform","first_cohort","self_serve","growth","enterprise"],
    techStack:   ["Node.js","React","Video CDN","PostgreSQL","Stripe","Analytics"],
    riskProfile: "medium",
    minutesSaved: 3800,
  },
  crm: {
    id:          "crm",
    name:        "CRM",
    fullName:    "Customer Relationship Management",
    description: "Internal or commercial CRM system for managing contacts and pipelines.",
    skills:      ["backend","frontend","api","database","devops","testing","documentation"],
    teamTypes:   ["engineering","business","deployment"],
    capabilities:["contact_management","pipeline","email_integration","reporting","automation","mobile","api"],
    governance:  { approvalRequired: ["data_export","integrations","security_changes"], riskLevel: "medium" },
    kpis:        { pipeline_velocity: 0, win_rate: 0, data_quality: 0, user_adoption: 0 },
    roadmap:     ["data_model","core_ui","integrations","automation","reporting","mobile"],
    techStack:   ["Node.js","React","PostgreSQL","Email API","Webhook","Analytics"],
    riskProfile: "medium",
    minutesSaved: 3200,
  },
  erp: {
    id:          "erp",
    name:        "ERP",
    fullName:    "Enterprise Resource Planning",
    description: "Integrated business management system covering ops, finance, HR, and supply chain.",
    skills:      ["backend","database","architecture","security","testing","documentation","api","devops"],
    teamTypes:   ["engineering","research","deployment","infrastructure"],
    capabilities:["modules_finance","modules_hr","modules_inventory","modules_procurement","reporting","audit","api"],
    governance:  { approvalRequired: ["all_module_changes","data_migration","financial_changes","access_control"], riskLevel: "high" },
    kpis:        { process_efficiency: 0, data_accuracy: 0, user_adoption: 0, audit_score: 0 },
    roadmap:     ["architecture","core_modules","integration","pilot","rollout","optimization"],
    techStack:   ["Node.js","PostgreSQL","React","Redis","Queue","Reporting Engine"],
    riskProfile: "high",
    minutesSaved: 7200,
  },
  ai_product: {
    id:          "ai_product",
    name:        "AI Product",
    fullName:    "AI-Powered Product",
    description: "Product with AI/ML at its core — autonomous agents, copilots, or AI APIs.",
    skills:      ["backend","api","architecture","research","testing","documentation","devops","performance"],
    teamTypes:   ["engineering","research","deployment"],
    capabilities:["model_integration","prompt_management","memory","streaming","rate_limiting","observability","evals"],
    governance:  { approvalRequired: ["model_changes","safety_evals","cost_thresholds","data_usage"], riskLevel: "high" },
    kpis:        { latency_p99: 0, accuracy: 0, cost_per_call: 0, user_satisfaction: 0, hallucination_rate: 0 },
    roadmap:     ["prototype","evals_framework","beta","safety_review","launch","scale"],
    techStack:   ["Node.js/Python","Claude API","PostgreSQL","Redis","Vercel/AWS","Observability"],
    riskProfile: "high",
    minutesSaved: 5600,
  },
  internal_tool: {
    id:          "internal_tool",
    name:        "Internal Tool",
    fullName:    "Internal Business Tool",
    description: "Custom internal software automating business processes or workflows.",
    skills:      ["backend","frontend","api","database","testing","documentation"],
    teamTypes:   ["engineering","business","mixed"],
    capabilities:["auth","dashboard","workflow_engine","notifications","reporting","integrations","admin"],
    governance:  { approvalRequired: ["access_changes","integrations","data_exports"], riskLevel: "low" },
    kpis:        { time_saved: 0, adoption: 0, errors_reduced: 0, process_efficiency: 0 },
    roadmap:     ["requirements","prototype","feedback","v1","training","iterate"],
    techStack:   ["Node.js","React","SQLite/PostgreSQL","Simple Auth","Webhooks"],
    riskProfile: "low",
    minutesSaved: 2400,
  },
};

// ── NL inference ──────────────────────────────────────────────────────────────

const _PATTERNS = [
  [/saas|subscription|software[- ]as|cloud[- ]app|b2b[- ]software/i,     "saas"],
  [/agency|consultanc|services?[- ]firm|freelanc|studio/i,                "agency"],
  [/ecommerce|e-?commerce|online[- ]store|retail|shopif/i,                "ecommerce"],
  [/marketplace|platform[- ](for|connecting)|two-?sided|gig[- ]economy/i, "marketplace"],
  [/health|medical|clinic|patient|hipaa|ehr|pharma|telemedicin/i,          "healthcare"],
  [/educat|learn|course|tutori|lms|edtech|school|training/i,              "education"],
  [/\bcrm\b|customer[- ]relation|contact[- ]manag|sales[- ]pipeline/i,    "crm"],
  [/\berp\b|enterprise[- ]resource|resource[- ]planning|hr[- ]system/i,   "erp"],
  [/\bai\b.*product|\bai\b.*tool|copilot|agent[- ]platform|llm[- ]app/i, "ai_product"],
  [/internal|inhouse|in-?house|back[- ]office|admin[- ]tool|workflow/i,   "internal_tool"],
];

function inferTemplate(description) {
  const lc = (description || "").toLowerCase();
  for (const [pattern, id] of _PATTERNS) {
    if (pattern.test(lc)) return TEMPLATES[id];
  }
  // Default to saas
  return TEMPLATES.saas;
}

function getTemplate(id) {
  return TEMPLATES[id] || null;
}

function listTemplates() {
  return Object.values(TEMPLATES);
}

module.exports = {
  TEMPLATES,
  inferTemplate,
  getTemplate,
  listTemplates,
};
