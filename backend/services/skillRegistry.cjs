"use strict";
/**
 * skillRegistry.cjs — Universal Composition Engine, Phase 5.
 *
 * A single, discoverable registry of every genuinely executable skill in
 * JARVIS. Consolidates what was previously scattered across three
 * disconnected places (per the mission's Rule 0 audit):
 *   - agents/runtime/agentRegistry.cjs   — 46 capability tags, real handlers
 *   - backend/services/engineeringCapabilities.cjs — 12 capability names,
 *     real handlers, registered into a separate autonomousExecutionRuntime
 *   - backend/services/skillEngine.cjs AGENT_CATALOGUE — confirmed DEAD,
 *     plain string tags with no handler; NOT a source for this registry
 *
 * This module does NOT create new execution logic. It is a metadata +
 * discovery layer over the two real runtimes above. A skill only gets
 * registered here if it has a genuine, already-verified execution
 * handler (per docs/audits/AGENT-SKILL-CONNECTOR-MATRIX.md Phase 4's
 * 58-skill deduplicated inventory) — prompt-only abilities are never
 * registered as skills, per the mission's "no fake capability claims"
 * rule.
 *
 * Each skill declares: id, name, category, description, inputSchema,
 * outputSchema, requiredPermissions, requiredTools, optionalConnectors,
 * riskLevel, executionHandler (a reference — the real capability id in
 * agentRegistry.cjs or the capability name in engineeringCapabilities.cjs,
 * NOT a duplicated function), version, healthStatus.
 *
 * Storage: data/skills.json (self-initializing, matching
 * organizationService.cjs's _read()/_write() convention). The 58 real
 * skills are seeded on first read if the store is empty — this is
 * metadata seeding from already-verified capabilities, not new logic.
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const DATA_DIR    = path.join(__dirname, "../../data");
const SKILLS_FILE = path.join(DATA_DIR, "skills.json");

function _contract() { try { return require("./capabilityContract.cjs"); } catch { return null; } }
function _agentRegistry() { try { return require("../../agents/runtime/agentRegistry.cjs"); } catch { return null; } }
function _engCaps() { try { return require("./engineeringCapabilities.cjs"); } catch { return null; } }

// Seed data — every entry here corresponds to a real, already-verified
// handler in agentRegistry.cjs or engineeringCapabilities.cjs, per the
// Phase 4 deduplicated skill inventory audit (AGENT-SKILL-CONNECTOR-MATRIX.md).
// `executionHandler` is the exact capability id/name a real handler is
// registered under — resolvable via findForCapability()/getCapabilityMatrix().
// `source` records which real runtime owns the handler (never duplicated here).
const SEED_SKILLS = [
    // ── agentRegistry.cjs capabilities (46) ──────────────────────────────
    { id: "ai",                         name: "AI Generation",            category: "executive",  riskLevel: "low",    executionHandler: "ai",                         source: "agentRegistry" },
    { id: "intelligence",               name: "AI Intelligence",          category: "ai",          riskLevel: "low",    executionHandler: "intelligence",               source: "agentRegistry" },
    { id: "analytics",                  name: "Business Analytics",       category: "data",        riskLevel: "low",    executionHandler: "analytics",                  source: "agentRegistry" },
    { id: "revenue",                    name: "Revenue Tracking",         category: "finance",     riskLevel: "medium", executionHandler: "revenue",                    source: "agentRegistry" },
    { id: "subscription",               name: "Subscription Management",  category: "finance",     riskLevel: "medium", executionHandler: "subscription",               source: "agentRegistry" },
    { id: "payment_link",               name: "Payment Link Creation",    category: "finance",     riskLevel: "high",   executionHandler: "payment_link",               source: "agentRegistry" },
    { id: "crm",                        name: "CRM Core",                 category: "sales",       riskLevel: "low",    executionHandler: "crm",                        source: "agentRegistry" },
    { id: "crm_extended",               name: "CRM Extended",             category: "sales",       riskLevel: "low",    executionHandler: "crm_extended",               source: "agentRegistry" },
    { id: "marketing_campaign",         name: "Marketing Campaigns",      category: "marketing",   riskLevel: "medium", executionHandler: "marketing_campaign",         source: "agentRegistry" },
    { id: "seo",                        name: "SEO",                      category: "marketing",   riskLevel: "low",    executionHandler: "seo",                        source: "agentRegistry" },
    { id: "growth_suggestions",         name: "Growth Suggestions",       category: "marketing",   riskLevel: "low",    executionHandler: "growth_suggestions",         source: "agentRegistry" },
    { id: "customer_support",           name: "Customer Support",         category: "customer_success", riskLevel: "low", executionHandler: "customer_support",       source: "agentRegistry" },
    { id: "content_writer",             name: "Content Writing",          category: "creative",    riskLevel: "low",    executionHandler: "content_writer",             source: "agentRegistry" },
    { id: "content_scheduling",         name: "Content Scheduling",       category: "creative",    riskLevel: "low",    executionHandler: "content_scheduling",         source: "agentRegistry" },
    { id: "audio",                      name: "Audio Generation",         category: "creative",    riskLevel: "low",    executionHandler: "audio",                      source: "agentRegistry" },
    { id: "voice",                      name: "Voice Generation",         category: "creative",    riskLevel: "low",    executionHandler: "voice",                      source: "agentRegistry" },
    { id: "caption_generation",         name: "Caption Generation",       category: "creative",    riskLevel: "low",    executionHandler: "caption_generation",         source: "agentRegistry" },
    { id: "hashtag_generation",         name: "Hashtag Generation",       category: "creative",    riskLevel: "low",    executionHandler: "hashtag_generation",         source: "agentRegistry" },
    { id: "image_brief",                name: "Image Brief Generation",   category: "creative",    riskLevel: "low",    executionHandler: "image_brief",                source: "agentRegistry" },
    { id: "podcast_script",             name: "Podcast Script Generation",category: "creative",    riskLevel: "low",    executionHandler: "podcast_script",             source: "agentRegistry" },
    { id: "reel_script",                name: "Reel Script Generation",   category: "creative",    riskLevel: "low",    executionHandler: "reel_script",                source: "agentRegistry" },
    { id: "video_script",               name: "Video Script Generation",  category: "creative",    riskLevel: "low",    executionHandler: "video_script",               source: "agentRegistry" },
    { id: "video_brief",                name: "Video Brief Generation",   category: "creative",    riskLevel: "low",    executionHandler: "video_brief",                source: "agentRegistry" },
    { id: "thumbnail_brief",            name: "Thumbnail Brief Generation", category: "creative",  riskLevel: "low",    executionHandler: "thumbnail_brief",            source: "agentRegistry" },
    { id: "browser",                    name: "Browser Control",          category: "engineering", riskLevel: "medium", executionHandler: "browser",                    source: "agentRegistry" },
    { id: "terminal",                   name: "Terminal Execution",       category: "engineering", riskLevel: "high",   executionHandler: "terminal",                   source: "agentRegistry" },
    { id: "automation",                 name: "Task Automation",         category: "operations",  riskLevel: "medium", executionHandler: "automation",                 source: "agentRegistry" },
    { id: "dev",                        name: "Dev Tooling",              category: "engineering", riskLevel: "medium", executionHandler: "dev",                        source: "agentRegistry" },
    { id: "filesystem",                 name: "Filesystem Access",        category: "engineering", riskLevel: "medium", executionHandler: "filesystem",                 source: "agentRegistry" },
    { id: "web_scraping",               name: "Web Scraping",             category: "research",     riskLevel: "medium", executionHandler: "web_scraping",               source: "agentRegistry" },
    { id: "research",                   name: "Research",                 category: "research",     riskLevel: "low",    executionHandler: "research",                   source: "agentRegistry" },
    { id: "browser_automation",         name: "Browser Automation",       category: "research",     riskLevel: "medium", executionHandler: "browser_automation",         source: "agentRegistry" },
    { id: "api_fetch",                  name: "Authenticated API Fetch",  category: "research",     riskLevel: "medium", executionHandler: "api_fetch",                  source: "agentRegistry" },
    { id: "integration",                name: "Generic Integration",      category: "research",     riskLevel: "medium", executionHandler: "integration",                source: "agentRegistry" },
    { id: "news",                       name: "News Aggregation",         category: "research",     riskLevel: "low",    executionHandler: "news",                       source: "agentRegistry" },
    { id: "social_media",               name: "Social Media Monitoring",  category: "research",     riskLevel: "low",    executionHandler: "social_media",               source: "agentRegistry" },
    { id: "trend_analysis",             name: "Trend Analysis",           category: "research",     riskLevel: "low",    executionHandler: "trend_analysis",             source: "agentRegistry" },
    { id: "market_intelligence",        name: "Market Intelligence",      category: "research",     riskLevel: "low",    executionHandler: "market_intelligence",        source: "agentRegistry" },
    { id: "competitor_tracking",        name: "Competitor Tracking",      category: "research",     riskLevel: "low",    executionHandler: "competitor_tracking",        source: "agentRegistry" },
    { id: "market_intelligence_report", name: "Market Intelligence Report", category: "research",   riskLevel: "low",    executionHandler: "market_intelligence_report", source: "agentRegistry" },
    { id: "quant",                      name: "Quantitative Analysis",    category: "research",     riskLevel: "low",    executionHandler: "quant",                      source: "agentRegistry" },
    { id: "location_lookup",            name: "Location Lookup",          category: "physical",     riskLevel: "low",    executionHandler: "location_lookup",            source: "agentRegistry" },
    { id: "geospatial",                 name: "Geospatial Lookup",        category: "physical",     riskLevel: "low",    executionHandler: "geospatial",                 source: "agentRegistry" },
    { id: "weather",                    name: "Weather Lookup",           category: "physical",     riskLevel: "low",    executionHandler: "weather",                    source: "agentRegistry" },
    { id: "system_health",              name: "System Health Monitoring", category: "devops_cloud", riskLevel: "low",    executionHandler: "system_health",              source: "agentRegistry" },
    { id: "monitoring",                 name: "Monitoring",               category: "devops_cloud", riskLevel: "low",    executionHandler: "monitoring",                 source: "agentRegistry" },

    // ── engineeringCapabilities.cjs capabilities (12) ────────────────────
    { id: "repo_read",      name: "Repository Read",       category: "engineering", riskLevel: "low",    executionHandler: "repo_read",      source: "engineeringCapabilities" },
    { id: "repo_index",     name: "Repository Index",      category: "engineering", riskLevel: "low",    executionHandler: "repo_index",     source: "engineeringCapabilities" },
    { id: "code_search",    name: "Code Search",           category: "engineering", riskLevel: "low",    executionHandler: "code_search",    source: "engineeringCapabilities" },
    { id: "file_read",      name: "File Read",             category: "engineering", riskLevel: "low",    executionHandler: "file_read",      source: "engineeringCapabilities" },
    { id: "patch_generate", name: "Patch Intent Recording", category: "engineering", riskLevel: "medium", executionHandler: "patch_generate", source: "engineeringCapabilities" },
    { id: "patch_apply",    name: "Patch Apply Verification", category: "engineering", riskLevel: "medium", executionHandler: "patch_apply", source: "engineeringCapabilities" },
    { id: "build_run",      name: "Build Execution",       category: "devops_cloud", riskLevel: "medium", executionHandler: "build_run",     source: "engineeringCapabilities" },
    { id: "test_run",       name: "Test Execution",        category: "qa",          riskLevel: "medium", executionHandler: "test_run",       source: "engineeringCapabilities" },
    { id: "rollback",       name: "Git Rollback",          category: "engineering", riskLevel: "high",   executionHandler: "rollback",       source: "engineeringCapabilities" },
    { id: "git_status",     name: "Git Status",            category: "engineering", riskLevel: "low",    executionHandler: "git_status",     source: "engineeringCapabilities" },
    { id: "git_diff",       name: "Git Diff",              category: "engineering", riskLevel: "low",    executionHandler: "git_diff",       source: "engineeringCapabilities" },
    { id: "git_commit",     name: "Git Commit (approval-aware)", category: "engineering", riskLevel: "high", executionHandler: "git_commit", source: "engineeringCapabilities" },
];

function _read() {
    try {
        const store = JSON.parse(fs.readFileSync(SKILLS_FILE, "utf8"));
        if (store.skills && store.skills.length > 0) return store;
    } catch { /* fall through to seed */ }
    return _seed();
}

