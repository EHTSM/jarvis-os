const { toolAgent } = require("./tool.cjs");
const VoiceAgent = require("./voiceAgent.cjs");
const voiceAgent = new VoiceAgent();
const { DesktopAgent } = require("./desktopAgent.cjs");
const { AgentFactory } = require("./agentFactory.cjs");

// Singleton instances
const desktopAgent = new DesktopAgent();
const agentFactory = new AgentFactory();

async function executorAgent(task) {
    switch (task.type) {
        case "time": {
            const currentTime = new Date().toLocaleTimeString();
            return {
                type: "time",
                result: `Current time is: ${currentTime} ⏰`
            };
        }

        case "date": {
            const currentDate = new Date().toLocaleDateString();
            return {
                type: "date",
                result: `Today's date is: ${currentDate} 📅`
            };
        }

        case "open_google":
        case "open_youtube":
        case "open_chatgpt": {
            const toolResult = await toolAgent(task);
            return {
                type: task.type,
                result: toolResult.message,
                url: toolResult.url
            };
        }

        case "search": {
            const toolResult = await toolAgent(task);
            return {
                type: "search",
                result: toolResult.message,
                url: toolResult.url
            };
        }

        case "clear_memory":
            return {
                type: "clear_memory",
                result: "clear_memory"
            };

        // ✅ TRIGGER TYPES - These return special payload for scheduler
        case "remind_in":
        case "remind_at":
        case "daily_task":
        case "schedule_tomorrow": {
            return {
                type: "trigger",
                result: "Task scheduled",
                trigger_type: task.trigger_type, // Should be "timeout" or "cron" from triggerAgent
                original_type: task.type,         // Keep track of original type
                action: task.action,
                delay_ms: task.delay_ms,
                cron_time: task.cron_time,
                time: task.time,
                is_recurring: task.is_recurring,
                payload: task.payload
            };
        }

        case "ai":
            return null;

        // 🎤 VOICE OUTPUT - Speak text
        case "speak": {
            const text = task.payload?.text || "Speaking";
            const voiceResult = await voiceAgent.speak(text);
            return {
                type: "speak",
                result: voiceResult.success ? `Spoken: "${text.slice(0, 50)}"` : `Voice error: ${voiceResult.error}`,
                success: voiceResult.success,
                message: voiceResult.message
            };
        }

        // 🖥️  DESKTOP CONTROL - Open Application
        case "open_app": {
            const appName = task.payload?.app || "Unknown";
            const desktopResult = await desktopAgent.openApp(appName);
            return {
                type: "open_app",
                result: desktopResult.success ? `Opened: ${appName}` : `Failed to open: ${appName}`,
                success: desktopResult.success,
                app: appName,
                error: desktopResult.error
            };
        }

        // ⌨️  DESKTOP CONTROL - Type Text
        case "type_text": {
            const text = task.payload?.text || "";
            const speed = task.payload?.speed || 50;
            const desktopResult = await desktopAgent.typeText(text, speed);
            return {
                type: "type_text",
                result: desktopResult.success ? `Typed: ${text.slice(0, 50)}` : `Type error: ${desktopResult.error}`,
                success: desktopResult.success,
                typed_chars: desktopResult.typed_chars || 0,
                error: desktopResult.error
            };
        }

        // ⌨️  DESKTOP CONTROL - Press Key
        case "press_key": {
            const key = task.payload?.key || "enter";
            const desktopResult = await desktopAgent.pressKey(key);
            return {
                type: "press_key",
                result: desktopResult.success ? `Pressed: ${key}` : `Key press error: ${desktopResult.error}`,
                success: desktopResult.success,
                key: key,
                error: desktopResult.error
            };
        }

        // 🤖 AGENT FACTORY - Create new agent
        case "create_agent": {
            const specification = task.payload?.specification || "";

            // Parse specification to extract:
            // - Agent name
            // - Agent type (api, processor, scheduler, analyzer)
            // - Configuration

            // Simple heuristic-based parsing
            const nameMatch = specification.match(/(?:called?|named?|for)\s+(\w+)/i);
            const agentName = nameMatch ? nameMatch[1].toLowerCase() : `agent_${Date.now()}`;

            // Determine type from specification
            let agentType = "processor"; // default
            if (specification.includes("api") || specification.includes("fetch") || specification.includes("http")) {
                agentType = "api";
            } else if (specification.includes("schedule") || specification.includes("daily") || specification.includes("recurring")) {
                agentType = "scheduler";
            } else if (specification.includes("analyze") || specification.includes("analysis")) {
                agentType = "analyzer";
            }

            const spec = {
                description: specification,
                config: { specification },
                inputType: "string",
                outputType: "object"
            };

            const creationResult = await agentFactory.createAgent(agentName, agentType, spec);

            return {
                type: "create_agent",
                result: creationResult.success
                    ? `✨ Created agent "${creationResult.agent}" (${creationResult.type})`
                    : `❌ Failed to create agent: ${creationResult.error}`,
                success: creationResult.success,
                agent: creationResult.agent,
                agent_type: creationResult.type,
                error: creationResult.error
            };
        }

        // 🤖 AGENT FACTORY - List all agents
        case "list_agents": {
            const agentList = agentFactory.listAgents();
            const agentSummary = agentList.agents.length === 0
                ? "No agents created yet"
                : agentList.agents
                    .map(a => `• ${a.name} (${a.type})`)
                    .join("\n");

            return {
                type: "list_agents",
                result: `📦 Total Agents: ${agentList.total}\n${agentSummary}`,
                success: true,
                agents: agentList.agents,
                total: agentList.total
            };
        }

        // 🤖 AGENT FACTORY - Execute existing agent
        case "execute_agent": {
            const agentName = task.payload?.agent || "";
            const input = task.payload?.input || task.payload;

            const executionResult = await agentFactory.executeAgent(agentName, input);

            return {
                type: "execute_agent",
                result: executionResult.success
                    ? `✅ Agent "${agentName}" executed: ${JSON.stringify(executionResult.result).slice(0, 100)}`
                    : `❌ Failed to execute agent: ${executionResult.error}`,
                success: executionResult.success,
                agent: agentName,
                output: executionResult.result,
                error: executionResult.error
            };
        }

        default:
            return {
                type: "unsupported",
                result: "Task not supported by executor"
            };
    }
}

module.exports = { executorAgent };
