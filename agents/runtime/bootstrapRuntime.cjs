"use strict";
/**
 * bootstrapRuntime — registers all production agents into the runtime registry.
 * Loaded once at server startup (backend/server.js). Fully additive — does not
 * modify any existing agent, executor, or autonomousLoop behavior.
 *
 * Each agent is wrapped in try/catch so a single bad require never blocks
 * the others from registering. Unregistered task types fall through to the
 * existing executor.cjs via executionEngine's legacy fallback.
 */

const path         = require("path");
const orchestrator = require("./runtimeOrchestrator.cjs");
const logger       = require("../../backend/utils/logger");

// ── 1. Desktop Agent ──────────────────────────────────────────────
// [Phase O] Removed from production bootstrap. Desktop automation is now an
// optional plugin at plugins/local-desktop/ — disabled by default on VPS.
// To re-enable, create a plugin loader that registers via orchestrator.registerAgent().

// ── 2. Browser Agent ──────────────────────────────────────────────
// Capabilities: web_search, open_url, named URL shortcuts
// browserAgent.run() already accepts the full task object — no adapter needed
try {
    const browser = require("../browserAgent.cjs");

    orchestrator.registerAgent({
        id:           "browser",
        capabilities: ["browser"],
        maxConcurrent: 3,
        handler: async (task) => browser.run(task),
    });
    logger.info("[Bootstrap] browser agent registered");
} catch (err) {
    logger.warn("[Bootstrap] browser agent skipped:", err.message);
}

// ── 3. Terminal Agent ─────────────────────────────────────────────
// Capabilities: terminal
// terminalAgent.run(command) takes a string — adapter extracts payload.command
try {
    const terminal = require("../terminalAgent.cjs");

    orchestrator.registerAgent({
        id:           "terminal",
        capabilities: ["terminal"],
        maxConcurrent: 2,
        handler: async (task) => {
            const command = task.payload?.command || task.command || "";
            return terminal.run(command);
        },
    });
    logger.info("[Bootstrap] terminal agent registered");
} catch (err) {
    logger.warn("[Bootstrap] terminal agent skipped:", err.message);
}

// ── 4. Automation Agent ───────────────────────────────────────────
// Capabilities: automation
// Handles start_lead_flow, start_content_flow, start_sales_funnel via n8n webhooks
try {
    const automation = require("../automationAgent.cjs");

    orchestrator.registerAgent({
        id:           "automation",
        capabilities: ["automation"],
        maxConcurrent: 2,
        handler: async (task) => automation.execute(task),
    });
    logger.info("[Bootstrap] automation agent registered");
} catch (err) {
    logger.warn("[Bootstrap] automation agent skipped:", err.message);
}

// ── 5. Dev Agent ──────────────────────────────────────────────────
// Capabilities: dev (code generation, file writing)
// devAgent.run() accepts the full task object — no adapter needed
try {
    const dev = require("../devAgent.cjs");

    orchestrator.registerAgent({
        id:           "dev",
        capabilities: ["dev"],
        maxConcurrent: 2,
        handler: async (task) => dev.run(task),
    });
    logger.info("[Bootstrap] dev agent registered");
} catch (err) {
    logger.warn("[Bootstrap] dev agent skipped:", err.message);
}

// ── 6. Filesystem Adapter ─────────────────────────────────────────
// Must be configured here — adapter blocks all I/O until configure() is called.
// Read-only by default; write access is not granted to runtime-dispatched tasks.
let _fsAdapter = null;
try {
    const fsAdapter = require("./adapters/filesystemExecutionAdapter.cjs");
    const projectRoot = path.resolve(__dirname, "../..");
    const result = fsAdapter.configure(projectRoot, { writeAllowed: true });
    if (result.configured) {
        _fsAdapter = fsAdapter;
        logger.info(`[Bootstrap] filesystem adapter configured — sandbox: ${projectRoot} (read+write, protected dirs enforced)`);
    } else {
        logger.warn("[Bootstrap] filesystem adapter configure() rejected:", result.reason);
    }
} catch (err) {
    logger.warn("[Bootstrap] filesystem adapter skipped:", err.message);
}

