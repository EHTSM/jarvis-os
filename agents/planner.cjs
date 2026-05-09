"use strict";
const { triggerAgent } = require("./trigger.cjs");
const parser           = require("../backend/utils/parser");

const TASK_SEPARATORS = /(?:\s+and\s+|,\s*|;\s*|\s+then\s+|\s*\+\s*)/;

// ── Shape adapter ─────────────────────────────────────────────────
// Translates parser.parseCommand() flat output → planner task shape
// so executor payload reads (task.payload.app / .text / .key / etc.) work.
function _parserToTask(parsed, segment) {
    switch (parsed.type) {

        case "web_search":
            return { type: "web_search", label: parsed.label, payload: { query: parsed.query } };

        case "open_url":
            return { type: "open_url",   label: parsed.label, payload: { url: parsed.url } };

        case "open_app":
            return { type: "open_app",   label: parsed.label, payload: { app: parsed.app, appName: parsed.appName } };

        case "desktop":
            if (parsed.action === "type")
                return { type: "type_text", label: parsed.label, payload: { text: parsed.text } };
            if (parsed.action === "press_key")
                return { type: "press_key", label: parsed.label, payload: { key: parsed.key } };
            if (parsed.action === "key_combo")
                return { type: "key_combo", label: parsed.label, payload: { modifiers: parsed.modifiers || [], key: parsed.key || "c" } };
            break;

        case "time":
            return { type: "time",      label: parsed.label, payload: {} };
        case "date":
            return { type: "date",      label: parsed.label, payload: {} };
        case "get_leads":
            return { type: "get_leads", label: parsed.label, payload: {} };
    }

    // All other parser intents (greeting, status, payment, error, intelligence) → AI
    return { type: "ai", label: parsed.label || segment, payload: { query: segment } };
}

