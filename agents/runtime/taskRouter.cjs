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
};

/** Resolve a task type to a capability string. Falls back to "ai". */
function resolveCapability(taskType) {
    return TASK_TYPE_MAP[taskType] || "ai";
}

module.exports = { resolveCapability, TASK_TYPE_MAP };