// ── 7. Filesystem Agent ────────────────────────────────────────────
if (_fsAdapter) {
    try {
        orchestrator.registerAgent({
            id: "filesystem",
            capabilities: ["filesystem"],
            maxConcurrent: 2,
            handler: async (task) => {
                const payload = task.payload || {};
                const cmd = payload.command;
                if (cmd === "read") {
                    return _fsAdapter.readFile(payload.filePath, payload.options || {});
                }
                if (cmd === "write") {
                    return _fsAdapter.writeFile(payload.filePath, payload.content || "", { ...(payload.options || {}), createDirs: true });
                }
                if (cmd === "list") {
                    return _fsAdapter.readDir(payload.filePath, payload.options || {});
                }
                if (cmd === "stat") {
                    return _fsAdapter.statFile(payload.filePath);
                }
                if (cmd === "exists") {
                    return _fsAdapter.fileExists(payload.filePath);
                }
                return { success: false, error: `unsupported_filesystem_task: ${cmd}` };
            },
        });
        logger.info("[Bootstrap] filesystem agent registered");
    } catch (err) {
        logger.warn("[Bootstrap] filesystem agent skipped:", err.message);
    }
}

// ── 8. Local Desktop Agent (optional) ───────────────────────────────
const enableLocalDesktop = process.env.ENABLE_LOCAL_DESKTOP === "1" || process.env.ENABLE_RUNTIME_DESKTOP === "1";
if (enableLocalDesktop) {
    try {
        const DesktopAgent = require("../../plugins/local-desktop/desktopAgent.cjs");
        const desktop = new DesktopAgent();
        if (desktop.available) {
            orchestrator.registerAgent({
                id: "desktop",
                capabilities: ["desktop"],
                maxConcurrent: 1,
                handler: async (task) => {
                    const payload = task.payload || {};
                    switch (task.type) {
                        case "open_app":
                            return desktop.openApp(payload.appName || payload.app || "");
                        case "type_text":
                            return desktop.typeText(payload.text || "");
                        case "press_key":
                            return desktop.pressKey(payload.key || "enter");
                        case "key_combo":
                            return desktop.pressKeyCombo(payload.modifiers || [], payload.key || "c");
                        case "click":
                            return desktop.click(payload.button || "left");
                        case "double_click":
                            return desktop.doubleClick(payload.button || "left");
                        case "move_mouse":
                            return desktop.moveMouse(payload.x || 0, payload.y || 0);
                        default:
                            return { success: false, error: `unsupported_desktop_task: ${task.type}` };
                    }
                },
            });
            logger.info("[Bootstrap] local-desktop agent registered");
        } else {
            logger.warn("[Bootstrap] local-desktop plugin loaded but unavailable");
        }
    } catch (err) {
        logger.warn("[Bootstrap] local-desktop plugin skipped:", err.message);
    }
}

// ── CRM Agent — handles get_leads / note / reminder via crmService ───
try {
    const crm = require("../../backend/services/crmService");

    orchestrator.registerAgent({
        id:           "crm",
        capabilities: ["crm"],
        maxConcurrent: 5,
        handler: async (task) => {
            const type = task.type || "";
            if (type === "get_leads") {
                const leads = crm.getLeads();
                return { type: "leads", result: leads, success: true };
            }
            if (type === "note" || type === "reminder") {
                const p = task.payload || {};
                if (p.phone) crm.updateLead(p.phone, { note: p.note || p.text || task.input, updatedAt: new Date().toISOString() });
                return { type, result: "saved", success: true };
            }
            return { type, result: null, success: false, error: `unsupported_crm_task: ${type}` };
        },
    });
    logger.info("[Bootstrap] CRM agent registered");
} catch (err) {
    logger.error("[Bootstrap] CRM agent FAILED to register:", err.message, err.stack);
}

// ── AI Agent — handles "ai" task type via aiService.callAI ───────────
try {
    const { callAI } = require("../../backend/services/aiService.js");

    orchestrator.registerAgent({
        id:           "ai",
        capabilities: ["ai", "intelligence"],
        maxConcurrent: 5,
        handler: async (task) => {
            const query = task.payload?.query || task.input || task.label || "";
            const reply = await callAI(query);
            return { type: "ai", result: reply, message: reply, success: !!reply && !reply.startsWith("AI backend unavailable") };
        },
    });
    logger.info("[Bootstrap] AI agent registered");
} catch (err) {
    logger.warn("[Bootstrap] AI agent skipped:", err.message);
}

