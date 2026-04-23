const { triggerAgent } = require("./trigger.cjs");

function planner(input) {
  return triggerAgent(input);
}

module.exports = { planner };
const TASK_SEPARATORS = /(?:\s+and\s+|,\s*|;\s*|\s+then\s+|\s*\+\s*)/;

function normalizeTaskText(text) {
    return text.toLowerCase().trim();
}

function buildTask(segment) {
    const normalizedTask = normalizeTaskText(segment);

    // ✅ Check for trigger/schedule commands first
    const triggerResult = triggerAgent(segment);
    if (triggerResult) {
        return triggerResult;
    }

    const task = normalizedTask;

    if (task.includes("open google") || task.includes("google search")) {
        return {
            type: "open_google",
            label: "Open Google",
            payload: { url: "https://www.google.com" }
        };
    }

    if (cmd.includes("maps")) {
        return [
            {
                action: "maps_leads",
                command: command
            }
        ];
    }

    if (task.includes("open youtube") || task.includes("youtube")) {
        return {
            type: "open_youtube",
            label: "Open YouTube",
            payload: { url: "https://www.youtube.com" }
        };
    }

    if (task.includes("open chatgpt") || task.includes("chatgpt")) {
        return {
            type: "open_chatgpt",
            label: "Open ChatGPT",
            payload: { url: "https://chatgpt.com" }
        };
    }

    if (task.startsWith("search ")) {
        const query = task.replace(/^search\s+/, "").trim();
        return {
            type: "search",
            label: "Search",
            payload: { query: query || segment }
        };
    }

    if (task.includes("search") || task.includes("find")) {
        const query = task.replace(/^(search|find)\s*(for|about)?\s*/i, "").trim();
        return {
            type: "search",
            label: "Search",
            payload: { query: query || segment }
        };
    }

    if (task.includes("time") || task.includes("what time")) {
        return {
            type: "time",
            label: "Current Time",
            payload: {}
        };
    }

    if (task.includes("date") || task.includes("what date") || task.includes("today")) {
        return {
            type: "date",
            label: "Current Date",
            payload: {}
        };
    }

    if (task.includes("clear memory") || task.includes("reset memory")) {
        return {
            type: "clear_memory",
            label: "Clear Memory",
            payload: {}
        };
    }

    // 🎤 VOICE OUTPUT - speak text
    if (task.startsWith("speak ") || task.startsWith("say ")) {
        const text = task.replace(/^(speak|say)\s+/, "").trim();
        return {
            type: "speak",
            label: "Speak",
            payload: { text: text || segment }
        };
    }

    // 🖥️  DESKTOP CONTROL - open application
    if (task.startsWith("open ") && !task.includes("google") && !task.includes("youtube") && !task.includes("chatgpt")) {
        const appName = task.replace(/^open\s+/, "").trim();
        // Common app names on macOS
        const commonApps = ["chrome", "firefox", "safari", "vs code", "code", "sublime", "terminal", "finder", "mail", "notes", "calculator", "spotify", "slack", "discord"];
        if (commonApps.some(app => appName.includes(app)) || appName.length > 2) {
            return {
                type: "open_app",
                label: "Open App",
                payload: { app: appName || segment }
            };
        }
    }

    // ⌨️  DESKTOP CONTROL - type text
    if (task.startsWith("type ")) {
        const text = task.replace(/^type\s+/, "").trim();
        return {
            type: "type_text",
            label: "Type Text",
            payload: { text: text || segment }
        };
    }

    // ⌨️  DESKTOP CONTROL - press key
    if (task.startsWith("press ")) {
        const key = task.replace(/^press\s+/, "").trim();
        return {
            type: "press_key",
            label: "Press Key",
            payload: { key: key || segment }
        };
    }

    // ⌨️  DESKTOP CONTROL - press key (alternative syntax)
    if (task.includes("press enter") || task.includes("hit enter")) {
        return {
            type: "press_key",
            label: "Press Key",
            payload: { key: "enter" }
        };
    }

    if (task.includes("press space") || task.includes("hit space")) {
        return {
            type: "press_key",
            label: "Press Key",
            payload: { key: "space" }
        };
    }

    // 🤖 AGENT FACTORY - Create new agent
    if (task.includes("create agent") ||
        task.includes("build agent") ||
        task.includes("new agent") ||
        task.startsWith("create ") && task.includes("agent")) {

        // Extract agent specification from the task
        let specification = task
            .replace(/^(create|build)\s+(an?)?\s*agent\s+(that|to|for)?\s*/i, "")
            .replace(/^new\s+agent\s+/i, "")
            .trim();

        return {
            type: "create_agent",
            label: "Create Agent",
            payload: { specification: specification || segment }
        };
    }

    // 🤖 AGENT FACTORY - List all agents
    if (task.includes("list agents") ||
        task.includes("show agents") ||
        task.includes("what agents")) {
        return {
            type: "list_agents",
            label: "List Agents",
            payload: {}
        };
    }

    // 🤖 AGENT FACTORY - Execute existing agent
    if (task.startsWith("run agent ") ||
        task.startsWith("execute agent ")) {
        const agentName = task
            .replace(/^(run|execute)\s+agent\s+/i, "")
            .trim();

        return {
            type: "execute_agent",
            label: "Execute Agent",
            payload: { agent: agentName, input: segment }
        };
    }

    return {
        type: "ai",
        label: "AI Query",
        payload: { query: segment }
    };
}

function plannerAgent(input, context = null) {
    // 🧠 Check if this is a frequently executed command
    if (context && context.frequent_commands && context.frequent_commands.length > 0) {
        const lowerInput = input.toLowerCase();
        for (const cmd of context.frequent_commands) {
            if (lowerInput === cmd.name.toLowerCase()) {
                console.log(`⚡ Fast-track: Recognized frequent command "${cmd.name}" (${cmd.count}x)`);
                // Still parse normally, but log that it's a known pattern
            }
        }
    }

    const segments = input
        .split(TASK_SEPARATORS)
        .map((segment) => segment.trim())
        .filter(Boolean);

    // Ensure we always return an array, even for single tasks
    const tasks = segments.map((segment) => buildTask(segment));
    return Array.isArray(tasks) ? tasks : [tasks];
}

module.exports = {
    plannerAgent
};
