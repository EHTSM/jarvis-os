"use strict";
/**
 * Tool Agent — executes parsed commands as real OS actions.
 * Delegates all OS primitives to agents/primitives.cjs (single implementation).
 * Moved from backend/agents/ so it lives with the rest of the agent layer.
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../backend/utils/logger");
const { APP_MAP } = require("../backend/utils/parser");
const p      = require("./primitives.cjs");

/**
 * @param {object} parsed  – output of parser.parseCommand()
 * @returns {Promise<{success:boolean, message:string, data?:any}|null>}
 */
async function execute(parsed) {
    const type = parsed.type || parsed.intent;

    switch (type) {

        case "open_url": {
            const url = parsed.url || "";
            const r = await p.openURL(url);
            if (!r.success) {
                logger.warn(`[Tool] openURL failed: ${r.error}`);
                return { success: false, message: r.error || "URL rejected" };
            }
            return { success: true, message: parsed.label || `Opened ${url}`, url };
        }

        case "web_search": {
            const r = await p.webSearch(parsed.query || "");
            if (!r.success) { logger.warn(`[Tool] webSearch failed: ${r.error}`); }
            return { success: r.success, message: r.success ? `Searching: ${parsed.query}` : r.error, url: r.url };
        }

        case "open_app": {
            const appKey  = (parsed.app || "").toLowerCase().replace(/\s+/g, "");
            const appName = APP_MAP[appKey] || parsed.appName || parsed.app || "";
            if (!appName) return { success: false, message: "Unknown application" };
            const r = await p.openApp(appName);
            if (!r.success) logger.warn(`[Tool] openApp failed: ${r.error}`);
            return { success: r.success, message: r.success ? `Opened ${appName}` : `Cannot open ${appName}` };
        }

        case "desktop": {
            const action = parsed.action;

            if (action === "type") {
                const r = await p.typeText(parsed.text || "");
                if (!r.success) return { success: false, message: r.error };
                const preview = (parsed.text || "").slice(0, 60);
                return { success: true, message: `Typed: "${preview}${parsed.text?.length > 60 ? "…" : ""}"`, typed_chars: r.typed_chars };
            }
            if (action === "press_key") {
                const r = await p.pressKey(parsed.key || "enter");
                return { success: r.success, message: r.success ? `Pressed: ${r.key}` : r.error };
            }
            if (action === "key_combo") {
                const r = await p.pressKeyCombo(parsed.modifiers || [], parsed.key || "c");
                return { success: r.success, message: r.success ? `Key combo: ${[...r.modifiers, r.key].join("+")}` : r.error };
            }
            return { success: false, message: `Unknown desktop action: ${action}` };
        }

        case "note": {
            const dir  = path.join(__dirname, "../data");
            const file = path.join(dir, "notes.txt");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(file, `[${new Date().toISOString()}] ${parsed.text}\n`);
            return { success: true, message: `Note saved: "${parsed.text}"` };
        }

        case "reminder":
            return { success: true, message: `Reminder set: "${parsed.text}"` };

        case "timer":
            return { success: true, message: `Timer: ${parsed.duration} ${parsed.unit}(s)` };

        case "greeting":
        case "time":
        case "date":
        case "status":
            return { success: true, message: parsed.label };

        default:
            return null;
    }
}

module.exports = { execute };