function buildTask(segment) {
    const task = segment.toLowerCase().trim();

    // ── 1. Trigger commands (time-based: remind me in/at, daily at) ─
    const triggerResult = triggerAgent(segment);
    if (triggerResult) return triggerResult;

    // ── 2. Autonomous queue scheduling ──────────────────────────────
    // "every N minutes/hours/seconds run X" → recurring cron task
    const everyMatch = task.match(/^every\s+(\d+)\s+(minute|minutes|min|hour|hours|hr|second|seconds|sec)\s+(.+)$/i);
    if (everyMatch) {
        const n    = parseInt(everyMatch[1], 10);
        const unit = everyMatch[2].toLowerCase();
        const cmd  = everyMatch[3].trim();
        let cronPat;
        if (unit.startsWith("sec"))      cronPat = `*/${n} * * * * *`;
        else if (unit.startsWith("min")) cronPat = `*/${n} * * * *`;
        else                             cronPat = `0 */${n} * * *`;
        return { type: "queue_task", label: "Queue Recurring Task", payload: { input: cmd, recurringCron: cronPat, type: "auto" } };
    }

    // "tomorrow run X" / "in N minutes run X"
    const laterMatch = task.match(/^(?:tomorrow|in\s+(\d+)\s+(minute|minutes|hour|hours|min|hr|day|days))\s+(.+)$/i);
    if (laterMatch) {
        let scheduledFor;
        if (task.startsWith("tomorrow")) {
            const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
            scheduledFor = d.toISOString();
        } else {
            const n    = parseInt(laterMatch[1], 10);
            const unit = laterMatch[2].toLowerCase();
            const ms   = unit.startsWith("day") ? n * 86400000 :
                         unit.startsWith("hour") || unit === "hr" ? n * 3600000 : n * 60000;
            scheduledFor = new Date(Date.now() + ms).toISOString();
        }
        const cmd = (laterMatch[3] || laterMatch[laterMatch.length - 1]).trim();
        return { type: "queue_task", label: "Queue Scheduled Task", payload: { input: cmd, scheduledFor, type: "auto" } };
    }

    // "schedule/queue/auto X" → immediate queue
    if (/^(schedule|queue|auto)\s+/i.test(task)) {
        const cmd = task.replace(/^(schedule|queue|auto)\s+/i, "").trim();
        return { type: "queue_task", label: "Queue Task", payload: { input: cmd, scheduledFor: new Date().toISOString(), type: "auto" } };
    }

    // ── 3. Terminal execution ────────────────────────────────────────
    if (/^(run|execute)\s+/i.test(task)) {
        const command = task.replace(/^(run|execute)\s+/i, "").trim();
        return { type: "terminal", label: "Terminal", payload: { command } };
    }
    if (/^(create|make)\s+folder\s+/i.test(task)) {
        const folder = task.replace(/^(create|make)\s+folder\s+/i, "").trim();
        return { type: "terminal", label: "Terminal", payload: { command: `mkdir ${folder}` } };
    }
    // Bare shell commands (pwd, ls, git status, npm install, etc.)
    if (/^(pwd|ls|git\s+(status|log|diff|branch)|npm\s+(install|run|list|ls|audit|test)|node\s+(-v|--version)|whoami|hostname|date|uname)(\s|$)/i.test(task)) {
        return { type: "terminal", label: "Terminal", payload: { command: task } };
    }

    // ── 4. Dev intent (code artifact generation) ─────────────────────
    const DEV_VERBS    = /^(create|build|generate|write|make|code)\s/i;
    const DEV_SUBJECTS = /\b(api|server|express|app|function|script|component|module|endpoint|route|controller|service|class|utility|helper|tool)\b/i;
    if (DEV_VERBS.test(task) && DEV_SUBJECTS.test(task)) {
        return { type: "dev", label: "Dev Task", payload: { description: segment } };
    }

    // ── 5. Research ──────────────────────────────────────────────────
    if (task.startsWith("research ") || task.includes(" research ") || /^research\b/i.test(task)) {
        const query = task.replace(/^research\s+/i, "").replace(/\bresearch\s+/i, "").trim();
        return { type: "research", label: "Research", payload: { query: query || segment } };
    }

    // ── 6. Maps — open Google Maps in browser (no mapsAgent.cjs exists) ─
    if (task.includes("maps")) {
        const query = task.replace(/\bmaps\b/i, "").replace(/\b(open|show|find|search)\b/i, "").trim();
        const url   = `https://maps.google.com/search?q=${encodeURIComponent(query || segment)}`;
        return { type: "open_url", label: `Maps: ${query || segment}`, payload: { url } };
    }

    // ── 7. Memory management ─────────────────────────────────────────
    if (task.includes("clear memory") || task.includes("reset memory")) {
        return { type: "clear_memory", label: "Clear Memory", payload: {} };
    }

    // ── 8. Voice output ──────────────────────────────────────────────
    if (task.startsWith("speak ") || task.startsWith("say ")) {
        const text = task.replace(/^(speak|say)\s+/, "").trim();
        return { type: "speak", label: "Speak", payload: { text: text || segment } };
    }

    // ── 9. Agent factory ─────────────────────────────────────────────
    if (task.includes("create agent") || task.includes("build agent") || task.includes("new agent") ||
        (task.startsWith("create ") && task.includes("agent"))) {
        const specification = task
            .replace(/^(create|build)\s+(an?)?\s*agent\s+(that|to|for)?\s*/i, "")
            .replace(/^new\s+agent\s+/i, "")
            .trim();
        return { type: "create_agent", label: "Create Agent", payload: { specification: specification || segment } };
    }
    if (task.includes("list agents") || task.includes("show agents") || task.includes("what agents")) {
        return { type: "list_agents", label: "List Agents", payload: {} };
    }
    if (task.startsWith("run agent ") || task.startsWith("execute agent ")) {
        const agentName = task.replace(/^(run|execute)\s+agent\s+/i, "").trim();
        return { type: "execute_agent", label: "Execute Agent", payload: { agent: agentName, input: segment } };
    }

    // ── 10. Canonical parser — all remaining single-command intents ──
    // Covers: URL shortcuts, web search, app launch, desktop typing/keys,
    //         time, date, greetings, CRM, payment, and AI fallback.
    return _parserToTask(parser.parseCommand(segment), segment);
}

function plannerAgent(input, context = null) {
    if (context?.frequent_commands?.length > 0) {
        const lowerInput = input.toLowerCase();
        for (const cmd of context.frequent_commands) {
            if (lowerInput === cmd.name.toLowerCase()) {
                console.log(`⚡ Fast-track: Recognized frequent command "${cmd.name}" (${cmd.count}x)`);
            }
        }
    }

    const segments = input
        .split(TASK_SEPARATORS)
        .map((s) => s.trim())
        .filter(Boolean);

    const tasks = segments.map((s) => buildTask(s));
    return Array.isArray(tasks) ? tasks : [tasks];
}

module.exports = { plannerAgent };
