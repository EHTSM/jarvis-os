"use strict";
/**
 * capabilityDiscovery.cjs — Phase 1 (Capability Coverage), Missions 109-112.
 *
 * Maps a natural-language user request to one or more real, registered
 * capabilities in skillRegistry.cjs (the existing canonical registry —
 * see skillRegistry.cjs's own header for why it, not any of the other
 * capability-shaped stores in this codebase, is the source of truth).
 *
 * This module does NOT execute anything and does NOT decide who is
 * allowed to run a match — it only answers "what capability could satisfy
 * this request", using the same keyword/pattern-matching paradigm already
 * established by capabilityRouter.cjs's INTENT_PATTERNS and
 * computerExecutionEngine.cjs's COMMAND_PATTERNS, applied to
 * skillRegistry's real skill set instead of AI-model modalities or
 * desktop-automation commands (neither of which cover business/work
 * capabilities like "qualify a lead" or "draft a job description").
 *
 * Authorization, tenant scope, approval, and risk gating are NOT this
 * module's job — see capabilityRouting.cjs, which is the only place a
 * discovered capability may be checked against who can actually run it.
 */

const skillRegistry = require("./skillRegistry.cjs");

// Domain aliases — lets a query use a common synonym for a skillRegistry
// category without requiring the caller to know the internal category
// string. Additive only; every value here must be a real category already
// present in skillRegistry's seed data.
const DOMAIN_ALIASES = {
    hr: "hr_recruitment",
    recruiting: "hr_recruitment",
    recruitment: "hr_recruitment",
    legal: "legal_compliance",
    compliance: "legal_compliance",
    warehouse: "inventory_warehouse",
    inventory: "inventory_warehouse",
    shipping: "logistics",
    devops: "devops_cloud",
    cloud: "devops_cloud",
    support: "customer_success",
    cs: "customer_success",
    exec: "executive",
    biz: "operations",
};

// Extra keyword -> skill-id hints for cases where the skill's own id/name
// text wouldn't naturally match the way a founder phrases a request.
// Every target id here must resolve to a real skillRegistry entry —
// verified by discoverySelfCheck() below, not assumed.
const KEYWORD_HINTS = [
    { pattern: /qualify.*lead|lead.*qualif/i,            skillId: "crm" },
    { pattern: /screen.*candidate|candidate.*screen/i,   skillId: "candidate_screening" },
    { pattern: /job\s*(post|listing|description)/i,      skillId: "job_description_generation" },
    { pattern: /onboard.*employee|employee.*onboard/i,   skillId: "onboarding_plan_generation" },
    { pattern: /fire|terminat|layoff/i,                  skillId: "employment_action_review" },
    { pattern: /contract.*review|review.*contract/i,     skillId: "contract_analysis" },
    { pattern: /file.*regulat|regulatory.*fil/i,         skillId: "regulatory_filing_draft" },
    { pattern: /rfq|request.*quote/i,                    skillId: "rfq_generation" },
    { pattern: /purchase.*order|buy.*from.*vendor/i,     skillId: "purchase_request_draft" },
    { pattern: /reorder.*point|when.*to.*reorder/i,      skillId: "reorder_point_analysis" },
    { pattern: /stock.*level|inventory.*report/i,        skillId: "stock_level_report" },
    { pattern: /ship(ment)?.*plan/i,                      skillId: "shipment_planning" },
    { pattern: /pick.*carrier|carrier.*select/i,          skillId: "carrier_selection_analysis" },
    { pattern: /deliver.*route|route.*optim/i,            skillId: "delivery_route_optimization" },
    { pattern: /send\s*(an?\s*)?email/i,                  skillId: "crm" },
    { pattern: /social.*post|post.*to.*social/i,          skillId: "content_scheduling" },
    { pattern: /seo|keyword.*research|rank.*track/i,      skillId: "seo" },
    { pattern: /deploy|release|push.*prod/i,              skillId: "automation" },
    { pattern: /run.*test|test.*fail/i,                   skillId: "test_run" },
    { pattern: /build.*fail|npm.*build/i,                 skillId: "build_run" },
    { pattern: /rollback|revert.*deploy/i,                skillId: "rollback" },
    { pattern: /commit.*change|git.*commit/i,             skillId: "git_commit" },
    { pattern: /weather/i,                                 skillId: "weather" },
    { pattern: /health.*check|monitor.*system/i,          skillId: "system_health" },
];

function _normalize(text) {
    return (text || "").toLowerCase().trim();
}

