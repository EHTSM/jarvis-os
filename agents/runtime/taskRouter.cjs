"use strict";
/**
 * taskRouter — maps task.type strings to agent capability strings.
 * The runtime executionEngine uses these capability strings to look up
 * an available agent via agentRegistry.findForCapability().
 *
 * Capabilities must match what agents register in agentRegistry.
 */

const TASK_TYPE_MAP = {
    // ── Browser ────────────────────────────────────────────────────
    web_search:         "browser",
    open_url:           "browser",
    open_google:        "browser",
    open_youtube:       "browser",
    open_chatgpt:       "browser",
    open_github:        "browser",
    open_twitter:       "browser",
    open_linkedin:      "browser",
    open_instagram:     "browser",
    open_whatsapp:      "browser",
    open_stackoverflow: "browser",

    // ── Desktop / OS ───────────────────────────────────────────────
    open_app:       "desktop",
    type_text:      "desktop",
    press_key:      "desktop",
    key_combo:      "desktop",
    speak:          "voice",

    // ── Information ────────────────────────────────────────────────
    time:           "system",
    date:           "system",
    status:         "system",
    clear_memory:   "system",

    // ── Research / AI ──────────────────────────────────────────────
    research:       "research",
    ai:             "ai",

    // ── Dev / Terminal ─────────────────────────────────────────────
    dev:            "dev",
    terminal:       "terminal",
    read_file:      "filesystem",
    create_file:    "filesystem",

    // ── Agents ─────────────────────────────────────────────────────
    create_agent:   "agent_factory",
    list_agents:    "agent_factory",
    execute_agent:  "agent_factory",

    // ── Queue / Scheduling ─────────────────────────────────────────
    queue_task:     "task_queue",

    // ── CRM / Sales ────────────────────────────────────────────────
    get_leads:      "crm",
    note:           "crm",
    reminder:       "crm",
    timer:          "system",

    // ── Automation ─────────────────────────────────────────────────
    automation:     "automation",
    workflow:       "automation",

    // ── Social / Content ───────────────────────────────────────────
    social:         "social",
    content:        "content",
    media:          "media",

    // ── Voice ──────────────────────────────────────────────────────
    voice:          "voice",

    // ── Recovered agents (100-COMPANY reality audit Phase 4) ────────
    // Each maps to the unique primary capability tag registered in
    // bootstrapRuntime.cjs so findForCapability() reaches one specific
    // agent, not an arbitrary one among agents sharing a broader tag.
    // Task-type strings match each agent's own run(task) switch exactly
    // (verified against source — several of these agents don't switch on
    // task.type at all and act on payload/input regardless of type).
    get_analytics:        "analytics",
    track_event:          "analytics",
    show_revenue:         "revenue",
    revenue_per_user:     "revenue",
    subscribe:            "subscription",
    check_subscription:   "subscription",
    schedule_post:        "content_scheduling",
    list_scheduled:       "content_scheduling",
    list_voices:          "audio",
    web_scrape:           "web_scraping",
    browser_screenshot:   "browser_automation",
    api_fetch:            "api_fetch",
    news_search:          "news",
    social_search:        "social_media",
    trend_analysis:       "trend_analysis",
    competitor_track:     "competitor_tracking",
    market_report:        "market_intelligence_report",
    location_lookup:      "location_lookup",
    get_weather:          "weather",
    system_health_check:  "system_health",

    // ── Repaired agents (100-COMPANY P1 mission Phase 1) ────────────
    // crmAgent.cjs's own aliases (add_lead/get_leads/update_lead/etc.)
    // are deliberately NOT mapped here — those exact strings already
    // route to the original, narrower "crm" capability above
    // (bootstrapRuntime.cjs "crm" agent: get_leads/note/reminder only).
    // Using crmAgent.cjs's OWN distinct alias set (crm_add/crm_leads/
    // crm_update/crm_stats) avoids silently shadowing that mapping while
    // still giving real task-type access to the broader crmAgent.cjs
    // surface (status filtering, update validation, stats).
    crm_add:              "crm_extended",
    crm_leads:            "crm_extended",
    crm_update:           "crm_extended",
    crm_stats:            "crm_extended",
    send_campaign:        "marketing_campaign",
    broadcast:            "marketing_campaign",
    create_payment_link:  "payment_link",
    payment_status:       "payment_link",
    growth_suggestions:   "growth_suggestions",
    seo_generate:         "seo",
    seo_keywords:         "seo",
    content_generate:     "content_writer",
    support_help:         "customer_support",
    list_faqs:            "customer_support",
    caption_generate:     "caption_generation",
    hashtag_generate:     "hashtag_generation",
    image_brief:          "image_brief",
    podcast_script:       "podcast_script",
    reel_script:          "reel_script",
    video_script:         "video_script",
    thumbnail_brief:      "thumbnail_brief",
    video_brief:          "video_brief",
};

/** Resolve a task type to a capability string. Falls back to "ai". */
function resolveCapability(taskType) {
    return TASK_TYPE_MAP[taskType] || "ai";
}

module.exports = { resolveCapability, TASK_TYPE_MAP };
