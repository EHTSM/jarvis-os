"use strict";
/**
 * Intent detection + command parsing.
 * Returns a structured command object the controller can act on.
 */

// ── Intent rules (ordered by priority) ────────────────────────────
const INTENT_RULES = [
    { intent: "payment",    patterns: [/\bpay\b/, /\bbuy\b/, /\bpurchase\b/, /\bprice\b/, /payment link/, /razorpay/] },
    // crm before search: "find leads" / "find clients" must not fall into generic search
    { intent: "crm",        patterns: [/\blead[s]?\b/, /\bclient[s]?\b/, /\bcrm\b/, /get leads/, /find leads?/, /find clients?/, /show leads?/] },
    { intent: "search",     patterns: [/\bsearch\b/, /\bfind\b/, /look up/, /\bwhat is\b/, /\bwho is\b/] },
    { intent: "open_app",   patterns: [/open\s+\w/, /launch\s+\w/, /start\s+\w/] },
    { intent: "open_url",   patterns: [/youtube|github|google|stackoverflow|chatgpt|instagram|linkedin|twitter|whatsapp web/] },
    { intent: "desktop",    patterns: [/^type\s+/, /^press\s+(enter|space|tab|esc|escape|key)/, /^copy$/, /^paste$/, /^select all$/, /click/, /move mouse/] },
    { intent: "schedule",   patterns: [/remind\b/, /\btimer\b/, /set alarm/, /schedule\b/, /\bat \d/] },
    { intent: "note",       patterns: [/^note\s+/, /^write\s+/, /save note/, /take note/] },
    { intent: "whatsapp",   patterns: [/send.*whatsapp/, /whatsapp.*send/, /message.*to\s+\d/, /follow.?up/] },
    { intent: "greeting",   patterns: [/^(hi|hello|hey)(\s|$)/i, /how are you/, /what['']?s up/] },
    { intent: "time",       patterns: [/what time/, /current time/, /^time$/] },
    { intent: "date",       patterns: [/what.*date/, /today.*date/, /^date$/, /^today$/] },
    { intent: "status",     patterns: [/how are you/, /are you (ok|fine|good|working)/] },
    { intent: "system",     patterns: [/\bshutdown\b/, /\bsleep mode\b/, /system status/] },
];

// Canonical app name map — single source of truth for ALL pipelines.
// executor.cjs imports this via require("../../backend/utils/parser").APP_MAP
const APP_MAP = {
    chrome:       "Google Chrome",
    firefox:      "Firefox",
    vscode:       "Visual Studio Code",
    "vs code":    "Visual Studio Code",
    email:        "Mail",
    terminal:     "Terminal",
    finder:       "Finder",
    safari:       "Safari",
    calculator:   "Calculator",
    spotify:      "Spotify",
    slack:        "Slack",
    notes:        "Notes",
    mail:         "Mail",
    zoom:         "zoom.us",
    figma:        "Figma",
    cursor:       "Cursor",
    xcode:        "Xcode",
    iterm:        "iTerm2",
    postman:      "Postman",
    discord:      "Discord",
    telegram:     "Telegram",
    notion:       "Notion"
};

const URL_MAP = {
    youtube:        "https://youtube.com",
    github:         "https://github.com",
    google:         "https://google.com",
    stackoverflow:  "https://stackoverflow.com",
    chatgpt:        "https://chatgpt.com",
    instagram:      "https://instagram.com",
    linkedin:       "https://linkedin.com",
    twitter:        "https://twitter.com",
    "x.com":        "https://x.com",
    "whatsapp web": "https://web.whatsapp.com",
    whatsapp:       "https://web.whatsapp.com"
};

/**
 * Detect intent from raw input string.
 * Returns the first matching intent, or "intelligence" as fallback.
 */
function detectIntent(input) {
    if (!input || typeof input !== "string") return "intelligence";
    const lower = input.toLowerCase().trim();

    for (const rule of INTENT_RULES) {
        if (rule.patterns.some(p => p.test(lower))) return rule.intent;
    }
    return "intelligence";
}

/**
 * Parse raw input into a structured command object.
 */