// ── Recovered agents (100-COMPANY reality audit Phase 4 remediation) ──
// The following agents/*.cjs files under agents/business, agents/content,
// and agents/internet had real, working implementations but were never
// reachable from the running server (agents/business/index.cjs and
// agents/content/index.cjs — the only thing that ever required them — both
// throw at require-time due to missing agents/crm.cjs, agents/paymentAgent.cjs,
// and agents/core/groqClient.cjs dependencies elsewhere in those same
// directories; see 100-COMPANY-GAP-LIST.md P1 #8). Each file below was
// individually verified to require() cleanly and already exposes a
// run(task) handler matching this registry's contract — wired directly,
// not through the broken barrels, and not through the separate
// agents/multi/agentManager.cjs parallel registry (which duplicates this
// one and was left alone — see REALITY-AUDIT Part 3).

// ── Business: analytics / revenue / subscription (self-contained, no
// broken cross-file requires) ─────────────────────────────────────────
try {
    const analytics = require("../business/analyticsAgent.cjs");
    orchestrator.registerAgent({
        id: "business_analytics", capabilities: ["analytics"], maxConcurrent: 3,
        handler: async (task) => analytics.run(task),
    });
    logger.info("[Bootstrap] business_analytics agent registered");
} catch (err) { logger.warn("[Bootstrap] business_analytics agent skipped:", err.message); }

try {
    const revenue = require("../business/revenueAgent.cjs");
    orchestrator.registerAgent({
        id: "business_revenue", capabilities: ["revenue"], maxConcurrent: 3,
        handler: async (task) => revenue.run(task),
    });
    logger.info("[Bootstrap] business_revenue agent registered");
} catch (err) { logger.warn("[Bootstrap] business_revenue agent skipped:", err.message); }

try {
    const subscription = require("../business/subscriptionAgent.cjs");
    orchestrator.registerAgent({
        id: "business_subscription", capabilities: ["subscription"], maxConcurrent: 3,
        handler: async (task) => subscription.run(task),
    });
    logger.info("[Bootstrap] business_subscription agent registered");
} catch (err) { logger.warn("[Bootstrap] business_subscription agent skipped:", err.message); }

// ── Content: scheduler / voice cloning (self-contained) ────────────────
try {
    const scheduler = require("../content/contentScheduler.cjs");
    orchestrator.registerAgent({
        id: "content_scheduler", capabilities: ["content_scheduling"], maxConcurrent: 3,
        handler: async (task) => scheduler.run(task),
    });
    logger.info("[Bootstrap] content_scheduler agent registered");
} catch (err) { logger.warn("[Bootstrap] content_scheduler agent skipped:", err.message); }

try {
    const voice = require("../content/voiceCloningAgent.cjs");
    orchestrator.registerAgent({
        id: "content_voice", capabilities: ["audio", "voice"], maxConcurrent: 2,
        handler: async (task) => voice.run(task),
    });
    logger.info("[Bootstrap] content_voice agent registered");
} catch (err) { logger.warn("[Bootstrap] content_voice agent skipped:", err.message); }

// ── Repaired agents (100-COMPANY P1 mission Phase 1) ────────────────────
// These 15 files previously failed to even require() (missing
// agents/crm.cjs, agents/paymentAgent.cjs, agents/core/groqClient.cjs —
// none existed anywhere in the repo). Fixed by creating agents/crm.cjs
// (re-export of the real backend/services/crmService.js), agents/
// paymentAgent.cjs (thin class adapter over the real backend/services/
// paymentService.js), and agents/core/groqClient.cjs (thin chat()/
// parseJson() adapter over the real, multi-provider backend/services/
// aiService.js) — no new AI provider, CRM store, or payment processor was
// created; each is a compatibility shim over already-existing, already-
// wired services. See 100-COMPANY-GAP-LIST.md P1 #8 (remaining half).
try {
    const crmAgent = require("../business/crmAgent.cjs");
    orchestrator.registerAgent({
        id: "business_crm_agent", capabilities: ["crm_extended"], maxConcurrent: 5,
        handler: async (task) => crmAgent.run(task),
    });
    logger.info("[Bootstrap] business_crm_agent registered");
} catch (err) { logger.warn("[Bootstrap] business_crm_agent skipped:", err.message); }