function _seed() {
    const now = new Date().toISOString();
    const store = {
        skills: SEED_SKILLS.map(s => ({
            id: s.id,
            name: s.name,
            category: s.category,
            description: `${s.name} — real, verified capability (source: ${s.source})`,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            requiredPermissions: [],
            requiredTools: [],
            optionalConnectors: [],
            riskLevel: s.riskLevel,
            executionHandler: s.executionHandler,
            source: s.source,
            version: "1.0.0",
            healthStatus: "active",
            createdAt: now,
        })),
    };
    _write(store);
    return store;
}

function _write(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SKILLS_FILE, JSON.stringify(store, null, 2));
}

/**
 * Returns every registered skill (copies, not live references).
 */
function listSkills() {
    return _read().skills.map(s => ({ ...s }));
}

/**
 * Returns a single skill by id, or null.
 */
function getSkill(id) {
    const found = _read().skills.find(s => s.id === id);
    return found ? { ...found } : null;
}

/**
 * Search skills by a required capability string — used by callers (e.g.
 * departmentTemplateRegistry.cjs's future consumers) that need to know
 * "is there a real skill that satisfies this requirement".
 */
function findByCapability(capabilityId) {
    return getSkill(capabilityId);
}

/**
 * Registers a new skill. Validated against capabilityContract.cjs's Skill
 * kind. Used by (a) manual registration of a genuinely new skill, and
 * (b) Phase 13's Capability Evolution registration path
 * (repositoryEditingEngine.registerCapabilityFromBundle) — new skills
 * registered via that path must set healthStatus:"pending", not "active",
 * until human approval (enforced by the caller, not this function).
 */
