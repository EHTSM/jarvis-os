"use strict";
/**
 * Tool Agent (intelligence pipeline / commandParser path).
 * Delegates all OS primitives to agents/primitives.cjs (single implementation).
 */

const { APP_MAP } = require("../backend/utils/parser");
const p = require("./primitives.cjs");

async function toolAgent(task) {
    if (!task || typeof task !== "object") return null;

    switch (task.type) {

        // ── Open a URL ─────────────────────────────────────────────
        case "open_url": {
            const url = task.url || "";
            const r = await p.openURL(url);
            return { type: "open_url", success: r.success, message: r.success ? (task.label || `Opened ${url}`) : r.error, url };
        }

        // ── Web search ─────────────────────────────────────────────
        case "web_search": {
            const r = await p.webSearch(task.query || "");
            return { type: "web_search", success: r.success, message: r.success ? `Searching: ${task.query}` : r.error, url: r.url };
        }

        // ── Launch app ─────────────────────────────────────────────
        case "open_app": {
            const key     = (task.app || "").toLowerCase().replace(/\s+/g, "");
            const appName = APP_MAP[key] || task.app || "";
            if (!appName) return { type: "open_app", success: false, message: "Unknown app" };
            const r = await p.openApp(appName);
            return { type: "open_app", success: r.success, message: r.success ? `Opened ${appName}` : `Cannot open ${appName}: ${r.error}` };
        }

        // ── Desktop typing ─────────────────────────────────────────
        case "desktop": {
            if (task.action === "type") {
                const r = await p.typeText(task.text || "");
                return { type: "desktop", success: r.success, message: r.success ? `Typed: ${task.text}` : r.error };
            }
            if (task.action === "open" && task.app) {
                const appName = APP_MAP[task.app.toLowerCase()] || task.app;
                const r = await p.openApp(appName);
                return { type: "desktop", success: r.success, message: r.success ? `Opened ${appName}` : r.error };
            }
            return null;
        }

        // ── Reminder / Timer ───────────────────────────────────────
        case "reminder":
            return { type: "reminder", success: true, message: `Reminder set: "${task.text}"` };

        case "timer":
            return { type: "timer", success: true, message: `Timer set: ${task.duration} ${task.unit || "minute"}(s)` };

        // ── Note saving ────────────────────────────────────────────
        case "note": {
            const fs   = require("fs");
            const path = require("path");
            const dir  = path.join(__dirname, "../data");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, "notes.txt");
            fs.appendFileSync(file, `[${new Date().toISOString()}] ${task.text}\n`);
            return { type: "note", success: true, message: `Note saved: "${task.text}"` };
        }

        // ── Info responses ─────────────────────────────────────────
        case "greeting":
        case "time":
        case "date":
        case "status":
            return { type: task.type, success: true, message: task.label };

        default:
            return null;
    }
}

module.exports = { toolAgent };