function _tokenize(text) {
    return _normalize(text).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * discover(intentText, opts) -> { query, matches: [{ skillId, name, category,
 *   riskLevel, executionHandler, healthStatus, score, reason }], domain }
 *
 * opts.domain — optional explicit category/domain filter (accepts a
 *   DOMAIN_ALIASES key or a real skillRegistry category string).
 * opts.limit  — max matches returned (default 5).
 *
 * Scoring is deliberately simple and explainable (exact id match > keyword
 * hint > name-substring > category/domain match > token overlap) rather
 * than a black-box ranking — every match carries a `reason` so a caller
 * (or an operator reviewing a routing decision) can see why it surfaced.
 */
function discover(intentText, opts = {}) {
    const query = _normalize(intentText);
    const limit = opts.limit || 5;
    const domainFilter = opts.domain ? (DOMAIN_ALIASES[_normalize(opts.domain)] || _normalize(opts.domain)) : null;

    const skills = skillRegistry.listSkills();
    const tokens = _tokenize(query);
    const scored = new Map(); // skillId -> { skill, score, reasons: Set }

    function _bump(skill, score, reason) {
        if (domainFilter && skill.category !== domainFilter) return;
        const entry = scored.get(skill.id) || { skill, score: 0, reasons: new Set() };
        entry.score += score;
        entry.reasons.add(reason);
        scored.set(skill.id, entry);
    }

    // 1. Exact skill id match
    const exact = skills.find(s => s.id === query);
    if (exact) _bump(exact, 100, "exact_id_match");

    // 2. Keyword hints (curated, high-precision)
    for (const { pattern, skillId } of KEYWORD_HINTS) {
        if (!pattern.test(query)) continue;
        const skill = skills.find(s => s.id === skillId);
        if (skill) _bump(skill, 50, "keyword_hint");
    }

    // 3. Name substring / token overlap against skill name+id
    for (const skill of skills) {
        const haystack = `${skill.id} ${skill.name}`.toLowerCase();
        if (query && haystack.includes(query)) { _bump(skill, 30, "substring_match"); continue; }
        const hitCount = tokens.filter(t => t.length > 2 && haystack.includes(t)).length;
        if (hitCount > 0) _bump(skill, hitCount * 5, "token_overlap");
    }

    // 4. Domain-only request (no useful text match) — surface the domain's
    // skills so a caller can browse, still explainable as "domain_match".
    if (domainFilter) {
        for (const skill of skills) {
            if (skill.category === domainFilter && !scored.has(skill.id)) {
                _bump(skill, 10, "domain_match");
            }
        }
    }

    const matches = [...scored.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ skill, score, reasons }) => ({
            skillId: skill.id,
            name: skill.name,
            category: skill.category,
            riskLevel: skill.riskLevel,
            executionHandler: skill.executionHandler,
            healthStatus: skill.healthStatus,
            score,
            reason: [...reasons].join(","),
        }));

    return { query: intentText || "", domain: domainFilter, matches, totalConsidered: skills.length };
}

/**
 * listDomains() -> [{ domain, skillCount, skills: [id,...] }]
 * Real domain/category coverage, computed from skillRegistry's live data
 * (never a hard-coded list) so it can't drift from what's actually
 * registered.
 */
function listDomains() {
    const byDomain = new Map();
    for (const skill of skillRegistry.listSkills()) {
        const entry = byDomain.get(skill.category) || { domain: skill.category, skillCount: 0, skills: [] };
        entry.skillCount += 1;
        entry.skills.push(skill.id);
        byDomain.set(skill.category, entry);
    }
    return [...byDomain.values()].sort((a, b) => b.skillCount - a.skillCount);
}

/**
 * discoverySelfCheck() -> { ok, danglingHints: [...] }
 * Verifies every KEYWORD_HINTS target and DOMAIN_ALIASES target resolves
 * to something real in skillRegistry — same "no fabricated reference"
 * discipline as skillRegistry.verifyNoOrphans(). Intended for a startup/
 * test check, not a hot path.
 */
function discoverySelfCheck() {
    const skills = skillRegistry.listSkills();
    const ids = new Set(skills.map(s => s.id));
    const categories = new Set(skills.map(s => s.category));

    const danglingHints = KEYWORD_HINTS.filter(h => !ids.has(h.skillId)).map(h => h.skillId);
    const danglingAliases = Object.entries(DOMAIN_ALIASES)
        .filter(([, target]) => !categories.has(target))
        .map(([alias]) => alias);

    return { ok: danglingHints.length === 0 && danglingAliases.length === 0, danglingHints, danglingAliases };
}

module.exports = { discover, listDomains, discoverySelfCheck, DOMAIN_ALIASES };