function registerSkill(skill) {
    const contract = _contract();
    if (contract) {
        const check = contract.validate("Skill", skill);
        if (!check.ok) throw new Error(`Invalid skill: ${check.errors.join("; ")}`);
    }
    const store = _read();
    if (store.skills.some(s => s.id === skill.id)) {
        throw new Error(`Skill "${skill.id}" is already registered`);
    }
    store.skills.push({ ...skill, createdAt: skill.createdAt || new Date().toISOString() });
    _write(store);
    logger.info(`[SkillRegistry] Registered skill ${skill.id} (healthStatus=${skill.healthStatus})`);
    return getSkill(skill.id);
}

/**
 * Verifies every registered skill's executionHandler genuinely resolves
 * to a real, live handler in one of the two real runtimes — proves "no
 * orphan registrations" rather than assuming the seed data stays correct
 * forever (e.g. if an agent is ever removed from agentRegistry).
 */
function verifyNoOrphans() {
    const agentRegistry = _agentRegistry();
    const engCaps = _engCaps();
    const liveAgentCaps = new Set((agentRegistry?.listAll() || []).flatMap(a => [...a.capabilities]));
    const liveEngCapNames = new Set((engCaps?.getCapabilityMatrix?.() || []).map(c => c.name));

    const orphans = [];
    for (const skill of listSkills()) {
        const resolvesInAgentRegistry = liveAgentCaps.has(skill.executionHandler);
        const resolvesInEngCaps = liveEngCapNames.has(skill.executionHandler);
        if (!resolvesInAgentRegistry && !resolvesInEngCaps) {
            orphans.push(skill.id);
        }
    }
    return { ok: orphans.length === 0, orphans };
}