function parseCommand(input) {
    if (!input || typeof input !== "string") {
        return { type: "error", action: "respond", label: "Invalid input", voiceReply: "Please provide a valid command." };
    }

    const raw   = input.trim();
    const lower = raw.toLowerCase();
    const intent = detectIntent(raw);

    // ── Web search — check before URL shortcuts so "search google for X" works ──
    if (intent === "search") {
        const query = lower
            .replace(/^(search|find)\s+(on\s+google|google\s+for|on\s+bing|for|about)?\s*/i, "")
            .replace(/^(search|find)\s+/i, "")
            .trim() || raw;
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        return { type: "web_search", intent, query, url, label: `Searching: ${query}`, action: "web_search", voiceReply: `Searching for ${query}` };
    }

    // ── URL shortcuts (open google, open youtube, etc.) ───────────
    for (const [key, url] of Object.entries(URL_MAP)) {
        if (lower.includes(key)) {
            return { type: "open_url", intent, url, label: `Opening ${key}`, action: "open_browser", voiceReply: `Opening ${key}` };
        }
    }

    // ── Maps shortcut (must be before open_app — "open maps X" fires open_app intent) ──
    if (intent === "open_app" && /\bmaps\b/i.test(lower)) {
        const query = lower
            .replace(/^(open|launch|start|show|find|search)\s+/i, "")
            .replace(/\bmaps?\b/i, "")
            .trim();
        const url = `https://maps.google.com/search?q=${encodeURIComponent(query || "maps")}`;
        return { type: "open_url", intent: "open_url", url, label: `Maps: ${query || ""}`, action: "open_browser", voiceReply: `Opening maps${query ? " for " + query : ""}` };
    }

    // ── App launch ────────────────────────────────────────────────
    if (intent === "open_app") {
        const afterOpen = lower.replace(/^(open|launch|start)\s+/i, "");
        let appKey = Object.keys(APP_MAP).find(k => afterOpen.includes(k));
        let appName = appKey ? APP_MAP[appKey] : afterOpen.trim();
        return { type: "open_app", intent, app: appKey || appName, appName, label: `Opening ${appName}`, action: "launch_app", voiceReply: `Opening ${appName}` };
    }

    // ── Desktop actions ───────────────────────────────────────────
    if (intent === "desktop") {
        // type <text>
        if (lower.startsWith("type ")) {
            const text = raw.slice(5).trim();
            if (!text) return { type: "desktop", intent, action: "respond", label: "Nothing to type" };
            return { type: "desktop", intent, action: "type", text, label: `Typing: "${text.slice(0,40)}"`, action: "type" };
        }
        // press enter / press space / press tab / press esc
        const pressMatch = lower.match(/^press\s+(enter|return|space|tab|esc|escape|key\s+(\S+))/i);
        if (pressMatch) {
            const key = (pressMatch[2] || pressMatch[1]).toLowerCase().replace("return", "enter").replace("escape", "esc");
            return { type: "desktop", intent, action: "press_key", key, label: `Press ${key}` };
        }
        // copy / paste / select all  — macOS: Cmd+C, Cmd+V, Cmd+A
        if (lower === "copy")       return { type: "desktop", intent, action: "key_combo", modifiers: ["command"], key: "c", label: "Copy (Cmd+C)" };
        if (lower === "paste")      return { type: "desktop", intent, action: "key_combo", modifiers: ["command"], key: "v", label: "Paste (Cmd+V)" };
        if (lower === "select all") return { type: "desktop", intent, action: "key_combo", modifiers: ["command"], key: "a", label: "Select All (Cmd+A)" };
    }

    // ── Reminder ──────────────────────────────────────────────────
    if (intent === "schedule") {
        const match    = lower.match(/(\d+)\s*(minute|min|second|sec|hour)/i);
        const duration = match ? match[1] : null;
        const unit     = match ? match[2] : null;
        if (duration) return { type: "timer", intent, duration, unit, label: `${duration} ${unit} timer`, action: "start_timer", voiceReply: `Setting ${duration} ${unit} timer` };
        const reminderText = lower.replace(/remind\s*(me\s*to)?/i, "").trim() || raw;
        return { type: "reminder", intent, text: reminderText, label: `Reminder: ${reminderText}`, action: "set_reminder", voiceReply: `Reminder set` };
    }

    // ── Note ──────────────────────────────────────────────────────
    if (intent === "note") {
        const text = raw.replace(/^(note|write)\s+/i, "").trim();
        return { type: "note", intent, text, label: `Note: ${text}`, action: "save_note", voiceReply: `Note saved` };
    }

    // ── Greeting / info ───────────────────────────────────────────
    if (intent === "greeting") return { type: "greeting", intent, label: "Hey! I'm JARVIS. What can I do?", action: "respond", voiceReply: "Hey! I am JARVIS, ready to help." };
    if (intent === "time") {
        const t = new Date().toLocaleTimeString();
        return { type: "time", intent, time: t, label: `Time: ${t}`, action: "respond", voiceReply: `The current time is ${t}` };
    }
    if (intent === "date") {
        const d = new Date().toLocaleDateString();
        return { type: "date", intent, date: d, label: `Today: ${d}`, action: "respond", voiceReply: `Today is ${d}` };
    }
    if (intent === "status") return { type: "status", intent, label: "Running at 100% efficiency!", action: "respond", voiceReply: "All systems operational." };

    // ── System commands ───────────────────────────────────────────
    if (intent === "system") {
        if (/\bshutdown\b/.test(lower)) return { type: "system", intent, action: "shutdown", label: "Initiating shutdown", warning: true, voiceReply: "Shutting down" };
        if (/\bsleep mode\b/.test(lower)) return { type: "system", intent, action: "sleep", label: "Going to sleep mode", warning: false, voiceReply: "Going to sleep" };
    }

    // ── CRM / Leads ───────────────────────────────────────────────
    if (intent === "crm") return { type: "get_leads", intent, action: "get_leads", label: "Fetching leads" };

    // ── Payment ───────────────────────────────────────────────────
    if (intent === "payment") return { type: "payment", intent, action: "generate_payment_link", label: "Generating payment link" };

    // ── Fallback: let AI handle ───────────────────────────────────
    return { type: "intelligence", intent: "intelligence", text: raw, action: "ai_reply", label: raw, voiceReply: null };
}

module.exports = { detectIntent, parseCommand, APP_MAP, URL_MAP };
