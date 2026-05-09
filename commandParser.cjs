"use strict";
/**
 * JARVIS Command Parser — legacy/commandParser pipeline.
 * parseCommand delegates to backend/utils/parser.js (canonical parser).
 * executeCommand unchanged — calls tool.cjs → primitives.cjs.
 */

const parser    = require("./backend/utils/parser");
const { toolAgent } = require("./agents/tool.cjs");

/**
 * Parse a raw command string.
 * Wraps parser.parseCommand — maps type:"intelligence" (AI fallback) to
 * type:"unknown" so legacy callers get the shape they expect.
 */
function parseCommand(input) {
    const parsed = parser.parseCommand(input);
    if (parsed.type === "intelligence") {
        return {
            ...parsed,
            type:       "unknown",
            action:     "unknown",
            label:      `Cannot recognize: "${(input || "").slice(0, 60)}"`,
            suggestion: "Try: open youtube, search something, remind me, what time is it",
        };
    }
    return parsed;
}

async function executeCommand(parsed) {
    const result = { success: false, message: "Command not executed", data: null };

    try {
        const toolResult = await toolAgent(parsed);

        if (toolResult && toolResult.message) {
            return { success: true, message: toolResult.message, data: toolResult };
        }

        switch (parsed.action) {
            case "respond":
                return { success: true, message: parsed.label, data: { type: "response", content: parsed.label } };

            case "unknown":
                return { success: false, message: parsed.label, data: { suggestion: parsed.suggestion } };

            default:
                return { success: true, message: parsed.label || "Done", data: parsed };
        }

    } catch (error) {
        result.message = `Error executing command: ${error.message}`;
        result.data    = { error: error.message };
    }

    return result;
}

module.exports = { parseCommand, executeCommand };