/**
 * Universal Composition Engine Phase 13 — activates a pending skill
 * (one registered via repositoryEditingEngine.registerCapabilityFromBundle
 * with healthStatus:"pending"). This is the ONLY function that may flip
 * a skill's healthStatus to "active" — repositoryEditingEngine.cjs's
 * approveCapabilityFromBundle() calls this ONLY after confirming a real,
 * genuinely-approved request in approvalQueue.cjs, so there is no path
 * from "pending" to "active" that skips human review.
 */
function activateSkill(skillId) {
    const store = _read();
    const skill = store.skills.find(s => s.id === skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    if (skill.healthStatus === "active") return { ...skill };
    skill.healthStatus = "active";
    skill.activatedAt = new Date().toISOString();
    _write(store);
    logger.info(`[SkillRegistry] Activated skill ${skillId}`);
    return { ...skill };
}

/**
 * Whether a skill is genuinely composable right now — active status AND
 * its executionHandler genuinely resolves (reuses the same live-registry
 * check as verifyNoOrphans(), applied to one skill). A "pending" skill
 * is never composable, regardless of whether its handler would resolve —
 * this is the exact honesty gate Phase 13 requires.
 */
function isComposableNow(skillId) {
    const skill = getSkill(skillId);
    if (!skill) return { composable: false, reason: "unknown_skill" };
    if (skill.healthStatus !== "active") return { composable: false, reason: `healthStatus:${skill.healthStatus}` };
    const { orphans } = verifyNoOrphans();
    if (orphans.includes(skillId)) return { composable: false, reason: "orphaned_handler" };
    return { composable: true, reason: null };
}

module.exports = {
    listSkills,
    getSkill,
    findByCapability,
    registerSkill,
    verifyNoOrphans,
    activateSkill,
    isComposableNow,
};