try {
    const marketingAgent = require("../business/marketingAgent.cjs");
    orchestrator.registerAgent({
        id: "business_marketing", capabilities: ["marketing_campaign"], maxConcurrent: 2,
        handler: async (task) => marketingAgent.run(task),
    });
    logger.info("[Bootstrap] business_marketing agent registered");
} catch (err) { logger.warn("[Bootstrap] business_marketing agent skipped:", err.message); }

try {
    const paymentAgent = require("../business/paymentAgent.cjs");
    orchestrator.registerAgent({
        id: "business_payment", capabilities: ["payment_link"], maxConcurrent: 3,
        handler: async (task) => paymentAgent.run(task),
    });
    logger.info("[Bootstrap] business_payment agent registered");
} catch (err) { logger.warn("[Bootstrap] business_payment agent skipped:", err.message); }

try {
    const growthAgent = require("../business/growthAgent.cjs");
    orchestrator.registerAgent({
        id: "business_growth", capabilities: ["growth_suggestions"], maxConcurrent: 2,
        handler: async (task) => growthAgent.run(task),
    });
    logger.info("[Bootstrap] business_growth agent registered");
} catch (err) { logger.warn("[Bootstrap] business_growth agent skipped:", err.message); }

try {
    const seoAgent = require("../business/seoAgent.cjs");
    orchestrator.registerAgent({
        id: "business_seo", capabilities: ["seo"], maxConcurrent: 3,
        handler: async (task) => seoAgent.run(task),
    });
    logger.info("[Bootstrap] business_seo agent registered");
} catch (err) { logger.warn("[Bootstrap] business_seo agent skipped:", err.message); }

try {
    const contentAgent = require("../business/contentAgent.cjs");
    orchestrator.registerAgent({
        id: "business_content", capabilities: ["content_writer"], maxConcurrent: 3,
        handler: async (task) => contentAgent.run(task),
    });
    logger.info("[Bootstrap] business_content agent registered");
} catch (err) { logger.warn("[Bootstrap] business_content agent skipped:", err.message); }

try {
    const supportAgent = require("../business/supportAgent.cjs");
    orchestrator.registerAgent({
        id: "business_support", capabilities: ["customer_support"], maxConcurrent: 5,
        handler: async (task) => supportAgent.run(task),
    });
    logger.info("[Bootstrap] business_support agent registered");
} catch (err) { logger.warn("[Bootstrap] business_support agent skipped:", err.message); }

const REPAIRED_CONTENT_AGENTS = [
    { file: "captionGeneratorAgent.cjs", id: "content_caption",   capabilities: ["caption_generation"] },
    { file: "hashtagGeneratorAgent.cjs", id: "content_hashtag",   capabilities: ["hashtag_generation"] },
    { file: "imageGeneratorAgent.cjs",   id: "content_image",     capabilities: ["image_brief"] },
    { file: "podcastGeneratorAgent.cjs", id: "content_podcast",   capabilities: ["podcast_script"] },
    { file: "reelGeneratorAgent.cjs",    id: "content_reel",      capabilities: ["reel_script"] },
    { file: "scriptWriterAgent.cjs",     id: "content_script",    capabilities: ["video_script"] },
    { file: "thumbnailAgent.cjs",        id: "content_thumbnail", capabilities: ["thumbnail_brief"] },
    { file: "videoGeneratorAgent.cjs",   id: "content_video",     capabilities: ["video_brief"] },
];
for (const { file, id, capabilities } of REPAIRED_CONTENT_AGENTS) {
    try {
        const agent = require(`../content/${file}`);
        orchestrator.registerAgent({ id, capabilities, maxConcurrent: 3, handler: async (task) => agent.run(task) });
        logger.info(`[Bootstrap] ${id} agent registered`);
    } catch (err) {
        logger.warn(`[Bootstrap] ${id} agent skipped:`, err.message);
    }
}

// ── Internet: real public-API research/intelligence agents ─────────────
// All ten expose run(task) already; capabilities named after the audited
// MISSING/UNWIRED roles they cover (SEO/Social Media/Research/Knowledge/
// Quant/Market Intelligence — REALITY-AUDIT Part 3).
// Each agent's first capability is a unique tag so taskRouter.cjs's
// TASK_TYPE_MAP can deterministically address one specific agent —
// findForCapability() has no tie-breaker beyond load, so agents sharing a
// tag (e.g. multiple "research" agents) would be indistinguishable from a
// task-type mapping's perspective. The broader shared tags (research,
// market_intelligence, geospatial) remain for dashboard/discovery grouping.
const INTERNET_AGENTS = [
    { file: "webScraperAgent.cjs",         id: "internet_web_scraper",       capabilities: ["web_scraping", "research"] },
    { file: "browserAutomationAgent.cjs",  id: "internet_browser_automation", capabilities: ["browser_automation", "research"] },
    { file: "apiFetcherAgent.cjs",         id: "internet_api_fetcher",       capabilities: ["api_fetch", "integration"] },
    { file: "newsAggregatorAgent.cjs",     id: "internet_news",             capabilities: ["news", "research"] },
    { file: "socialMediaAgent.cjs",        id: "internet_social_media",     capabilities: ["social_media", "research"] },
    { file: "trendAnalyzerAgent.cjs",      id: "internet_trend_analyzer",   capabilities: ["trend_analysis", "market_intelligence", "research"] },
    { file: "competitorTrackerAgent.cjs",  id: "internet_competitor_tracker", capabilities: ["competitor_tracking", "market_intelligence", "research"] },
    { file: "marketIntelligenceAgent.cjs", id: "internet_market_intelligence", capabilities: ["market_intelligence_report", "market_intelligence", "quant"] },
    { file: "locationAgent.cjs",           id: "internet_location",         capabilities: ["location_lookup", "geospatial"] },
    { file: "weatherAgent.cjs",            id: "internet_weather",          capabilities: ["weather", "geospatial"] },
];
for (const { file, id, capabilities } of INTERNET_AGENTS) {
    try {
        const agent = require(`../internet/${file}`);
        orchestrator.registerAgent({ id, capabilities, maxConcurrent: 3, handler: async (task) => agent.run(task) });
        logger.info(`[Bootstrap] ${id} agent registered`);
    } catch (err) {
        logger.warn(`[Bootstrap] ${id} agent skipped:`, err.message);
    }
}

// ── Content: image processor — real sharp-backed pixel processing
// (upscale/edit), already wired directly into backend/routes/
// creativeStudio.js's /creative/image/upscale and /creative/image/edit
// endpoints. That route-level wiring is untouched by this registration —
// this only makes the same real capability discoverable/callable through
// agentRegistry.findForCapability("image_processing") for any caller
// that goes through the runtime dispatch path instead of the REST route
// directly, closing the one gap found in the Agent Civilization
// Discovery pass (imageProcessorAgent.cjs was the only content/*.cjs
// file not present in either registry). No run(task) contract in the
// source file (exports upscale/edit directly) — adapted the same way as
// system_health above.
try {
    const imageProcessor = require("../content/imageProcessorAgent.cjs");
    orchestrator.registerAgent({
        id: "content_image_processor",
        capabilities: ["image_processing"],
        maxConcurrent: 2,
        handler: async (task) => {
            const p = task.payload || {};
            const op = task.type === "image_edit" ? "edit" : "upscale";
            return op === "edit" ? imageProcessor.edit(p) : imageProcessor.upscale(p);
        },
    });
    logger.info("[Bootstrap] content_image_processor agent registered");
} catch (err) {
    logger.warn("[Bootstrap] content_image_processor agent skipped:", err.message);
}

// ── Business: affiliate/partner center — real, already live at
// /revenue/affiliates/* (backend/routes/revenueOS.js) with genuine
// persisted state (data/revenue-os.json's affiliates/commissions).
// Agent Civilization Discovery found executor.cjs's "affiliate" and
// "commissionOptimizer" handler keys routed to agentExecutorMod.run(
// "affiliateAgent"/"commissionOptimizer", task) — names never registered
// anywhere, silently unreachable via the runtime dispatch path even
// though the underlying capability is real and already shipped via REST.
// This registration closes that gap without touching the route (task-
// type adapter over the same exported functions the route already
// calls), so a caller going through agentRegistry.findForCapability()
// reaches the identical state as a caller hitting the REST endpoint.
try {
    const revenueOS = require("../../backend/services/revenueOS.cjs");
    orchestrator.registerAgent({
        id: "business_affiliate",
        capabilities: ["affiliate_management"],
        maxConcurrent: 3,
        // Task-type strings match agents/automation/toolSelector.cjs's
        // TOOL_MAP entries that route to the "affiliate" tool
        // (add_affiliate, record_referral, affiliate_payout,
        // list_affiliates, affiliate_stats) — the actual task.type values
        // a real caller sends, confirmed by reading toolSelector.cjs.
        handler: async (task) => {
            const p = task.payload || {};
            switch (task.type) {
                case "add_affiliate":
                    return { success: true, result: revenueOS.createAffiliate(p) };
                case "record_referral":
                    return { success: true, result: revenueOS.recordAffiliateConversion(p.affiliateId, p) };
                case "affiliate_payout":
                    return { success: true, result: revenueOS.processAffiliatePayout(p.affiliateId) };
                case "affiliate_stats":
                    return { success: true, result: revenueOS.getAffiliateAnalytics() };
                case "list_affiliates":
                default:
                    return { success: true, result: revenueOS.listAffiliates(p.tier, p.status) };
            }
        },
    });
    logger.info("[Bootstrap] business_affiliate agent registered");
} catch (err) {
    logger.warn("[Bootstrap] business_affiliate agent skipped:", err.message);
}

// ── Business: pricing intelligence — real bundle/annual pricing
// recommendation engine (POST-Ω Sprint P15's pricingIntelligenceEngine.cjs),
// already reads real revenue/health context. executor.cjs's
// "pricingOptimizer" key routed to agentExecutorMod.run("pricingOptimizer",
// task) — never registered anywhere — closing that gap the same way as
// business_affiliate above.
try {
    const pricingEngine = require("../../backend/services/pricingIntelligenceEngine.cjs");
    orchestrator.registerAgent({
        id: "business_pricing",
        capabilities: ["pricing_optimization"],
        maxConcurrent: 3,
        handler: async (task) => {
            const p = task.payload || {};
            if (task.type === "pricing_recommendations") {
                return { success: true, result: pricingEngine.listRecommendations(p) };
            }
            return { success: true, result: pricingEngine.recommend(p) };
        },
    });
    logger.info("[Bootstrap] business_pricing agent registered");
} catch (err) {
    logger.warn("[Bootstrap] business_pricing agent skipped:", err.message);
}

// ── Business: email automation — real transactional/marketing email
// service (backend/services/emailService.cjs), already used elsewhere in
// the codebase for welcome/OTP/password-reset emails. executor.cjs's
// "emailAutomation" key routed to agentExecutorMod.run("emailAutomationPro",
// task) — never registered anywhere.
try {
    const emailService = require("../../backend/services/emailService.cjs");
    orchestrator.registerAgent({
        id: "business_email_automation",
        capabilities: ["email_automation"],
        maxConcurrent: 5,
        // sendMarketing(to, subject, html) takes positional args and
        // sendEmail() (which it wraps) returns {ok, ...}, not {sent, ...}
        // — verified by reading emailService.cjs directly rather than
        // assumed from its name.
        handler: async (task) => {
            const p = task.payload || {};
            if (!p.to || !p.subject) {
                return { success: false, error: "payload.to and payload.subject are required" };
            }
            const result = await emailService.sendMarketing(p.to, p.subject, p.html || p.body || "");
            return { success: !!result?.ok, result };
        },
    });
    logger.info("[Bootstrap] business_email_automation agent registered");
} catch (err) {
    logger.warn("[Bootstrap] business_email_automation agent skipped:", err.message);
}

// ── System health — real os-module metrics, no run(task) contract in the
// source file, so a small task-type adapter is used (same pattern as the
// filesystem agent above) ───────────────────────────────────────────────
try {
    const systemHealth = require("../system/systemHealth.cjs");
    orchestrator.registerAgent({
        id: "system_health", capabilities: ["system_health", "monitoring"], maxConcurrent: 3,
        handler: async (task) => {
            const type = task.type || "health";
            if (type === "memory")     return { success: true, type: "system_health", data: systemHealth.memory() };
            if (type === "is_healthy") return { success: true, type: "system_health", data: systemHealth.isHealthy() };
            return { success: true, type: "system_health", data: systemHealth.health() };
        },
    });
    logger.info("[Bootstrap] system_health agent registered");
} catch (err) { logger.warn("[Bootstrap] system_health agent skipped:", err.message); }

const _registry = require("./agentRegistry.cjs");
const _registered = _registry.listAll().map(a => `${a.id}[${a.capabilities.join(",")}]`);
logger.info("[Bootstrap] Runtime agent registration complete — " + _registered.join(" | "));
